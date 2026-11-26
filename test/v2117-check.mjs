// 2.12.17 验收：设置页归拢两个选项；世界书、正则页的「＋」；正则复制；条目编辑窗复制、删除、一步新建；
// 变量页不是当前预设时快照按钮变灰；三段分组开关没有中间档时不画中间圆点。
// 先构建并在仓库根目录运行 8765 静态服务。用法：node test/v2117-check.mjs
import { chromium } from "playwright";
import assert from "node:assert/strict";
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const ok = (m) => console.log("✓", m);
const errs = [];
const top = ".pa-sheet-mask:not(.pa-out)";
try {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })).newPage();
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto("http://127.0.0.1:8765/test/site/index.html");
  await page.waitForFunction(() => window.__mcdonalds?.open, null, { timeout: 15000 });

  // 设置页：两个选项在这里，方案页不再有
  await page.evaluate(() => window.__mcdonalds.open("more", "schemes"));
  await page.waitForTimeout(300);
  assert.equal(await page.locator("[data-page=schemes] .pa-optgroup").count(), 0, "方案页不再放全局选项");
  await page.evaluate(() => window.__mcdonalds.open("more", "look"));
  await page.waitForTimeout(300);
  const look = page.locator("[data-page=look]");
  assert.deepEqual(await look.locator(".pa-set-group").allTextContents(), ["通用与备份", "外观", "关于"]);
  assert.equal(await look.locator(".pa-optgroup .pa-switch input").count(), 2, "两个选项右边是开关");
  const sw = look.locator(".pa-optgroup[data-w=chattoast] .pa-switch");
  const was = await sw.locator("input").isChecked();
  await look.locator(".pa-optgroup[data-w=chattoast] .pa-optlabel").click();
  await page.waitForTimeout(150);
  assert.equal(await look.locator(".pa-optgroup[data-w=chattoast] .pa-switch input").isChecked(), was, "点标题只展开，不改开关");
  assert.equal(await look.locator(".pa-optgroup[data-w=chattoast] .pa-sgbody").count(), 1);
  await look.locator("[data-set=backup]").click();
  await page.waitForTimeout(500);
  assert.ok(await page.locator('[data-page=clean] [data-kind="local"].on').count(), "自动备份一行跳到清理 → 本地备份");
  ok("设置页：通用与备份、外观、关于；换聊天提示和推理格式跟随在这里，右边是开关");

  // 世界书页：「＋」新建空白世界书
  await page.evaluate(() => window.__mcdonalds.open("books"));
  await page.waitForTimeout(300);
  assert.equal(await page.locator(".pa-bk-row .pa-peek").count(), 0, "世界书行不再有眼睛按钮");
  await page.click("[data-page=books] [data-b=add]");
  await page.locator(`${top} .pa-pick-item`, { hasText: "新建空白世界书" }).click();
  await page.waitForTimeout(300);
  await page.fill(`${top} input`, "新的书");
  await page.locator(`${top} .pa-btn-primary`).click();
  await page.waitForTimeout(600);
  assert.ok(await page.evaluate(async () => (await import("/test/site/scripts/world-info.js")).world_names.includes("新的书")), "进了世界书列表");
  assert.equal(await page.locator(".pa-bk-detail .pa-bk-dname").innerText(), "新的书", "新建后直接打开");
  ok("世界书页「＋」：新建空白世界书并打开");

  // 正则页：「＋」新建到全局；编辑窗里复制一条
  await page.evaluate(() => window.__mcdonalds.open("rx"));
  await page.waitForTimeout(300);
  const nGlobal = () => page.evaluate(() => (window.SillyTavern.getContext().extensionSettings.regex || []).length);
  const n0 = await nGlobal();
  await page.click("[data-page=rx] [data-r=add]");
  await page.locator(`${top} .pa-pick-item`, { hasText: "新建正则" }).click();
  await page.waitForTimeout(300);
  await page.locator(`${top} .pa-pick-item`, { hasText: "全局" }).click();
  await page.waitForTimeout(300);
  assert.match(await page.locator(`${top} .pa-sheet-head`).innerText(), /新建正则/);
  const form = page.locator(`${top} .pa-sheet-body`);
  await form.locator("input").first().fill("测试新正则");
  await form.locator("textarea").first().fill("/abc/g");
  await page.locator(`${top} .pa-btn-primary`).click();
  await page.waitForTimeout(400);
  assert.equal(await nGlobal(), n0 + 1, "新建的正则进了全局");
  await page.locator(".pa-rx-row[data-kind=global] .pa-name", { hasText: "测试新正则" }).click();
  await page.waitForTimeout(300);
  await page.locator(`${top} .pa-sheet-actions .pa-btn`, { hasText: "复制" }).click();
  await page.waitForTimeout(400);
  assert.equal(await nGlobal(), n0 + 2);
  assert.ok(await page.evaluate(() => window.SillyTavern.getContext().extensionSettings.regex.some((r) => r.scriptName === "测试新正则（副本）")), "复制一条，名字带「副本」");
  ok("正则页「＋」新建到全局；编辑窗里复制一条");

  // 条目：一步新建（光标在名称框）；编辑窗里复制、删除
  await page.evaluate(() => window.__mcdonalds.open("organize"));
  await page.waitForTimeout(400);
  await page.click("[data-page=organize] [data-tool=add]");
  await page.locator(`${top} .pa-pick-item`, { hasText: "新建条目" }).click();
  await page.waitForTimeout(300);
  assert.match(await page.locator(`${top} .pa-sheet-head`).innerText(), /新建条目/, "不先问名称，直接打开编辑窗");
  await page.waitForTimeout(150);
  assert.ok(await page.evaluate(() => document.activeElement?.matches("[data-f=name]")), "光标在名称框");
  await page.fill(`${top} [data-f=name]`, "一步新建");
  await page.fill(`${top} [data-f=content]`, "正文");
  await page.locator(`${top} .pa-btn-primary`).click();
  await page.waitForTimeout(500);
  const live = () => page.evaluate(() => window.__mock.live.prompts.map((p) => p.name));
  assert.ok((await live()).includes("一步新建"));
  await page.locator(".pa-row", { hasText: "一步新建" }).first().locator("[data-act=peek]").click();
  await page.waitForTimeout(300);
  await page.locator(`${top} .pa-sheet-actions .pa-btn`, { hasText: "复制" }).click();
  await page.waitForTimeout(500);
  assert.ok((await live()).includes("一步新建（副本）"), "编辑窗里复制");
  await page.locator(".pa-row", { hasText: "一步新建（副本）" }).first().locator("[data-act=peek]").click();
  await page.waitForTimeout(300);
  await page.locator(`${top} .pa-sheet-actions .pa-btn`, { hasText: "删除" }).click();
  await page.waitForTimeout(250);
  await page.locator(`${top} .pa-sheet-actions .pa-btn`, { hasText: "删除" }).last().click();
  await page.waitForTimeout(500);
  assert.ok(!(await live()).includes("一步新建（副本）"), "编辑窗里删除");
  ok("条目：新建直接打开编辑窗；编辑窗里复制、删除");

  // 三段分组开关：全开且没有快照时不画中间圆点
  const tri = await page.evaluate(() => [...document.querySelectorAll("[data-page=organize] .pa-tri")].map((t) => ({ state: t.dataset.state, nomid: t.classList.contains("pa-tri-nomid") })));
  assert.ok(tri.length && tri.every((t) => t.state !== "all" || t.nomid), "全开、没有自定义快照的分组没有中间档");
  ok("三段分组开关：没有中间档时只画两端");

  // 变量页：不是正在用的预设时，读取变量状态先变灰
  await page.evaluate(() => {
    const m = window.__mock;
    m.names.push("另一个预设"); m.presets.push(structuredClone(m.presets[0]));
    window.__mcdonalds.open("vars");
  });
  await page.waitForTimeout(300);
  assert.equal(await page.locator("[data-vf=snapshot]").isDisabled(), false, "正在用的预设可以读");
  await page.click("[data-page=vars] .pa-picker .pa-namebtn");
  await page.locator(".pa-npick-item", { hasText: "另一个预设" }).click();
  await page.waitForTimeout(400);
  assert.equal(await page.locator("[data-vf=snapshot]").isDisabled(), true, "不是正在用的预设时变灰");
  assert.ok(await page.locator(".pa-vf-why").isVisible(), "写明原因");
  assert.ok(await page.locator("[data-page=vars] .pa-use-preset").isVisible(), "旁边可一键切换");
  ok("变量页：不是正在用的预设时读取按钮变灰并写明原因，旁边可切换");

  assert.deepEqual(errs, []);
  console.log("2.12.17 验收通过");
} finally {
  await browser.close();
}
