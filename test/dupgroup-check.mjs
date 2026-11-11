// 双层分组提示与修复。用法同 clean-check.mjs
import { chromium } from "playwright";
import { choose, chooseSrcType, chooseDstType } from "./choose.mjs";
import assert from "node:assert";
const S = new URL("./shots/", import.meta.url).pathname;
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
await page.goto("http://127.0.0.1:8765/test/site/index.html");
await page.waitForFunction(() => window.__presetAtelier?.open, null, { timeout: 15000 });
await page.evaluate(() => {
  const P = (id, name) => ({ identifier: id, name, content: name + "的内容", role: "system" });
  const p = { prompts: [P("a", "甲"), P("b", "乙"), P("c", "丙")], prompt_order: [{ character_id: 100001, order: ["a", "b", "c"].map((identifier) => ({ identifier, enabled: true })) }],
    extensions: { baibaiToolkit: { presetPromptGroups: { version: 1, groups: [{ id: "g1", name: "文风选择", order: 0 }], prompts: { a: { groupId: "g1" }, b: { groupId: "g1" } } } },
      entryGrouping: [{ id: "x1", name: "文风选择", startIdentifier: "a", endIdentifier: "b", mode: "inclusive" }] } };
  window.__mock.names.push("双层"); window.__mock.presets.push(p);
  window.__presetAtelier.open("organize");
});
await page.waitForTimeout(300);
await choose(page, ".pa-picker-slot .pa-namebtn", "双层");
await page.waitForTimeout(400);
assert.match(await page.$eval(".pa-list", (x) => x.innerText), /分组存了两份/);
await page.screenshot({ path: S + "d-1-banner.png" });
await page.click("[data-dup=fix]"); await page.waitForTimeout(1200);
assert.ok(!(await page.$("[data-dup=fix]")), "修复后提示消失");
const ext = await page.evaluate(() => window.__mock.presets[window.__mock.names.indexOf("双层")].extensions);
assert.ok(!ext.entryGrouping, "保存后没有重复的 entryGrouping");
assert.equal(ext.baibaiToolkit.presetPromptGroups.groups.length, 1, "百宝箱分组保留");
// 同 id 的旧镜像（成员比柏宝箱少）也算重复
const p2 = await page.evaluate(() => {
  const m = window.__mock, p = structuredClone(m.presets[m.names.indexOf("双层")]);
  p.extensions.entryGrouping = [{ id: "g1", name: "文风选择", memberIdentifiers: ["a"], mode: "inclusive" }];
  return p;
});
// 有别的扩展把旧分组写回来：记下是谁，重新打开时提示「又被写回来了」
await page.addScriptTag({ url: "/test/site/scripts/extensions/third-party/FakeGroupSync/index.js" });
await page.evaluate(async (p) => {
  await window.fakeGroupSyncWriteBack("双层", p);
  const m = window.__mock; m.presets[m.names.indexOf("双层")] = p;
}, p2);
await page.waitForTimeout(300);
const w = await page.evaluate(() => window.SillyTavern.getContext().extensionSettings.presetAtelier.mirrorWrites?.["双层"]);
assert.equal(w?.by, "FakeGroupSync", "记下写回旧分组的扩展");
await page.evaluate(() => { window.__presetAtelier.close?.(); });
await page.evaluate(() => window.__presetAtelier.open("organize")); await page.waitForTimeout(300);
await choose(page, ".pa-picker-slot .pa-namebtn", "双层"); await page.waitForTimeout(400);
const txt = await page.$eval(".pa-list", (x) => x.innerText);
assert.match(txt, /又被写回来了/);
assert.match(txt, /FakeGroupSync/);
assert.match(txt, /保留，不再提示/);
await page.screenshot({ path: S + "d-2-back.png" });
await page.click("[data-dup=fix]"); await page.waitForTimeout(1200);
assert.ok(!(await page.evaluate(() => window.__mock.presets[window.__mock.names.indexOf("双层")].extensions.entryGrouping)), "旧镜像也去掉");
console.log("✓ 同 id 旧镜像算重复；写回来时说明是哪个扩展");

// 它又写回来：选「保留，不再提示」后不再提示，之后保存也不再去掉它（不和它来回改）
await page.evaluate(async (p) => {
  await window.fakeGroupSyncWriteBack("双层", p);
  const m = window.__mock; m.presets[m.names.indexOf("双层")] = p;
}, p2);
await page.waitForTimeout(300);
await page.evaluate(() => { window.__presetAtelier.close?.(); });
await page.evaluate(() => window.__presetAtelier.open("organize")); await page.waitForTimeout(300);
await choose(page, ".pa-picker-slot .pa-namebtn", "双层"); await page.waitForTimeout(400);
await page.click("[data-dup=keep]"); await page.waitForTimeout(300);
assert.ok(!(await page.$(".pa-dupgroups")), "保留后不再提示");
await page.locator(".pa-row", { hasText: "丙" }).locator("[data-act=toggle]").click({ force: true }); await page.waitForTimeout(1500);
assert.ok(await page.evaluate(() => window.__mock.presets[window.__mock.names.indexOf("双层")].extensions.entryGrouping?.length === 1), "保存时保留 entryGrouping");
console.log("✓ 保留，不再提示：保存时也不再动它");

// 换聊天时弹小提示：预设和模型
await page.evaluate(async () => {
  window.__toasts = [];
  window.toastr = { info: (m, t, o) => window.__toasts.push({ m, t, o }), success() {}, warning() {}, error() {} };
  const c = window.SillyTavern.getContext();
  c.chatId = "c-new";
  await c.eventSource.emit("chat_changed", "c-new");
});
await page.waitForTimeout(1800);
const ts = await page.evaluate(() => window.__toasts);
assert.equal(ts.length, 1);
assert.match(ts[0].t, /^预设：/);
assert.match(ts[0].m, /模型：claude-x/);
assert.equal(ts[0].o.timeOut, 3000);
await page.evaluate(async () => { await window.SillyTavern.getContext().eventSource.emit("chat_changed", "c-new"); });
await page.waitForTimeout(1800);
assert.equal((await page.evaluate(() => window.__toasts)).length, 1, "同一个聊天不重复弹");
console.log("✓ 换聊天时弹出预设和模型提示");

assert.deepEqual(errs, []);
console.log("双层分组检查通过");
await browser.close();
