// 2.11.7 流式开关按「预设 + 站点」记录，切换预设后自动套用；预设页选中别的预设时可直接「切换」。
// 先构建并在仓库根目录运行 8765 静态服务。用法：PW_CHROME=/usr/bin/chromium node test/stream-preset-check.mjs
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { choose } from './choose.mjs';
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const errors = [];
const ok = (m) => console.log('✓', m);
const P = (stream) => ({ prompts: [{ identifier: 'a', name: '条目', content: '正文', role: 'system' }], prompt_order: [{ character_id: 100001, order: [{ identifier: 'a', enabled: true }] }], stream_openai: stream, extensions: {} });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://127.0.0.1:8765/test/site/index.html');
  await page.waitForFunction(() => window.__mcdonalds?.open);
  await page.evaluate(({ a, b }) => {
    const m = window.__mock;
    m.names.splice(0, m.names.length, '预设甲', '预设乙');
    m.presets.splice(0, m.presets.length, a, b);
    m.live.preset_settings_openai = '预设甲';
    Object.assign(m.live, structuredClone(a), { chat_completion_source: 'custom', custom_url: 'https://a.example/v1' });
    // 与酒馆一致：流式开关改动写回设置
    document.body.insertAdjacentHTML('beforeend', '<input type="checkbox" id="stream_toggle" hidden>');
    $('#stream_toggle').prop('checked', !!m.live.stream_openai).on('change', function () { m.live.stream_openai = this.checked; });
    window.SillyTavern.getContext().extensionSettings.mcdonalds = { sites: [{ id: 'sa', name: '甲站', source: 'custom', url: 'https://a.example/v1', model: 'm', models: [] }], activeSiteId: 'sa' };
    window.__mcdonalds.open('conn');
  }, { a: P(false), b: P(false) });
  const live = () => page.evaluate(() => ({ preset: window.__mock.live.preset_settings_openai, stream: !!window.__mock.live.stream_openai }));
  // 模拟酒馆切换预设：读入预设里的设置（含流式开关），再发出切换完成事件
  const stSwitched = () => page.evaluate(async () => {
    $('#stream_toggle').prop('checked', !!window.__mock.live.stream_openai);
    await window.SillyTavern.getContext().eventSource.emit('oai_after');
    await new Promise((r) => setTimeout(r, 50));
  });
  const row = page.locator('.pa-live .pa-stream');
  await row.waitFor();
  assert.match(await row.innerText(), /跟随预设/);
  assert.match(await row.locator('.pa-stream-note').getAttribute('title'), /「预设甲」/);
  assert.equal(await row.locator('input').isChecked(), false);
  await row.locator('.pa-switch').click();
  assert.deepEqual(await live(), { preset: '预设甲', stream: true });
  assert.match(await row.innerText(), /已单独记录/);
  assert.match(await row.locator('.pa-stream-note').getAttribute('title'), /已记在「预设甲」\+「甲站」/);
  ok('当前连接卡片上有流式开关，打开后记在「预设 + 站点」上');

  // 预设页：选中别的预设时出现「切换」，点了在酒馆中切换
  await page.evaluate(() => window.__mcdonalds.open('organize'));
  const useBtn = page.locator('[data-page=organize] .pa-use-preset');
  assert.equal(await useBtn.isVisible(), false, '选中的就是使用中的预设时不显示');
  await choose(page, '[data-page=organize] .pa-picker .pa-namebtn', '预设乙');
  assert.equal(await useBtn.isVisible(), true);
  await useBtn.click();
  await page.waitForFunction(() => window.__mock.live.preset_settings_openai === '预设乙');
  await stSwitched();
  assert.equal(await useBtn.isVisible(), false, '切换后按钮消失');
  assert.deepEqual(await live(), { preset: '预设乙', stream: false }, '预设乙配甲站没记过：跟随预设');
  ok('预设页选中别的预设后点「切换」，在酒馆中切换过去');

  await choose(page, '[data-page=organize] .pa-picker .pa-namebtn', '预设甲');
  await useBtn.click();
  await page.waitForFunction(() => window.__mock.live.preset_settings_openai === '预设甲');
  await stSwitched();
  assert.deepEqual(await live(), { preset: '预设甲', stream: true }, '切回预设甲：预设里存的是非流式，按记下的改回流式');
  ok('切回记过的组合：自动改成记下的流式开关');

  await page.evaluate(() => window.__mcdonalds.open('conn'));
  await row.waitFor();
  await row.locator('[data-a=streamforget]').click();
  assert.match(await row.innerText(), /跟随预设/);
  assert.deepEqual(await page.evaluate(() => window.SillyTavern.getContext().extensionSettings.mcdonalds.streamRules), {});
  ok('「改回跟随」后跟随预设');
  assert.deepEqual(errors, []);
  console.log('流式与切换预设检查通过');
} finally {
  await browser.close();
}
