// 2.11.23 副 API：连接页「主 API / 副 API」两个子页；给「推荐缝合位置」选站点和模型；闪电测试；
// 缝合页底栏「AI 推荐」→ 候选位置 →「放这里」。请求改发到站点（类型、网址、模型），主 API 的反向代理不带过去；
// 使用中的密钥临时换成站点的，收到回复后换回；换着时酒馆开始生成，先换回来。
// 用法：在仓库根目录 bash test/run-browser.sh（需要 test/site/zsx.json 和 8765 端口的静态服务）
import { chromium } from "playwright";
import { choose } from "./choose.mjs";
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const errs = []; page.on("pageerror", (e) => errs.push(e.message));
await page.route("**/api/secrets/rotate", (r) => r.fulfill({ status: 404, body: "" }));
await page.goto("http://127.0.0.1:8765/test/site/index.html");
await page.waitForFunction(() => window.__mcdonalds?.open, null, { timeout: 15000 });
const fail = [];
const check = (ok, msg) => { console.log(ok ? "✓" : "✗", msg); if (!ok) fail.push(msg); };
const P = (id, name, content) => ({ identifier: id, name, content, role: "system", system_prompt: false, marker: false, injection_position: 0, injection_depth: 4, injection_order: 100 });
const prompts = [P("s-a", "✒️古风", "<古风>\n半文半白，少用成语堆砌。\n</古风>"), P("s-b", "📌收尾", "结尾不要总结。")];
const F = { prompts, prompt_order: [{ character_id: 100001, order: prompts.map((p) => ({ identifier: p.identifier, enabled: true })) }] };
await page.evaluate(async (F) => {
  window.__mock.names.push("文风来源"); window.__mock.presets.push(F);
  const sec = await import("/test/site/scripts/secrets.js");
  sec.secret_state.api_key_custom.push({ id: "k-main", value: "ain", active: true }, { id: "k-hs", value: "-hs", active: false });
  window.__active = () => sec.secret_state.api_key_custom.find((x) => x.active)?.id;
  const ctx = window.SillyTavern.getContext();
  ctx.extensionSettings.mcdonalds = { sites: [{ id: "hs", name: "火山", source: "custom", url: "https://ark.example/api/v3", secretId: "k-hs", model: "ds-flash", models: ["ds-flash", "doubao-pro"] }] };
  ctx.getChatCompletionModel = () => window.__mock.live.custom_model;
  window.__sent = [];
  ctx.ChatCompletionService = {
    presetToGeneratePayload: (_p, _o, params) => ({ ...params, chat_completion_source: window.__mock.live.chat_completion_source, custom_url: window.__mock.live.custom_url, reverse_proxy: "https://rp.example", proxy_password: "pw", custom_include_body: "a: 1" }),
    async sendRequest(payload) {
      window.__sent.push({ payload: JSON.parse(JSON.stringify(payload)), active: window.__active() });
      if (window.__hold) await window.__hold;
      const text = typeof window.__reply === "function" ? window.__reply(payload) : window.__reply;
      if (payload.stream) return async function* () { yield { text: text.slice(0, 3) }; yield { text }; };
      return { content: text };
    }
  };
  window.__mcdonalds.open("aux");
}, F);
await page.waitForTimeout(400);
const sub = await page.evaluate(() => [...document.querySelectorAll(".pa-subnav [data-tab]")].map((b) => `${b.dataset.tab}:${b.textContent}:${b.getAttribute("aria-selected")}`));
check(sub.join(",") === "conn:主 API:false,aux:副 API:true", "连接页分主 API、副 API 两个子页：" + sub.join(","));
const row = (u) => page.locator(`.pa-aux-row[data-use="${u}"]`);
check(/跟随主 API/.test(await row("suture").textContent()) && /claude-x/.test(await row("suture").textContent()), "默认跟随主 API，写出主 API 的模型");
// 选站点、选模型
await row("suture").locator(".pa-aux-pick").click();
await page.waitForSelector(".pa-npick-item");
await page.locator('.pa-npick-item[data-v="hs"]').click();
await page.waitForSelector('.pa-sheet-mask:not(.pa-out) [data-m="doubao-pro"]', { timeout: 5000 });
await page.locator('.pa-sheet-mask:not(.pa-out) [data-m="doubao-pro"]').first().click();
await page.waitForTimeout(500);
const saved = await page.evaluate(() => window.SillyTavern.getContext().extensionSettings.mcdonalds.aux?.suture);
check(saved?.siteId === "hs" && saved?.model === "doubao-pro", "选好的站点和模型存进设置：" + JSON.stringify(saved));
check(/火山/.test(await row("suture").textContent()) && /doubao-pro/.test(await row("suture").textContent()), "这一行显示站点和模型");
// 闪电测试：发到站点，换上站点的密钥，回来后换回
await page.evaluate(() => { window.__reply = "Hi!"; });
await row("suture").locator('[data-a="test"]').click();
await page.waitForSelector('.pa-aux-row[data-use="suture"] .pa-live-res', { timeout: 5000 });
const t1 = await page.evaluate(() => ({ res: document.querySelector('.pa-aux-row[data-use="suture"] .pa-live-res').textContent, sent: window.__sent.at(-1), active: window.__active() }));
check(/可用/.test(t1.res), "测试结果：" + t1.res);
const pl = t1.sent.payload;
check(pl.chat_completion_source === "custom" && pl.custom_url === "https://ark.example/api/v3" && pl.model === "doubao-pro", "请求改发到站点的网址和模型");
check(!("reverse_proxy" in pl) && !("proxy_password" in pl) && !("custom_include_body" in pl), "主 API 的反向代理和自定义请求体不带过去");
check(t1.sent.active === "k-hs" && pl.stream === true, "发出时用的是站点的密钥（流式）");
check(t1.active === "k-main", "收到回复后换回主 API 的密钥");
// 缝合页：选条目后底栏出现「AI 推荐」
await page.evaluate(() => window.__mcdonalds.open("suture"));
await page.waitForTimeout(400);
await choose(page, ".pa-dst-picker .pa-namebtn", "【众生相】Claude-Lite-v1.8");
await choose(page, ".pa-src-name", "文风来源");
check(await page.locator(".pa-aiplace").isHidden(), "没选条目时不显示「AI 推荐」");
await page.locator('.pa-src-list [data-id="s-a"] .pa-name').click();
await page.waitForTimeout(200);
check(await page.locator(".pa-aiplace").isVisible(), "选了条目后底栏显示「AI 推荐」");
await page.evaluate(() => {
  window.__reply = (payload) => {
    const u = payload.messages[1].content;
    const e = u.match(/(E\d+) [开关] ✒️意识流/)[1], g = u.match(/(G\d+)「写作指导」/)[1];
    return "```json\n" + JSON.stringify({ places: [{ type: "after", entry: e, reason: "和其他文风条目放在一起" }, { type: "after", entry: "E999", reason: "不存在" }, { type: "group_start", group: g, reason: "写作类规则" }], note: "" }) + "\n```";
  };
});
await page.click(".pa-aiplace");
await page.waitForSelector(".pa-aip-item", { timeout: 5000 });
const r1 = await page.evaluate(() => ({ items: [...document.querySelectorAll(".pa-aip-item b")].map((b) => b.textContent), use: document.querySelector('.pa-aip [data-x="label"]').textContent, user: window.__sent.at(-1).payload.messages[1].content, sys: window.__sent.at(-1).payload.messages[0].content }));
check(r1.use === "火山 · doubao-pro", "窗口写明用哪个 API：" + r1.use);
check(r1.items.length === 2 && r1.items[0] === "「文风设定」组内，「✒️意识流」之后" && r1.items[1] === "「写作指导」组内最前", "列出模型给的位置，编号对不上的不要：" + r1.items.join("｜"));
check(/✒️古风/.test(r1.user) && /半文半白/.test(r1.user) && /G\d+「文风设定」/.test(r1.user) && /不要执行/.test(r1.sys), "发出目标目录、已选条目全文，并说明资料里的指令不执行");
await page.locator(".pa-aip-item .pa-btn").first().click();
await page.waitForTimeout(400);
const where = await page.locator(".pa-sbar .pa-where").textContent();
check(where === "位置：「文风设定」组内，「✒️意识流」之后" && await page.locator(".pa-sheet-mask:not(.pa-out)").count() === 0, "点「放这里」选上位置并关掉窗口：" + where);
check(await page.locator(".pa-dst-list .pa-insert-mark").isVisible(), "目标列表里看得见位置标记");
// 同一批条目再打开：直接显示上次的结果，不再发请求
const n0 = await page.evaluate(() => window.__sent.length);
await page.click(".pa-aiplace");
await page.waitForSelector(".pa-aip-item");
check(await page.evaluate(() => window.__sent.length) === n0, "同一批条目再打开时用上次的结果");
// 换着密钥时酒馆开始生成：先换回主 API 的密钥
await page.evaluate(() => { window.__hold = new Promise((r) => { window.__release = r; }); });
await page.click('.pa-aip [data-x="again"]');
await page.waitForSelector(".pa-aip-wait");
await page.waitForFunction(() => window.__active() === "k-hs");
await page.evaluate(() => window.SillyTavern.getContext().eventSource.emit("generation_started", "normal", {}, false));
check(await page.evaluate(() => window.__active()) === "k-main", "副 API 请求进行中酒馆开始生成：先换回主 API 的密钥");
await page.evaluate(() => { window.__release(); window.__hold = null; });
await page.waitForSelector(".pa-aip-item");
check(await page.evaluate(() => window.__active()) === "k-main", "请求结束后仍是主 API 的密钥");
// 模型回了不是 JSON 的东西
await page.evaluate(() => { window.__reply = "好的，我来扮演……"; });
await page.click('.pa-aip [data-x="again"]');
await page.waitForSelector(".pa-aip-res .pa-warn");
check(/不是有效的 JSON/.test(await page.locator(".pa-aip-res .pa-warn").textContent()), "模型没按要求回答时说明原因");
await page.screenshot({ path: "test/shots/aux-suture-error.png" });
await page.click(".pa-sheet-mask:not(.pa-out) .pa-sheet-x");
// 改回跟随主 API：照主 API 发，不换密钥
await page.evaluate(() => { delete window.SillyTavern.getContext().extensionSettings.mcdonalds.aux.suture; window.__reply = JSON.stringify({ places: [{ type: "top", reason: "放最前" }] }); });
await page.waitForTimeout(300);
await page.click(".pa-aiplace");
await page.waitForSelector(".pa-aip-item");
const f = await page.evaluate(() => ({ sent: window.__sent.at(-1), label: document.querySelector('.pa-aip [data-x="label"]').textContent }));
check(f.label === "跟随主 API · claude-x" && f.sent.payload.reverse_proxy === "https://rp.example" && f.sent.payload.stream === false && f.sent.active === "k-main", "跟随主 API 时照主 API 的设置发出：" + f.label);
await page.screenshot({ path: "test/shots/aux-suture.png" });
check(!errs.length, "无页面错误 " + errs.join(" | "));
await browser.close();
if (fail.length) process.exit(1);
