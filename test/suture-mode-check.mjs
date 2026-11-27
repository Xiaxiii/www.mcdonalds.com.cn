// 缝合预览：写法整批切换（全部原样 / 全部按目标写法），名称与插入位置两个勾选在折叠区外
// 用法：在仓库根目录 bash test/run-browser.sh（需要 test/site/zsx.json 和 8765 端口的静态服务）
import { chromium } from "playwright";
import { choose } from "./choose.mjs";
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const errs = []; page.on("pageerror", (e) => errs.push(e.message));
await page.goto("http://127.0.0.1:8765/test/site/index.html");
await page.waitForFunction(() => window.__mcdonalds?.open, null, { timeout: 15000 });
await page.evaluate(() => { window.SillyTavern.getContext().extensionSettings.mcdonalds.sutureLayout = "split"; }); // 2.12.16 窄屏缝合默认切换；这里测缝合流程，固定为分栏
const P = (id, name, content) => ({ identifier: id, name, content, role: "system", system_prompt: false, marker: false, injection_position: 0, injection_depth: 4, injection_order: 100 });
const prompts = [P("m-a", "🖋️白描", "<白描>\n只写动作和对白。\n</白描>"), P("m-b", "🖋️古风", "<古风>\n半文半白。\n</古风>"), P("m-c", "📌收尾", "结尾不要总结。"), P("m-d", "📌开场", "开场直接进入场景。")];
const F = { prompts, prompt_order: [{ character_id: 100001, order: prompts.map((p) => ({ identifier: p.identifier, enabled: true })) }] };
await page.evaluate((F) => { window.__mock.names.push("写法来源"); window.__mock.presets.push(F); window.__mcdonalds.open("suture"); }, F);
await page.waitForTimeout(400);
await choose(page, ".pa-dst-picker .pa-namebtn", "【众生相】Claude-Lite-v1.8"); await page.waitForTimeout(300);
await choose(page, ".pa-src-name", "写法来源"); await page.waitForTimeout(300);
for (const id of ["m-a", "m-b", "m-c", "m-d"]) await page.locator(`.pa-src-list [data-id="${id}"] .pa-name`).click();
await page.locator(".pa-dst-list .pa-ghead .pa-gname").first().click(); await page.waitForTimeout(250);
await page.click('[data-st="go"]'); await page.waitForTimeout(800);
const fail = [];
const check = (ok, msg) => { console.log(ok ? "✓" : "✗", msg); if (!ok) fail.push(msg); };
const state = () => page.evaluate(() => {
  const sec = document.querySelector(".pa-sheet [data-mode-sec]");
  const modes = [...document.querySelectorAll(".pa-sheet .pa-item")].map((a) => a.querySelector(".pa-item-sub").textContent.split(" · ")[0]);
  return { hidden: sec.hidden, n: sec.querySelector(".pa-modebar-n").textContent, hint: sec.querySelector("[data-mode-hint]").textContent, modes };
});
let s = await state();
check(!s.hidden && /^目标：/.test(s.hint), "有可选写法时显示写法一段：" + s.n + "｜" + s.hint);
// 2.12.20 分组、写法、注明来源收在「详情」抽屉里：默认收起，点开后两个勾选都看得见
check(await page.evaluate(() => document.querySelector(".pa-sheet [data-g=more]").getAttribute("aria-expanded") === "false" && document.querySelector(".pa-sheet .pa-target-card > .pa-acc > .pa-acc-in").inert), "详情默认收起");
await page.click(".pa-sheet [data-g=more]"); await page.waitForTimeout(350);
check(await page.evaluate(() => { const v = (sel) => { const x = document.querySelector(sel); return x && !x.closest("details:not([open])") && x.offsetParent !== null && getComputedStyle(x).visibility === "visible"; }; return v(".pa-sheet [data-g=inj]") && v(".pa-sheet [data-g=from]"); }), "点「详情」后两个勾选都在");
const fs0 = await page.evaluate(() => [getComputedStyle(document.querySelector(".pa-sheet [data-g=grp]") || document.body).fontSize, getComputedStyle(document.querySelector(".pa-sheet .pa-hint") || document.body).fontSize]);
await page.locator(".pa-sheet .pa-item-head").first().click(); await page.waitForTimeout(200);
const fsName = await page.evaluate(() => getComputedStyle(document.querySelector(".pa-sheet .pa-item [data-c=name]")).fontSize);
await page.locator(".pa-sheet .pa-item-head").first().click(); await page.waitForTimeout(200);
check(fs0[0] === fsName, `分组框字号 ${fs0[0]} 与条目名称框 ${fsName} 一致`);
await page.locator(".pa-sheet .pa-target-card").screenshot({ path: "test/shots/suture-mode-1.png" });
await page.click(".pa-sheet [data-g=mode-raw]"); await page.waitForTimeout(300);
s = await state();
check(s.modes.every((m) => m === "原样") && /按目标写法 0\//.test(s.n), "全部原样：" + s.n + " " + s.modes.join("、"));
await page.click(".pa-sheet [data-g=mode-fix]"); await page.waitForTimeout(300);
const s2 = await state();
check(/按目标写法 2\/2/.test(s2.n), "全部按目标写法：" + s2.n + " " + s2.modes.join("、"));
const idx = await page.locator(".pa-sheet .pa-item", { has: page.locator(".pa-item-sub", { hasText: "按目标写法" }) }).first().getAttribute("data-i");
const art = page.locator(`.pa-sheet .pa-item[data-i="${idx}"]`);
await art.locator(".pa-item-head").click(); await page.waitForTimeout(350);
await art.locator('[data-c=mode][value=raw]').check({ force: true }); await page.waitForTimeout(300);
const s3 = await state();
check(/按目标写法 1\/2/.test(s3.n), "逐条改一条后计数跟着变：" + s3.n);
// 只剩写法相同的条目：这一段仍显示，写明全部原样，切换按钮和勾选藏起
await page.locator(".pa-sheet-actions .pa-btn", { hasText: "取消" }).click(); await page.waitForTimeout(400);
for (const id of ["m-c", "m-d"]) await page.locator(`.pa-src-list [data-id="${id}"] .pa-name`).click();
await page.click('[data-st="go"]'); await page.waitForTimeout(800);
await page.click(".pa-sheet [data-g=more]"); await page.waitForTimeout(350);
const s4 = await page.evaluate(() => { const sec = document.querySelector(".pa-sheet [data-mode-sec]"); const vis = (x) => !!x && x.offsetParent !== null; return { sec: vis(sec), n: sec.querySelector(".pa-modebar-n").textContent, seg: vis(sec.querySelector(".pa-modebar .pa-seg")), inj: vis(sec.querySelector("[data-g=inj]")), sum: document.querySelector(".pa-sheet [data-tc-sum]").textContent, items: document.querySelectorAll(".pa-sheet .pa-item").length }; });
check(s4.items === 2 && s4.sec && /全部原样.*写法相同/.test(s4.n) && !s4.seg && !s4.inj && /原样（与目标一致）/.test(s4.sum), "没有可选写法时只写一行说明：" + JSON.stringify(s4));
await page.locator(".pa-sheet .pa-target-card").screenshot({ path: "test/shots/suture-mode-2.png" });
check(!errs.length, "无页面错误 " + errs.join(" | "));
await browser.close();
if (fail.length) process.exit(1);
