// 1.9.0：预设、世界书的选择列表不看数量一律带搜索；缝合页的条目搜索框点放大镜才出现（2.8.1）。用法同 clean-check.mjs
import { chromium } from "playwright";
import assert from "node:assert";
const exe = process.env.PW_CHROME || undefined;
const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage({ viewport: { width: 820, height: 1180 }, hasTouch: true });
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
await page.goto("http://127.0.0.1:8765/test/site/index.html");
await page.waitForFunction(() => window.__mcdonalds?.open, null, { timeout: 15000 });
await page.evaluate(() => window.__mcdonalds.open("suture"));
await page.waitForTimeout(500);
assert.equal(await page.$(".pa-src .pa-findrow:not([hidden]), .pa-src-q"), null, "缝合页的条目搜索框默认收起");
const n = await page.evaluate(() => window.SillyTavern.getContext().getPresetManager().getPresetList().preset_names.length ?? 0).catch(() => 0);
await page.click(".pa-src-pick .pa-namebtn"); await page.waitForSelector(".pa-npick-item");
assert.ok(await page.$(".pa-npick-q"), `预设列表带搜索（${n} 个预设）`);
const before = await page.$$eval(".pa-npick-item", (x) => x.length);
const first = await page.$eval(".pa-npick-item span", (x) => x.textContent);
await page.fill(".pa-npick-q", first);
const after = await page.$$eval(".pa-npick-item", (x) => x.length);
assert.ok(after >= 1 && after <= before, "搜索能筛选");
await page.click(".pa-sheet-x"); await page.waitForTimeout(250);
// 来源类型这种几个固定选项的，不带搜索
await page.click('[data-st="srctype"]'); await page.waitForSelector(".pa-npick-item");
assert.equal(await page.$(".pa-npick-q"), null, "来源类型不带搜索");
await page.click(".pa-sheet-x"); await page.waitForTimeout(250);
assert.deepEqual(errs, []);
console.log("选择列表检查全部通过");
await browser.close();
