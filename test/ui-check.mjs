// 整理页（点行选中 → 移动 → 点位置）、思维链页、API 站点换模型、缝合位置标记。
// 用合成的「众生相风格」预设，干净环境可跑。用法同 clean-check.mjs
import { chromium } from "playwright";
import assert from "node:assert";
import { expandAll } from "./choose.mjs";
const exe = process.env.PW_CHROME || undefined;
const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage({ viewport: { width: 1024, height: 1366 }, hasTouch: true });
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
await page.goto("http://127.0.0.1:8765/test/site/index.html");
await page.waitForFunction(() => window.__mcdonalds?.open, null, { timeout: 15000 });
await page.evaluate(() => {
  document.body.insertAdjacentHTML("beforeend", '<select id="model_custom_select"><option value="claude-opus">claude-opus</option><option value="claude-sonnet">claude-sonnet</option></select><input id="custom_model_id">');
  const s = window.SillyTavern.getContext().extensionSettings;
  s.mcdonalds = { sites: [{ id: "s1", name: "中转A", source: "custom", url: "https://example.com/v1", model: "claude-x", models: [], keyMask: "sk-…L3a" }], activeSiteId: "s1" };
  window.__mcdonalds.open("organize");
});
await page.waitForTimeout(400);
await expandAll(page); await page.waitForTimeout(200);
const names = () => page.evaluate(() => [...document.querySelectorAll(".pa-list .pa-row .pa-name")].map((x) => x.textContent.trim()));

// 1) 整理：点两行选中，移动到第 6 行之后
const before = await names();
await page.locator(".pa-list .pa-row").nth(1).click();
await page.locator(".pa-list .pa-row").nth(2).click();
assert.match(await page.$eval(".pa-selcount", (x) => x.textContent), /已选 2 条/);
await page.click('[data-sel="moveto"]'); await page.waitForTimeout(200);
const target = before[6];
await page.locator(".pa-list .pa-row").nth(6).click(); await page.waitForTimeout(300);
const after = await names();
const ti = after.indexOf(target);
assert.deepEqual(after.slice(ti + 1, ti + 3), [before[1], before[2]], "移到目标条目之后");
console.log("✓ 选中两条并移到指定位置");

// 2) 思维链页能打开，有手动指定入口
await page.click('.pa-tabs [data-nav="check"]'); await page.click('[data-tab="cot"]'); await page.waitForTimeout(400);
assert.ok(await page.$(".pa-cot .pa-verdict-top"));
assert.equal(await page.locator("[data-markpick]").count(), 1);
console.log("✓ 思维链页");

// 3) API：当前连接换模型（带搜索的列表），站点记录跟着改
await page.click('.pa-tabs [data-nav="conn"]'); await page.waitForTimeout(300);
await page.click('[data-a="livemodel"]'); await page.waitForTimeout(200);
await page.click('.pa-mpick-item >> text=claude-sonnet'); await page.waitForTimeout(300);
const m = await page.evaluate(() => [document.getElementById("custom_model_id").value, window.SillyTavern.getContext().extensionSettings.mcdonalds.sites[0].model]);
assert.deepEqual(m, ["claude-sonnet", "claude-sonnet"]);
console.log("✓ 当前连接换模型");

// 4) 缝合位置：点展开的组里的条目＝放进组里，它的后面
await page.evaluate(() => window.__mcdonalds.open("suture")); await page.waitForTimeout(300);
const g = page.locator(".pa-dst-list .pa-group").nth(1);
await g.locator(".pa-caret").click(); await page.waitForTimeout(150);
const rowName = (await g.locator(".pa-row .pa-name").first().textContent()).trim();
await g.locator(".pa-row").first().click(); await page.waitForTimeout(150);
const where = await page.$eval(".pa-where", (x) => x.textContent);
assert.ok(where.includes("组内") && where.includes(rowName), where);
console.log("✓ 缝合位置：", where);

assert.deepEqual(errs, []);
console.log("界面检查全部通过");
await browser.close();
