// 2.6.8 整理页分组折叠记住最后一次的状态：预设里存的是展开的组，合上后重新打开、预设重新读取（分组编号变化）都保持合上；
// 没动过的组按预设里存的状态。先构建并在仓库根目录运行 8765 静态服务。
import { chromium } from "playwright";
import assert from "node:assert";
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const errs = [];
async function openPage(saved) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto("http://127.0.0.1:8765/test/site/index.html");
  await page.waitForFunction(() => window.__mcdonalds?.open, null, { timeout: 15000 });
  await page.evaluate((saved) => {
    // 预设里「写作指导」存的是展开
    const m = window.__mock;
    for (const p of [...m.presets, m.live].filter(Boolean)) for (const g of p.extensions?.baibaiToolkit?.presetPromptGroups?.groups || []) g.collapsed = g.name !== "写作指导";
    window.SillyTavern.getContext().extensionSettings.mcdonalds = saved ? structuredClone(saved) : {};
    window.__mcdonalds.open("organize");
  }, saved);
  await page.waitForTimeout(500);
  return page;
}
const fold = (page) => page.evaluate(() => [...document.querySelectorAll(".pa-list .pa-group")].map((g) => (g.classList.contains("pa-collapsed") ? "-" : "+") + g.querySelector(".pa-gname")?.textContent.trim()).join(" "));
const head = (page, name) => page.locator(".pa-list .pa-group", { hasText: name }).first().locator(".pa-ghead .pa-gname");

let page = await openPage(null);
assert.match(await fold(page), /\+写作指导/, "没动过时按预设里存的状态");
await head(page, "写作指导").click(); await page.waitForTimeout(150);
await head(page, "正文规则").click(); await page.waitForTimeout(150);
const f1 = await fold(page);
assert.match(f1, /-写作指导/); assert.match(f1, /\+正文规则/);
// 预设重新读取、分组编号变化
await page.evaluate(() => {
  const m = window.__mock;
  for (const p of [...m.presets, m.live].filter(Boolean)) {
    const g = p.extensions?.baibaiToolkit?.presetPromptGroups;
    if (!g) continue;
    const map = new Map(g.groups.map((x) => [x.id, "new-" + Math.random().toString(36).slice(2)]));
    for (const x of g.groups) x.id = map.get(x.id);
    for (const v of Object.values(g.prompts || {})) if (map.has(v.groupId)) v.groupId = map.get(v.groupId);
  }
  const c = window.SillyTavern.getContext();
  return c.eventSource.emit(c.eventTypes.PRESET_CHANGED, { apiId: "openai", name: m.names[0] });
});
await page.waitForTimeout(500);
assert.equal(await fold(page), f1, "分组编号变化后保持");
const saved = await page.evaluate(() => structuredClone(window.SillyTavern.getContext().extensionSettings.mcdonalds));
await page.close();

// 重新打开（相当于重新加载酒馆）：预设里「写作指导」仍存为展开，但以最后一次操作为准
page = await openPage(saved);
assert.equal(await fold(page), f1, "重新打开后与最后一次相同");
console.log("✓ 整理页分组折叠：合上后重新打开、分组编号变化都保持最后一次的状态");
await page.close();
assert.deepEqual(errs, []);
await browser.close();
