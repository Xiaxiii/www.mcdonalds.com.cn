// 2.6.3 拉取模型列表时换密钥：直接调酒馆的换密钥接口，不调 rotateSecret（它会让酒馆重新加载预设，带正则的预设每次弹一条提示），
// 拉完换回原来在用的密钥。先构建并在仓库根目录运行 8765 静态服务。
import { chromium } from "playwright";
import assert from "node:assert";
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
await page.goto("http://127.0.0.1:8765/test/site/index.html");
await page.waitForFunction(() => window.__mcdonalds?.open, null, { timeout: 15000 });
const ok = (m) => console.log("✓", m);
const rotations = [];
await page.route("**/api/secrets/rotate", async (r) => {
  const { key, id } = JSON.parse(r.request().postData());
  rotations.push(id);
  await page.evaluate(async ({ key, id }) => { const m = await import("/test/site/scripts/secrets.js"); m.secret_state[key].forEach((s) => { s.active = s.id === id; }); }, { key, id });
  await r.fulfill({ status: 200, body: "{}" });
});
await page.route("**/api/backends/chat-completions/status", async (r) => {
  const active = await page.evaluate(async () => (await import("/test/site/scripts/secrets.js")).secret_state.api_key_custom.find((s) => s.active)?.id);
  await r.fulfill({ json: { data: active === "k2" ? [{ id: "b1" }, { id: "b2" }] : [] } });
});
await page.evaluate(async () => {
  window.__toasts = [];
  window.toastr = Object.fromEntries(["success", "info", "warning", "error"].map((k) => [k, (m) => window.__toasts.push(`${k}:${m}`)]));
  const m = await import("/test/site/scripts/secrets.js");
  m.secret_state.api_key_custom.push({ id: "k1", value: "aaa", active: true }, { id: "k2", value: "bbb", active: false });
  window.SillyTavern.getContext().extensionSettings.mcdonalds = { sites: [{ id: "b", name: "B站", source: "custom", url: "https://b.example/v1", model: "", models: [], secretId: "k2", keyMask: "sk-…bbbb" }], activeSiteId: null };
  window.__mcdonalds.open("conn");
});
await page.waitForTimeout(400);
await page.locator(".pa-plan-sites .pa-site b", { hasText: "B站" }).click(); await page.waitForTimeout(300);
await page.click('.pa-sheet [data-f="fetch"]'); await page.waitForTimeout(800);
assert.deepEqual(rotations, ["k2", "k1"], "换到站点的密钥，拉完换回");
assert.equal(await page.evaluate(async () => (await import("/test/site/scripts/secrets.js")).secret_state.api_key_custom.find((s) => s.active)?.id), "k1");
assert.ok((await page.evaluate(() => window.__toasts)).includes("success:已获取 2 个模型"));
ok("拉取模型：换密钥走接口，不触发酒馆重新加载预设，拉完换回原密钥");
assert.deepEqual(errs, []);
await browser.close();
