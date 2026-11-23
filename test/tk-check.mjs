// 2.12.6 token 数和文字大小滑杆。条目页页签行右侧显示生效条目的 token 合计，点它在每条旁显示 token 数、分组头显示组内合计；
// 数过的记在本浏览器，重开不再数；换分词模型后重数；酒馆没有分词器时不显示。设置页文字大小是七档滑杆，旧的「小 / 标准 / 大」照旧生效。
// 用法：在仓库根目录 bash test/run-browser.sh（需要 8765 端口的静态服务）
import { chromium } from "playwright";
import assert from "node:assert";
import { expandAll } from "./choose.mjs";
const S = new URL("./shots/", import.meta.url).pathname;
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
const boot = async () => {
  await page.goto("http://127.0.0.1:8765/test/site/index.html");
  await page.waitForFunction(() => window.__mcdonalds?.open, null, { timeout: 15000 });
};
await boot();
await page.evaluate(() => localStorage.removeItem("mcdonalds:tk"));
// 按酒馆的规则独立算一遍：条目自己开着、不是系统位置、正文不空；测试页的分词器按字数算
const expected = () => page.evaluate(() => {
  const live = window.__mock.live;
  const ord = (live.prompt_order.find((x) => x.character_id === 100001) || live.prompt_order[0]).order;
  let s = 0;
  for (const o of ord) {
    if (o.enabled === false) continue;
    const p = live.prompts.find((x) => x.identifier === o.identifier);
    const c = String(p?.content || "");
    if (!p || p.marker || !c.trim()) continue;
    s += [...c].length;
  }
  return s;
});
const totalText = () => page.$eval("[data-tktotal]", (b) => b.textContent);
const totalNum = async () => Number((await totalText()).replace(/[^\d]/g, ""));
const waitDone = () => page.waitForFunction(() => /^共 [\d,]+ tk$/.test(document.querySelector("[data-tktotal]")?.textContent || ""), null, { timeout: 8000 });

await page.evaluate(() => window.__mcdonalds.open("organize"));
await waitDone();
const want = await expected();
assert.ok(want > 0);
assert.strictEqual(await totalNum(), want, `合计等于生效条目正文的 token 数之和：${await totalText()} / ${want}`);
assert.strictEqual(await page.$eval("[data-tktotal]", (b) => b.getAttribute("aria-pressed")), "false");
assert.strictEqual(await page.locator(".pa-list .pa-tk").count(), 0, "默认不在每条旁显示");
const box = await page.$eval("[data-tktotal]", (b) => { const r = b.getBoundingClientRect(), t = document.querySelector(".pa-subnav").getBoundingClientRect(); return { top: r.top - t.top, bottom: t.bottom - r.bottom, right: t.right - r.right }; });
assert.ok(box.top >= 0 && box.bottom >= 0 && box.right < 24, "合计在页签行里、靠右：" + JSON.stringify(box));
console.log("✓ 页签行右侧显示生效条目的 token 合计：" + await totalText());

// 点合计：每条旁显示，分组头是组内开着的条目合计；和眼睛对齐成一列
await page.click("[data-tktotal]");
await expandAll(page);
await page.waitForTimeout(300);
assert.strictEqual(await page.$eval("[data-tktotal]", (b) => b.getAttribute("aria-pressed")), "true");
assert.strictEqual(await page.evaluate(() => window.SillyTavern.getContext().extensionSettings.mcdonalds.tkEach), true, "记住开关");
const g = await page.$eval(".pa-list .pa-group", (sec) => ({
  head: Number(sec.querySelector(":scope > .pa-ghead > .pa-tk").textContent.replace(/,/g, "")),
  rows: [...sec.querySelectorAll(".pa-row:not(.pa-off) > .pa-tk")].map((x) => Number(x.textContent.replace(/,/g, "") || 0)),
  right: [...sec.querySelectorAll(".pa-ghead > .pa-tk, .pa-row > .pa-tk")].map((x) => Math.round(x.getBoundingClientRect().right))
}));
assert.ok(g.rows.length > 0 && g.head === g.rows.reduce((a, b) => a + b, 0), "分组头的合计等于组内开着的条目之和：" + JSON.stringify(g));
assert.strictEqual(new Set(g.right).size, 1, "分组头和条目的数字右端对齐：" + g.right.join());
await page.screenshot({ path: S + "tk-1-each.png" });
console.log("✓ 点合计：每条旁显示 token 数，分组头写组内合计，数字一列对齐");

// 关掉一条：分组头、合计跟着少
const rowId = await page.locator(".pa-list .pa-group .pa-row:not(.pa-off)").first().getAttribute("data-id");
const row = page.locator(`.pa-list .pa-row[data-id="${rowId}"]`);
const one = Number((await row.locator(".pa-tk").textContent()).replace(/,/g, ""));
const before = await totalNum();
await row.locator(".pa-switch").click();
await page.waitForTimeout(250);
assert.strictEqual(await totalNum(), before - one, "关掉一条，合计少这一条");
assert.strictEqual(Number((await page.$eval(".pa-list .pa-group > .pa-ghead > .pa-tk", (x) => x.textContent)).replace(/,/g, "")), g.head - one, "分组头合计也少这一条");
await row.locator(".pa-switch").click();
await page.waitForTimeout(250);
assert.strictEqual(await totalNum(), before);
console.log("✓ 开关条目后合计、分组头就地更新");

// 再点合计收起；⋯ 菜单里也能切换
await page.click("[data-tktotal]");
await page.waitForTimeout(200);
assert.strictEqual(await page.locator(".pa-list .pa-tk").count(), 0, "再点收起");
await page.click("[data-page=organize] [data-tool=menu]");
const item = page.locator(".pa-sheet-mask:not(.pa-out) .pa-pick-item").filter({ hasText: "每条的 token 数" });
assert.strictEqual(await item.count(), 1, "⋯ 菜单里有「每条的 token 数」");
await item.click();
await page.waitForTimeout(250);
assert.ok(await page.locator(".pa-list .pa-row > .pa-tk").count() > 0, "从菜单打开");
console.log("✓ 再点合计收起；⋯ 菜单里也能切换");

// 只在条目页显示
await page.click('.pa-subnav [data-tab="books"]');
assert.ok(await page.locator("[data-tktotal]").isHidden(), "世界书页不显示");
await page.click('.pa-subnav [data-tab="organize"]');
await waitDone();
console.log("✓ 合计只在条目页");

// 重开：从本浏览器的记录读，不再数
await page.waitForTimeout(1000);
await boot();
await page.evaluate(() => window.__mcdonalds.open("organize"));
await waitDone();
assert.strictEqual(await totalNum(), want);
assert.ok(!(await page.evaluate(() => window.__tkCalls)), "重开后不再数：" + await page.evaluate(() => window.__tkCalls));
console.log("✓ 数过的记在本浏览器，重开不用重数");

// 换分词模型：重数
await page.evaluate(() => { window.SillyTavern.getContext().getTokenizerModel = () => "gpt-4o"; window.__mcdonalds.open("organize"); });
await waitDone();
assert.ok(await page.evaluate(() => window.__tkCalls) > 0, "换了分词模型后重数");
console.log("✓ 换分词模型后重数");

// 没有分词器（旧版酒馆）：不显示，菜单里也没有
await page.evaluate(() => { delete window.SillyTavern.getContext().getTokenCountAsync; window.__mcdonalds.open("organize"); });
await page.waitForTimeout(200);
assert.ok(await page.locator("[data-tktotal]").isHidden(), "没有分词器时不显示合计");
await page.click("[data-page=organize] [data-tool=menu]");
assert.strictEqual(await page.locator(".pa-sheet-mask:not(.pa-out) .pa-pick-item").filter({ hasText: "每条的 token 数" }).count(), 0);
await page.keyboard.press("Escape");
console.log("✓ 酒馆没有分词器时不显示");

// 文字大小：七档滑杆，拖动时面板立即变；旧设置「大」对应第六档
await boot();
await page.evaluate(() => window.__mcdonalds.open("more", "look"));
await page.waitForTimeout(300);
const range = page.locator('.pa-fs input[type="range"]');
assert.strictEqual(await range.inputValue(), "3", "默认第四档（标准）");
const k = () => page.evaluate(() => getComputedStyle(document.getElementById("mcd-root")).getPropertyValue("--pa-k").trim());
const fsPx = () => page.evaluate(() => parseFloat(getComputedStyle(document.getElementById("mcd-root")).fontSize));
const std = await fsPx();
await range.fill("1");
assert.strictEqual(await k(), "0.9");
assert.ok(await fsPx() < std, "调小后面板字号变小");
assert.strictEqual(await page.evaluate(() => localStorage.getItem("mcdonalds:fontSize")), "1");
assert.strictEqual(await range.getAttribute("aria-valuetext"), "90%");
assert.match(await page.$eval(".pa-fs-note", (x) => x.textContent), /^90%/);
await page.screenshot({ path: S + "tk-2-fontsize.png" });
await range.focus();
await page.keyboard.press("ArrowRight");
assert.strictEqual(await k(), "0.95", "键盘左右键一档一档调");
await page.evaluate(() => localStorage.setItem("mcdonalds:fontSize", "l"));
await boot();
await page.evaluate(() => window.__mcdonalds.open("more", "look"));
await page.waitForTimeout(300);
assert.strictEqual(await range.inputValue(), "5", "旧设置「大」是第六档");
assert.strictEqual(await k(), "1.12");
await page.evaluate(() => localStorage.removeItem("mcdonalds:fontSize"));
console.log("✓ 文字大小七档滑杆，拖动即变，旧设置照旧");

assert.deepStrictEqual(errs, []);
console.log("token 数、文字大小检查通过");
await browser.close();
