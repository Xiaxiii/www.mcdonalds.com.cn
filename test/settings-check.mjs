// 扩展页设置框、防下拉刷新开关的检查。用法同 clean-check.mjs
import { chromium } from "playwright";
import assert from "node:assert";
const S = new URL("./shots/", import.meta.url).pathname;
const exe = process.env.PW_CHROME || undefined;
const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage({ viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
await page.goto("http://127.0.0.1:8765/test/site/index.html");
await page.waitForSelector("#pa-settings");
// 模拟酒馆把字号调大
await page.addStyleTag({ content: ":root{--mainFontSize:22px} body{font-size:22px} code{background:#eee;color:#eee}" });
assert.ok(await page.$("#pa-pull-guard"), "默认开启防下拉刷新");
assert.equal(await page.evaluate(() => getComputedStyle(document.body).overscrollBehaviorY), "none");
const over = await page.$eval("#pa-settings", (b) => [...b.querySelectorAll(".pa-set-intro, .pa-set-foot, .pa-set-note")].some((x) => x.scrollWidth > x.clientWidth + 2));
assert.ok(!over, "说明文字不横向溢出");
const foot = await page.$eval(".pa-set-foot", (x) => x.textContent);
assert.match(foot, /\/atelier/);
await page.$eval("#pa-settings", (b) => b.scrollIntoView());
await page.click("#pa-settings summary");
await page.screenshot({ path: S + "s-1-settings.png", fullPage: true });
await page.click("[data-opt=noPullRefresh]");
assert.ok(!(await page.$("#pa-pull-guard")), "关闭后移除");
await page.click("[data-opt=noPullRefresh]");
assert.ok(await page.$("#pa-pull-guard"));
// 魔棒菜单：别的扩展晚加进来，本项也留在最下面
const last = await page.evaluate(async () => {
  const m = document.getElementById("extensionsMenu");
  if (!m) return "skip";
  const x = document.createElement("div"); x.textContent = "后加载的扩展"; m.append(x);
  await new Promise((r) => setTimeout(r, 50));
  return m.lastElementChild.id;
});
assert.ok(last === "skip" || last === "pa-menu-entry", "魔棒菜单里始终在最下面");
await page.screenshot({ path: S + "s-2-settings.png", clip: await page.$eval("#pa-settings", (b) => { const r = b.getBoundingClientRect(); return { x: r.x, y: r.y + scrollY, width: r.width, height: Math.min(r.height, 1100) }; }) });
assert.deepEqual(errs, []);
console.log("设置框检查通过");
await browser.close();
