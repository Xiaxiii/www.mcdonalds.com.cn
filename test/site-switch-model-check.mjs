// 2.6.1 切到没记模型的站点：上一个站点的模型不带过去；选择模型列表里不混入不在这个站点列表里的模型。
// 先构建并在仓库根目录运行 8765 静态服务。
import { chromium } from "playwright";
import assert from "node:assert";
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
await page.goto("http://127.0.0.1:8765/test/site/index.html");
await page.waitForFunction(() => window.__presetAtelier?.open, null, { timeout: 15000 });
const ok = (m) => console.log("✓", m);
await page.evaluate(() => {
  const live = window.__mock.live;
  document.body.insertAdjacentHTML("beforeend", `<div hidden><select id="main_api"><option value="openai">openai</option></select>
    <select id="chat_completion_source"><option value="custom">custom</option></select>
    <input id="custom_api_url_text"><input id="custom_model_id"><select id="model_custom_select"></select><button id="api_button_openai"></button></div>`);
  $("#main_api").val("openai");
  $("#chat_completion_source").val("custom").on("change", function () { live.chat_completion_source = this.value; });
  live.chat_completion_source = "custom";
  $("#custom_api_url_text").val("https://a.example/v1").on("input", function () { live.custom_url = this.value; });
  $("#custom_model_id").val("[A]old-model").on("input", function () { live.custom_model = this.value; });
  live.custom_url = "https://a.example/v1";
  live.custom_model = "[A]old-model";
  window.SillyTavern.getContext().extensionSettings.presetAtelier = {
    sites: [
      { id: "a", name: "A站", source: "custom", url: "https://a.example/v1", model: "[A]old-model", models: ["[A]old-model"] },
      { id: "b", name: "B站", source: "custom", url: "https://b.example/v1", model: "", models: ["[B]m1", "[B]m2"] }
    ],
    activeSiteId: "a"
  };
  window.__presetAtelier.open("conn");
});
await page.waitForTimeout(500);

// 1) 切到 B：B 没记模型，A 的模型不在 B 的列表里 → 清空（酒馆连上后自己选新列表的第一个）
await page.locator(".pa-plan-sites .pa-site", { hasText: "B站" }).locator("[data-a=use]").click();
await page.waitForTimeout(1500);
assert.equal(await page.evaluate(() => window.__mock.live.custom_model), "", "上一个站点的模型不带过去");
ok("切到没记模型的站点，不沿用上一个站点的模型");

// 2) 当前模型不在站点列表里时，选择模型不列出它，并写明
await page.evaluate(() => {
  $("#model_custom_select").html('<option value="">None</option><option value="[B]m1">[B]m1</option><option value="[B]m2">[B]m2</option>');
  $("#custom_model_id").val("[A]old-model").trigger("input");
});
await page.evaluate(() => window.__presetAtelier.open("conn")); await page.waitForTimeout(300);
await page.click('[data-a="livemodel"]'); await page.waitForTimeout(300);
const items = await page.locator(".pa-sheet .pa-mpick-item").evaluateAll((xs) => xs.map((x) => x.dataset.m));
assert.ok(items.length >= 2 && !items.some((t) => t.includes("[A]old-model")), items.join("|"));
assert.match(await page.locator(".pa-sheet .pa-mcur-miss").textContent(), /不在此站点的列表中/);
ok("选择模型不混入不在列表里的当前模型");

assert.deepEqual(errs, []);
await browser.close();
