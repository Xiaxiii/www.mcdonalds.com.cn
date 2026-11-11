import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import fixture from './fixtures/group-repair.cjs';
import { choose } from './choose.mjs';
const name = '分散分区测试';
const original = fixture();
const originalIds = original.prompt_order[0].order.map(o => o.identifier);
const allIds = ['init', 'a1', 'a2', 'a3', 'a4', 'a5', 'loose', 'b1', 'b2', 'chatHistory', 'tail'];
const partialIds = ['init', 'a1', 'a2', 'loose', 'b1', 'b2', 'a3', 'a4', 'chatHistory', 'a5', 'tail'];
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const errors = [];
const saved = page => page.evaluate(n => structuredClone(window.__mock.presets[window.__mock.names.indexOf(n)]), name);
const waitOrder = (page, ids) => page.waitForFunction(({ name, ids }) => {
  const p = window.__mock.presets[window.__mock.names.indexOf(name)];
  return JSON.stringify(p.prompt_order.find(o => o.character_id === 100001).order.map(o => o.identifier)) === JSON.stringify(ids);
}, { name, ids });
const dialog = page => page.getByRole('dialog', { name: '归整分散分区', exact: true });
async function cancel(page) {
  await dialog(page).locator('.pa-sheet-actions button').filter({ hasText: '取消' }).click();
  await dialog(page).waitFor({ state: 'hidden' });
}
async function open(page) {
  await page.click('[data-repair-groups]'); await dialog(page).waitFor();
}
const previewIds = page => dialog(page).locator('[data-preview-id]').evaluateAll(rows => rows.map(r => r.dataset.previewId));
try {
  for (const mobile of [true, false]) {
    const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1100, height: 900 }, hasTouch: mobile, isMobile: mobile });
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://127.0.0.1:8765/test/site/index.html');
    await page.waitForFunction(() => window.__presetAtelier?.open);
    await page.evaluate(({ name, preset }) => {
      const m = window.__mock;
      m.names.push(name); m.presets.push(preset);
      m.live.preset_settings_openai = name; Object.assign(m.live, structuredClone(preset));
      window.__groupToasts = [];
      window.toastr = Object.fromEntries(['info', 'warning', 'success', 'error'].map(type => [type, msg => window.__groupToasts.push(msg)]));
      window.__presetAtelier.open('organize');
    }, { name, preset: fixture() });
    await choose(page, '.pa-picker-slot .pa-namebtn', name);
    assert.match(await page.locator('.pa-group-repair').innerText(), /2 个分区/);
    assert.equal(await page.locator('.pa-group[data-gid="a"]').count(), 4);

    // 打开预览和取消均不得修改预设。
    await open(page);
    assert.deepEqual(await previewIds(page), allIds);
    assert.deepEqual(await saved(page), original);
    await cancel(page); assert.deepEqual(await saved(page), original);

    // 手机与桌面均可从「智能分组」进入，勾选一个分区的预览与实际移动一致。
    if (mobile) {
      await page.click('[data-tool=menu]');
      await page.locator('.pa-sheet-mask:not(.pa-out) .pa-pick-item').filter({ hasText: '智能分组' }).click();
    } else await page.click('[data-tool=smart]');
    await page.locator('.pa-sheet-mask:not(.pa-out) .pa-pick-item').filter({ hasText: /^归整分散的/ }).click();
    await dialog(page).waitFor();
    await dialog(page).locator('[data-gather="0"]').uncheck();
    await dialog(page).locator('[data-gather="1"]').uncheck();
    assert.equal(await dialog(page).locator('.pa-btn-primary').isDisabled(), true);
    await dialog(page).locator('[data-gather="1"]').check();
    assert.deepEqual(await previewIds(page), partialIds);
    await dialog(page).locator('.pa-btn-primary').click();
    await waitOrder(page, partialIds);
    assert.match(await page.locator('.pa-group-repair').innerText(), /1 个分区/);
    await page.click('[data-g=undo]'); await waitOrder(page, originalIds);

    // 批量移动不改开关、组归属或正文，且一次撤销恢复原来的四段。
    await open(page);
    await dialog(page).locator('summary').click();
    assert.deepEqual(await previewIds(page), allIds);
    assert.equal(await dialog(page).evaluate(e => e.scrollWidth > e.clientWidth + 2), false);
    assert.equal(await dialog(page).locator('分区').count(), 0, '分组名中的尖括号作为文字显示');
    await dialog(page).locator('.pa-btn-primary').click(); await waitOrder(page, allIds);
    await page.locator('.pa-group-repair').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('.pa-group[data-gid="a"]').count(), 1);
    assert.equal(await page.locator('.pa-group[data-gid="b"]').count(), 1);
    const after = await saved(page);
    assert.deepEqual(after.prompts, original.prompts);
    assert.deepEqual(after.prompt_order[1], original.prompt_order[1]);
    const beforeSwitches = Object.fromEntries(original.prompt_order[0].order.map(o => [o.identifier, o.enabled]));
    assert.deepEqual(Object.fromEntries(after.prompt_order[0].order.map(o => [o.identifier, o.enabled])), beforeSwitches);
    assert.deepEqual(after.extensions.baibaiToolkit.presetPromptGroups.prompts, original.extensions.baibaiToolkit.presetPromptGroups.prompts);
    await page.click('[data-g=undo]'); await waitOrder(page, originalIds);
    assert.equal(await page.locator('.pa-group[data-gid="a"]').count(), 4);

    // 打开弹窗后发生修改，不能再把旧预览写回去。
    await open(page);
    await page.evaluate(() => document.querySelector('.pa-list .pa-row[data-id="tail"] [data-act="toggle"]').click());
    await dialog(page).locator('.pa-btn-primary').click();
    await page.waitForFunction(() => window.__groupToasts.some(m => m.includes('重新预览归整')));
    await waitOrder(page, originalIds);
    await page.waitForFunction(n => window.__mock.presets[window.__mock.names.indexOf(n)].prompt_order[0].order.find(o => o.identifier === 'tail').enabled === false, name);
    await page.click('[data-g=undo]');
    await page.waitForFunction(n => window.__mock.presets[window.__mock.names.indexOf(n)].prompt_order[0].order.find(o => o.identifier === 'tail').enabled === true, name);

    // 单组入口同样先预览，只列出该组。
    await page.locator('.pa-group[data-gid="a"] [data-act=gmenu]').first().click();
    await page.locator('.pa-sheet-mask:not(.pa-out) .pa-pick-item').filter({ hasText: '合并分散的 4 段' }).click();
    await dialog(page).waitFor();
    assert.equal(await dialog(page).locator('[data-gather]').count(), 1);
    await cancel(page);
    console.log(`✓ ${mobile ? '手机端' : '桌面端'}：自动识别、取消、选择性归整、完整预览、保存、一次撤销和过期预览保护`);
    await page.close();
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
