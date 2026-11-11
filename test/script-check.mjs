// 脚本版：单独装时启动；和扩展版一起装时只有扩展版启动。先 node build.mjs 生成 dist/
import { chromium } from "playwright";
import assert from "node:assert";
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
for (const mode of ["script", "both"]) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const logs = [];
  page.on("console", (m) => logs.push(m.text()));
  page.on("pageerror", (e) => logs.push("ERR " + e.message));
  await page.goto(`http://127.0.0.1:8765/test/site/script.html?mode=${mode}`);
  await page.waitForFunction(() => window.__presetAtelier?.open, null, { timeout: 15000 });
  await page.waitForTimeout(800);
  const info = await page.evaluate(() => ({ kind: window.__presetAtelier.kind, version: window.__presetAtelier.version, menus: document.querySelectorAll("#pa-menu-entry").length, styles: document.querySelectorAll("#pa-style").length }));
  console.log(mode, JSON.stringify(info), logs.filter((l) => /焦香鸡翅|ERR/.test(l)).join(" | "));
  assert.equal(info.kind, mode === "script" ? "script" : "extension");
  assert.equal(info.menus, 1, "菜单入口只有一个");
  assert.equal(info.styles, 1, "样式只注入一次");
  assert.ok(!logs.some((l) => l.startsWith("ERR")), "没有页面错误");
  await page.close();
}
await browser.close();
console.log("脚本版检查通过");
