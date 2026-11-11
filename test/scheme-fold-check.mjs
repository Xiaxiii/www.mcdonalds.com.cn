// 2.6.6 方案页能展开、收起的地方（方案分组、选项）记住最后一次的状态，重新打开后保持；
// 没动过的方案分组按默认：当前角色那组展开。先构建并在仓库根目录运行 8765 静态服务。
import { chromium } from "playwright";
import assert from "node:assert";
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const errs = [];
const ok = (m) => console.log("✓", m);
async function openPage(saved) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto("http://127.0.0.1:8765/test/site/index.html");
  await page.waitForFunction(() => window.__mcdonalds?.open, null, { timeout: 15000 });
  await page.evaluate((saved) => {
    const c = window.SillyTavern.getContext();
    c.characters = [{ name: "沈砚", avatar: "shen.png" }, { name: "林栖", avatar: "lin.png" }];
    c.characterId = "0";
    c.chatId = "chat-1";
    const m = window.__mock;
    c.extensionSettings.mcdonalds = saved ? structuredClone(saved) : {
      schemes: [
        { id: "a", name: "沈砚·正剧", preset: m.names[0], scope: "all", states: {}, groupStates: {}, charKey: "shen.png" },
        { id: "b", name: "林栖·日常", preset: m.names[0], scope: "all", states: {}, groupStates: {}, charKey: "lin.png" }
      ]
    };
    window.__mcdonalds.open("more", "schemes");
  }, saved);
  await page.waitForTimeout(500);
  return page;
}
const groups = (page) => page.evaluate(() => [...document.querySelectorAll(".pa-schemes .pa-sgroup")].map((g) => (g.classList.contains("open") ? "+" : "-") + g.querySelector(".pa-sghead b").textContent).join(" "));
const opts = (page) => page.evaluate(() => [...document.querySelectorAll(".pa-opthead")].map((h) => h.getAttribute("aria-expanded")).join(","));
const saved = (page) => page.evaluate(() => structuredClone(window.SillyTavern.getContext().extensionSettings.mcdonalds));

let page = await openPage(null);
assert.equal(await groups(page), "+沈砚 -林栖", "没动过时当前角色那组展开");
// 合上当前组、展开另一组；点开第一个选项
await page.locator(".pa-sgroup", { hasText: "沈砚" }).locator(".pa-sghead").click(); await page.waitForTimeout(150);
await page.locator(".pa-sgroup", { hasText: "林栖" }).locator(".pa-sghead").click(); await page.waitForTimeout(150);
await page.locator(".pa-opthead").first().locator(".pa-optlabel").click(); await page.waitForTimeout(150);
const g1 = await groups(page), o1 = await opts(page);
assert.equal(g1, "-沈砚 +林栖");
assert.match(o1, /^true/);
const s1 = await saved(page);
await page.close();

// 重新打开（带着保存的设置）：与最后一次相同，当前角色那组不会自动展开
page = await openPage(s1);
assert.equal(await groups(page), g1, "方案分组保持最后一次");
assert.equal(await opts(page), o1, "选项保持最后一次");
ok("方案页：分组、选项记住最后一次的展开、收起");
await page.close();
assert.deepEqual(errs, []);
await browser.close();
