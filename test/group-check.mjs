// 装了百宝箱时建分组：百宝箱会用内存里的旧分组覆盖保存结果，新分组必须保存后仍然存在
// 用法：node test/group-check.mjs [预设名]，默认用仓库自带的众生相风格测试预设
import { chromium } from "playwright";
import { choose, chooseSrcType, chooseDstType } from "./choose.mjs";
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const errs = []; page.on("pageerror", (e) => errs.push(e.message));
await page.goto("http://127.0.0.1:8765/test/site/index.html");
await page.waitForFunction(() => window.__presetAtelier?.open, null, { timeout: 15000 });
const T = process.argv[2] || "【众生相】Claude-Lite-v1.8";
// 假柏宝箱：使用实际核对过的全局缓存字段；缓存不失效时会把旧分组写回。
await page.evaluate((T) => {
  const c = window.SillyTavern.getContext();
  c.extensionSettings.baiBaiToolkit = {};
  c.eventTypes.OAI_PRESET_IMPORT_READY = "oai_preset_import_ready";
  const m = window.__mock; const i = m.names.indexOf(T);
  m.live.preset_settings_openai = T; Object.assign(m.live, structuredClone(m.presets[i]));
  const state = window.__baiBaiToolkitExtensionInstalled = {
    presetPromptGroupRuntimePresetName: T,
    presetPromptGroupRuntimeState: structuredClone(m.live.extensions.baibaiToolkit.presetPromptGroups)
  };
  window.__autoImportCalls = 0;
  c.eventSource.on("oai_preset_import_ready", () => { window.__autoImportCalls++; });
  c.eventSource.on("oai_after", () => {
    if (state.presetPromptGroupRuntimeState) {
      for (const target of [m.live, m.presets[i]]) target.extensions.baibaiToolkit.presetPromptGroups = structuredClone(state.presetPromptGroupRuntimeState);
    } else {
      state.presetPromptGroupRuntimePresetName = T;
      state.presetPromptGroupRuntimeState = structuredClone(m.live.extensions.baibaiToolkit.presetPromptGroups);
      window.__bbReset = (window.__bbReset || 0) + 1;
    }
  });
  window.__presetAtelier.open("organize");
}, T);
await page.waitForTimeout(400);
await choose(page, ".pa-picker-slot .pa-namebtn", T); await page.waitForTimeout(300);
const groups = () => page.evaluate((t) => { const i = window.__mock.names.indexOf(t); return window.__mock.presets[i].extensions?.baibaiToolkit?.presetPromptGroups?.groups?.map((x) => x.name); }, T);
const fail = [];
const check = (ok, msg) => { console.log(ok ? "✓" : "✗", msg); if (!ok) fail.push(msg); };
console.log("before", JSON.stringify(await groups()));
// 整理页：展开第一个分组，点选两条 → 建成分组
await page.locator(".pa-list .pa-ghead .pa-gname").first().click(); await page.waitForTimeout(200);
await page.locator(".pa-list .pa-group").first().locator(".pa-row").nth(0).click();
await page.locator(".pa-list .pa-group").first().locator(".pa-row").nth(1).click();
await page.click('[data-sel="more"]'); await page.waitForTimeout(200);
await page.click(".pa-pick-item >> text=建成分组"); await page.waitForTimeout(300);
await page.fill(".pa-sheet input.pa-input", "新组测试"); await page.click(".pa-sheet .pa-btn-primary"); await page.waitForTimeout(2500);
check((await groups()).includes("新组测试"), "建成分组后保存仍在");
// 缝合页：新建空白分组
await page.evaluate(() => window.__presetAtelier.open("suture")); await page.waitForTimeout(300);
await page.click('[data-st="newgroup"]'); await page.waitForTimeout(300);
await page.fill(".pa-sheet input.pa-input", "空白组"); await page.click(".pa-sheet .pa-btn-primary"); await page.waitForTimeout(300);
await page.locator(".pa-dst-list .pa-ghead .pa-gname").first().click(); await page.waitForTimeout(2500);
check((await groups()).includes("空白组"), "新建空白分组后保存仍在");
check(await page.evaluate(() => window.__autoImportCalls === 0), "普通保存不触发导入自动迁移");
console.log("after", JSON.stringify(await groups()), "百宝箱刷新次数", await page.evaluate(() => window.__bbReset));
console.log(errs.length ? errs : "no page errors");
await browser.close();
if (fail.length || errs.length) process.exit(1);
