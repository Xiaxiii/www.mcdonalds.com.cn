// 2.12.20 验收：整理页进度环胶囊；缝合预览三行总控卡与呼吸抽屉；检查 → 变量、回复宽屏双栏；世界书宽屏就地编辑。
// 先构建并在仓库根目录运行 8765 静态服务。用法：node test/v2120-check.mjs
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { choose } from "./choose.mjs";
import fixture from "./fixtures/group-toggle.cjs";
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const ok = (m) => console.log("✓", m);
const errs = [];
async function open(w, h, mobile = false) {
  const page = await (await browser.newContext({ viewport: { width: w, height: h }, hasTouch: mobile, isMobile: mobile })).newPage();
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
  await page.goto("http://127.0.0.1:8765/test/site/index.html");
  await page.waitForFunction(() => window.__mcdonalds?.open, null, { timeout: 15000 });
  return page;
}
const prompt = (identifier, name, content) => ({ identifier, name, content, role: "system", injection_position: 0, injection_depth: 4 });
try {
  // ① 整理页：16px 进度环 + n/N，没有三点滑块和重复计数；点中间循环 自定义 → 全开 → 全关 → 自定义
  {
    const page = await open(390, 844, true);
    await page.evaluate((preset) => {
      const m = window.__mock; m.names.push("进度环"); m.presets.push(preset);
      m.live.preset_settings_openai = "进度环"; Object.assign(m.live, structuredClone(preset));
      window.__mcdonalds.open("organize");
    }, fixture());
    await choose(page, "[data-page=organize] .pa-picker-slot .pa-namebtn", "进度环").catch(() => {});
    await page.waitForTimeout(300);
    const tri = page.locator('[data-gid="theater"] .pa-tri[data-act=gtoggle]');
    const shape = await tri.evaluate((t) => { const s = t.querySelector("svg"), r = s.getBoundingClientRect(); return { tag: t.tagName, w: r.width, h: r.height, text: t.querySelector(".pa-tri-n").textContent, ready: t.dataset.ready }; });
    assert.deepEqual([shape.tag, shape.w, shape.h, shape.text], ["BUTTON", 16, 16, "1/3"], JSON.stringify(shape));
    assert.equal(shape.ready, "1", "首屏画完后才打开过渡");
    assert.equal(await page.locator("[data-page=organize] .pa-tri-dots, [data-page=organize] .pa-ghead .pa-count").count(), 0, "没有三点滑块和组名旁的重复计数");
    const x = () => page.evaluate(() => { const h = document.querySelector('[data-gid="theater"] > .pa-ghead'); return [h.querySelector("[data-act=gmenu]").getBoundingClientRect().left, h.querySelector(".pa-tri").getBoundingClientRect().width]; });
    const x0 = await x();
    const seen = [];
    for (let i = 0; i < 3; i++) {
      const b = await tri.boundingBox();
      await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
      await page.waitForTimeout(250);
      seen.push(`${await tri.getAttribute("data-state")}:${await tri.locator(".pa-tri-n").textContent()}`);
      const xi = await x();
      assert.ok(Math.abs(xi[0] - x0[0]) <= 1 && Math.abs(xi[1] - x0[1]) <= 1, "⋯ 与胶囊宽度不跳：" + JSON.stringify([x0, xi]));
    }
    assert.deepEqual(seen, ["all:3/3", "off:0/3", "mid:1/3"]);
    assert.match(await tri.getAttribute("aria-label"), /总开关，当前已开 1\/3/);
    await page.context().close();
    ok("整理页分组开关：16px 进度环 + n/N，点中间循环 自定义 → 全开 → 全关 → 自定义，左边不跳位");
  }

  // ② 缝合预览：820px 高时总控卡 ≤ 180px，三条待缝条目和右边开关首屏可见；「详情」和条目点开走呼吸抽屉
  {
    const page = await open(1180, 820);
    const target = { prompts: [prompt("a", "已有条目甲", "甲"), prompt("b", "已有条目乙", "乙")], prompt_order: [{ character_id: 100001, order: [{ identifier: "a", enabled: true }, { identifier: "b", enabled: true }] }], extensions: {} };
    const source = { prompts: [prompt("s0", "文风", "<style>\n冷峻\n</style>"), prompt("s1", "小剧场", "{{setvar::theater::写一段}}"), prompt("s2", "状态栏", "末尾输出 <status>")], prompt_order: [{ character_id: 100001, order: ["s0", "s1", "s2"].map((id, i) => ({ identifier: id, enabled: i !== 1 })) }], extensions: {} };
    await page.evaluate(({ target, source }) => {
      const m = window.__mock; m.names.splice(0, m.names.length, "目标", "来源"); m.presets.splice(0, m.presets.length, target, source);
      m.live.preset_settings_openai = "目标"; Object.assign(m.live, structuredClone(target));
      window.SillyTavern.getContext().extensionSettings.mcdonalds.sutureLayout = "split"; window.__mcdonalds.open("suture");
    }, { target, source });
    await choose(page, ".pa-src-name", "来源");
    await choose(page, ".pa-dst-picker .pa-namebtn", "目标");
    for (let i = 0; i < 3; i++) await page.locator(`.pa-src-list [data-id="s${i}"] .pa-name`).click();
    await page.locator(".pa-dst-list .pa-row").first().locator(".pa-name").click();
    await page.click("[data-st=go]");
    await page.waitForSelector(".pa-review .pa-item");
    await page.waitForTimeout(400);
    const g = await page.evaluate(() => {
      const card = document.querySelector(".pa-review .pa-target-card").getBoundingClientRect();
      const body = document.querySelector(".pa-review").closest(".pa-sheet-body").getBoundingClientRect();
      const items = [...document.querySelectorAll(".pa-review .pa-item")].map((a) => { const r = a.getBoundingClientRect(), s = a.querySelector(":scope > .pa-item-head > .pa-switch").getBoundingClientRect(); return { bottom: r.bottom, sw: s.width > 0 && s.bottom <= innerHeight }; });
      return { card: card.height, bodyBottom: body.bottom, items, det: document.querySelector(".pa-review .pa-target-card > .pa-acc > .pa-acc-in").inert, itemInert: [...document.querySelectorAll(".pa-review .pa-item > .pa-acc > .pa-acc-in")].every((x) => x.inert), checkbox: document.querySelectorAll('.pa-review .pa-item-head input[type=checkbox]:not(.pa-switch input)').length };
    });
    assert.ok(g.card <= 180, "总控卡收起时 ≤ 180px：" + g.card);
    assert.ok(g.items.length === 3 && g.items.every((it) => it.bottom <= g.bodyBottom + 1 && it.sw), "三条待缝条目和开关不用滚动就看得到：" + JSON.stringify(g));
    assert.ok(g.det && g.itemInert, "收起的抽屉内层带 inert");
    assert.equal(g.checkbox, 0, "条目头没有裸复选框，缝后开启是右边的拨杆");
    assert.equal(await page.locator(".pa-review [data-g=hook-all], .pa-review [data-g=hook-rec]").evaluateAll((xs) => xs.every((x) => x.closest(".pa-seg"))), true, "思维链也是分段槽");
    await page.click(".pa-review [data-g=more]");
    await page.waitForTimeout(100);
    const mid = await page.evaluate(() => document.querySelector(".pa-review .pa-target-card > .pa-acc > .pa-acc-in").getBoundingClientRect().height);
    await page.waitForTimeout(350);
    const det = await page.evaluate(() => { const a = document.querySelector(".pa-review .pa-target-card > .pa-acc"); return { open: a.classList.contains("open"), inert: a.firstElementChild.inert, h: a.firstElementChild.getBoundingClientRect().height, exp: document.querySelector(".pa-review [data-g=more]").getAttribute("aria-expanded") }; });
    assert.ok(det.open && !det.inert && det.exp === "true" && det.h > mid, "点「详情」呼吸展开：" + JSON.stringify({ mid, det }));
    assert.ok(await page.locator(".pa-review [data-g=grp]").isVisible() && await page.locator(".pa-review [data-g=from]").isVisible(), "详情里有归入分组和注明来源");
    await page.locator(".pa-review .pa-item-head").first().click();
    await page.waitForTimeout(350);
    assert.equal(await page.locator(".pa-review .pa-item").first().evaluate((a) => a.classList.contains("open") && !a.querySelector(":scope > .pa-acc > .pa-acc-in").inert), true, "点条目展开");
    assert.ok(await page.locator(".pa-review .pa-item").first().locator("[data-c=name]").isVisible());
    await page.context().close();
    ok("缝合预览：总控卡三行 ≤ 180px，待缝条目首屏可见、右边拨杆；详情和条目呼吸展开");
  }

  // ③ 1180×820：检查 → 变量、回复左右两栏，没有裸复选框
  for (const k of ["vars", "reply"]) {
    const page = await open(1180, 820);
    await page.evaluate((k) => window.__mcdonalds.open(k), k);
    await page.waitForTimeout(500);
    const cols = await page.evaluate((k) => {
      const [a, b] = [...document.querySelectorAll(k === "vars" ? "[data-page=vars] .pa-vcol" : "[data-page=reply] .pa-rcol")].map((x) => x.getBoundingClientRect());
      const bare = [...document.querySelectorAll(`[data-page=${k}] input[type=checkbox]`)].filter((x) => !x.closest(".pa-switch")).length;
      return { a: a && [a.left, a.right, a.top], b: b && [b.left, b.right, b.top], bare };
    }, k);
    assert.ok(cols.a && cols.b && cols.b[0] >= cols.a[1] && Math.abs(cols.a[2] - cols.b[2]) <= 2, `${k}：左右两栏并排：` + JSON.stringify(cols));
    assert.equal(cols.bare, 0, `${k}：开关都是拨杆`);
    if (k === "vars") assert.equal(await page.locator("[data-vf=refresh]").count(), 0, "没有「刷新顺序检查」");
    if (k === "reply") {
      for (const q of ['[data-r="latest"]', '[data-r="ai-latest"]', '[data-r="body"]', '[data-r="enabled"]']) assert.ok(await page.locator(`[data-page=reply] ${q}`).isVisible(), q);
      const seg = await page.evaluate(() => { const s = document.querySelector("[data-page=reply] .pa-rmode").getBoundingClientRect(), c = document.querySelector("[data-page=reply] .pa-rcard").getBoundingClientRect(); return s.width / c.width; });
      assert.ok(seg < .5, "「最近回复 | 粘贴」是自然宽度的分段槽：" + seg);
      await page.locator('[data-page=reply] [data-r=mode][data-m=paste]').click();
      await page.fill('[data-page=reply] [data-r=sample]', "<content>正文</content>");
      assert.equal(await page.locator("[data-page=reply] [data-r=target]").textContent(), "粘贴样本检测");
    }
    await page.context().close();
  }
  ok("检查 → 变量、回复：1180 宽左右两栏，开关都是拨杆");

  // ④ 1180×820：世界书条目在右边编辑栏里就地打开，书目和条目列表都还在
  {
    const page = await open(1180, 820);
    await page.evaluate(() => window.__mcdonalds.open("books"));
    await page.waitForTimeout(500);
    await page.locator(".pa-bk-list .pa-bk-row").first().click();
    await page.waitForSelector(".pa-bk-detail .pa-wbe-row");
    await page.locator(".pa-bk-detail .pa-wbe-row .pa-namebox").first().click();
    await page.waitForTimeout(300);
    assert.equal(await page.locator(".pa-sheet-mask:not(.pa-out)").count(), 0, "不弹窗");
    const pane = await page.evaluate(() => {
      const p = document.querySelector(".pa-bk-pane").getBoundingClientRect(), d = document.querySelector(".pa-bk-detail").getBoundingClientRect(), l = document.querySelector(".pa-bk-list").getBoundingClientRect();
      return { pane: [p.left, p.width], detail: [d.left, d.right], list: [l.left, l.right], editing: document.querySelectorAll(".pa-wbe-row.pa-editing").length, btns: [...document.querySelectorAll(".pa-bk-pane .pa-editpane-foot .pa-btn")].map((b) => b.textContent) };
    });
    assert.ok(pane.pane[1] >= 300 && pane.pane[0] >= pane.detail[1] - 1 && pane.detail[0] >= pane.list[1] - 1 && pane.list[1] - pane.list[0] > 150, "书目 | 条目 | 编辑栏三栏：" + JSON.stringify(pane));
    assert.equal(pane.editing, 1, "编辑中的条目高亮");
    assert.deepEqual(pane.btns, ["删除", "复制", "取消", "保存"]);
    const name = page.locator(".pa-bk-pane [data-w=comment]");
    await name.fill("就地改名");
    await page.locator(".pa-bk-pane [data-ep=save]").click();
    await page.waitForTimeout(500);
    assert.ok(await page.locator(".pa-bk-detail .pa-wbe-row", { hasText: "就地改名" }).count() === 1, "保存后列表跟着变");
    await name.fill("没保存的修改");
    await page.locator(".pa-bk-detail .pa-wbe-row .pa-namebox").nth(1).click().catch(() => {});
    await page.waitForTimeout(250);
    if (await page.locator(".pa-bk-detail .pa-wbe-row").count() > 1) assert.equal(await page.locator(".pa-sheet-mask:not(.pa-out)").count(), 1, "换条目前问一句未保存的修改");
    await page.context().close();
    ok("世界书宽屏：条目在右边编辑栏就地打开，保存、换条目前提示未保存");
  }

  assert.deepEqual(errs, []);
  console.log("2.12.20 验收通过");
} finally {
  await browser.close();
}
