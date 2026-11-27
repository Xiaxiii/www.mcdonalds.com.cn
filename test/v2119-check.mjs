// 2.12.19 验收：主 API 当前连接卡「三行齐平」和「显示余额」收放；站点顶栏 [钱包][＋][⋯] 与整理态零跳位；
// 切换站点、分组原地补丁（卡片节点不重建、展开的分组保持打开）；副 API 功能卡与渠道卡双向联动、同源站点折叠、测速两处同步；
// 「更多」四页在手机、平板宽度和素白、夜雾下不横向溢出、无报错。
// 先构建并在仓库根目录运行 8765 静态服务。用法：node test/v2119-check.mjs
import { chromium } from "playwright";
import assert from "node:assert/strict";
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const ok = (m) => console.log("✓", m);
const errs = [];
const top = ".pa-sheet-mask:not(.pa-out)";
const S = (page) => page.evaluate(() => window.SillyTavern.getContext().extensionSettings.mcdonalds);
async function open(w = 390, h = 844, mobile = true) {
  const page = await (await browser.newContext({ viewport: { width: w, height: h }, hasTouch: mobile, isMobile: mobile })).newPage();
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
  await page.goto("http://127.0.0.1:8765/test/site/index.html");
  await page.waitForFunction(() => window.__mcdonalds?.open, null, { timeout: 15000 });
  return page;
}
try {
  const page = await open();
  await page.route("**/api/backends/chat-completions/status", (r) => r.fulfill({ json: { data: [{ id: "m1" }] } }));
  // 模拟酒馆的连接控件（同 multikey-check）
  await page.evaluate(() => {
    const live = window.__mock.live;
    document.body.insertAdjacentHTML("beforeend", `<div hidden><select id="main_api"><option value="openai">openai</option></select>
      <select id="chat_completion_source"><option value="custom">custom</option><option value="openai">openai</option><option value="deepseek">deepseek</option></select>
      <input id="custom_api_url_text"><input id="custom_model_id"><select id="model_custom_select"></select><button id="api_button_openai"></button></div>`);
    $("#main_api").val("openai");
    $("#chat_completion_source").val(live.chat_completion_source).on("change", function () { live.chat_completion_source = this.value; });
    $("#custom_api_url_text").val(live.custom_url).on("input", function () { live.custom_url = this.value; });
    $("#custom_model_id").val(live.custom_model).on("input", function () { live.custom_model = this.value; });
    window.__toasts = [];
    window.toastr = Object.fromEntries(["success", "info", "warning", "error"].map((k) => [k, (m) => window.__toasts.push(`${k}:${m}`)]));
  });
  await page.evaluate(async () => {
    const sec = await import("/test/site/scripts/secrets.js");
    sec.secret_state.api_key_custom.push({ id: "k1", value: "-k1", active: true }, { id: "k2", value: "-k2", active: false }, { id: "k3", value: "-k3", active: false });
    window.SillyTavern.getContext().extensionSettings.mcdonalds = { balanceShow: true, sites: [
      { id: "s1", name: "月栖", source: "custom", url: "https://example.com/v1", model: "m1", models: ["m1"], secretId: "k1", keyMask: "sk-…k1" },
      { id: "s2", name: "梧桐", source: "custom", url: "https://b.example.com/v1", keyId: "g1", keys: [
        { id: "g1", name: "按次", secretId: "k2", model: "x" }, { id: "g2", name: "按量", secretId: "k3", model: "y" }] },
      { id: "s3", name: "深海", source: "deepseek", url: "", model: "deepseek-chat", models: [], secretId: "k4" }], activeSiteId: "s1" };
    window.__mcdonalds.open("conn");
  });
  await page.waitForTimeout(500);

  // ① 当前连接卡：余额、自动、流式三行，左边小标题与右边控件对齐；取消「显示余额」时两行平滑收起
  const live = page.locator(".pa-live");
  const keys = await live.locator(".pa-kv-k").allTextContents();
  assert.deepEqual(keys, ["余额", "自动", "流式"].filter((k) => k !== "流式" || keys.includes("流式")));
  const rows = await page.evaluate(() => [...document.querySelectorAll(".pa-live .pa-kv-k")].map((k) => {
    const v = k.nextElementSibling.getBoundingClientRect(), r = k.getBoundingClientRect();
    return Math.abs((r.top + r.height / 2) - (v.top + v.height / 2));
  }));
  assert.ok(rows.every((d) => d <= 2), "每行小标题与右边内容居中对齐：" + rows.join(","));
  const right = await page.evaluate(() => {
    const q = document.querySelector(".pa-live [data-a=balq]").getBoundingClientRect();
    const s = document.querySelector(".pa-live [data-o=balauto]").closest(".pa-switch").getBoundingClientRect();
    return Math.abs((q.left + q.right) / 2 - (s.left + s.right) / 2);
  });
  assert.ok(right <= 2, "查询圆钮与开关竖向对齐：" + right);
  const accH = () => page.evaluate(() => document.querySelector(".pa-bal-acc").getBoundingClientRect().height);
  const h0 = await accH();
  await page.locator('[data-o="balshow"]').uncheck();
  assert.equal(await page.locator(".pa-live .pa-bal").count(), 0, "取消后立刻不再算作余额区");
  await page.waitForTimeout(90);
  const hMid = await accH();
  await page.waitForTimeout(300);
  assert.ok(h0 > 40 && hMid > 0 && hMid < h0 && await accH() === 0, `收起有过渡：${h0} → ${hMid} → 0`);
  await page.locator('[data-o="balshow"]').check();
  await page.waitForTimeout(90);
  const hMid2 = await accH();
  await page.waitForTimeout(300);
  assert.ok(hMid2 < h0 && Math.abs(await accH() - h0) <= 1, `展开有过渡：${hMid2} → ${h0}`);
  ok("当前连接卡三行齐平；「显示余额」平滑收起、展开");

  // 2.12.20 ② 手机上「自动」与「流式」两个开关一样大（不再被 .pa-bal-auto 撑高到 34px）
  const sw = await page.evaluate(() => {
    const h = (el) => el ? Math.round(el.getBoundingClientRect().height * 10) / 10 : null;
    return { auto: h(document.querySelector(".pa-live [data-o=balauto]").closest(".pa-switch")), stream: h(document.querySelector(".pa-live .pa-stream .pa-switch")), any: h(document.querySelector(".pa-switch:not(.pa-bal-auto)")) };
  });
  assert.ok(Math.abs(sw.auto - (sw.stream ?? sw.any)) <= 1 && sw.auto <= 28, "「自动」「流式」开关同高：" + JSON.stringify(sw));
  ok("2.12.20 「自动」「流式」开关同高");

  // ② 站点顶栏：钱包 32px 圆钮，三个按钮热区不重叠；⋯ → 排序与删除：「完成」钉在 ⋯ 原位，把手滑出，点站点名不弹编辑窗
  const box = (sel) => page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height }; }, sel);
  const wb = await box(".pa-plan-sites [data-a=balall]");
  assert.equal(wb.w, 32, "钱包平时是 32px 圆钮");
  assert.equal((await page.locator(".pa-plan-sites [data-a=balall]").innerText()).trim(), "", "平时不带文字");
  const hits = await page.evaluate(() => [...document.querySelectorAll(".pa-plan-sites .pa-head-btns > .pa-head-ico")].map((b) => {
    const r = b.getBoundingClientRect(), c = getComputedStyle(b, "::before");
    const ins = c.inset.split(" ").map(parseFloat);
    const [t, rr, bb, l] = ins.length === 2 ? [ins[0], ins[1], ins[0], ins[1]] : ins;
    return { l: r.left + l, r: r.right - rr, h: r.height - t - bb };
  }));
  for (let i = 1; i < hits.length; i++) assert.ok(hits[i].l >= hits[i - 1].r, "相邻热区不重叠");
  assert.ok(hits.every((x) => x.h >= 44), "热区高 ≥ 44px：" + hits.map((x) => x.h).join(","));
  const more0 = await box(".pa-plan-sites [data-a=sitesmore]");
  await page.click(".pa-plan-sites [data-a=sitesmore]");
  await page.locator(`${top} [data-a=sitesedit]`).click();
  await page.waitForTimeout(350);
  const done = await box(".pa-plan-sites [data-a=sitesdone]");
  assert.ok(Math.abs(done.r - more0.r) <= 1 && Math.abs(done.h - more0.h) <= 1, `「完成」钉在 ⋯ 原位：Δx=${done.r - more0.r} Δh=${done.h - more0.h}`);
  const slot = await page.evaluate(() => getComputedStyle(document.querySelector(".pa-plan-sites .grip-slot")).width);
  assert.equal(slot, "28px", "把手槽滑出");
  await page.locator(".pa-plan-sites .pa-site", { hasText: "月栖" }).locator(".site-main").click();
  await page.waitForTimeout(250);
  assert.equal(await page.locator(top).count(), 0, "整理态点站点名不弹编辑窗");
  const dels = await page.evaluate(() => [...document.querySelectorAll(".pa-plan-sites .pa-site-del")].map((b) => Math.round(b.getBoundingClientRect().right)));
  assert.ok(dels.length === 3 && new Set(dels).size === 1, "垃圾桶竖成一条线：" + dels.join(","));
  await page.click(".pa-plan-sites [data-a=sitesdone]");
  await page.waitForTimeout(400);
  assert.equal(await page.locator(".pa-plan-sites .pa-site-grip").count(), 0, "完成后把手收回");
  ok("站点顶栏钱包 32px、热区不重叠；整理态「完成」零跳位、把手滑出、点卡片不误开编辑");

  // 2.12.20 ① 顶栏 [＋] 与 [钱包][⋯] 同一套圆钮：没有主题色粗边、蓝底；③「使用中」是绿色系；④ 折叠胶囊里是 SVG 箭头
  const heads = await page.evaluate(() => [...document.querySelectorAll(".pa-plan-sites .pa-head-btns > .pa-head-ico")].map((b) => { const c = getComputedStyle(b); return { a: b.dataset.a, bg: c.backgroundColor, sh: c.boxShadow, bc: c.borderTopColor, bw: c.borderTopWidth }; }));
  const plus = heads.find((x) => x.a === "new"), more = heads.find((x) => x.a === "sitesmore");
  assert.ok(plus && more && plus.bg === more.bg && plus.sh === more.sh, "＋ 与 ⋯ 同底色、同阴影：" + JSON.stringify(heads));
  const thread = await page.evaluate(() => { const p = document.createElement("i"); p.style.color = "var(--pa-thread)"; document.getElementById("mcd-root").append(p); const c = getComputedStyle(p).color; p.remove(); return c; });
  assert.ok(!(plus.bw !== "0px" && plus.bc === thread) && !plus.sh.includes(thread), "＋ 没有 1px 主题色实线框");
  const chip = await page.evaluate(() => { const c = document.querySelector(".pa-plan-sites .pa-site-on-chip"); const cs = getComputedStyle(c); const ok = getComputedStyle(document.getElementById("mcd-root")).getPropertyValue("--pa-ok").trim(); const p = document.createElement("i"); p.style.color = ok; document.body.append(p); const okc = getComputedStyle(p).color; p.remove(); return { color: cs.color, okc, bg: cs.backgroundColor, h: c.getBoundingClientRect().height }; });
  assert.ok(chip.color === chip.okc && chip.h <= 27, "「使用中」用语义绿：" + JSON.stringify(chip));
  const pill = await page.evaluate(() => { const b = document.querySelector(".pa-plan-sites [data-a=sitefold]"); return { svg: !!b.querySelector("svg"), text: b.textContent }; });
  assert.ok(pill.svg && !/[▸▾▶]/.test(pill.text), "「N 组」胶囊用细线 SVG 箭头：" + pill.text);
  ok("2.12.20 顶栏 ＋ 与钱包、⋯ 同款；「使用中」柔绿；折叠胶囊 SVG 箭头");

  // ③ 切换站点、分组：卡片节点原地复用；展开的多密钥分组保持打开；顶部卡片回响
  await page.evaluate(() => { window.__nodes = [...document.querySelectorAll(".pa-plan-sites .pa-sitecard")]; window.__liveNode = document.querySelector(".pa-live"); });
  await page.locator(".pa-plan-sites .pa-site", { hasText: "梧桐" }).locator("[data-a=sitefold]").click();
  await page.waitForTimeout(300);
  await page.evaluate(() => { window.__nodes = [...document.querySelectorAll(".pa-plan-sites .pa-sitecard")]; });
  await page.locator(".pa-plan-sites .pa-site-multi .pa-kline", { hasText: "按量" }).locator("[data-a=use]").click();
  await page.waitForFunction(() => window.__toasts.some((t) => /按量/.test(t)), null, { timeout: 20000 });
  await page.waitForTimeout(300);
  const same0 = await page.evaluate(() => [[...document.querySelectorAll(".pa-plan-sites .pa-sitecard")].map((n, i) => n === window.__nodes[i]), document.querySelector(".pa-live") === window.__liveNode]);
  const same = same0[0].every(Boolean) && same0[1];
  assert.ok(same, "站点卡、当前连接卡都是原来的节点");
  assert.ok(await page.locator(".pa-plan-sites .pa-site-multi.open .pa-kline").count() === 2, "展开的分组保持打开");
  assert.match(await page.locator(".pa-plan-sites .pa-site-multi .pa-kline", { hasText: "按量" }).innerText(), /使用中/);
  assert.ok(await page.evaluate(() => document.querySelector(".pa-plan-sites .pa-site-multi").classList.contains("pa-srow-on") && !document.querySelector('.pa-plan-sites .pa-sitecard[data-id="s1"]').classList.contains("pa-srow-on")));
  const bg = await page.evaluate(() => getComputedStyle(document.querySelector(".pa-plan-sites .pa-sitecard")).transitionProperty);
  assert.match(bg, /background-color/, "激活底色可过渡");
  await page.locator(".pa-plan-sites .pa-site", { hasText: "月栖" }).locator("[data-a=use]").click();
  await page.waitForFunction(() => window.__toasts.some((t) => /「月栖」/.test(t)), null, { timeout: 20000 });
  await page.waitForTimeout(300);
  assert.ok(await page.evaluate(() => [...document.querySelectorAll(".pa-plan-sites .pa-sitecard")].every((n, i) => n === window.__nodes[i])), "切回单密钥站点也原地更新");
  ok("切换站点、分组原地补丁，展开的分组不跳回");
  await page.screenshot({ path: "test/shots/v2119-conn.png" });
  await page.context().close();

  // ④ 副 API：渠道卡指派胶囊双向同步功能卡；≥2 个同源渠道合成一组；一处测速两处同步；整理态排序、删除
  const ap = await open();
  await ap.route("**/api/secrets/rotate", (r) => r.fulfill({ status: 404, body: "" }));
  await ap.evaluate(() => {
    const ctx = window.SillyTavern.getContext();
    ctx.extensionSettings.mcdonalds = { sites: [{ id: "yw", name: "云雾", source: "custom", url: "https://yw.example/v1", model: "claude-haiku-4-5", models: ["claude-haiku-4-5", "gemini-2.5-flash", "deepseek-v4"] }],
      aux: { channels: [{ id: "c1", name: "云雾 · Haiku 4.5", site: "yw", model: "claude-haiku-4-5" }, { id: "c2", name: "硅基流动", url: "https://api.sf.example/v1", model: "Qwen/Qwen3-8B" }, { id: "c3", name: "云雾 · Flash", site: "yw", model: "gemini-2.5-flash" }], use: {} } };
    ctx.getChatCompletionModel = () => window.__mock.live.custom_model;
    window.__sent = [];
    ctx.ChatCompletionService = {
      presetToGeneratePayload: (_p, _o, params) => ({ ...params }),
      async sendRequest(payload) { window.__sent.push(payload); await new Promise((r) => setTimeout(r, 400)); return payload.stream ? async function* () { yield { text: "Hi" }; } : { content: "Hi" }; }
    };
    window.__mcdonalds.open("aux");
  });
  await ap.waitForTimeout(400);
  assert.equal(await ap.locator(".pa-aux-row[data-use]").count(), 2, "两张功能卡各有模型框");
  assert.equal(await ap.locator(".pa-aux-fn [data-a=edit]").count(), 0, "功能卡上没有编辑按钮");
  assert.match(await ap.locator('.pa-aux-row[data-use="suture"]').innerText(), /跟随主 API/);
  assert.ok(await ap.locator('.pa-aux-row[data-use="suture"] .pa-aux-dot.is-follow').count(), "跟随主 API 是空心圆点");
  // 同源两个渠道合成一组，收起时写明含哪些模型
  const grp = ap.locator('.pa-aux-grp[data-site="yw"]');
  assert.equal(await grp.count(), 1, "同源的两个渠道合成一组");
  assert.match(await grp.innerText(), /主 API 同源站点 · 含 claude-haiku-4-5、gemini-2\.5-flash/);
  assert.match(await grp.locator(".pa-fold-pill").innerText(), /2 个/);
  assert.deepEqual(await ap.locator(".pa-aux-chs > .pa-aux-unit").evaluateAll((ns) => ns.map((n) => n.dataset.site || n.dataset.ch)), ["yw", "c2"], "组排在第一个渠道的位置");
  // 硅基流动的指派胶囊：用于「推荐缝合位置」→ 功能卡跟着变
  const chPill = (id) => ap.locator(`.pa-aux-ch[data-ch="${id}"] [data-a=assign]`);
  assert.equal((await chPill("c2").innerText()).trim(), "选用");
  await chPill("c2").click();
  await ap.locator(`${top} .pa-pick-item`, { hasText: "用于「推荐缝合位置」" }).click();
  await ap.waitForTimeout(300);
  assert.equal((await S(ap)).aux.use.suture, "c2");
  assert.match(await ap.locator('.pa-aux-row[data-use="suture"]').innerText(), /硅基流动 · Qwen\/Qwen3-8B/);
  assert.equal((await chPill("c2").innerText()).trim(), "缝合在用");
  assert.ok(await ap.locator('.pa-aux-row[data-use="suture"] .pa-aux-dot.is-ch').count(), "用渠道是实心绿点");
  await chPill("c2").click();
  await ap.locator(`${top} .pa-pick-item`, { hasText: "也用于「回复语义审查」" }).click();
  await ap.waitForTimeout(300);
  assert.equal((await chPill("c2").innerText()).trim(), "2 项在用");
  assert.match(await ap.locator('.pa-aux-row[data-use="review"]').innerText(), /硅基流动/);
  // 功能卡下拉选组里的渠道：组头露出在用标签
  await ap.locator('.pa-aux-row[data-use="review"]').click();
  await ap.waitForTimeout(250);
  const popW = await ap.evaluate(() => [document.querySelector(".pa-sheet-mask:not(.pa-out) .pa-sheet").getBoundingClientRect().width, document.querySelector('.pa-aux-row[data-use="review"]').getBoundingClientRect().width]);
  assert.ok(Math.abs(popW[0] - popW[1]) <= 1, "下拉与模型框等宽：" + popW.join(","));
  assert.equal(await ap.locator(`${top} .pa-auxpick-add`).count(), 1, "下拉底部有「添加渠道」");
  await ap.locator(`${top} .pa-npick-item[data-v="c1"]`).click();
  await ap.waitForTimeout(300);
  assert.equal((await chPill("c2").innerText()).trim(), "缝合在用");
  assert.match(await grp.locator(".pa-aux-routetag").innerText(), /审查在用/, "组收起时也看得出组里谁在用");
  // 展开组：子行去掉站点名前缀；底部「添加云雾的其他模型」
  await grp.locator(".pa-fold-pill").click();
  await ap.waitForTimeout(350);
  assert.deepEqual(await grp.locator(".pa-aux-child .pa-aux-k b").allTextContents(), ["Haiku 4.5", "Flash"]);
  assert.match(await grp.locator(".pa-aux-addmore").innerText(), /添加「云雾」的其他模型/);
  await grp.locator(".pa-aux-addmore").click();
  await ap.locator(`${top} [data-m="deepseek-v4"]`).first().click();
  await ap.waitForTimeout(400);
  assert.equal((await S(ap)).aux.channels.filter((c) => c.site === "yw").length, 3, "从组底部添加同站的其他模型");
  assert.match(await grp.locator(".pa-fold-pill").innerText(), /3 个/);
  // 一处测速，两处同步：功能卡「推荐缝合位置」用的是硅基流动
  await ap.locator('.pa-aux-ch[data-ch="c2"] [data-a=test]').click();
  await ap.waitForTimeout(120);
  assert.deepEqual(await ap.locator('.pa-aux-fn[data-fn="suture"] .ico-morph').getAttribute("data-st"), "busy", "功能卡的闪电同时转圈");
  await ap.waitForSelector('.pa-aux-fn[data-fn="suture"] .pa-live-res.ok', { timeout: 5000 });
  assert.match(await ap.locator('.pa-aux-ch[data-ch="c2"] .pa-live-res').innerText(), /可用/);
  assert.match(await ap.locator('.pa-aux-fn[data-fn="suture"] .pa-live-res').innerText(), /可用/);
  ok("副 API：指派胶囊与功能卡双向同步；同源站点合成一组、可添加同站其他模型；一处测速两处同步");
  // 整理态：⋯ → 排序与删除；完成钉在原位；方向键排序；删除
  const moreR = (await ap.locator(".pa-aux [data-a=chmore]").boundingBox());
  await ap.click(".pa-aux [data-a=chmore]");
  await ap.waitForTimeout(350);
  const doneR = await ap.locator(".pa-aux [data-a=chdone]").boundingBox();
  assert.ok(Math.abs(doneR.x + doneR.width - moreR.x - moreR.width) <= 1, "「完成」钉在 ⋯ 原位");
  assert.equal(await ap.locator(".pa-aux .pa-aux-grp.open").count(), 0, "整理态同源组收起");
  await ap.locator(".pa-aux .pa-aux-grip").first().focus();
  await ap.keyboard.press("ArrowDown");
  await ap.waitForTimeout(200);
  assert.deepEqual((await S(ap)).aux.channels.map((c) => c.id).slice(0, 1), ["c2"], "同源组整组往下挪");
  await ap.locator('.pa-aux-ch[data-ch="c2"] [data-a=delch]').click();
  await ap.locator(`${top} .pa-btn-danger`).click();
  await ap.waitForTimeout(300);
  assert.ok(!(await S(ap)).aux.channels.some((c) => c.id === "c2") && !(await S(ap)).aux.use.suture, "删除渠道，用它的功能改回跟随主 API");
  await ap.click(".pa-aux [data-a=chdone]");
  await ap.waitForTimeout(350);
  ok("副 API 整理态：完成零跳位、整组排序、删除");
  await ap.screenshot({ path: "test/shots/v2119-aux.png" });
  await ap.context().close();

  // ⑤ 「更多」四页：手机、平板宽度，素白、夜雾下都不横向溢出、无报错；方案分组是就地滑动槽
  for (const [w, h] of [[390, 844], [1180, 820]]) for (const theme of ["su", "night"]) {
    const mp = await open(w, h, w < 760);
    await mp.evaluate((theme) => { const c = window.SillyTavern.getContext(); c.extensionSettings.mcdonalds = { theme, schemes: [{ id: "s1", name: "旧文风", preset: window.__mock.names[0], scope: "all", states: {}, groupStates: {} }] }; }, theme);
    for (const p of ["schemes", "clean", "health", "look"]) {
      await mp.evaluate((p) => window.__mcdonalds.open("more", p), p);
      await mp.waitForTimeout(p === "clean" || p === "health" ? 1200 : 400);
      const o = await mp.evaluate((p) => { const s = document.querySelector(`[data-page=${p}] .pa-scroll`); return [s.scrollWidth, s.clientWidth, document.querySelector("#mcd-root .pa-shell").scrollWidth, window.innerWidth]; }, p);
      assert.ok(o[0] <= o[1] && o[2] <= o[3], `${p} ${theme} ${w}px 不横向溢出：${o.join(",")}`);
    }
    if (w === 390 && theme === "su") {
      await mp.evaluate(() => window.__mcdonalds.open("more", "schemes"));
      await mp.waitForTimeout(300);
      assert.equal(await mp.locator("[data-page=schemes] .pa-seg [data-s=view]").count(), 3, "方案分组：角色卡 | 预设 | 人设");
      await mp.click("[data-s=view][data-v=preset]");
      await mp.waitForTimeout(350);
      const ink = await mp.evaluate(() => { const i = document.querySelector("[data-page=schemes] .pa-seg-ink").getBoundingClientRect(), b = document.querySelector("[data-s=view][data-v=preset]").getBoundingClientRect(); return Math.abs(i.left - b.left) + Math.abs(i.width - b.width); });
      assert.ok(ink <= 1, "滑块落在选中的分组上：" + ink);
      await mp.evaluate(() => window.__mcdonalds.open("more", "look"));
      await mp.waitForTimeout(300);
      assert.equal(await mp.locator("[data-page=look] .pa-prefcard .pa-switch input").count(), 1, "设置偏好卡：防下拉开关（换聊天提示与推理格式已搬回方案页）");
      assert.match(await mp.locator("[data-page=look] .pa-setfoot").innerText(), /2\.\d+\.\d+/, "页脚写版本");
      assert.equal(await mp.locator('[data-page=look] [data-bk="on"], [data-page=look] [data-set=backup]').count(), 0, "设置页不重复放自动备份");
    }
    await mp.context().close();
  }
  ok("「更多」四页在 390 / 1180 宽、素白 / 夜雾下不横向溢出；方案分组滑动槽；设置页偏好卡与页脚");

  assert.deepEqual(errs, []);
  console.log("2.12.19 检查通过");
} finally {
  await browser.close();
}
