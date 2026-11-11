// 各种外壳的适配：面板高度按实际可见高度；网页没盖住状态栏/底部横条时不重复留安全区；页签始终在可见范围内
import { chromium } from "playwright";
import assert from "node:assert";
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const ok = (m) => console.log("✓", m);
async function run({ w, h, screenH, insetT, insetB }) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await page.addInitScript(([sw, sh]) => { Object.defineProperty(window.screen, "width", { get: () => sw }); Object.defineProperty(window.screen, "height", { get: () => sh }); }, [w, screenH]);
  await page.goto("http://127.0.0.1:8765/test/site/index.html");
  await page.waitForFunction(() => window.__presetAtelier?.open, null, { timeout: 15000 });
  // 模拟系统报告的安全区
  await page.addStyleTag({ content: `#pa-safe-probe{padding-top:${insetT}px!important;padding-bottom:${insetB}px!important}` });
  await page.evaluate(() => window.__presetAtelier.open("organize")); await page.waitForTimeout(400);
  const r = await page.evaluate(() => {
    const root = document.getElementById("pa-root"), cs = getComputedStyle(root);
    const tabs = root.querySelector(".pa-tabs").getBoundingClientRect(), top = root.querySelector(".pa-top").getBoundingClientRect();
    return { sat: cs.getPropertyValue("--pa-sat").trim(), sab: cs.getPropertyValue("--pa-sab").trim(), rootH: root.getBoundingClientRect().height, tabsBottom: tabs.bottom, topH: top.height, vh: innerHeight };
  });
  await page.close();
  return r;
}
// 1) TT 这类外壳：网页在状态栏下面、底部横条上面，系统仍报安全区 → 不再留白，页签在屏幕内
let r = await run({ w: 390, h: 763, screenH: 844, insetT: 47, insetB: 34 });
assert.equal(r.sat, "0px"); assert.equal(r.sab, "0px");
assert.ok(r.tabsBottom <= r.vh + 0.5, `页签在可见范围内 ${r.tabsBottom} <= ${r.vh}`);
assert.equal(Math.round(r.rootH), r.vh);
ok("App 内嵌网页：不重复留安全区，页签可见");
// 2) 全屏（PWA、刘海屏全面屏）：网页盖住状态栏 → 保留安全区
r = await run({ w: 390, h: 844, screenH: 844, insetT: 47, insetB: 34 });
assert.equal(r.sat, "47px"); assert.equal(r.sab, "34px");
assert.ok(r.tabsBottom <= r.vh + 0.5);
ok("全屏网页：保留安全区");
// 3) 只在状态栏下面（底部到边）：顶部不留，底部保留
r = await run({ w: 390, h: 797, screenH: 844, insetT: 47, insetB: 34 });
assert.equal(r.sat, "0px"); assert.equal(r.sab, "34px");
ok("顶部在状态栏下：只保留底部安全区");
// 3b) 普通 Safari（iPhone、iPad）：顶部是浏览器栏不报安全区，收起工具栏后底部横条要保留
r = await run({ w: 390, h: 750, screenH: 844, insetT: 0, insetB: 34 });
assert.equal(r.sat, "0px"); assert.equal(r.sab, "34px");
r = await run({ w: 820, h: 1100, screenH: 1180, insetT: 0, insetB: 20 });
assert.equal(r.sab, "20px");
ok("Safari 浏览器（iPhone、iPad）：保留底部横条位置");
// 3c) iPad 上的 App 内嵌网页
r = await run({ w: 820, h: 1136, screenH: 1180, insetT: 24, insetB: 20 });
assert.equal(r.sat, "0px"); assert.equal(r.sab, "0px");
ok("iPad App 内嵌网页：不重复留白");
// 4) 平板、电脑
r = await run({ w: 1024, h: 768, screenH: 1366, insetT: 0, insetB: 0 });
assert.ok(r.tabsBottom <= r.vh + 0.5 && Math.round(r.rootH) === r.vh);
ok("平板、电脑：高度等于可见高度");
console.log("适配检查通过");
await browser.close();
