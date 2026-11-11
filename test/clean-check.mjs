// 清理页（预设归档、恢复、删除）和加载体检的端到端检查
// 用法：在仓库根目录起静态服务（python3 -m http.server 8765）；node test/clean-check.mjs
import { chromium } from "playwright";
const S = new URL("./shots/", import.meta.url).pathname;
import assert from "node:assert";
const exe = process.env.PW_CHROME || undefined;
const browser = await chromium.launch({ executablePath: exe });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, acceptDownloads: true });
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
// 模拟酒馆服务器：用户文件、预设保存/删除
const files = new Map(), calls = { del: [], save: [], fdel: [] };
await page.route("**/api/files/upload", async (r) => {
  const b = r.request().postDataJSON();
  files.set(`user/files/${b.name}`, Buffer.from(b.data, "base64"));
  r.fulfill({ json: { path: `/user/files/${b.name}` } });
});
await page.route("**/api/files/verify", (r) => r.fulfill({ json: Object.fromEntries(r.request().postDataJSON().urls.map((u) => [u, files.has(u)])) }));
await page.route("**/api/files/delete", (r) => { const p = r.request().postDataJSON().path; calls.fdel.push(p); files.delete(p); r.fulfill({ status: 200, body: "" }); });
await page.route("**/user/files/**", (r) => {
  const k = decodeURIComponent(new URL(r.request().url()).pathname).replace(/^.*?(user\/files\/)/, "$1");
  const b = files.get(k);
  b ? r.fulfill({ body: b, contentType: "application/gzip" }) : r.fulfill({ status: 404 });
});
await page.route("**/api/presets/delete", (r) => { calls.del.push(r.request().postDataJSON()); r.fulfill({ status: 200, body: "" }); });
await page.route("**/api/presets/save", (r) => { const b = r.request().postDataJSON(); calls.save.push(b); r.fulfill({ json: { name: b.name } }); });
await page.goto("http://127.0.0.1:8765/test/site/index.html");
await page.waitForFunction(() => window.__mcdonalds?.open, null, { timeout: 15000 });

// 加几个「可清理」的预设：旧版本、完全相同的两份；再加一个方案用着旧版本
await page.evaluate(() => {
  const m = window.__mock;
  const zsx = m.presets[m.names.length - 1];
  const old = structuredClone(zsx);
  old.prompts = old.prompts.slice(0, Math.floor(old.prompts.length * 0.8));
  const twin = { prompts: [{ identifier: "a", name: "甲", content: "双人成行的第一条，内容足够长，可以算指纹。" }, { identifier: "b", name: "乙", content: "双人成行的第二条，内容足够长，可以算指纹。" }], prompt_order: [] };
  m.names.push("【众生相】Claude-Lite-v1.7", "双人成行 V6.0", "双人成行 V6.0(1)", "独立的小预设");
  m.presets.push(old, twin, structuredClone(twin), { prompts: [{ identifier: "z", content: "完全不同的内容，独立存在，不该被标记。" }] });
  // 让预设列表像酒馆一样是同一个对象（删除后能看到变化）
  const c = window.SillyTavern.getContext();
  const base = c.getPresetManager();
  const map = Object.fromEntries(m.names.map((n, i) => [n, i]));
  c.getPresetManager = () => ({ ...base, getPresetList: () => ({ presets: m.presets, preset_names: map }) });
  c.getRequestHeaders = () => ({ "Content-Type": "application/json" });
  c.extensionSettings.mcdonalds = { schemes: [{ id: "s1", name: "旧文风", preset: "【众生相】Claude-Lite-v1.7", scope: "all", states: {}, groupStates: {} }] };
  window.__mcdonalds.open("more");
});
await page.waitForTimeout(300);
await page.click('[data-m="clean"]');
await page.waitForSelector(".pa-cpair");
await page.waitForTimeout(300);
// 「可清理」按相近的两份折叠成组，默认收起
assert.equal(await page.$$eval(".pa-cpair", (xs) => xs.length), 2);
assert.equal(await page.$$eval(".pa-cpair[open]", (xs) => xs.length), 0, "默认折叠");
const heads = await page.$$eval(".pa-cpair > summary", (xs) => xs.map((x) => x.textContent));
assert.ok(heads.some((h) => h.includes("双人成行 V6.0(1)") && h.includes("↔") && h.includes("完全相同")), "组标题同时列出两份");
for (const sum of await page.$$(".pa-cpair > summary")) await sum.click();
await page.waitForTimeout(150);
const all2 = await page.$$eval(".pa-cpair .pa-crow", (xs) => xs.map((x) => x.querySelector("b").textContent + " | " + [...x.querySelectorAll(".pa-chip")].map((c) => c.textContent).join(",")));
console.log(all2.join("\n"));
assert.equal(all2.length, 4, "两份都列出来：建议保留 + 可清理");
assert.equal(all2.filter((r) => r.includes("建议保留")).length, 2);
const rows = all2.filter((r) => !r.includes("建议保留"));
assert.equal(rows.length, 2, "可清理：旧版本 + 重复的一份");
// 勾选后重画，展开状态保留
await page.locator('.pa-cpair .pa-crow', { hasText: "建议保留" }).filter({ hasText: "双人成行" }).locator("input").check();
await page.waitForTimeout(100);
assert.equal(await page.$$eval(".pa-cpair[open]", (xs) => xs.length), 2, "勾选后保持展开");
assert.match(await page.locator(".pa-cpair", { hasText: "双人成行" }).locator("summary").innerText(), /已选 1/);
await page.locator('.pa-cpair .pa-crow', { hasText: "建议保留" }).filter({ hasText: "双人成行" }).locator("input").uncheck();
assert.ok(rows.some((r) => r.startsWith("【众生相】Claude-Lite-v1.7") && r.includes("有新版") && r.includes("方案「旧文风」在用")));
assert.ok(rows.some((r) => r.startsWith("双人成行 V6.0(1)") && r.includes("完全相同")));
await page.screenshot({ path: S + "c-1-suggest.png" });
await page.click('[data-f="all"]');
await page.waitForTimeout(150);
assert.equal(await page.$$eval(".pa-crow", (xs) => xs.length), 5);
assert.ok(await page.$eval(".pa-crow.pa-locked input", (x) => x.disabled), "当前预设不能勾选");
await page.click('[data-f="suggest"]');
await page.click('[data-c="all"]');
await page.waitForTimeout(150);
assert.ok(!(await page.$eval(".pa-clean-act", (x) => x.hidden)));
await page.screenshot({ path: S + "c-2-selected.png" });
// 归档（同时下载 zip）
await page.click('.pa-clean-act [data-c="arch"]');
await page.waitForSelector(".pa-sheet [data-zip]");
await page.waitForTimeout(400);
await page.screenshot({ path: S + "c-3-confirm.png" });
const dl = page.waitForEvent("download");
await page.click(".pa-sheet .pa-btn-primary");
const d = await dl;
assert.match(d.suggestedFilename(), /^preset-archive-\d+\.zip$/);
await d.saveAs("/tmp/claude-0/archive-test.zip");
await page.waitForFunction(() => (window.SillyTavern.getContext().extensionSettings.mcdonalds.archive || []).length === 2, null, { timeout: 10000 });
await page.waitForTimeout(500);
assert.equal(calls.del.length, 2, "删了两个预设文件");
assert.equal(files.size, 2, "服务器上有两个归档文件");
const st = await page.evaluate(() => ({ arch: window.SillyTavern.getContext().extensionSettings.mcdonalds.archive, names: Object.keys(window.SillyTavern.getContext().getPresetManager().getPresetList().preset_names) }));
assert.equal(st.arch.length, 2);
assert.ok(!st.names.includes("双人成行 V6.0(1)"));
assert.ok(st.arch.every((a) => a.gz && a.path.startsWith("user/files/pa-preset-")));
await page.click('[data-f="arch"]');
await page.waitForTimeout(200);
await page.screenshot({ path: S + "c-4-archived.png" });
// 套用方案 → 自动从归档恢复
await page.click('.pa-tabs [data-nav="more"]'); await page.click('.pa-subnav [data-m="schemes"]');
await page.waitForTimeout(200);
const card = page.locator(".pa-srow", { hasText: "旧文风" });
assert.match(await card.innerText(), /已归档/);
await card.locator('[data-a="apply"]').click();
await page.waitForTimeout(1200);
assert.equal(calls.save.length, 1, "套用方案时恢复了归档");
assert.equal(calls.save[0].name, "【众生相】Claude-Lite-v1.7");
assert.ok(Array.isArray(calls.save[0].preset.prompts), "恢复的是完整预设");
assert.equal(files.size, 1, "恢复后归档文件删除");
// 在清理页点「恢复」恢复另一份
await page.click('.pa-tabs [data-nav="more"]');
await page.click('[data-m="clean"]');
await page.click('[data-f="arch"]');
await page.waitForTimeout(200);
assert.equal((await page.$$('[data-c="restore"]')).length, 1);
await page.click('[data-c="restore"]');
await page.waitForTimeout(800);
assert.equal(calls.save.length, 2);
assert.equal(calls.save[1].name, "双人成行 V6.0(1)");
assert.equal(files.size, 0);
const names2 = await page.evaluate(() => Object.keys(window.SillyTavern.getContext().getPresetManager().getPresetList().preset_names));
assert.ok(names2.includes("双人成行 V6.0(1)") && names2.includes("【众生相】Claude-Lite-v1.7"));
// 加载体检：模拟用户那次打开的请求记录
await page.evaluate(() => {
  const E = (name, start, dur, size, rs, extra) => ({ name: location.origin + name, startTime: start, duration: dur, requestStart: start + 20, transferSize: size, encodedBodySize: size, decodedBodySize: size * 4, responseStart: rs ?? start + 500, responseEnd: start + dur, initiatorType: "fetch", workerStart: 0, ...extra });
  const list = [
    E("/api/plugins/baibaoku/v1/settings/fast-get", 1200, 34600, 11.2 * 1048576, 3000),
    E("/api/characters/all", 2500, 20500, 2.7 * 1048576, 4000),
    E("/api/characters/get", 9000, 7000, 200000, 15000),
    E("/scripts/extensions/third-party/JS-Slash-Runner/dist/index.js", 1500, 9000, 900000, 2000),
    ...Array.from({ length: 8 }, (_, i) => E(`/thumbnail?type=avatar&file=秘密角色${i}.png`, 30000, 25600 - i * 100, 300, 55000)),
    E("/api/plugins/baibaoku/v1/settings/fast-save", 60000, 15600, 330, 75000),
    { name: "https://cdn.example.net/lib.js", startTime: 800, duration: 2400, requestStart: 0, responseStart: 0, responseEnd: 3200, transferSize: 0, encodedBodySize: 0, decodedBodySize: 0, initiatorType: "script", workerStart: 0 }
  ];
  const orig = performance.getEntriesByType.bind(performance);
  performance.getEntriesByType = (t) => t === "resource" ? list : orig(t);
  globalThis.__mcdTiming.readyAt = 85100;
});
await page.click('[data-m="health"]');
await page.waitForSelector(".pa-tl", { state: "attached" });
await page.waitForTimeout(300);
// 说明默认收起，用 textContent 连收起的部分一起检查
const htxt = await page.$eval(".pa-health-body", (x) => x.textContent);
assert.match(htxt, /接收速率估计/);
assert.match(htxt, /不是服务器带宽上限/);
assert.match(htxt, /聊天可操作\s*未测得/);
assert.match(htxt, /启动完成前记录到设置保存请求/);
assert.doesNotMatch(htxt, /排队|实测服务器下载速度/, "不把小请求耗时长判成排队，不把接收速率说成服务器速度");
assert.match(htxt, /全部角色列表/); assert.match(htxt, /单张角色详情/);
assert.match(htxt, /走柏宝库接口/);
assert.match(htxt, /外部网站[\s\S]*未取得/, "跨域拿不到的体积标未取得");
assert.match(htxt, /内存中的大小是序列化后的统计量，不是网络传输量/);
await page.screenshot({ path: S + "c-5-health.png", fullPage: false });
// 每笔明细、导出报告（脱敏）
await page.click('[data-h="detail"]'); await page.waitForTimeout(200);
assert.match(await page.$eval(".pa-health-detail", (x) => x.innerText), /\/thumbnail/);
assert.doesNotMatch(await page.$eval(".pa-health-detail", (x) => x.innerText), /秘密角色/);
const rd = page.waitForEvent("download");
await page.click('[data-h="export"]');
const rep = JSON.parse(await (await import("node:fs")).promises.readFile(await (await rd).path(), "utf8"));
assert.equal(rep.format, "mcdonalds-diagnostics/1");
assert.equal(rep.timing.chatInteractive, null);
assert.ok(rep.categories.some((c) => c.cat === "settings" && c.providers["柏宝库"] === 1));
assert.ok(!JSON.stringify(rep).includes("秘密角色"), "报告不含角色文件名");
await page.$eval(".pa-health .pa-scroll, .pa-health", (x) => { x.scrollTop = 99999; });
await page.screenshot({ path: S + "c-6-health-bottom.png" });
// 去清理按钮
if (await page.$('[data-h="clean"]')) {
  await page.click('[data-h="clean"]');
  await page.waitForTimeout(200);
  assert.ok(await page.$eval('[data-m="clean"]', (b) => b.classList.contains("on")));
}
// 玫瑰芋泥
await page.click('[data-m="look"]');
await page.click('[data-theme-id="taro"]');
await page.waitForTimeout(200);
await page.screenshot({ path: S + "c-7-taro.png" });
await page.click('[data-m="clean"]');
await page.click('[data-f="all"]');
await page.waitForTimeout(200);
await page.screenshot({ path: S + "c-8-taro-clean.png" });
await page.evaluate(() => window.__mcdonalds.open("organize"));
await page.waitForTimeout(300);
await page.screenshot({ path: S + "c-9-taro-organize.png" });
assert.deepEqual(errs, []);
console.log("清理与体检检查全部通过");
await browser.close();
