// 思维链页「可能未被读取的内容」：加入思维链读取、名字大小写对不上时改名、另一套思维链关着时不提供开启。
// 先构建并在仓库根目录运行 8765 静态服务。用法：PW_CHROME=/usr/bin/chromium node test/cot-fragment-check.mjs
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const URL = process.env.PA_TEST_URL || 'http://127.0.0.1:8765/test/site/index.html';
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const errors = [];
const ok = (message) => console.log('✓', message);
const NAME = '思维链片段检查（公开合成）';
const p = (identifier, name, content) => ({ identifier, name, content, role: 'system', injection_position: 0, injection_depth: 4 });
const preset = {
  prompts: [
    p('init', '变量初始化', '{{setvar::草稿检查小CoT::}}{{setvar::NSFWcot::}}'),
    p('draft', '3.1的草稿小CoT', '{{setvar::草稿检查小CoT::\n- 检查草稿是否符合人设\n}}'),
    p('nsfw', '🔞NSFW一键开关', '{{setvar::NSFWcot::\n- 本轮尺度如何落实\n}}'),
    p('style', '文风甲', '{{setvar::文风cot::\n- 文风如何体现\n}}'),
    p('cot', '思维链主体', '<thinking>\n1. 回顾剧情\n{{getvar::文风cot}}\n2. 安排本轮\n</thinking>'),
    p('cot-old', '旧版思维链', '<thinking>\n{{getvar::NSFWcot}}\n</thinking>'),
    p('mis', '小剧场', '{{setvar::Theatercot::\n- 小剧场怎么写\n}}')
  ],
  prompt_order: [{ character_id: 100001, order: ['init', 'draft', 'nsfw', 'style', 'cot', 'cot-old', 'mis'].map((identifier) => ({ identifier, enabled: identifier !== 'cot-old' })) }]
};
// 名字只差大小写：思维链读 TheaterCoT
preset.prompts.find((x) => x.identifier === 'cot').content = '<thinking>\n1. 回顾剧情\n{{getvar::文风cot}}\n{{getvar::TheaterCoT}}\n2. 安排本轮\n</thinking>';
const stored = (page) => page.evaluate((name) => window.__mock.presets[window.__mock.names.indexOf(name)], NAME);
const cotText = async (page) => (await stored(page)).prompts.find((x) => x.identifier === 'cot').content;
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(URL);
  await page.waitForFunction(() => window.__presetAtelier?.open);
  await page.evaluate(({ preset, NAME }) => {
    const m = window.__mock;
    m.names.splice(0, m.names.length, NAME);
    m.presets.splice(0, m.presets.length, preset);
    m.live.preset_settings_openai = NAME;
    Object.assign(m.live, structuredClone(preset));
    window.__presetAtelier.open('cot');
  }, { preset, NAME });
  const cards = page.locator('.pa-dead');
  await cards.first().waitFor();
  assert.equal(await cards.count(), 3);

  const draft = cards.filter({ hasText: '草稿检查小CoT' });
  await draft.locator('summary').click();
  assert.match(await draft.innerText(), /思维链没读/);
  assert.equal(await draft.locator('[data-repair]').count(), 0, '片段变量不再给出会报「需人工核对」的通用修复');
  await draft.locator('[data-cotread]').click();
  const sheet = page.locator('.pa-sheet');
  await sheet.locator('[data-k=preview]').waitFor();
  assert.equal(await sheet.locator('[data-k=cot]').inputValue(), 'cot', '默认加到读取其他片段最多的思维链');
  assert.match(await sheet.locator('[data-k=preview]').innerText(), /\{\{getvar::TheaterCoT\}\}\n\{\{getvar::草稿检查小CoT\}\}\n2\. 安排本轮/, '默认紧跟最后一个片段读取');
  await sheet.locator('[data-k=line]').selectOption('1');
  assert.match(await sheet.locator('[data-k=preview]').innerText(), /^<thinking>\n\{\{getvar::草稿检查小CoT\}\}\n1\. 回顾剧情/, '可改放在哪一行之后');
  await sheet.locator('.pa-sheet-actions .pa-btn-primary').click();
  await page.waitForFunction((name) => window.__mock.presets[0].prompts.find((x) => x.identifier === 'cot').content.includes('{{getvar::草稿检查小CoT}}'), NAME);
  assert.equal(await cotText(page), '<thinking>\n{{getvar::草稿检查小CoT}}\n1. 回顾剧情\n{{getvar::文风cot}}\n{{getvar::TheaterCoT}}\n2. 安排本轮\n</thinking>');
  await page.waitForFunction(() => document.querySelectorAll('.pa-dead').length === 2);
  ok('片段变量可选思维链和行，预览后加入读取，待核对随之消失');

  await page.click('[data-g=undo]');
  await page.waitForFunction(() => !window.__mock.presets[0].prompts.find((x) => x.identifier === 'cot').content.includes('草稿检查小CoT'));
  await page.waitForFunction(() => document.querySelectorAll('.pa-dead').length === 3);
  ok('顶栏撤销恢复思维链原文');

  const nsfw = cards.filter({ hasText: 'NSFWcot' });
  await nsfw.locator('summary').click();
  assert.match(await nsfw.innerText(), /另一套思维链/);
  assert.equal(await nsfw.locator('[data-fix]').count(), 0, '不提供开启另一套思维链');
  assert.equal(await nsfw.locator('[data-cotread]').count(), 1);
  ok('读取它的是关着的另一套思维链时，只建议在当前思维链里加入读取');

  const mis = cards.filter({ hasText: 'Theatercot' });
  await mis.locator('summary').click();
  assert.match(await mis.innerText(), /名字对不上/);
  await mis.locator('[data-rename]').click();
  await sheet.locator('.pa-sheet-actions .pa-btn-primary').click();
  await page.waitForFunction(() => window.__mock.presets[0].prompts.find((x) => x.identifier === 'mis').content.includes('{{setvar::TheaterCoT::'));
  await page.waitForFunction(() => document.querySelectorAll('.pa-dead').length === 2);
  assert.equal((await stored(page)).prompts.find((x) => x.identifier === 'mis').content, '{{setvar::TheaterCoT::\n- 小剧场怎么写\n}}');
  ok('写入与读取的变量名只差大小写时，可把写入改成读取用的名字');
  assert.equal(await page.locator('.pa-cot .pa-card-warn', { hasText: '套思维链开头' }).count(), 0);
  await page.evaluate(() => {
    const m = window.__mock.presets[0];
    m.prompts.push({ identifier: 'cot-nsfw', name: '开nsfw思考，关其他思考', content: '<ECoT>\n# 确认身份\n- 本轮如何写', role: 'system' });
    m.prompt_order[0].order.push({ identifier: 'cot-nsfw', enabled: true });
    Object.assign(window.__mock.live, structuredClone(m));
    window.__presetAtelier.open('organize'); window.__presetAtelier.open('cot');
  });
  await page.locator('.pa-cot .pa-card-warn', { hasText: '同时开着 2 套思维链开头' }).waitFor();
  assert.match(await page.locator('.pa-cot .pa-card-warn', { hasText: '套思维链开头' }).innerText(), /思维链主体.*开nsfw思考，关其他思考/s);
  ok('同时开着两套思维链开头时提醒');
  // 读取方不是思维链、但开着（如格式条目的部件清单），片段内容照样会发出，不算没读
  await page.evaluate(() => {
    const m = window.__mock.presets[0];
    m.prompts.push({ identifier: 'fmt', name: '📌 格式强调', content: '部件：{{getvar::content}}({{getvar::草稿检查小CoT}})', role: 'system' });
    m.prompt_order[0].order.push({ identifier: 'fmt', enabled: true });
    Object.assign(window.__mock.live, structuredClone(m));
    window.__presetAtelier.open('organize'); window.__presetAtelier.open('cot');
  });
  await page.waitForFunction(() => ![...document.querySelectorAll('.pa-dead')].some((x) => x.textContent.includes('草稿检查小CoT')));
  ok('片段变量由开启的非思维链条目读取时不再报「思维链没读」');
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
