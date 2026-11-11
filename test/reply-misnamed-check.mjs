// 必需标签写错了名字（预设要 <card_status>，模型写成 <状态栏>）：检查点名、提醒不再让 <状态栏> 照常输出、修正时改名。
// 先构建并在仓库根目录运行 8765 静态服务。用法：PW_CHROME=/usr/bin/chromium node test/reply-misnamed-check.mjs
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
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
  await page.waitForFunction(() => window.__mcdonalds?.open, null, { timeout: 15000 });
  return page;
}
const NAME = '状态栏改名检查（公开合成）';
const p = (identifier, name, content) => ({ identifier, name, content, role: 'system', injection_position: 0, injection_depth: 4 });
const preset = {
  prompts: [
    p('fmt', '输出格式', '正文写在 <content> 里。正文后输出 <author_note> 作者的话，再输出状态栏：\n<card_status>\n<时>…</时>\n</card_status>')
  ],
  prompt_order: [{ character_id: 100001, order: [{ identifier: 'fmt', enabled: true }] }]
};
const wrong = '<content>故事正文。</content>\n<author_note>作者的话</author_note>\n\n<状态栏>\n  <时>未时二刻</时>\n</状态栏>';
try {
  const page = await openPage();
  await page.evaluate(({ preset, NAME, wrong }) => {
    const m = window.__mock;
    m.names.splice(0, m.names.length, NAME);
    m.presets.splice(0, m.presets.length, preset);
    m.live.preset_settings_openai = NAME;
    Object.assign(m.live, structuredClone(preset));
    const c = window.SillyTavern.getContext();
    c.extensionSettings.mcdonalds = { ...(c.extensionSettings.mcdonalds || {}), replyGuard: { [NAME]: { bodyTag: 'content', requiredTags: ['card_status'] } } };
    c.chat = [{ is_user: false, mes: '开场白' }, { is_user: true, mes: '继续' }, { is_user: false, mes: wrong }, { is_user: true, mes: '再来' }, { is_user: false, mes: wrong, swipe_id: 0, swipes: [wrong], extra: { reasoning: '' } }];
    window.__mcdonalds.open('reply-check');
  }, { preset, NAME, wrong });
  await page.click('[data-r=latest]');
  const result = page.locator('[data-r=result]');
  const text = await result.innerText();
  assert.match(text, /<状态栏> 预设没有用到，多半是写错了名字的 <card_status>/);
  const reminder = await page.locator('[data-r=result] pre.pa-pre').last().textContent();
  assert.match(reminder, /上一轮 <card_status> 的标签名写错了/);
  assert.doesNotMatch(reminder, /状态栏/, '提醒不写出错误的标签名');
  assert.doesNotMatch(reminder, /<状态栏>[^。]*照常输出/);
  ok('检查点名写错名的 <状态栏>；提醒写明改回 <card_status>，不再让 <状态栏> 照常输出');
  await page.click('[data-r=fix]');
  await page.locator('[data-r=undo-fix]').waitFor();
  const fixed = await page.evaluate(() => window.SillyTavern.getContext().chat[4].mes);
  assert.equal(fixed, wrong.replace('<状态栏>', '<card_status>').replace('</状态栏>', '</card_status>'));
  assert.match(await result.innerText(), /未发现配置范围内的格式问题/);
  ok('「修正这条回复」把 <状态栏> 改名为 <card_status>，内容不动');
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
