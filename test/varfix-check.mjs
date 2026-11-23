// 2.12.8 变量页「清空后读取」：写明赋值、清空、读取三步（条目名加「」，名字自带箭头也不乱）和改法；
// 赋值那条整条只写变量时有一键挪动的按钮，挪完风险消失、可撤销。用法：在仓库根目录 bash test/run-browser.sh
import { chromium } from "playwright";
import assert from "node:assert";
const S = new URL("./shots/", import.meta.url).pathname;
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
await page.goto("http://127.0.0.1:8765/test/site/index.html");
await page.waitForFunction(() => window.__mcdonalds?.open, null, { timeout: 15000 });
// 照「超级破甲」：最上面一条只写变量，「预设头部」组里的初始化条目把它清空，后面的思维链读取
await page.evaluate(() => {
  const P = (id, name, content) => ({ identifier: id, name, content, role: "system", system_prompt: false, marker: false, injection_position: 0 });
  window.__mock.names.push("变量测试");
  window.__mock.presets.push({
    prompts: [P("jb", "超级破甲", "{{setvar::超级破甲::破甲正文}}"), P("init", "set-不要关", "{{setvar::超级破甲::}}"), P("h", "身份定义", "身份正文"), P("cot", "← 常规CoT", "{{getvar::超级破甲}}")],
    prompt_order: [{ character_id: 100001, order: ["jb", "init", "h", "cot"].map((identifier) => ({ identifier, enabled: true })) }],
    extensions: { baibaiToolkit: { presetPromptGroups: { version: 1, groups: [{ id: "g1", name: "预设头部", enabled: true }], prompts: { init: { groupId: "g1" }, h: { groupId: "g1" } } } } }
  });
});
await page.evaluate(() => window.__mcdonalds.open("vars"));
await page.waitForTimeout(300);
await page.click("[data-page=vars] .pa-picker-slot .pa-namebtn");
await page.evaluate(() => [...document.querySelectorAll(".pa-npick-item")].find((x) => x.dataset.v === "变量测试").click());
await page.waitForTimeout(400);
const trail = await page.$eval("[data-page=vars] .pa-var-trail", (x) => x.textContent);
assert.strictEqual(trail, "「超级破甲」赋值 → 「set-不要关」清空 → 「← 常规CoT」读取");
const fix = await page.$eval("[data-page=vars] .pa-var-fix", (x) => x.firstChild.textContent);
assert.strictEqual(fix, "改法：把「超级破甲」挪到「预设头部」组后面，或在「set-不要关」里去掉对「超级破甲」的清空");
assert.strictEqual(await page.textContent("[data-vf=fix]"), "挪到「预设头部」组后面");
await page.screenshot({ path: S + "varfix-1.png" });
console.log("✓ 写明赋值、清空、读取三步和改法");
await page.click("[data-vf=fix]");
await page.waitForTimeout(400);
assert.match(await page.textContent("[data-page=vars] [data-vf=result] .pa-p"), /发现 0 项顺序风险/);
// 面板里切到「预设 › 条目」（重新打开面板会回到酒馆正在用的预设）
await page.click('.pa-tabs [data-nav="preset"]');
await page.click('.pa-subnav [data-tab="organize"]');
await page.waitForTimeout(300);
const order = await page.$$eval("[data-page=organize] .pa-list .pa-row .pa-name, [data-page=organize] .pa-list .pa-ghead .pa-gname", (n) => n.map((x) => x.textContent));
assert.ok(order.indexOf("预设头部") < order.indexOf("超级破甲") && order.indexOf("超级破甲") < order.indexOf("← 常规CoT"), "挪到组后面、读取前面：" + order.join());
assert.ok(await page.locator('.pa-savebar [data-g="undo"]').isVisible(), "可撤销");
console.log("✓ 一键挪到组后面，风险消失，可撤销");
assert.deepStrictEqual(errs, []);
console.log("变量改法检查通过");
await browser.close();
