// 修正标签写回聊天、撤销，以及面板开着时不让酒馆反复试生成。先构建并在仓库根目录运行 8765 静态服务。
// 用法：PW_CHROME=/usr/bin/chromium node test/reply-fix-check.mjs
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { expandAll } from "./choose.mjs";
const URL = process.env.PA_TEST_URL || 'http://127.0.0.1:8765/test/site/index.html';
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const errors = [];
const ok = (message) => console.log('✓', message);
async function openPage() {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    let host;
    Object.defineProperty(window, 'SillyTavern', {
      configurable: true,
      get: () => host,
      set(value) {
        host = value;
        const c = value.getContext();
        Object.assign(c.eventTypes, { MESSAGE_EDITED: 'message_edited', MESSAGE_UPDATED: 'message_updated' });
        window.__emits = [];
        const emit = c.eventSource.emit;
        c.eventSource.emit = async (event, ...args) => { window.__emits.push([event, ...args]); return emit.call(c.eventSource, event, ...args); };
        window.__rendered = [];
        c.updateMessageBlock = (index, message) => window.__rendered.push([index, message.mes]);
        window.__chatSaves = 0;
        c.saveChat = async () => { window.__chatSaves++; };
      }
    });
  });
  await page.goto(URL);
  await page.waitForFunction(() => window.__presetAtelier?.open, null, { timeout: 15000 });
  return page;
}
const emitted = (page, event) => page.evaluate((event) => window.__emits.filter((e) => e[0] === event).length, event);
try {
  const page = await openPage();
  await page.evaluate(() => {
    window.SillyTavern.getContext().chat = [
      { is_user: false, mes: '开场白' }, { is_user: true, mes: '继续' },
      { is_user: false, mes: '<think>先分析用户要求\n<content>故事正文。</content>', swipe_id: 1, swipes: ['旧的滑动', '<think>先分析用户要求\n<content>故事正文。</content>'], extra: { reasoning: '' } }
    ];
    window.__presetAtelier.open('reply-check');
  });
  await page.click('[data-r=latest]');
  const result = page.locator('[data-r=result]');
  assert.match(await result.innerText(), /思考区在正文开始前结束/);
  await page.click('[data-r=fix]');
  await page.locator('[data-r=undo-fix]').waitFor();
  const fixed = await page.evaluate(() => window.SillyTavern.getContext().chat[2]);
  assert.equal(fixed.mes, '<think>先分析用户要求\n</think>\n<content>故事正文。</content>');
  assert.equal(fixed.swipes[1], fixed.mes);
  assert.equal(fixed.swipes[0], '旧的滑动');
  assert.deepEqual(await page.evaluate(() => window.__rendered.at(-1)), [2, fixed.mes]);
  assert.equal(await emitted(page, 'message_edited'), 1);
  assert.equal(await emitted(page, 'message_updated'), 1);
  assert.equal(await page.evaluate(() => window.__chatSaves), 1);
  assert.match(await result.innerText(), /未发现配置范围内的格式问题/);
  await page.click('[data-r=undo-fix]');
  await page.locator('[data-r=result] >> text=已撤销修正').waitFor();
  assert.equal(await page.evaluate(() => window.SillyTavern.getContext().chat[2].mes), '<think>先分析用户要求\n<content>故事正文。</content>');
  ok('补上思考结束标签后写回当前滑动、通知重渲染并保存；撤销恢复原文');

  await page.evaluate(() => { window.SillyTavern.getContext().chat[2] = { is_user: false, mes: '<状态栏>积分：3</状态栏>', extra: { reasoning: '我在想。\n<content>被吞进思考区的正文</content>' } }; });
  await page.click('[data-r=latest]');
  assert.match(await result.innerText(), /解析进了思考区/);
  assert.equal((await result.innerText()).includes('我在想'), false, '不展示思考内容');
  await page.evaluate(() => { window.SillyTavern.getContext().chat[2].mes += ' '; });
  await page.click('[data-r=fix]');
  assert.match(await result.innerText(), /已变化，请重新检查/);
  await page.click('[data-r=latest]');
  await page.click('[data-r=fix]');
  await page.locator('[data-r=undo-fix]').waitFor();
  const moved = await page.evaluate(() => window.SillyTavern.getContext().chat[2]);
  assert.equal(moved.mes, '<content>被吞进思考区的正文</content>\n<状态栏>积分：3</状态栏> ');
  assert.equal(moved.extra.reasoning, '我在想。');
  await page.click('[data-r=undo-fix]');
  await page.locator('[data-r=result] >> text=已撤销修正').waitFor();
  assert.equal(await page.evaluate(() => window.SillyTavern.getContext().chat[2].extra.reasoning), '我在想。\n<content>被吞进思考区的正文</content>');
  ok('正文被解析进思考区时可移回，回复变化后拒绝过期修正，撤销还原推理字段');

  await page.evaluate(() => window.__presetAtelier.open('organize'));
  // 酒馆推理前缀是 <ECoT>，模型又自带思考：<ECoT> 留在正文，说明原因；ECoT 当作思考标签，不算爆思维链
  await page.evaluate(() => {
    const c = window.SillyTavern.getContext();
    c.powerUserSettings.reasoning = { auto_parse: true, prefix: '<ECoT>', suffix: '</ECoT>' };
    c.chat[2] = { is_user: false, mes: '<ECoT>\n# 确认身份\n我是作者，开始仔细思考本轮剧情要怎么写，写够字数。\n</ECoT>\n<content>正文。</content>', extra: { reasoning: 'Processing Complex Instructions', reasoning_type: 'model' } };
  });
  await page.evaluate(() => window.__presetAtelier.open('reply-rules'));
  assert.equal(await page.locator('[data-r=thinking]').inputValue(), 'ECoT');
  await page.evaluate(() => window.__presetAtelier.open('reply-check'));
  await page.click('[data-r=latest]');
  assert.match(await result.innerText(), /<ECoT> 留在了正文里/);
  assert.match(await result.innerText(), /请求思维链/);
  assert.match(await result.innerText(), /未发现配置范围内的格式问题/);
  await page.evaluate(() => { window.SillyTavern.getContext().chat[2].extra.reasoning_type = 'parsed'; });
  await page.click('[data-r=latest]');
  assert.doesNotMatch(await result.innerText(), /留在了正文里/);
  ok('模型自带思考挤掉 <ECoT> 时说明原因和关法；推理前缀自动当作思考标签');
  await page.fill('[data-r=sample]', '我需要先检查用户要求，再安排剧情，然后写出符合人设的对话内容。\n<content>故事。</content>');
  await page.click('[data-r=paste]');
  assert.match(await result.innerText(), /爆思维链/);
  assert.match(await result.innerText(), /我需要先检查用户要求/);
  assert.equal(await page.locator('[data-r=fix]').count(), 0);
  ok('正文标签前的大段分析文字列出原文片段，不提供自动修正');

  await page.evaluate(() => { window.__emits = []; window.__presetAtelier.open('organize'); });
  await expandAll(page);
  const saves = await page.evaluate(() => window.__saved || 0);
  await page.locator('.pa-list .pa-row .pa-switch').first().click();
  await page.waitForFunction((n) => (window.__saved || 0) > n, saves);
  await page.locator('.pa-list .pa-row .pa-switch').nth(1).click();
  await page.waitForFunction((n) => (window.__saved || 0) > n + 1, saves);
  assert.equal(await emitted(page, 'oai_after'), 0, '面板开着时自动保存不让酒馆试生成');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__emits.some((e) => e[0] === 'oai_after'));
  assert.equal(await emitted(page, 'oai_after'), 1, '关面板时只通知一次');
  ok('面板开着时自动保存不发 OAI_PRESET_CHANGED_AFTER，关面板后合并通知一次');
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
