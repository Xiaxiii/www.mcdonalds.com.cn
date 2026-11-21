// 2.11.36 缝合页点选条目、换缝合位置只改列表里相关的几处，不重画整个列表。
// 检查：点完后列表节点没有被换掉；再让列表整个重画一遍，结果和就地改的一模一样。
// 用法：在仓库根目录 bash test/run-browser.sh（需要 8765 端口的静态服务）
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { choose, chooseSrcType, chooseDstType } from "./choose.mjs";
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
const ok = (m) => console.log("✓", m);
try {
  await page.goto("http://127.0.0.1:8765/test/site/index.html");
  await page.waitForFunction(() => window.__mcdonalds?.open, null, { timeout: 15000 });
  const T = "【众生相】Claude-Lite-v1.8";
  await page.evaluate((T) => {
    const m = window.__mock;
    m.names.push("众生相副本");
    m.presets.push(structuredClone(m.presets[m.names.indexOf(T)]));
    window.__mcdonalds.open("suture");
  }, T);
  await page.waitForTimeout(400);
  await choose(page, ".pa-dst-picker .pa-namebtn", T);
  await choose(page, ".pa-src-name", "众生相副本");
  // 列表的 HTML：class 排好序、去掉标签之间的空白，方便比较
  const norm = (sel) => page.$eval(sel, (l) => {
    const c = l.cloneNode(true);
    for (const e of c.querySelectorAll("[class]")) e.setAttribute("class", [...e.classList].sort().join(" "));
    return c.innerHTML.replace(/>\s+</g, "><").trim();
  });
  // 收起再展开一个（不含位置标记的）分组：列表整个重画两次，回到原来的展开状态
  const fullRender = async (list) => {
    for (let k = 0; k < 2; k++) {
      await page.evaluate((list) => {
        const sec = [...document.querySelectorAll(`${list} .pa-group`)].filter((s) => !s.matches(".pa-has-at, .pa-after-at")).at(-1);
        (sec.querySelector(".pa-caret") || sec.querySelector(".pa-gname")).click();
      }, list);
      await page.waitForTimeout(120);
    }
  };
  const keep = (list) => page.evaluate((list) => { window.__keep = document.querySelector(`${list} .pa-row`); }, list);
  const kept = () => page.evaluate(() => window.__keep.isConnected);
  const same = async (list, what) => {
    assert.ok(await kept(), `${what}：列表没有整个重画`);
    const a = await norm(list);
    await fullRender(list);
    const b = await norm(list);
    assert.equal(a, b, `${what}：就地改的结果和整个重画一样`);
  };

  // 目标：分组都展开，依次换到各种位置
  for (let i = 0; i < 12; i++) {
    const c = page.locator(".pa-dst-list .pa-group.pa-collapsed .pa-caret").first();
    if (!(await c.count())) break;
    await c.click();
  }
  const dstSteps = [
    ["组里的一条", ".pa-dst-list .pa-group .pa-row >> nth=5"],
    ["组头（放在组后）", ".pa-dst-list .pa-group >> nth=2 >> .pa-gname"],
    ["组内最前", ".pa-dst-list .pa-slot-in >> nth=1"],
    ["最前面", '.pa-dst-list .pa-slot[data-act="top"]'],
    ["另一组的最后一条", ".pa-dst-list .pa-group .pa-row >> nth=-1"],
    ["组外的一条", ".pa-dst-list .pa-loose .pa-row"],
    ["再点组内最前", ".pa-dst-list .pa-slot-in >> nth=0"]
  ];
  for (const [what, sel] of dstSteps) {
    const loc = page.locator(sel).first();
    if (!(await loc.count())) { console.log("  （跳过，没有", what + "）"); continue; }
    await keep(".pa-dst-list");
    await (sel.includes("pa-row") ? loc.locator(".pa-name") : loc).click();
    await page.waitForTimeout(80);
    assert.equal(await page.locator(".pa-dst-list .pa-insert-mark").count(), 1, `${what}：只有一个位置标记`);
    assert.match(await page.locator(".pa-sbar .pa-where").textContent(), /^位置：/);
    await same(".pa-dst-list", `目标·${what}`);
  }
  ok("换缝合位置只挪标记，和整个重画的结果一样");

  // 来源：展开两组，点选几条、整组选择、再取消
  for (let k = 0; k < 2; k++) await page.locator(".pa-src-list .pa-group.pa-collapsed .pa-gname").first().click();
  const srcSteps = [
    ["点选一条", ".pa-src-list .pa-group .pa-row >> nth=1 >> .pa-name"],
    ["再点选一条", ".pa-src-list .pa-group .pa-row >> nth=3 >> .pa-name"],
    ["整组选择", ".pa-src-list .pa-group >> nth=0 >> [data-act=gselect]"],
    ["取消一条", ".pa-src-list .pa-group .pa-row >> nth=1 >> .pa-name"],
    ["整组再选上", ".pa-src-list .pa-group >> nth=0 >> [data-act=gselect]"],
    ["整组取消", ".pa-src-list .pa-group >> nth=0 >> [data-act=gselect]"]
  ];
  const counts = [];
  for (const [what, sel] of srcSteps) {
    await keep(".pa-src-list");
    await page.locator(sel).first().click();
    await page.waitForTimeout(80);
    counts.push(await page.locator(".pa-src-list .pa-row.pa-sel").count());
    assert.match(await page.locator(".pa-picked-n").textContent(), counts.at(-1) ? new RegExp(`已选 ${counts.at(-1)} 条`) : /未选条目/);
    await same(".pa-src-list", `来源·${what}`);
  }
  assert.equal(await page.locator(".pa-src-list .pa-gsel").count(), 0);
  ok(`点选、整组选择只改勾选状态，和整个重画的结果一样（已选：${counts.join("→")}）`);

  // 世界书来源
  await page.click('[data-st="clear"]');
  await chooseSrcType(page, "world"); await page.waitForTimeout(300);
  await choose(page, ".pa-src-name", "示例世界书"); await page.waitForTimeout(300);
  await keep(".pa-src-list");
  await page.locator(".pa-src-list .pa-row .pa-name").first().click();
  await page.waitForTimeout(80);
  assert.ok(await kept() && await page.locator(".pa-src-list .pa-row.pa-sel").count() === 1);
  assert.match(await page.locator(".pa-picked-n").textContent(), /已选 1 条/);
  ok("世界书来源点选只改勾选状态");

  // 世界书目标：换位置只挪标记
  await chooseDstType(page, "world"); await page.waitForTimeout(300);
  await choose(page, ".pa-dst-wb", "示例世界书"); await page.waitForTimeout(300);
  await keep(".pa-dst-list");
  await page.locator(".pa-dst-list .pa-row .pa-name").first().click();
  await page.waitForTimeout(80);
  assert.ok(await kept(), "世界书目标没有整个重画");
  assert.equal(await page.locator(".pa-dst-list .pa-insert-mark").count(), 1);
  await page.locator('.pa-dst-list .pa-slot[data-act="top"]').click();
  await page.waitForTimeout(80);
  assert.equal(await page.locator(".pa-dst-list .pa-insert-mark").count(), 1);
  assert.ok(await page.locator(".pa-dst-list .pa-row").first().isVisible());
  ok("世界书目标换位置只挪标记");
  assert.deepEqual(errs, []);
  console.log("就地更新检查全部通过");
} finally {
  await browser.close();
}
