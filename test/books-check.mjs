// 2.12.0 预设 → 世界书（按角色卡绑定）、正则。用法同 clean-check.mjs
import { chromium } from "playwright";
import assert from "node:assert";
const S = new URL("./shots/", import.meta.url).pathname;
const exe = process.env.PW_CHROME || undefined;
const browser = await chromium.launch({ executablePath: exe });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
await page.goto("http://127.0.0.1:8765/test/site/index.html");
await page.waitForFunction(() => window.__mcdonalds?.open, null, { timeout: 15000 });
await page.evaluate(async () => {
  const wi = await import("/test/site/scripts/world-info.js");
  wi.world_names.push("林遥的世界", "城市设定", "沈岸's Lorebook", "通用文风");
  Object.assign(globalThis.__wiStore, {
    "林遥的世界": { entries: { 0: { uid: 0, comment: "林遥的过去", content: "她在海边长大。", key: ["林遥", "过去"], constant: false, position: 0, order: 100, disable: false, displayIndex: 0 } } },
    "城市设定": { entries: {
      0: { uid: 0, comment: "雾港", content: "常年起雾的港口城市，码头在东边。", key: ["雾港", "港口"], constant: false, position: 1, order: 100, disable: false, displayIndex: 0 },
      1: { uid: 1, comment: "旧城区", content: "石板路，夜里有灯笼。", key: [], constant: true, position: 4, depth: 2, order: 90, disable: false, displayIndex: 1 },
      2: { uid: 2, comment: "地铁", content: "三条线，末班车 23:40。", key: ["地铁"], constant: false, position: 0, order: 100, disable: true, displayIndex: 2 }
    } },
    "沈岸's Lorebook": { entries: {} },
    "通用文风": { entries: {} }
  });
  const c = window.SillyTavern.getContext();
  c.characters = [
    { name: "林遥", avatar: "linyao.png", data: { extensions: { world: "林遥的世界", regex_scripts: [{ id: "r1", scriptName: "林遥状态栏", findRegex: "<状态>([\\s\\S]*?)</状态>", replaceString: "<div class=\"bar\">$1</div>", placement: [2], markdownOnly: true, promptOnly: false, disabled: false }] } } },
    { name: "沈岸", avatar: "shenan.png", data: { extensions: {} } }
  ];
  c.characterId = "0";
  const live = window.__mock.live;
  live.extensions = { ...(live.extensions || {}), regex_scripts: [
    { id: "p1", scriptName: "MoM必选-清除多余内容", findRegex: "a", replaceString: "", placement: [2], markdownOnly: true, promptOnly: true, disabled: false },
    { id: "p2", scriptName: "MoM必选-只发送摘要", findRegex: "b", replaceString: "", placement: [2], promptOnly: true, disabled: false },
    { id: "p3", scriptName: "MoM美化-摘要", findRegex: "c", replaceString: "", placement: [2], markdownOnly: true, disabled: true },
    { id: "p4", scriptName: "单独一条", findRegex: "d", replaceString: "", placement: [2], disabled: false }
  ], baibaiToolkit: { regexGroups: { version: 1, groups: [{ id: "gA", name: "必选", order: 0 }, { id: "gB", name: "美化", order: 1, collapsed: true }], scripts: { p1: { groupId: "gA", order: 0 }, p2: { groupId: "gA", order: 1 }, p3: { groupId: "gB", order: 0 } }, ungrouped: { name: "默认分组" } } } };
  c.extensionSettings.regex = [{ id: "g1", scriptName: "去掉多余空行", findRegex: "\\n{3,}", replaceString: "\\n\\n", placement: [2], markdownOnly: false, promptOnly: false, disabled: false }];
  c.writeExtensionField = async (id, k, v) => { window.__wef = [id, k, structuredClone(v)]; };
  c.reloadCurrentChat = async () => { window.__reloaded = (window.__reloaded || 0) + 1; };
});
await page.evaluate(() => window.__mcdonalds.open("preset"));
await page.waitForTimeout(300);
const tabs = await page.$$eval(".pa-subnav button", (bs) => bs.map((b) => b.textContent));
assert.deepStrictEqual(tabs, ["条目", "世界书", "正则"], "预设下分三页");
await page.click('.pa-subnav [data-tab="books"]');
await page.waitForTimeout(400);
const secText = (sec) => page.$eval(`[data-page="books"] .pa-bk-sec[data-sec="${sec}"]`, (x) => x.innerText).catch(() => "");
let t = await secText("char");
assert.match(t, /林遥/);
assert.match(t, /林遥的世界[\s\S]*角色卡自带/, "识别出角色卡自带的世界书");
assert.ok(await page.$eval('.pa-bk-row[data-book="林遥的世界"] [data-b=toggle]', (x) => x.checked), "角色卡世界书默认开着");
assert.match(await secText("all"), /示例世界书/, "全局开着的列在「所有角色」");
await page.click('.pa-bk-sec[data-sec="all"] > .pa-ghead');
await page.waitForTimeout(150);
assert.ok(await page.$eval('.pa-bk-sec[data-sec="all"]', (x) => x.classList.contains("pa-collapsed")), "世界书的段可折叠");
await page.click('.pa-bk-sec[data-sec="all"] > .pa-ghead');
await page.waitForTimeout(150);
assert.match(await page.$eval(".pa-char-picker .pa-namebtn", (x) => x.innerText), /林遥/);
await page.screenshot({ path: S + "books-list.png" });
// 打开「城市设定」：只给林遥
await page.click('.pa-bk-row[data-book="城市设定"] .pa-switch');
await page.waitForTimeout(200);
let lore = await page.evaluate(async () => (await import("/test/site/scripts/world-info.js")).world_info.charLore);
assert.deepStrictEqual(lore, [{ name: "linyao", extraBooks: ["城市设定"] }], "写进酒馆的角色附加世界书");
assert.match(await secText("other"), /城市设定[\s\S]*这个角色/, "开关后不换段，标出「这个角色」");
// 换到沈岸：城市设定不跟过去；猜出沈岸's Lorebook
await page.evaluate(async () => { const c = window.SillyTavern.getContext(); c.characterId = "1"; await c.eventSource.emit("chat_changed"); });
await page.waitForTimeout(800);
t = await secText("char");
assert.match(t, /沈岸/);
assert.match(t, /沈岸's Lorebook[\s\S]*名称像这个角色的/, "没绑世界书时按名称猜");
assert.ok(!await page.$eval('.pa-bk-row[data-book="城市设定"] [data-b=toggle]', (x) => x.checked), "换角色后上一个角色的世界书不开");
// 换回林遥：选择不变
await page.evaluate(async () => { const c = window.SillyTavern.getContext(); c.characterId = "0"; await c.eventSource.emit("chat_changed"); });
await page.waitForTimeout(800);
t = await secText("char");
assert.match(t, /城市设定/, "换回来时城市设定在这个角色名下");
assert.ok(await page.$eval('[data-sec="char"] .pa-bk-row[data-book="城市设定"] [data-b=toggle]', (x) => x.checked), "换回来仍然开着");
// 关掉角色卡自带的那本：生成前从角色世界书里去掉
await page.click('[data-sec="char"] .pa-bk-row[data-book="林遥的世界"] .pa-switch');
await page.waitForTimeout(200);
const left = await page.evaluate(async () => {
  const c = window.SillyTavern.getContext();
  const lore = { globalLore: [], characterLore: [{ uid: 0, world: "林遥的世界" }, { uid: 0, world: "城市设定" }], chatLore: [], personaLore: [] };
  await c.eventSource.emit("wi_loaded", lore);
  return lore.characterLore.map((x) => x.world);
});
assert.deepStrictEqual(left, ["城市设定"], "角色卡自带的世界书关掉后不读入");
// 关掉附加的那本：仍列在这个角色下
await page.click('[data-sec="char"] .pa-bk-row[data-book="城市设定"] .pa-switch');
await page.waitForTimeout(200);
lore = await page.evaluate(async () => (await import("/test/site/scripts/world-info.js")).world_info.charLore);
assert.deepStrictEqual(lore, [], "关掉后从角色附加世界书里去掉");
await page.evaluate(() => window.__mcdonalds.open("preset"));
await page.click('.pa-subnav [data-tab="organize"]');
await page.click('.pa-subnav [data-tab="books"]');
await page.waitForTimeout(400);
assert.match(await secText("char"), /城市设定/, "关着的附加世界书下次仍列在这个角色下");
await page.click('[data-sec="char"] .pa-bk-row[data-book="城市设定"] .pa-switch');
await page.waitForTimeout(200);
// 条目页
await page.click('[data-sec="char"] .pa-bk-row[data-book="城市设定"] [data-b=peek]');
await page.waitForSelector(".pa-wbe-row");
assert.ok(await page.$eval(".pa-bk-list", (x) => x.offsetParent === null), "手机上条目页盖住列表");
t = await page.$eval(".pa-bk-detail", (x) => x.innerText);
assert.match(t, /共 3 条，开着 2 条/);
assert.match(t, /雾港[\s\S]*关键词：雾港、港口/);
assert.match(t, /旧城区[\s\S]*常驻[\s\S]*深度 2/);
assert.ok(await page.$eval('.pa-bk-scope [data-scope="char"]', (x) => x.classList.contains("on")), "用在：这个角色");
await page.screenshot({ path: S + "books-detail.png" });
await page.click('.pa-wbe-row[data-uid="2"] .pa-switch');
await page.waitForTimeout(200);
assert.strictEqual(await page.evaluate(() => globalThis.__wiStore["城市设定"].entries[2].disable), false, "条目开关写回世界书");
assert.ok(await page.$eval(".pa-bk-q", (x) => x.hidden), "搜索框平时收起，图标在标题行");
assert.ok(await page.$eval(".pa-bk-entries", (x) => !!x.querySelector(".pa-bk-scope")), "「用在」随条目一起滚动");
await page.click('[data-e="search"]');
await page.fill("[data-e=q]", "末班车");
await page.waitForTimeout(300);
t = await page.$eval(".pa-bk-entries", (x) => x.innerText);
assert.match(t, /匹配 1 条[\s\S]*地铁[\s\S]*正文：/, "搜到正文里的字");
await page.click('[data-e="searchclose"]');
await page.waitForTimeout(200);
assert.ok(await page.$eval(".pa-bk-q", (x) => x.hidden), "关闭搜索");
assert.match(await page.$eval(".pa-bk-entries", (x) => x.innerText), /共 3 条/, "关闭搜索后列出全部");
await page.click('.pa-wbe-row[data-uid="0"]');
await page.waitForSelector(".pa-sheet-wbentry");
await page.fill('.pa-sheet-wbentry [data-w=content]', "常年起雾的港口城市，码头在西边。");
const trigRow = await page.$eval(".pa-wb-trig", (r) => { const a = r.querySelector("[data-w=constant]").getBoundingClientRect(), b = r.querySelector("[data-w=key]").getBoundingClientRect(); return Math.abs(a.top - b.top) < 4 && b.left > a.right; });
assert.ok(trigRow, "关键词在触发旁边");
await page.fill('.pa-sheet-wbentry [data-w=key]', "雾港，港口, 码头, 一个很长很长的关键词用来看能不能全部显示出来, 另一个很长的关键词, 第三个很长的关键词");
await page.click('.pa-sheet-wbentry [data-w=kwexpand]');
await page.waitForTimeout(150);
const kwFull = await page.$eval('.pa-sheet-wbentry [data-w=key]', (x) => x.scrollWidth <= x.clientWidth + 1 && x.offsetHeight > 50);
assert.ok(kwFull, "展开后关键词换行、全部显示");
assert.ok(await page.$(".pa-sheet-wbentry .pa-scrollhint"), "编辑窗口有滚动引导条");
await page.fill('.pa-sheet-wbentry [data-w=key]', "雾港，港口, 码头");
await page.waitForTimeout(400);
await page.screenshot({ path: S + "books-edit.png" });
await page.click('.pa-sheet-wbentry .pa-btn-primary');
await page.waitForTimeout(400);
const e0 = await page.evaluate(() => globalThis.__wiStore["城市设定"].entries[0]);
assert.strictEqual(e0.content, "常年起雾的港口城市，码头在西边。");
assert.deepStrictEqual(e0.key, ["雾港", "港口", "码头"], "中英文逗号都能分开关键词");
// 新建条目
await page.click('[data-e="new"]');
await page.waitForSelector(".pa-sheet-wbentry");
await page.fill('.pa-sheet-wbentry [data-w=comment]', "夜市");
await page.fill('.pa-sheet-wbentry [data-w=content]', "码头边的夜市。");
await page.click('.pa-sheet-wbentry .pa-btn-primary');
await page.waitForTimeout(400);
assert.match(await page.$eval(".pa-bk-detail", (x) => x.innerText), /共 4 条[\s\S]*夜市/, "新建条目在列表里");
// 改成所有角色
await page.click('.pa-bk-scope [data-scope="all"]');
await page.waitForTimeout(200);
const g = await page.evaluate(async () => { const wi = await import("/test/site/scripts/world-info.js"); return { sel: [...wi.selected_world_info], lore: wi.world_info.charLore }; });
assert.ok(g.sel.includes("城市设定"), "加进全局世界书");
assert.deepStrictEqual(g.lore, [], "改成全局后不再留在角色附加世界书里");
// Esc 回到列表
await page.keyboard.press("Escape");
await page.waitForTimeout(200);
assert.ok(await page.$eval(".pa-bk-list", (x) => x.offsetParent !== null), "Esc 回到列表");
// 搜索世界书
await page.click('[data-b="search"]');
await page.fill(".pa-bk-bar .pa-find", "文风");
await page.waitForTimeout(300);
const rows = await page.$$eval(".pa-bk-row", (rs) => rs.map((r) => r.dataset.book));
assert.deepStrictEqual(rows, ["通用文风"], "按名称搜世界书");
await page.click('[data-b="searchclose"]');
// 正则页
await page.click('.pa-subnav [data-tab="rx"]');
await page.waitForTimeout(400);
t = await page.$eval(".pa-rx-list", (x) => x.innerText);
assert.match(t, /角色卡「林遥」[\s\S]*还没允许这张角色卡的正则[\s\S]*林遥状态栏[\s\S]*仅显示美化/);
assert.match(t, /全局[\s\S]*去掉多余空行/);
await page.screenshot({ path: S + "rx-list.png" });
t = await page.$eval('.pa-rx-sec[data-kind="preset"]', (x) => x.innerText);
assert.match(t, /必选\s*2\/2[\s\S]*MoM必选-清除多余内容[\s\S]*美化\s*0\/1[\s\S]*默认分组\s*1\/1[\s\S]*单独一条/, "按柏宝箱分组列出");
assert.ok(await page.$eval('.pa-rx-grp[data-fk$="::gB"]', (x) => x.classList.contains("pa-collapsed")), "柏宝箱里收起的分组默认收起");
await page.click('.pa-rx-grp[data-fk$="::gA"] .pa-rx-ghead');
await page.waitForTimeout(150);
assert.ok(await page.$eval('.pa-rx-grp[data-fk$="::gA"]', (x) => x.classList.contains("pa-collapsed")), "点组名收起分组");
await page.click('.pa-rx-sec[data-kind="preset"] > .pa-ghead');
await page.waitForTimeout(150);
assert.ok(await page.$eval('.pa-rx-sec[data-kind="preset"]', (x) => x.classList.contains("pa-collapsed")), "点段头收起整段");
await page.click('.pa-subnav [data-tab="books"]');
await page.click('.pa-subnav [data-tab="rx"]');
await page.waitForTimeout(200);
assert.ok(await page.$eval('.pa-rx-sec[data-kind="preset"]', (x) => x.classList.contains("pa-collapsed")), "记住折叠状态");
await page.click('.pa-rx-sec[data-kind="preset"] > .pa-ghead');
await page.waitForTimeout(150);
await page.click('.pa-rx-row[data-kind="global"] .pa-switch');
await page.waitForTimeout(200);
assert.strictEqual(await page.evaluate(() => window.SillyTavern.getContext().extensionSettings.regex[0].disabled), true, "全局正则开关写回");
await page.click('.pa-rx-row[data-kind="char"] .pa-switch');
await page.waitForTimeout(200);
const wef = await page.evaluate(() => window.__wef);
assert.strictEqual(wef?.[1], "regex_scripts");
assert.strictEqual(wef[2][0].disabled, true, "角色卡正则开关写回角色卡");
await page.click('[data-r="allow"][data-kind="char"]');
await page.waitForTimeout(200);
assert.deepStrictEqual(await page.evaluate(() => window.SillyTavern.getContext().extensionSettings.character_allowed_regex), ["linyao.png"]);
await page.click('[data-r="allow"][data-kind="preset"]');
await page.waitForTimeout(200);
const allowed = await page.evaluate(() => ({ list: window.SillyTavern.getContext().extensionSettings.preset_allowed_regex?.openai, name: window.__mock.live.preset_settings_openai }));
assert.deepStrictEqual(allowed.list, [allowed.name], "允许预设正则");
assert.ok(!await page.$('[data-r="allow"]'), "允许后不再提示");
await page.click('.pa-rx-row[data-kind="char"] [data-r=peek]');
await page.waitForSelector(".pa-rx-code");
assert.match(await page.$eval(".pa-sheet", (x) => x.innerText), /查找[\s\S]*<状态>/, "原样显示查找内容");
await page.screenshot({ path: S + "rx-peek.png" });
await page.click(".pa-sheet-x");
await page.waitForTimeout(200);
// 关面板时重新载入一次聊天（显示美化的正则改过）
await page.click('[data-g="close"]');
await page.waitForTimeout(300);
assert.strictEqual(await page.evaluate(() => window.__reloaded), 1, "改过显示美化的正则，关面板时重新载入一次聊天");
// 宽屏：列表和条目并排
await page.setViewportSize({ width: 1280, height: 820 });
await page.evaluate(() => window.__mcdonalds.open("preset"));
await page.click('.pa-subnav [data-tab="books"]');
await page.waitForTimeout(600);
assert.ok(await page.$eval(".pa-bk-list", (x) => x.offsetParent !== null) && await page.$eval(".pa-bk-detail", (x) => !x.hidden), "宽屏并排，自动打开一本");
await page.screenshot({ path: S + "books-wide.png" });
assert.deepStrictEqual(errs, []);
await browser.close();
console.log("books-check ok");
