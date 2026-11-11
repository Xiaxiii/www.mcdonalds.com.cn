// 缝来的状态栏条目依赖来源预设的显示正则：预览提醒，确认后可直接去缝正则（已预选需要的那条）。
// 先构建并在仓库根目录运行 8765 静态服务。用法：PW_CHROME=/usr/bin/chromium node test/suture-regex-dep-check.mjs
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { choose } from './choose.mjs';
const URL = process.env.PA_TEST_URL || 'http://127.0.0.1:8765/test/site/index.html';
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const errors = [];
const p = (identifier, name, content) => ({ identifier, name, content, role: 'system', injection_position: 0, injection_depth: 4 });
const rule = (id, scriptName, findRegex, extra = {}) => ({ id, scriptName, findRegex, replaceString: '<div class="bar">$1</div>', trimStrings: [], placement: [2], disabled: false, markdownOnly: true, promptOnly: false, runOnEdit: true, substituteRegex: 0, minDepth: null, maxDepth: null, ...extra });
const targetName = '正则依赖目标（公开合成）', sourceName = '正则依赖来源（公开合成）';
const target = { prompts: [p('t1', '目标条目', '目标正文')], prompt_order: [{ character_id: 100001, order: [{ identifier: 't1', enabled: true }] }], extensions: {} };
const source = {
  prompts: [p('s1', '状态栏格式', '每轮正文后输出：\n<StatusBar>\n积分：\n</StatusBar>'), p('s2', '普通文风', '只写动作和对白，句子短。')],
  prompt_order: [{ character_id: 100001, order: [{ identifier: 's1', enabled: true }, { identifier: 's2', enabled: true }] }],
  extensions: { regex_scripts: [rule('r1', '状态栏美化', '/<StatusBar>([\\s\\S]*?)<\\/StatusBar>/g'), rule('r2', '无关美化', '/<Other>(.*)<\\/Other>/g')] }
};
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(URL);
  await page.waitForFunction(() => window.__presetAtelier?.open);
  await page.evaluate(({ target, source, targetName, sourceName }) => {
    const m = window.__mock;
    m.names.splice(0, m.names.length, targetName, sourceName);
    m.presets.splice(0, m.presets.length, target, source);
    m.live.preset_settings_openai = targetName;
    Object.assign(m.live, structuredClone(target));
    window.__presetAtelier.open('suture');
  }, { target, source, targetName, sourceName });
  await choose(page, '.pa-src-name', sourceName);
  await choose(page, '.pa-dst-picker .pa-namebtn', targetName);
  for (const id of ['s1', 's2']) await page.locator(`.pa-src-list [data-id="${id}"] .pa-name`).click();
  await page.locator('.pa-dst-list .pa-row').first().click();
  await page.click('[data-st=go]');
  await page.waitForSelector('.pa-review .pa-item');
  const items = page.locator('.pa-review .pa-item');
  await items.nth(0).locator('.pa-item-head').click();
  assert.match(await items.nth(0).innerText(), /靠正则「状态栏美化」显示成美化/);
  await items.nth(1).locator('.pa-item-head').click();
  assert.doesNotMatch(await items.nth(1).innerText(), /显示成美化/, '普通条目不提醒');
  await page.locator('.pa-sheet-actions .pa-btn-primary').click();
  await page.locator('.pa-sheet', { hasText: '一起缝显示正则' }).waitFor();
  await page.locator('.pa-sheet-actions .pa-btn-primary', { hasText: '去缝正则' }).click();
  await page.locator('[data-rx-count]').waitFor();
  assert.equal(await page.locator('[data-rx-count]').innerText(), '已选 1 / 2', '只预选状态栏需要的那条');
  console.log('✓ 状态栏条目依赖来源显示正则：预览提醒，缝完可直接去缝正则并已预选');
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
