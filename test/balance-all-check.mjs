// 2.11.12 一键查询全部站点的余额：站点标题右边点「余额」，每个站点（多密钥站点的每个分组）用自己的密钥查，不切换当前连接。
// 先构建并在仓库根目录运行 8765 静态服务。用法：PW_CHROME=/usr/bin/chromium node test/balance-all-check.mjs
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const errors = [];
const ok = (m) => console.log('✓', m);
const cors = { 'access-control-allow-origin': '*' };
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  page.on('pageerror', (e) => errors.push(e.message));
  // 密钥库读回：按编号给全文
  const keys = { k1: 'sk-k1', k2: 'sk-k2', k3: 'sk-k3', k4: 'sk-k4' };
  await page.route('**/api/secrets/find', (r) => {
    const v = keys[r.request().postDataJSON()?.id];
    return v ? r.fulfill({ json: { value: v } }) : r.fulfill({ status: 404, body: '' });
  });
  // 每个站点收到的密钥
  const hits = [];
  const billing = (host, table) => page.route(`https://${host}/v1/dashboard/billing/**`, (r) => {
    const auth = r.request().headers().authorization || '';
    hits.push({ host, auth });
    const row = table[auth];
    if (row === 'abort') return r.abort();
    if (!row) return r.fulfill({ status: 401, body: '', headers: cors });
    if (r.request().url().includes('/subscription')) return r.fulfill({ json: { hard_limit_usd: row.hard }, headers: cors });
    r.fulfill({ json: { total_usage: row.used }, headers: cors });
  });
  // 月栖 $40.00；梧桐「按次」跨域被拦，经酒馆后台转发查到 $7.50，「按量」密钥无效
  await billing('example.com', { 'Bearer sk-k1': { hard: 50, used: 1000 } });
  await billing('b.example.com', { 'Bearer sk-k2': 'abort' });
  await billing('c.example.com', {});
  await page.route('https://b.example.com/api/**', (r) => { hits.push({ host: 'b.example.com', auth: r.request().headers().authorization || '' }); r.fulfill({ status: 404, body: '', headers: cors }); });
  await page.route('https://c.example.com/api/**', (r) => { hits.push({ host: 'c.example.com', auth: r.request().headers().authorization || '' }); r.fulfill({ status: 404, body: '', headers: cors }); });
  const via = [];
  await page.route('**/api/backends/chat-completions/status', (r) => {
    const b = r.request().postDataJSON();
    via.push(b);
    if (b.secret_id === 'k2' && b.custom_url.startsWith('https://b.example.com/v1/dashboard/billing/subscription')) return r.fulfill({ json: { hard_limit_usd: 10 } });
    if (b.secret_id === 'k2' && b.custom_url.startsWith('https://b.example.com/v1/dashboard/billing/usage')) return r.fulfill({ json: { total_usage: 250 } });
    r.fulfill({ json: { error: true } });
  });
  await page.route('https://api.deepseek.com/user/balance', (r) => {
    hits.push({ host: 'api.deepseek.com', auth: r.request().headers().authorization || '' });
    r.fulfill({ json: { balance_infos: [{ currency: 'CNY', total_balance: '12.5' }] }, headers: cors });
  });
  await page.goto('http://127.0.0.1:8765/test/site/index.html');
  await page.waitForFunction(() => window.__mcdonalds?.open);
  await page.evaluate(async () => {
    const sec = await import('/test/site/scripts/secrets.js');
    sec.secret_state.api_key_custom.push({ id: 'k1', value: '-k1', active: true }, { id: 'k2', value: '-k2', active: false }, { id: 'k3', value: '-k3', active: false });
    window.SillyTavern.getContext().extensionSettings.mcdonalds = { sites: [
      { id: 's1', name: '月栖', source: 'custom', url: 'https://example.com/v1', model: 'm', models: [], secretId: 'k1', keyMask: 'sk-…k1' },
      { id: 's2', name: '梧桐', source: 'custom', url: 'https://b.example.com/v1', keyId: 'g1', keys: [
        { id: 'g1', name: '按次', secretId: 'k2', model: 'x' }, { id: 'g2', name: '按量', secretId: 'k3', model: 'y' }] },
      { id: 's3', name: '深海', source: 'deepseek', url: '', model: 'deepseek-chat', models: [], secretId: 'k4' },
      { id: 's4', name: '空站', source: 'custom', url: 'https://c.example.com/v1', model: 'm', models: [], secretId: null },
      { id: 's5', name: '克劳德', source: 'claude', url: '', model: 'c', models: [], secretId: 'k9' }], activeSiteId: 's1' };
    window.__mcdonalds.open('conn');
  });
  const row = (name) => page.locator('.pa-plan-sites .pa-site', { hasText: name }).first();
  const btn = page.locator('.pa-plan-sites [data-a=balall]');
  await btn.waitFor();
  assert.equal(await btn.innerText(), '余额');
  assert.match(await row('月栖').innerText(), /余额未知/);
  ok('站点标题右边有「余额」按钮');

  await btn.click();
  await page.waitForFunction(() => !document.querySelector('.pa-plan-sites [data-a=balall]')?.disabled && /查询失败/.test(document.querySelector('.pa-plan-sites')?.textContent || ''));
  assert.match(await row('月栖').innerText(), /余额 \$40\.00/);
  assert.match(await row('深海').innerText(), /余额 ¥12\.50/);
  assert.match(await row('空站').innerText(), /查询失败：没有保存密钥，点站点名填写/);
  assert.match(await row('梧桐').innerText(), /余额 \$7\.50 · 1 组查询失败/);
  assert.doesNotMatch(await row('克劳德').innerText(), /余额 |查询/);
  ok('每个站点各自查：中转站、DeepSeek 查到余额，没有密钥的站点写明原因，Claude 不查');

  await row('梧桐').locator('[data-a=sitefold]').click();
  const lines = await row('梧桐').locator('.pa-kline').allInnerTexts();
  assert.match(lines[0], /按次[\s\S]*余额 \$7\.50/);
  assert.match(lines[1], /按量[\s\S]*查询失败：密钥无效或无权查询余额/);
  ok('多密钥站点每个分组分别查，展开后各写各的余额或原因');

  const v2 = via.find((b) => b.custom_url.includes('b.example.com'));
  assert.equal(v2.secret_id, 'k2');
  assert.ok(!via.some((b) => b.custom_url.includes('c.example.com')), '没有密钥的站点不经酒馆后台转发（会用上当前连接的密钥）');
  for (const h of hits) assert.ok(h.host === 'example.com' ? h.auth === 'Bearer sk-k1' : h.auth !== 'Bearer sk-k1', `当前连接的密钥只发给自己的站点：${h.host}`);
  assert.ok(hits.some((h) => h.host === 'api.deepseek.com' && h.auth === 'Bearer sk-k4'));
  const active = await page.evaluate(async () => (await import('/test/site/scripts/secrets.js')).secret_state.api_key_custom.find((x) => x.active)?.id);
  assert.equal(active, 'k1');
  ok('每个站点用自己的密钥，跨域被拦时经酒馆后台按编号转发；当前连接的密钥不变');

  assert.match(await page.locator('.pa-live .pa-bal').innerText(), /\$40\.00/);
  ok('当前连接的余额卡片一起更新');

  // 再查一次：之前失败的站点修好后，原因消失
  keys.k3 = 'sk-k3';
  await page.unroute('https://b.example.com/v1/dashboard/billing/**');
  await billing('b.example.com', { 'Bearer sk-k2': 'abort', 'Bearer sk-k3': { hard: 5, used: 100 } });
  await btn.click();
  await page.waitForFunction(() => /按量[\s\S]*余额 \$4\.00/.test(document.querySelector('.pa-plan-sites')?.textContent || ''));
  assert.doesNotMatch(await row('梧桐').innerText(), /组查询失败/);
  ok('再次查询：修好的分组显示余额，失败标记消失');

  // 关掉「显示余额」后按钮不出现
  await page.locator('[data-o=balshow]').click();
  await page.waitForFunction(() => !document.querySelector('.pa-plan-sites [data-a=balall]'));
  ok('关掉「显示余额」后不显示「余额」按钮');
  assert.deepEqual(errors, []);
  console.log('一键查询全部余额检查通过');
} finally {
  await browser.close();
}
