// 2.5.0 一个站点多个密钥（同一站子的不同分组）：粘贴多行拆开、各拉模型、列表里点开按分组切换、
// 选模型时一并选分组（按模型 / 按分组）、方案记下分组、删到只剩一个时写回站点上。先构建并在仓库根目录运行 8765 静态服务。
import assert from "node:assert/strict";
import { chromium } from "playwright";
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const errs = [];
const ok = (m) => console.log("✓", m);
try {
  const page = await browser.newPage({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });
  page.on("pageerror", (e) => errs.push(e.message));
  // 拉模型时按当前在用的密钥返回不同的列表（和真的中转站分组一样）
  const MODELS = { a: ["gemini-2.5-pro", "gemini-3-pro-preview"], b: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-3-pro-preview"] };
  await page.route("**/api/backends/chat-completions/status", async (r) => {
    const v = await page.evaluate(async () => (await import("/test/site/scripts/secrets.js")).secret_state.api_key_custom.find((s) => s.active)?.value);
    const list = v === "aaa" ? MODELS.a : v === "bbb" ? MODELS.b : [];
    r.fulfill({ json: { data: list.map((id) => ({ id })) } });
  });
  await page.goto("http://127.0.0.1:8765/test/site/index.html");
  await page.waitForFunction(() => window.__presetAtelier?.open);
  const S = () => page.evaluate(() => window.SillyTavern.getContext().extensionSettings.presetAtelier);
  const vault = () => page.evaluate(async () => (await import("/test/site/scripts/secrets.js")).secret_state.api_key_custom.map((s) => `${s.value}${s.active ? "*" : ""}`).join(","));
  // 模拟酒馆的连接控件：改控件就改 oai_settings（同 apirule-check）
  await page.evaluate(() => {
    const live = window.__mock.live;
    document.body.insertAdjacentHTML("beforeend", `<div hidden><select id="main_api"><option value="openai">openai</option></select>
      <select id="chat_completion_source"><option value="custom">custom</option><option value="openai">openai</option></select>
      <input id="custom_api_url_text"><input id="custom_model_id"><select id="model_custom_select"></select><button id="api_button_openai"></button></div>`);
    $("#main_api").val("openai");
    $("#chat_completion_source").val(live.chat_completion_source).on("change", function () { live.chat_completion_source = this.value; });
    $("#custom_api_url_text").val(live.custom_url).on("input", function () { live.custom_url = this.value; });
    $("#custom_model_id").val(live.custom_model).on("input", function () { live.custom_model = this.value; });
  });
  await page.evaluate(async () => {
    window.__toasts = [];
    window.toastr = Object.fromEntries(["success", "info", "warning", "error"].map((k) => [k, (m) => window.__toasts.push(`${k}:${m}`)]));
    (await import("/test/site/scripts/secrets.js")).secret_state.api_key_custom.push({ id: "old", value: "old", active: true });
    window.SillyTavern.getContext().extensionSettings.presetAtelier = { sites: [], activeSiteId: null };
    window.__presetAtelier.open("conn");
  });
  await page.waitForTimeout(400);

  // 1) 添加站点：只有一个密钥时就一个框；一次粘贴两行拆成两行，出现名称框、拖动柄和删除
  await page.click("[data-a=new]"); await page.waitForTimeout(200);
  assert.equal(await page.locator(".pa-sheet .pa-keyrow").count(), 1);
  assert.equal(await page.locator(".pa-sheet [data-f=keyname]").count(), 0, "一个密钥时没有名称框");
  await page.fill(".pa-sheet [data-f=name]", "某中转 Gemini");
  await page.fill(".pa-sheet [data-f=url]", "https://relay.example/v1");
  await page.locator(".pa-sheet [data-f=key]").evaluate((box) => {
    const dt = new DataTransfer();
    dt.setData("text/plain", "sk-aaaaaaaaaaaa\nsk-bbbbbbbbbbbb\n");
    box.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(100);
  assert.equal(await page.locator(".pa-sheet .pa-keyrow").count(), 2, "粘贴两行拆成两个密钥");
  assert.equal(await page.locator(".pa-sheet [data-f=keyname]").count(), 2, "两个以上时出现名称框");
  assert.equal(await page.locator(".pa-sheet .pa-key-grip").count(), 2);
  assert.deepEqual(await page.locator(".pa-sheet [data-f=keyname]").evaluateAll((x) => x.map((y) => y.placeholder)), ["密钥 1", "密钥 2"]);
  await page.locator(".pa-sheet [data-f=keyname]").first().fill("按次");
  await page.locator(".pa-sheet [data-f=keyname]").nth(1).fill("按量");
  // ＋ 再加一行，再删掉
  await page.click(".pa-sheet [data-f=keyadd]");
  assert.equal(await page.locator(".pa-sheet .pa-keyrow").count(), 3);
  await page.locator(".pa-sheet .pa-keyrow").nth(2).locator("[data-f=keydel]").click();
  assert.equal(await page.locator(".pa-sheet .pa-keyrow").count(), 2);
  assert.equal(await page.locator(".pa-sheet [data-f=keyname]").first().inputValue(), "按次", "加、删行时填好的名称不丢");
  // 眼睛：显示刚填的密钥，再点隐藏
  await page.locator(".pa-sheet .pa-keyrow").first().locator("[data-f=keyeye]").click();
  assert.equal(await page.locator(".pa-sheet .pa-keyrow").first().locator("[data-f=key]").getAttribute("type"), "text");
  assert.equal(await page.locator(".pa-sheet .pa-keyrow").first().locator("[data-f=key]").inputValue(), "sk-aaaaaaaaaaaa", "显示时文字不丢");
  await page.locator(".pa-sheet .pa-keyrow").first().locator("[data-f=keyeye]").click();
  assert.equal(await page.locator(".pa-sheet .pa-keyrow").first().locator("[data-f=key]").getAttribute("type"), "password");
  ok("粘贴多行拆开；＋ 加一行；一个密钥时没有名称框；眼睛显示、隐藏密钥");

  // 2) 获取模型列表：每个密钥各拉一次，行尾显示数量；选择框按模型列，标出分组
  await page.click(".pa-sheet [data-f=fetch]");
  await page.locator(".pa-kpick").waitFor();
  assert.deepEqual(await page.locator(".pa-sheet .pa-key-cnt").allInnerTexts(), ["✓ 2", "✓ 4"]);
  assert.equal(await page.locator(".pa-kview button.on").innerText(), "按模型", "默认按模型");
  const row = page.locator(".pa-krow", { hasText: "gemini-2.5-pro" });
  assert.deepEqual(await row.locator(".pa-kchip").allTextContents(), ["按次", "按量"]);
  assert.deepEqual(await page.locator(".pa-krow", { hasText: "gemini-2.5-flash-lite" }).locator(".pa-kchip").allTextContents(), ["按量"]);
  await row.locator(".pa-kchip", { hasText: "按量" }).click(); await page.waitForTimeout(300);
  assert.match(await page.locator(".pa-sheet [data-f=modelbtn]").innerText(), /gemini-2\.5-pro[\s\S]*按量/);
  assert.equal(await vault(), "old*,aaa,bbb", "拉模型时用过的密钥切回原来在用的");
  await page.locator(".pa-sheet-actions .pa-btn-primary").last().click(); await page.waitForTimeout(300);
  let site = (await S()).sites[0];
  assert.equal(site.keys.length, 2);
  assert.deepEqual(site.keys.map((k) => k.name), ["按次", "按量"]);
  assert.deepEqual(site.keys[1].models, MODELS.b);
  assert.equal(site.keys[1].model, "gemini-2.5-pro");
  assert.equal(site.keyId, site.keys[1].id, "选了按量的模型，站点记下按量");
  assert.equal(site.secretId, undefined, "多个密钥时站点上不再记密钥");
  ok("各拉一次模型；按模型列出、点标签选分组；保存为多密钥站点");

  // 3) 站点列表：小三角点开，每个分组一行，各有「切换」
  const card = page.locator(".pa-plan-sites .pa-site-multi");
  assert.equal(await card.locator(".pa-kline").count(), 0, "默认折起");
  assert.equal((await card.locator(".pa-fold-pill").textContent()).trim(), "2 组 ▸");
  // 点名字打开编辑窗口（和单密钥站点一样），点「2 组」展开
  await card.locator(".pa-site-mhead b").click();
  await page.locator(".pa-sheet").waitFor();
  await page.click(".pa-sheet-actions >> text=取消"); await page.waitForTimeout(300);
  await card.locator(".pa-fold-pill").click();
  assert.equal((await card.locator(".pa-fold-pill").textContent()).trim(), "2 组 ▾");
  assert.equal(await card.locator(".pa-kline").count(), 2);
  await card.locator(".pa-kline", { hasText: "按次" }).locator("[data-a=use]").click();
  await page.waitForFunction(() => window.__toasts.some((t) => /已连接/.test(t)), null, { timeout: 20000 });
  site = (await S()).sites[0];
  assert.equal((await S()).activeSiteId, site.id);
  assert.equal(site.keyId, site.keys[0].id);
  assert.equal(await vault(), "old,aaa*,bbb", "切到按次的密钥");
  assert.match(await page.locator(".pa-plan-sites .pa-site-multi .pa-kline", { hasText: "按次" }).innerText(), /使用中/);
  assert.match(await page.locator(".pa-live .pa-model-key").innerText(), /按次/, "当前连接的模型框跟着分组名");
  ok("列表里点开分组直接切换");

  // 4) 当前连接点 ▾：按分组看，只展开第一段；选按量的模型就换密钥重新连接
  await page.click("[data-a=livemodel]");
  await page.locator(".pa-kpick").waitFor();
  await page.locator(".pa-kview [data-v=group]").click();
  assert.equal(await page.locator(".pa-ksec").count(), 2);
  assert.deepEqual(await page.locator(".pa-ksec").evaluateAll((x) => x.map((y) => y.getAttribute("aria-expanded"))), ["true", "false"], "只展开第一段");
  await page.locator(".pa-ksec", { hasText: "按量" }).click();
  await page.locator(".pa-mpick-item[data-k]", { hasText: "gemini-2.5-flash-lite" }).click();
  await page.waitForFunction(() => window.__toasts.some((t) => /已连接.*按量/.test(t)), null, { timeout: 20000 });
  site = (await S()).sites[0];
  assert.equal(site.keyId, site.keys[1].id);
  assert.equal(site.keys[1].model, "gemini-2.5-flash-lite");
  assert.equal(site.modelView, "group", "按分组记在站点上");
  assert.equal(await vault(), "old,aaa,bbb*");
  ok("选模型时换分组：换密钥重新连接；按分组只展开第一段");
  // 测试消息失败时点名是哪个分组的密钥
  await page.evaluate(() => {
    const c = window.SillyTavern.getContext();
    c.getChatCompletionModel = () => "gemini-2.5-flash-lite";
    c.ChatCompletionService = { presetToGeneratePayload: async (a, b, o) => o };
  });
  await page.route("**/api/backends/chat-completions/generate", (r) => r.fulfill({ status: 429, json: { error: { message: "insufficient quota" } } }));
  await page.click(".pa-live [data-a=testmodel]");
  await page.waitForFunction(() => document.querySelector(".pa-live .pa-live-res")?.textContent === "按量 · 429 额度不足", null, { timeout: 10000 });
  ok("测试消息失败时点名分组");

  // 5) 方案记下分组
  await page.evaluate(() => window.__presetAtelier.open("schemes")); await page.waitForTimeout(300);
  await page.click("[data-s=new]"); await page.waitForTimeout(300);
  await page.fill(".pa-sheet [data-f=name]", "按量方案");
  await page.selectOption(".pa-sheet [data-f=api]", "__live");
  await page.click(".pa-sheet-actions .pa-btn-primary"); await page.waitForTimeout(400);
  const sc = (await S()).schemes.find((x) => x.name === "按量方案");
  assert.equal(sc.conn.siteId, site.id);
  assert.equal(sc.conn.keyId, site.keys[1].id, "方案记下用的分组");
  ok("方案记下站点、分组和模型");
  // 换回按次，再套用方案：连回方案记的按量分组
  await page.click('.pa-tabs [data-nav="conn"]'); await page.waitForTimeout(300);
  await page.locator(".pa-plan-sites .pa-site-multi .pa-kline", { hasText: "按次" }).locator("[data-a=use]").click();
  await page.waitForTimeout(2500);
  assert.equal(await vault(), "old,aaa*,bbb");
  await page.click('.pa-tabs [data-nav="more"]'); await page.click('.pa-subnav [data-m="schemes"]'); await page.waitForTimeout(300);
  await page.locator(".pa-srow", { hasText: "按量方案" }).locator("[data-a=apply]").click(); await page.waitForTimeout(2500);
  assert.equal(await vault(), "old,aaa,bbb*", "套用方案连回它记的分组");
  ok("套用方案连回它记的分组");
  // 拖动 ⋮⋮ 调顺序
  await page.click('.pa-tabs [data-nav="conn"]'); await page.waitForTimeout(300);
  await page.locator(".pa-plan-sites .pa-site-multi .pa-site-mhead b").click(); await page.waitForTimeout(200);
  // 看已保存的密钥：保存时本浏览器留了一份，直接用它；没有这份时问酒馆，不让看就在这一行下面说明
  const copyOf = (id) => page.evaluate((sid) => Object.entries(localStorage).find(([k]) => k.startsWith("presetAtelier:keycopy:") && k.endsWith(":" + sid))?.[1] || null, id);
  const firstSid = (await S()).sites[0].keys[0].secretId;
  const kept = await copyOf(firstSid);
  assert.ok(kept, "保存密钥时本浏览器留了一份");
  let reveal = { status: 403, json: { error: "forbidden" } };
  await page.route("**/api/secrets/find", (r) => r.fulfill(reveal));
  const row1 = () => page.locator(".pa-sheet .pa-keyrow").first();
  const kbox = row1().locator("[data-f=key]");
  await row1().locator("[data-f=keyeye]").click(); await page.waitForTimeout(200);
  assert.equal(await kbox.inputValue(), kept, "有留底时不问酒馆，直接填进框里");
  // 2.5.15 看到的密钥能复制
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://127.0.0.1:8765" });
  await row1().locator("[data-f=keycopy]").click(); await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), kept, "点复制，剪贴板里是密钥全文");
  await row1().locator("[data-f=keyeye]").click(); await page.waitForTimeout(100);
  // 没有留底（更新前存的）：关掉重开编辑窗口，酒馆拒绝时说明，允许时显示并留底
  await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith("presetAtelier:keycopy:")) localStorage.removeItem(k); });
  await page.locator(".pa-sheet .pa-sheet-x").last().click(); await page.waitForTimeout(300);
  await page.locator(".pa-plan-sites .pa-site-multi .pa-site-mhead b").click(); await page.waitForTimeout(200);
  await row1().locator("[data-f=keyeye]").click(); await page.waitForTimeout(200);
  assert.match(await page.locator(".pa-sheet .pa-key-note").textContent(), /重新粘贴一次[\s\S]*allowKeysExposure/);
  reveal = { status: 200, json: { value: "sk-aaaaaaaaaaaa" } };
  await row1().locator("[data-f=keyeye]").click(); await page.waitForTimeout(200);
  assert.equal(await kbox.inputValue(), "sk-aaaaaaaaaaaa");
  assert.equal(await copyOf(firstSid), "sk-aaaaaaaaaaaa", "酒馆给了全文后也留一份");
  // 框里显示着没改的密钥，保存时不再存一遍
  const vaultBefore = await vault();
  const grips = page.locator(".pa-sheet .pa-key-grip");
  const g2 = await grips.nth(1).boundingBox();
  const g1 = await grips.nth(0).boundingBox();
  await grips.nth(1).dispatchEvent("pointerdown", { pointerId: 1, clientX: g2.x + 5, clientY: g2.y + 5, bubbles: true });
  await grips.nth(1).dispatchEvent("pointermove", { pointerId: 1, clientX: g1.x + 5, clientY: g1.y - 4, bubbles: true });
  await grips.nth(0).dispatchEvent("pointerup", { pointerId: 1, bubbles: true });
  assert.deepEqual(await page.locator(".pa-sheet [data-f=keyname]").evaluateAll((x) => x.map((y) => y.value)), ["按量", "按次"], "拖动后按量排到上面");
  await page.locator(".pa-sheet-actions .pa-btn-primary").last().click(); await page.waitForTimeout(300);
  assert.deepEqual((await S()).sites[0].keys.map((k) => k.name), ["按量", "按次"]);
  assert.equal(await vault(), vaultBefore, "显示着的密钥没改，保存时密钥库不变");
  // 换回原顺序，后面的检查照旧
  await page.evaluate(() => window.SillyTavern.getContext().extensionSettings.presetAtelier.sites[0].keys.reverse());
  ok("拖动调顺序");
  // 酒馆密钥库里删掉的密钥，下次读取密钥库时本浏览器的留底跟着删；还在的不动
  await page.evaluate(() => { const any = Object.keys(localStorage).find((k) => k.startsWith("presetAtelier:keycopy:")); localStorage.setItem(any.replace(/[^:]+$/, "gone-id"), "sk-gone"); });
  await page.locator(".pa-plan-sites .pa-site-multi .pa-kline", { hasText: "按次" }).locator("[data-a=use]").click();
  await page.waitForTimeout(2500);
  assert.equal(await page.evaluate(() => Object.keys(localStorage).some((k) => k.endsWith(":gone-id"))), false, "密钥库里没有的密钥不留底");
  assert.equal(await copyOf(firstSid), "sk-aaaaaaaaaaaa", "还在的密钥留底不动");
  ok("酒馆密钥库里删掉的密钥，本浏览器的留底跟着删");

  // 6) 三个以上分组：按模型时只显示一个标签和「+N」，点开全部
  await page.evaluate(() => {
    const s = window.SillyTavern.getContext().extensionSettings.presetAtelier.sites[0];
    s.keys.push({ id: "k3", name: "特价", secretId: null, keyMask: "", model: "", models: ["gemini-2.5-pro"] }, { id: "k4", name: "", secretId: null, keyMask: "", model: "", models: ["gemini-2.5-pro"] });
    s.modelView = "model";
  });
  await page.click("[data-a=livemodel]");
  await page.locator(".pa-kpick").waitFor();
  const pro = page.locator(".pa-krow", { hasText: "gemini-2.5-pro" });
  assert.equal(await pro.locator(".pa-kchip").count(), 1);
  assert.equal(await pro.locator(".pa-kmore").textContent(), "+3");
  await pro.locator(".pa-kmore").click();
  assert.deepEqual(await page.locator(".pa-krow", { hasText: "gemini-2.5-pro" }).locator(".pa-kchip").allTextContents(), ["按次", "按量", "特价", "密钥 4"], "没填名称的叫「密钥 N」");
  await page.locator(".pa-sheet-x").last().click();
  // 多密钥站点：按模型、按分类、按分组
  await page.click("[data-a=livemodel]");
  await page.locator(".pa-kpick").waitFor();
  assert.deepEqual(await page.locator(".pa-kview button").allTextContents(), ["按模型", "按分类", "按分组"]);
  await page.locator(".pa-sheet-x").last().click();
  ok("标签超过 2 个收成「+N」，点开全部");

  // 7) 编辑删到只剩一个密钥：写回站点上，和单密钥站点一样
  await page.evaluate(() => { const s = window.SillyTavern.getContext().extensionSettings.presetAtelier.sites[0]; s.keys.splice(2); });
  await page.locator(".pa-plan-sites .pa-site-multi .pa-site-mhead b").click(); await page.waitForTimeout(200);
  await page.locator(".pa-sheet .pa-keyrow").first().locator("[data-f=keydel]").click();
  assert.equal(await page.locator(".pa-sheet [data-f=keyname]").count(), 0);
  await page.locator(".pa-sheet-actions .pa-btn-primary").last().click(); await page.waitForTimeout(300);
  site = (await S()).sites[0];
  assert.equal(site.keys, undefined);
  assert.ok(site.secretId, "密钥记回站点上");
  assert.equal(site.model, "gemini-2.5-flash-lite");
  assert.equal(await page.locator(".pa-plan-sites .pa-site-multi").count(), 0);
  assert.equal(await page.locator(".pa-plan-sites .pa-site [data-a=use], .pa-plan-sites .pa-site .pa-chip").count() > 0, true);
  ok("只剩一个密钥时写回站点上");
  assert.deepEqual(errs, []);
} finally {
  await browser.close();
}
