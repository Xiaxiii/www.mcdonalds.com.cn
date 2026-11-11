// 魔棒菜单里另一个扩展也把自己的菜单项「保持在最下面」时（如同时安装焦香鸡翅），两边不能无休止地互相挪动、卡死页面。
// 先构建并在仓库根目录运行 8765 静态服务。用法：PW_CHROME=/usr/bin/chromium node test/menu-coexist-check.mjs
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const URL = process.env.PA_TEST_URL || 'http://127.0.0.1:8765/test/site/index.html';
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const errors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(URL);
  await page.waitForFunction(() => document.getElementById('mcd-menu-entry'));
  // 模拟另一个扩展：加一项，并且始终把它挪回最下面
  await page.evaluate(() => {
    const menu = document.getElementById('extensionsMenu');
    const other = document.createElement('div');
    other.id = 'other-entry';
    menu.append(other);
    new MutationObserver(() => { if (menu.lastElementChild !== other) menu.append(other); }).observe(menu, { childList: true });
    menu.append(document.createElement('div'));
  });
  const lag = await Promise.race([
    page.evaluate(() => new Promise((r) => { const t = performance.now(); setTimeout(() => r(performance.now() - t), 0); })),
    new Promise((r) => setTimeout(() => r(null), 5000))
  ]);
  assert.ok(lag !== null && lag < 500, `页面无响应（${lag}）`);
  assert.equal(await page.evaluate(() => document.getElementById('extensionsMenu').lastElementChild.id), 'other-entry');
  assert.ok(await page.evaluate(() => document.getElementById('mcd-menu-entry').isConnected));
  assert.deepEqual(errors, []);
  console.log('魔棒菜单共存检查通过');
} finally {
  await browser.close();
}
