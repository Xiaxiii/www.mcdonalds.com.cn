// 1.9.0 阶段 A 修复的端到端检查：保存中删除不复活（FIX-12）、方案「使用中」与实际一致（FIX-07）、
// 本地密钥重新存进密钥库后记下编号（FIX-09）、只清当前账号的草稿（FIX-01）。用法同 clean-check.mjs
import { chromium } from "playwright";
import assert from "node:assert";
import { expandAll } from "./choose.mjs";
const exe = process.env.PW_CHROME || undefined;
const browser = await chromium.launch({ executablePath: exe });
const ok = (m) => console.log("✓", m);

async function boot(ctx) {
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto("http://127.0.0.1:8765/test/site/index.html");
  await page.waitForFunction(() => window.__presetAtelier?.open, null, { timeout: 15000 });
  return { page, errs };
}

// ---- 1) FIX-12：自动保存还在路上时删除预设，删除要等保存结束，删完不会被写回
{
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 900 } });
  const { page, errs } = await boot(ctx);
  const log = [];
  await page.exposeFunction("__log", (x) => log.push(x));
  await page.route("**/api/presets/delete", (r) => { log.push("delete"); r.fulfill({ status: 200, body: "" }); });
  await page.evaluate(() => {
    const m = window.__mock;
    const a = m.names[m.names.length - 1];
    m.names.push("乙预设");
    m.presets.push({ prompts: [{ identifier: "z", name: "乙", content: "另一个预设，内容和甲完全不同，独立存在。" }], prompt_order: [] });
    const c = window.SillyTavern.getContext();
    const base = c.getPresetManager();
    const map = Object.fromEntries(m.names.map((n, i) => [n, i]));
    c.getRequestHeaders = () => ({ "Content-Type": "application/json" });
    c.getPresetManager = () => ({
      ...base,
      getPresetList: () => ({ presets: m.presets, preset_names: map }),
      // 慢网：保存要 2.5 秒
      savePreset: async (name) => { window.__log("save-start:" + name); await new Promise((r) => setTimeout(r, 2500)); window.__log("save-end:" + name); }
    });
    window.__nameA = a;
  });
  const nameA = await page.evaluate(() => window.__nameA);
  await page.evaluate(() => window.__presetAtelier.open("organize"));
  await page.waitForTimeout(400);
  await expandAll(page);
  await page.locator(".pa-list .pa-row .pa-switch").first().click();
  await page.waitForTimeout(600); // 自动保存已发出，还没回来
  assert.ok(log.includes("save-start:" + nameA) && !log.includes("save-end:" + nameA), "保存正在进行");
  // 用户在酒馆里换到了别的预设，再去清理页删除甲
  await page.evaluate(() => { window.__mock.live.preset_settings_openai = "乙预设"; window.__presetAtelier.open("clean"); });
  await page.waitForTimeout(300);
  await page.click('[data-f="all"]'); await page.waitForTimeout(200);
  await page.click(`.pa-crow:has-text("${nameA}") input[data-c=pick]`);
  await page.click('[data-c="del"]'); await page.waitForTimeout(200);
  // 备份不强制：弹窗里有「下载备份」，不点就直接删
  assert.ok(await page.$('.pa-sheet button:has-text("下载备份")'));
  await page.click(".pa-sheet .pa-btn-danger");
  await page.waitForTimeout(3500);
  assert.deepEqual(log.filter((x) => x === "delete" || x.endsWith(nameA)), ["save-start:" + nameA, "save-end:" + nameA, "delete"], "保存结束后才删除");
  await page.waitForTimeout(800);
  assert.ok(!log.slice(log.indexOf("delete")).some((x) => x.startsWith("save-start")), "删除之后没有再保存");
  assert.deepEqual(errs, []);
  ok("保存还在进行时删除：等保存结束再删，删完不会被写回");
  await ctx.close();
}

// ---- 2) FIX-07：开关一致但 API 站点不是方案记的，标「开关一致」而不是「使用中」
{
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 900 } });
  const { page, errs } = await boot(ctx);
  await page.evaluate(() => {
    const m = window.__mock;
    const c = window.SillyTavern.getContext();
    c.extensionSettings.presetAtelier = {
      sites: [{ id: "s-oai", name: "官方", source: "openai", url: "", model: "gpt-x" }],
      schemes: [
        { id: "k1", name: "记着别的站点", preset: m.live.preset_settings_openai, scope: "all", states: {}, groupStates: {}, siteId: "s-oai" },
        { id: "k2", name: "只记开关", preset: m.live.preset_settings_openai, scope: "all", states: {}, groupStates: {} }
      ],
    };
    window.__presetAtelier.open("schemes");
  });
  await page.waitForTimeout(500);
  const card = (n) => page.$eval(`.pa-srow:has-text("${n}") .pa-srow-main`, (x) => x.innerText);
  assert.match(await card("记着别的站点"), /开关一致/);
  assert.doesNotMatch(await card("记着别的站点"), /使用中/);
  assert.match(await card("只记开关"), /使用中/);
  assert.deepEqual(errs, []);
  ok("方案「使用中」要求预设、人设、站点都对得上");
  await ctx.close();
}

// ---- 3) FIX-09：站点的密钥在密钥库里没了、本地还有时，重新存进去一次并记下编号，再连接不会再存一把
{
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 900 } });
  const { page, errs } = await boot(ctx);
  await page.evaluate(() => {
    const c = window.SillyTavern.getContext();
    c.extensionSettings.presetAtelier = {
      sites: [{ id: "s1", name: "中转甲", source: "custom", url: "https://a.example/v1", model: "m1", secretId: "gone", localKey: true }, { id: "s2", name: "中转乙", source: "custom", url: "https://b.example/v1", model: "m2" }],
      activeSiteId: "s2"
    };
    localStorage.setItem("presetAtelier:key:default-user:s1", "sk-local-key-123");
    window.__presetAtelier.open("conn");
  });
  await page.waitForTimeout(400);
  const vault = () => page.evaluate(async () => (await import("/test/site/scripts/secrets.js")).secret_state.api_key_custom.length);
  const before = await vault();
  for (let i = 0; i < 2; i++) {
    await page.evaluate(() => { window.SillyTavern.getContext().extensionSettings.presetAtelier.activeSiteId = "s2"; window.__presetAtelier.open("conn"); });
    await page.waitForTimeout(300);
    await page.click('.pa-site:has-text("中转甲") [data-a="use"]');
    await page.waitForTimeout(1500);
  }
  assert.equal(await vault(), before + 1, "只存进去一次");
  assert.notEqual(await page.evaluate(() => window.SillyTavern.getContext().extensionSettings.presetAtelier.sites[0].secretId), "gone");
  assert.deepEqual(errs, []);
  ok("本地密钥重新存进密钥库后记下编号，不重复存");
  await ctx.close();
}

// ---- 4) FIX-01：存储写满时只清当前账号的旧草稿，别的账号的留着
{
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 900 } });
  const { page, errs } = await boot(ctx);
  const otherKey = "presetAtelier:recovery:v180:别的账号:某预设";
  const mineKey = "presetAtelier:recovery:v180:default-user:旧预设";
  await page.evaluate(([o, m]) => {
    localStorage.setItem(o, JSON.stringify({ preset: { prompts: [] }, time: 1 }));
    localStorage.setItem(m, JSON.stringify({ preset: { prompts: [] }, time: 1 }));
    // 第一次写草稿时假装写满
    const real = Storage.prototype.setItem;
    let failed = false;
    Storage.prototype.setItem = function (k, v) {
      if (!failed && String(k).startsWith("presetAtelier:recovery:v180:default-user:") && k !== m) { failed = true; throw new DOMException("full", "QuotaExceededError"); }
      return real.call(this, k, v);
    };
    window.__presetAtelier.open("organize");
  }, [otherKey, mineKey]);
  await page.waitForTimeout(400);
  await expandAll(page);
  await page.locator(".pa-list .pa-row .pa-switch").first().click();
  // 单次修改不再立刻整份写草稿（等自动保存）；关页面/切后台时才写，这里模拟关页面
  assert.equal(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("presetAtelier:recovery:v180:default-user:") && !k.endsWith(":旧预设")).length), 0, "点一下开关不立刻写整份草稿");
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await page.waitForTimeout(200);
  const left = await page.evaluate(([o, m]) => [localStorage.getItem(o) !== null, localStorage.getItem(m) !== null], [otherKey, mineKey]);
  assert.deepEqual(left, [true, false], "别的账号的草稿保留，当前账号的旧草稿清掉");
  assert.deepEqual(errs, []);
  ok("存储写满时只清当前账号的旧草稿");
  await ctx.close();
}

console.log("阶段 A 修复检查全部通过");
await browser.close();
