// 2.4.1 正文格式自动修正：生成结束后自动修好这条回复，下一轮仍按修正前的问题提醒，可在「格式」窗口撤销。
// 正文被吞进思考区时，前后的状态栏、小剧场照前几条回复一起搬出来。
// 先构建并在仓库根目录运行 8765 静态服务。
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const URL = process.env.PA_TEST_URL || 'http://127.0.0.1:8765/test/site/index.html';
const KEY = 'mcdonalds:reply-format';
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const errors = [];
const ok = (message) => console.log('✓', message);
const LEAK = '[按步骤详细思考下面所有要求，不要跳过任何一步]\n第一步：确认身份和任务。\n第二步：梳理前文和人物。\n<!-- 锚定 -->\n<content>\n正文\n</content>';
try {
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
        c.eventTypes.GENERATION_AFTER_COMMANDS = 'generation_after_commands';
        window.__prompts = {};
        c.setExtensionPrompt = (key, text) => { window.__prompts[key] = text; };
        c.saveChat = async () => { window.__chatSaves = (window.__chatSaves || 0) + 1; };
      }
    });
  });
  await page.goto(URL);
  await page.waitForFunction(() => window.__mcdonalds?.open, null, { timeout: 15000 });
  await page.evaluate(() => {
    window.__toasts = [];
    window.toastr = Object.fromEntries(['success', 'info', 'warning', 'error'].map((k) => [k, (m) => window.__toasts.push(`${k}:${m}`)]));
  });
  const chat = () => page.evaluate(() => structuredClone(window.SillyTavern.getContext().chat[2]));
  const reply = (text) => page.evaluate((text) => {
    window.SillyTavern.getContext().chat = [{ is_user: false, mes: '开场白' }, { is_user: true, mes: '继续' }, { is_user: false, mes: text, extra: {} }];
  }, text);
  // 一轮生成：开始前（AFTER_COMMANDS）→ 写入回复 → 结束（ENDED 或 STOPPED）
  const generate = async (text, { type = 'normal', end = 'GENERATION_ENDED' } = {}) => {
    await page.evaluate(async (type) => { const c = window.SillyTavern.getContext(); await c.eventSource.emit(c.eventTypes.GENERATION_AFTER_COMMANDS, type, {}, false); }, type);
    await reply(text);
    await page.evaluate(async (end) => { const c = window.SillyTavern.getContext(); await c.eventSource.emit(c.eventTypes[end]); }, end);
    await page.waitForTimeout(700);
  };
  const setConfig = (config) => page.evaluate((config) => {
    const c = window.SillyTavern.getContext(), s = c.extensionSettings.mcdonalds || (c.extensionSettings.mcdonalds = {});
    s.replyGuard = { [window.__mock.live.preset_settings_openai]: config };
  }, config);

  // 默认关闭：不改聊天
  await setConfig({ bodyTag: 'content', requiredTags: [], enabled: true });
  await generate(LEAK);
  assert.equal((await chat()).mes, LEAK, '没开自动修正时不改聊天');
  ok('默认不自动修正');

  // 开启：思考移进思考区，注释和正文留在原处；弹提示；下一轮按修正前的问题提醒
  await setConfig({ bodyTag: 'content', requiredTags: [], enabled: true, autoFix: true });
  await generate(LEAK);
  const fixed = await chat();
  assert.equal(fixed.mes, '<!-- 锚定 -->\n<content>\n正文\n</content>');
  assert.match(fixed.extra.reasoning, /^\[按步骤详细思考[\s\S]*第二步：梳理前文和人物。$/);
  assert.match(await page.evaluate(() => window.__toasts.at(-1)), /^success:已自动修正这条回复：.*移进思考区/);
  await page.evaluate(async () => { const c = window.SillyTavern.getContext(); await c.eventSource.emit(c.eventTypes.GENERATION_AFTER_COMMANDS, 'normal', {}, false); });
  assert.match(await page.evaluate((key) => window.__prompts[key] || '', KEY), /\S/, '修好后下一轮仍提醒');
  ok('生成结束后自动修正，下一轮照样提醒');

  // 「回复」页：自动页显示已开启，检查页显示已自动修正，可撤销
  await page.evaluate(() => window.__mcdonalds.open('reply-auto'));
  await page.locator('[data-page=reply] [data-r=autofix]').waitFor();
  assert.equal(await page.locator('[data-page=reply] [data-r=autofix]').isChecked(), true);
  await page.evaluate(() => window.__mcdonalds.open('reply-check'));
  await page.click('[data-page=reply] [data-r=latest]');
  await page.locator('[data-page=reply] [data-r=undo-auto]').click();
  await page.locator('[data-page=reply] [data-r=result]', { hasText: '已撤销自动修正' }).waitFor();
  assert.equal((await chat()).mes, LEAK, '撤销后恢复原文');
  await page.evaluate(() => window.__mcdonalds.open('organize'));
  ok('可在「回复 → 检查」撤销自动修正');

  // 手动停止、续写、末尾只缺结束标签（可能被截断）：都不自动改
  await generate(LEAK, { end: 'GENERATION_STOPPED' });
  assert.equal((await chat()).mes, LEAK, '手动停止不改');
  // 结束先到、停止后到（还在等待时被停止）也不改
  await page.evaluate(async () => { const c = window.SillyTavern.getContext(); await c.eventSource.emit(c.eventTypes.GENERATION_AFTER_COMMANDS, 'normal', {}, false); });
  await reply(LEAK);
  await page.evaluate(async () => { const c = window.SillyTavern.getContext(); await c.eventSource.emit(c.eventTypes.GENERATION_ENDED); await c.eventSource.emit(c.eventTypes.GENERATION_STOPPED); });
  await page.waitForTimeout(700);
  assert.equal((await chat()).mes, LEAK, '结束后紧接着停止也不改');
  await generate(LEAK, { type: 'continue' });
  assert.equal((await chat()).mes, LEAK, '续写不改');
  await generate('<content>\n故事写到一半');
  assert.equal((await chat()).mes, '<content>\n故事写到一半', '末尾不补结束标签');
  ok('手动停止、续写、可能被截断的回复不自动改');

  // 正文连同状态栏、小剧场被吞进思考区：照开场白的结构一起搬出来；上次只搬出正文的，留在思考区末尾的块也放回原位
  const swallow = (mes, reasoning) => page.evaluate(([mes, reasoning]) => {
    window.SillyTavern.getContext().chat = [{ is_user: false, mes: '<status>夜</status>\n<content>开场白</content>\n<theater>小剧场</theater>' }, { is_user: true, mes: '继续' }, { is_user: false, mes, extra: { reasoning } }];
  }, [mes, reasoning]);
  const endTurn = async () => {
    await page.evaluate(async () => { const c = window.SillyTavern.getContext(); await c.eventSource.emit(c.eventTypes.GENERATION_AFTER_COMMANDS, 'normal', {}, false); });
  };
  const finish = async () => {
    await page.evaluate(async () => { const c = window.SillyTavern.getContext(); await c.eventSource.emit(c.eventTypes.GENERATION_ENDED); });
    await page.waitForTimeout(700);
  };
  await endTurn();
  await swallow('', '想一想。\n<status>晨</status>\n<content>\n正文\n</content>\n<theater>这条小剧场</theater>');
  await finish();
  let m = await chat();
  assert.equal(m.mes, '<status>晨</status>\n<content>\n正文\n</content>\n<theater>这条小剧场</theater>');
  assert.equal(m.extra.reasoning, '想一想。');
  ok('正文连同前后的状态栏、小剧场一起搬出思考区');
  await endTurn();
  await swallow('<content>\n正文\n</content>', '想一想。\n<status>晨</status>\n<theater>这条小剧场</theater>');
  await finish();
  m = await chat();
  assert.equal(m.mes, '<status>晨</status>\n<content>\n正文\n</content>\n<theater>这条小剧场</theater>');
  assert.equal(m.extra.reasoning, '想一想。');
  ok('留在思考区末尾的块照开场白放回正文前后');
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
