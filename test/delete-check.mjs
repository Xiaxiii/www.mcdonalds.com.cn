// 删除入口（2.12.15）：预设、世界书、正则都在搜索旁放垃圾桶，多选删除（正在用的预设不能删）；世界书条目页书名旁的垃圾桶删这一本。删前可下载备份。
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

const nextTo = (a, b) => page.evaluate(([a, b]) => { const x = document.querySelector(a).getBoundingClientRect(), y = document.querySelector(b).getBoundingClientRect(); return y.left - x.right; }, [a, b]);
const pickRows = () => page.$$eval(`${top} .pa-dm-row`, (xs) => xs.map((x) => (x.querySelector("input").disabled ? "×" : x.querySelector("input").checked ? "✓" : "·") + x.querySelector(".pa-dm-name").textContent));
const tick = (name) => page.locator(`${top} .pa-dm-row`, { hasText: name }).locator("input").check();

// 正则：行上没有垃圾桶；搜索旁的垃圾桶多选删除
await page.evaluate(() => window.__mcdonalds.open("rx"));
await page.waitForTimeout(400);
assert.strictEqual(await page.locator(".pa-rx-row .pa-del").count(), 0, "行上不再有垃圾桶");
assert.ok(await nextTo("[data-page=rx] [data-r=search]", "[data-page=rx] [data-r=delmany]") < 12, "垃圾桶紧挨搜索");
await page.screenshot({ path: S + "delete-1-rx.png" });
await page.click("[data-page=rx] [data-r=delmany]");
assert.deepStrictEqual(await pickRows(), ["·去掉多余空行", "·状态栏美化"]);
assert.ok(await page.locator(`${top} .pa-sheet-actions .pa-btn-danger`).isDisabled(), "没勾时删除不能点");
await tick("去掉多余空行");
assert.strictEqual((await page.textContent(`${top} .pa-sheet-actions .pa-btn-danger`)).trim(), "删除 1 条");
await confirm();
assert.deepStrictEqual(await page.evaluate(() => window.SillyTavern.getContext().extensionSettings.regex.map((r) => r.scriptName)), ["状态栏美化"]);
console.log("✓ 正则：搜索旁的垃圾桶，多选删除");

// 世界书：书名旁的垃圾桶仍删这一本，可先备份
await page.evaluate(() => window.__mcdonalds.open("books"));
await page.waitForTimeout(400);
assert.ok(await nextTo("[data-page=books] .pa-bk-bar [data-b=search]", "[data-page=books] .pa-bk-bar [data-b=delmany]") < 12, "列表的垃圾桶紧挨搜索");
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
const books = () => page.evaluate(async () => { const wi = await import("/test/site/scripts/world-info.js"); return [...wi.world_names]; });
assert.ok(!(await books()).includes("示例世界书"), "整本书删掉：" + (await books()).join());
assert.ok(await page.locator(".pa-bk-detail").isHidden(), "回到世界书列表");
assert.ok((await toasts()).some((t) => t.includes("已删除世界书「示例世界书」")));
// 列表上方的垃圾桶：多选
const left = await books();
await page.click("[data-page=books] .pa-bk-bar [data-b=delmany]");
assert.deepStrictEqual((await pickRows()).map((x) => x.slice(1)), left);
await page.locator(`${top} .pa-dm-all input`).check();
assert.strictEqual((await page.textContent(`${top} .pa-sheet-actions .pa-btn-danger`)).trim(), `删除 ${left.length} 本`);
await confirm();
assert.deepStrictEqual(await books(), [], "勾选的书都删掉");
console.log("✓ 世界书：书名旁删这一本；搜索旁多选删除");

// 预设：搜索旁的垃圾桶，多选；正在用的灰着不能勾
await page.evaluate(() => window.__mcdonalds.open("organize"));
await page.waitForTimeout(400);
assert.ok(await nextTo("[data-page=organize] [data-tool=search]", "[data-page=organize] [data-tool=delpreset]") < 12, "垃圾桶紧挨搜索");
await page.click("[data-page=organize] [data-tool=delpreset]");
const rows = await pickRows();
assert.ok(rows.some((x) => x.startsWith("×")), "正在用的不能勾：" + rows.join());
await tick("旧预设");
await Promise.all([page.waitForEvent("download"), page.locator(`${top} .pa-sheet-actions .pa-btn`, { hasText: "下载备份" }).click()]);
assert.deepStrictEqual((await page.evaluate(() => window.__dl)).slice(-1), ["旧预设.json"]);
await page.waitForSelector(`${top} .pa-dl-note`);
assert.deepStrictEqual((await pickRows()).filter((x) => x.startsWith("✓")), ["✓旧预设"], "下载后勾选不变");
await confirm();
assert.deepStrictEqual(deleted, ["旧预设"], "调用酒馆删除接口");
console.log("✓ 预设：搜索旁的垃圾桶，多选删除，正在用的不能删");

assert.deepStrictEqual(errs, []);
console.log("删除检查通过");
await browser.close();
