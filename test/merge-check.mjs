// 合并新版：缝合页来源旁「⋯」→ 合并新版。来源 = 新版，目标 = 旧版；逐条选择后并入旧版，可撤销。
// 先构建并在仓库根目录运行 8765 静态服务。用法：PW_CHROME=/usr/bin/chromium node test/merge-check.mjs
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { choose } from './choose.mjs';
const URL = process.env.PA_TEST_URL || 'http://127.0.0.1:8765/test/site/index.html';
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const errors = [];
const long = (tag, n = 6) => Array.from({ length: n }, (_, i) => `${tag} 第 ${i + 1} 行`).join('\n');
const p = (identifier, name, content) => ({ identifier, name, content, role: 'system', injection_position: 0, injection_depth: 4 });
const rule = (id, scriptName, findRegex) => ({ id, scriptName, findRegex, replaceString: '<div>$1</div>', trimStrings: [], placement: [2], disabled: false, markdownOnly: true, promptOnly: false, runOnEdit: true, substituteRegex: 0, minDepth: null, maxDepth: null });
const order = (list, off = []) => [{ character_id: 100001, order: list.map((x) => ({ identifier: x.identifier, enabled: !off.includes(x.identifier) })) }];
const groups = (list, members) => ({ baibaiToolkit: { presetPromptGroups: { version: 1, groups: list, prompts: Object.fromEntries(Object.entries(members).map(([k, v]) => [k, { groupId: v }])) } } });
const oldName = '合并旧版（公开合成）', newName = '合并新版（公开合成）';
const oldPrompts = [p('a1', '文风·白描', long('白描', 30)), p('a2', '文风·我自己写的', long('自写')), p('a3', '规则', long('规则')), p('a4', '一个名字特别长特别长特别长特别长特别长特别长特别长特别长的条目', long('长名')), p('tail', '结尾', '结尾')];
const oldPreset = { prompts: oldPrompts, prompt_order: order(oldPrompts), extensions: { ...groups([{ id: 'g1', name: '文风' }, { id: 'g2', name: '规则组' }], { a1: 'g1', a2: 'g1', a3: 'g2' }), regex_scripts: [rule('r1', '状态栏', '/<a>(.*)<\\/a>/g')] } };
const newPrompts = [p('b1', '文风·白描', long('白描', 30).replace('白描 第 15 行', '白描 第 15 行（新版改写）')), p('b5', '文风·哥特', long('哥特')), p('b3', '规则', long('规则')), p('b4', '一个名字特别长特别长特别长特别长特别长特别长特别长特别长的条目', long('长名')), p('tail', '结尾', '结尾')];
const newPreset = { prompts: newPrompts, prompt_order: order(newPrompts, ['b5']), extensions: { ...groups([{ id: 'h1', name: '文风' }, { id: 'h2', name: '规则组' }], { b1: 'h1', b5: 'h1', b3: 'h2' }), regex_scripts: [rule('r1', '状态栏', '/<a>([\\s\\S]*?)<\\/a>/g'), rule('n1', '新美化', '/<n>(.*)<\\/n>/g')] } };
async function open(viewport, extra = {}) {
  const page = await browser.newPage({ viewport, ...extra });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(URL);
  await page.waitForFunction(() => window.__mcdonalds?.open);
  await page.evaluate(({ oldPreset, newPreset, oldName, newName }) => {
    const m = window.__mock;
    m.names.splice(0, m.names.length, oldName, newName);
    m.presets.splice(0, m.presets.length, oldPreset, newPreset);
    m.live.preset_settings_openai = oldName;
    Object.assign(m.live, structuredClone(oldPreset));
    window.__mcdonalds.open('suture');
  }, { oldPreset, newPreset, oldName, newName });
  await choose(page, '.pa-src-name', newName);
  await choose(page, '.pa-dst-picker .pa-namebtn', oldName);
  await page.click('[data-st=srcmenu]');
  await page.locator('.pa-sheet-mask:not(.pa-out) .pa-pick-item').filter({ hasText: '合并新版' }).click();
  await page.waitForSelector('.pa-merge .pa-mgrow');
  return page;
}
const saved = (page, name) => page.evaluate((n) => { const m = window.__mock; return structuredClone(m.presets[m.names.indexOf(n)]); }, name);
try {
  const page = await open({ width: 1100, height: 900 });
  const sheet = page.locator('.pa-sheet-merge');
  // 分类、筛选、统计
  assert.deepEqual(await sheet.locator('[data-mtab]').allInnerTexts(), ['提示词', '正则']);
  assert.match(await sheet.locator('[data-mstat]').innerText(), /改动 1 条，采用新版 0 · 新增 1 条，加入 1 · 新版已删 1 条，删除 0/);
  assert.deepEqual(await sheet.locator('.pa-mgroup b').allInnerTexts(), ['文风', '规则组', '未分组']);
  const names = () => sheet.locator('.pa-mgrow .pa-mname').evaluateAll((list) => list.map((x) => x.textContent.replace(/^\d+\.\s*/, '').trim()));
  assert.deepEqual((await names()).slice(0, 3), ['文风·白描', '文风·哥特', '文风·我自己写的']);
  // 展开差异：只标出变化的行，长段未改动折起
  await sheet.locator('.pa-mgrow[data-key=a1] [data-mopen]').click();
  const diff = sheet.locator('.pa-mgrow[data-key=a1] .pa-mdiff');
  assert.equal(await diff.locator('.pa-mdl-del').innerText(), '- 白描 第 15 行');
  assert.equal(await diff.locator('.pa-mdl-add').innerText(), '+ 白描 第 15 行（新版改写）');
  assert.match(await diff.locator('.pa-mdl-gap').first().innerText(), /行未改动/);
  await page.screenshot({ path: 'test/shots/merge-desktop.png' });
  // 筛选
  await sheet.locator('[data-mfilter=added]').click();
  assert.deepEqual(await names(), ['文风·哥特']);
  await sheet.locator('[data-mfilter=all]').click();
  // 选择：采用新版、删除旧版独有
  await sheet.locator('.pa-mgrow[data-key=a1] [data-mc=new]').click();
  await sheet.locator('.pa-mgrow[data-key=a2] [data-mc=skip]').click();
  assert.match(await sheet.locator('[data-mstat]').innerText(), /采用新版 1 .*删除 1/);
  assert.equal(await sheet.locator('.pa-mgrow[data-key=a2]').evaluate((x) => x.classList.contains('pa-mgrow-off')), true);
  // 键盘排序：把「结尾」上移一位，进入「规则组」之后的位置
  await sheet.locator('.pa-mgrow[data-key=tail] .pa-mgrip').focus();
  await page.keyboard.press('ArrowUp');
  assert.deepEqual((await names()).slice(-2), ['结尾', '一个名字特别长特别长特别长特别长特别长特别长特别长特别长的条目']);
  // 正则分类
  await sheet.locator('[data-mtab=regex]').click();
  assert.deepEqual(await names(), ['状态栏', '新美化']);
  await sheet.locator('.pa-mgrow[data-key="a:0"] [data-mc=new]').click();
  // 并入
  await sheet.locator('.pa-sheet-actions .pa-btn-primary').click();
  await page.waitForFunction(() => !document.querySelector('.pa-sheet-merge'));
  await page.waitForTimeout(900);
  const out = await saved(page, oldName);
  assert.deepEqual(out.prompt_order[0].order.map((o) => o.identifier), ['a1', 'b5', 'a3', 'tail', 'a4']);
  assert.match(out.prompts.find((x) => x.identifier === 'a1').content, /新版改写/);
  assert.equal(out.prompt_order[0].order.find((o) => o.identifier === 'b5').enabled, false);
  assert.equal(out.extensions.baibaiToolkit.presetPromptGroups.prompts.b5.groupId, 'g1');
  assert.deepEqual(out.extensions.regex_scripts.map((r) => [r.id, r.findRegex]), [['r1', '/<a>([\\s\\S]*?)<\\/a>/g'], ['n1', '/<n>(.*)<\\/n>/g']]);
  // 新版预设不动
  assert.deepEqual(await saved(page, newName), newPreset);
  await page.close();

  // 手机：行内不横向溢出，长名字折行，按钮够得着
  const phone = await open({ width: 390, height: 780 }, { hasTouch: true, isMobile: true });
  const m = phone.locator('.pa-sheet-merge');
  const over = await m.locator('.pa-sheet-body').evaluate((x) => x.scrollWidth - x.clientWidth);
  assert.ok(over <= 1, `弹窗正文横向溢出 ${over}px`);
  const box = await m.locator('.pa-mgrow[data-key=a4] [data-mc=new]').boundingBox().catch(() => null);
  assert.equal(box, null, '无改动的条目不显示选择按钮');
  const btn = await m.locator('.pa-mgrow[data-key=a1] [data-mc=new]').boundingBox();
  assert.ok(btn.x + btn.width <= 390 && btn.height >= 28, JSON.stringify(btn));
  await m.locator('.pa-mgrow[data-key=a1] [data-mopen]').tap();
  await phone.screenshot({ path: 'test/shots/merge-phone.png' });
  // 没有改动时不能并入
  await m.locator('.pa-mgrow >> [data-mc=skip]').first().tap();
  assert.equal(await m.locator('.pa-sheet-actions .pa-btn-primary').isDisabled(), false);
  await m.locator('[data-mtab=regex]').tap();
  await m.locator('.pa-mgrow[data-key="b:1"] [data-mc=skip]').tap();
  assert.equal(await m.locator('.pa-sheet-actions .pa-btn-primary').isDisabled(), true);
  await phone.close();
  assert.deepEqual(errors, []);
  console.log('合并新版检查通过');
} finally {
  await browser.close();
}
