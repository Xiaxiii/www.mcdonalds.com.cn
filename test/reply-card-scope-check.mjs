// 2.8.2 必需标签按角色卡生效：一套预设配几张卡，各卡的状态栏标签一起填，每张卡只按自己世界书里写的标签检查、提醒、修正。
// 先构建并在仓库根目录运行 8765 静态服务。用法：PW_CHROME=/usr/bin/chromium node test/reply-card-scope-check.mjs
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const URL = process.env.PA_TEST_URL || 'http://127.0.0.1:8765/test/site/index.html';
const KEY = 'presetAtelier:reply-format';
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const errors = [];
const ok = (message) => console.log('✓', message);
const NAME = '多卡共用预设（公开合成）';
const preset = {
  prompts: [{ identifier: 'fmt', name: '输出格式', content: '正文写在 <content> 里。', role: 'system', injection_position: 0, injection_depth: 4 }],
  prompt_order: [{ character_id: 100001, order: [{ identifier: 'fmt', enabled: true }] }]
};
const rule = (tag) => `#状态栏输出规则\n正文结束后输出：\n<${tag}>\n  <时>{{时辰}}</时>\n  <地>{{地点}}</地>\n</${tag}>`;
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    let host;
    Object.defineProperty(window, 'SillyTavern', {
      configurable: true,
      get: () => host,
      set(value) {
        host = value;
        const c = value.getContext();
        Object.assign(c.eventTypes, { GENERATION_AFTER_COMMANDS: 'generation_after_commands', WORLDINFO_UPDATED: 'worldinfo_updated' });
        window.__prompts = {};
        c.setExtensionPrompt = (key, text) => { window.__prompts[key] = text; };
        c.saveChat = async () => {};
        c.updateMessageBlock = () => {};
      }
    });
  });
  await page.goto(URL);
  await page.waitForFunction(() => window.__presetAtelier?.open, null, { timeout: 15000 });
  await page.evaluate(async ({ preset, NAME, a, b }) => {
    window.toastr = Object.fromEntries(['success', 'info', 'warning', 'error'].map((k) => [k, () => {}]));
    const m = window.__mock;
    m.names.splice(0, m.names.length, NAME);
    m.presets.splice(0, m.presets.length, preset);
    m.live.preset_settings_openai = NAME;
    Object.assign(m.live, structuredClone(preset));
    const wi = await import(new URL('scripts/world-info.js', document.baseURI).href);
    wi.world_names.push('甲书', '乙书');
    wi.selected_world_info.splice(0);
    globalThis.__wiStore['甲书'] = { entries: { 0: { uid: 0, comment: '状态栏', content: a, disable: false, key: [], constant: true } } };
    globalThis.__wiStore['乙书'] = { entries: { 0: { uid: 0, comment: '状态栏', content: b, disable: false, key: [], constant: true } } };
    const c = window.SillyTavern.getContext();
    c.characters = [
      { name: '甲', avatar: 'jia.png', description: '甲的设定', data: { extensions: { world: '甲书' } } },
      { name: '乙', avatar: 'yi.png', description: '乙的设定', data: { extensions: { world: '乙书' } } },
      // 丙没导入世界书文件，状态栏只在卡内嵌的世界书里
      { name: '丙', avatar: 'bing.png', description: '丙的设定', data: { extensions: { world: '丙书' }, character_book: { entries: [{ content: '正文后输出 <bing_bar><时>…</时></bing_bar>', enabled: true }] } } },
      { name: '丁', avatar: 'ding.png', description: '丁没有状态栏', data: { extensions: {} } }
    ];
    c.extensionSettings.presetAtelier = { ...(c.extensionSettings.presetAtelier || {}), replyGuard: { [NAME]: { bodyTag: 'content', requiredTags: ['card_status', 'zt', 'bing_bar'], enabled: true, autoFix: true } } };
  }, { preset, NAME, a: rule('card_status'), b: rule('zt') });

  const use = (id) => page.evaluate(async (id) => {
    const c = window.SillyTavern.getContext();
    c.characterId = id;
    await c.eventSource.emit(c.eventTypes.CHAT_CHANGED);
  }, id);
  const reply = (text) => page.evaluate((text) => {
    window.SillyTavern.getContext().chat = [{ is_user: false, mes: '开场白' }, { is_user: true, mes: '继续' }, { is_user: false, mes: text, extra: {} }];
  }, text);
  const before = () => page.evaluate(async () => { const c = window.SillyTavern.getContext(); await c.eventSource.emit(c.eventTypes.GENERATION_AFTER_COMMANDS, 'normal', {}, false); });
  const reminder = () => page.evaluate((key) => window.__prompts[key] || '', KEY);
  const mes = () => page.evaluate(() => window.SillyTavern.getContext().chat[2].mes);
  const generate = async (text) => {
    await before();
    await reply(text);
    await page.evaluate(async () => { const c = window.SillyTavern.getContext(); await c.eventSource.emit(c.eventTypes.GENERATION_ENDED); });
    await page.waitForTimeout(700);
  };
  const bar = (tag) => `<content>正文。</content>\n<${tag}>\n  <时>午时</时>\n  <地>东宫</地>\n</${tag}>`;

  // 乙卡：写自己的 <zt>，没有问题；不要求 <card_status>
  await use(1);
  await generate(bar('zt'));
  assert.equal(await mes(), bar('zt'), '乙卡的 <zt> 原样保留，不改名');
  await before();
  assert.equal(await reminder(), '', '乙卡写对了自己的标签，不提醒');
  await reply('<content>正文。</content>');
  await before();
  assert.match(await reminder(), /<zt>…<\/zt>/);
  assert.doesNotMatch(await reminder(), /card_status|bing_bar/, '不提别的卡的标签');
  ok('乙卡只按自己的 <zt> 检查：写对不提醒、不改名，掉了只提醒 <zt>');

  // 甲卡：写成 <状态栏>，按世界书里 <card_status> 的子标签认定写错名，自动改回，提醒不写错名
  await use(0);
  await generate(bar('状态栏'));
  assert.equal(await mes(), bar('card_status'), '自动修正改回 <card_status>');
  await before();
  assert.match(await reminder(), /<card_status>…<\/card_status>/);
  assert.doesNotMatch(await reminder(), /状态栏|<zt>|bing_bar/);
  await generate(bar('zt'));
  assert.notEqual(await mes(), bar('zt'), '甲卡里冒出的 <zt> 会被认出');
  ok('甲卡按世界书里的 <card_status> 检查，写错名时改回，提醒不出现错名和别的卡的标签');

  // 丙卡：世界书文件不存在，用卡内嵌的世界书
  await use(2);
  await reply('<content>正文。</content>');
  await before();
  assert.match(await reminder(), /<bing_bar>…<\/bing_bar>/);
  assert.doesNotMatch(await reminder(), /card_status|<zt>/);
  ok('没导入世界书的卡按卡内嵌的世界书检查');

  // 丁卡：没有状态栏，三个必需标签都不检查
  await use(3);
  await generate('<content>正文。</content>');
  await before();
  assert.equal(await reminder(), '', '丁卡没有状态栏，不要求任何状态栏标签');
  await page.evaluate(() => window.__presetAtelier.open('reply-check'));
  await page.locator('[data-page=reply] [data-r=unused]:not([hidden])').waitFor();
  assert.match(await page.locator('[data-page=reply] [data-r=unused]').innerText(), /没有 <card_status>、<zt>、<bing_bar>，这次不检查/);
  ok('丁卡不要求任何状态栏标签，「回复」页写明这次跳过的标签');

  // 改世界书后重读：乙书删掉状态栏条目，乙卡不再要求 <zt>
  await use(1);
  await page.evaluate(async () => {
    globalThis.__wiStore['乙书'].entries[0].disable = true;
    const c = window.SillyTavern.getContext();
    await c.eventSource.emit(c.eventTypes.WORLDINFO_UPDATED, '乙书');
  });
  await reply('<content>正文。</content>');
  await before();
  assert.equal(await reminder(), '', '关掉的世界书条目不算');
  ok('世界书改动后重读，关掉的条目不算');
  assert.deepEqual(errors, []);
  console.log('必需标签按角色卡生效检查全部通过');
} finally {
  await browser.close();
}
