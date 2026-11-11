// 缝合页 👁：弹窗和整理页一样可以直接改。打开时不把光标放进输入框（手机上不弹键盘），点了正文才能打字；
// 来源预设、目标预设存回预设，世界书写回世界书，已选的条目跟着更新；点取消不改动
import { chromium } from "playwright";
import assert from "node:assert";
const S = new URL("./shots/", import.meta.url).pathname;
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const ok = (m) => console.log("✓", m);
const sizes = [
  ["iPhone", { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
  ["iPad", { viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
  ["电脑", { viewport: { width: 1280, height: 800 } }]
];
for (const [label, opt] of sizes) {
  const page = await browser.newPage(opt);
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto("http://127.0.0.1:8765/test/site/index.html");
  await page.waitForFunction(() => window.__mcdonalds?.open, null, { timeout: 15000 });
  await page.evaluate(() => window.__mcdonalds.open("suture"));
  await page.waitForTimeout(600);
  const touch = !!opt.hasTouch;
  const focused = () => page.evaluate(() => document.activeElement?.matches("input:not([type=checkbox]), textarea") || false);

  // 来源预设：先选一条，再点 👁 改名称和正文
  await page.locator(".pa-src-list .pa-ghead .pa-gname").first().click(); await page.waitForTimeout(250);
  const row = page.locator(".pa-src-list .pa-row:not(.pa-sep)").filter({ has: page.locator("[data-act=peek]") }).first();
  await row.locator(".pa-name").click(); await page.waitForTimeout(200);
  assert.match(await page.locator(".pa-picked-n").innerText(), /已选 1 条/);
  await row.locator("[data-act=peek]").click(); await page.waitForTimeout(350);
  assert.equal(await page.locator(".pa-sheet-head b").innerText(), "编辑条目");
  assert.match(await page.locator(".pa-sheet .pa-edit-where").innerText(), /写入预设/);
  if (touch) assert.equal(await focused(), false, "打开时不弹键盘");
  await page.screenshot({ path: S + `se-${label}-1-open.png` });
  // 展开正文：触屏上也不顺手弹键盘
  await page.click(".pa-sheet .pa-expand"); await page.waitForTimeout(200);
  if (touch) assert.equal(await focused(), false, "展开时不弹键盘");
  assert.ok(await page.locator(".pa-sheet .pa-edit-where").isHidden(), "展开后只留正文");
  await page.click(".pa-sheet .pa-expand"); await page.waitForTimeout(200);
  // 点了正文才能打字
  if (touch) await page.tap(".pa-sheet [data-f=content]"); else await page.click(".pa-sheet [data-f=content]");
  assert.equal(await focused(), true, "点正文后可以输入");
  await page.fill(".pa-sheet [data-f=name]", "缝合页改过的名称");
  await page.fill(".pa-sheet [data-f=content]", "缝合页改过的正文");
  await page.click(".pa-sheet-actions .pa-btn-primary"); await page.waitForTimeout(400);
  assert.equal(await page.locator(".pa-sheet-mask:not(.pa-out)").count(), 0);
  assert.match(await page.locator(".pa-src-list").innerText(), /缝合页改过的名称/, "来源列表显示新名称");
  await page.click("[data-st=picked]"); await page.waitForTimeout(300);
  assert.match(await page.locator(".pa-sheet .pa-pick").innerText(), /缝合页改过的名称/, "已选的条目跟着更新");
  await page.click(".pa-sheet-x"); await page.waitForTimeout(250);
  const srow = page.locator(".pa-src-list .pa-row").filter({ hasText: "缝合页改过的名称" }).first();
  await srow.locator("[data-act=peek]").click(); await page.waitForTimeout(300);
  assert.equal(await page.inputValue(".pa-sheet [data-f=content]"), "缝合页改过的正文", "正文已存进预设");
  // 取消不改动
  await page.fill(".pa-sheet [data-f=content]", "不该保存");
  await page.click(".pa-sheet-actions .pa-btn:not(.pa-btn-primary)"); await page.waitForTimeout(300);
  await srow.locator("[data-act=peek]").click(); await page.waitForTimeout(300);
  assert.equal(await page.inputValue(".pa-sheet [data-f=content]"), "缝合页改过的正文", "点取消不改动");
  await page.click(".pa-sheet-x"); await page.waitForTimeout(250);
  ok(`${label}：来源预设可改，打开不弹键盘，已选跟着更新，取消不改`);

  // 目标预设
  const drow = page.locator(".pa-dst-list .pa-row:not(.pa-sep)").filter({ has: page.locator("[data-act=peek]") }).first();
  if (await drow.count()) {
    await drow.locator("[data-act=peek]").click(); await page.waitForTimeout(300);
    assert.equal(await page.locator(".pa-sheet-head b").innerText(), "编辑条目");
    if (touch) assert.equal(await focused(), false);
    await page.click(".pa-sheet-x"); await page.waitForTimeout(250);
    ok(`${label}：目标预设同样可改`);
  }

  // 来源世界书：只改正文，名称（备注）不动
  await page.click("[data-st=srctype]"); await page.waitForTimeout(250);
  await page.locator('.pa-sheet .pa-npick-item[data-v="world"]').click(); await page.waitForTimeout(400);
  await page.click(".pa-src-pick .pa-src-name"); await page.waitForTimeout(250);
  await page.locator(".pa-sheet .pa-npick-item", { hasText: "示例世界书" }).click(); await page.waitForTimeout(500);
  const wrow = page.locator(".pa-src-list .pa-row", { hasText: "示例条目" });
  await wrow.locator(".pa-name").click(); await page.waitForTimeout(200);
  await wrow.locator("[data-act=peek]").click(); await page.waitForTimeout(300);
  assert.match(await page.locator(".pa-sheet .pa-edit-where").innerText(), /写入世界书「示例世界书」/);
  assert.equal(await page.locator(".pa-sheet [data-f=role]").count(), 0, "世界书条目只有名称和正文");
  if (touch) assert.equal(await focused(), false);
  await page.fill(".pa-sheet [data-f=content]", `世界书改过（${label}）`);
  await page.click(".pa-sheet-actions .pa-btn-primary"); await page.waitForTimeout(500);
  const e1 = await page.evaluate(() => globalThis.__wiStore["示例世界书"].entries[1]);
  assert.equal(e1.content, `世界书改过（${label}）`, "写回世界书");
  assert.equal(e1.comment, "示例条目", "没改名称就不动备注");
  await wrow.locator("[data-act=peek]").click(); await page.waitForTimeout(300);
  assert.equal(await page.inputValue(".pa-sheet [data-f=content]"), `世界书改过（${label}）`, "重新读到新内容");
  await page.click(".pa-sheet-x"); await page.waitForTimeout(250);
  ok(`${label}：世界书条目可改并写回`);

  assert.deepEqual(errs, []);
  await page.close();
}
console.log("缝合页编辑检查通过");
await browser.close();
