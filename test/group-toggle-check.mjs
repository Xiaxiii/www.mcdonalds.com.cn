import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
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
// 2.12.20 分组总开关是一个按钮：点任意位置循环（自定义 → 全开 → 全关 → 自定义），不再按左 / 中 / 右分区
const tri = (page, id) => group(page, id).locator('.pa-tri[data-act=gtoggle]');
const triText = (page, id) => tri(page, id).locator('.pa-tri-n').innerText();
async function clickTri(page, id, expect) {
  const t = tri(page, id), box = await t.boundingBox();
  await page.mouse.click(box.x + box.width * (0.15 + Math.random() * 0.7), box.y + box.height / 2);
  if (expect) assert.equal(await t.getAttribute('data-state'), expect, `点后应为 ${expect}`);
}
const headX = (page, id) => group(page, id).evaluate((g) => {
  const h = g.querySelector(':scope > .pa-ghead'), x = (s) => h.querySelector(s)?.getBoundingClientRect().left ?? null;
  return { menu: x('[data-act=gmenu]'), gtk: x('.pa-gtk'), tri: x('.pa-tri') };
});
async function waitStates(page, want) {
  for (let i = 0; i < 30 && JSON.stringify(states(await saved(page))) !== JSON.stringify(want); i++) await page.waitForTimeout(150);
  assert.deepEqual(states(await saved(page)), want);
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
    assert.equal(await theater.locator('.pa-ghead .pa-count').count(), 0, '组名旁不再重复 n/N');
    assert.equal(await page.locator('[data-page=organize] .pa-tri-dots, [data-page=organize] .pa-tri-thumb').count(), 0, '旧三点滑块已删');
    assert.equal(await tri(page, 'theater').evaluate(t => t.tagName === 'BUTTON' && !t.hasAttribute('role') && t.querySelector('svg').getAttribute('width') === '16'), true, '原生按钮 + 16px 进度环');
    assert.equal(await triText(page, 'theater'), '1/3');
    assert.equal(await triText(page, 'extras'), '0/2');
    assert.equal(await tri(page, 'theater').getAttribute('data-state'), 'mid', '部分开启为自定义');
    assert.equal(await tri(page, 'extras').getAttribute('data-state'), 'mid', '内部全关不改变分组总开关为全关');
    assert.match(await tri(page, 'theater').getAttribute('aria-label'), /分组「小剧场」总开关，当前已开 1\/3/);
    const x0 = await headX(page, 'theater');
    // 自定义 → 全开 → 全关 → 自定义：回到原来的开关
    await clickTri(page, 'theater', 'all');
    assert.equal(await triText(page, 'theater'), '3/3');
    const x1 = await headX(page, 'theater');
    assert.ok(Math.abs(x1.menu - x0.menu) <= 1 && Math.abs(x1.tri - x0.tri) <= 1 && (x0.gtk == null || Math.abs(x1.gtk - x0.gtk) <= 1), '1/3 → 3/3 左边的 ⋯、合计不移动：' + JSON.stringify([x0, x1]));
    await clickTri(page, 'theater', 'off');
    assert.equal(await theater.evaluate(e => e.classList.contains('pa-goff')), true, '全关时分组整体降噪');
    assert.equal(await triText(page, 'theater'), '0/3');
    await waitGroup(page, 'theater', false);
    await clickTri(page, 'theater', 'mid');
    await waitGroup(page, 'theater', true);
    assert.equal(await triText(page, 'theater'), '1/3');
    await waitStates(page, states(original));
    assert.deepEqual(await theater.locator('.pa-row [data-act=toggle]').evaluateAll(xs => xs.map(x => x.checked)), [true, false, false], '回到自定义时还原原来的开关');
    if (mobile && gateSupported) await theater.screenshot({ path: fileURLToPath(new URL('./shots/group-toggle-phone.png', import.meta.url)) });

    // 关闭分组期间仍可调整自己的独立选项，再打开（回到自定义）不会覆盖
    await clickTri(page, 'theater', 'all');
    await clickTri(page, 'theater', 'off');
    await waitGroup(page, 'theater', false);
    for (const id of ['night', 'random']) await theater.locator(`[data-id="${id}"] .pa-switch`).click();
    await page.waitForFunction(n => {
      const m = window.__mock, os = m.presets[m.names.indexOf(n)].prompt_order[0].order;
      return os.find(o => o.identifier === 'night').enabled === false && os.find(o => o.identifier === 'random').enabled === false;
    }, title);
    const chosen = states(await saved(page));
    // 键盘：原生按钮，回车也循环
    await tri(page, 'theater').focus();
    await page.keyboard.press('Enter');
    assert.equal(await tri(page, 'theater').getAttribute('data-state'), 'mid');
    await waitGroup(page, 'theater', true);
    assert.deepEqual(states(await saved(page)), chosen);
    assert.equal(await triText(page, 'theater'), '1/3');
    await page.click('[data-g=undo]'); await waitGroup(page, 'theater', false);
    assert.deepEqual(states(await saved(page)), chosen, '撤销分组切换也不改成员');

    // 额外模块（0/2）：全开 → 全关 → 自定义，回到全关的条目
    await clickTri(page, 'extras', 'all');
    assert.equal(await triText(page, 'extras'), '2/2', '全开');
    await clickTri(page, 'extras', 'off');
    await clickTri(page, 'extras', 'mid');
    assert.equal(await triText(page, 'extras'), '0/2', '回到自定义还原快照');
    await waitStates(page, chosen);
    assert.deepEqual((await saved(page)).prompts, original.prompts);
    assert.equal(await theater.evaluate(e => e.scrollWidth > e.clientWidth + 2), false);

    // 分组 ⋯ 菜单不再有重复的「组内全部开启/关闭」与上下移
    await extras.locator('[data-act=gmenu]').click();
    const menuTexts = await page.locator('.pa-sheet-mask:not(.pa-out) .pa-pick-item').allInnerTexts();
    assert.equal(menuTexts.some(t => /组内全部|上移一位|下移一位/.test(t)), false, '分组菜单已移除冗余项：' + menuTexts.join(','));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    // 等自动保存写回，后面套用方案时才不会问「有未保存的修改」
    for (let i = 0; i < 30 && (await page.locator('.pa-dirty-text').textContent()) !== '已自动保存'; i++) await page.waitForTimeout(200);

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
    console.log(`✓ ${mobile ? '手机' : '桌面'} / ${gateSupported ? '有分组过滤宿主标记' : '无分组过滤宿主标记'}：进度环胶囊点按循环（自定义 → 全开 → 全关 → 自定义）、关闭期间单项调整、保存、撤销及仅分组方案均不联动`);
    await page.close();
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
