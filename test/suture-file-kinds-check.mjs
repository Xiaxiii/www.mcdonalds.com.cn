// 2.6.1 缝合页「文件」认预设、世界书、正则三种文件；来源类型菜单里的「正则」打开缝合正则窗口，来源类型不变。
// 先构建并在仓库根目录运行 8765 静态服务。
import { chromium } from "playwright";
import assert from "node:assert";
import { chooseSrcType } from "./choose.mjs";
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
await page.goto("http://127.0.0.1:8765/test/site/index.html");
await page.waitForFunction(() => window.__mcdonalds?.open, null, { timeout: 15000 });
const ok = (m) => console.log("✓", m);
await page.evaluate(() => {
  window.__toasts = [];
  window.toastr = Object.fromEntries(["success", "info", "warning", "error"].map((k) => [k, (m) => window.__toasts.push(`${k}:${m}`)]));
  window.SillyTavern.getContext().extensionSettings.mcdonalds = {};
  window.__mcdonalds.open("suture");
});
await page.waitForTimeout(400);
const load = async (name, data) => {
  await page.locator(".pa-src-pick input[type=file]").setInputFiles({ name, mimeType: "application/json", buffer: Buffer.from(typeof data === "string" ? data : JSON.stringify(data)) });
  await page.waitForTimeout(300);
};
const toasts = () => page.evaluate(() => window.__toasts.splice(0));

// 0) 类型菜单里有「正则」
await page.click('[data-st="srctype"]');
await page.waitForSelector(".pa-npick-item");
assert.deepEqual(await page.locator(".pa-npick-item").evaluateAll((x) => x.map((b) => b.dataset.v)), ["preset", "regex", "world", "file", "paste"]);
await page.click(".pa-sheet-mask:not(.pa-out) .pa-sheet-x"); await page.waitForTimeout(250);
ok("来源类型菜单：预设、正则、世界书、文件、粘贴");

await chooseSrcType(page, "file");
assert.match(await page.locator(".pa-src-pick .pa-file span").textContent(), /选择文件/);

// 1) 酒馆导出的世界书
await load("我的世界书.json", { entries: { 0: { uid: 0, key: ["城"], comment: "城市设定", content: "城市在海边。", disable: false, order: 100, position: 0, constant: false }, 1: { uid: 1, key: [], comment: "常驻", content: "常驻内容", disable: true, order: 90, constant: true } } });
let rows = await page.locator(".pa-src-list [data-wid]").allTextContents();
assert.deepEqual(rows.map((t) => t.trim()), ["常驻", "城市设定"], rows.join("|"));
assert.match(await page.locator(".pa-src-pick .pa-file span").textContent(), /我的世界书/);
await page.locator(".pa-src-list [data-wid]").nth(1).click(); await page.waitForTimeout(150);
assert.match(await page.locator(".pa-stitchbar, .pa-bar").first().textContent(), /1/);
ok("世界书文件：列出条目，可以选");

// 2) 角色卡内嵌的世界书（keys、enabled、insertion_order）
await load("角色卡.json", { spec: "chara_card_v2", data: { name: "林栖", character_book: { entries: [{ keys: ["雨"], content: "下雨时她会唱歌。", comment: "雨天", enabled: true, insertion_order: 5, extensions: { position: 1, depth: 4 } }] } } });
rows = await page.locator(".pa-src-list [data-wid]").allTextContents();
assert.deepEqual(rows.map((t) => t.trim()), ["雨天"]);
ok("角色卡内嵌世界书：换成世界书条目");

// 3) 酒馆导出的单条正则：读入后直接打开缝合正则窗口
await load("regex-状态栏.json", { id: "r1", scriptName: "状态栏美化", findRegex: "/<status>([\\s\\S]*?)<\\/status>/g", replaceString: "<div>$1</div>", placement: [2], disabled: false, markdownOnly: true, promptOnly: false });
await page.locator(".pa-sheet-mask:not(.pa-out) .pa-regex-transfer").waitFor({ timeout: 5000 });
assert.equal(await page.locator(".pa-sheet [data-rx-index]").count(), 1);
await page.locator(".pa-sheet-mask:not(.pa-out) .pa-sheet-actions .pa-btn", { hasText: "取消" }).click(); await page.waitForTimeout(300);
assert.match(await page.locator(".pa-src-list .pa-rx-src").textContent(), /1 条正则/);
ok("正则文件：读入即打开缝合正则窗口，关掉后来源栏可再打开");

// 4) 认不出的文件
await load("随便.json", { hello: "world" });
assert.match((await toasts()).join("|"), /无法识别/);
ok("认不出的文件给出提示");

// 5) 预设来源下点类型菜单「正则」：来源类型不变
await chooseSrcType(page, "preset");
await page.click('[data-st="srctype"]');
await page.waitForSelector(".pa-npick-item");
await page.click('.pa-npick-item[data-v="regex"]'); await page.waitForTimeout(400);
assert.match(await page.locator('[data-st="srctype"] span').textContent(), /预设/, "来源类型仍是预设");
assert.ok(await page.locator(".pa-src-list .pa-row").count() > 0, "来源栏仍是预设条目");
ok("类型菜单里的「正则」不改来源类型");

assert.deepEqual(errs, []);
await browser.close();
