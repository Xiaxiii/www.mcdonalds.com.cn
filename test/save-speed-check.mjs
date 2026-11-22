// 2.11.21 保存：保存进行中又改了一条，写完后接着再存一次且是最新内容；点「完成」按钮立刻收起，保存失败时按钮回来。
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

  await toggle(5);
  await page.waitForFunction(() => window.__sv.calls.length === 3);
  await page.locator('[data-g=confirm]').click();
  assert.equal(await page.locator('[data-g=confirm]').isHidden(), true, '点「完成」后按钮立刻收起');
  assert.equal(await page.locator('[data-g=undo]').isHidden(), true);
  assert.equal(await status(), '保存中…');
  assert.ok(!(await page.evaluate(() => window.__toasts.some((t) => t.includes('已完成')))), '保存没结束前不提示完成');
  await release();
  await page.waitForFunction(() => window.__toasts.some((t) => t.includes('已完成')));
  assert.equal(await page.locator('.pa-savebar').isHidden(), true, '完成后没有待撤销的修改');
  ok('点「完成」：按钮立刻收起、显示保存中，保存完才提示完成');

  // 点「完成」时这批的保存还在进行，随后失败：「撤销」「重试保存」回来，不提示完成
  await toggle(7);
  await page.waitForFunction(() => window.__sv.calls.length === 4);
  const toastsBefore = await page.evaluate(() => window.__toasts.length);
  await page.locator('[data-g=confirm]').click();
  assert.equal(await page.locator('[data-g=confirm]').isHidden(), true);
  await page.waitForTimeout(200);
  await page.evaluate(() => { window.__sv.fail = true; });
  await release();
  await page.waitForFunction(() => /保存失败/.test(document.querySelector('.pa-dirty-text')?.textContent || '') && !document.querySelector('[data-g=undo]').hidden);
  assert.equal(await page.locator('[data-g=save]').isVisible(), true, '保存失败后显示重试保存');
  assert.equal(await calls(), 4, '「完成」等的就是这次保存，不另发一次');
  assert.ok(!(await page.evaluate((n) => window.__toasts.slice(n).some((t) => t.includes('已完成')), toastsBefore)), '保存失败时不提示完成');
  ok('点「完成」后保存失败：撤销、重试保存回来，修改留在草稿里');

  // 网络恢复后点「重试保存」
  await page.evaluate(() => { window.__sv.fail = false; });
  await page.locator('[data-g=save]').click();
  assert.equal(await status(), '保存中…', '重试进行中显示保存中，不再显示上次的失败');
  assert.equal(await page.locator('[data-g=save]').isHidden(), true);
  await page.waitForFunction(() => window.__sv.calls.length === 5 && window.__sv.gates.length === 1);
  await release();
  await page.waitForFunction(() => document.querySelector('.pa-dirty-text')?.textContent === '已自动保存');
  const after = await page.evaluate(() => window.__mock.presets[0].prompt_order[0].order.map((o) => o.enabled));
  assert.equal(after[7], !before[7], '失败期间的修改最终写入');
  ok('重试保存：进行中显示保存中，成功后写入失败期间的修改');
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
