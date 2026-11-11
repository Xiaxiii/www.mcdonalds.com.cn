// 1.8.0 数据安全相关的端到端检查：保存冲突、草稿恢复、备份失败、编辑可取消、叠加弹窗的 Esc、整组开关。
// 用法：在仓库根目录起静态服务（python3 -m http.server 8765）；node test/safety-check.mjs
import { chromium } from "playwright";
import assert from "node:assert";
import { expandAll } from "./choose.mjs";
const exe = process.env.PW_CHROME || undefined;
const browser = await chromium.launch({ executablePath: exe });
const URL0 = "http://127.0.0.1:8765/test/site/index.html";
const ok = (m) => console.log("✓", m);

async function boot(ctx, init) {
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  if (init) await page.addInitScript(init);
  await page.goto(URL0);
  await page.waitForFunction(() => window.__presetAtelier?.open, null, { timeout: 15000 });
  return { page, errs };
}
const sheetTitle = (page) => page.$eval(".pa-sheet-mask:last-child .pa-sheet-head b", (x) => x.textContent).catch(() => null);
const savedCount = (page) => page.evaluate(() => window.__saved || 0);
const firstToggle = ".pa-list .pa-loose .pa-row .pa-switch, .pa-list .pa-group .pa-row .pa-switch";

// ---- 1) 保存冲突：别处改过就暂停自动保存，由用户选择
{
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 900 }, acceptDownloads: true });
  const { page, errs } = await boot(ctx);
  await page.evaluate(() => window.__presetAtelier.open("organize"));
  await page.waitForTimeout(400);
  await expandAll(page);
  await page.locator(firstToggle).first().click(); await page.waitForTimeout(900);
  const n1 = await savedCount(page);
  assert.ok(n1 >= 1, "第一次修改自动保存");
  // 别处（酒馆里）改了这个预设
  await page.evaluate(() => { window.__mock.live.prompts[0].content += "（在酒馆里改的）"; });
  await page.locator(firstToggle).nth(1).click(); await page.waitForTimeout(900);
  assert.equal(await savedCount(page), n1, "别处改过时不再写入");
  assert.equal(await sheetTitle(page), "预设在别处被修改过");
  assert.match(await page.$eval(".pa-dirty-text", (x) => x.textContent), /已暂停保存/);
  // 关掉弹窗：继续暂停，再改也不写
  await page.click(".pa-sheet-mask:last-child .pa-sheet-x"); await page.waitForTimeout(300);
  await page.locator(firstToggle).nth(2).click(); await page.waitForTimeout(900);
  assert.equal(await savedCount(page), n1, "暂停期间不自动保存");
  // 顶栏「处理」→ 用我的修改覆盖
  await page.click("[data-g=save]"); await page.waitForTimeout(300);
  await page.click(".pa-sheet-mask:last-child .pa-btn-primary"); await page.waitForTimeout(900);
  assert.ok(await savedCount(page) > n1, "选择覆盖后写入");
  assert.ok(!(await page.$eval(".pa-dirty-text", (x) => x.textContent)).includes("暂停"));
  assert.deepEqual(errs, []);
  ok("别处改过时暂停自动保存，用户选择覆盖后才写入");
  await ctx.close();
}

// ---- 2) 重载后发现草稿，但服务器上的预设之后变过：先问，不自动覆盖
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const { page, errs } = await boot(ctx);
  const name = await page.evaluate(() => window.__mock.live.preset_settings_openai);
  await page.evaluate((name) => {
    const p = structuredClone(window.__mock.presets[window.__mock.names.indexOf(name)]);
    p.prompts[0].content = "草稿里的内容";
    localStorage.setItem(`presetAtelier:recovery:v180:default-user:${name}`, JSON.stringify({ preset: p, baseSig: "别的版本", time: Date.now() }));
  }, name);
  const before = await savedCount(page);
  await page.evaluate(() => window.__presetAtelier.open("organize"));
  await page.waitForTimeout(900);
  assert.equal(await sheetTitle(page), "发现未保存的草稿");
  assert.equal(await savedCount(page), before, "没有自动写入");
  await page.click(".pa-sheet-mask:last-child .pa-btn-danger"); await page.waitForTimeout(300);
  assert.equal(await page.evaluate((name) => localStorage.getItem(`presetAtelier:recovery:v180:default-user:${name}`), name), null, "丢弃后清掉草稿");
  assert.deepEqual(errs, []);
  ok("草稿基于旧版本时先询问，不自动覆盖");
  await ctx.close();
}

// ---- 3) 备份失败：不写入，由用户选择
{
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 900 }, acceptDownloads: true });
  const breakIdb = () => { const real = indexedDB.open.bind(indexedDB); indexedDB.open = (name, v) => { if (name === "preset-atelier") throw new Error("存储已满"); return real(name, v); }; };
  const { page } = await boot(ctx, breakIdb);
  await page.evaluate(() => window.__presetAtelier.open("organize"));
  await page.waitForTimeout(400);
  await expandAll(page);
  const before = await savedCount(page);
  await page.locator(firstToggle).first().click(); await page.waitForTimeout(900);
  assert.equal(await savedCount(page), before, "备份失败时不写入");
  assert.equal(await sheetTitle(page), "自动备份失败");
  const dl = page.waitForEvent("download");
  await page.click(".pa-sheet-mask:last-child .pa-btn-primary");
  await dl; // 测试用的无头浏览器会把中文文件名换成 download，这里只确认有下载
  await page.waitForTimeout(800);
  assert.ok(await savedCount(page) > before, "下载修改前的版本后保存");
  ok("备份失败时不写入，下载修改前的版本后才保存");
  await ctx.close();
}

// ---- 3b) 2.4.2 关闭自动备份：不碰备份库，直接保存
{
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 900 } });
  const breakIdb = () => { const real = indexedDB.open.bind(indexedDB); indexedDB.open = (name, v) => { if (name === "preset-atelier") throw new Error("存储已满"); return real(name, v); }; };
  const { page, errs } = await boot(ctx, breakIdb);
  await page.evaluate(() => { const c = window.SillyTavern.getContext(); c.extensionSettings.presetAtelier = { ...(c.extensionSettings.presetAtelier || {}), autoBackup: false }; window.__presetAtelier.open("organize"); });
  await page.waitForTimeout(400);
  await expandAll(page);
  const before = await savedCount(page);
  await page.locator(firstToggle).first().click(); await page.waitForTimeout(900);
  assert.ok(await savedCount(page) > before, "关闭自动备份后直接保存");
  assert.equal(await sheetTitle(page), null, "不弹备份失败");
  assert.deepEqual(errs, []);
  ok("关闭自动备份后不备份、直接保存");
  await ctx.close();
}

// ---- 4) 编辑条目点取消不改动；叠着的弹窗按 Esc 只关最上面一个；分组开关保留条目
{
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 900 } });
  const { page, errs } = await boot(ctx);
  await page.evaluate(() => window.__presetAtelier.open("organize"));
  await page.waitForTimeout(400);
  await expandAll(page);
  const row = page.locator(".pa-list .pa-row").first();
  const id = await row.getAttribute("data-id");
  const content0 = await page.evaluate((id) => window.__mock.live.prompts.find((p) => p.identifier === id)?.content, id);
  await row.locator("[data-act=peek]").click(); await page.waitForTimeout(200);
  await page.fill(".pa-editpane [data-f=content]", "随便改改");
  await page.waitForTimeout(600);
  await page.click('.pa-editpane [data-ep="close"]'); await page.waitForTimeout(600);
  const content1 = await page.evaluate((id) => window.__mock.live.prompts.find((p) => p.identifier === id)?.content, id);
  assert.equal(content1, content0, "取消后正文不变");
  ok("编辑条目点取消不改动");
  // 叠加弹窗：分组菜单 → 重命名输入框，按 Esc 只关重命名
  const gm = page.locator(".pa-list .pa-group [data-act=gmenu]").first();
  if (await gm.count()) {
    await gm.click(); await page.waitForTimeout(200);
    await page.keyboard.press("Escape"); await page.waitForTimeout(250);
    assert.equal(await page.$$eval(".pa-sheet-mask", (x) => x.length), 0);
    await gm.click(); await page.waitForTimeout(200);
    await page.click(".pa-pick-item >> text=重命名"); await page.waitForTimeout(250);
    // 重命名弹窗里按 Esc：只关它（嵌套弹窗的情况见第 5 段）
    await page.evaluate(() => { document.querySelector(".pa-sheet input").value = "改名中"; });
    const n0 = await page.$$eval(".pa-sheet-mask", (x) => x.length);
    await page.keyboard.press("Escape"); await page.waitForTimeout(250);
    assert.equal(await page.$$eval(".pa-sheet-mask", (x) => x.length), n0 - 1, "Esc 只关最上面一个");
    ok("Esc 只关最上面的弹窗");
    // 分组开关只改分组标记，内部选择始终不变。
    const g = page.locator(".pa-list .pa-group:not(.pa-gempty-box)").first();
    const selection = () => g.locator('.pa-row [data-act=toggle]').evaluateAll(xs => xs.map(x => x.checked));
    const before = await selection();
    await g.locator(".pa-switch-s").click(); await page.waitForTimeout(400);
    assert.equal(await g.locator('[data-act=gtoggle]').isChecked(), false);
    assert.deepEqual(await selection(), before, "关闭分组后内部选择不变");
    await g.locator(".pa-switch-s").click(); await page.waitForTimeout(400);
    assert.equal(await g.locator('[data-act=gtoggle]').isChecked(), true);
    assert.deepEqual(await selection(), before, "开启分组后内部选择不变");
    ok("分组开关保留内部条目选择");
  }
  // 没有弹窗时 Esc 关闭面板
  await page.keyboard.press("Escape"); await page.waitForTimeout(400);
  assert.ok(await page.$eval("#pa-root", (x) => x.hidden), "Esc 关闭面板");
  ok("Esc 关闭面板");
  assert.deepEqual(errs, []);
  await ctx.close();
}

// ---- 5) 添加站点：新密钥存进密钥库后，切回原来在用的那把；取消时删掉刚存的密钥；写入失败不当成功
{
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 900 } });
  const { page, errs } = await boot(ctx);
  await page.route("**/api/backends/chat-completions/status", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: [{ id: "m1" }, { id: "m2" }] }) }));
  const state = () => page.evaluate(async () => (await import("/test/site/scripts/secrets.js")).secret_state.api_key_custom.map((s) => `${s.id}${s.active ? "*" : ""}`).join(","));
  await page.evaluate(async () => { (await import("/test/site/scripts/secrets.js")).secret_state.api_key_custom.push({ id: "old", value: "old", active: true }); });
  await page.evaluate(() => window.__presetAtelier.open("conn"));
  await page.waitForTimeout(500);
  // 保存一个带新密钥的站点
  await page.click("[data-a=new]"); await page.waitForTimeout(200);
  await page.fill(".pa-sheet [data-f=name]", "新站");
  await page.fill(".pa-sheet [data-f=url]", "https://new.example/v1");
  await page.fill(".pa-sheet [data-f=key]", "sk-new-123456789");
  await page.click(".pa-sheet-actions .pa-btn-primary"); await page.waitForTimeout(400);
  assert.equal(await state(), "old*,id1", "保存后仍用原来的密钥");
  ok("添加站点不换掉正在用的密钥");
  // 取消：获取模型列表时存进去的密钥被删掉
  await page.click("[data-a=new]"); await page.waitForTimeout(200);
  await page.fill(".pa-sheet [data-f=name]", "试试");
  await page.fill(".pa-sheet [data-f=url]", "https://try.example/v1");
  await page.fill(".pa-sheet [data-f=key]", "sk-try-123456789");
  await page.click(".pa-sheet [data-f=fetch]"); await page.waitForTimeout(600);
  await page.keyboard.press("Escape"); await page.waitForTimeout(250); // 关掉模型选择
  assert.equal(await page.$$eval(".pa-sheet-mask", (x) => x.length), 1, "Esc 只关了模型选择，站点编辑还在");
  await page.click(".pa-sheet-actions >> text=取消"); await page.waitForTimeout(400);
  assert.equal(await state(), "old*,id1", "取消后刚存的密钥被删掉，仍用原来的");
  ok("取消添加时删掉刚存的密钥；Esc 只关最上面的弹窗");
  // 写入失败：不保存站点
  await page.evaluate(() => { globalThis.__secretWriteFails = true; });
  const sites0 = await page.evaluate(() => window.SillyTavern.getContext().extensionSettings.presetAtelier.sites.length);
  await page.click("[data-a=new]"); await page.waitForTimeout(200);
  await page.fill(".pa-sheet [data-f=name]", "失败站");
  await page.fill(".pa-sheet [data-f=url]", "https://bad.example/v1");
  await page.fill(".pa-sheet [data-f=key]", "sk-bad-123456789");
  await page.click(".pa-sheet-actions .pa-btn-primary"); await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => window.SillyTavern.getContext().extensionSettings.presetAtelier.sites.length), sites0, "密钥没存上时不保存站点");
  ok("密钥写入失败时不保存站点");
  assert.deepEqual(errs, []);
  await ctx.close();
}

await browser.close();
console.log("数据安全检查全部通过");
