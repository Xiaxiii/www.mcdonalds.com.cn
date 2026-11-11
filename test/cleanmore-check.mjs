// 清理页其他几栏（扩展数据、角色卡、世界书、本地备份）+ 日落海岸配色。用法同 clean-check.mjs
import { chromium } from "playwright";
import assert from "node:assert";
const S = new URL("./shots/", import.meta.url).pathname;
const exe = process.env.PW_CHROME || undefined;
const browser = await chromium.launch({ executablePath: exe });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, acceptDownloads: true });
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
const deleted = [];
await page.route("**/api/extensions/discover", (r) => r.fulfill({ json: [{ type: "system", name: "regex" }, { type: "local", name: "third-party/st-goodext" }, { type: "local", name: "third-party/www.mcdonalds.com.cn" }] }));
await page.route("**/scripts/extensions/third-party/st-goodext/manifest.json", (r) => r.fulfill({ json: { display_name: "好扩展", js: "index.js" } }));
await page.route("**/scripts/extensions/third-party/st-goodext/index.js", (r) => r.fulfill({ contentType: "text/javascript", body: 'import { x } from "./src/core.js"; export const a = 1;' }));
await page.route("**/scripts/extensions/third-party/st-goodext/src/core.js", (r) => r.fulfill({ contentType: "text/javascript", body: 'extension_settings["myHiddenKey"] = {}; extension_settings.anotherKey = 1;' }));
await page.route("**/scripts/extensions/regex/manifest.json", (r) => r.fulfill({ json: { display_name: "Regex", js: "index.js" } }));
await page.route("**/scripts/extensions/regex/index.js", (r) => r.fulfill({ contentType: "text/javascript", body: "extension_settings.regex = [];" }));
await page.route("**/scripts/extensions/third-party/www.mcdonalds.com.cn/manifest.json", (r) => r.fulfill({ json: { display_name: "麦当劳", js: "index.js" } }));
await page.route("**/scripts/extensions/third-party/www.mcdonalds.com.cn/index.js", (r) => r.fulfill({ contentType: "text/javascript", body: 'var KEY = "mcdonalds";' }));
const charGets = [];
await page.route("**/api/characters/get", (r) => {
  const a = r.request().postDataJSON().avatar_url;
  charGets.push(a);
  const base = { name: "姜泰温", avatar: a, data: { description: "高中生", personality: "冷", scenario: "", first_mes: "你好", mes_example: "", tags: [] } };
  if (a === "jiang1.png") { base.data.description = "大学生"; base.data.first_mes = "嗨"; }
  r.fulfill({ json: base });
});
await page.route("**/api/characters/delete", (r) => { deleted.push(r.request().postDataJSON()); r.fulfill({ status: 200, body: "" }); });
await page.goto("http://127.0.0.1:8765/test/site/index.html");
await page.waitForFunction(() => window.__mcdonalds?.open, null, { timeout: 15000 });
await page.evaluate(() => {
  const c = window.SillyTavern.getContext();
  c.getRequestHeaders = () => ({ "Content-Type": "application/json" });
  Object.assign(c.extensionSettings, { regex: [1, 2, 3], myHiddenKey: { a: "x".repeat(5000) }, anotherKey: 1, oldUninstalled: { big: "y".repeat(40000) }, goodext: { v: 1 }, disabledExtensions: [] });
  c.characters = [
    { name: "姜泰温", avatar: "jiang.png", shallow: true, data_size: 5000, date_last_chat: Date.now() - 864e5, chat_size: 120000 },
    { name: "姜泰温", avatar: "jiang1.png", shallow: true, data_size: 5000, date_last_chat: 0 },
    { name: "Julian", avatar: "julian.png", shallow: true, data_size: 3000 }
  ];
  c.characterId = 0;
  c.getCharacters = async () => { c.characters = c.characters.filter((x) => !window.__delChars?.includes(x.avatar)); };
  window.__mcdonalds.open("more");
});
await page.waitForTimeout(300);
await page.click('[data-m="clean"]'); await page.waitForTimeout(300);
// 扩展数据
await page.click('[data-kind="ext"]'); await page.waitForTimeout(600);
let txt = await page.$eval(".pa-clean-other", (x) => x.innerText);
assert.match(txt, /oldUninstalled[\s\S]*可能已卸载/);
assert.match(txt, /regex[\s\S]*酒馆内置/);
assert.match(txt, /goodext[\s\S]*推测属于：好扩展/);
assert.match(txt, /myHiddenKey[\s\S]*可能已卸载/);
assert.ok(await page.$('.pa-clean-other .pa-tiprow [data-x="scan"]'), "「实际检测」和「ⓘ 说明」在同一行");
await page.click('[data-x="scan"]');
await page.waitForFunction(() => document.querySelector(".pa-clean-other")?.innerText.includes("重新检测"), null, { timeout: 10000 });
txt = await page.$eval(".pa-clean-other", (x) => x.innerText);
assert.match(txt, /myHiddenKey[\s\S]*检测：好扩展在用/, "跟进相对 import 后找到使用者");
assert.match(txt, /oldUninstalled[\s\S]*检测：已安装扩展的代码里没找到它，疑似卸载残留，删除前请核对/);
assert.match(txt, /勾选 1 项疑似残留/);
assert.match(txt, /goodext[\s\S]*名称像「好扩展」，请确认/);
assert.ok(await page.$eval('.pa-clean-other input[data-k="mcdonalds"]', (x) => x.disabled));
await page.screenshot({ path: S + "m-1-ext.png" });
await page.click('[data-x="pickorphans"]'); await page.waitForTimeout(200);
assert.ok(await page.$eval('.pa-clean-other input[data-k="oldUninstalled"]', (x) => x.checked), "疑似残留被勾选");
// 备份不强制：「下载备份」下载后弹窗还在、不删；取消不删；「删除」才删
const topSheet = ".pa-sheet-mask:not(.pa-out) .pa-sheet";
assert.equal(await page.$eval('[data-x="del"]', (x) => x.textContent), "删除");
await page.click('[data-x="del"]'); await page.waitForTimeout(200);
const dl = page.waitForEvent("download");
await page.click(`${topSheet} button:has-text("下载备份")`);
assert.match((await dl).suggestedFilename(), /^extension-data-backup-\d+\.json$/);
await page.waitForTimeout(250);
assert.match(await page.$eval(topSheet, (x) => x.innerText), /已让浏览器下载「extension-data-backup-\d+\.json」/);
assert.ok(await page.evaluate(() => "oldUninstalled" in window.SillyTavern.getContext().extensionSettings), "下载不等于删除");
await page.click(`${topSheet} button:has-text("取消")`); await page.waitForTimeout(250);
assert.ok(await page.evaluate(() => "oldUninstalled" in window.SillyTavern.getContext().extensionSettings), "取消后不删除");
await page.click('[data-x="del"]'); await page.waitForTimeout(200);
await page.click(`${topSheet} .pa-btn-danger`); await page.waitForTimeout(250);
assert.ok(!(await page.evaluate(() => "oldUninstalled" in window.SillyTavern.getContext().extensionSettings)), "不下载也能删");
// 角色卡
await page.click('[data-kind="char"]'); await page.waitForTimeout(300);
txt = await page.$eval(".pa-clean-other", (x) => x.innerText);
assert.match(txt, /同名 1 组/);
await page.waitForFunction(() => document.querySelector(".pa-clean-other")?.innerText.includes("不同之处"), null, { timeout: 5000 });
txt = await page.$eval(".pa-clean-other", (x) => x.innerText);
assert.match(txt, /不同之处：描述、开场白/, "按需加载的角色卡向服务器读取完整内容后逐项比较");
assert.deepEqual(charGets.sort(), ["jiang.png", "jiang1.png"]);
assert.ok(await page.$eval('.pa-clean-other input[data-k="jiang.png"]', (x) => x.disabled), "正在聊天的不能勾选");
await page.screenshot({ path: S + "m-2-char.png" });
// 忽略：这一组不再提示；切走再切回来也不提示；「重新检测」后重新出现（1.9.0）
await page.click('.pa-clean-other [data-x="ignore"]'); await page.waitForTimeout(150);
txt = await page.$eval(".pa-clean-other", (x) => x.innerText);
assert.match(txt, /同名的都已忽略/); assert.ok(!(await page.$('.pa-clean-other input[data-k="jiang1.png"]')), "忽略后不再列出");
await page.click('[data-kind="world"]'); await page.waitForTimeout(150);
await page.click('[data-kind="char"]'); await page.waitForTimeout(200);
assert.match(await page.$eval(".pa-clean-other", (x) => x.innerText), /同名的都已忽略/, "切回来仍不提示");
await page.click('.pa-clean-other [data-x="recheck"]'); await page.waitForTimeout(250);
assert.match(await page.$eval(".pa-clean-other", (x) => x.innerText), /同名 1 组/, "重新检测后再次提示");
await page.waitForTimeout(300);
assert.equal(charGets.length, 4, "重新检测会重新读取内容");
await page.click('.pa-clean-other input[data-k="jiang1.png"]'); await page.waitForTimeout(100);
await page.evaluate(() => { window.__delChars = ["jiang1.png"]; });
await page.click('[data-x="del"]'); await page.waitForTimeout(200);
await page.click(".pa-sheet .pa-btn-danger"); await page.waitForTimeout(500);
assert.deepEqual(deleted, [{ avatar_url: "jiang1.png", delete_chats: false }]);
assert.match(await page.$eval(".pa-clean-other", (x) => x.innerText), /没有同名/);
// 世界书：复制一本相同的、加一本空的
// 已删除角色卡留下的：「X's Lorebook」X 不在；带 originalData 且对不上；已删角色的附加世界书。现有角色的不算
await page.evaluate(() => {
  const s = globalThis.__wiStore, e = { 1: { uid: 1, comment: "c", content: "设定", key: ["k"] } };
  s["Alice's Lorebook"] = { entries: structuredClone(e) };
  s["Julian's Lorebook"] = { entries: { 1: { uid: 1, comment: "jl", content: "Julian", key: ["jl"] } } };
  s["旧卡世界书"] = { entries: { 1: { uid: 1, comment: "o", content: "旧卡", key: ["o"] } }, originalData: { name: "旧卡世界书", entries: [] } };
  s["姜泰温世界书"] = { entries: { 1: { uid: 1, comment: "j", content: "姜", key: ["j"] } }, originalData: { name: "姜泰温", entries: [] } };
  s["附加残留"] = { entries: { 1: { uid: 1, comment: "a", content: "附加", key: ["a"] } } };
  s["附加在用"] = { entries: { 1: { uid: 1, comment: "b", content: "附加2", key: ["b"] } } };
});
await page.evaluate(async () => {
  const m = await import("/test/site/scripts/world-info.js");
  m.world_info.charLore = [{ name: "gone", extraBooks: ["附加残留"] }, { name: "julian", extraBooks: ["附加在用"] }];
});
await page.evaluate(() => { const s = globalThis.__wiStore; s["示例世界书-副本"] = structuredClone(s["示例世界书"]); s["空的"] = { entries: {} }; });
await page.evaluate(async () => { const m = await import("/test/site/scripts/world-info.js"); m.world_names.push("示例世界书-副本", "空的", "Alice's Lorebook", "Julian's Lorebook", "旧卡世界书", "姜泰温世界书", "附加残留", "附加在用"); });
await page.click('[data-kind="world"]'); await page.waitForTimeout(200);
await page.click('[data-x="scan"]');
await page.waitForFunction(() => document.querySelector(".pa-clean-other")?.innerText.includes("重新检查"), null, { timeout: 10000 });
txt = await page.$eval(".pa-clean-other", (x) => x.innerText);
assert.match(txt, /条目完全相同（1 组）/); assert.match(txt, /全局启用/); assert.match(txt, /没有条目的世界书（\d）/);
assert.match(txt, /已删除角色卡留下的（3）/);
const leftNames = await page.$$eval(".pa-ck-left input[data-k]", (xs) => xs.map((x) => x.dataset.k).sort());
assert.deepEqual(leftNames, ["Alice's Lorebook", "旧卡世界书", "附加残留"].sort(), "现有角色的、附加在现有角色上的不算");
assert.match(await page.$eval(".pa-ck-left", (x) => x.innerText), /原角色「Alice」/);
await page.click('[data-x="pickleft"]'); await page.waitForTimeout(100);
assert.equal(await page.$$eval(".pa-ck-left input:checked", (xs) => xs.length), 3, "一键勾选残留");
assert.equal(await page.$('[data-x="pickleft"]'), null, "都勾上后按钮消失");
for (const k of leftNames) await page.click(`.pa-ck-left input[data-k="${k}"]`);
await page.waitForTimeout(100);
await page.screenshot({ path: S + "m-3-world.png" });
await page.click('.pa-clean-other input[data-k="示例世界书-副本"]'); await page.waitForTimeout(100);
const wbHas = (n) => page.evaluate(async (n) => (await import("/test/site/scripts/world-info.js")).world_names.includes(n), n);
const top = ".pa-sheet-mask:not(.pa-out) .pa-sheet";
// 备份不强制：弹窗里提醒，点「下载备份」下载后弹窗还在，再点「删除」
assert.equal(await page.$eval('[data-x="del"]', (x) => x.textContent), "删除");
await page.click('[data-x="del"]'); await page.waitForTimeout(200);
assert.match(await page.$eval(top, (x) => x.innerText), /需要的话先下载备份/);
const dl2 = page.waitForEvent("download");
await page.click(`${top} button:has-text("下载备份")`);
assert.match((await dl2).suggestedFilename(), /^worldbooks-backup-\d+\.zip$/);
await page.waitForTimeout(300);
assert.ok(await wbHas("示例世界书-副本"), "下载不等于删除");
assert.match(await page.$eval(top, (x) => x.innerText), /已让浏览器下载「worldbooks-backup-\d+\.zip」/, "弹窗还在，写明已下载");
await page.click(`${top} .pa-btn-danger`); await page.waitForTimeout(400);
assert.ok(!(await wbHas("示例世界书-副本")));
// 不下载直接删
let dlCount = 0;
page.on("download", () => dlCount++);
await page.click('.pa-clean-other input[data-k="空的"]'); await page.waitForTimeout(100);
await page.click('[data-x="del"]'); await page.waitForTimeout(200);
await page.click(`${top} .pa-btn-danger`); await page.waitForTimeout(400);
assert.ok(!(await wbHas("空的")), "不下载也能删");
assert.equal(dlCount, 0, "没点下载就不下载");
// 取消不删
await page.click('.pa-clean-other input[data-k="Alice\'s Lorebook"]'); await page.waitForTimeout(100);
await page.click('[data-x="del"]'); await page.waitForTimeout(200);
await page.click(`${top} button:has-text("取消")`); await page.waitForTimeout(300);
assert.ok(await wbHas("Alice's Lorebook"), "取消不删");
// 2.6.3 酒馆的 deleteWorldInfo 返回 false（它的名单里没有这本书）：改用接口删；本来就不在了也算删掉；失败的合成一条提示
await page.evaluate(async () => {
  window.__toasts = [];
  window.toastr = Object.fromEntries(["success", "info", "warning", "error"].map((k) => [k, (m) => window.__toasts.push(`${k}:${m}`)]));
  const m = await import("/test/site/scripts/world-info.js");
  for (const n of ["Alice's Lorebook", "附加残留"]) m.world_names.splice(m.world_names.indexOf(n), 1);
});
let delCalls = 0;
await page.route("**/api/worldinfo/delete", (r) => { delCalls++; const n = JSON.parse(r.request().postData()).name; r.fulfill(n === "附加残留" ? { status: 500, body: `World info file ${n}.json doesn't exist.` } : { status: 200, body: "ok" }); });
await page.click('.pa-clean-other input[data-k="附加残留"]'); await page.waitForTimeout(100);
await page.click('[data-x="del"]'); await page.waitForTimeout(200);
await page.click(`${top} .pa-btn-danger`); await page.waitForTimeout(500);
const wbToasts = await page.evaluate(() => window.__toasts.splice(0));
assert.equal(delCalls, 2, "两本都改用接口删");
assert.ok(!wbToasts.some((t) => t.startsWith("error:")), wbToasts.join("|"));
assert.ok(wbToasts.includes("success:已删除 2 本世界书"), wbToasts.join("|"));
await page.unroute("**/api/worldinfo/delete");
// 本地备份
await page.evaluate(async () => { for (let i = 0; i < 5; i++) await new Promise((res, rej) => { const rq = indexedDB.open("mcdonalds", 2); rq.onupgradeneeded = () => { const d = rq.result; if (!d.objectStoreNames.contains("backups")) d.createObjectStore("backups", { keyPath: "id", autoIncrement: true }).createIndex("preset", "preset"); if (!d.objectStoreNames.contains("assets")) d.createObjectStore("assets"); }; rq.onerror = () => rej(rq.error); rq.onsuccess = () => { const t = rq.result.transaction("backups", "readwrite"); t.objectStore("backups").add({ preset: "P1", reason: "x", time: i, data: { prompts: ["z".repeat(1000)] } }); t.oncomplete = () => { rq.result.close(); res(); }; t.onerror = () => rej(t.error); }; }); });
await page.click('[data-kind="local"]'); await page.waitForTimeout(600);
assert.match(await page.$eval(".pa-clean-other", (x) => x.innerText), /备份 5 份/);
await page.screenshot({ path: S + "m-4-local.png" });
// 2.4.2：保留份数、立即精简、自动备份开关
assert.ok(await page.$eval('[data-x="trim"]', (x) => x.disabled), "没超出默认 10 份时不能精简");
assert.equal(await page.locator('[data-bk="dec"]').count(), 0, "自动备份设置默认折起");
await page.click('.pa-bk-head b'); await page.waitForTimeout(100);
for (let i = 0; i < 7; i++) await page.click('[data-bk="dec"]');
assert.equal(await page.$eval('[data-bk="n"]', (x) => x.value), "3");
assert.equal(await page.evaluate(() => window.SillyTavern.getContext().extensionSettings.mcdonalds.backupMax), 3);
await page.fill('[data-bk="n"]', "99"); await page.press('[data-bk="n"]', "Tab"); await page.waitForTimeout(100);
assert.equal(await page.$eval('[data-bk="n"]', (x) => x.value), "30", "上限 30");
await page.fill('[data-bk="n"]', "3"); await page.press('[data-bk="n"]', "Tab"); await page.waitForTimeout(100);
await page.click('[data-x="trim"]'); await page.waitForTimeout(200);
assert.match(await page.$eval(".pa-sheet", (x) => x.innerText), /精简至每个预设 3 份[\s\S]*1 个预设超出，共 2 份/);
await page.click(".pa-sheet .pa-btn-danger"); await page.waitForTimeout(800);
assert.match(await page.$eval(".pa-clean-other", (x) => x.innerText), /备份 3 份/);
await page.screenshot({ path: S + "m-4b-local-trim.png" });
await page.click(".pa-bk-set .pa-switch"); await page.waitForTimeout(150);
assert.equal(await page.evaluate(() => window.SillyTavern.getContext().extensionSettings.mcdonalds.autoBackup), false);
assert.match(await page.$eval(".pa-bk-set", (x) => x.innerText), /已关闭/);
assert.ok(await page.$eval('[data-bk="n"]', (x) => x.disabled), "关闭后份数不能改");
await page.screenshot({ path: S + "m-4c-local-off.png" });
await page.click(".pa-bk-set .pa-switch"); await page.waitForTimeout(150);
// 回到预设栏
await page.click('[data-kind="preset"]'); await page.waitForTimeout(300);
assert.ok(await page.$(".pa-clean-body .pa-sum"));
// 日落海岸
await page.click('[data-m="look"]'); await page.click('[data-theme-id="dusk"]'); await page.waitForTimeout(200);
await page.screenshot({ path: S + "m-5-dusk.png" });
await page.evaluate(() => window.__mcdonalds.open("organize")); await page.waitForTimeout(300);
await page.screenshot({ path: S + "m-6-dusk-organize.png" });
assert.deepEqual(errs, []);
console.log("清理其他几栏检查全部通过");
await browser.close();
