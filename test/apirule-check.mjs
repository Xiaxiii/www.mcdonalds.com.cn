// 1.9.8 API 规则：换预设，API 不变；切方案，恢复方案记录的 API；没记 API 的方案不动 API；切方案不改「使用中」站点
import { chromium } from "playwright";
import assert from "node:assert";
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
await page.goto("http://127.0.0.1:8765/test/site/index.html");
await page.waitForFunction(() => window.__presetAtelier?.open, null, { timeout: 15000 });
const ok = (m) => console.log("✓", m);
// 模拟酒馆的连接控件：改控件就改 oai_settings
await page.evaluate(() => {
  const live = window.__mock.live;
  document.body.insertAdjacentHTML("beforeend", `<div hidden><select id="main_api"><option value="openai">openai</option></select>
    <select id="chat_completion_source"><option value="custom">custom</option><option value="openai">openai</option></select>
    <input id="custom_api_url_text"><input id="custom_model_id"><select id="model_custom_select"></select><button id="api_button_openai"></button></div>`);
  $("#main_api").val("openai");
  $("#chat_completion_source").val(live.chat_completion_source).on("change", function () { live.chat_completion_source = this.value; });
  $("#custom_api_url_text").val(live.custom_url).on("input", function () { live.custom_url = this.value; });
  $("#custom_model_id").val(live.custom_model).on("input", function () { live.custom_model = this.value; });
  const c = window.SillyTavern.getContext(), m = window.__mock;
  c.extensionSettings.presetAtelier = {
    sites: [{ id: "s1", name: "一号站", source: "custom", url: "https://one/v1", model: "m1" }],
    activeSiteId: null,
    schemes: [
      { id: "A", name: "记了API", preset: m.names[0], scope: "all", states: {}, groupStates: {}, conn: { source: "custom", url: "https://one/v1", model: "m1-pro", siteId: "s1" } },
      { id: "B", name: "没记API", preset: m.names[1] || m.names[0], scope: "all", states: {}, groupStates: {} }
    ]
  };
});
await page.evaluate(() => window.__presetAtelier.open("more", "schemes")); await page.waitForTimeout(500);
const live = () => page.evaluate(() => ({ url: window.__mock.live.custom_url, model: window.__mock.live.custom_model, bind: window.__mock.live.bind_preset_to_connection }));
const S = () => page.evaluate(() => window.SillyTavern.getContext().extensionSettings.presetAtelier);

// 1) 切到记了 API 的方案：连到它记的站点和模型；「使用中」站点不变
await page.locator(".pa-srow", { hasText: "记了API" }).locator("[data-a=apply]").click(); await page.waitForTimeout(1500);
let l = await live();
assert.equal(l.url, "https://one/v1");
assert.equal(l.model, "m1-pro");
assert.equal((await S()).activeSiteId ?? null, null, "切方案不改「使用中」站点");
ok("切到记了 API 的方案：恢复它的 API，不改使用中站点");

// 2) 自己换一个 API，再切到没记 API 的方案：API 不变（不会被上一个方案的站点覆盖）
await page.evaluate(() => { window.__mock.live.custom_url = "https://mine/v1"; window.__mock.live.custom_model = "mine"; $("#custom_api_url_text").val("https://mine/v1"); });
await page.locator(".pa-srow", { hasText: "没记API" }).locator("[data-a=apply]").click(); await page.waitForTimeout(1500);
l = await live();
assert.equal(l.url, "https://mine/v1", "没记 API 的方案不动 API");
assert.equal(l.model, "mine");
ok("切到没记 API 的方案：API 不变");

// 3) 换预设（酒馆事件）：不自动连回任何站点
await page.evaluate(async () => { const c = window.SillyTavern.getContext(); await c.eventSource.emit("preset_changed", { apiId: "openai" }); });
await page.waitForTimeout(1200);
assert.equal((await live()).url, "https://mine/v1", "换预设 API 不变");
ok("换预设：API 不变");

// 4) 2.4.0：选项一行，只有方框管勾选；点这一行其他地方展开规则
const card = page.locator(".pa-optgroup[data-w=chattoast]");
const box = card.locator("input[data-o=chattoast]");
assert.equal(await card.locator("input[type=checkbox]").count(), 1);
assert.equal(await card.locator(".pa-sgbody").count(), 0, "规则默认收起");
const was = await box.isChecked();
await card.locator(".pa-optlabel").click(); await page.waitForTimeout(150);
assert.equal(await box.isChecked(), was, "点文字不改勾选");
assert.match(await card.locator(".pa-sgbody").innerText(), /换预设\s*API 不变/);
ok("设置只剩一项，点这一行展开规则");

assert.deepEqual(errs, []);
console.log("API 规则检查通过");
await browser.close();
