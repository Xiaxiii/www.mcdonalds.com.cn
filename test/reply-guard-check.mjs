// 正文格式检查的 UI 与宿主提示接口回归。先构建并在仓库根目录运行 8765 静态服务。
// 用法：PW_CHROME=/usr/bin/chromium node test/reply-guard-check.mjs
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { choose } from './choose.mjs';
const URL = process.env.PA_TEST_URL || 'http://127.0.0.1:8765/test/site/index.html';
const KEY = 'presetAtelier:reply-format';
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const errors = [];
const ok = (message) => console.log('✓', message);
async function openPage({ interfaces = true, mobile = false } = {}) {
  const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1100, height: 900 }, isMobile: mobile, hasTouch: mobile });
  page.on('pageerror', (error) => errors.push(error.message));
  if (interfaces) await page.addInitScript(() => {
    let host;
    Object.defineProperty(window, 'SillyTavern', {
      configurable: true,
      get: () => host,
      set(value) {
        host = value;
        const context = value.getContext();
        context.eventTypes.GENERATION_AFTER_COMMANDS = 'generation_after_commands';
        window.__replyCalls = [];
        window.__replyPrompts = {};
        context.setExtensionPrompt = (...args) => {
          window.__replyCalls.push(args);
          window.__replyPrompts[args[0]] = args[1];
        };
      }
    });
  });
  await page.goto(URL);
  await page.waitForFunction(() => window.__presetAtelier?.open, null, { timeout: 15000 });
  await page.evaluate(() => window.__presetAtelier.open('cot'));
  return page;
}
// 2.8.1 正文格式检查在「检查 → 回复」单页；设置改动即保存（离开输入框、点勾选框时）
// 用导航切换（open() 会把查看的预设换回酒馆当前预设）
const tab = async (page) => { await page.click('.pa-tabs [data-nav="check"]'); await page.click('.pa-subnav [data-tab="reply"]'); await page.waitForTimeout(80); };
const dialog = async (page) => { await tab(page, 'check'); await page.locator('[data-page=reply] [data-r=latest]').waitFor({ state: 'visible' }); };
const close = async (page, save = false) => {
  if (save) { await page.evaluate(() => document.activeElement?.blur?.()); await page.waitForTimeout(150); }
  await page.click('.pa-tabs [data-nav="preset"]');
};
const settings = (page) => page.evaluate(() => window.SillyTavern.getContext().extensionSettings.presetAtelier.replyGuard);
const reminder = (page) => page.evaluate((key) => window.__replyPrompts[key] || '', KEY);
const generate = (page, type = 'normal', dryRun = false) => page.evaluate(async ({ type, dryRun }) => {
  const c = window.SillyTavern.getContext();
  await c.eventSource.emit(c.eventTypes.GENERATION_AFTER_COMMANDS, type, {}, dryRun);
}, { type, dryRun });
const reply = (page, text) => page.evaluate((text) => {
  window.SillyTavern.getContext().chat = [{ is_user: false, mes: '开场白' }, { is_user: true, mes: '继续故事' }, { is_user: false, mes: text, extra: { reasoning: '模型单独返回的推理字段' } }];
}, text);
try {
  const page = await openPage();
  const active = await page.evaluate(() => window.__mock.live.preset_settings_openai);
  const original = await page.evaluate(() => ({ chat: JSON.stringify(window.SillyTavern.getContext().chat), presets: JSON.stringify(window.__mock.presets), saves: window.__saved || 0 }));
  await generate(page);
  assert.equal(await reminder(page), '');
  assert.deepEqual(await settings(page), {});
  await dialog(page);
  await tab(page, 'auto');
  assert.equal(await page.locator('[data-r=enabled]').isChecked(), false);
  assert.equal(await page.locator('[data-r=enabled]').isDisabled(), false);
  await tab(page, 'check');
  await page.click('[data-r=latest]');
  assert.match(await page.locator('[data-r=result]').innerText(), /缺少完整的 <content>/);
  await page.fill('[data-r=sample]', '<content>正文<think>内部分析</think></content>');
  await page.click('[data-r=paste]');
  assert.match(await page.locator('[data-r=result]').innerText(), /正文内部出现/);
  await page.fill('[data-r=sample]', '<think><content>正文</content></think>');
  await page.click('[data-r=paste]');
  assert.match(await page.locator('[data-r=result]').innerText(), /吞入思考区/);
  await close(page);
  assert.deepEqual(await settings(page), {});
  assert.equal(await page.evaluate(() => JSON.stringify(window.SillyTavern.getContext().chat)), original.chat);
  ok('默认关闭，手检发现掉标签、思考夹入正文和正文被吞；取消不保存、不修改聊天');

  await tab(page, 'rules');
  await page.fill('[data-r=body]', '正文');
  await page.fill('[data-r=required]', '摘要，状态、摘要');
  await page.fill('[data-r=thinking]', '分析区');
  await tab(page, 'check');
  await page.fill('[data-r=sample]', '<分析区>内部文字</分析区><正文>故事正文</正文><摘要>概述</摘要><状态>晴</状态>');
  await page.click('[data-r=paste]');
  assert.match(await page.locator('[data-r=result]').innerText(), /未发现配置范围内的格式问题/);
  await tab(page, 'rules');
  await page.fill('[data-r=body]', '<1非法>');
  await page.locator('[data-page=reply] [data-r=body]').dispatchEvent('change');
  assert.match(await page.locator('[data-page=reply] [data-err=body]').innerText(), /标签名/, '报错写在正文标签框下面');
  assert.equal((await settings(page))[active].bodyTag, '正文', '非法标签不保存');
  await page.fill('[data-r=body]', '正文');
  await tab(page, 'auto');
  await page.check('[data-r=enabled]');
  await tab(page, 'check');
  await page.fill('[data-r=sample]', '仅供手检的未保存样本');
  await close(page, true);
  assert.deepEqual((await settings(page))[active], { bodyTag: '正文', requiredTags: ['摘要', '状态'], thinkingTag: '分析区', enabled: true });
  assert.equal(JSON.stringify(await settings(page)).includes('仅供手检'), false);
  assert.equal(await page.evaluate(() => JSON.stringify(window.__mock.presets)), original.presets);
  assert.equal(await page.evaluate(() => window.__saved || 0), original.saves);
  ok('支持自定义正文、必需和思考标签；改动即保存，非法标签不保存，样本不持久化，预设不改动');

  // 2.8.2 必需标签要在当前对话用到才检查：写进全局启用的世界书，改世界书后重读
  await page.evaluate(async () => {
    globalThis.__wiStore['示例世界书'].entries[9] = { uid: 9, comment: '格式', content: '正文后输出 <摘要>概述</摘要> 和 <状态>天气</状态>。', disable: false, key: [], constant: true };
    const c = window.SillyTavern.getContext();
    await c.eventSource.emit(c.eventTypes.CHAT_CHANGED);
  });
  await reply(page, '本轮丢标签');
  await generate(page);
  assert.match(await reminder(page), /<正文>…<\/正文>/);
  assert.match(await reminder(page), /<摘要>…<\/摘要>/);
  assert.deepEqual(await page.evaluate(() => window.__replyCalls.at(-1).slice(2)), [1, 0, false, 0]);
  await reply(page, '<分析区><正文>正文</正文><摘要>概述</摘要><状态>晴</状态></分析区>');
  await generate(page); assert.ok(await reminder(page));
  await reply(page, '<正文>正常正文</正文><摘要>概述</摘要><状态>晴</状态>');
  await generate(page); assert.equal(await reminder(page), '');
  for (const type of ['quiet', 'impersonate', 'first_message', 'continue']) {
    await reply(page, '坏回复'); await generate(page); assert.ok(await reminder(page));
    await generate(page, type); assert.equal(await reminder(page), '');
  }
  await generate(page); assert.ok(await reminder(page));
  await generate(page, 'normal', true); assert.equal(await reminder(page), '');
  for (const event of ['CHAT_CHANGED', 'PRESET_CHANGED', 'GENERATION_ENDED', 'GENERATION_STOPPED']) {
    await generate(page); assert.ok(await reminder(page));
    await page.evaluate(async (event) => { const c = window.SillyTavern.getContext(); await c.eventSource.emit(c.eventTypes[event]); }, event);
    assert.equal(await reminder(page), '', event);
  }
  ok('生成前只在异常时注入；正常回复、特殊生成及聊天/预设/完成/停止事件清空提醒');

  const second = '正文检查测试预设';
  await page.evaluate((name) => {
    window.__mock.names.push(name);
    window.__mock.presets.push(structuredClone(window.__mock.presets[0]));
    window.__presetAtelier.open('cot');
  }, second);
  await choose(page, '.pa-picker-slot:visible .pa-namebtn', second);
  await dialog(page);
  await tab(page, 'rules');
  assert.equal(await page.locator('[data-r=body]').inputValue(), 'content');
  await tab(page, 'auto');
  assert.equal(await page.locator('[data-r=enabled]').isChecked(), false);
  await close(page, true);
  assert.equal((await settings(page))[second]?.enabled ?? false, false, '只浏览其他预设不写入');
  assert.equal((await settings(page))[active].bodyTag, '正文');
  await reply(page, '坏回复'); await generate(page);
  assert.match(await reminder(page), /<正文>/, '浏览其他预设设置不会替换实际使用中预设的规则');
  await page.evaluate(async (name) => {
    const c = window.SillyTavern.getContext();
    await c.getPresetManager().selectPreset(window.__mock.names.indexOf(name));
    await c.eventSource.emit(c.eventTypes.PRESET_CHANGED, { apiId: 'openai' });
  }, second);
  await generate(page); assert.equal(await reminder(page), '');
  ok('规则按预设保存，自动提醒跟随酒馆实际使用的预设');

  const fallback = await openPage({ interfaces: false });
  await dialog(fallback);
  await tab(fallback, 'auto');
  assert.equal(await fallback.locator('[data-r=enabled]').isDisabled(), true);
  assert.match(await fallback.locator('[data-page=reply]').innerText(), /手动检测可用，自动提醒不可用/);
  await tab(fallback, 'check');
  await fallback.click('[data-r=latest]');
  assert.match(await fallback.locator('[data-r=result]').innerText(), /发现 \d+ 个格式风险/);
  await fallback.evaluate(() => { window.SillyTavern.getContext().chat = [{ is_user: false, mes: '开场白' }, { is_system: true, mes: '系统' }, { is_user: true, mes: '用户' }]; });
  await fallback.click('[data-r=latest]');
  assert.match(await fallback.locator('[data-r=result]').innerText(), /没有可检查的 AI 回复/);
  await fallback.fill('[data-r=sample]', '<content>手检正常</content>');
  await fallback.click('[data-r=paste]');
  assert.match(await fallback.locator('[data-r=result]').innerText(), /未发现配置范围内的格式问题/);
  await close(fallback, true);
  assert.equal(Object.values((await settings(fallback)) || {})[0]?.enabled ?? false, false);
  ok('缺少宿主接口时禁用自动提醒，最近回复与粘贴手检仍可用');

  const mobile = await openPage({ mobile: true });
  await dialog(mobile);
  const layout = await mobile.locator('[data-page=reply] .pa-scroll').evaluate((sheet) => {
    const rect = sheet.getBoundingClientRect();
    return { width: innerWidth, left: rect.left, right: rect.right, overflow: sheet.scrollWidth > sheet.clientWidth + 2, fields: [...sheet.querySelectorAll('input:not([type=checkbox]),textarea')].map((field) => { const r = field.getBoundingClientRect(); return { left: r.left, right: r.right }; }) };
  });
  assert.ok(layout.left >= -1 && layout.right <= layout.width + 1);
  assert.equal(layout.overflow, false);
  assert.ok(layout.fields.every((field) => field.left >= -1 && field.right <= layout.width + 1));
  assert.equal(await mobile.locator('[data-r=latest]').isVisible(), true, '移动端可使用最近回复检测');
  assert.equal(await mobile.locator('[data-r=paste]').isVisible(), true, '移动端可使用粘贴检测');
  await mobile.fill('[data-r=sample]', '<content>移动端正文</content>');
  await mobile.click('[data-r=paste]');
  assert.match(await mobile.locator('[data-r=result]').innerText(), /未发现配置范围内的格式问题/);
  await close(mobile, true);
  ok('390px 移动端回复页、字段与操作无横向溢出');
  assert.deepEqual(errors, []);
  console.log('正文格式检查浏览器回归全部通过');
} finally {
  await browser.close();
}
