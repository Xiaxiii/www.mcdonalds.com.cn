import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import fixture from './fixtures/ungrouped-sections.cjs';
import { choose } from './choose.mjs';
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const errors = [];
const title = '未分组识别合成测试';
const dialog = page => page.getByRole('dialog', { name: '识别并归入分区', exact: true });
async function start(mobile, preset = fixture()) {
  const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1100, height: 900 }, hasTouch: mobile, isMobile: mobile });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:8765/test/site/index.html');
  await page.waitForFunction(() => window.__presetAtelier?.open);
  await page.evaluate(({ title, preset }) => {
    const m = window.__mock; m.names.push(title); m.presets.push(preset);
    m.live.preset_settings_openai = title; Object.assign(m.live, structuredClone(preset));
    window.__groupingToasts = [];
    window.toastr = Object.fromEntries(['info', 'warning', 'success', 'error'].map(type => [type, message => window.__groupingToasts.push(message)]));
    window.__presetAtelier.open('organize');
  }, { title, preset });
  await choose(page, '.pa-picker-slot .pa-namebtn', title);
  return page;
}
async function smart(page, mobile) {
  if (mobile) {
    await page.click('[data-tool=menu]');
    await page.locator('.pa-sheet-mask:not(.pa-out) .pa-pick-item').filter({ hasText: '智能分组' }).click();
  } else await page.click('[data-tool=smart]');
  await dialog(page).waitFor();
}
async function cancel(page) {
  await dialog(page).locator('.pa-sheet-actions button').filter({ hasText: '取消' }).click();
  await dialog(page).waitFor({ state: 'hidden' });
}
const saved = page => page.evaluate(n => structuredClone(window.__mock.presets[window.__mock.names.indexOf(n)]), title);
const waitUndo = page => page.waitForFunction(n => {
  const p = window.__mock.presets[window.__mock.names.indexOf(n)];
  return p.extensions.baibaiToolkit.presetPromptGroups.groups.length === 3 && !p.extensions.baibaiToolkit.presetPromptGroups.prompts.panel;
}, title);
try {
  for (const mobile of [true, false]) {
    const original = fixture(), page = await start(mobile, original);
    await smart(page, mobile);
    const sheet = dialog(page);
    assert.equal(await sheet.locator('[data-grouping-row]').count(), 4);
    assert.match(await sheet.locator('[data-grouping-row="0"]').innerText(), /一键开关 · 8 条/);
    assert.equal(await sheet.locator('[data-grouping-target="0"]').inputValue(), 'new');
    assert.equal(await sheet.locator('[data-grouping-target="1"]').inputValue(), 'group:base-group');
    assert.equal(await sheet.locator('[data-grouping-target="2"]').inputValue(), 'group:opt-group');
    assert.deepEqual(await saved(page), original);
    const name = sheet.locator('[data-grouping-name="0"]');
    await name.fill(''); assert.equal(await sheet.locator('.pa-btn-primary').isDisabled(), true);
    await name.fill('一键开关');
    assert.equal(await sheet.locator('.pa-btn-primary').isEnabled(), true);
    assert.equal(await sheet.evaluate(e => e.scrollWidth > e.clientWidth + 2), false);
    if (mobile) await sheet.screenshot({ path: new URL('./shots/group-classify-phone.png', import.meta.url).pathname });
    await cancel(page); assert.deepEqual(await saved(page), original);

    // 确定的建议与未识别条目可以在同一次操作中确认；预览包含实际归属与最终顺序。
    await smart(page, mobile);
    await sheet.locator('[data-grouping-unassigned] > summary').click();
    await sheet.locator('[data-grouping-on="3"]').check();
    assert.equal(await sheet.locator('.pa-btn-primary').isDisabled(), true);
    await sheet.locator('[data-grouping-target="3"]').selectOption('group:base-group');
    assert.equal(await sheet.locator('[data-grouping-on="3"]').isChecked(), true);
    await sheet.locator('[data-grouping-preview] > details > summary').click();
    assert.match(await sheet.locator('[data-grouping-preview-id="unknown"]').innerText(), /基础需求分区/);
    const preview = await sheet.locator('[data-grouping-preview-id]').evaluateAll(rows => rows.map(r => r.dataset.groupingPreviewId));
    await sheet.locator('.pa-btn-primary').click();
    await page.waitForFunction(n => window.__mock.presets[window.__mock.names.indexOf(n)].extensions.baibaiToolkit.presetPromptGroups.prompts.unknown?.groupId === 'base-group', title);
    const result = await saved(page), groups = result.extensions.baibaiToolkit.presetPromptGroups;
    assert.deepEqual(result.prompt_order[0].order.map(o => o.identifier), preview);
    assert.equal(groups.groups.length, 4);
    assert.equal(groups.groups.find(g => g.id === groups.prompts.panel.groupId).name, '一键开关');
    for (const id of ['repeat', 'base-switch', 'opt-switch', 'emotion-switch', 'nsfw-switch', 'note-switch', 'function-switch']) assert.equal(groups.prompts[id].groupId, groups.prompts.panel.groupId);
    assert.equal(groups.prompts['loose-prefix'].groupId, 'base-group');
    assert.equal(groups.prompts['loose-variable'].groupId, 'opt-group');
    assert.equal(groups.prompts.divider, undefined); assert.equal(groups.prompts.chatHistory, undefined);
    assert.deepEqual(result.prompts, original.prompts);
    assert.deepEqual(Object.fromEntries(result.prompt_order[0].order.map(o => [o.identifier, o.enabled])), Object.fromEntries(original.prompt_order[0].order.map(o => [o.identifier, o.enabled])));
    assert.deepEqual(await page.evaluate(() => window.__gen || []), []);
    await page.click('[data-g=undo]'); await waitUndo(page);
    assert.deepEqual(await saved(page), original);

    // 弹窗期间的其他修改会使预览失效。
    await smart(page, mobile);
    await page.evaluate(() => document.querySelector('.pa-row[data-id="unknown"] [data-act=toggle]').click());
    await sheet.locator('.pa-btn-primary').click();
    await page.waitForFunction(() => window.__groupingToasts.includes('预设已变化，请重新识别分区'));
    assert.equal((await saved(page)).extensions.baibaiToolkit.presetPromptGroups.prompts.panel, undefined);
    console.log(`✓ ${mobile ? '手机' : '桌面'}：截图结构识别、已有分区匹配、人工指定、完整预览、保存、撤销与过期保护`);
    await page.close();
  }

  // 无规则命中的输入仍显示可操作列表，不再只弹出「没有可自动分组」。
  const unknown = fixture();
  for (const p of unknown.prompts) { p.name = '普通条目' + p.identifier; p.content = '没有分类标记的普通正文'; }
  const page = await start(true, unknown);
  await smart(page, true);
  assert.match(await dialog(page).innerText(), /暂未识别出明确归属/);
  assert.equal(await dialog(page).locator('.pa-btn-primary').isDisabled(), true);
  await dialog(page).locator('[data-grouping-unassigned] > summary').click();
  const row = dialog(page).locator('[data-grouping-row]').filter({ hasText: '普通条目unknown' });
  await row.locator('select').selectOption('group:base-group');
  assert.equal(await row.locator('input[type=checkbox]').isChecked(), true);
  await dialog(page).locator('.pa-btn-primary').click();
  await page.waitForFunction(n => window.__mock.presets[window.__mock.names.indexOf(n)].extensions.baibaiToolkit.presetPromptGroups.prompts.unknown?.groupId === 'base-group', title);
  assert.equal((await saved(page)).extensions.baibaiToolkit.presetPromptGroups.prompts.panel, undefined);
  console.log('✓ 无识别结果时仍可指定目标，并只应用明确选择的条目');
  await page.close();
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
