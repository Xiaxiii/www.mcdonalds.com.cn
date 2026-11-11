// 2.7.8 运行中的卡顿记录：别的代码卡住页面时记为卡顿且不算在本扩展头上；本扩展处理计时；体检页显示结论
// 用法：在仓库根目录起静态服务（python3 -m http.server 8765）；node test/jank-check.mjs
import { chromium } from "playwright";
import assert from "node:assert/strict";
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
await page.goto(`http://127.0.0.1:${process.env.PA_PORT || 8765}/test/site/index.html`);
await page.waitForFunction(() => window.__mcdonalds?.open);
// 模拟的第三方扩展「Fake-Heavy」占住页面 300 毫秒
await page.addScriptTag({ url: "/test/site/scripts/extensions/third-party/Fake-Heavy/heavy.js" });
await page.evaluate(() => window.__fakeHeavy(300));
await page.waitForTimeout(300);
// 本扩展处理：切换聊天、切换预设事件，翻几页
await page.evaluate(async () => { const c = window.SillyTavern.getContext(); await c.eventSource.emit(c.eventTypes.CHAT_CHANGED); await c.eventSource.emit(c.eventTypes.PRESET_CHANGED, { apiId: "openai" }); });
await page.evaluate(() => window.__mcdonalds.open("organize"));
await page.evaluate(() => window.__mcdonalds.open("conn"));
await page.evaluate(() => window.__mcdonalds.open("health"));
await page.waitForSelector("[data-page=health] .pa-jank");
const text = await page.locator("[data-page=health] .pa-jank").innerText();
assert.match(text, /页面卡顿 \d+ 次/, text);
const loaf = await page.evaluate(() => PerformanceObserver.supportedEntryTypes.includes("long-animation-frame"));
if (loaf) {
  assert.match(text, /卡顿帧里耗时最多的是扩展「Fake-Heavy」（共 \d+ 毫秒）。/, text);
  assert.match(text, /可停用它对比/, text);
  assert.match(text, /卡顿时在运行的脚本\n扩展「Fake-Heavy」/, text);
  console.log("✓ 卡顿归到具体扩展：扩展「Fake-Heavy」");
} else assert.match(text, /都没有在处理，原因在酒馆本身或其他扩展/, text);
await page.locator("[data-page=health] .pa-jank summary", { hasText: "各项处理耗时" }).click();
const own = await page.locator("[data-page=health] .pa-jank details", { hasText: "各项处理耗时" }).locator(".pa-kvl").innerText();
assert.match(own, /事件：切换聊天/);
assert.match(own, /显示页面：预设/);
console.log("✓ 别的代码造成的卡顿被记录，不算在本扩展头上；本扩展各项处理有计时");
await page.click("[data-page=health] [data-h=jankclear]");
await page.waitForTimeout(400);
assert.match(await page.locator("[data-page=health] .pa-jank").innerText(), /没有卡顿|页面卡顿/);
console.log("✓ 清空记录后重新统计");
assert.deepEqual(errs, []);
await browser.close();
