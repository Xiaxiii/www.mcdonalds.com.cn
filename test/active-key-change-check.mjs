// 2.6.7 编辑当前连接所在的站点、换了新密钥：保存后当前连接改用新密钥（以前会切回旧密钥，测试消息一直报 401）。
// 先构建并在仓库根目录运行 8765 静态服务。
import { chromium } from "playwright";
import assert from "node:assert";
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
await page.goto("http://127.0.0.1:8765/test/site/index.html");
await page.waitForFunction(() => window.__presetAtelier?.open, null, { timeout: 15000 });
const active = () => page.evaluate(async () => (await import("/test/site/scripts/secrets.js")).secret_state.api_key_custom.find((s) => s.active)?.value);
await page.evaluate(async () => {
  const live = window.__mock.live;
  document.body.insertAdjacentHTML("beforeend", `<div hidden><select id="main_api"><option value="openai">openai</option></select>
    <select id="chat_completion_source"><option value="custom">custom</option></select>
    <input id="custom_api_url_text"><input id="custom_model_id"><select id="model_custom_select"></select><button id="api_button_openai"></button></div>`);
  $("#main_api").val("openai");
  live.chat_completion_source = "custom";
  $("#chat_completion_source").val("custom").on("change", function () { live.chat_completion_source = this.value; });
  live.custom_url = "https://x.example/v1";
  live.custom_model = "m1";
  $("#custom_api_url_text").val(live.custom_url).on("input", function () { live.custom_url = this.value; });
  $("#custom_model_id").val("m1").on("input", function () { live.custom_model = this.value; });
  window.__toasts = [];
  window.toastr = Object.fromEntries(["success", "info", "warning", "error"].map((k) => [k, (m) => window.__toasts.push(`${k}:${m}`)]));
  (await import("/test/site/scripts/secrets.js")).secret_state.api_key_custom.push({ id: "old", value: "old", active: true });
  window.SillyTavern.getContext().extensionSettings.presetAtelier = { sites: [{ id: "x", name: "小汐", source: "custom", url: "https://x.example/v1", model: "m1", models: ["m1"], secretId: "old", keyMask: "sk-…oldd" }], activeSiteId: "x" };
  window.__presetAtelier.open("conn");
});
await page.waitForTimeout(400);
assert.equal(await active(), "old");
// 编辑「小汐」，填新密钥，保存
await page.locator(".pa-plan-sites .pa-site b", { hasText: "小汐" }).click(); await page.waitForTimeout(300);
await page.fill(".pa-sheet [data-f=key]", "sk-new-key-abcd");
await page.locator(".pa-sheet-mask:not(.pa-out) .pa-sheet-actions .pa-btn-primary").click();
await page.waitForTimeout(2500);
assert.equal(await active(), "bcd", "当前连接换上了新密钥（模拟密钥库只存末三位）");
const site = await page.evaluate(() => window.SillyTavern.getContext().extensionSettings.presetAtelier.sites[0]);
assert.notEqual(site.secretId, "old");
assert.match((await page.evaluate(() => window.__toasts)).join("|"), /已用新密钥重新连接|重新连接未成功/);
console.log("✓ 编辑当前站点换密钥：保存后当前连接改用新密钥");
assert.deepEqual(errs, []);
await browser.close();
