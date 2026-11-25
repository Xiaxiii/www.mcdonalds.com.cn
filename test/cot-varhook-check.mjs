// 检查 → 思维链：文字提及的条目「用变量接入」、未提及条目的接入窗口里改用变量、批量用变量接入（含关着的条目、整组勾选）。
// 先构建并在仓库根目录运行 8765 静态服务。用法：PW_CHROME=/usr/bin/chromium node test/cot-varhook-check.mjs
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const URL = process.env.PA_TEST_URL || 'http://127.0.0.1:8765/test/site/index.html';
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const errors = [];
const ok = (message) => console.log('✓', message);
const NAME = '用变量接入检查（公开合成）';
const p = (identifier, name, content) => ({ identifier, name, content, role: 'system', injection_position: 0, injection_depth: 4 });
const COT = '<thinking>\nstep0: where are we? identify current writing_style and erotic stage (pre-contact / early contact / foreplay / active)\n- 情节推进\n- 人物反应\n</thinking>';
const HUNGER = '<writing_style>\n饥饿感贯穿全文：角色对食物、体温、触碰的渴望写进动作和感官细节。\n</writing_style>';
const preset = {
  prompts: [
    p('main', '主提示', '你是一位小说作者，按设定续写。'),
    p('hunger', '饥饿', HUNGER),
    p('light', '清淡', '<writing_style>\n清淡：少形容词，靠对白推进，情绪留白给读者自己体会。\n</writing_style>'),
    p('rain', '雨天', '雨天时角色变得沉默，反复擦拭随身物品，说话前先停顿，回答只说半句。'),
    p('cot', '爱欲与食欲cot', COT)
  ],
  prompt_order: [{ character_id: 100001, order: ['main', 'hunger', 'light', 'rain', 'cot'].map((identifier) => ({ identifier, enabled: identifier !== 'light' })) }],
  extensions: { baibaiToolkit: { presetPromptGroups: { version: 1, groups: [{ id: 'g1', name: '小说文风' }], prompts: { hunger: { groupId: 'g1' }, light: { groupId: 'g1' } } } } }
};
const stored = (page) => page.evaluate(() => window.__mock.presets[0]);
const top = (page) => page.locator('.pa-sheet-mask:not(.pa-out) .pa-sheet').last();
const settled = (loc) => loc.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)));
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
  await page.locator('.pa-cot [data-f=mention]').click();
  const row = page.locator('.pa-cov', { hasText: '饥饿' });
  await row.waitFor();
  await row.scrollIntoViewIfNeeded();
  assert.match(await row.innerText(), /文字提及[\s\S]*writing_style → 爱欲与食欲cot/);
  await page.screenshot({ path: 'test/shots/cot-varhook-row.png' });
  await row.locator('[data-varhook]').click();
  let sheet = top(page);
  await sheet.locator('[data-k=preview]').waitFor();
  assert.equal(await sheet.locator('[data-k=cot]').inputValue(), 'cot');
  assert.equal(await sheet.locator('[data-h=v]').inputValue(), '饥饿', '变量名取条目名');
  assert.equal(await sheet.locator('[data-k=line]').inputValue(), '2', '默认放在提到 writing_style 的那一行之后');
  assert.equal(await sheet.locator('[data-h=q]').inputValue(), '「饥饿」：本段如何落实？具体体现在哪里？');
  assert.match(await sheet.locator('[data-k=preview]').innerText(), /writing_style.*\n\{\{getvar::饥饿\}\}\n- 情节推进/);
  assert.equal(await sheet.locator('[data-k=preview] mark').innerText(), '{{getvar::饥饿}}');
  assert.match(await sheet.locator('[data-k=how]').innerText(), /新增「变量初始化」/);
  assert.ok(await sheet.evaluate((x) => x.scrollWidth <= x.clientWidth + 1), '手机宽度下窗口不横向溢出');
  await settled(page.locator('.pa-sheet-mask').last());
  await page.screenshot({ path: 'test/shots/cot-varhook.png' });
  await sheet.locator('[data-k=line]').selectOption('3');
  assert.equal(await sheet.locator('[data-h=q]').inputValue(), '- 「饥饿」：本段如何落实？具体体现在哪里？', '换到列表行之后，问句跟着用「- 」');
  assert.match(await sheet.locator('[data-k=preview]').innerText(), /- 情节推进\n\{\{getvar::饥饿\}\}\n- 人物反应/);
  await sheet.locator('[data-h=v]').fill('');
  await sheet.locator('.pa-sheet-actions .pa-btn-primary').click();
  assert.equal(await sheet.locator('[data-k=verr]').innerText(), '填写变量名', '变量名清空时不提交');
  await sheet.locator('[data-h=v]').fill('饥饿');
  await sheet.locator('[data-h=v]').dispatchEvent('change');
  await sheet.locator('.pa-sheet-actions .pa-btn-primary').click();
  await page.waitForFunction(() => window.__mock.presets[0].prompts.find((x) => x.identifier === 'cot').content.includes('{{getvar::饥饿}}'));
  let s = await stored(page);
  const P = (id) => s.prompts.find((x) => x.identifier === id);
  assert.equal(P('hunger').content, HUNGER + '\n{{setvar::饥饿::- 「饥饿」：本段如何落实？具体体现在哪里？}}');
  assert.equal(P('cot').content.split('\n')[3], '{{getvar::饥饿}}');
  const first = s.prompt_order[0].order[0].identifier;
  assert.equal(P(first).name, '变量初始化');
  assert.equal(P(first).content, '{{setvar::饥饿::}}');
  await page.locator('.pa-cot [data-f=ok]').click();
  await page.locator('.pa-cov', { hasText: '饥饿' }).filter({ hasText: '变量读到' }).waitFor();
  ok('文字提及的条目可用变量接入：默认放在提到它的行后，可改行，新建初始化条目，随后算作变量读到');

  await page.click('[data-g=undo]');
  await page.waitForFunction(() => !window.__mock.presets[0].prompts.some((x) => x.name === '变量初始化'));
  s = await stored(page);
  assert.equal(P('cot').content, COT);
  assert.equal(P('hunger').content, HUNGER);
  ok('页头撤销一并撤回条目、思维链和新建的初始化条目');

  await page.locator('.pa-cot [data-f=none]').click();
  await page.locator('.pa-cov', { hasText: '雨天' }).locator('[data-hook]').click();
  sheet = top(page);
  await sheet.locator('.pa-sheet-actions .pa-btn', { hasText: '用变量接入' }).click();
  sheet = top(page);
  await sheet.locator('[data-k=preview]').waitFor();
  assert.match(await sheet.getAttribute('aria-label'), /用变量接入/);
  await sheet.locator('.pa-sheet-actions .pa-btn', { hasText: '取消' }).click();
  ok('未提及条目的接入窗口在思维链只靠文字提及时，可改用变量接入');

  const card = page.locator('.pa-cot details.pa-card', { hasText: '爱欲与食欲cot' });
  await card.locator('summary').click();
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test/shots/cot-varhook-card.png' });
  await card.locator('[data-cotpick]').click();
  sheet = top(page);
  await sheet.locator('.pa-vb').waitFor();
  assert.deepEqual(await sheet.locator('.pa-vb-row:not(.pa-vb-ghead) .pa-vb-name').allInnerTexts(), ['饥饿', '清淡', '雨天'], '关着的条目也列出，过短的不列');
  assert.deepEqual(await sheet.locator('.pa-vb-ghead .pa-vb-name').allInnerTexts(), ['小说文风', '未分组']);
  assert.match(await sheet.locator('.pa-vb-row', { hasText: '清淡' }).innerText(), /未开启/);
  assert.equal(await sheet.locator('[data-k=cot]').inputValue(), 'cot');
  const primary = sheet.locator('.pa-sheet-actions .pa-btn-primary');
  assert.ok(await primary.isDisabled(), '没勾选时不能接入');
  await sheet.locator('.pa-vb-ghead', { hasText: '小说文风' }).locator('input').check();
  assert.equal(await primary.innerText(), '接入 2 条');
  await sheet.locator('[data-vid=rain]').check();
  assert.equal(await primary.innerText(), '接入 3 条');
  assert.equal(await sheet.locator('[data-vg="0"]').isChecked(), true);
  await sheet.locator('[data-vid=rain]').uncheck();
  await sheet.locator('[data-vid=light]').uncheck();
  assert.equal(await sheet.locator('[data-vg="0"]').evaluate((x) => x.indeterminate), true, '组里只勾了一部分时显示半选');
  await sheet.locator('[data-vid=light]').check();
  assert.equal(await sheet.locator('[data-k=line]').inputValue(), '2');
  assert.deepEqual(await sheet.locator('[data-k=preview] mark').allInnerTexts(), ['{{getvar::饥饿}}', '{{getvar::清淡}}']);
  assert.ok(await sheet.evaluate((x) => x.scrollWidth <= x.clientWidth + 1), '手机宽度下批量窗口不横向溢出');
  await settled(page.locator('.pa-sheet-mask').last());
  await page.screenshot({ path: 'test/shots/cot-varhook-batch.png' });
  await primary.click();
  await page.waitForFunction(() => window.__mock.presets[0].prompts.find((x) => x.identifier === 'cot').content.includes('{{getvar::清淡}}'));
  s = await stored(page);
  assert.deepEqual(P('cot').content.split('\n').slice(2, 4), ['{{getvar::饥饿}}', '{{getvar::清淡}}']);
  assert.ok(P('light').content.endsWith('\n{{setvar::清淡::「清淡」：本段如何落实？具体体现在哪里？}}'));
  assert.equal(s.prompts.filter((x) => x.name === '变量初始化').length, 1);
  assert.equal(s.prompts.find((x) => x.name === '变量初始化').content, '{{setvar::饥饿::}}\n{{setvar::清淡::}}');
  assert.equal(s.prompt_order[0].order.find((o) => o.identifier === 'light').enabled, false, '关着的条目仍关着');
  ok('批量用变量接入：整组勾选（含关着的条目），读取按预设顺序排成一段，初始化条目只建一条');

  await page.locator('.pa-cot [data-batchhook]').click();
  sheet = top(page);
  await sheet.locator('.pa-vb').waitFor();
  assert.deepEqual(await sheet.locator('.pa-vb-row:not(.pa-vb-ghead) .pa-vb-name').allInnerTexts(), ['雨天'], '已接入的不再列出');
  await sheet.locator('.pa-sheet-actions .pa-btn', { hasText: '取消' }).click();
  ok('列表上方「批量用变量接入」打开同一窗口，只列还没接入的条目');
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
