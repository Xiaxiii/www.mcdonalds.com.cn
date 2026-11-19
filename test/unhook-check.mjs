// 2.11.29 检查 → 思维链：「变量读到」的条目「取消接入」——窗口列出要去掉的几处，确认后条目回到「未提及」，页头撤销能恢复。
// 先构建并在仓库根目录运行 8765 静态服务。用法：PW_CHROME=/usr/bin/chromium node test/unhook-check.mjs
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const URL = process.env.PA_TEST_URL || 'http://127.0.0.1:8765/test/site/index.html';
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const errors = [];
const ok = (message) => console.log('✓', message);
const NAME = '取消接入检查（公开合成）';
const p = (identifier, name, content) => ({ identifier, name, content, role: 'system', injection_position: 0, injection_depth: 4 });
const RAIN = '雨天时角色变得沉默，反复擦拭随身物品，说话前先停顿，回答只说半句。';
const preset = {
  prompts: [
    p('init', '变量初始化', '{{setvar::文风cot::}}\n{{setvar::雨天cot::}}'),
    p('style', '文风', '<writing_style>\n清淡：少形容词，靠对白推进。\n</writing_style>\n{{setvar::文风cot::### 本轮文风怎么落在对白上？}}'),
    p('rain', '雨天', `${RAIN}\n{{setvar::雨天cot::### 雨天时角色哪句话只说了一半？}}`),
    p('cot', '思维链', '<thinking>\n{{getvar::文风cot}}\n{{getvar::雨天cot}}\n</thinking>')
  ],
  prompt_order: [{ character_id: 100001, order: ['init', 'style', 'rain', 'cot'].map((identifier) => ({ identifier, enabled: true })) }]
};
const live = (page) => page.evaluate(() => Object.fromEntries(window.__mock.live.prompts.map((x) => [x.identifier, x.content])));
const top = (page) => page.locator('.pa-sheet-mask:not(.pa-out) .pa-sheet').last();
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(URL);
  await page.waitForFunction(() => window.__mcdonalds?.open);
  await page.evaluate(({ preset, NAME }) => {
    const m = window.__mock;
    m.names.splice(0, m.names.length, NAME);
    m.presets.splice(0, m.presets.length, preset);
    m.live.preset_settings_openai = NAME;
    Object.assign(m.live, structuredClone(preset));
    window.__mcdonalds.open('cot');
  }, { preset, NAME });
  await page.locator('.pa-cot [data-f=ok]').click();
  const row = page.locator('.pa-cov', { hasText: '雨天' });
  assert.ok(await row.locator('[data-unhook]').isVisible(), '「变量读到」的条目有「取消接入」');
  await page.locator('.pa-cot [data-f=none]').click();
  assert.equal(await page.locator('.pa-cot [data-unhook]').count(), 0, '「未提及」里没有「取消接入」');
  await page.locator('.pa-cot [data-f=ok]').click();
  ok('「取消接入」只在「变量读到」的条目上');

  await row.locator('[data-unhook]').click();
  const dlg = top(page);
  await dlg.waitFor();
  const items = await dlg.locator('.pa-unhook li').allTextContents();
  assert.equal(items.length, 3, items.join('｜'));
  assert.match(items[0], /「雨天」：去掉 \{\{setvar::雨天cot::/);
  assert.match(items[1], /「思维链」：去掉读取 \{\{getvar::雨天cot\}\}/);
  assert.match(items[2], /「变量初始化」：去掉清空 \{\{setvar::雨天cot::\}\}/);
  ok('窗口列出要去掉的三处');
  await dlg.locator('.pa-sheet-actions .pa-btn', { hasText: '取消接入' }).click();
  await page.waitForTimeout(800);
  let c = await live(page);
  assert.equal(c.rain, RAIN, '条目末尾的写入去掉了');
  assert.equal(c.cot, '<thinking>\n{{getvar::文风cot}}\n</thinking>', '思维链里的读取去掉了');
  assert.equal(c.init, '{{setvar::文风cot::}}', '初始化条目里的清空去掉了');
  assert.ok(c.style.includes('{{setvar::文风cot::'), '别的条目不受影响');
  await page.locator('.pa-cot [data-f=none]').click();
  assert.ok(await page.locator('.pa-cov', { hasText: '雨天' }).isVisible(), '取消后回到「未提及」');
  ok('确认后去掉三处，条目回到「未提及」，保存进预设');

  await page.locator('.pa-top [data-g=undo]').click();
  await page.waitForTimeout(800);
  c = await live(page);
  assert.ok(c.rain.includes('{{setvar::雨天cot::') && c.cot.includes('{{getvar::雨天cot}}') && c.init.includes('{{setvar::雨天cot::}}'), '页头撤销后三处都回来了');
  ok('页头撤销恢复');

  await page.locator('.pa-cot [data-f=ok]').click();
  await page.locator('.pa-cov', { hasText: '雨天' }).locator('[data-unhook]').click();
  await top(page).locator('.pa-sheet-actions .pa-btn', { hasText: '保留' }).click();
  await page.waitForTimeout(500);
  assert.ok((await live(page)).rain.includes('{{setvar::雨天cot::'), '点「保留」不改');
  ok('点「保留」不改');
  assert.deepEqual(errors, []);
  console.log('取消接入检查全部通过');
} finally {
  await browser.close();
}
