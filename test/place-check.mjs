// 选位置、空白分组、分组拖动、API 获取模型的端到端检查
// 用法：npm run mock；在仓库根目录起静态服务（python3 -m http.server 8765）；node test/place-check.mjs
import { chromium } from "playwright";
import { choose, chooseSrcType, chooseDstType } from "./choose.mjs";
const exe = process.env.PW_CHROME || undefined;
const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const errs = []; page.on("pageerror", (e) => errs.push(e.message));
await page.route("**/api/backends/chat-completions/status", (route) => route.fulfill({ json: { data: [{ id: "[0.28/次] claude-opus-4-6" }, { id: "claude-sonnet" }] } }));
await page.goto("http://127.0.0.1:8765/test/site/index.html");
await page.waitForFunction(() => window.__presetAtelier?.open, null, { timeout: 15000 });

// 合成的来源预设 F1：两个分组 + 散条目
const P = (id, name, content) => ({ identifier: id, name, content, role: "system", system_prompt: false, marker: false, injection_position: 0, injection_depth: 4, injection_order: 100 });
const prompts = [P("f1-a", "🎨开场白", "开场白要短。"), P("f1-s1", "🖋️白描", "<白描>\n只写动作和对白。\n</白描>"), P("f1-s2", "🖋️古风", "<古风>\n半文半白。\n</古风>"), P("f1-s3", "🖋️冷幽默", "<冷幽默>\n干巴巴的幽默。\n</冷幽默>"), P("f1-t1", "🎭小剧场·日常", "<小剧场>\n日常。\n</小剧场>"), P("f1-z", "📌收尾", "结尾不要总结。")];
const F1 = {
  prompts,
  prompt_order: [{ character_id: 100001, order: prompts.map((p) => ({ identifier: p.identifier, enabled: true })) }],
  extensions: { baibaiToolkit: { presetPromptGroups: { version: 1, groups: [{ id: "g-style", name: "F1文风", order: 0, collapsed: true, enabled: true }, { id: "g-th", name: "F1小剧场", order: 1, collapsed: true, enabled: true }], prompts: { "f1-s1": { groupId: "g-style" }, "f1-s2": { groupId: "g-style" }, "f1-s3": { groupId: "g-style" }, "f1-t1": { groupId: "g-th" } } } } },
};
const T = "【众生相】Claude-Lite-v1.8";
await page.evaluate((F1) => { window.__mock.names.push("F1"); window.__mock.presets.push(F1); window.__presetAtelier.open("suture"); }, F1);
await page.waitForTimeout(400);
await choose(page, ".pa-dst-picker .pa-namebtn", T); await page.waitForTimeout(300);
await choose(page, ".pa-src-name", "F1"); await page.waitForTimeout(300);

// 预设的顶层结构：分组写成 [组名: 成员…]，空分组按 anchor 排进去，散条目直接写名字
const layout = () => page.evaluate((T) => {
  const m = window.__mock; const p = m.presets[m.names.indexOf(T)];
  const bb = p.extensions.baibaiToolkit.presetPromptGroups;
  const order = p.prompt_order.find((o) => o.character_id == 100001).order.map((o) => o.identifier);
  const nm = (id) => p.prompts.find((x) => x.identifier === id)?.name || id;
  const used = new Set(Object.values(bb.prompts).map((v) => v.groupId));
  const empties = bb.groups.filter((g) => !used.has(g.id) && g.anchor !== undefined);
  const out = [];
  const pushEmpty = (a) => empties.filter((g) => g.anchor === a).forEach((g) => out.push({ g: g.id, ids: [], empty: true }));
  pushEmpty("");
  for (const id of order) {
    const g = bb.prompts[id]?.groupId; const last = out[out.length - 1];
    if (g && last?.g === g && !last.empty) last.ids.push(nm(id)); else out.push({ g, ids: [nm(id)] });
    pushEmpty(id);
  }
  return out.map((b) => b.g ? `[${bb.groups.find((x) => x.id === b.g)?.name}: ${b.ids.join("、")}]` : b.ids.join("、"));
}, T);
const fail = [];
const check = (ok, msg) => { console.log(ok ? "✓" : "✗", msg); if (!ok) fail.push(msg); };
const where = () => page.evaluate(() => document.querySelector(".pa-where").textContent);
const ghead = (name, root) => page.evaluate(({ name, root }) => [...document.querySelectorAll(`${root} .pa-ghead`)].findIndex((h) => h.querySelector(".pa-gname").textContent.trim().startsWith(name)), { name, root });
const clickHead = async (name, root = ".pa-dst-list") => { const i = await ghead(name, root); await page.locator(`${root} .pa-ghead .pa-gname`).nth(i).click(); await page.waitForTimeout(250); };
const clickCaret = async (name, root = ".pa-dst-list") => { const i = await ghead(name, root); await page.locator(`${root} .pa-ghead`).nth(i).locator(".pa-caret").click(); await page.waitForTimeout(200); };
const fillPrompt = async (text) => { await page.fill(".pa-sheet input.pa-input", text); await page.click(".pa-sheet .pa-btn-primary"); await page.waitForTimeout(300); };
const commit = async () => { await page.click('[data-st="go"]'); await page.waitForTimeout(600); await page.click(".pa-sheet-actions .pa-btn-primary"); await page.waitForTimeout(1500); };

console.log("before:", (await layout()).join(" | "));
check(!(await page.locator('.pa-dst-list [data-act="into"]').count()), "目标列表里没有「缝进这组」按钮");
check(!(await page.locator('[data-gm="toggle"]').count()), "缝合页没有「整理分组」模式");

// 1) 整组 F1文风 → 点「正文规则」组名 ＝ 缝在正文规则和写作指导之间，保持成组
await page.evaluate(() => { const h = [...document.querySelectorAll(".pa-src-list .pa-ghead")].find((x) => x.textContent.includes("F1文风")); h.querySelector('[data-act="gselect"]').click(); });
await page.waitForTimeout(200);
await clickHead("正文规则");
check((await where()) === "位置：「正文规则」组之后（组外）", "点组名的位置：" + (await where()));
await page.screenshot({ path: "test/shots/p-1-after-group.png" });
await page.click('[data-st="go"]'); await page.waitForTimeout(600);
check((await page.evaluate(() => document.querySelector('.pa-sheet [data-g="grp"]')?.value)) === "keep", "预览默认「保留原分组」");
check((await page.locator(".pa-sheet .pa-explain .pa-sub", { hasText: "来源「F1」怎样让条目生效" }).count()) === 1, "预览里能看来源的写法（收在「更多选项」里）");
check(await page.evaluate(() => [...document.querySelectorAll(".pa-sheet .pa-item")].every((x) => x.querySelector(".pa-item-body").hidden)), "预览中每条默认收起");
check(await page.evaluate(() => !document.querySelectorAll('.pa-sheet [data-c="hook"]:checked').length && !document.querySelector(".pa-sheet .pa-chip-cot.pa-item-hooked")), "默认不接入思维链");
await page.locator(".pa-sheet .pa-item-head").first().click(); await page.waitForTimeout(200);
check(!(await page.locator(".pa-sheet .pa-item").first().locator(".pa-item-body").isHidden()), "点摘要行展开详情");
await page.screenshot({ path: "test/shots/p-2-review.png" });
await page.click(".pa-sheet-actions .pa-btn-primary"); await page.waitForTimeout(1500);
let L = await layout();
const i1 = L.indexOf("[F1文风: 🖋️白描、🖋️古风、🖋️冷幽默]");
check(i1 > 0 && L[i1 - 1].startsWith("[正文规则:") && L[i1 + 1].startsWith("[写作指导:"), "F1文风成组落在 正文规则 与 写作指导 之间");
check((await where()).includes("「F1文风」组之后"), "缝完位置接在新组后面：" + (await where()));

// 2) 散条目 → 展开「写作指导」点组内第一条 ＝ 缝进组内
await page.evaluate(() => [...document.querySelectorAll(".pa-src-list .pa-row")].find((r) => r.textContent.includes("开场白")).click());
await clickCaret("写作指导");
await page.evaluate(() => { const sec = [...document.querySelectorAll(".pa-dst-list .pa-group")].find((s) => s.querySelector(".pa-gname").textContent.includes("写作指导")); sec.querySelector(".pa-row").click(); });
await page.waitForTimeout(200);
check((await where()) === "位置：「写作指导」组内，「🖋️人物塑造」之后", "组内位置：" + (await where()));
await commit();
check((await layout()).includes("[写作指导: 🖋️人物塑造、🎨开场白、🎬场景推进]"), "开场白进了写作指导组内");

// 3) 缝合页「＋ 新建分组」：起名 → 点「思维链」组名 → 空分组在思维链后面，位置自动定在新组里
await page.click('[data-st="newgroup"]'); await page.waitForTimeout(250);
await fillPrompt("新组A");
await page.screenshot({ path: "test/shots/p-3-newgroup-pick.png" });
await clickHead("思维链");
await page.waitForTimeout(800);
L = await layout();
const iA = L.indexOf("[新组A: ]");
check(iA > 0 && L[iA - 1].startsWith("[思维链:"), "空分组建在思维链之后：" + L.join(" | "));
check((await where()) === "位置：「新组A」组内", "新建后位置在新组内：" + (await where()));
await page.evaluate(() => [...document.querySelectorAll(".pa-src-list .pa-row")].find((r) => r.textContent.includes("收尾")).click());
await commit();
L = await layout();
check(L.includes("[新组A: 📌收尾]") && L[L.indexOf("[新组A: 📌收尾]") - 1].startsWith("[思维链:"), "收尾缝进了新组A");
await page.screenshot({ path: "test/shots/p-4-suture-done.png" });

// 4) 整理页：整组「顶部」用把手拖到「思维链」下半 ＝ 思维链之后，保持成组
await page.click('.pa-tabs [data-nav="preset"]'); await page.waitForTimeout(300);
await choose(page, ".pa-picker-slot .pa-namebtn", T); await page.waitForTimeout(300);
const dragTo = async (fromSel, toSel, frac) => {
  const hb = await page.locator(fromSel).first().boundingBox();
  const tb = await page.locator(toSel).first().boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2); await page.mouse.down();
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height * frac, { steps: 8 });
  await page.waitForTimeout(150); await page.mouse.up(); await page.waitForTimeout(900);
};
await dragTo('.pa-list .pa-group:has(.pa-gname:text-is("顶部")) .pa-ghead .pa-handle', '.pa-list .pa-group:has(.pa-gname:text-is("思维链"))', 0.85);
L = await layout();
check(L[L.findIndex((x) => x.startsWith("[思维链:")) + 1] === "[顶部: 🎭身份、📜破限]", "拖动分组把手：顶部移到思维链之后");

// 5) 整理页「＋ 新建分组」→ 点「正文规则」组名 → 选两条 → 移动 → 「放入此组」
// 手机上「新建分组」在「＋」菜单里
await page.click('[data-tool="add"]'); await page.waitForTimeout(200);
await page.click(".pa-pick-item >> text=＋ 新建分组"); await page.waitForTimeout(250);
await fillPrompt("新组B");
await page.screenshot({ path: "test/shots/p-5-organize-newgroup.png" });
await clickHead("正文规则", ".pa-list");
await page.waitForTimeout(800);
L = await layout();
check(L[L.indexOf("[新组B: ]") - 1]?.startsWith("[正文规则:"), "整理页空分组建在正文规则之后");
// 折叠分组按需创建条目；像用户一样先展开目标组，再点实际可见的条目。
const rules = page.locator('.pa-list .pa-group:has(.pa-gname:text-is("正文规则"))');
if (await rules.evaluate((g) => g.classList.contains("pa-collapsed"))) await rules.locator('.pa-gname').click();
for (const n of ["字数", "禁词"]) await rules.locator('.pa-row').filter({ hasText: n }).click();
await page.click('[data-sel="moveto"]'); await page.waitForTimeout(200);
const newGroupB = page.locator('.pa-list .pa-group:has(.pa-gname:text-is("新组B"))');
if (await newGroupB.evaluate((g) => g.classList.contains("pa-collapsed"))) await newGroupB.locator('[data-act="collapse"]').click();
await newGroupB.locator('[data-act="gstart"]').click();
await page.waitForTimeout(800);
L = await layout();
check(L.includes("[新组B: 📏字数、🚫禁词]") && L.includes("[正文规则: ]"), "两条移入新组B，正文规则变为空分组留在原处");
console.log("after organize:", L.join(" | "));
await page.screenshot({ path: "test/shots/p-6-organize.png" });

// 6) 顶栏：有修改时显示「撤销」「完成」；点完成后收起；备份按钮能列出备份
check(await page.locator('.pa-savebar [data-g="confirm"]').isVisible(), "有修改时显示「完成」");
await page.click('.pa-savebar [data-g="confirm"]'); await page.waitForTimeout(600);
check(!(await page.locator('.pa-savebar [data-g="confirm"]').isVisible()), "点完成后收起撤销/完成");
await page.click('.pa-top [data-g="backups"]'); await page.waitForTimeout(500);
const nBk = await page.locator(".pa-sheet .pa-pick-item").count();
check(nBk >= 1 && nBk <= 10, `备份列表 ${nBk} 份（不超过 10）`);
await page.click(".pa-sheet-x"); await page.waitForTimeout(300);

// 7) 方案与 API：添加站点 → 获取模型列表 → 选择框里选模型 → 保存；方案记录站点
await page.evaluate(async () => { const m = await import(new URL("scripts/secrets.js", document.baseURI).href); m.secret_state.api_key_custom.push({ id: "id1", value: "sk-…abcd", active: true }); });
await page.click('.pa-tabs [data-nav="conn"]'); await page.waitForTimeout(300);
check(await page.locator("[data-page=conn] .pa-plan-sites").isVisible(), "连接页列出站点");
await page.click('[data-a="new"]'); await page.waitForTimeout(300);
await page.fill('.pa-sheet [data-f="name"]', "测试站");
await page.fill('.pa-sheet [data-f="url"]', "https://example.com/v1");
await page.fill('.pa-sheet [data-f="key"]', "sk-test-123456789");
await page.click('.pa-sheet [data-f="fetch"]'); await page.waitForTimeout(800);
const opts = await page.evaluate(() => [...document.querySelectorAll(".pa-mpick-item")].map((o) => o.textContent.trim()));
check(opts.length === 2 && opts.includes("claude-sonnet"), "获取后弹出模型选择框：" + JSON.stringify(opts));
await page.screenshot({ path: "test/shots/p-7-api.png" });
await page.locator(".pa-mpick-item", { hasText: "claude-sonnet" }).click(); await page.waitForTimeout(300);
await page.locator(".pa-sheet-actions .pa-btn-primary").last().click(); await page.waitForTimeout(300);
const site = await page.evaluate(() => window.SillyTavern.getContext().extensionSettings.presetAtelier.sites.find((s) => s.name === "测试站"));
check(site?.model === "claude-sonnet" && site.models.length === 2, "站点保存了模型和列表");
// 切到这个站点，再存方案（API 默认不记录，选「当前连接」后记录 API 站点）
await page.locator(".pa-site", { hasText: "测试站" }).locator('[data-a="use"]').click(); await page.waitForTimeout(2500);
await page.click('.pa-tabs [data-nav="more"]'); await page.click('.pa-subnav [data-m="schemes"]'); await page.waitForTimeout(300);
await page.click('[data-s="new"]'); await page.waitForTimeout(300);
await page.fill('.pa-sheet [data-f="name"]', "测试方案");
check(/测试站/.test(await page.locator(".pa-sheet .pa-save-list").innerText()), "保存窗口列出将保存的 API");
await page.selectOption('.pa-sheet [data-f="api"]', "__live");
await page.click(".pa-sheet-actions .pa-btn-primary"); await page.waitForTimeout(400);
const sc = await page.evaluate(() => window.SillyTavern.getContext().extensionSettings.presetAtelier.schemes.find((s) => s.name === "测试方案"));
check(sc?.siteId === site.id && sc.conn?.siteId === site.id && !!sc.conn.model, "方案记录了 API（站点和模型）");
check(/用于 /.test(await page.locator(".pa-plan-sites .pa-site", { hasText: "测试站" }).locator(".pa-site-name").getAttribute("title")), "站点那一行的提示里写用于哪些预设（行内只显示余额）");
await page.screenshot({ path: "test/shots/p-8-plan.png", fullPage: false });

console.log(errs.length ? errs : "no page errors");
await browser.close();
if (fail.length || errs.length) process.exit(1);
