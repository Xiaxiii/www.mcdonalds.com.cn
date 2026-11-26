// 删除入口（2.12.15）：预设、世界书、正则都在搜索旁放垃圾桶，多选删除（正在用的预设不能删）；世界书条目页书名旁的垃圾桶删这一本。删前可下载备份。
// 用法：在仓库根目录 bash test/run-browser.sh
import { chromium } from "playwright";
import assert from "node:assert";
import { fileURLToPath } from "node:url";
const S = fileURLToPath(new URL("./shots/", import.meta.url));
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

// 正则：原地多选删除模式（留在列表页、底部出现全选、删除栏，不自动展开搜索）
await page.evaluate(() => window.__mcdonalds.open("rx"));
await page.waitForTimeout(400);
assert.strictEqual(await page.locator(".pa-rx-row .pa-del").count(), 0, "行上不再有垃圾桶");
assert.ok(await nextTo("[data-page=rx] [data-r=search]", "[data-page=rx] [data-r=delmany]") < 12, "垃圾桶紧挨搜索");
await page.screenshot({ path: S + "delete-1-rx.png" });
await page.click("[data-page=rx] [data-r=delmany]");
await page.waitForSelector("[data-page=rx] .pa-rx-delbar:not([hidden])");
assert.strictEqual(await page.locator(".pa-sheet-mask:not(.pa-out)").count(), 0, "正则多选删除不再弹出底部抽屉");
assert.ok(await page.locator("[data-page=rx] .pa-findrow").isHidden(), "进多选删除不自动展开搜索框（列表不往下跳）");
assert.ok(await page.locator("[data-page=rx] [data-rd=confirm]").isDisabled(), "没勾时删除不能点");
await page.locator(".pa-rx-row", { hasText: "去掉多余空行" }).click();
assert.strictEqual((await page.textContent("[data-page=rx] [data-rd=confirm]")).trim(), "删除 1 条");
await page.click("[data-page=rx] [data-rd=confirm]");
await confirm();
assert.deepStrictEqual(await page.evaluate(() => window.SillyTavern.getContext().extensionSettings.regex.map((r) => r.scriptName)), ["状态栏美化"]);
assert.ok(await page.locator("[data-page=rx] .pa-rx-delbar").isHidden(), "删完自动退出多选删除模式");
console.log("✓ 正则：原地多选删除");

// 世界书详情页：顶栏只留 ← 书名 + 🔍 + ＋ + ⋯；单条目 ⋯ 支持复制/删除；顶栏 ⋯ 管整本书与批量删条目
await page.evaluate(() => window.__mcdonalds.open("books"));
await page.waitForTimeout(400);
assert.ok(await nextTo("[data-page=books] .pa-bk-bar [data-b=search]", "[data-page=books] .pa-bk-bar [data-b=delmany]") < 12, "列表的垃圾桶紧挨搜索");
await page.locator('.pa-bk-row[data-book="示例世界书"] .pa-name').click();
await page.waitForTimeout(400);
assert.strictEqual(await page.locator(".pa-bk-dhead .pa-del, .pa-bk-dhead .pa-bk-rename").count(), 0, "详情页顶栏不再外露铅笔和垃圾桶");
assert.strictEqual(await page.locator('.pa-bk-dhead [data-e="bookmenu"]').count(), 1, "详情页顶栏提供 ⋯ 菜单");
await page.screenshot({ path: S + "delete-2-book.png" });
// 单条目 ⋯ 复制一条再删掉
const beforeCnt = await page.locator(".pa-wbe-row").count();
if (beforeCnt > 0) {
  await page.locator(".pa-wbe-row .pa-wbe-more").first().click();
  await page.locator(`${top} .pa-pick-item`, { hasText: "复制一条" }).click();
  await page.waitForTimeout(350);
  assert.strictEqual(await page.locator(".pa-wbe-row").count(), beforeCnt + 1, "单条目 ⋯ 可复制一条");
  await page.locator(".pa-wbe-row .pa-wbe-more").nth(1).click();
  await page.locator(`${top} .pa-pick-item`, { hasText: "删除条目" }).click();
  await confirm();
  assert.strictEqual(await page.locator(".pa-wbe-row").count(), beforeCnt, "单条目 ⋯ 可删除条目");
}
// 顶栏 ⋯ 删整本书，可先备份
await page.click('.pa-bk-dhead [data-e="bookmenu"]');
await page.locator(`${top} .pa-pick-item`, { hasText: "删除这本世界书" }).click();
await page.waitForSelector(`${top} .pa-sheet-actions`);
await Promise.all([page.waitForEvent("download"), page.locator(`${top} .pa-sheet-actions .pa-btn`, { hasText: "下载备份" }).click()]);
assert.deepStrictEqual(await page.evaluate(() => window.__dl), ["示例世界书.json"], "文件名就是书名，可直接导入");
await page.waitForSelector(`${top} .pa-dl-note`);
await confirm();
const books = () => page.evaluate(async () => { const wi = await import("/test/site/scripts/world-info.js"); return [...wi.world_names]; });
assert.ok(!(await books()).includes("示例世界书"), "整本书删掉：" + (await books()).join());
assert.ok(await page.locator(".pa-bk-detail").isHidden(), "回到世界书列表");
assert.ok((await toasts()).some((t) => t.includes("已删除世界书「示例世界书」")));
// 列表上方的垃圾桶：原地多选删除
const left = await books();
await page.click("[data-page=books] .pa-bk-bar [data-b=delmany]");
await page.waitForSelector("[data-page=books] .pa-bk-delbar:not([hidden])");
assert.strictEqual(await page.locator(".pa-sheet-mask:not(.pa-out)").count(), 0, "世界书列表多选删除不弹底部抽屉");
await page.click("[data-page=books] [data-bd=all]");
assert.strictEqual((await page.textContent("[data-page=books] [data-bd=confirm]")).trim(), `删除 ${left.length} 本`);
await page.click("[data-page=books] [data-bd=confirm]");
await confirm();
assert.deepStrictEqual(await books(), [], "勾选的书都删掉");
console.log("✓ 世界书：详情页双层 ⋯；列表原地多选删除");

// 预设：工具栏不再外露垃圾桶，收进预设选择器居中卡片内
await page.evaluate(() => window.__mcdonalds.open("organize"));
await page.waitForTimeout(400);
assert.strictEqual(await page.locator("[data-page=organize] [data-tool=delpreset]").count(), 0, "条目页工具栏不再外露删预设垃圾桶");
await page.click("[data-page=organize] .pa-picker-slot .pa-namebtn");
await page.waitForSelector(`${top} .pa-sheet-center`);
await page.click(`${top} [data-np=delmode]`);
const rows = await pickRows();
assert.ok(rows.some((x) => x.startsWith("×")), "正在用的不能勾：" + rows.join());
await tick("旧预设");
await Promise.all([page.waitForEvent("download"), page.locator(`${top} [data-np=dl]`).click()]);
assert.deepStrictEqual((await page.evaluate(() => window.__dl)).slice(-1), ["旧预设.json"]);
await page.waitForSelector(`${top} .pa-dl-note`);
assert.deepStrictEqual((await pickRows()).filter((x) => x.startsWith("✓")), ["✓旧预设"], "下载后勾选不变");
await page.locator(`${top} [data-np=del]`).click();
await page.waitForTimeout(400);
assert.deepStrictEqual(deleted, ["旧预设"], "调用酒馆删除接口");
console.log("✓ 预设：收进预设选择器居中卡片删除，正在用的不能删");

assert.deepStrictEqual(errs, []);
console.log("删除检查通过");
await browser.close();
