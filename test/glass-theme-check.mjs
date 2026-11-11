// 2.3.8 芽体、菌落：毛玻璃配色；去掉春芽。顶栏、标签栏用真模糊，列表里的分组不做实时模糊（滑动流畅）；文字对比度够；截图。用法同 clean-check.mjs
import { chromium } from "playwright";
import assert from "node:assert";
const S = new URL("./shots/", import.meta.url).pathname;
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
await page.goto("http://127.0.0.1:8765/test/site/index.html");
await page.waitForFunction(() => window.__presetAtelier?.open, null, { timeout: 15000 });
await page.evaluate(() => window.__presetAtelier.open("more"));
await page.click('[data-m="look"]');
for (const id of ["bud", "colony"]) {
  await page.click(`[data-theme-id="${id}"]`);
  await page.waitForTimeout(200);
  await page.screenshot({ path: S + `g-${id}-look.png` });
  await page.evaluate(() => window.__presetAtelier.open("organize"));
  await page.waitForSelector("#pa-root .pa-group");
  await page.waitForTimeout(300);
  await page.screenshot({ path: S + `g-${id}-organize.png` });
  const r = await page.evaluate(() => {
    const root = document.getElementById("pa-root");
    const bf = (sel) => { const el = root.querySelector(sel); const cs = getComputedStyle(el); return cs.backdropFilter || cs.webkitBackdropFilter || "none"; };
    const lum = (rgb) => rgb.map((v) => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [.2126, .7152, .0722][i], 0);
    const rgb = (v) => { v = v.trim(); return v[0] === "#" ? [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16)) : v.match(/[\d.]+/g).slice(0, 3).map(Number); };
    const text = rgb(getComputedStyle(root).getPropertyValue("--pa-text")), tint = rgb(getComputedStyle(root).getPropertyValue("--pa-tint"));
    const a = lum(text), b = lum(tint);
    return {
      glass: root.classList.contains("pa-glass"), theme: root.dataset.theme,
      top: bf(".pa-top"), tabs: bf(".pa-tabs"), group: bf(".pa-group"),
      shellBg: getComputedStyle(root.querySelector(".pa-shell")).backgroundImage.split("radial-gradient").length - 1,
      contrast: (Math.max(a, b) + .05) / (Math.min(a, b) + .05)
    };
  });
  assert.equal(r.theme, id);
  assert.ok(r.glass, "毛玻璃配色要加 pa-glass");
  assert.match(r.top, /blur/, "顶栏是毛玻璃");
  assert.match(r.tabs, /blur/, "标签栏是毛玻璃");
  assert.equal(r.group, "none", "列表里的分组不做实时模糊");
  assert.ok(r.shellBg > 10, "油画底 + 芽体/菌落光斑");
  assert.ok(r.contrast >= 4.5, `正文对比度 ${r.contrast}`);
  await page.evaluate(() => window.__presetAtelier.open("more"));
  await page.click('[data-m="look"]');
}
// 换回其他配色时去掉 pa-glass
await page.click('[data-theme-id="dusk"]');
await page.waitForTimeout(200);
assert.ok(!(await page.evaluate(() => document.getElementById("pa-root").classList.contains("pa-glass"))));
// 2.3.8 去掉了春芽：没有这个按钮，之前选过的回到默认配色（2.7.1 起为「素」）
assert.equal(await page.locator('[data-theme-id="matcha"]').count(), 0);
assert.equal(await page.evaluate(() => {
  window.SillyTavern.getContext().extensionSettings.presetAtelier.theme = "matcha";
  window.__presetAtelier.open("organize");
  return document.getElementById("pa-root").dataset.theme;
}), "su");
assert.deepEqual(errs, []);
console.log("毛玻璃配色检查全部通过");
await browser.close();
