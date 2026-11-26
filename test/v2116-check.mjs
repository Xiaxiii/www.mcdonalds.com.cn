// 2.12.16 验收：编辑窗里点「删除」再取消不丢字；世界书备份可在页头和「清理 → 本地备份」恢复；
// 手机底栏五项都有文字；缝合页手机默认「从 | 到」切换；宽屏编辑栏 + 搜索时工具栏不压扁；清理 → 扩展数据不撑出屏幕。
// 先构建并在仓库根目录运行 8765 静态服务。用法：node test/v2116-check.mjs
import { chromium } from "playwright";
import assert from "node:assert/strict";
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const ok = (m) => console.log("✓", m);
const errs = [];
const URL = process.env.PA_TEST_URL || "http://127.0.0.1:8765/test/site/index.html";
async function setup(page) {
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(URL);
  await page.waitForFunction(() => window.__mcdonalds?.open, null, { timeout: 15000 });
  await page.evaluate(async () => {
    const wi = await import("/test/site/scripts/world-info.js");
    wi.world_names.push("城市设定");
    globalThis.__wiStore["城市设定"] = { entries: {
      0: { uid: 0, comment: "雾港", content: "常年起雾的港口城市。", key: ["雾港"], constant: false, position: 0, order: 100, disable: false, displayIndex: 0 },
      1: { uid: 1, comment: "旧城区", content: "石板路，夜里有灯笼。", key: [], constant: true, position: 0, order: 90, disable: false, displayIndex: 1 }
    } };
    const live = window.__mock.live;
    live.extensions = { ...(live.extensions || {}), regex_scripts: [{ id: "p1", scriptName: "清除多余内容", findRegex: "a", replaceString: "", placement: [2], disabled: false }] };
    window.SillyTavern.getContext().extensionSettings.mcdonalds.sutureLayout = undefined;
  });
}
const sheetTop = (page) => page.locator(".pa-sheet-mask:not(.pa-out)").last();
// 在最上面的确认框里点某个按钮
const answer = async (page, label) => { await sheetTop(page).locator(".pa-sheet-actions .pa-btn", { hasText: label }).click(); await page.waitForTimeout(250); };
try {
  // ---------- 手机
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await setup(page);
  await page.evaluate(() => window.__mcdonalds.open("organize"));
  await page.waitForTimeout(300);
  const tabs = await page.$$eval(".pa-tabs button.pa-nav-work, .pa-tabs button.pa-nav-phone", (bs) => bs.filter((b) => b.offsetParent).map((b) => { const s = b.querySelector("span"); const r = b.getBoundingClientRect(); return { t: s.textContent, shown: getComputedStyle(s).display !== "none" && s.getBoundingClientRect().width > 10, w: Math.round(r.width) }; }));
  assert.deepEqual(tabs.map((x) => x.t), ["预设", "缝合", "检查", "连接", "更多"]);
  assert.ok(tabs.every((x) => x.shown), "五项都显示文字");
  assert.ok(Math.max(...tabs.map((x) => x.w)) - Math.min(...tabs.map((x) => x.w)) <= 1, "五项等宽");
  ok("手机底栏：五项图标加两字标签，等宽");

  await page.evaluate(() => window.__mcdonalds.open("suture"));
  await page.waitForTimeout(300);
  assert.equal(await page.locator(".pa-swbar").isVisible(), true, "缝合页默认切换布局");
  const listH = await page.locator(".pa-src-list").evaluate((x) => x.getBoundingClientRect().height);
  assert.ok(listH >= 844 * 0.5, `来源列表高 ${Math.round(listH)}px`);
  ok("缝合页手机上默认「从 | 到」切换");

  // 世界书条目：编辑窗里改了名称，点「删除」再取消，窗口和填的字都还在；确认删除后可从页头备份恢复
  await page.evaluate(() => window.__mcdonalds.open("books"));
  await page.waitForTimeout(300);
  assert.equal(await page.locator(".pa-savebar").isHidden(), true, "世界书页不显示预设的保存栏");
  await page.click('.pa-bk-row[data-book="城市设定"]');
  await page.waitForSelector('.pa-wbe-row[data-uid="0"]');
  await page.click('.pa-wbe-row[data-uid="0"] .pa-name');
  await page.waitForTimeout(300);
  await page.fill('.pa-sheet [data-w="comment"]', "雾港（改过）");
  await sheetTop(page).locator(".pa-sheet-actions .pa-btn", { hasText: "删除" }).click();
  await page.waitForTimeout(250);
  assert.match(await sheetTop(page).innerText(), /删除条目/);
  await answer(page, "取消");
  assert.equal(await page.inputValue('.pa-sheet [data-w="comment"]'), "雾港（改过）", "取消删除后填的字还在");
  await sheetTop(page).locator(".pa-sheet-actions .pa-btn", { hasText: "删除" }).click();
  await page.waitForTimeout(250);
  await answer(page, "删除");
  await page.waitForTimeout(400);
  assert.equal(await page.locator('.pa-wbe-row[data-uid="0"]').count(), 0, "确认后删掉");
  assert.equal(await page.locator(".pa-sheet-mask:not(.pa-out)").count(), 0, "删除后编辑窗关掉");
  ok("世界书条目：点删除后取消不丢字，确认才删");

  await page.click('.pa-top [data-g="backups"]');
  await page.waitForTimeout(400);
  assert.match(await sheetTop(page).locator(".pa-sheet-head").innerText(), /城市设定/);
  const rows = sheetTop(page).locator(".pa-bkrow");
  assert.ok(await rows.count() >= 1);
  await rows.first().locator('[data-bkx="restore"]').click();
  await page.waitForTimeout(600);
  assert.equal(await page.locator('.pa-wbe-row[data-uid="0"]').count(), 1, "恢复后删掉的条目回来了");
  ok("世界书页头的备份按钮：一个窗口里直接恢复");

  // 清理 → 本地备份：点一行就是这本书的备份
  await page.evaluate(() => window.__mcdonalds.open("clean"));
  await page.waitForTimeout(400);
  assert.equal(await page.locator('.pa-top [data-g="backups"]').isHidden(), true, "清理页不显示页头备份按钮");
  await page.click('[data-kind="local"]');
  await page.waitForTimeout(600);
  const bkRow = page.locator('.pa-bkrank-row[data-k="世界书：城市设定"]');
  await bkRow.waitFor();
  await bkRow.click();
  await page.waitForTimeout(400);
  assert.ok(await sheetTop(page).locator(".pa-bkrow").count() >= 2, "删除前、恢复前各有一份");
  await page.click(".pa-sheet-mask:not(.pa-out) .pa-sheet-x");
  await page.waitForTimeout(250);
  ok("清理 → 本地备份：每行可点，打开这本书的备份");

  await page.click('[data-kind="ext"]');
  await page.waitForTimeout(600);
  const sw = await page.evaluate(() => document.querySelector(".pa-clean").scrollWidth);
  assert.ok(sw <= 390, `扩展数据不撑出屏幕（${sw}px）`);
  ok("清理 → 扩展数据：没有横向溢出");

  // 正则：编辑窗里点「删除」再取消，窗口还在
  await page.evaluate(() => window.__mcdonalds.open("rx"));
  await page.waitForTimeout(300);
  await page.click('.pa-rx-row[data-kind="preset"] .pa-name');
  await page.waitForTimeout(300);
  const nameBox = sheetTop(page).locator(".pa-sheet-body input").first();
  await nameBox.fill("清除多余内容（改过）");
  await sheetTop(page).locator(".pa-sheet-actions .pa-btn", { hasText: "删除" }).click();
  await page.waitForTimeout(250);
  await answer(page, "取消");
  assert.equal(await sheetTop(page).locator(".pa-sheet-body input").first().inputValue(), "清除多余内容（改过）", "取消删除后填的字还在");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
  await answer(page, "放弃修改");
  ok("正则：点删除后取消不丢字");
  await ctx.close();

  // ---------- 宽屏
  const wctx = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  const wp = await wctx.newPage();
  await setup(wp);
  for (const k of ["organize", "rx"]) {
    await wp.evaluate((k) => window.__mcdonalds.open(k), k);
    await wp.waitForTimeout(400);
    const pg = wp.locator(`[data-page="${k}"]`);
    if (k === "rx") await pg.locator(".pa-rx-row .pa-name").first().click();
    else await pg.locator(".pa-row [data-act=peek]").first().click();
    await wp.waitForTimeout(400);
    assert.ok(await pg.evaluate((x) => x.classList.contains("pa-edit-open")), `${k}：编辑栏打开`);
    await pg.locator(k === "rx" ? '[data-r="search"]' : '[data-tool="search"]').click();
    await wp.waitForTimeout(300);
    const g = await pg.evaluate((p) => {
      const r = (s) => p.querySelector(s)?.getBoundingClientRect();
      const slot = r(".pa-toolbar > .pa-picker-slot"), x = r(".pa-toolbar .pa-findrow .pa-qx"), pane = r(".pa-editpane");
      return { slot: slot.width, xRight: x.right, xW: x.width, paneLeft: pane.left };
    });
    assert.ok(g.slot >= 120, `${k}：预设按钮没被压扁（${Math.round(g.slot)}px）`);
    assert.ok(g.xW > 20 && g.xRight <= g.paneLeft, `${k}：搜索框的 ✕ 在左栏里`);
    await pg.locator(".pa-toolbar .pa-findrow .pa-qx").click();
    await wp.waitForTimeout(200);
    assert.equal(await pg.locator(".pa-toolbar .pa-findrow").isHidden(), true, `${k}：✕ 能点`);
  }
  ok("宽屏编辑栏开着、展开搜索：预设按钮不压扁，✕ 完整可点");
  await wctx.close();
  assert.deepEqual(errs, []);
  console.log("2.12.16 验收通过");
} finally {
  await browser.close();
}
