// 推理格式按预设记忆：离开预设时记下，切回时恢复；关闭时不动。先构建并在仓库根目录运行 8765 静态服务。
// 用法：PW_CHROME=/usr/bin/chromium node test/reasoning-follow-check.mjs
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const URL = process.env.PA_TEST_URL || 'http://127.0.0.1:8765/test/site/index.html';
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const errors = [];
const ok = (m) => console.log('✓', m);
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      document.body.insertAdjacentHTML('beforeend', '<div id="st-reasoning"><select id="reasoning_select"><option>DeepSeek</option><option>ECoT</option></select><input id="reasoning_prefix"><input id="reasoning_suffix"><input id="reasoning_separator"><input id="reasoning_max_additions"><input type="checkbox" id="reasoning_auto_parse"><input type="checkbox" id="reasoning_add_to_prompts"><input type="checkbox" id="reasoning_show_hidden"><input type="checkbox" id="reasoning_auto_expand"></div><div id="chat"></div>');
    });
  });
  await page.goto(URL);
  await page.waitForFunction(() => window.__mcdonalds?.open);
  const A = { name: 'ECoT', auto_parse: true, add_to_prompts: false, auto_expand: false, show_hidden: true, prefix: '<ECoT>', suffix: '</ECoT>', separator: '\n', max_additions: 1 };
  const B = { name: 'DeepSeek', auto_parse: false, add_to_prompts: true, auto_expand: true, show_hidden: false, prefix: '<think>', suffix: '</think>', separator: '\n', max_additions: 2 };
  const names = await page.evaluate((A) => {
    const c = window.SillyTavern.getContext();
    c.powerUserSettings.reasoning = structuredClone(A);
    const m = window.__mock;
    m.names.push('预设乙'); m.presets.push(structuredClone(m.presets[0]));
    return [m.live.preset_settings_openai, '预设乙'];
  }, A);
  const switchTo = (name) => page.evaluate(async (name) => {
    const c = window.SillyTavern.getContext(), m = window.__mock;
    await c.getPresetManager().selectPreset(m.names.indexOf(name));
    await c.eventSource.emit(c.eventTypes.PRESET_CHANGED, { apiId: 'openai', name });
  }, name);
  const now = () => page.evaluate(() => structuredClone(window.SillyTavern.getContext().powerUserSettings.reasoning));
  const dom = () => page.evaluate(() => ({ prefix: document.getElementById('reasoning_prefix').value, parse: document.getElementById('reasoning_auto_parse').checked, select: document.getElementById('reasoning_select').value }));

  // 默认关闭：切换不动推理格式
  await switchTo(names[1]);
  await page.evaluate((B) => { window.SillyTavern.getContext().powerUserSettings.reasoning = structuredClone(B); }, B);
  await switchTo(names[0]);
  assert.deepEqual(await now(), B, '默认关闭时不切换');
  assert.equal(await page.evaluate(() => Object.keys(window.SillyTavern.getContext().extensionSettings.mcdonalds.reasoningByPreset || {}).length), 0, '默认关闭时不记录');
  ok('默认关闭，切换预设不改推理格式、不记录');

  // 在界面上打开开关：记下当前预设（甲）现在的格式
  await page.evaluate((A) => { window.SillyTavern.getContext().powerUserSettings.reasoning = structuredClone(A); window.__mcdonalds.open('schemes'); }, A);
  const box = page.locator('[data-o=reasoningfollow]');
  await box.waitFor();
  await box.check();
  await switchTo(names[1]);
  assert.deepEqual(await now(), A, '乙没有记录时保持当前设置');
  await page.evaluate((B) => { window.SillyTavern.getContext().powerUserSettings.reasoning = structuredClone(B); }, B);
  await switchTo(names[0]);
  assert.deepEqual(await now(), A, '切回甲恢复甲的格式');
  assert.deepEqual(await dom(), { prefix: '<ECoT>', parse: true, select: 'ECoT' }, '酒馆面板同步显示');
  assert.equal(await page.evaluate(() => document.getElementById('chat').getAttribute('data-show-hidden-reasoning')), 'true');
  await switchTo(names[1]);
  assert.deepEqual(await now(), B, '切到乙恢复乙的格式');
  assert.deepEqual(await dom(), { prefix: '<think>', parse: false, select: 'DeepSeek' });
  ok('开启后离开预设时记下格式，切回时恢复，并同步酒馆面板');

  // 记录列表：当前预设显示酒馆现在的设置、不能删；其他预设显示记住的设置
  await page.evaluate(() => {
    const c = window.SillyTavern.getContext(), orig = c.getPresetManager;
    const templates = [{ name: 'DeepSeek', prefix: '<think>\n', suffix: '\n</think>', separator: '\n\n' }, { name: 'ECoT', prefix: '<ECoT>', suffix: '</ECoT>', separator: '\n' }];
    c.getPresetManager = (api) => api === 'reasoning' ? { getPresetList: () => ({ presets: templates }) } : orig(api);
  });
  const stored = (n) => page.evaluate((n) => structuredClone(window.SillyTavern.getContext().extensionSettings.mcdonalds.reasoningByPreset[n]), n);
  const rows = page.locator('.pa-rrow');
  const sheet = page.locator('.pa-sheet-mask:not(.pa-out)').last();
  // 2.4.0：收起时只显示条数；点这一行（不是方框）展开记录列表，方框不变
  const card = page.locator('.pa-optgroup[data-w=reasoning]');
  assert.equal(await card.locator('.pa-rrow').count(), 0, '收起时不显示列表');
  assert.equal(await card.locator('.pa-optcount').innerText(), '2');
  await card.locator('.pa-optlabel').click();
  await rows.first().waitFor();
  assert.equal(await box.isChecked(), true, '点这一行只展开，不改勾选');
  assert.equal(await rows.count(), 2);
  assert.equal(await rows.nth(0).getAttribute('data-name'), names[1]);
  assert.match(await rows.nth(0).innerText(), /当前[\s\S]*<think>[\s\S]*不解析/);
  assert.equal(await rows.nth(0).locator('[data-a=reasoningdel]').count(), 0, '当前预设不给删除');
  assert.match(await rows.nth(1).innerText(), /<ECoT>[\s\S]*自动解析/);
  assert.match(await rows.nth(1).locator('.pa-rfmt').getAttribute('title'), /ECoT · <ECoT> … <\/ECoT> · 自动解析、显示隐藏内容/, '完整设置在悬停提示里');
  ok('展开后列出每个预设记住的推理格式');

  // 改其他预设的记录：只改记录，切过去才套用；换模板带出模板的前后缀
  await rows.nth(1).locator('[data-a=reasoningedit]').click();
  await sheet.locator('textarea[data-k=separator]').waitFor();
  assert.equal(await sheet.locator('textarea[data-k=separator]').inputValue(), '\n', '开头的换行不丢');
  assert.equal(await sheet.locator('.pa-field:has(textarea[data-k=separator]) .pa-rws').innerText(), '（↵）', '只有换行时标出来');
  await sheet.locator('select[data-k=name]').selectOption('DeepSeek');
  assert.equal(await sheet.locator('textarea[data-k=prefix]').inputValue(), '<think>\n', '换模板带出前缀');
  await sheet.locator('textarea[data-k=suffix]').fill('</think>');
  await sheet.locator('input[data-k=auto_parse]').uncheck();
  await sheet.locator('input[data-k=max_additions]').fill('3');
  await sheet.locator('.pa-btn-primary').click();
  const edited = { ...A, name: 'DeepSeek', prefix: '<think>\n', suffix: '</think>', separator: '\n\n', auto_parse: false, max_additions: 3 };
  assert.deepEqual(await stored(names[0]), edited);
  assert.deepEqual(await now(), B, '改其他预设的记录不动酒馆现在的设置');
  await switchTo(names[0]);
  assert.deepEqual(await now(), edited, '切过去套用改过的记录');
  ok('修改其他预设的记录，切过去时套用');

  // 改当前预设：立即改酒馆设置并同步酒馆面板
  await page.locator('.pa-rrow.pa-srow-on [data-a=reasoningedit]').click();
  await sheet.locator('textarea[data-k=prefix]').fill('<cot>');
  await sheet.locator('input[data-k=show_hidden]').uncheck();
  await sheet.locator('.pa-btn-primary').click();
  assert.equal((await now()).prefix, '<cot>');
  assert.equal((await now()).show_hidden, false);
  assert.equal(await page.evaluate(() => document.getElementById('reasoning_prefix').value), '<cot>');
  assert.equal((await stored(names[0])).prefix, '<cot>');
  ok('修改当前预设立即改酒馆设置');

  // 在酒馆面板里改过后，收起再展开显示新值
  await page.evaluate(() => { window.SillyTavern.getContext().powerUserSettings.reasoning.prefix = '<fresh>'; });
  assert.doesNotMatch(await page.locator('.pa-rrow.pa-srow-on').innerText(), /<fresh>/);
  await card.locator('.pa-optlabel').click();
  await card.locator('.pa-optlabel').click();
  assert.match(await page.locator('.pa-rrow.pa-srow-on').innerText(), /<fresh>/);
  await page.evaluate(() => { window.SillyTavern.getContext().powerUserSettings.reasoning.prefix = '<cot>'; });
  await card.locator('.pa-optlabel').click();
  await card.locator('.pa-optlabel').click();
  ok('收起再展开显示酒馆里改过的设置');

  // 删除一条记录；给没记录的预设新建一条
  await page.locator(`.pa-rrow[data-name="${names[1]}"] [data-a=reasoningdel]`).click();
  await sheet.locator('.pa-btn-danger').click();
  assert.equal(await stored(names[1]), undefined);
  await page.locator('[data-a=reasoningadd]').click();
  await sheet.locator('.pa-pick-item').filter({ hasText: names[1] }).click();
  await sheet.locator('textarea[data-k=prefix]').waitFor();
  assert.equal(await sheet.locator('textarea[data-k=prefix]').inputValue(), '<cot>', '新建时先填酒馆现在的设置');
  await sheet.locator('textarea[data-k=prefix]').fill('<new>');
  await sheet.locator('.pa-btn-primary').click();
  assert.equal((await stored(names[1])).prefix, '<new>');
  assert.equal((await now()).prefix, '<cot>');
  ok('可删除记录，也可给没记录的预设新建');

  await page.waitForTimeout(300);
  await box.uncheck();
  assert.equal(await card.locator('.pa-rrow').count(), 0, '关闭后不显示记录列表');
  assert.match(await card.innerText(), /已记住 2 个预设/, '关闭后只显示记了几个、可清除');
  const before = await now();
  await switchTo(names[1]);
  assert.deepEqual(await now(), before, '关闭后不再切换');
  ok('关闭后切换预设不改推理格式');
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
