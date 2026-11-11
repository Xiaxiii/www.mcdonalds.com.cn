// 2.8.9 拖动排序：站点编辑窗口里的密钥、站点列表（编辑状态）。触屏、鼠标拖动和方向键都能调顺序。先构建并在仓库根目录运行 8765 静态服务。
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const errors = [];
const ok = (m) => console.log('✓', m);
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://127.0.0.1:8765/test/site/index.html');
  await page.waitForFunction(() => window.__mcdonalds?.open);
  await page.evaluate(() => {
    const one = (i) => ({ id: 's' + i, name: '站点' + i, source: 'custom', url: `https://s${i}.example/v1`, model: 'm', models: [] });
    const key = (n, i) => ({ id: 'k' + i, name: n, secretId: 'x' + i, keyMask: 'sk-…' + i, models: [] });
    window.SillyTavern.getContext().extensionSettings.mcdonalds = { sites: [{ id: 'multi', name: '多组', source: 'custom', url: 'https://a.example/v1', keys: [key('A', 1), key('B', 2), key('C', 3)], keyId: 'k1' }, one(1), one(2), one(3)], activeSiteId: null };
    window.__mcdonalds.open('conn');
  });
  const settingsNow = () => page.evaluate(() => window.SillyTavern.getContext().extensionSettings.mcdonalds);
  // 手指按住把手，一路拖到目标行上沿
  const touchDrag = async (grip, toY) => {
    const b = await grip.boundingBox();
    const x = b.x + b.width / 2;
    let y = b.y + b.height / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    const dir = toY < y ? -1 : 1;
    while ((toY - y) * dir > 0) { y += dir * 8; await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] }); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(250);
  };
  await page.locator('.pa-plan-sites .pa-site-mhead .pa-srow-main').click();
  const keyNames = () => page.locator('.pa-sheet .pa-key-name').evaluateAll((xs) => xs.map((x) => x.value).join(''));
  await page.locator('.pa-sheet .pa-keyrow').first().waitFor();
  const top = (await page.locator('.pa-sheet .pa-keyrow').first().boundingBox()).y;
  await touchDrag(page.locator('.pa-sheet .pa-key-grip').nth(2), top + 4);
  assert.equal(await keyNames(), 'CAB', '拖过两行，不止挪一格');
  await page.locator('.pa-sheet .pa-key-grip').first().focus();
  await page.keyboard.press('ArrowDown');
  assert.equal(await keyNames(), 'ACB');
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('.pa-sheet .pa-key-grip')].indexOf(document.activeElement)), 1, '方向键移动后焦点跟着把手');
  await page.click('.pa-sheet-actions .pa-btn-primary');
  await page.waitForFunction(() => !document.querySelector('.pa-sheet'));
  assert.equal((await settingsNow()).sites[0].keys.map((k) => k.name).join(''), 'ACB');
  ok('站点编辑窗口：密钥可触屏拖动、方向键调整顺序，保存后生效');

  assert.equal(await page.locator('.pa-plan-sites .pa-site-grip').count(), 0, '平时不显示把手');
  await page.click('[data-a="sitesedit"]');
  const t0 = (await page.locator('.pa-plan-sites .pa-site').first().boundingBox()).y;
  await touchDrag(page.locator('.pa-plan-sites .pa-site-grip').nth(3), t0 + 4);
  assert.equal((await settingsNow()).sites.map((s) => s.name).join(','), '站点3,多组,站点1,站点2');
  assert.equal(await page.locator('.pa-sheet').count(), 0, '拖动把手不打开编辑窗口');
  await page.locator('.pa-plan-sites .pa-site-grip').first().focus();
  await page.keyboard.press('ArrowDown');
  assert.equal((await settingsNow()).sites.map((s) => s.name).join(','), '多组,站点3,站点1,站点2');
  ok('站点列表：编辑状态下可拖动、方向键调整顺序');

  // 鼠标拖动
  const mp = await browser.newPage({ viewport: { width: 1000, height: 900 } });
  mp.on('pageerror', (e) => errors.push(e.message));
  await mp.goto('http://127.0.0.1:8765/test/site/index.html');
  await mp.waitForFunction(() => window.__mcdonalds?.open);
  await mp.evaluate(() => {
    const key = (n, i) => ({ id: 'k' + i, name: n, secretId: 'x' + i, keyMask: 'sk-…' + i, models: [] });
    window.SillyTavern.getContext().extensionSettings.mcdonalds = { sites: [{ id: 'multi', name: '多组', source: 'custom', url: 'https://a.example/v1', keys: [key('A', 1), key('B', 2), key('C', 3)], keyId: 'k1' }], activeSiteId: null };
    window.__mcdonalds.open('conn');
  });
  await mp.locator('.pa-plan-sites .pa-site-mhead .pa-srow-main').click();
  await mp.locator('.pa-sheet .pa-keyrow').first().waitFor();
  const g = await mp.locator('.pa-sheet .pa-key-grip').nth(2).boundingBox();
  const r0 = await mp.locator('.pa-sheet .pa-keyrow').first().boundingBox();
  await mp.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await mp.mouse.down();
  for (let y = g.y + g.height / 2; y > r0.y; y -= 6) await mp.mouse.move(g.x + g.width / 2, y);
  await mp.mouse.up();
  assert.equal(await mp.locator('.pa-sheet .pa-key-name').evaluateAll((xs) => xs.map((x) => x.value).join('')), 'CAB');
  ok('鼠标拖动密钥');
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
