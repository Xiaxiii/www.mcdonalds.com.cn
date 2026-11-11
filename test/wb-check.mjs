// 缝进世界书（预设→世界书、世界书→世界书）、世界书→预设的提醒、搬到新版 的端到端检查
// 用法：在仓库根目录起静态服务（python3 -m http.server 8765）；node test/wb-check.mjs
import { chromium } from "playwright";
import { choose, chooseSrcType, chooseDstType } from "./choose.mjs";
import assert from "node:assert";
const S = new URL("./shots/", import.meta.url).pathname;
const exe = process.env.PW_CHROME || undefined;
const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
await page.goto("http://127.0.0.1:8765/test/site/index.html");
await page.waitForFunction(() => window.__presetAtelier?.open, null, { timeout: 15000 });
const T = "【众生相】Claude-Lite-v1.8";
const P = (id, name, content, x = {}) => ({ identifier: id, name, content, role: "system", system_prompt: false, marker: false, injection_position: 0, injection_depth: 4, injection_order: 100, ...x });
const F1 = { prompts: [P("f1-a", "开场白", "开场白要短。"), P("f1-d", "深度提醒", "回复不超过三段。", { injection_position: 1, injection_depth: 2, role: "user" })], prompt_order: [{ character_id: 100001, order: [{ identifier: "f1-a", enabled: true }, { identifier: "f1-d", enabled: true }] }] };
await page.evaluate((F1) => { window.__mock.names.push("F1"); window.__mock.presets.push(F1); window.__presetAtelier.open("suture"); }, F1);
await page.waitForTimeout(400);
const wi = () => page.evaluate(() => structuredClone(globalThis.__wiStore));
const rowClick = (list, name) => page.evaluate(([list, name]) => { const r = [...document.querySelectorAll(`${list} .pa-row`)].find((x) => x.querySelector(".pa-name")?.textContent.includes(name)); r.querySelector(".pa-name").click(); }, [list, name]);

// 1) 预设 → 世界书：放在「示例条目」之后
await choose(page, ".pa-src-name", "F1"); await page.waitForTimeout(200);
await rowClick(".pa-src-list", "开场白");
await rowClick(".pa-src-list", "深度提醒");
await chooseDstType(page, "world"); await page.waitForTimeout(300);
assert.equal(await page.$$eval(".pa-dst-list [data-st=newgroup]", (b) => b.length), 0, "世界书目标不显示新建分组");
await choose(page, ".pa-dst-wb", "示例世界书"); await page.waitForTimeout(300);
await rowClick(".pa-dst-list", "示例条目"); await page.waitForTimeout(150);
assert.match(await page.$eval(".pa-where", (x) => x.textContent), /世界书「示例世界书」，「示例条目」之后/);
await page.screenshot({ path: S + "w-1-target.png" });
await page.click('[data-st="go"]'); await page.waitForTimeout(500);
const chips = await page.$$eval(".pa-sheet .pa-item .pa-badges", (xs) => xs.map((x) => x.textContent));
console.log(chips);
assert.ok(chips[0].includes("常驻") && chips[0].includes("角色定义之后"), "默认常驻，插入位置跟随锚点条目");
assert.ok(chips[1].includes("按深度插入 2"), "预设里的深度插入转为世界书的按深度插入");
await page.locator(".pa-sheet .pa-item-head").first().click(); await page.waitForTimeout(150);
await page.selectOption('.pa-sheet [data-c="constant"]', "0"); await page.waitForTimeout(150);
assert.ok(await page.locator(".pa-sheet .pa-chip-warn").first().isVisible(), "关键词为空时提醒");
await page.fill('.pa-sheet [data-c="keys"]', "开场，开头"); await page.dispatchEvent('.pa-sheet [data-c="keys"]', "change"); await page.waitForTimeout(150);
await page.screenshot({ path: S + "w-2-review.png" });
await page.click(".pa-sheet-actions .pa-btn-primary"); await page.waitForTimeout(800);
let w = (await wi())["示例世界书"];
let list = Object.values(w.entries).sort((a, b) => a.displayIndex - b.displayIndex);
console.log(list.map((e) => `${e.displayIndex}:${e.comment}:${e.constant ? "常驻" : e.key.join("/")}:${e.position}`).join(" | "));
assert.deepEqual(list.map((e) => e.comment), ["示例条目", "开场白", "深度提醒", "常驻设定"]);
assert.deepEqual(list[1].key, ["开场", "开头"]);
assert.equal(list[1].constant, false);
assert.equal(list[2].position, 4); assert.equal(list[2].depth, 2); assert.equal(list[2].role, 1);
await page.screenshot({ path: S + "w-3-done.png" });

// 2) 世界书 → 世界书：整条设置照搬
await chooseSrcType(page, "world"); await page.waitForTimeout(300);
await choose(page, ".pa-src-name", "示例世界书"); await page.waitForTimeout(300);
await rowClick(".pa-src-list", "示例条目");
await choose(page, ".pa-dst-wb", "空白世界书"); await page.waitForTimeout(300);
await page.click('.pa-dst-list [data-act="top"]'); await page.waitForTimeout(150);
await page.click('[data-st="go"]'); await page.waitForTimeout(500);
assert.match(await page.$eval(".pa-sheet .pa-badges", (x) => x.textContent), /关键词.*角色定义之后/);
await page.click(".pa-sheet-actions .pa-btn-primary"); await page.waitForTimeout(800);
w = (await wi())["空白世界书"];
list = Object.values(w.entries);
assert.equal(list.length, 1);
assert.deepEqual(list[0].key, ["示例", "例子"]);
assert.equal(list[0].order, 50);

// 3) 世界书 → 预设：按关键词触发的条目提醒
await chooseDstType(page, "preset"); await page.waitForTimeout(300);
await rowClick(".pa-src-list", "示例条目");
await page.evaluate(() => [...document.querySelectorAll(".pa-dst-list .pa-ghead")].find((x) => x.textContent.includes("正文规则")).click());
await page.waitForTimeout(150);
await page.click('[data-st="go"]'); await page.waitForTimeout(500);
await page.locator(".pa-sheet .pa-item-head").first().click(); await page.waitForTimeout(150);
assert.match(await page.$eval(".pa-sheet .pa-item", (x) => x.textContent), /按关键词触发（示例、例子），缝进预设后会一直生效/);
await page.click(".pa-sheet-actions .pa-btn-primary"); await page.waitForTimeout(1200);
const rec = await page.evaluate((T) => { const m = window.__mock; return m.presets[m.names.indexOf(T)].extensions.presetAtelier?.stitched; }, T);
assert.ok(rec?.length >= 1 && !("from" in rec[rec.length - 1]), "缝合时记录了条目，但不记录来源名");

// 4) 搬到新版：旧版 = T（刚缝进「示例条目」），新版 = 没有缝过的原版
await page.evaluate((T) => {
  const m = window.__mock;
  const orig = structuredClone(m.presets[m.names.indexOf(T)]);
  orig.prompts = orig.prompts.filter((p) => p.name !== "示例条目");
  for (const po of orig.prompt_order) po.order = po.order.filter((o) => orig.prompts.some((p) => p.identifier === o.identifier) || ["chatHistory", "worldInfoBefore", "worldInfoAfter", "charDescription", "charPersonality", "scenario", "personaDescription", "dialogueExamples", "main", "nsfw", "jailbreak", "enhanceDefinitions"].includes(o.identifier));
  delete orig.extensions.presetAtelier;
  m.names.push("众生相-v1.9"); m.presets.push(orig);
  window.__presetAtelier.open("organize"); window.__presetAtelier.open("suture");
}, T);
await page.waitForTimeout(400);
await chooseSrcType(page, "preset"); await page.waitForTimeout(200);
await choose(page, ".pa-src-name", T); await page.waitForTimeout(200);
await choose(page, ".pa-dst-picker .pa-namebtn", "众生相-v1.9"); await page.waitForTimeout(300);
await page.click('[data-st="srcmenu"]'); await page.waitForTimeout(200);
await page.click(".pa-pick-item >> text=搬到新版…"); await page.waitForTimeout(500);
const mig = await page.$$eval(".pa-sheet .pa-mig .pa-crow", (xs) => xs.map((x) => `${x.querySelector("input").checked ? "☑" : "☐"} ${x.textContent.replace(/\s+/g, " ").trim()}`));
console.log(mig.join("\n"));
assert.ok(mig.some((x) => x.startsWith("☑ 示例条目") && x.includes("缝合记录") && x.includes("「正文规则」组之后")), "有记录的条目已勾选，位置对应");
await page.screenshot({ path: S + "w-4-migrate.png" });
await page.click(".pa-sheet-actions .pa-btn-primary"); await page.waitForTimeout(600);
assert.match(await page.$eval(".pa-sheet-head b", (x) => x.textContent), /搬 1 条到「众生相-v1.9」/);
await page.screenshot({ path: S + "w-5-migrate-review.png" });
await page.click(".pa-sheet-actions .pa-btn-primary"); await page.waitForTimeout(1500);
const after = await page.evaluate(() => {
  const m = window.__mock; const p = m.presets[m.names.indexOf("众生相-v1.9")];
  const order = p.prompt_order.find((o) => o.character_id == 100001).order.map((o) => o.identifier);
  const nm = (id) => p.prompts.find((x) => x.identifier === id)?.name || id;
  const g = p.extensions.baibaiToolkit?.presetPromptGroups?.prompts || {};
  const i = order.findIndex((id) => nm(id) === "示例条目");
  return { prev: nm(order[i - 1]), prevGroup: g[order[i - 1]]?.groupId, mine: g[order[i]]?.groupId, rec: p.extensions.presetAtelier?.stitched?.length };
});
console.log(after);
assert.ok(after.prevGroup && !after.mine, "搬过去后在「正文规则」组之后（组外）");
assert.equal(after.rec, 1, "新版也记录了搬过去的条目");
// 5) 取消：清掉已选条目和缝合位置
await rowClick(".pa-src-list", "开场白").catch(() => {});
await page.evaluate(() => [...document.querySelectorAll(".pa-dst-list .pa-ghead")][0].click());
await page.waitForTimeout(150);
assert.ok(await page.$(".pa-dst-list .pa-insert-mark"));
await page.click('[data-st="clear"]'); await page.waitForTimeout(200);
assert.ok(!(await page.$(".pa-dst-list .pa-insert-mark")), "取消后缝合位置标识消失");
assert.equal(await page.$eval(".pa-picked-n", (x) => x.textContent), "未选条目");
assert.ok(await page.$eval('[data-st="clear"]', (b) => b.hidden), "没有可清的内容时不显示「清空」");
assert.deepEqual(errs, []);
console.log("世界书与搬到新版检查全部通过");
await browser.close();
