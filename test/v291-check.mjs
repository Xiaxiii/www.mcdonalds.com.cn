// 2.9.1 手机上的几处：长条目名省略、撤销与完成在页头、多选栏含「复制」并顶替底部导航、模型行不挤、
// 余额报错不跨站点、「显示余额」开关、备注随内容增高。先构建并在仓库根目录运行 8765 静态服务。
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const errors = [];
const ok = (m) => console.log('✓', m);
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 760 }, isMobile: true, hasTouch: true });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('https://a.example/**', (r) => r.abort('failed'));
  await page.route('**/proxy/**', (r) => r.fulfill({ status: 404, body: '' }));
  await page.route('**/api/secrets/find', (r) => r.fulfill({ json: { value: 'sk-x' } }));
  await page.route('**/api/backends/chat-completions/status', (r) => r.fulfill({ json: { error: true, data: { data: [] } } }));
  await page.goto('http://127.0.0.1:8765/test/site/index.html');
  await page.waitForFunction(() => window.__mcdonalds?.open);
  await page.evaluate(async () => {
    const m = window.__mock;
    for (const p of [m.presets[m.presets.length - 1], m.live]) p.prompts.filter((x) => x.content)[0].name = '角色的日记（小剧场）[来自某个预设 v3.2 正式版] 很长很长很长的名字';
    const sec = await import('/test/site/scripts/secrets.js');
    sec.secret_state.api_key_custom.push({ id: 'k1', value: 'est', active: true });
    m.live.custom_url = 'https://a.example/v1';
    const models = ['「甲站」按次vt-model-3.1-pro-preview[0.086]', 'plain-model'];
    document.body.insertAdjacentHTML('beforeend', `<div hidden><select id="main_api"><option value="openai">openai</option></select><select id="chat_completion_source"><option value="custom">custom</option></select><input id="custom_api_url_text"><input id="custom_model_id"><select id="model_custom_select">${models.map((x) => `<option value="${x}">${x}</option>`).join('')}</select><button id="api_button_openai"></button></div>`);
    $('#main_api').val('openai'); $('#chat_completion_source').val('custom');
    $('#custom_api_url_text').on('input', function () { m.live.custom_url = this.value; });
    window.SillyTavern.getContext().extensionSettings.mcdonalds = { sites: [
      { id: 'a', name: '甲站', source: 'custom', url: 'https://a.example/v1', model: models[0], models, secretId: 'k1', note: '甲vt0.17/甲as0.15/乙vt0.2/乙ais0.16/丙ep0.18/丁0.15/戊0.2/己0.3' },
      { id: 'b', name: '乙站', source: 'custom', url: 'https://b.example/v1', model: 'plain-model', models: ['plain-model'] }], activeSiteId: 'a' };
    window.__mcdonalds.open('organize');
  });
  await page.locator('.pa-gname').first().click();
  const row = page.locator('.pa-row', { hasText: '角色的日记' });
  const r = await row.evaluate((e) => ({ name: e.querySelector('.pa-name').getBoundingClientRect().right, eye: e.querySelector('.pa-peek').getBoundingClientRect().left }));
  assert.ok(r.name <= r.eye, `长条目名不压住眼睛图标（${JSON.stringify(r)}）`);
  ok('长条目名末尾省略');

  await row.locator('.pa-check').click();
  assert.equal(await page.locator('.pa-selbar [data-sel="copy"]').isVisible(), true);
  assert.equal(await page.locator('.pa-tabs').isVisible(), false, '多选时底部导航让位');
  await page.locator('.pa-selbar [data-sel="on"], .pa-selbar [data-sel="off"]').click();
  await page.locator('.pa-top .pa-savebar [data-g="undo"]').waitFor();
  assert.equal(await page.locator('.pa-shell > .pa-savebar').count(), 0, '底部没有批次栏');
  await page.locator('.pa-selbar [data-sel="none"]').click().catch(() => {});
  assert.equal(await page.locator('.pa-tabs').isVisible(), true);
  ok('撤销、完成在页头；多选栏含「复制」，多选时占用底部导航的位置');

  await page.evaluate(() => window.__mcdonalds.open('conn'));
  await page.locator('.pa-live [data-a="livemodel"]').click();
  const item = page.locator('.pa-sheet .pa-mpick-item[data-m^="「甲站」"]');
  const box = await item.evaluate((e) => { const b = e.getBoundingClientRect(), l = e.querySelector('.pa-mlabel').getBoundingClientRect(); return { top: l.top - b.top, bottom: b.bottom - l.bottom }; });
  assert.ok(box.top >= 8 && box.bottom >= 8, `模型行上下留白（${JSON.stringify(box)}）`);
  await page.click('.pa-sheet-x');
  await page.waitForFunction(() => !document.querySelector('.pa-sheet'));
  ok('模型行两行内容上下各留白 8px 以上');

  await page.locator('.pa-live [data-a=balq]').click();
  await page.waitForFunction(() => /跨域/.test(document.querySelector('.pa-live .pa-bal')?.textContent || ''));
  await page.locator('.pa-plan-sites .pa-site', { hasText: '乙站' }).locator('[data-a=use]').click();
  await page.waitForFunction(() => /乙站/.test(document.querySelector('.pa-live header b')?.textContent || ''), null, { timeout: 25000 });
  assert.doesNotMatch(await page.locator('.pa-live').innerText(), /跨域/, '换站点后不显示上一个站点的报错');
  ok('余额报错不带到下一个站点');

  await page.locator('[data-o="balshow"]').uncheck();
  assert.equal(await page.locator('.pa-live .pa-bal').count(), 0);
  assert.match(await page.locator('.pa-plan-sites .pa-site', { hasText: '甲站' }).innerText(), /vt-model-3\.1-pro-preview/);
  assert.equal(await page.evaluate(() => window.SillyTavern.getContext().extensionSettings.mcdonalds.balanceShow), false);
  await page.locator('.pa-plan-sites .pa-site', { hasText: '甲站' }).locator('.pa-site-name').click();
  assert.equal(await page.locator('.pa-sheet [data-f=bal]').isVisible(), false);
  const note = page.locator('.pa-sheet [data-f=note]');
  await page.waitForTimeout(500);
  const n = await note.evaluate((e) => ({ sh: e.scrollHeight, ch: e.clientHeight, lines: Math.round(e.clientHeight / parseFloat(getComputedStyle(e).lineHeight)) }));
  assert.ok(n.sh <= n.ch + 2 && n.lines >= 2, `长备注完整显示（${JSON.stringify(n)}）`);
  await page.click('.pa-sheet-x');
  await page.locator('[data-o="balshow"]').check();
  await page.locator('.pa-live .pa-bal').waitFor();
  ok('「显示余额」可开关；备注随内容增高');
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
