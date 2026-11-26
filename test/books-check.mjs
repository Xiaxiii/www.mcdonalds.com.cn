// 2.12.0 预设 → 世界书（按角色卡绑定）、正则。用法同 clean-check.mjs
import { chromium } from "playwright";
import assert from "node:assert";
import { fileURLToPath } from "node:url";
const S = fileURLToPath(new URL("./shots/", import.meta.url));
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
  c.writeExtensionField = async (id, k, v) => { window.__wef = [id, k, structuredClone(v)]; c.characters[Number(id)].data.extensions[k] = v; };
  c.reloadCurrentChat = async () => { window.__reloaded = (window.__reloaded || 0) + 1; };
});
await page.evaluate(() => window.__mcdonalds.open("preset"));
await page.waitForTimeout(300);
// 样式表完整：文本里每个顶层块浏览器都认得（多出的文字、合并冲突留下的标记会让紧跟的那条规则失效）
const css = await page.evaluate(() => {
  const el = document.getElementById("mcd-style");
  const text = el.textContent.replace(/\/\*[\s\S]*?\*\//g, "");
  let depth = 0, blocks = 0;
  for (const ch of text) { if (ch === "{") { if (depth === 0) blocks++; depth++; } else if (ch === "}") depth--; }
  return { blocks, parsed: el.sheet.cssRules.length, stray: /^\s*(={7}|<{7}|>{7})/m.test(text) };
});
assert.ok(!css.stray, "样式表里没有合并冲突标记");
assert.strictEqual(css.parsed, css.blocks, `样式表每条规则都生效（文本 ${css.blocks} 块，浏览器认得 ${css.parsed} 条）`);
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
assert.match(await secText("char"), /城市设定/, "开了马上挂到角色名下");
assert.doesNotMatch(await secText("other"), /城市设定/, "不再留在「其他世界书」");
assert.ok(await page.$('[data-sec="char"] .pa-bk-row[data-book="城市设定"].pa-flash'), "挂过去的那行闪一下");
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
// 关掉附加的那本：回到「其他世界书」；角色卡自带的那本关了仍留在角色名下
await page.click('[data-sec="char"] .pa-bk-row[data-book="城市设定"] .pa-switch');
await page.waitForTimeout(200);
lore = await page.evaluate(async () => (await import("/test/site/scripts/world-info.js")).world_info.charLore);
assert.deepStrictEqual(lore, [], "关掉后从角色附加世界书里去掉");
assert.match(await secText("other"), /城市设定/, "关掉的回到「其他世界书」");
assert.doesNotMatch(await secText("char"), /城市设定/);
assert.match(await secText("char"), /林遥的世界/, "角色卡自带的关了仍在角色名下");
await page.click('[data-sec="other"] .pa-bk-row[data-book="城市设定"] .pa-switch');
await page.waitForTimeout(200);
assert.match(await secText("char"), /城市设定/, "再开又挂回角色名下");
// 条目页
await page.click('[data-sec="char"] .pa-bk-row[data-book="城市设定"] .pa-name');
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
// 2.12.11 关键词占满触发下面一行，自动换行、高度跟着内容
const trigRow = await page.$eval(".pa-wb-trig", (r) => { const a = r.querySelector("[data-w=constant]").getBoundingClientRect(), b = r.querySelector("[data-w=key]").getBoundingClientRect(), w = r.getBoundingClientRect(); return b.top > a.bottom && b.width > w.width - 4; });
assert.ok(trigRow, "关键词在触发下面，占满一行");
await page.fill('.pa-sheet-wbentry [data-w=key]', "雾港，港口, 码头, 一个很长很长的关键词用来看能不能全部显示出来, 另一个很长的关键词, 第三个很长的关键词");
await page.waitForTimeout(150);
const kwFull = await page.$eval('.pa-sheet-wbentry [data-w=key]', (x) => x.scrollWidth <= x.clientWidth + 1 && x.offsetHeight > 50 && x.scrollHeight <= x.clientHeight + 2);
assert.ok(kwFull, "关键词换行、全部显示");
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
// 改世界书名称：收进顶栏 ⋯ 菜单；全局列表跟着改，旧的删掉
await page.click('.pa-bk-dhead [data-e="bookmenu"]');
await page.locator('.pa-sheet-mask:not(.pa-out) .pa-pick-item', { hasText: '重命名世界书' }).click();
await page.waitForSelector(".pa-bk-dname .pa-inline-input");
await page.waitForTimeout(100);
const sel = await page.$eval(".pa-bk-dname .pa-inline-input", (x) => [x.selectionStart, x.selectionEnd, x.value.length]);
assert.ok(sel[0] === sel[1] && sel[1] === sel[2], "2.12.11 改名时不全选，光标在末尾：" + sel.join());
await page.fill(".pa-bk-dname .pa-inline-input", "雾港设定");
await page.keyboard.press("Enter");
await page.waitForTimeout(600);
let rn = await page.evaluate(async () => { const wi = await import("/test/site/scripts/world-info.js"); return { names: [...wi.world_names], sel: [...wi.selected_world_info], has: !!globalThis.__wiStore["雾港设定"], old: !!globalThis.__wiStore["城市设定"] }; });
assert.ok(rn.names.includes("雾港设定") && !rn.names.includes("城市设定"), "改名后列表里是新名字");
assert.ok(rn.sel.includes("雾港设定") && !rn.sel.includes("城市设定"), "全局开着的跟着改名");
assert.ok(rn.has && !rn.old, "新文件存在，旧文件删掉");
assert.strictEqual(await page.$eval(".pa-bk-dname", (x) => x.textContent), "雾港设定");
assert.match(await page.$eval(".pa-bk-entries", (x) => x.innerText), /共 4 条/, "条目都在");
assert.match(await secText("all"), /雾港设定/);
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
// 改角色卡自带那本的名字：角色卡跟着改
await page.click('[data-sec="char"] .pa-bk-row[data-book="林遥的世界"] .pa-name');
await page.waitForSelector(".pa-wbe-row");
await page.click('.pa-bk-dhead [data-e="bookmenu"]');
await page.locator('.pa-sheet-mask:not(.pa-out) .pa-pick-item', { hasText: '重命名世界书' }).click();
await page.waitForSelector(".pa-bk-dname .pa-inline-input");
await page.fill(".pa-bk-dname .pa-inline-input", "林遥的过去");
await page.keyboard.press("Enter");
await page.waitForTimeout(600);
assert.strictEqual(await page.evaluate(() => window.SillyTavern.getContext().characters[0].data.extensions.world), "林遥的过去", "角色卡自带的链接跟着改");
assert.match(await secText("char"), /林遥的过去[\s\S]*角色卡自带/);
await page.click('.pa-bk-dhead [data-e="bookmenu"]');
await page.locator('.pa-sheet-mask:not(.pa-out) .pa-pick-item', { hasText: '重命名世界书' }).click();
await page.waitForSelector(".pa-bk-dname .pa-inline-input");
await page.fill(".pa-bk-dname .pa-inline-input", "通用文风");
await page.keyboard.press("Enter");
await page.waitForTimeout(400);
assert.strictEqual(await page.$eval(".pa-bk-dname", (x) => x.textContent), "林遥的过去", "重名时不改");
await page.keyboard.press("Escape");
await page.waitForTimeout(200);
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
// 编辑角色卡的正则：查找原样显示；坏的正则不让存，错误写在框下面
await page.click('.pa-rx-row[data-kind="char"] .pa-name');
await page.waitForSelector(".pa-sheet-rxedit");
assert.match(await page.$eval('.pa-sheet-rxedit [data-x="find"]', (x) => x.value), /<状态>/, "查找原样放进编辑框");
await page.fill('.pa-sheet-rxedit [data-x="find"]', "/(未闭合/g");
await page.click(".pa-sheet-rxedit .pa-btn-primary");
await page.waitForTimeout(200);
assert.ok(await page.$eval('[data-err="find"]', (x) => !x.hidden && /解析不了/.test(x.textContent)), "坏的正则写明原因");
assert.ok(await page.$(".pa-sheet-rxedit"), "有错时窗口不关");
await page.fill('.pa-sheet-rxedit [data-x="find"]', "/<状态>([\\s\\S]*?)<\\/状态>/g");
await page.fill('.pa-sheet-rxedit [data-x="name"]', "林遥状态栏·新");
await page.check('.pa-sheet-rxedit [data-place="1"]');
await page.screenshot({ path: S + "rx-edit.png" });
await page.click(".pa-sheet-rxedit .pa-btn-primary");
await page.waitForTimeout(300);
const wef2 = await page.evaluate(() => window.__wef);
assert.strictEqual(wef2[1], "regex_scripts");
assert.strictEqual(wef2[2][0].scriptName, "林遥状态栏·新", "角色卡正则改名写回角色卡");
assert.deepStrictEqual(wef2[2][0].placement, [1, 2], "作用于写回");
assert.strictEqual(wef2[2][0].id, "r1", "保留原编号");
assert.match(await page.$eval(".pa-rx-list", (x) => x.innerText), /林遥状态栏·新/);
// 编辑全局正则
await page.click('.pa-rx-row[data-kind="global"] .pa-name');
await page.waitForSelector(".pa-sheet-rxedit");
await page.fill('.pa-sheet-rxedit [data-x="replace"]', "\\n");
await page.uncheck('.pa-sheet-rxedit [data-place="2"]');
await page.click(".pa-sheet-rxedit .pa-btn-primary");
await page.waitForTimeout(200);
assert.ok(await page.$eval('[data-err="place"]', (x) => !x.hidden), "作用于一处都不选时不让存");
await page.check('.pa-sheet-rxedit [data-place="2"]');
await page.check('.pa-sheet-rxedit [data-x="md"]');
await page.click(".pa-sheet-rxedit .pa-btn-primary");
await page.waitForTimeout(300);
const g0 = await page.evaluate(() => window.SillyTavern.getContext().extensionSettings.regex[0]);
assert.strictEqual(g0.replaceString, "\\n");
assert.strictEqual(g0.markdownOnly, true, "全局正则改动写回酒馆设置");
// 编辑预设的正则：走预设的自动保存
await page.click('.pa-rx-row[data-kind="preset"][data-i="3"] .pa-name');
await page.waitForSelector(".pa-sheet-rxedit");
await page.fill('.pa-sheet-rxedit [data-x="name"]', "单独一条·改");
await page.click(".pa-sheet-rxedit .pa-btn-primary");
await page.waitForTimeout(900);
assert.strictEqual(await page.evaluate(() => window.__mock.live.extensions.regex_scripts[3].scriptName), "单独一条·改", "预设正则改名后自动保存");
// 删除全局正则
await page.click('.pa-rx-row[data-kind="global"] .pa-name');
await page.waitForSelector(".pa-sheet-rxedit");
await page.click(".pa-sheet-rxedit .pa-btn-danger-soft");
await page.waitForSelector(".pa-sheet-center");
await page.click(".pa-sheet-center .pa-btn-danger");
await page.waitForTimeout(300);
assert.strictEqual(await page.evaluate(() => window.SillyTavern.getContext().extensionSettings.regex.length), 0, "删除全局正则");
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
