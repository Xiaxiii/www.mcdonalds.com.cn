// 1.8.0 新功能的端到端检查：新建、复制、编辑角色和位置，已选清单，设置框改名，站点模型，缝进世界书后撤销。
// 用法同 clean-check.mjs
import { chromium } from "playwright";
import { choose, chooseSrcType, chooseDstType, expandAll, organizeTool } from "./choose.mjs";
import assert from "node:assert";
const exe = process.env.PW_CHROME || undefined;
const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage({ viewport: { width: 1024, height: 1000 } });
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
await page.goto("http://127.0.0.1:8765/test/site/index.html");
await page.waitForFunction(() => window.__presetAtelier?.open, null, { timeout: 15000 });
const ok = (m) => console.log("✓", m);
const live = () => page.evaluate(() => window.__mock.live.prompts);

// 1) 新建条目：放在选中的条目后面，编辑角色、插入位置、深度，点保存才写进去
await page.evaluate(() => window.__presetAtelier.open("organize"));
await page.waitForTimeout(400);
await expandAll(page); await page.waitForTimeout(200);
const firstId = await page.locator(".pa-list .pa-row").first().getAttribute("data-id");
await page.locator(".pa-list .pa-row").first().click();
await organizeTool(page, "newentry"); await page.waitForTimeout(200);
await page.fill(".pa-sheet input", "测试新条目");
await page.click(".pa-sheet-actions .pa-btn-primary"); await page.waitForTimeout(400);
// 2.7.2 宽屏在右侧编辑栏里编辑
assert.equal(await page.$eval(".pa-editpane-head b", (x) => x.textContent), "测试新条目");
await page.fill(".pa-editpane [data-f=content]", "新条目的正文");
await page.selectOption(".pa-editpane [data-f=role]", "user");
await page.selectOption(".pa-editpane [data-f=pos]", "1");
await page.fill(".pa-editpane [data-f=depth]", "2");
await page.click('.pa-editpane [data-ep="save"]'); await page.waitForTimeout(800);
await page.click('.pa-editpane [data-ep="close"]');
const made = (await live()).find((p) => p.name === "测试新条目");
assert.ok(made, "新条目已保存");
assert.equal(made.content, "新条目的正文");
assert.equal(made.role, "user");
assert.equal(made.injection_position, 1);
assert.equal(made.injection_depth, 2);
const order = await page.evaluate(() => window.__mock.live.prompt_order.find((o) => Number(o.character_id) === 100001).order.map((o) => o.identifier));
assert.equal(order[order.indexOf(firstId) + 1], made.identifier, "放在选中的条目后面");
ok("新建条目，编辑角色和插入位置");

// 1b) 搜索：先列名称、标签、分组名匹配的；只在正文里出现的要点开才列，并显示正文里匹配的那一句
await page.click('[data-tool="search"]').catch(() => {});
await page.fill(".pa-find", "文风");
await page.waitForTimeout(300);
let sum = await page.$eval(".pa-qsum", (x) => x.textContent);
assert.match(sum, /分组名匹配 \d+ 条/);
assert.match(sum, /正文里还有 \d+ 条/);
assert.equal(await page.locator(".pa-list .pa-hitline").count(), 0, "默认不列只在正文里出现的");
await page.click(".pa-qsum [data-act=qbody]"); await page.waitForTimeout(200);
assert.ok(await page.locator(".pa-list .pa-hitline").count() > 0, "点开后列出，并显示正文出处");
assert.match(await page.locator(".pa-list .pa-hitline").first().textContent(), /^正文：.*文风/);
await page.fill(".pa-find", ""); await page.waitForTimeout(200);
await page.click('[data-tool="search"]').catch(() => {});
ok("搜索分名称和正文两层");

// 2) 复制：副本放在原条目后面
await page.locator(".pa-list .pa-row", { hasText: "测试新条目" }).first().click();
await page.click('[data-sel="copy"]'); await page.waitForTimeout(800);
const copy = (await live()).find((p) => p.name === "测试新条目（副本）");
assert.ok(copy && copy.content === "新条目的正文" && copy.identifier !== made.identifier);
ok("复制条目");

// 3) 缝合：已选清单里可以逐条去掉；新建分组在目标列表里
await page.evaluate(() => window.__presetAtelier.open("suture")); await page.waitForTimeout(400);
await page.locator(".pa-src-list .pa-ghead").first().click(); await page.waitForTimeout(150);
const rows = page.locator(".pa-src-list .pa-row:visible");
await rows.nth(0).click(); await rows.nth(1).click(); await page.waitForTimeout(150);
assert.match(await page.$eval(".pa-picked-n", (x) => x.textContent), /已选 2 条/);
await page.click(".pa-picked-n"); await page.waitForTimeout(200);
await page.locator(".pa-picked-row button").first().click(); await page.waitForTimeout(150);
assert.equal(await page.locator(".pa-picked-row").count(), 1);
await page.click(".pa-sheet-actions .pa-btn-primary"); await page.waitForTimeout(200);
assert.match(await page.$eval(".pa-picked-n", (x) => x.textContent), /已选 1 条/);
assert.equal(await page.locator(".pa-dst-list [data-st=newgroup]").count(), 1);
ok("已选清单逐条去掉；新建分组在目标列表里");

// 4) 缝进世界书后可以撤销
await chooseDstType(page, "world"); await page.waitForTimeout(400);
await choose(page, ".pa-dst-wb", "示例世界书"); await page.waitForTimeout(400);
const wbCount = () => page.evaluate(async () => Object.keys((await import("/test/site/scripts/world-info.js")).loadWorldInfo ? (await (await import("/test/site/scripts/world-info.js")).loadWorldInfo("示例世界书")).entries : {}).length);
const n0 = await wbCount();
await page.locator(".pa-dst-list .pa-row").first().click(); await page.waitForTimeout(150);
await page.click('[data-st="go"]'); await page.waitForTimeout(500);
await page.click(".pa-sheet-actions .pa-btn-primary"); await page.waitForTimeout(800);
assert.equal(await wbCount(), n0 + 1);
assert.ok(await page.isVisible('[data-st="wbundo"]'));
await page.click('[data-st="wbundo"]'); await page.waitForTimeout(200);
await page.click(".pa-sheet .pa-btn-danger"); await page.waitForTimeout(800);
assert.equal(await wbCount(), n0, "撤销后条目数恢复");
ok("缝进世界书后撤销");

// 5) 站点模型：酒馆里换了模型不悄悄写进站点，点「改记为当前模型」才写
await page.evaluate(() => {
  document.body.insertAdjacentHTML("beforeend", '<select id="model_custom_select"><option value="m-a">m-a</option><option value="m-b">m-b</option></select><input id="custom_model_id">');
  const s = window.SillyTavern.getContext().extensionSettings.presetAtelier;
  s.sites = [{ id: "s1", name: "中转A", source: "custom", url: "https://example.com/v1", model: "m-a", models: [] }];
  s.activeSiteId = "s1";
  window.__mock.live.custom_model = "m-b";
});
await page.click('.pa-tabs [data-nav="conn"]'); await page.waitForTimeout(400);
assert.equal(await page.evaluate(() => window.SillyTavern.getContext().extensionSettings.presetAtelier.sites[0].model), "m-a");
await page.click('[data-a="keepmodel"]'); await page.waitForTimeout(300);
assert.equal(await page.evaluate(() => window.SillyTavern.getContext().extensionSettings.presetAtelier.sites[0].model), "m-b");
ok("站点模型不被悄悄覆盖，确认后才改");

// 6) 设置框改名：在行内改，不弹浏览器输入框
await page.click(".pa-close"); await page.waitForTimeout(200);
await page.click('#pa-settings [data-a="rename"]'); await page.waitForTimeout(100);
await page.fill("#pa-settings .pa-set-input", "我的鸡翅");
await page.keyboard.press("Enter"); await page.waitForTimeout(150);
assert.equal(await page.$eval("#pa-settings .pa-set-namerow .pa-appname", (x) => x.textContent), "我的鸡翅");
assert.equal(await page.$eval("#pa-menu-entry .pa-appname", (x) => x.textContent), "我的鸡翅");
await page.click('#pa-settings [data-a="rename"]'); await page.waitForTimeout(100);
await page.fill("#pa-settings .pa-set-input", "");
await page.click('#pa-settings [data-a="rename-ok"]'); await page.waitForTimeout(150);
assert.equal(await page.$eval("#pa-menu-entry .pa-appname", (x) => x.textContent), "焦香鸡翅", "留空恢复默认");
ok("设置框行内改名，留空恢复默认");

assert.deepEqual(errs, []);
console.log("新功能检查全部通过");
await browser.close();
