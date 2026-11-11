// 方案：按角色卡分组、点箭头展开；保存时记到当前角色并可绑定本聊天；同一聊天里自动套用只做一次。
// 用法同 clean-check.mjs
import { chromium } from "playwright";
import assert from "node:assert";
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
await page.goto("http://127.0.0.1:8765/test/site/index.html");
await page.waitForFunction(() => window.__mcdonalds?.open, null, { timeout: 15000 });
const ok = (m) => console.log("✓", m);
const S = () => page.evaluate(() => window.SillyTavern.getContext().extensionSettings.mcdonalds);

await page.evaluate(() => {
  const c = window.SillyTavern.getContext();
  c.characters = [{ name: "沈砚", avatar: "shen.png" }, { name: "林栖", avatar: "lin.png" }];
  c.characterId = "0";
  const m = window.__mock;
  c.extensionSettings.mcdonalds = { schemes: [{ id: "old", name: "旧方案", preset: m.names[0], scope: "all", states: {}, groupStates: {} }] };
  window.__mcdonalds.open("more", "schemes");
});
await page.waitForTimeout(500);

// 1) 当前角色还没有这个预设的方案：顶上提示；保存时记到角色下面，并绑定本聊天
assert.match(await page.$eval(".pa-scheme-nudge", (x) => x.textContent), /沈砚.*还没有/);
await page.click(".pa-scheme-nudge [data-s=new]"); await page.waitForTimeout(200);
assert.ok(await page.locator(".pa-sheet [data-f=char]").isChecked(), "默认记到当前角色");
await page.fill(".pa-sheet [data-f=name]", "沈砚·正剧");
await page.check(".pa-sheet [data-f=bind]");
await page.click(".pa-sheet-actions .pa-btn-primary"); await page.waitForTimeout(400);
let st = await S();
const mine = st.schemes.find((x) => x.name === "沈砚·正剧");
assert.equal(mine.charKey, "shen.png");
assert.equal(mine.conn, null, "API 默认不记录");
assert.equal(mine.persona, "u.png", "人设默认记当前人设");
assert.equal(await page.evaluate(() => window.SillyTavern.getContext().chatMetadata.mcdonaldsScheme), mine.id);
ok("保存时记到当前角色，并绑定本聊天");

// 2) 按角色卡分组：当前角色一组展开，「未分角色」收起，点箭头展开
const heads = await page.$$eval(".pa-sghead b", (x) => x.map((y) => y.textContent));
assert.deepEqual(heads, ["沈砚", "未分角色"]);
assert.match(await page.locator(".pa-sgroup.open", { hasText: "沈砚" }).innerText(), /沈砚·正剧[\s\S]*本聊天/);
const other = page.locator(".pa-sgroup", { hasText: "未分角色" });
if (await other.evaluate((x) => x.classList.contains("open"))) { await other.locator(".pa-sghead").click(); await page.waitForTimeout(150); }
assert.equal(await other.locator(".pa-srow").count(), 0, "收起时不显示方案");
await other.locator(".pa-sghead").click(); await page.waitForTimeout(150);
assert.match(await page.locator(".pa-sgroup", { hasText: "未分角色" }).innerText(), /旧方案/);
ok("按角色卡分组，点箭头展开");

// 3) ✏️ 改归属角色
await page.locator(".pa-srow", { hasText: "旧方案" }).locator("[data-a=edit]").click(); await page.waitForTimeout(200);
await page.click(".pa-pick-item >> text=改归属角色"); await page.waitForTimeout(200);
await page.click(".pa-npick-item >> text=林栖"); await page.waitForTimeout(300);
st = await S();
assert.equal(st.schemes.find((x) => x.id === "old").charKey, "lin.png");
assert.ok((await page.$$eval(".pa-sghead b", (x) => x.map((y) => y.textContent))).includes("林栖"));
await page.click(".pa-sheet-x"); await page.waitForTimeout(300);
{ const g = page.locator(".pa-sgroup", { hasText: "林栖" }); if (!(await g.evaluate((x) => x.classList.contains("open")))) { await g.locator(".pa-sghead").click(); await page.waitForTimeout(150); } }
ok("✏️ 里改归属角色");

// 3b) ✏️ 做完一项回到菜单；改归属里「取消归属」按钮；方案行显示 API 站点名
await page.locator(".pa-srow", { hasText: "旧方案" }).locator("[data-a=edit]").click(); await page.waitForTimeout(200);
await page.click(".pa-pick-item >> text=改归属角色"); await page.waitForTimeout(200);
await page.click(".pa-npick-extra"); await page.waitForTimeout(300);
assert.equal((await S()).schemes.find((x) => x.id === "old").charKey, "", "取消归属");
assert.ok(await page.locator(".pa-pick-item >> text=改归属角色").isVisible(), "做完回到 ✏️ 菜单");
await page.click(".pa-pick-item >> text=改归属角色"); await page.waitForTimeout(200);
await page.click(".pa-npick-item >> text=林栖"); await page.waitForTimeout(300);
await page.click(".pa-sheet-x"); await page.waitForTimeout(300);
assert.equal(await page.locator(".pa-pick-item").count(), 0, "点 ✕ 才关掉");
await page.evaluate(() => { const st = window.SillyTavern.getContext().extensionSettings.mcdonalds; st.sites = [{ id: "s1", name: "tree", source: "custom", url: "https://t/v1" }]; st.schemes.find((x) => x.id === "old").siteId = "s1"; });
await page.click("[data-s=view]"); await page.waitForTimeout(200);
await page.click(".pa-npick-item >> text=角色卡"); await page.waitForTimeout(300);
const lin = page.locator(".pa-sgroup", { hasText: "林栖" });
if (!(await lin.evaluate((x) => x.classList.contains("open")))) { await lin.locator(".pa-sghead").click(); await page.waitForTimeout(150); }
assert.equal(await page.locator(".pa-srow", { hasText: "旧方案" }).locator(".pa-srow-api").innerText(), "API：tree");
ok("✏️ 做完一项回到菜单；取消归属；方案行显示 API 站点名");

// 4) 同一个聊天里再次收到聊天切换事件：不再自动套用（手动换的预设不会被换回去）
const before = await page.evaluate(() => window.__mock.live.preset_settings_openai);
await page.evaluate(async () => {
  const m = window.__mock, c = window.SillyTavern.getContext();
  const sc = c.extensionSettings.mcdonalds.schemes.find((x) => x.name === "沈砚·正剧");
  sc.preset = m.names.find((n) => n !== m.live.preset_settings_openai) || sc.preset;
  await c.eventSource.emit("chat_changed", "c1");
});
await page.waitForTimeout(1000);
assert.equal(await page.evaluate(() => window.__mock.live.preset_settings_openai), before, "同一聊天不重复套用");
ok("同一聊天里不重复自动套用");

// 5) 按预设看：同一批方案按预设分组
await page.click("[data-s=view]"); await page.waitForTimeout(200);
await page.click(".pa-npick-item >> text=预设"); await page.waitForTimeout(300);
const ph = await page.$$eval(".pa-sghead b", (x) => x.map((y) => y.textContent));
assert.ok(ph.length >= 1 && ph.every((x) => !/沈砚|林栖/.test(x)));
ok("可以改成按预设分组");

// 6) 🗑️ 勾选删除：整组勾选 + 单个勾选，删完绑定一起清掉
await page.click("[data-s=view]"); await page.waitForTimeout(200);
await page.click(".pa-npick-item >> text=角色卡"); await page.waitForTimeout(300);
assert.ok(!/API/.test(await page.locator(".pa-srow small").first().innerText()), "预设那一行不混进 API");
await page.click("[data-s=pickon]"); await page.waitForTimeout(150);
assert.equal(await page.locator("[data-s=delpicked]").isDisabled(), true);
await page.locator(".pa-srow", { hasText: "沈砚·正剧" }).click(); await page.waitForTimeout(150);
assert.match(await page.locator(".pa-scheme-pick").innerText(), /已选 1 个/);
await page.locator(".pa-sgroup", { hasText: "林栖" }).locator("[data-a=pickgroup]").check(); await page.waitForTimeout(150);
assert.match(await page.locator(".pa-scheme-pick").innerText(), /已选 2 个/);
await page.click("[data-s=delpicked]"); await page.waitForTimeout(200);
await page.click(".pa-sheet-actions .pa-btn-danger, .pa-sheet-actions .pa-btn-primary"); await page.waitForTimeout(400);
st = await S();
assert.equal(st.schemes.length, 0);
assert.equal(await page.evaluate(() => window.SillyTavern.getContext().chatMetadata.mcdonaldsScheme), undefined);
assert.equal(await page.locator("[data-s=pickon]").count(), 0, "没有方案时不显示 🗑️");
ok("🗑️ 勾选删除（单个、整组），绑定一起清掉");

// 7) 保存时改选当前连接，下次沿用；覆盖默认不动 API；「API 和模型」改回不记录
await page.click(".pa-head-btn[data-s=new]"); await page.waitForTimeout(200);
assert.equal(await page.$eval(".pa-sheet [data-f=api]", (x) => x.value), "__none");
assert.ok(await page.locator(".pa-sheet [data-f=apimodel]").isHidden(), "不记录时不显示模型");
await page.selectOption(".pa-sheet [data-f=api]", "__live");
await page.selectOption(".pa-sheet [data-f=persona]", "__none");
assert.equal(await page.locator(".pa-sheet [data-f=apimodelbtn] .pa-mn").innerText(), "claude-x");
await page.fill(".pa-sheet [data-f=name]", "带API");
await page.click(".pa-sheet-actions .pa-btn-primary"); await page.waitForTimeout(400);
st = await S();
let withApi = st.schemes.find((x) => x.name === "带API");
assert.equal(withApi.conn.url, "https://example.com/v1");
assert.equal(withApi.conn.model, "claude-x");
assert.equal(st.schemeApiPick, "__live");
assert.equal(withApi.persona, null, "人设可选不记录");
assert.equal(st.schemePersonaPick, "__none");
await page.click(".pa-head-btn[data-s=new]"); await page.waitForTimeout(200);
assert.equal(await page.$eval(".pa-sheet [data-f=api]", (x) => x.value), "__live", "沿用上次的选择");
assert.equal(await page.$eval(".pa-sheet [data-f=persona]", (x) => x.value), "__none");
assert.match(await page.locator(".pa-sheet .pa-tip-fold > summary").evaluate((x) => getComputedStyle(x, "::before").content), /▸/, "保存范围前有小三角");
await page.click(".pa-sheet-x"); await page.waitForTimeout(300);
ok("保存方案时 API 默认不记录，可选当前连接，下次沿用");

await page.evaluate(() => { window.__mock.live.custom_model = "other-model"; });
await page.locator(".pa-srow", { hasText: "带API" }).locator("[data-a=edit]").click(); await page.waitForTimeout(200);
await page.click(".pa-pick-item >> text=用现在的状态覆盖"); await page.waitForTimeout(200);
assert.equal(await page.locator(".pa-sheet [data-f=api]").isChecked(), false, "默认不换 API");
assert.equal(await page.locator(".pa-sheet [data-f=persona]").isChecked(), false, "方案没记人设时默认不换人设");
await page.locator(".pa-sheet-actions .pa-btn-primary").last().click(); await page.waitForTimeout(300);
assert.equal((await S()).schemes.find((x) => x.name === "带API").conn.model, "claude-x");
assert.equal((await S()).schemes.find((x) => x.name === "带API").persona, null);
await page.locator(".pa-pick-item").filter({ hasText: /^人设/ }).click(); await page.waitForTimeout(200);
await page.selectOption(".pa-sheet [data-f=persona]", "u.png");
await page.locator(".pa-sheet-actions .pa-btn-primary").last().click(); await page.waitForTimeout(300);
assert.equal((await S()).schemes.find((x) => x.name === "带API").personaName, "我", "✏️ 里改人设");
await page.click(".pa-pick-item >> text=API 和模型"); await page.waitForTimeout(200);
await page.selectOption(".pa-sheet [data-f=api]", "__none");
await page.locator(".pa-sheet-actions .pa-btn-primary").last().click(); await page.waitForTimeout(300);
assert.equal((await S()).schemes.find((x) => x.name === "带API").conn, null);
await page.click(".pa-sheet-x"); await page.waitForTimeout(300);
ok("覆盖时人设、API 默认保留；✏️ 里改人设；「API 和模型」可改回不记录");

assert.deepEqual(errs, []);
console.log("方案检查全部通过");
await browser.close();
