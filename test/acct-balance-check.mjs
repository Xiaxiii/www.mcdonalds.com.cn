// 2.11.4 账户余额：中转站的密钥不限额度时，用站点「个人设置」中的用户 ID 和系统访问令牌查整个账户的余额（/api/user/self）。
// 先构建并在仓库根目录运行 8765 静态服务。用法：PW_CHROME=/usr/bin/chromium node test/acct-balance-check.mjs
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const errors = [];
const ok = (m) => console.log('✓', m);
const cors = { 'access-control-allow-origin': '*' };
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('https://example.com/v1/dashboard/billing/subscription', (r) => r.fulfill({ json: { hard_limit_usd: 1e8 }, headers: cors }));
  await page.route('https://example.com/v1/dashboard/billing/usage**', (r) => r.fulfill({ json: { total_usage: 500 }, headers: cors }));
  await page.route('**/api/secrets/find', (r) => r.fulfill({ json: { value: 'sk-acct-test' } }));
  await page.route('https://example.com/api/status', (r) => r.fulfill({ json: { success: true, data: { quota_per_unit: 500000, quota_display_type: 'USD' } }, headers: cors }));
  // 站点账户：剩余 41190000、已用 11145000（按 500000 = $1 折算为 $82.38、$22.29）
  const seen = [];
  let self = { quota: 41190000, used_quota: 11145000 }, blockDirect = false, reject = false;
  await page.route('https://example.com/api/user/self', (r) => {
    if (blockDirect) return r.abort();
    seen.push(r.request().headers());
    r.fulfill({ json: reject ? { success: false, message: '无权进行此操作，access token 无效' } : { success: true, data: self }, headers: cors });
  });
  // 跨域被拦时经酒馆后台转发：令牌和用户 ID 写在附加请求头里
  const via = [];
  await page.route('**/api/backends/chat-completions/status', (r) => {
    const b = r.request().postDataJSON();
    via.push(b);
    if (b.custom_url === 'https://example.com/api/user/self#') return r.fulfill({ json: { success: true, data: self } });
    r.fulfill({ json: { error: true } });
  });
  await page.goto('http://127.0.0.1:8765/test/site/index.html');
  await page.waitForFunction(() => window.__mcdonalds?.open);
  await page.evaluate(async () => {
    const sec = await import('/test/site/scripts/secrets.js');
    sec.secret_state.api_key_custom.push({ id: 'k1', value: 'est', active: true });
    window.SillyTavern.getContext().extensionSettings.mcdonalds = { sites: [{ id: 's1', name: '月栖', source: 'custom', url: 'https://example.com/v1', model: 'claude-x', models: [], secretId: 'k1', keyMask: 'sk-…1' }], activeSiteId: 's1' };
    window.__mcdonalds.open('conn');
  });
  const bal = page.locator('.pa-live .pa-bal');
  await bal.waitFor();
  await bal.locator('[data-a=balq]').click();
  await page.waitForFunction(() => /不限额度/.test(document.querySelector('.pa-live .pa-bal')?.textContent || ''));
  assert.match(await bal.innerText(), /自动查账户余额/);
  ok('不限额度的密钥：余额卡片上有「自动查账户余额」');

  await bal.locator('[data-a=balacct]').click();
  await page.locator('.pa-sheet:has-text("查询账户余额") .pa-btn-primary').click();
  assert.equal(await page.locator('.pa-sheet [data-f=token]').count(), 1, '没填令牌不保存');
  await page.fill('.pa-sheet [data-f=uid]', '7');
  await page.fill('.pa-sheet [data-f=token]', 'Bearer tok-123');
  await page.locator('.pa-sheet:has-text("查询账户余额") .pa-btn-primary').click();
  await page.waitForFunction(() => /\$82\.38/.test(document.querySelector('.pa-live .pa-bal')?.textContent || ''));
  assert.equal(seen.at(-1).authorization, 'Bearer tok-123');
  assert.equal(seen.at(-1)['new-api-user'], '7');
  assert.match(await bal.innerText(), /账户/);
  assert.match(await page.locator('.pa-plan-sites .pa-site').first().innerText(), /余额 \$82\.38/);
  const st = await page.evaluate(() => window.SillyTavern.getContext().extensionSettings.mcdonalds.sites[0]);
  assert.equal(st.acct.uid, '7');
  assert.ok(!JSON.stringify(st).includes('tok-123'), '令牌不写进酒馆设置文件');
  ok('填用户 ID 和系统访问令牌后查到账户余额 $82.38（与站点钱包页一致），令牌只在本浏览器');

  // 用了 $0.50 之后再查：上一轮用量按账户已用额度算
  self = { quota: 40940000, used_quota: 11395000 };
  await bal.locator('[data-a=balq]').click();
  await page.waitForFunction(() => /\$81\.88/.test(document.querySelector('.pa-live .pa-bal')?.textContent || ''));
  assert.match(await bal.innerText(), /\$0\.50/);
  ok('再次查询：余额更新，按账户已用额度算出这一段用量 $0.50');

  // 站点不允许跨域：经酒馆后台转发
  blockDirect = true;
  self = { quota: 40000000, used_quota: 12335000 };
  await bal.locator('[data-a=balq]').click();
  await page.waitForFunction(() => /\$80\.00/.test(document.querySelector('.pa-live .pa-bal')?.textContent || ''));
  const v = via.find((b) => b.custom_url === 'https://example.com/api/user/self#');
  assert.match(v.custom_include_headers, /Authorization: "Bearer tok-123"/);
  assert.match(v.custom_include_headers, /New-Api-User: "7"/);
  ok('站点不允许跨域时经酒馆后台转发，令牌和用户 ID 放在附加请求头里');

  // 令牌不对：显示站点给的原因
  blockDirect = false; reject = true;
  await bal.locator('[data-a=balq]').click();
  await page.waitForFunction(() => /access token 无效/.test(document.querySelector('.pa-live .pa-bal')?.textContent || ''));
  ok('令牌不对时显示站点返回的原因');

  // 停用：回到按密钥查询
  reject = false;
  await bal.locator('[data-a=balacct]').click();
  await page.locator('.pa-sheet:has-text("查询账户余额") .pa-btn >> text=停用').click();
  await page.waitForFunction(() => /不限额度/.test(document.querySelector('.pa-live .pa-bal')?.textContent || ''));
  assert.equal(await page.evaluate(() => window.SillyTavern.getContext().extensionSettings.mcdonalds.sites[0].acct), undefined);
  assert.equal(await page.evaluate(() => Object.keys(localStorage).some((k) => localStorage.getItem(k) === 'tok-123')), false, '停用后令牌删除');
  ok('停用后删除令牌，回到按密钥查询');
  assert.deepEqual(errors, []);
  console.log('账户余额检查通过');
} finally {
  await browser.close();
}
