// 2.6.4 缝合页分组折叠：预设重新读取后分组编号变了（没有编号的分组每次读取都会分到新编号），
// 展开、收起的状态照旧，不会全部变成展开。先构建并在仓库根目录运行 8765 静态服务。
import { chromium } from "playwright";
import assert from "node:assert";
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
await page.goto("http://127.0.0.1:8765/test/site/index.html");
await page.waitForFunction(() => window.__mcdonalds?.open, null, { timeout: 15000 });
await page.evaluate(() => { window.SillyTavern.getContext().extensionSettings.mcdonalds = {}; window.__mcdonalds.open("suture"); });
await page.waitForTimeout(400);
const fold = (side) => page.evaluate((side) => [...document.querySelectorAll(`.pa-${side}-list .pa-group`)].map((g) => (g.classList.contains("pa-collapsed") ? "-" : "+") + g.querySelector(".pa-gname")?.textContent.trim()).join(" "), side);
// 换掉所有分组编号（模拟没有编号的分组被重新读取），并让草稿重新读取
const regenIds = () => page.evaluate(() => {
  const m = window.__mock;
  const objs = [...m.presets, m.live].filter(Boolean);
  for (const p of objs) {
    const g = p.extensions?.baibaiToolkit?.presetPromptGroups;
    if (!g) continue;
    const map = new Map(g.groups.map((x) => [x.id, "new-" + Math.random().toString(36).slice(2)]));
    for (const x of g.groups) x.id = map.get(x.id);
    for (const v of Object.values(g.prompts || {})) if (map.has(v.groupId)) v.groupId = map.get(v.groupId);
  }
  const c = window.SillyTavern.getContext();
  return c.eventSource.emit(c.eventTypes.PRESET_CHANGED, { apiId: "openai", name: m.names[0] });
});

await page.locator(".pa-src-list .pa-group").nth(1).locator(".pa-ghead").click(); await page.waitForTimeout(150);
await page.locator(".pa-dst-list .pa-group").nth(2).locator(".pa-caret").click(); await page.waitForTimeout(150);
const src0 = await fold("src"), dst0 = await fold("dst");
assert.match(src0, /^-\S+ \+/, src0);
await regenIds(); await page.waitForTimeout(500);
assert.equal(await fold("src"), src0, "来源：编号变了，展开的组仍展开，其余仍收起");
assert.equal(await fold("dst"), dst0, "目标：同上");
// 收起后再重新读取，仍是收起
await page.locator(".pa-src-list .pa-group").nth(1).locator(".pa-ghead").click(); await page.waitForTimeout(150);
await regenIds(); await page.waitForTimeout(500);
assert.ok(!(await fold("src")).includes("+"), "收起后重新读取，不会又展开");
console.log("✓ 缝合页分组折叠：预设重新读取、分组编号变化后保持原状");

// 2.6.5 折叠状态存进设置：重新打开（含重新加载酒馆）后保持最后一次的状态
const store = () => page.evaluate(() => structuredClone(window.SillyTavern.getContext().extensionSettings.mcdonalds.sutureFold || {}));
let saved = await store();
assert.ok(Object.keys(saved).some((k) => k.startsWith("dst:")), JSON.stringify(saved));
// 缝合后目标组自动展开，合上后记为合上
await page.locator(".pa-src-list .pa-group").nth(0).locator(".pa-ghead").click(); await page.waitForTimeout(150);
await page.locator(".pa-src-list .pa-group").nth(0).locator(".pa-row").first().click(); await page.waitForTimeout(100);
const tg = page.locator(".pa-dst-list .pa-group").nth(3);
await tg.locator(".pa-caret").click(); await page.waitForTimeout(150);
await tg.locator(".pa-row").last().click(); await page.waitForTimeout(150);
await tg.locator(".pa-caret").click(); await page.waitForTimeout(150);
await page.click('[data-st="go"]'); await page.waitForTimeout(500);
await page.locator(".pa-sheet-mask:not(.pa-out) .pa-sheet-actions .pa-btn-primary").click(); await page.waitForTimeout(1200);
assert.match(await fold("dst"), /\+文风设定/, "缝合后目标组展开");
await page.locator(".pa-dst-list .pa-group").nth(3).locator(".pa-caret").click(); await page.waitForTimeout(150);
saved = await store();
const dstKey = Object.keys(saved).find((k) => k.startsWith("dst:"));
assert.ok(!(saved[dstKey] || []).some((x) => x.startsWith("文风设定")), "合上后记为合上");
const dstNow = await fold("dst"), srcNow = await fold("src");

// 新页面带着这份设置打开（相当于重新加载酒馆）：和最后一次一样
const page2 = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
page2.on("pageerror", (e) => errs.push(e.message));
await page2.goto("http://127.0.0.1:8765/test/site/index.html");
await page2.waitForFunction(() => window.__mcdonalds?.open, null, { timeout: 15000 });
await page2.evaluate((saved) => { window.SillyTavern.getContext().extensionSettings.mcdonalds = { sutureFold: saved }; window.__mcdonalds.open("suture"); }, await store());
await page2.waitForTimeout(500);
const fold2 = (side) => page2.evaluate((side) => [...document.querySelectorAll(`.pa-${side}-list .pa-group`)].map((g) => (g.classList.contains("pa-collapsed") ? "-" : "+") + g.querySelector(".pa-gname")?.textContent.trim()).join(" "), side);
assert.equal(await fold2("dst"), dstNow, "重新加载后目标栏与最后一次相同");
assert.equal(await fold2("src"), srcNow, "重新加载后来源栏与最后一次相同");
console.log("✓ 折叠状态存进设置：缝合后展开的组合上后保持合上，重新加载后与最后一次相同");
assert.deepEqual(errs, []);
await browser.close();
