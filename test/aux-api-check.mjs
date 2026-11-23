// 2.11.23 副 API：连接页「主 API / 副 API」两个子页。2.11.24 起用渠道：从主 API 的站点添加，或新建只在副 API 用的渠道；
// 用途选渠道；渠道上的闪电测试。缝合页底栏「AI 推荐」→ 候选位置 →「放这里」。请求改发到渠道（类型、网址、模型），
// 主 API 的反向代理不带过去；使用中的密钥临时换成渠道的，收到回复后换回；换着时酒馆开始生成，先换回来。
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
const prompts = [P("s-a", "✒️古风", "<古风>\n半文半白，少用成语堆砌。\n</古风>"), P("s-b", "📌收尾", "结尾不要总结。"), P("s-c", "├───文风选择───┤", ""), P("s-d", "✒️白描", "少修饰。"), P("s-e", "✒️短句", "句子短。"), P("s-f", "✒️电影感", "镜头切换。")];
const F = { prompts, prompt_order: [{ character_id: 100001, order: prompts.map((p) => ({ identifier: p.identifier, enabled: true })) }] };
await page.evaluate(async (F) => {
  window.__mock.names.push("文风来源"); window.__mock.presets.push(F);
  const sec = await import("/test/site/scripts/secrets.js");
  sec.secret_state.api_key_custom.push({ id: "k-main", value: "ain", active: true }, { id: "k-hs", value: "-hs", active: false });
  window.__active = () => sec.secret_state.api_key_custom.find((x) => x.active)?.id;
  window.__secrets = () => sec.secret_state.api_key_custom;
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
const useRow = (u) => page.locator(`.pa-aux-row[data-use="${u}"]`);
check(/跟随主 API/.test(await useRow("suture").textContent()) && await page.locator(".pa-aux .pa-empty").isVisible(), "默认跟随主 API，还没有渠道");
check(await page.locator('.pa-aux [data-whynote="aux"]').isHidden(), "说明收在 ⓘ 里");
const aux = () => page.evaluate(() => window.SillyTavern.getContext().extensionSettings.mcdonalds.aux);
const top = ".pa-sheet-mask:not(.pa-out)";
// 从主 API 的站点添加
await page.click('.pa-aux [data-a="add"]');
await page.locator(`${top} .pa-pick-item`, { hasText: "从主 API 的站点添加" }).click();
await page.waitForSelector('.pa-npick-item[data-v="hs"]');
await page.locator('.pa-npick-item[data-v="hs"]').click();
await page.waitForSelector(`${top} [data-m="doubao-pro"]`);
await page.locator(`${top} [data-m="doubao-pro"]`).first().click();
await page.waitForTimeout(500);
let a1 = await aux();
check(a1.channels.length === 1 && a1.channels[0].site === "hs" && a1.channels[0].model === "doubao-pro" && a1.channels[0].name === "火山", "从主 API 的站点添加渠道：" + JSON.stringify(a1.channels[0]));
// 新建只在副 API 用的渠道
await page.click('.pa-aux [data-a="add"]');
await page.locator(`${top} .pa-pick-item`, { hasText: "新建" }).click();
await page.waitForSelector(`${top} [data-f="url"]`);
await page.fill(`${top} [data-f="name"]`, "硅基流动");
await page.fill(`${top} [data-f="url"]`, "https://api.sf.example/v1");
await page.fill(`${top} [data-f="key"]`, "sk-sf-123");
await page.fill(`${top} [data-f="model"]`, "Qwen/Qwen3-8B");
await page.locator(`${top} .pa-sheet-actions .pa-btn`, { hasText: "保存" }).click();
await page.waitForTimeout(500);
a1 = await aux();
const sf = a1.channels[1];
const st1 = await page.evaluate(() => ({ list: window.__secrets().map((x) => [x.id, x.label || "", x.active]), sites: window.SillyTavern.getContext().extensionSettings.mcdonalds.sites.length }));
check(sf?.name === "硅基流动" && sf.url === "https://api.sf.example/v1" && sf.model === "Qwen/Qwen3-8B" && !!sf.secretId && !sf.site, "新建渠道存下网址、模型和密钥库编号：" + JSON.stringify(sf));
check(st1.sites === 1 && st1.list.some(([id, l]) => id === sf.secretId && /麦当劳副 API · 硅基流动/.test(l)) && await page.evaluate(() => window.__active()) === "k-main", "密钥存进酒馆密钥库，主 API 的站点列表和使用中的密钥不变");
const names = await page.evaluate(() => [...document.querySelectorAll(".pa-aux-ch .pa-aux-k b")].map((b) => b.textContent));
check(names.join(",") === "火山,硅基流动", "渠道列表：" + names.join(","));
// 用途选渠道
const pickUse = async (u, id) => { await useRow(u).click(); await page.waitForSelector(`.pa-npick-item[data-v="${id}"]`); await page.locator(`.pa-npick-item[data-v="${id}"]`).click(); await page.waitForTimeout(400); };
await pickUse("suture", a1.channels[0].id);
await pickUse("review", sf.id);
a1 = await aux();
check(a1.use.suture === a1.channels[0].id && a1.use.review === sf.id, "两个用途各选一个渠道");
check(/火山/.test(await useRow("suture").textContent()) && /doubao-pro/.test(await useRow("suture").textContent()) && /Qwen3-8B/.test(await useRow("review").textContent()), "用途行写出渠道和模型");
// 渠道上的闪电测试：发到渠道，换上渠道的密钥，回来后换回
const chRow = (id) => page.locator(`.pa-aux-ch[data-ch="${id}"]`);
await page.evaluate(() => { window.__reply = "Hi!"; });
await chRow(a1.channels[0].id).locator('[data-a="test"]').click();
await page.waitForSelector(`.pa-aux-ch[data-ch="${a1.channels[0].id}"] .pa-live-res`, { timeout: 5000 });
const t1 = await page.evaluate((id) => ({ res: document.querySelector(`.pa-aux-ch[data-ch="${id}"] .pa-live-res`).textContent, sent: window.__sent.at(-1), active: window.__active() }), a1.channels[0].id);
check(/可用/.test(t1.res), "测试结果：" + t1.res);
const pl = t1.sent.payload;
check(pl.chat_completion_source === "custom" && pl.custom_url === "https://ark.example/api/v3" && pl.model === "doubao-pro", "请求改发到渠道的网址和模型");
check(!("reverse_proxy" in pl) && !("proxy_password" in pl) && !("custom_include_body" in pl), "主 API 的反向代理和自定义请求体不带过去");
check(t1.sent.active === "k-hs" && pl.stream === true, "发出时用的是站点的密钥（流式）");
check(t1.active === "k-main", "收到回复后换回主 API 的密钥");
await chRow(sf.id).locator('[data-a="test"]').click();
await page.waitForSelector(`.pa-aux-ch[data-ch="${sf.id}"] .pa-live-res`, { timeout: 5000 });
const t2 = await page.evaluate(() => ({ sent: window.__sent.at(-1), active: window.__active() }));
check(t2.sent.payload.custom_url === "https://api.sf.example/v1" && t2.sent.payload.model === "Qwen/Qwen3-8B" && t2.sent.active === sf.secretId && t2.active === "k-main", "只在副 API 用的渠道：用自己的网址、模型和密钥，发完换回");
await page.screenshot({ path: "test/shots/aux-channels.png" });
// 缝合页：选条目后底栏出现「AI 推荐」
await page.evaluate(() => window.__mcdonalds.open("suture"));
await page.waitForTimeout(400);
await choose(page, ".pa-dst-picker .pa-namebtn", "【众生相】Claude-Lite-v1.8");
await choose(page, ".pa-src-name", "文风来源");
check(await page.locator(".pa-aiplace").first().isHidden(), "没选条目时不显示「AI 推荐」");
for (const id of ["s-a", "s-b", "s-c", "s-d", "s-e", "s-f"]) await page.locator(`.pa-src-list [data-id="${id}"] .pa-name`).click();
await page.waitForTimeout(200);
const aiBtn = page.locator('[data-st="aiplace"]');
check(await aiBtn.isVisible(), "选了条目后底栏显示「AI 推荐」");
// 2.11.31 作用不同的条目分两组，各自的位置；原因里的编号换成名字。2.11.33 第一组 5 条带组名，第二组没给组名
await page.evaluate(() => {
  window.__reply = (payload) => {
    const u = payload.messages[1].content;
    const e = u.match(/(E\d+) [开关] ✒️意识流/)[1], g = u.match(/(G\d+)「写作指导」/)[1], g2 = u.match(/(G\d+)「正文规则」/)[1], g3 = u.match(/(G\d+)「文风设定」/)[1];
    const picked = [...u.matchAll(/<条目 序号="(\d+)" 名称="([^"]*)">/g)].map((m) => [Number(m[1]), m[2]]);
    const style = picked.filter(([, n]) => n !== "📌收尾").map(([i]) => i), end = picked.filter(([, n]) => n === "📌收尾").map(([i]) => i);
    return "```json\n" + JSON.stringify({ groups: [
      style.length && { name: "本体文风", entries: style, places: [{ type: "after", entry: e, reason: `文风条目，接在${e}后，归入${g3}` }, { type: "after", entry: "E999", reason: "不存在" }, { type: "group_start", group: g, reason: "写作类规则" }] },
      end.length && { entries: [...end, 99], places: [{ type: "group_start", group: g2, reason: "收尾属于正文规则" }] }
    ].filter(Boolean) }) + "\n```";
  };
});
await aiBtn.click();
await page.waitForSelector(".pa-aip-grp", { timeout: 5000 });
const cards = () => page.evaluate(() => [...document.querySelectorAll(".pa-aip-grp")].map((c) => ({ 组: c.querySelector(".pa-aip-name").textContent.trim(), 条数: c.querySelector(".pa-aip-n").textContent.trim(), 条目: c.querySelector(".pa-aip-few")?.textContent.trim() || "", 位置: c.querySelector(".pa-aip-best .pa-aip-pos").textContent.trim(), 原因: c.querySelector(".pa-aip-best .pa-aip-why")?.textContent.trim() || "" })));
const r1 = await page.evaluate(() => ({ head: document.querySelector(".pa-aip .pa-aux-use").textContent, alt: [...document.querySelectorAll('.pa-aip-grp [data-x="alt"]')].map((b) => b.textContent), user: window.__sent.at(-1).payload.messages[1].content, sys: window.__sent.at(-1).payload.messages[0].content }));
const c1 = await cards();
check(/^火山 · 约 [\d.]+ (万字|字)更改$/.test(r1.head), "窗口顶部一行：用哪个渠道、约多少字：" + r1.head);
check(c1.length === 2, "两条作用不同，分两组");
check(c1[0]["组"] === "本体文风" && c1[0]["条数"] === "5 条" && c1[0]["位置"] === "「文风设定」组内，「✒️意识流」之后" && c1[0]["原因"] === "文风条目，接在「✒️意识流」后，归入「文风设定」", "第一组写明组名、条数、位置、原因，原因里的编号换成名字：" + JSON.stringify(c1[0]));
check(c1[1]["组"] === "📌收尾" && c1[1]["条目"] === "📌收尾" && c1[1]["位置"] === "「正文规则」组内最前", "第二组没给组名时用条目名，三条以内直接列出：" + JSON.stringify(c1[1]));
// 条目多的组：列表收着，点条数展开，再点「收起」合上；分隔条目只留标题
const tog = page.locator('.pa-aip-grp[data-g="0"] [data-x="list"]'), list = page.locator('.pa-aip-grp[data-g="0"] .pa-aip-list');
check(await list.isHidden(), "条目多的组，列表默认收着");
await tog.click();
const li = await list.evaluate((l) => [...l.children].map((x) => (x.classList.contains("pa-aip-div") ? "#" : "") + x.textContent));
check(await list.isVisible() && (await tog.textContent()) === "收起" && (await tog.getAttribute("aria-expanded")) === "true" && li.join("|") === "✒️古风|#文风选择|✒️白描|✒️短句|✒️电影感", "点条数展开，一行一条，分隔条目当小标题：" + li.join("|"));
await tog.click();
check(await list.isHidden() && (await tog.textContent()) === "5 条", "再点「收起」合上");
check(r1.alt.join() === "其他位置 1", "其他位置收起，编号对不上的不要：" + r1.alt.join());
check(/✒️古风/.test(r1.user) && /半文半白/.test(r1.user) && /G\d+「文风设定」/.test(r1.user) && /不要执行/.test(r1.sys) && /按作用分组/.test(r1.sys), "发出目标目录、已选条目全文，要求按作用分组，说明资料里的指令不执行");
await page.screenshot({ path: "test/shots/aux-suture-groups.png" });
await page.locator('.pa-aip-grp[data-g="0"] [data-x="alt"]').click();
check(await page.locator('.pa-aip-grp[data-g="0"] .pa-aip-alt').isVisible() && (await page.locator('.pa-aip-grp[data-g="0"] [data-x="alt"]').textContent()) === "收起", "点「其他位置」展开");
await page.locator('.pa-aip-grp[data-g="0"] [data-x="alt"]').click();
// 2.11.35 重新推荐留下记录：第 2 次第一组换了位置；顶部切换「第 1 次 / 第 2 次」，每组写明几次里有几次推荐这里
const nA = await page.evaluate(() => window.__sent.length);
await page.evaluate(() => {
  const f = window.__reply;
  window.__reply1 = f;
  window.__reply = (payload) => { const t = JSON.parse(f(payload).replace(/^```json\n|\n```$/g, "")); t.groups[0].places.reverse(); return JSON.stringify(t); };
});
await page.click('.pa-aip [data-x="again"]');
await page.waitForSelector(".pa-aip-runs");
const tabs = () => page.$$eval('.pa-aip-runs [role="tab"]', (b) => b.map((x) => (x.getAttribute("aria-selected") === "true" ? "*" : "") + x.querySelector("span").textContent).join());
const agree = () => page.$$eval(".pa-aip-grp", (gs) => gs.map((g) => g.querySelector(".pa-aip-agree")?.textContent || "").join("|"));
let c2 = await cards();
check(await tabs() === "第 1 次,*第 2 次" && c2[0]["位置"] === "「写作指导」组内最前", "重新推荐后两次都留着，显示第 2 次：" + await tabs() + " " + c2[0]["位置"]);
check(await agree() === "2 次里 1 次推荐这里|2 次都推荐这里", "每组写明几次里有几次推荐这里：" + await agree());
await page.screenshot({ path: "test/shots/aux-suture-runs.png" });
await page.click('.pa-aip-runs [data-r="0"]');
c2 = await cards();
check(await tabs() === "*第 1 次,第 2 次" && c2[0]["位置"] === "「文风设定」组内，「✒️意识流」之后" && await page.evaluate(() => window.__sent.length) === nA + 1, "点「第 1 次」切回第一次的结果，不再发请求");
const kept = await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem("mcdonalds:aiplace") || "{}")).map((b) => b.runs.length));
check(kept.join() === "2", "记录存在本浏览器：" + kept.join());
await page.evaluate(() => { window.__reply = window.__reply1; });
// 同一批条目再打开：直接显示上次的结果，不再发请求
const n0 = await page.evaluate(() => window.__sent.length);
await page.click(`${top} .pa-sheet-x`);
await page.waitForTimeout(300);
await aiBtn.click();
await page.waitForSelector(".pa-aip-grp");
check(await page.evaluate(() => window.__sent.length) === n0 && await tabs() === "第 1 次,*第 2 次", "同一批条目再打开时显示最近一次的结果，不再发请求");
await page.click('.pa-aip-runs [data-r="0"]');
// 第二组「放这里」：只留这一组，第一组排队；2.12.6 起关掉推荐窗口后直接打开缝合预览（写法、思维链接入）
await page.locator('.pa-aip-grp[data-g="1"] [data-x="use"]').click();
await page.waitForTimeout(600);
const w2 = await page.evaluate(() => ({ where: document.querySelector(".pa-sbar .pa-where").textContent, n: document.querySelector(".pa-sbar .pa-picked-n").textContent, sheets: [...document.querySelectorAll(".pa-sheet-mask:not(.pa-out) .pa-sheet-head b")].map((b) => b.textContent) }));
check(w2.where === "位置：「正文规则」组内最前" && w2.n.startsWith("已选 1 条") && w2.sheets.length === 1 && /^缝合 1 条到/.test(w2.sheets[0]), "点第二组「放这里」：只留这一组、选上位置，推荐窗口换成缝合预览：" + JSON.stringify(w2));
check(await page.locator(".pa-dst-list .pa-insert-mark").count() === 1, "目标列表里有位置标记");
await page.screenshot({ path: "test/shots/aux-suture-use-review.png" });
// 缝完这一组，底栏「接着缝」选上第一组和它的位置
await page.locator(".pa-sheet-mask:not(.pa-out) .pa-sheet-actions .pa-btn-primary").last().click();
await page.waitForTimeout(800);
const qb = page.locator('[data-st="aiqueue"]');
check(await qb.isVisible() && (await qb.textContent()) === "接着缝 5 条" && (await page.locator(".pa-sbar .pa-where").textContent()) === "AI 推荐的下一组", "缝完后底栏出现「接着缝 5 条」");
await qb.click();
await page.waitForTimeout(600);
const w3 = await page.evaluate(() => ({ where: document.querySelector(".pa-sbar .pa-where").textContent, n: document.querySelector(".pa-sbar .pa-picked-n").textContent, sheets: [...document.querySelectorAll(".pa-sheet-mask:not(.pa-out) .pa-sheet-head b")].map((b) => b.textContent) }));
check(w3.where === "位置：「文风设定」组内，「✒️意识流」之后" && w3.n.startsWith("已选 5 条") && await qb.isHidden() && w3.sheets.length === 1 && /^缝合 5 条到/.test(w3.sheets[0]), "点「接着缝」：选上排队的那一组和它的位置，直接打开缝合预览：" + JSON.stringify(w3));
// 预览里取消：回到缝合页，已选的条目和位置都还在
await page.click(`${top} .pa-sheet-x`);
await page.waitForTimeout(300);
check(await page.locator(".pa-sheet-mask:not(.pa-out)").count() === 0 && (await page.locator(".pa-sbar .pa-picked-n").textContent()).startsWith("已选 5 条"), "预览里取消后，已选的条目和位置还在");
// 换着密钥时酒馆开始生成：先换回主 API 的密钥
await page.evaluate(() => { window.__hold = new Promise((r) => { window.__release = r; }); });
await aiBtn.click();
await page.waitForSelector(".pa-aip-wait");
await page.waitForFunction(() => window.__active() === "k-hs");
await page.evaluate(() => window.SillyTavern.getContext().eventSource.emit("generation_started", "normal", {}, false));
check(await page.evaluate(() => window.__active()) === "k-main", "副 API 请求进行中酒馆开始生成：先换回主 API 的密钥");
await page.evaluate(() => { window.__release(); window.__hold = null; });
await page.waitForSelector(".pa-aip-grp");
check(await page.evaluate(() => window.__active()) === "k-main" && await page.locator(".pa-aip-grp").count() === 1, "请求结束后仍是主 API 的密钥；只剩一组");
// 模型回了不是 JSON 的东西
await page.evaluate(() => { window.__reply = "好的，我来扮演……"; });
await page.click('.pa-aip [data-x="again"]');
await page.waitForSelector(".pa-aip-res .pa-warn");
check(/不是有效的 JSON/.test(await page.locator(".pa-aip-res .pa-warn").textContent()), "模型没按要求回答时说明原因");
await page.screenshot({ path: "test/shots/aux-suture-error.png" });
await page.click(".pa-sheet-mask:not(.pa-out) .pa-sheet-x");
// 改回跟随主 API：照主 API 发，不换密钥
await page.evaluate(() => { delete window.SillyTavern.getContext().extensionSettings.mcdonalds.aux.use.suture; window.__reply = JSON.stringify({ places: [{ type: "top", reason: "放最前" }] }); });
await page.waitForTimeout(300);
await aiBtn.click();
await page.waitForSelector(".pa-aip-grp");
const f = await page.evaluate(() => ({ sent: window.__sent.at(-1), label: document.querySelector('.pa-aip [data-x="label"]').textContent }));
check(f.label === "主 API" && f.sent.payload.reverse_proxy === "https://rp.example" && f.sent.payload.stream === false && f.sent.active === "k-main", "跟随主 API 时照主 API 的设置发出：" + f.label);
await page.screenshot({ path: "test/shots/aux-suture.png" });
await page.click(`${top} .pa-sheet-x`);
await page.waitForTimeout(300);
// 删除只在副 API 用的渠道：用它的用途改回跟随主 API，密钥从密钥库删掉
await page.evaluate(() => window.__mcdonalds.open("aux"));
await page.waitForTimeout(300);
await chRow(sf.id).locator('[data-a="edit"]').click();
await page.locator(`${top} .pa-sheet-actions .pa-btn`, { hasText: "删除" }).click();
await page.waitForTimeout(300);
await page.locator(`${top} .pa-sheet-actions .pa-btn`, { hasText: "删除" }).click();
await page.waitForTimeout(500);
const del = await aux();
check(del.channels.length === 1 && !del.use.review && !(await page.evaluate((id) => window.__secrets().some((x) => x.id === id), sf.secretId)), "删除渠道：用途改回跟随主 API，密钥从密钥库删掉");
// 2.11.23 的设置（aux[用途] = { siteId, model }）换成渠道
await page.evaluate(() => { window.SillyTavern.getContext().extensionSettings.mcdonalds.aux = { review: { siteId: "hs", model: "ds-flash" } }; window.__mcdonalds.open("conn"); window.__mcdonalds.open("aux"); });
await page.waitForTimeout(300);
const mig = await aux();
check(mig.channels.length === 1 && mig.channels[0].site === "hs" && mig.channels[0].model === "ds-flash" && mig.use.review === mig.channels[0].id && !mig.review && /ds-flash/.test(await useRow("review").textContent()), "2.11.23 的设置换成渠道：" + JSON.stringify(mig));
check(!errs.length, "无页面错误 " + errs.join(" | "));
await browser.close();
if (fail.length) process.exit(1);
