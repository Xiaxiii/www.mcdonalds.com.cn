// 外观「跟随系统」开关：旧设置（theme: "system" + themeLight）换成开关；系统深色用夜雾、浅色用选中的配色；关掉后不管系统深浅。
// 用法同 clean-check.mjs
import { chromium } from "playwright";
import assert from "node:assert";
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const page = await browser.newPage({ viewport: { width: 834, height: 1000 }, hasTouch: true, isMobile: true, colorScheme: "light" });
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
await page.goto("http://127.0.0.1:8765/test/site/index.html");
await page.waitForFunction(() => window.__mcdonalds?.open, null, { timeout: 15000 });
const ok = (m) => console.log("✓", m);
const st = () => page.evaluate(() => {
  const s = window.SillyTavern.getContext().extensionSettings.mcdonalds;
  return { theme: s.theme, follow: s.followSystem, light: s.themeLight, applied: document.getElementById("mcd-root").dataset.theme, checked: document.querySelector("[data-follow-system]")?.checked, pressed: document.querySelector('.pa-theme[aria-pressed="true"]')?.dataset.themeId, note: !!document.querySelector(".pa-look-note") };
});

await page.evaluate(() => { window.SillyTavern.getContext().extensionSettings.mcdonalds = { theme: "system", themeLight: "taro", moreTab: "look" }; window.__mcdonalds.open("more"); });
await page.waitForTimeout(400);
let s = await st();
assert.deepEqual([s.theme, s.follow, s.light, s.applied, s.checked, s.pressed, s.note], ["taro", true, undefined, "taro", true, "taro", true]);
assert.equal(await page.locator('[data-theme-id="system"]').count(), 0, "没有「跟随手机系统」卡片");
ok("旧设置换成开关，浅色时用原来的配色");

await page.emulateMedia({ colorScheme: "dark" }); await page.waitForTimeout(300);
s = await st();
assert.equal(s.applied, "night", "系统深色时用夜雾");
assert.equal(s.pressed, "taro", "选中的配色不变");
ok("系统变深色，面板马上换成夜雾");

await page.click(".pa-hswitch > span:first-child"); await page.waitForTimeout(300);
s = await st();
assert.deepEqual([s.follow, s.checked, s.applied, s.note], [false, false, "taro", false]);
ok("点「跟随系统」文字也能关；关掉后深色系统下仍用选中的配色");

await page.click('[data-theme-id="bean"]'); await page.waitForTimeout(150);
await page.click(".pa-hswitch .pa-switch"); await page.waitForTimeout(300);
s = await st();
assert.deepEqual([s.theme, s.follow, s.applied], ["bean", true, "night"]);
await page.emulateMedia({ colorScheme: "light" }); await page.waitForTimeout(300);
assert.equal((await st()).applied, "bean");
ok("开关打开时换配色：浅色用新选的，深色仍是夜雾");

assert.deepEqual(errs, []);
await browser.close();
