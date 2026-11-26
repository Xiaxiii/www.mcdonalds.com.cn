// 2.12.12 各设备适配：安卓小屏、iPhone、iPad 竖屏/横屏、电脑，外加最大字号。
// 检查这几版新加的地方：tk 圆点、⋯ 菜单、导入、世界书书名栏（✎ 和垃圾桶）、正则行（垃圾桶、眼睛、开关）、文字大小滑杆。
// 不能横向滚动，按钮不能超出屏幕、不能互相压住。用法：在仓库根目录 bash test/run-browser.sh
import { chromium } from "playwright";
import assert from "node:assert";
const sizes = [
  ["安卓", 360, 780, true], ["iPhone", 390, 844, true], ["iPad 竖屏", 820, 1180, true],
  ["iPad 横屏", 1180, 820, true], ["电脑", 1440, 900, false], ["安卓·最大字", 360, 780, true, 6], ["iPhone·最大字", 390, 844, true, 6]
];
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const problems = [];
const scan = (page, where) => page.evaluate((where) => {
  const W = innerWidth, out = [];
  if (document.documentElement.scrollWidth > W + 1) out.push(`页面横向滚动 ${document.documentElement.scrollWidth}>${W}`);
  const root = document.getElementById("mcd-root");
  const sheet = [...document.querySelectorAll(".pa-sheet-mask:not(.pa-out)")].pop();
  const layer = sheet || root;
  const shown = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== "hidden" && !e.closest("[hidden]"); };
  const name = (e) => `${e.tagName.toLowerCase()}.${[...e.classList].join(".")}「${(e.getAttribute("aria-label") || e.textContent || "").trim().slice(0, 12)}」`;
  const els = [...layer.querySelectorAll("button, input, select, textarea, .pa-tkbar")].filter((e) => shown(e) && (sheet || !e.closest(".pa-sheet-mask")));
  for (const e of els) {
    if (e.closest(".pa-tabs-scroll, .pa-subnav, .pa-scroll-x")) continue;
    const r = e.getBoundingClientRect();
    if (r.right > W + 1 || r.left < -1) out.push(`超出屏幕：${name(e)} ${Math.round(r.left)}..${Math.round(r.right)}`);
  }
  for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) {
    const a = els[i], b = els[j];
    if (a.contains(b) || b.contains(a) || a.type === "range" || b.type === "range") continue;
    // 2.12.17 滚动框里的按钮按看得见的部分算：滚到框外（被底栏所在的区域截掉）的不算压住
    const clip = (e) => {
      const r = e.getBoundingClientRect(), box = e.closest(".pa-scroll");
      if (!box || box.contains(a) && box.contains(b)) return r;
      const c = box.getBoundingClientRect();
      return { left: Math.max(r.left, c.left), right: Math.min(r.right, c.right), top: Math.max(r.top, c.top), bottom: Math.min(r.bottom, c.bottom) };
    };
    const p = clip(a), q = clip(b);
    const x = Math.min(p.right, q.right) - Math.max(p.left, q.left), y = Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top);
    if (x > 2 && y > 2) out.push(`压住：${name(a)} 和 ${name(b)}`);
  }
  for (const box of layer.querySelectorAll(".pa-sheet-body, .pa-scroll, .pa-page, .pa-bk-dhead, .pa-rx-row, .pa-sub")) {
    if (shown(box) && box.scrollWidth > box.clientWidth + 2 && !/auto|scroll/.test(getComputedStyle(box).overflowX)) out.push(`内容溢出：${[...box.classList].join(".")} ${box.scrollWidth}>${box.clientWidth}`);
  }
  // 书名栏：书名不能和搜索/操作图标挤在一起
  const nm = layer.querySelector(".pa-bk-dhead .pa-bk-dname");
  const srch = layer.querySelector('.pa-bk-dhead [data-e="search"]');
  if (nm && srch && shown(nm) && shown(srch)) { const n = nm.getBoundingClientRect(), s = srch.getBoundingClientRect(); if (n.right > s.left + 1) out.push("书名压住搜索图标"); }
  return [...new Set(out)].slice(0, 8).map((x) => `${where}：${x}`);
}, where);

for (const [label, w, h, mobile, fs] of sizes) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 });
  page.setDefaultTimeout(5000);
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  if (fs !== undefined) await page.addInitScript((v) => localStorage.setItem("mcdonalds:fontSize", String(v)), fs);
  await page.goto("http://127.0.0.1:8765/test/site/index.html");
  await page.waitForFunction(() => window.__mcdonalds?.open, null, { timeout: 15000 });
  await page.evaluate(() => {
    const ctx = window.SillyTavern.getContext();
    ctx.extensionSettings.mcdonalds = { ...(ctx.extensionSettings.mcdonalds || {}), tkEach: true };
    ctx.extensionSettings.regex = [{ id: "g1", scriptName: "一条名字很长很长很长很长很长很长很长的全局正则", findRegex: "/a/g", replaceString: "", placement: [2], disabled: false }];
  });
  const go = async (where, fn) => {
    try { await fn(); await page.waitForTimeout(450); problems.push(...await scan(page, `${label} ${w}×${h} ${where}`)); }
    catch (e) { problems.push(`${label} ${where}：打不开 ${e.message.split("\n")[0]}`); }
  };
  const esc = () => page.keyboard.press("Escape").then(() => page.waitForTimeout(300));
  await go("条目", () => page.evaluate(() => window.__mcdonalds.open("organize")));
  if (w < 700) {
    await go("条目 ⋯", () => page.click("[data-page=organize] [data-tool=menu]"));
    await go("导入", () => page.locator(".pa-sheet-mask:not(.pa-out) .pa-pick-item", { hasText: "导入" }).click());
    await esc();
  }
  await go("世界书", () => page.evaluate(() => window.__mcdonalds.open("books")));
  await go("世界书·打开", () => page.locator('.pa-bk-row[data-book="示例世界书"] .pa-name').click());
  await go("正则", () => page.evaluate(() => window.__mcdonalds.open("rx")));
  await go("文字大小", () => page.evaluate(() => window.__mcdonalds.open("more", "look")));
  if (errs.length) problems.push(`${label}：页面报错 ${errs[0]}`);
  await page.close();
}
await browser.close();
assert.deepStrictEqual(problems, [], "\n" + problems.join("\n"));
console.log(`适配检查通过：${sizes.map((s) => s[0]).join("、")}`);
