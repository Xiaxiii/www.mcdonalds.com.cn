// 2.12.8 条目页「⋯ → 导入…」：选预设 / 世界书 / 正则，选文件直接导入。
// 预设：新名字直接存；同名时可另存为「名字 (2)」或覆盖（覆盖是一次可撤销的修改）。世界书：酒馆格式照存，角色卡格式先换写法。
// 正则：导到全局（重复的跳过），或导进当前预设（打开缝合正则窗口）。用法：在仓库根目录 bash test/run-browser.sh
import { chromium } from "playwright";
import assert from "node:assert";
const S = new URL("./shots/", import.meta.url).pathname;
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
// 酒馆保存预设的接口：记下来，回服务器用的名字
const savedPresets = [];
await page.route("**/api/presets/save", async (r) => {
  const body = JSON.parse(r.request().postData());
  savedPresets.push(body);
  await r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ name: body.name }) });
});
await page.goto("http://127.0.0.1:8765/test/site/index.html");
await page.waitForFunction(() => window.__mcdonalds?.open, null, { timeout: 15000 });
// 提示记下来（测试页没有 toastr）
await page.evaluate(() => { window.__toasts = []; window.toastr = Object.fromEntries(["success", "info", "warning", "error"].map((k) => [k, (m) => { window.__toasts.push(`${k}:${m}`); return { on() {} }; }])); });
// 和酒馆一样：预设名称表是同一个对象，存新预设时往里加名字（测试页默认每次按名字数组重新生成）
await page.evaluate(() => {
  const m = window.__mock, ctx = window.SillyTavern.getContext(), pm0 = ctx.getPresetManager();
  const pn = Object.fromEntries(m.names.map((n, i) => [n, i]));
  ctx.getPresetManager = () => ({ ...pm0, getPresetList: () => {
    for (const [n, i] of Object.entries(pn)) if (m.names[i] !== n) m.names[i] = n;
    return { presets: m.presets, preset_names: pn };
  } });
});
await page.evaluate(() => window.__mcdonalds.open("organize"));
await page.waitForTimeout(400);
const top = ".pa-sheet-mask:not(.pa-out)";
const json = (name, data) => ({ name, mimeType: "application/json", buffer: Buffer.from(JSON.stringify(data)) });
async function openImport() {
  await page.click("[data-page=organize] [data-tool=menu]");
  await page.locator(`${top} .pa-pick-item`).filter({ hasText: "导入" }).click();
  await page.waitForSelector(`${top} .pa-import`);
}
const pickInSheet = async (text) => { await page.locator(`${top} .pa-pick-item`).filter({ hasText: text }).click(); await page.waitForTimeout(300); };
const toasts = () => page.evaluate(() => window.__toasts);

// 2.12.17 弹窗：一个选文件的按钮，按内容认出是预设、世界书还是正则
await openImport();
const items = await page.$$eval(`${top} .pa-import .pa-pick-item`, (ls) => ls.map((l) => ({ tag: l.tagName, file: !!l.querySelector("input[type=file]") })));
assert.strictEqual(items.length, 1, "只有一个选文件的按钮");
assert.ok(items[0].tag === "LABEL" && items[0].file, "按钮是包着文件框的 label：手机上点到就直接选文件");
await page.screenshot({ path: S + "import-1-sheet.png" });
console.log("✓ 「⋯ → 导入…」：一个选文件的按钮，不用先选种类");

// 预设：新名字
const P = (id, name, content) => ({ identifier: id, name, content, role: "system", system_prompt: false, marker: false, injection_position: 0, injection_depth: 4, injection_order: 100 });
const preset = { prompts: [P("a", "开头", "你好"), P("b", "收尾", "再见")], prompt_order: [{ character_id: 100001, order: [{ identifier: "a", enabled: true }, { identifier: "b", enabled: true }] }], temperature: 1 };
await page.setInputFiles(`${top} input[data-imp=auto]`, json("导入测试.json", preset));
await page.waitForTimeout(600);
assert.strictEqual(savedPresets.at(-1)?.name, "导入测试");
assert.ok(await page.evaluate(() => window.__mock.names.includes("导入测试") || Object.keys(window.SillyTavern.getContext().getPresetManager().getPresetList().preset_names).includes("导入测试")), "加进预设列表");
assert.match((await page.textContent("[data-page=organize] .pa-picker-slot")) || "", /导入测试/, "条目页切到刚导入的预设");
assert.ok((await toasts()).some((t) => t.includes("已导入预设「导入测试」，2 个条目")));
console.log("✓ 导入预设：存成新预设，条目页切过去");

// 预设：同名，另存为「名字 (2)」
await openImport();
await page.setInputFiles(`${top} input[data-imp=auto]`, json("导入测试.json", preset));
await page.waitForSelector(`${top} .pa-pick-item`);
assert.match(await page.textContent(`${top} .pa-sheet-head`), /已有叫「导入测试」的预设/);
await pickInSheet("另存为");
assert.strictEqual(savedPresets.at(-1)?.name, "导入测试 (2)", "同名时另存为「导入测试 (2)」");
console.log("✓ 同名预设可另存为「名字 (2)」");

// 预设：同名覆盖，是一次可撤销的修改
const covered = { ...preset, prompts: [P("a", "开头", "覆盖后的正文"), P("c", "新条目", "新的")], prompt_order: [{ character_id: 100001, order: [{ identifier: "a", enabled: true }, { identifier: "c", enabled: true }] }] };
await openImport();
await page.setInputFiles(`${top} input[data-imp=auto]`, json("导入测试.json", covered));
await page.waitForSelector(`${top} .pa-pick-item`);
await pickInSheet("覆盖");
await page.waitForTimeout(400);
const names = await page.$$eval("[data-page=organize] .pa-list .pa-row .pa-name", (n) => n.map((x) => x.textContent));
assert.ok(names.includes("新条目") && !names.includes("收尾"), "覆盖后列表换成文件里的条目：" + names.join());
assert.ok(await page.locator('.pa-savebar [data-g="undo"]').isVisible(), "页头能撤销");
console.log("✓ 同名预设覆盖：当作一次修改，页头可撤销");

// 世界书：酒馆格式照存；角色卡格式换成酒馆写法
await openImport();
await page.setInputFiles(`${top} input[data-imp=auto]`, json("新世界书.json", { entries: { 0: { uid: 0, key: ["甲"], comment: "条目甲", content: "甲的设定", constant: false, disable: false, position: 0, order: 100 } } }));
await page.waitForTimeout(500);
let wb = await page.evaluate(async () => { const wi = await import("/test/site/scripts/world-info.js"); return { names: [...wi.world_names], book: await wi.loadWorldInfo("新世界书") }; });
assert.ok(wb.names.includes("新世界书") && wb.book.entries[0].content === "甲的设定");
await openImport();
await page.setInputFiles(`${top} input[data-imp=auto]`, json("角色卡的书.json", { name: "x", character_book: { entries: [{ keys: ["乙"], content: "乙的设定", enabled: false, insertion_order: 30, comment: "条目乙", extensions: { position: 1, depth: 2 } }] } }));
await page.waitForTimeout(500);
wb = await page.evaluate(async () => { const wi = await import("/test/site/scripts/world-info.js"); return (await wi.loadWorldInfo("角色卡的书")).entries; });
const e0 = Object.values(wb)[0];
assert.deepStrictEqual([e0.key, e0.content, e0.disable, e0.order, e0.position, e0.depth, typeof e0.selectiveLogic], [["乙"], "乙的设定", true, 30, 1, 2, "number"], "角色卡格式换成酒馆写法、补齐默认字段：" + JSON.stringify(e0));
console.log("✓ 导入世界书：酒馆格式照存，角色卡格式换成酒馆写法");

// 正则：导到全局，重复的跳过
const rx = [{ id: "r1", scriptName: "去空行", findRegex: "/\\n{3,}/g", replaceString: "\\n\\n", placement: [2], disabled: false, markdownOnly: true, promptOnly: false }, { scriptName: "去星号", findRegex: "/\\*/g", replaceString: "", placement: [2] }];
await openImport();
await page.setInputFiles(`${top} input[data-imp=auto]`, json("两条正则.json", rx));
await page.waitForSelector(`${top} .pa-pick-item`);
assert.match(await page.textContent(`${top} .pa-sheet-head`), /2 条正则导入到哪里/);
await pickInSheet("全局");
let g = await page.evaluate(() => window.SillyTavern.getContext().extensionSettings.regex.map((r) => [r.scriptName, r.id ? "id" : "", r.findRegex]));
assert.ok(g.some((r) => r[0] === "去空行") && g.some((r) => r[0] === "去星号" && r[1] === "id"), "两条都进了全局，没有 id 的补上：" + JSON.stringify(g));
const n1 = g.length;
await openImport();
await page.setInputFiles(`${top} input[data-imp=auto]`, json("两条正则.json", rx));
await page.waitForSelector(`${top} .pa-pick-item`);
await pickInSheet("全局");
g = await page.evaluate(() => window.SillyTavern.getContext().extensionSettings.regex.length);
assert.strictEqual(g, n1, "再导一次：全局里都有了，不重复导入");
console.log("✓ 导入正则到全局，重复的跳过");

// 正则：导进当前预设，走缝合正则的窗口
await openImport();
await page.setInputFiles(`${top} input[data-imp=auto]`, json("两条正则.json", rx));
await page.waitForSelector(`${top} .pa-pick-item`);
await pickInSheet("预设「导入测试」");
await page.waitForTimeout(400);
assert.ok(await page.locator(`${top} .pa-sheet-head`).count() > 0, "打开了缝合正则窗口");
await page.screenshot({ path: S + "import-2-regex-preset.png" });
console.log("✓ 导入正则到当前预设：打开缝合正则窗口");

// 认不出的文件：说清楚
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
await openImport();
await page.setInputFiles(`${top} input[data-imp=auto]`, json("不是预设.json", { hello: 1 }));
await page.waitForTimeout(400);
assert.ok((await toasts()).some((t) => t.includes("认不出是哪种文件")), "认不出时说明原因");
console.log("✓ 认不出的文件说明原因");

assert.deepStrictEqual(errs, []);
console.log("导入检查通过");
await browser.close();
