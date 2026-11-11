// 入口与悬浮球：默认只有魔棒菜单；扩展页设置框和「更多 → 外观」都能选入口（魔棒菜单、悬浮球、两个都要、都不要）；
// 以前开了悬浮球的算「两个都要」；点球打开，拖动后贴边并记住位置。用法同 clean-check.mjs
import { chromium } from "playwright";
import assert from "node:assert";
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
await page.goto("http://127.0.0.1:8765/test/site/index.html");
await page.waitForSelector("#mcd-settings");
const ok = (m) => console.log("✓", m);
const S = () => page.evaluate(() => window.SillyTavern.getContext().extensionSettings.mcdonalds);

const wandShown = () => page.$eval("#mcd-menu-entry", (x) => getComputedStyle(x).display !== "none");
assert.equal(await page.$("#mcd-ball"), null, "默认没有悬浮球");
assert.equal(await wandShown(), true, "默认在魔棒菜单里");
assert.equal(await page.locator("[data-opt=entry]").inputValue(), "wand");
// 以前开了悬浮球的设置（没有 entry）：算「两个都要」
await page.evaluate(() => { const s = window.SillyTavern.getContext().extensionSettings.mcdonalds; s.floatBall = true; delete s.entry; window.__mcdonalds.open("more", "look"); });
await page.waitForTimeout(300);
assert.equal(await page.locator("[data-page=look] [data-entry].on").innerText(), "两个都要", "旧设置开着悬浮球时算两个都要");
await page.evaluate(() => { const s = window.SillyTavern.getContext().extensionSettings.mcdonalds; s.floatBall = false; window.__mcdonalds.close?.(); });
await page.locator("#mcd-root .pa-close, #mcd-root [aria-label=关闭]").first().click().catch(() => {});
await page.waitForTimeout(300);
ok("默认只有魔棒菜单；旧设置开着悬浮球时算两个都要");
await page.selectOption("[data-opt=entry]", "ball");
await page.waitForTimeout(100);
assert.ok(await page.$("#mcd-ball"), "选悬浮球后出现");
assert.equal(await wandShown(), false, "只用悬浮球时魔棒菜单里不显示");
assert.equal((await S()).entry, "ball");
ok("扩展页设置框里选「悬浮球」：出现悬浮球，魔棒菜单里不显示");

// 酒馆在 html 上听 mousedown/touchstart 收起抽屉；拖球、点球不能传到那里
await page.evaluate(() => { window.__htmlDown = 0; document.documentElement.addEventListener("mousedown", () => window.__htmlDown++); document.documentElement.addEventListener("touchstart", () => window.__htmlDown++); });
// 拖到左半边，松手贴左边
let r = await page.$eval("#mcd-ball", (b) => b.getBoundingClientRect().toJSON());
await page.mouse.move(r.x + 22, r.y + 22);
await page.mouse.down();
await page.mouse.move(120, 300, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(300);
r = await page.$eval("#mcd-ball", (b) => b.getBoundingClientRect().toJSON());
assert.equal(Math.round(r.x), 8, "贴到左边");
assert.equal((await S()).floatBallPos.x, 0);
assert.ok(await page.$eval("#mcd-root", (x) => x.hidden).catch(() => true), "拖动不算打开");
assert.equal(await page.evaluate(() => window.__htmlDown), 0, "不触发酒馆收起抽屉");
ok("拖动后贴边并记住位置，不收起酒馆面板");

await page.click("#mcd-ball"); await page.waitForTimeout(400);
assert.equal(await page.$eval("#mcd-root", (x) => x.hidden), false, "点一下打开");
assert.equal(await page.$eval("#mcd-ball", (b) => getComputedStyle(b).display), "none", "面板打开时隐藏");
assert.equal(await page.evaluate(() => window.__htmlDown), 0, "点球不触发酒馆收起抽屉");
ok("点一下打开面板");

await page.evaluate(() => window.__mcdonalds.open("more", "look")); await page.waitForTimeout(300);
const seg = (label) => page.locator("[data-page=look] [data-entry]", { hasText: label });
assert.equal(await page.$eval("[data-page=look] .pa-scroll", (x) => x.firstElementChild.textContent), "入口", "入口在配色上面");
assert.equal(await page.locator("[data-page=look] [data-entry].on").innerText(), "悬浮球");
await seg("两个都要").click(); await page.waitForTimeout(100);
assert.equal(await wandShown(), true, "两个都要：魔棒菜单里也有");
assert.equal(await page.locator("[data-opt=entry]").inputValue(), "both", "设置框同步");
await seg("魔棒菜单").click(); await page.waitForTimeout(100);
assert.equal(await page.$("#mcd-ball"), null, "只用魔棒菜单时没有悬浮球");
assert.equal(await wandShown(), true);
assert.equal(await page.locator("[data-opt=entry]").inputValue(), "wand", "设置框同步");
ok("「更多 → 外观」里切换入口，设置框同步");

const noteShown = (sel) => page.$eval(sel, (x) => !x.hidden && getComputedStyle(x).display !== "none");
assert.equal(await noteShown("[data-page=look] .pa-noentry"), false, "有入口时不写怎么打开");
await seg("都不要").click(); await page.waitForTimeout(100);
assert.equal(await page.$("#mcd-ball"), null, "都不要：没有悬浮球");
assert.equal(await wandShown(), false, "都不要：魔棒菜单里不显示");
assert.equal((await S()).floatBall, false);
assert.equal(await page.locator("[data-opt=entry]").inputValue(), "none", "设置框同步");
assert.equal(await noteShown("[data-page=look] .pa-noentry"), true, "写出怎么打开");
assert.match(await page.$eval("[data-page=look] .pa-noentry", (x) => x.textContent), /\/mcd/);
assert.equal(await noteShown("#mcd-settings .pa-noentry"), true, "设置框也写");
await page.selectOption("[data-opt=entry]", "wand"); await page.waitForTimeout(100);
assert.equal(await wandShown(), true, "设置框里选回魔棒菜单");
assert.equal(await noteShown("#mcd-settings .pa-noentry"), false);
assert.equal(await noteShown("[data-page=look] .pa-noentry"), false);
ok("都不要：魔棒菜单和悬浮球都没有，写出从设置框或 /mcd 打开");

assert.deepEqual(errs, []);
console.log("悬浮球检查全部通过");
await browser.close();
