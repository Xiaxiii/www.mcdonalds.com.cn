import { chromium } from "playwright";
import { choose, chooseSrcType, chooseDstType } from "./choose.mjs";
const theme = process.argv[2] || "follow";
const out = (n) => `test/shots/${theme}-${n}.png`;
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errors.push(m.type() + ": " + m.text()); });
await page.goto("http://127.0.0.1:8765/test/site/index.html");
await page.waitForFunction(() => window.__presetAtelier?.open, null, { timeout: 15000 });
await page.evaluate((t) => { window.SillyTavern.getContext().extensionSettings.presetAtelier = { theme: t }; window.__presetAtelier.open(); }, theme);
await page.waitForTimeout(400);
await page.screenshot({ path: out("1-organize") });
// 缝合页
await page.evaluate(() => window.__presetAtelier.open("suture"));
await page.waitForTimeout(300);
await choose(page, ".pa-src-name", "Ako1.92-修复版");
await page.waitForTimeout(300);
await page.screenshot({ path: out("2-suture") });
// 展开来源里的 USER塑造 组，选两条嬷u
await page.evaluate(() => { for (const h of document.querySelectorAll(".pa-src-list .pa-ghead")) if (h.textContent.includes("USER塑造")) h.click(); });
await page.waitForTimeout(200);
await page.evaluate(() => { for (const r of document.querySelectorAll(".pa-src-list .pa-row")) if (/[嬷嬤]u·把玩|[嬷嬤]u·弱化u/.test(r.textContent)) r.click(); });
// 目标：缝进「写作指导」组末尾（展开后点组内最后一条）
await page.evaluate(() => { for (const h of document.querySelectorAll(".pa-dst-list .pa-ghead")) if (h.textContent.includes("写作指导")) h.querySelector('[data-act="collapse"]')?.click(); });
await page.waitForTimeout(200);
await page.evaluate(() => { for (const s of document.querySelectorAll(".pa-dst-list .pa-group")) if (s.querySelector(".pa-gname").textContent.includes("写作指导")) [...s.querySelectorAll(".pa-row")].pop()?.click(); });
await page.waitForTimeout(200);
await page.screenshot({ path: out("3-suture-picked") });
// 拖动分隔条
const sp = await page.locator(".pa-splitter").boundingBox();
await page.mouse.move(sp.x + sp.width / 2, sp.y + sp.height / 2); await page.mouse.down(); await page.mouse.move(sp.x + sp.width / 2, sp.y - 160, { steps: 5 }); await page.mouse.up();
await page.waitForTimeout(200);
await page.screenshot({ path: out("4-suture-dragged") });
await page.click('[data-st="go"]');
await page.waitForTimeout(500);
await page.screenshot({ path: out("5-review"), fullPage: false });
await page.evaluate(() => document.querySelector(".pa-sheet-body").scrollTop = 520);
await page.waitForTimeout(100);
await page.screenshot({ path: out("6-review-scrolled") });
await page.click(".pa-sheet-actions .pa-btn-primary");
await page.waitForTimeout(500);
await page.waitForTimeout(800);
const check = await page.evaluate(() => {
  const z = window.__mock.presets.at(-1);
  const cot = z.prompts.find((p) => p.name === "✨思维链：推演")?.content || "";
  return { saved: window.__saved || 0, hasEntry: z.prompts.some((p) => /[嬷嬤]u·弱化u/.test(p.name)), cotLine: cot.split("\n").find((l) => /娇弱体质/.test(l)) || null };
});
console.log("E2E:", JSON.stringify(check));
await page.screenshot({ path: out("7-after-stitch") });
await page.click(".pa-sheet-actions .pa-btn-primary").catch(() => {});
await page.waitForTimeout(200);
await page.click('[data-tab="cot"]');
await page.waitForTimeout(400);
await page.screenshot({ path: out("9-cot") });
await page.evaluate(() => window.__presetAtelier.open("look"));
await page.waitForTimeout(300);
await page.screenshot({ path: out("10-more") });

await page.waitForTimeout(200);
await page.screenshot({ path: out("11-look") });
console.log(errors.join("\n") || "no errors");
await browser.close();
