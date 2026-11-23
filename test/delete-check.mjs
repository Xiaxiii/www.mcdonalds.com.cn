// 2.12.12 删除入口：世界书条目页书名旁的垃圾桶删整本书；正则每行的垃圾桶；条目页「⋯ → 删除这个预设…」（正在用的不能删）。删整本书、整个预设前可下载备份。
// 用法：在仓库根目录 bash test/run-browser.sh
import { chromium } from "playwright";
import assert from "node:assert";
const S = new URL("./shots/", import.meta.url).pathname;
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
const deleted = [];
await page.route("**/api/presets/delete", async (r) => { deleted.push(JSON.parse(r.request().postData()).name); await r.fulfill({ status: 200, body: "{}" }); });
await page.goto("http://127.0.0.1:8765/test/site/index.html");
await page.waitForFunction(() => window.__mcdonalds?.open, null, { timeout: 15000 });
const top = ".pa-sheet-mask:not(.pa-out)";
await page.evaluate(() => {
  window.__toasts = [];
  // 无头 Chromium 会把中文文件名换成「download」，这里记下请求的文件名
  window.__dl = []; const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { if (this.download) window.__dl.push(this.download); return click.call(this); };
  window.toastr = Object.fromEntries(["success", "info", "warning", "error"].map((k) => [k, (m) => { window.__toasts.push(`${k}:${m}`); return { on() {} }; }]));
  // 和酒馆一样：预设名称表是同一个对象（测试页默认每次按名字数组重新生成）
  const m = window.__mock, ctx = window.SillyTavern.getContext(), pm0 = ctx.getPresetManager();
  const P = (id, name) => ({ identifier: id, name, content: "正文", role: "system" });
  m.names.push("旧预设"); m.presets.push({ prompts: [P("a", "开头")], prompt_order: [{ character_id: 100001, order: [{ identifier: "a", enabled: true }] }] });
  const pn = Object.fromEntries(m.names.map((n, i) => [n, i]));
  ctx.getPresetManager = () => ({ ...pm0, getPresetList: () => ({ presets: m.presets, preset_names: pn }) });
  ctx.extensionSettings.regex = [{ id: "g1", scriptName: "去掉多余空行", findRegex: "/\\n{3,}/g", replaceString: "\\n\\n", placement: [2], disabled: false }, { id: "g2", scriptName: "状态栏美化", findRegex: "/<status>/g", replaceString: "", placement: [2], disabled: false }];
});
const toasts = () => page.evaluate(() => window.__toasts);
// 红色「删除」按钮：红底，字看得见（2.12.12 以前被后面的 .pa-btn 样式盖成浅底白字）
const dangerVisible = () => page.evaluate((top) => { const b = document.querySelector(`${top} .pa-btn-danger`), c = getComputedStyle(b); return c.backgroundColor !== c.color && c.backgroundColor === getComputedStyle(b.closest(".pa-sheet-mask") || b).getPropertyValue("--pa-warn").trim().replace(/^#(..)(..)(..)$/, (_, r, g, b) => `rgb(${parseInt(r, 16)}, ${parseInt(g, 16)}, ${parseInt(b, 16)})`); }, top);
const confirm = async () => { await page.waitForSelector(`${top} .pa-sheet-actions`); assert.ok(await dangerVisible(), "删除按钮红底可见"); await page.locator(`${top} .pa-sheet-actions .pa-btn`, { hasText: "删除" }).click(); await page.waitForTimeout(400); };

// 正则：每行一个垃圾桶，确认后删掉这一条
await page.evaluate(() => window.__mcdonalds.open("rx"));
await page.waitForTimeout(400);
assert.strictEqual(await page.locator(".pa-rx-row .pa-del").count(), 2, "每条正则一个垃圾桶");
await page.screenshot({ path: S + "delete-1-rx.png" });
await page.locator(".pa-rx-row", { hasText: "去掉多余空行" }).locator(".pa-del").click();
assert.match(await page.textContent(`${top} .pa-p`), /删除「去掉多余空行」/);
await confirm();
assert.deepStrictEqual(await page.evaluate(() => window.SillyTavern.getContext().extensionSettings.regex.map((r) => r.scriptName)), ["状态栏美化"]);
console.log("✓ 正则：行上的垃圾桶，确认后删除");

// 世界书：书名旁的垃圾桶删整本书，先备份
await page.evaluate(() => window.__mcdonalds.open("books"));
await page.waitForTimeout(400);
await page.locator('.pa-bk-row[data-book="示例世界书"] .pa-peek').click();
await page.waitForTimeout(400);
const pos = await page.evaluate(() => { const r = (s) => document.querySelector(s).getBoundingClientRect(); return { pen: r(".pa-bk-rename").right, del: r(".pa-bk-dhead .pa-del").left, search: r('.pa-bk-dhead [data-e="search"]').left }; });
assert.ok(pos.del - pos.pen < 12 && pos.search - pos.del > 40, "垃圾桶挨着铅笔，和搜索分开：" + JSON.stringify(pos));
await page.screenshot({ path: S + "delete-2-book.png" });
await page.click('.pa-bk-dhead [data-e="delbook"]');
await page.waitForSelector(`${top} .pa-sheet-actions`);
await Promise.all([page.waitForEvent("download"), page.locator(`${top} .pa-sheet-actions .pa-btn`, { hasText: "下载备份" }).click()]);
assert.deepStrictEqual(await page.evaluate(() => window.__dl), ["示例世界书.json"], "文件名就是书名，可直接导入");
await page.waitForSelector(`${top} .pa-dl-note`);
await confirm();
const wb = await page.evaluate(async () => { const wi = await import("/test/site/scripts/world-info.js"); return [...wi.world_names]; });
assert.ok(!wb.includes("示例世界书"), "整本书删掉：" + wb.join());
assert.ok(await page.locator(".pa-bk-detail").isHidden(), "回到世界书列表");
assert.ok((await toasts()).some((t) => t.includes("已删除世界书「示例世界书」")));
console.log("✓ 世界书：书名旁的垃圾桶删整本书，可先下载");

// 预设：⋯ 菜单里的删除；正在用的不能删
await page.evaluate(() => window.__mcdonalds.open("organize"));
await page.waitForTimeout(400);
await page.click("[data-page=organize] [data-tool=menu]");
await page.locator(`${top} .pa-pick-item.pa-pick-danger`, { hasText: "删除这个预设" }).click();
await page.waitForTimeout(300);
assert.ok((await toasts()).some((t) => t.includes("正在用的预设不能删")), "正在用的不能删");
await page.click("[data-page=organize] .pa-picker-slot .pa-namebtn");
await page.evaluate(() => [...document.querySelectorAll(".pa-npick-item")].find((x) => x.dataset.v === "旧预设").click());
await page.waitForTimeout(300);
await page.click("[data-page=organize] [data-tool=menu]");
await page.locator(`${top} .pa-pick-item.pa-pick-danger`, { hasText: "删除这个预设" }).click();
assert.match(await page.textContent(`${top} .pa-p`), /删除「旧预设」/);
await Promise.all([page.waitForEvent("download"), page.locator(`${top} .pa-sheet-actions .pa-btn`, { hasText: "下载备份" }).click()]);
assert.deepStrictEqual((await page.evaluate(() => window.__dl)).slice(-1), ["旧预设.json"]);
await confirm();
assert.deepStrictEqual(deleted, ["旧预设"], "调用酒馆删除接口");
assert.ok(!(await page.textContent("[data-page=organize] .pa-picker-slot")).includes("旧预设"), "删完回到正在用的预设");
console.log("✓ 预设：⋯ 菜单删除，正在用的不能删");

assert.deepStrictEqual(errs, []);
console.log("删除检查通过");
await browser.close();
