// 1.9.0 阶段 C：扩展页「加载与兼容」卡片。启动时不发请求；点「检查兼容性」才读扩展列表、探测后端；
// 状态分开显示；同一方面两个提供者都开着时提示重叠；不改其他扩展的设置。用法同 clean-check.mjs
import { chromium } from "playwright";
import assert from "node:assert";
const S = new URL("./shots/", import.meta.url).pathname;
const exe = process.env.PW_CHROME || undefined;
const browser = await chromium.launch({ executablePath: exe });
const ok = (m) => console.log("✓", m);

async function boot({ globals = {}, routes = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, acceptDownloads: true });
  const page = await ctx.newPage();
  const errs = [], hits = [];
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("request", (r) => { if (/\/api\/(plugins|extensions)\//.test(r.url())) hits.push(r.method() + " " + new URL(r.url()).pathname); });
  await page.addInitScript((g) => { for (const [k, v] of Object.entries(g)) window[k] = v; }, globals);
  if (routes) {
    await page.route("**/api/extensions/discover", (r) => r.fulfill({ json: [
      { type: "local", name: "third-party/ST-BaiBai-Tools" }, { type: "local", name: "third-party/cocktail" },
      { type: "local", name: "third-party/cocktail-plus" }, { type: "local", name: "third-party/Burnt-chicken-wings" }
    ] }));
    await page.route("**/scripts/extensions/third-party/ST-BaiBai-Tools/manifest.json", (r) => r.fulfill({ json: { display_name: "柏宝箱", version: "1.0.0", js: "dist/index.js" } }));
    await page.route("**/scripts/extensions/third-party/cocktail/manifest.json", (r) => r.fulfill({ json: { display_name: "鸡尾酒", version: "0.1.17", js: "index.js" } }));
    await page.route("**/scripts/extensions/third-party/cocktail-plus/manifest.json", (r) => r.fulfill({ json: { display_name: "鸡尾酒+", version: "0.1.30", js: "dist/index.js" } }));
    await page.route("**/scripts/extensions/third-party/Burnt-chicken-wings/manifest.json", (r) => r.fulfill({ json: { display_name: "焦香鸡翅", version: "1.9.0", js: "index.js" } }));
    await page.route("**/api/plugins/baibaoku/v1/status", (r) => r.fulfill({ json: { ok: true, data: { installed: true, version: "0.6.4" } } }));
    await page.route("**/api/plugins/cocktail-plus/probe", (r) => r.fulfill({ status: 404, body: "" }));
  }
  await page.goto("http://127.0.0.1:8765/test/site/index.html");
  await page.waitForSelector("#pa-settings .pa-set-maint");
  await page.evaluate(() => {
    const c = window.SillyTavern.getContext();
    c.getRequestHeaders = () => ({ "Content-Type": "application/json" });
    c.extensionSettings.disabledExtensions = ["third-party/cocktail-plus"];
    c.extensionSettings.baiBaiToolkit = { fastCharacterListEnabled: true };
  });
  return { ctx, page, errs, hits };
}
const quick = (page) => page.$eval("#pa-settings .pa-set-quick", (x) => x.textContent);

// ---- 1) 没有其他加速扩展：显示未发现；本扩展不提供加速，「应用推荐配置」「停用加速」不可用；启动时不发请求
{
  const { ctx, page, errs, hits } = await boot();
  await page.waitForTimeout(800);
  assert.deepEqual(hits, [], "卡片显示前不读扩展列表、不探测后端");
  const t = await quick(page);
  assert.match(t, /已在运行的相关扩展\s*未发现/);
  assert.match(t, /本扩展的读取加速\s*未提供/);
  assert.equal(await page.$$eval('#pa-settings .menu_button.disabled', (x) => x.length), 0, "不再放用不了的按钮");
  assert.match(await page.$eval("#pa-settings .pa-set-maint .pa-set-sum", (x) => x.textContent), /没发现相关扩展/);
  assert.deepEqual(errs, []);
  ok("没有加速扩展时：不发请求，显示未发现，本扩展不提供加速");
  await ctx.close();
}

// ---- 2) 柏宝箱＋柏宝库、鸡尾酒在运行：分开显示安装、开启、后端、运行、版本；角色列表两个都开着时提示重叠
{
  const globals = {
    __baiBaiToolkitExtensionInstalled: {},
    __baibaokuEarlyBridge: { installed: true, settingsAccelerationEnabled: true, characterListAccelerationEnabled: true, extensionManifestBundleEnabled: false },
    __stStartupOptimizer: { settings: { enabled: true, prefetchEnabled: true } },
    __cocktailPanelLoaded: true
  };
  const { ctx, page, errs, hits } = await boot({ globals });
  await page.waitForTimeout(500);
  assert.deepEqual(hits, []);
  const before = await page.evaluate(() => JSON.stringify(window.SillyTavern.getContext().extensionSettings));
  assert.match(await quick(page), /柏宝箱、鸡尾酒/);
  assert.match(await quick(page), /启动桥接\s*柏宝库（已加载）/);
  await page.$eval("#pa-settings", (b) => b.scrollIntoView());
  await page.click("#pa-settings .pa-set-maint summary");
  await page.click('#pa-settings [data-c="check"]');
  await page.waitForSelector("#pa-settings .pa-set-table");
  const tbl = await page.$$eval("#pa-settings .pa-set-table tbody tr", (rs) => rs.map((r) => r.innerText.replace(/\s+/g, " ").trim()));
  const row = (n) => tbl.find((x) => x.startsWith(n + " "));
  assert.match(row("柏宝箱"), /已安装 是 — 是 1\.0\.0 已识别但未验证/);
  assert.match(row("柏宝库（后端）"), /已安装 — 可用 — 0\.6\.4 已识别但未验证/);
  assert.match(row("鸡尾酒+"), /已安装 否 不可用 否 0\.1\.30 未知/, "停用、后端不可用、没核对过的版本标未知");
  assert.match(row("酒馆助手"), /未安装 — — 否/);
  const areas = await page.$eval("#pa-settings .pa-set-areas", (x) => x.innerText);
  assert.match(areas, /设置／预设读取：柏宝库（开启）/);
  assert.match(areas, /角色列表：柏宝库（开启）、鸡尾酒（开启）[\s\S]*重叠/);
  assert.match(areas, /扩展清单与预加载：柏宝库（关闭）/);
  assert.match(areas, /设置、聊天写入[\s\S]*本扩展：本扩展不接管/);
  assert.doesNotMatch(areas.split("设置、聊天写入")[1], /重叠/, "写入、生成、渲染不判断重叠");
  assert.equal(await page.evaluate(() => JSON.stringify(window.SillyTavern.getContext().extensionSettings)), before, "检查不改任何扩展的设置");
  assert.ok(!hits.some((h) => /^POST .*\/api\/settings\//.test(h)));
  await page.screenshot({ path: S + "k-1-compat.png", fullPage: true });
  // 体检导出的报告里带上这次检查结果
  await page.evaluate(() => window.__presetAtelier.open("more", "health"));
  await page.waitForSelector(".pa-health-body .pa-kv", { state: "attached" });
  const rd = page.waitForEvent("download");
  await page.click('[data-h="export"]');
  const rep = JSON.parse(await (await import("node:fs")).promises.readFile(await (await rd).path(), "utf8"));
  assert.equal(rep.compatibility.checked, true);
  assert.ok(rep.compatibility.rows.some((r) => r.id === "baibaoku" && r.backend === "ok"));
  assert.deepEqual(errs, []);
  ok("状态分开显示；同一方面两个都开着时提示重叠；检查不改设置；报告带上检查结果");
  await ctx.close();
}

console.log("兼容卡片检查全部通过");
await browser.close();
