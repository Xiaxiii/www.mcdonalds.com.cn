// 2.8.0 导航：手机底部五栏、宽屏左侧栏、分页、批次栏位置、旧的打开方式仍可用
// 用法：在仓库根目录起静态服务（python3 -m http.server 8765）；node test/nav-check.mjs
import { chromium } from "playwright";
import assert from "node:assert/strict";
const PORT = process.env.PA_PORT || 8765;
const S = new URL("./shots/", import.meta.url).pathname;
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const ok = (m) => console.log("✓", m);

async function boot(viewport, mobile) {
  const page = await browser.newPage({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 2 });
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.route("**/api/presets/save", (r) => r.fulfill({ json: { name: r.request().postDataJSON().name } }));
  await page.goto(`http://127.0.0.1:${PORT}/test/site/index.html`);
  await page.waitForFunction(() => window.__mcdonalds?.open, null, { timeout: 15000 });
  return { page, errs };
}
const state = (page) => page.evaluate(() => {
  const root = document.getElementById("mcd-root");
  const vis = (e) => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden";
  return {
    title: root.querySelector(".pa-title").textContent,
    page: [...root.querySelectorAll(".pa-page")].filter((p) => !p.hidden).map((p) => p.dataset.page),
    nav: [...root.querySelectorAll(".pa-tabs [data-nav]")].filter(vis).map((b) => b.textContent.trim()),
    navOn: [...root.querySelectorAll('.pa-tabs [aria-current="page"]')].filter(vis).map((b) => b.textContent.trim()),
    sub: vis(root.querySelector(".pa-subnav")) ? [...root.querySelectorAll(".pa-subnav button")].map((b) => b.textContent + (b.classList.contains("on") ? "*" : "")) : []
  };
});

// 手机
{
  const { page, errs } = await boot({ width: 390, height: 844 }, true);
  await page.evaluate(() => window.__mcdonalds.open());
  await page.waitForTimeout(300);
  let s = await state(page);
  assert.deepEqual(s.nav, ["预设", "缝合", "检查", "连接", "更多"]);
  assert.deepEqual(s.navOn, ["预设"]);
  assert.equal(s.title, "预设");
  assert.deepEqual(s.sub, []);
  assert.deepEqual(s.page, ["organize"]);
  await page.screenshot({ path: S + "n-1-phone-preset.png" });
  ok("手机：底部五栏「预设、缝合、检查、连接、更多」，预设不再分页");

  await page.click('.pa-tabs [data-nav="suture"]');
  s = await state(page);
  assert.equal(s.title, "缝合"); assert.deepEqual(s.page, ["suture"]); assert.deepEqual(s.navOn, ["缝合"]);
  ok("手机：缝合单列一栏");

  await page.click('.pa-tabs [data-nav="check"]');
  s = await state(page);
  assert.equal(s.title, "检查"); assert.deepEqual(s.page, ["cot"]);
  assert.deepEqual(s.sub, ["思维链*", "变量", "回复"], "先查预设本身，再查回复");
  await page.click('.pa-subnav [data-tab="reply"]');
  s = await state(page);
  assert.deepEqual(s.page, ["reply"]);
  const rp = page.locator("[data-page=reply]");
  for (const q of ['[data-r="latest"]', '[data-r="body"]', '[data-r="enabled"]']) assert.ok(await rp.locator(q).isVisible(), `回复单页显示 ${q}`);
  assert.equal(await rp.locator('[data-r="ai-latest"]').isVisible(), false, "AI 语义审查默认收起");
  await rp.locator("details.pa-rai > summary").click();
  assert.ok(await rp.locator('[data-r="ai-latest"]').isVisible(), "展开后显示 AI 语义审查");
  await page.fill('[data-page=reply] [data-r="body"]', "content");
  await page.locator('[data-page=reply] [data-r="body"]').dispatchEvent("change");
  await page.waitForTimeout(200);
  assert.equal(await rp.locator('[data-r="save"]').count(), 0, "改动即保存，没有「保存设置」按钮");
  const saved = await page.evaluate(() => window.SillyTavern.getContext().extensionSettings.mcdonalds.replyGuard);
  assert.ok(saved && Object.values(saved).some((v) => v.bodyTag === "content"), "离开输入框即写入当前预设");
  await page.screenshot({ path: S + "n-3-phone-reply.png" });
  ok("手机：检查 → 回复为单页，检查、标签、处理方式、语义审查同页");

  await page.click('.pa-subnav [data-tab="cot"]');
  s = await state(page);
  assert.deepEqual(s.page, ["cot"]); assert.deepEqual(s.sub, ["思维链*", "变量", "回复"]);
  await page.click('.pa-subnav [data-tab="vars"]');
  s = await state(page);
  assert.deepEqual(s.page, ["vars"]);
  assert.ok(await page.locator('[data-page=vars] [data-vf="refresh"]').isVisible(), "变量页直接显示顺序检查");
  await page.click('.pa-subnav [data-tab="cot"]');

  await page.click('.pa-tabs [data-nav="conn"]');
  s = await state(page);
  assert.equal(s.title, "连接"); assert.deepEqual(s.page, ["conn"]);
  assert.ok(await page.locator("[data-page=conn] .pa-plan-live").isVisible());
  assert.ok(await page.locator("[data-page=conn] .pa-plan-sites").isVisible());
  await page.screenshot({ path: S + "n-2-phone-conn.png" });
  await page.click('.pa-tabs [data-nav="check"]');
  assert.deepEqual((await state(page)).page, ["cot"], "回到检查时停在上次的分页");
  ok("手机：连接一页；检查记住上次的分页");

  await page.click('.pa-tabs [data-nav="more"]');
  s = await state(page);
  assert.deepEqual(s.navOn, ["更多"]);
  assert.equal(s.sub.length, 4);
  await page.click('.pa-subnav [data-m="schemes"]');
  s = await state(page);
  assert.equal(s.title, "方案"); assert.deepEqual(s.page, ["schemes"]);
  assert.ok(await page.locator("[data-page=schemes] .pa-plan-schemes").isVisible());
  await page.click('.pa-subnav [data-m="health"]');
  s = await state(page);
  assert.equal(s.title, "体检"); assert.deepEqual(s.page, ["health"]); assert.deepEqual(s.sub, ["方案", "清理", "体检*", "设置"]);
  await page.click('.pa-tabs [data-nav="preset"]');
  await page.click('.pa-tabs [data-nav="more"]');
  s = await state(page);
  assert.deepEqual(s.page, ["health"], "回到更多时停在上次的分页");
  ok("手机：更多下分方案、清理、体检、设置，记住上次的分页");

  // 旧的打开方式
  await page.evaluate(() => window.__mcdonalds.open("more", "look"));
  assert.deepEqual((await state(page)).page, ["look"]);
  await page.evaluate(() => window.__mcdonalds.open("suture"));
  s = await state(page);
  assert.deepEqual(s.page, ["suture"]); assert.deepEqual(s.navOn, ["缝合"]);
  await page.evaluate(() => window.__mcdonalds.open("reply-rules"));
  assert.deepEqual((await state(page)).page, ["reply"]);
  await page.evaluate(() => window.__mcdonalds.open("organize"));
  assert.deepEqual((await state(page)).page, ["organize"]);
  ok("旧写法 open(\"more\", 子页)、open(\"suture\")、open(\"reply-rules\") 仍可用");

  // 2.9.1 有修改时「撤销」「完成」出现在页头里，底部不多一条栏
  await page.locator("[data-page=organize] .pa-row .pa-switch").first().click();
  await page.waitForTimeout(700);
  const box = await page.evaluate(() => {
    const r = (q) => document.querySelector(q).getBoundingClientRect();
    return { bar: r(".pa-savebar"), top: r(".pa-top"), text: document.querySelector(".pa-dirty-text").textContent };
  });
  assert.ok(box.bar.height > 0 && box.bar.top >= box.top.top && box.bar.bottom <= box.top.bottom && box.bar.right <= box.top.right, `批次栏在页头内 ${JSON.stringify(box.bar)}`);
  assert.ok(await page.locator('.pa-savebar [data-g="undo"]').isVisible());
  await page.screenshot({ path: S + "n-4-phone-savebar.png" });
  await page.click('.pa-savebar [data-g="undo"]');
  await page.waitForTimeout(500);
  ok(`批次栏在底部导航上方（${box.text}），可撤销`);
  assert.deepEqual(errs, []);
  await page.close();
}

// 宽屏
for (const [w, h] of [[1280, 800], [1024, 768]]) {
  const { page, errs } = await boot({ width: w, height: h }, false);
  await page.evaluate(() => window.__mcdonalds.open());
  await page.waitForTimeout(300);
  let s = await state(page);
  assert.deepEqual(s.nav, ["预设", "缝合", "检查", "连接", "方案", "清理", "体检", "设置"]);
  const side = await page.evaluate(() => document.querySelector(".pa-tabs").getBoundingClientRect().toJSON());
  assert.ok(side.left === 0 && side.width > 180 && side.width < 260 && side.height > h - 60, "左侧栏贴左、全高");
  assert.deepEqual(s.sub, []);
  await page.click('.pa-tabs [data-nav="clean"]');
  s = await state(page);
  assert.equal(s.title, "清理"); assert.deepEqual(s.page, ["clean"]); assert.deepEqual(s.sub, [], "宽屏不显示「更多」的分页");
  assert.deepEqual(s.navOn, ["清理"]);
  await page.screenshot({ path: S + `n-5-wide-${w}-clean.png` });
  await page.click('.pa-tabs [data-nav="preset"]');
  // 宽屏编辑栏：点条目的查看按钮，在右侧编辑；保存写入草稿
  const row = page.locator("[data-page=organize] .pa-loose .pa-row, [data-page=organize] .pa-gbody .pa-row").first();
  const id = await row.getAttribute("data-id");
  await row.locator('[data-act="peek"]').click();
  await page.waitForTimeout(200);
  assert.ok(await page.locator("[data-page=organize] .pa-editpane").isVisible(), "宽屏在右侧打开编辑栏");
  assert.equal(await page.locator(".pa-sheet-mask:not(.pa-out)").count(), 0, "宽屏不弹窗");
  const pb = await page.evaluate(() => ({ list: document.querySelector("[data-page=organize] .pa-list").getBoundingClientRect().toJSON(), pane: document.querySelector("[data-page=organize] .pa-editpane").getBoundingClientRect().toJSON() }));
  assert.ok(pb.pane.left >= pb.list.right - 1 && pb.list.width > 300, "列表在左、编辑栏在右");
  await page.fill("[data-page=organize] .pa-editpane [data-f=name]", "编辑栏改名");
  await page.click('[data-page=organize] .pa-editpane [data-ep="save"]');
  await page.waitForTimeout(300);
  assert.equal(await page.locator(`[data-page=organize] .pa-row[data-id="${id}"] .pa-name`).textContent(), "编辑栏改名");
  assert.ok(await page.locator(`[data-page=organize] .pa-row[data-id="${id}"].pa-editing`).count(), "编辑中的条目高亮");
  await page.screenshot({ path: S + `n-6-wide-${w}-preset.png` });
  await page.click('[data-page=organize] .pa-editpane [data-ep="close"]');
  assert.equal(await page.locator("[data-page=organize] .pa-editpane").isVisible(), false);
  await page.click('.pa-savebar [data-g="undo"]').catch(() => {});
  ok(`宽屏 ${w}：左侧栏分工作、工具两组；条目在右侧编辑栏编辑`);
  assert.deepEqual(errs, []);
  await page.close();
}
await browser.close();
console.log("导航检查通过");
