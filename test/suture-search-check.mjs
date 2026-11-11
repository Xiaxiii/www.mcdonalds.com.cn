// 缝合页 🔍：点放大镜在栏头下方展开输入框，边打边在「从」「到」列表里筛出来（和预设页一样）；搜的词记着，✕ 清除并收起
import { chromium } from "playwright";
import assert from "node:assert";
const S = new URL("./shots/", import.meta.url).pathname;
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
await page.goto("http://127.0.0.1:8765/test/site/index.html");
await page.waitForFunction(() => window.__presetAtelier?.open, null, { timeout: 15000 });
await page.evaluate(() => window.__presetAtelier.open("suture"));
await page.waitForTimeout(600);
const ok = (m) => console.log("✓", m);
const kwOf = (t) => [...t].filter((c) => /[一-龥a-zA-Z]/.test(c)).slice(0, 2).join("");

// 来源：搜一个条目名（在折叠的组里），列表里直接筛出来并展开
const name = (await page.evaluate(() => {
  const d = window.__mock.presets[0];
  return d.prompts.find((p) => p.name && /[一-龥]{2}/.test(p.name) && !p.marker).name;
}));
const kw = kwOf(name);
const before = await page.locator(".pa-src-list .pa-row").count();
const srcQ = ".pa-qrow[data-qside=src] input", dstQ = ".pa-qrow[data-qside=dst] input";
assert.equal(await page.locator(srcQ).isVisible(), false, "搜索框默认收起");
await page.click("[data-st=srcsearch]"); await page.waitForTimeout(250);
assert.equal(await page.evaluate(() => document.activeElement?.matches(".pa-qrow[data-qside=src] input")), true, "点放大镜就能打字");
const qbox = await page.locator(".pa-qrow[data-qside=src]").boundingBox(), lbox = await page.locator(".pa-src-list").boundingBox();
assert.ok(qbox.y < lbox.y, "搜索框在列表上方");
assert.equal(await page.locator(".pa-sheet").count(), 0, "不弹底部抽屉");
await page.fill(srcQ, kw); await page.waitForTimeout(400);
assert.match(await page.locator(".pa-src-list .pa-qsum").innerText(), /匹配/, "边打边在列表里筛");
const rows = page.locator(".pa-src-list .pa-row");
assert.ok(await rows.count() >= 1 && (await rows.count()) !== before);
assert.ok(await page.locator("[data-st=srcsearch]").evaluate((x) => x.classList.contains("on")), "放大镜标出正在搜");
await rows.first().click(); await page.waitForTimeout(200);
assert.match(await page.locator(".pa-picked-n").innerText(), /已选 1 条/, "筛出来的条目直接点选");
assert.equal(await page.inputValue(srcQ), kw, "点选后搜的词还在");
await page.locator(srcQ).blur(); await page.waitForTimeout(200);
assert.equal(await page.evaluate(() => window.SillyTavern.getContext().extensionSettings.presetAtelier.sutureQuery.qSrc), kw);
await page.screenshot({ path: S + "ss-1-src.png" });
ok("来源：列表上方直接搜，点了就选，搜的词记着");

// 重开面板：词还在，搜索框展开
await page.evaluate(() => window.__presetAtelier.open("organize")); await page.evaluate(() => window.__presetAtelier.open("suture")); await page.waitForTimeout(300);
assert.equal(await page.locator(srcQ).isVisible(), true);
assert.equal(await page.inputValue(srcQ), kw);
ok("重开后搜索框和词都在");

// 目标：同样筛出来，点一条定缝合位置
await page.click("[data-st=dstsearch]"); await page.waitForTimeout(250);
await page.fill(dstQ, kw); await page.waitForTimeout(400);
const drow = page.locator(".pa-dst-list .pa-row").first();
const dn = (await drow.locator(".pa-name").innerText()).trim();
await drow.click(); await page.waitForTimeout(300);
assert.ok((await page.locator(".pa-where").innerText()).includes(dn));
await page.screenshot({ path: S + "ss-2-dst.png" });
ok("目标：列表里筛出来，点一条定缝合位置");

// ✕：清除并收起，恢复全部；再点放大镜同样收起
await page.click(".pa-qrow[data-qside=src] .pa-qx"); await page.waitForTimeout(300);
assert.equal(await page.locator(srcQ).isVisible(), false);
assert.equal(await page.locator(".pa-src-list .pa-row").count(), before, "清除后恢复原样");
assert.equal(await page.evaluate(() => window.SillyTavern.getContext().extensionSettings.presetAtelier.sutureQuery.qSrc), "");
await page.click("[data-st=dstsearch]"); await page.waitForTimeout(300);
assert.equal(await page.locator(dstQ).isVisible(), false, "再点放大镜收起");
ok("✕ 或再点放大镜：清除并收起");

assert.deepEqual(errs, []);
console.log("缝合搜索检查通过");
await browser.close();
