// 2.11.21 保存：保存进行中又改了一条，写完后接着再存一次且是最新内容。2.12.16 页头没有「完成」：自动保存后「撤销」可用，保存失败时「重试保存」出现；不改预设的页面不显示保存栏。
// 先构建并在仓库根目录运行 8765 静态服务。用法：PW_CHROME=/usr/bin/chromium node test/save-speed-check.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
const require = createRequire(import.meta.url);
const URL = process.env.PA_TEST_URL || 'http://127.0.0.1:8765/test/site/index.html';
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const errors = [];
const ok = (message) => console.log('✓', message);
const NAME = '保存检查（公开合成）';
const preset = require('./fixtures/performance.cjs')({ size: 40, groupSize: 20, prefix: 'sv', collapsed: false });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(URL);
  await page.waitForFunction(() => window.__mcdonalds?.open);
  await page.evaluate(({ preset, NAME }) => {
    const m = window.__mock;
    m.names.splice(0, m.names.length, NAME);
    m.presets.splice(0, m.presets.length, preset);
    m.live.preset_settings_openai = NAME;
    Object.assign(m.live, structuredClone(preset));
    // 保存请求由测试放行：calls 记下每次发出的开关状态，release() 放行最早一次，fail 为真时这次保存失败
    window.__sv = { calls: [], gates: [], fail: false };
    const c = window.SillyTavern.getContext(), orig = c.getPresetManager;
    c.getPresetManager = (...a) => {
      const pm = orig(...a);
      pm.savePreset = async (n, d) => {
        window.__sv.calls.push(d.prompt_order[0].order.map((o) => o.enabled));
        await new Promise((r) => window.__sv.gates.push(r));
        if (window.__sv.fail) throw new Error('网络断开');
      };
      return pm;
    };
    window.__toasts = [];
    const log = console.log;
    console.log = (...x) => { window.__toasts.push(x.join(' ')); return log(...x); };
    window.__mcdonalds.open('organize');
  }, { preset, NAME });
  const toggle = (i) => page.evaluate((i) => document.querySelectorAll('[data-act=toggle]')[i].click(), i);
  const calls = () => page.evaluate(() => window.__sv.calls.length);
  const release = () => page.evaluate(() => window.__sv.gates.shift()?.());
  const status = () => page.locator('.pa-dirty-text').innerText();
  await page.locator('[data-act=toggle]').first().waitFor();

  const before = await page.evaluate(() => window.__mock.presets[0].prompt_order[0].order.map((o) => o.enabled));
  await toggle(0);
  await page.waitForFunction(() => window.__sv.calls.length === 1);
  await toggle(3);
  assert.equal(await status(), '保存中…');
  await release();
  await page.waitForFunction(() => window.__sv.calls.length === 2);
  const second = await page.evaluate(() => window.__sv.calls[1]);
  assert.equal(second[0], !before[0]); assert.equal(second[3], !before[3], '第二次保存带上保存期间的改动');
  await release();
  await page.waitForFunction(() => document.querySelector('.pa-dirty-text')?.textContent === '已自动保存');
  const live = await page.evaluate(() => window.__mock.presets[0].prompt_order[0].order.map((o) => o.enabled));
  assert.equal(live[0], !before[0]); assert.equal(live[3], !before[3]);
  assert.equal(await calls(), 2, '写完后没有新改动，不再多存');
  ok('保存进行中又改了一条：写完后接着再存一次，存的是最新内容');

  // 2.12.16 页头没有「完成」：自动保存完成后显示「已自动保存」，「撤销」写明撤的是哪一步
  assert.equal(await page.locator('[data-g=confirm]').count(), 0, '页头不再有「完成」');
  await toggle(5);
  await page.waitForFunction(() => window.__sv.calls.length === 3);
  assert.equal(await status(), '保存中…');
  const dotColor = await page.evaluate(() => getComputedStyle(document.querySelector('.pa-dirty-text'), '::before').backgroundColor);
  assert.ok(!/rgb\(2(0[0-9]|[1-5][0-9]), (3[0-9]|[4-6][0-9]), (3[0-9]|[4-6][0-9])\)/.test(dotColor), `保存中圆点不用红色（${dotColor}）`);
  await release();
  await page.waitForFunction(() => document.querySelector('.pa-dirty-text')?.textContent === '已自动保存');
  assert.equal(await page.locator('.pa-savebar [data-g=undo]').isVisible(), true, '自动保存后可撤销');
  assert.match(await page.locator('.pa-savebar [data-g=undo]').getAttribute('title'), /^撤销：/);
  await page.locator('.pa-savebar [data-g=undo]').click();
  await page.waitForFunction(() => window.__sv.calls.length === 4);
  await release();
  await page.waitForFunction(() => document.querySelector('.pa-dirty-text')?.textContent === '已自动保存');
  const undone = await page.evaluate(() => window.__mock.presets[0].prompt_order[0].order.map((o) => o.enabled));
  assert.equal(undone[5], before[5], '撤销后自动保存回原状态');
  ok('没有「完成」：自动保存后「撤销」可用，撤销也自动保存');

  // 不改预设的页面（世界书、连接）不显示预设的保存状态、撤销、备份
  for (const k of ['books', 'conn', 'clean']) {
    await page.evaluate((k) => window.__mcdonalds.open(k), k);
    assert.equal(await page.locator('.pa-savebar').isHidden(), true, `「${k}」页不显示预设的保存栏`);
  }
  assert.equal(await page.locator('[data-g=backups]').isHidden(), true, '清理页不显示页头备份按钮');
  await page.evaluate(() => window.__mcdonalds.open('organize'));
  assert.equal(await page.locator('[data-g=backups]').isVisible(), true);
  ok('世界书、连接、清理页不显示预设的撤销；备份按钮跟着页面');

  // 保存失败：「重试保存」出现，修改留在草稿里
  await toggle(7);
  await page.waitForFunction(() => window.__sv.calls.length === 5);
  await page.evaluate(() => { window.__sv.fail = true; });
  await release();
  await page.waitForFunction(() => /保存失败/.test(document.querySelector('.pa-dirty-text')?.textContent || '') && !document.querySelector('[data-g=undo]').hidden);
  assert.equal(await page.locator('[data-g=save]').isVisible(), true, '保存失败后显示重试保存');
  await page.evaluate(() => window.__mcdonalds.open('conn'));
  assert.equal(await page.locator('.pa-savebar').isVisible(), true, '保存失败时别的页面也看得到');
  assert.equal(await page.locator('[data-g=undo]').isHidden(), true, '别的页面不显示预设的撤销');
  await page.evaluate(() => window.__mcdonalds.open('organize'));
  ok('保存失败：重试保存出现，别的页面也提示，修改留在草稿里');

  // 网络恢复后点「重试保存」
  await page.evaluate(() => { window.__sv.fail = false; });
  await page.locator('[data-g=save]').click();
  assert.equal(await status(), '保存中…', '重试进行中显示保存中，不再显示上次的失败');
  assert.equal(await page.locator('[data-g=save]').isHidden(), true);
  await page.waitForFunction(() => window.__sv.calls.length === 6 && window.__sv.gates.length === 1);
  await release();
  await page.waitForFunction(() => document.querySelector('.pa-dirty-text')?.textContent === '已自动保存');
  const after = await page.evaluate(() => window.__mock.presets[0].prompt_order[0].order.map((o) => o.enabled));
  assert.equal(after[7], !before[7], '失败期间的修改最终写入');
  ok('重试保存：进行中显示保存中，成功后写入失败期间的修改');
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
