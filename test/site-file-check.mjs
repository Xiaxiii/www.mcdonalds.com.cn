// 2.5.10 站点导入、导出（JSON 文件）：认别处常见的写法；导出含密钥；再导入同名同网址的站点是更新，密钥一样就不重复存；
// 站点丢了密钥时，导入文件补回来。先构建并在仓库根目录运行 8765 静态服务。
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright";
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const errs = [];
const ok = (m) => console.log("✓", m);
try {
  const page = await browser.newPage({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, acceptDownloads: true });
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto("http://127.0.0.1:8765/test/site/index.html");
  await page.waitForFunction(() => window.__mcdonalds?.open);
  const S = () => page.evaluate(() => window.SillyTavern.getContext().extensionSettings.mcdonalds);
  const vault = () => page.evaluate(async () => (await import("/test/site/scripts/secrets.js")).secret_state.api_key_custom.length);
  const toasts = () => page.evaluate(() => window.__toasts.splice(0));
  await page.evaluate(() => {
    window.__toasts = [];
    window.toastr = Object.fromEntries(["success", "info", "warning", "error"].map((k) => [k, (m) => window.__toasts.push(`${k}:${m}`)]));
    window.SillyTavern.getContext().extensionSettings.mcdonalds = { sites: [], activeSiteId: null };
    window.__mcdonalds.open("conn");
  });
  await page.waitForTimeout(400);
  const importFile = async (name, text) => {
    if (await page.locator("[data-a=sitesedit]").count()) { await page.click("[data-a=sitesedit]"); await page.waitForTimeout(150); } await page.setInputFiles("[data-import-sites]", { name, mimeType: "application/json", buffer: Buffer.from(text) });
    await page.waitForTimeout(300);
  };

  // 2.11.3 同一浏览器里焦香鸡翅记下的余额记录：A站这把密钥在酒馆里的编号是 jc-a，读回的全文与导入的密钥相同
  const now = Date.now(), jcRecs = [{ t: now - 7200e3, bal: 10 }, { t: now - 3600e3, bal: 8 }];
  await page.route("**/api/secrets/find", (r) => {
    const body = r.request().postDataJSON();
    if (body?.id === "jc-a") return r.fulfill({ json: { value: "sk-aaaa1111" } });
    if (body?.id === "jc-x") return r.fulfill({ json: { value: "sk-别的密钥" } });
    return r.fulfill({ status: 404, body: "" });
  });
  await page.evaluate((recs) => {
    localStorage.setItem("presetAtelier:balance:default-user:custom\u0001https://a.example.com/v1\u0001jc-x", JSON.stringify([{ t: 1, bal: 99 }]));
    localStorage.setItem("presetAtelier:balance:default-user:custom\u0001https://a.example.com/v1\u0001jc-a", JSON.stringify(recs));
  }, jcRecs);
  const mcdBal = (secretId, url = "https://a.example.com/v1") => page.evaluate(([sid, u]) => JSON.parse(localStorage.getItem(`mcdonalds:balance:default-user:custom\u0001${u}\u0001${sid}`) || "[]"), [secretId, url]);

  // 1) 别处的写法：数组、baseUrl / apiKey、api_url + keys
  assert.equal(await page.locator('[data-a="exportsites"]').count(), 0, "没有站点时不显示导出");
  await importFile("my-apis.json", JSON.stringify([
    { name: "A站", baseUrl: "https://a.example.com/v1", apiKey: "sk-aaaa1111", model: "m1", models: ["m1", "m2"], remark: "月卡" },
    { title: "B站", api_url: "https://b.example.com/v1/", keys: [{ name: "按次", key: "sk-bbbb0001" }, { name: "按量", key: "sk-bbbb0002" }] },
    { name: "不是站点", foo: 1 }
  ]));
  const rows = await page.locator(".pa-imp-row").allTextContents();
  assert.equal(rows.length, 2, rows.join("|"));
  assert.match(rows[0], /A站.*新增.*a\.example\.com.*1 个密钥/);
  assert.match(rows[1], /B站.*新增.*2 个密钥/);
  await page.click(".pa-sheet-actions >> text=导入"); await page.waitForTimeout(400);
  let s = await S();
  assert.equal(s.sites.length, 2);
  const [a, b] = s.sites;
  assert.deepEqual([a.name, a.url, a.model, a.models, a.note, a.keyMask, !!a.secretId], ["A站", "https://a.example.com/v1", "m1", ["m1", "m2"], "月卡", "sk-…1111", true]);
  assert.deepEqual(b.keys.map((k) => [k.name, k.keyMask, !!k.secretId]), [["按次", "sk-…0001", true], ["按量", "sk-…0002", true]]);
  assert.equal(await vault(), 3);
  assert.match((await toasts()).join("|"), /新增 2 个/);
  assert.deepEqual(await mcdBal(a.secretId), jcRecs, "接过焦香鸡翅里同一把密钥的余额记录，不接别的密钥的");
  ok("导入时从焦香鸡翅接过对应密钥的余额记录");
  ok("导入别处写法的文件：预览后新增两个站点，密钥存进密钥库");

  // 2) 导出（含密钥）
  if (await page.locator("[data-a=sitesedit]").count()) { await page.click("[data-a=sitesedit]"); await page.waitForTimeout(150); } await page.click('[data-a="exportsites"]'); await page.waitForTimeout(200);
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click(".pa-pick-item >> text=含密钥")]);
  assert.match(dl.suggestedFilename(), /^api-sites-\d{8}-\d{4}\.json$/);
  const text = fs.readFileSync(await dl.path(), "utf8");
  const file = JSON.parse(text);
  assert.equal(file.format, "麦当劳-站点");
  assert.deepEqual(file.sites.map((x) => [x.name, x.url, x.keys.map((k) => k.key).join(",")]), [["A站", "https://a.example.com/v1", "sk-aaaa1111"], ["B站", "https://b.example.com/v1/", "sk-bbbb0001,sk-bbbb0002"]]);
  assert.deepEqual(file.sites[0].keys[0].balance, jcRecs, "导出带余额记录");
  assert.equal(file.sites[1].keys[0].balance, undefined, "没有记录的密钥不写");
  ok("导出含密钥：文件里是全文密钥、网址、模型");

  // 3) 再导入同一个文件：同名同网址是更新，密钥一样不重复存
  await importFile("back.json", text);
  assert.match((await page.locator(".pa-imp-row").allTextContents()).join("|"), /A站更新.*B站更新/);
  await page.click(".pa-sheet-actions >> text=导入"); await page.waitForTimeout(400);
  s = await S();
  assert.equal(s.sites.length, 2);
  assert.equal(await vault(), 3, "密钥一样，不重复存");
  assert.equal(s.sites[0].secretId, a.secretId);
  ok("再导入：更新已有站点，不重复存密钥");

  // 4) 站点丢了密钥（如更新后要重填）：导入补回来
  await page.evaluate(() => { const x = window.SillyTavern.getContext().extensionSettings.mcdonalds.sites[0]; x.secretId = null; x.keyMask = ""; });
  await importFile("back.json", text);
  await page.click(".pa-sheet-actions >> text=导入"); await page.waitForTimeout(400);
  s = await S();
  assert.ok(s.sites[0].secretId && s.sites[0].keyMask === "sk-…1111");
  assert.equal(await vault(), 4);
  ok("站点没了密钥：导入后补回");

  // 5) 别的扩展导出的分组格式（grouped-api-configs-export）：customUrl、groupName、apiKeys、models 里的 customModel、分类
  await importFile("api-configs-export.json", JSON.stringify({
    version: "2.0", exportTime: "2026-11-02T04:21:28.166Z", format: "grouped-api-configs-export", configs: [],
    configStore: {
      version: 2, format: "grouped-api-configs",
      categories: [{ id: "c1", name: "Claude" }, { id: "c2", name: "常用" }],
      groups: [{
        groupName: "🌲", groupKey: "🌲|https://tree.example.ai/v1", source: "custom", customUrl: "https://tree.example.ai/v1",
        apiKeys: [{ id: "k1", key: "sk-tree00001111", testResult: { success: true, message: "可用" }, isFailed: false, successCount: 0, failureCount: 0 }],
        enableKeyRotation: false,
        models: [
          { name: "[🌲] [AWS-A-S]Claude-opus-4-6", customModel: "[AWS-A-S]Claude-opus-4-6", currentKeyIndex: 0, categoryId: "c1", categoryIds: ["c1"], isActive: false, isPlaceholder: false },
          { name: "[🌲] [AWS-A]Claude-opus-4-6", customModel: "[AWS-A]Claude-opus-4-6", categoryIds: ["c1", "c2"], isActive: true, isPlaceholder: false },
          { name: "[🌲] 占位", customModel: "", isPlaceholder: true }
        ]
      }]
    }
  }));
  const row = (await page.locator(".pa-imp-row").allTextContents()).join("|");
  assert.match(row, /🌲.*新增.*tree\.example\.ai.*1 个密钥.*2 个模型.*2 个分类/, row);
  await page.click(".pa-sheet-actions >> text=导入"); await page.waitForTimeout(400);
  s = await S();
  const t = s.sites.find((x) => x.name === "🌲");
  assert.deepEqual([t.url, t.model, t.models, t.keyMask, !!t.secretId], ["https://tree.example.ai/v1", "[AWS-A]Claude-opus-4-6", ["[AWS-A-S]Claude-opus-4-6", "[AWS-A]Claude-opus-4-6"], "sk-…1111", true]);
  assert.deepEqual(t.modelCats.map((c) => [c.name, c.models]), [["Claude", ["[AWS-A-S]Claude-opus-4-6", "[AWS-A]Claude-opus-4-6"]], ["常用", ["[AWS-A]Claude-opus-4-6"]]]);
  ok("别的扩展的分组格式：网址、密钥、模型（去掉站点前缀和占位）、当前模型、分类都导进来");
  if (await page.locator("[data-a=sitesedit]").count()) { await page.click("[data-a=sitesedit]"); await page.waitForTimeout(150); } await page.click('[data-a="exportsites"]'); await page.waitForTimeout(200);
  const [dl2] = await Promise.all([page.waitForEvent("download"), page.click(".pa-pick-item >> text=不含密钥")]);
  const f2 = JSON.parse(fs.readFileSync(await dl2.path(), "utf8"));
  const tree = f2.sites.find((x) => x.name === "🌲");
  assert.deepEqual(tree.cats.map((c) => c.name), ["Claude", "常用"]);
  assert.equal(tree.keys[0].key, undefined, "不含密钥");
  ok("导出带分类；选「不含密钥」时文件里没有密钥");

  // 2.11.2 本浏览器没有留底、酒馆又不允许读回密钥（allowKeysExposure 为 false）：提示原因和改法
  await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith("mcdonalds:keycopy:")) localStorage.removeItem(k); });
  await page.route("**/api/secrets/find", (r) => r.fulfill({ status: 403, body: "Forbidden" }));
  await toasts();
  if (await page.locator("[data-a=sitesedit]").count()) { await page.click("[data-a=sitesedit]"); await page.waitForTimeout(150); } await page.click('[data-a="exportsites"]'); await page.waitForTimeout(200);
  const [dl3] = await Promise.all([page.waitForEvent("download"), page.click(".pa-pick-item >> text=含密钥")]);
  assert.ok(JSON.parse(fs.readFileSync(await dl3.path(), "utf8")).sites.every((x) => x.keys.every((k) => !k.key)));
  assert.match((await toasts()).join("|"), /warning:.*密钥未写入：酒馆不允许读回已保存的密钥。在酒馆 config\.yaml 中将 allowKeysExposure 改为 true/);
  await page.unroute("**/api/secrets/find");
  ok("酒馆不允许读回密钥时：导出不含密钥，提示 allowKeysExposure 的改法");

  // 6) 不是 JSON、没有站点
  await importFile("bad.json", "not json");
  assert.match((await toasts()).join("|"), /error:不是 JSON 文件/);
  await importFile("empty.json", JSON.stringify({ hello: "world" }));
  assert.match((await toasts()).join("|"), /没找到站点/);
  ok("坏文件、没有站点的文件给出提示");
} finally {
  await browser.close();
}
assert.deepEqual(errs, []);
