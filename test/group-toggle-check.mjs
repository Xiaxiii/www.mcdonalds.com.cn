import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import fixture from './fixtures/group-toggle.cjs';
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const errors = [], title = '独立分组开关合成测试';
const saved = page => page.evaluate(n => structuredClone(window.__mock.presets[window.__mock.names.indexOf(n)]), title);
const states = p => p.prompt_order[0].order.map(o => [o.identifier, o.enabled]);
const group = (page, id) => page.locator(`[data-page=organize] .pa-group[data-gid="${id}"]`);
async function choosePreset(page, name) {
  const slot = page.locator('[data-page=organize] .pa-picker-slot');
  if (await slot.locator('select').count()) {
    await slot.locator('select').selectOption(name);
  } else {
    await slot.locator('.pa-namebtn').click();
    await page.waitForSelector('.pa-npick-item');
    assert.equal(await page.evaluate(name => {
      const item = [...document.querySelectorAll('.pa-npick-item')].find(x => x.dataset.v === name);
      if (item) item.click();
      return !!item;
    }, name), true);
  }
}
async function waitGroup(page, id, on) {
  await page.waitForFunction(({ title, id, on }) => {
    const m = window.__mock, p = m.presets[m.names.indexOf(title)];
    return p.extensions.baibaiToolkit.presetPromptGroups.groups.find(g => g.id === id).enabled === on;
  }, { title, id, on });
}
async function toggleGroup(page, id, on) {
  await group(page, id).locator('.pa-switch-s').click();
  assert.equal(await group(page, id).locator('[data-act=gtoggle]').isChecked(), on);
  await waitGroup(page, id, on);
}
try {
  for (const mobile of [true, false]) for (const gateSupported of [false, true]) {
    const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1100, height: 900 }, hasTouch: mobile, isMobile: mobile });
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://127.0.0.1:8765/test/site/index.html');
    await page.waitForFunction(() => window.__mcdonalds?.open);
    const original = fixture();
    await page.evaluate(({ title, preset, gateSupported }) => {
      const m = window.__mock; m.names.push(title); m.presets.push(preset);
      m.live.preset_settings_openai = title; Object.assign(m.live, structuredClone(preset));
      if (gateSupported) window.__baiBaiToolkitExtensionInstalled = {};
      window.__mcdonalds.open('organize');
    }, { title, preset: original, gateSupported });
    await choosePreset(page, title);
    const theater = group(page, 'theater'), extras = group(page, 'extras');
    assert.equal(await theater.locator('.pa-count').innerText(), '1/3');
    assert.equal(await extras.locator('.pa-count').innerText(), '0/2');
    assert.equal(await extras.locator('[data-act=gtoggle]').isChecked(), true, '内部全关不改变分组开关');
    await toggleGroup(page, 'theater', false);
    assert.deepEqual(states(await saved(page)), states(original));
    assert.equal(await theater.locator('.pa-count').innerText(), '1/3');
    assert.deepEqual(await theater.locator('.pa-row [data-act=toggle]').evaluateAll(xs => xs.map(x => x.checked)), [true, false, false]);
    if (mobile && gateSupported) await theater.screenshot({ path: new URL('./shots/group-toggle-phone.png', import.meta.url).pathname });

    // 关闭分组期间仍可调整自己的独立选项，再开启不会覆盖。
    for (const id of ['night', 'day']) await theater.locator(`[data-id="${id}"] .pa-switch`).click();
    await page.waitForFunction(n => {
      const m = window.__mock, os = m.presets[m.names.indexOf(n)].prompt_order[0].order;
      return os.find(o => o.identifier === 'night').enabled === false && os.find(o => o.identifier === 'day').enabled === true;
    }, title);
    const chosen = states(await saved(page));
    await toggleGroup(page, 'theater', true);
    assert.deepEqual(states(await saved(page)), chosen);
    assert.equal(await theater.locator('.pa-count').innerText(), '1/3');
    await page.click('[data-g=undo]'); await waitGroup(page, 'theater', false);
    assert.deepEqual(states(await saved(page)), chosen, '撤销分组切换也不改成员');
    for (const on of [false, true]) {
      await toggleGroup(page, 'extras', on);
      assert.deepEqual(states(await saved(page)), chosen, '全关条目不会被一起打开');
      assert.equal(await extras.locator('.pa-count').innerText(), '0/2');
    }
    assert.deepEqual((await saved(page)).prompts, original.prompts);
    assert.equal(await theater.evaluate(e => e.scrollWidth > e.clientWidth + 2), false);

    // 2.5.0 分组菜单「组内全部开启 / 关闭」：改组内每一条，再撤销回去
    await extras.locator('[data-act=gmenu]').click();
    await page.locator('.pa-sheet-mask:not(.pa-out) .pa-pick-item', { hasText: '组内全部开启' }).click();
    for (let i = 0; i < 25 && (await extras.locator('.pa-count').innerText()) !== '2/2'; i++) await page.waitForTimeout(200);
    assert.equal(await extras.locator('.pa-count').innerText(), '2/2', '组内全部开启');
    await extras.locator('[data-act=gmenu]').click();
    await page.locator('.pa-sheet-mask:not(.pa-out) .pa-pick-item', { hasText: '组内全部关闭' }).click();
    for (let i = 0; i < 25 && (await extras.locator('.pa-count').innerText()) !== '0/2'; i++) await page.waitForTimeout(200);
    assert.equal(await extras.locator('.pa-count').innerText(), '0/2', '组内全部关闭');
    // 等自动保存写回，后面套用方案时才不会问「有未保存的修改」
    for (let i = 0; i < 30 && JSON.stringify(states(await saved(page))) !== JSON.stringify(chosen); i++) await page.waitForTimeout(200);
    assert.deepEqual(states(await saved(page)), chosen, '全部关闭后回到原来的开关');
    for (let i = 0; i < 30 && await page.locator('.pa-savebar [data-g="confirm"]').isVisible(); i++) await page.waitForTimeout(200);

    // 旧方案仅记录分组状态时，也不能暗中全开未记录的条目。
    await page.evaluate(title => {
      const c = window.SillyTavern.getContext();
      c.extensionSettings.mcdonalds.schemes.push({ id: 'parent-only', name: '只切换分组', preset: title, scope: 'all', states: {}, groupStates: { theater: true } });
      window.__mcdonalds.open('more', 'schemes');
    }, title);
    for (const h of await page.locator('.pa-plan-schemes .pa-sgroup:not(.open) .pa-sghead').all()) await h.click();
    await page.locator('[data-id="parent-only"] [data-a=apply]').click();
    await waitGroup(page, 'theater', true);
    assert.deepEqual(states(await saved(page)), chosen);
    assert.deepEqual((await saved(page)).prompts, original.prompts);
    console.log(`✓ ${mobile ? '手机' : '桌面'} / ${gateSupported ? '有分组过滤宿主标记' : '无分组过滤宿主标记'}：混合/全关选择、关闭期间单项调整、保存、撤销及仅分组方案均不联动`);
    await page.close();
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
