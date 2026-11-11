// 2.8.5 手填余额：接口查不到余额（不限额度的令牌）时手填，之后按查到的用量扣减；站点列表、编辑窗口显示扣减后的余额。先构建并在仓库根目录运行 8765 静态服务。
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const errors = [];
const ok = (m) => console.log('✓', m);
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  page.on('pageerror', (e) => errors.push(e.message));
  // 不限额度的令牌：上限 1e8，累计用量 500、530、600 美分
  const usage = [500, 530, 600];
  let calls = 0;
  await page.route('https://example.com/v1/dashboard/billing/subscription', (r) => r.fulfill({ json: { hard_limit_usd: 1e8 }, headers: { 'access-control-allow-origin': '*' } }));
  await page.route('https://example.com/v1/dashboard/billing/usage**', (r) => r.fulfill({ json: { total_usage: usage[Math.min(calls++, usage.length - 1)] }, headers: { 'access-control-allow-origin': '*' } }));
  await page.route('**/api/secrets/find', (r) => r.fulfill({ json: { value: 'sk-manual-test' } }));
  await page.goto('http://127.0.0.1:8765/test/site/index.html');
  await page.waitForFunction(() => window.__presetAtelier?.open);
  await page.evaluate(async () => {
    const sec = await import('/test/site/scripts/secrets.js');
    sec.secret_state.api_key_custom.push({ id: 'k1', value: 'est', active: true });
    window.SillyTavern.getContext().extensionSettings.presetAtelier = { sites: [{ id: 's1', name: '中转', source: 'custom', url: 'https://example.com/v1', model: 'claude-x', models: [], secretId: 'k1', keyMask: 'sk-…1' }], activeSiteId: 's1' };
    window.__presetAtelier.open('conn');
  });
  const bal = page.locator('.pa-live .pa-bal');
  await bal.waitFor();
  await bal.locator('[data-a=balq]').click();
  await page.waitForFunction(() => /不限额度/.test(document.querySelector('.pa-live .pa-bal')?.textContent || ''));
  ok('不限额度的令牌：显示「不限额度」和「填余额」');
  await page.locator('.pa-live [data-a=balset]').click();
  await page.locator('.pa-sheet input').fill('$20');
  await page.click('.pa-sheet .pa-btn-primary');
  // 填写后自动查一次作为起点（用量 $5.30），再查一次（$6.00），扣 $0.70
  await page.waitForFunction(() => /\$20\.00/.test(document.querySelector('.pa-live .pa-bal')?.textContent || ''));
  await page.waitForFunction(() => !document.querySelector('.pa-live .pa-bal-q')?.disabled);
  await page.locator('.pa-live [data-a=balq]').click();
  await page.waitForFunction(() => /\$19\.30/.test(document.querySelector('.pa-live .pa-bal')?.textContent || ''), null, { timeout: 10000 });
  assert.match(await page.locator('.pa-plan-sites .pa-site').first().innerText(), /余额 \$19\.30/, '站点列表跟着变');
  ok('填余额后按查到的用量扣减，站点列表同步');
  await page.locator('.pa-live [data-a=edit]').click();
  assert.equal(await page.inputValue('.pa-sheet [data-f=bal]'), '$19.30', '编辑窗口显示扣减后的余额');
  await page.fill('.pa-sheet [data-f=bal]', '五十');
  await page.click('.pa-sheet-actions .pa-btn-primary');
  assert.equal(await page.locator('.pa-sheet [data-f=bal]').count(), 1, '格式不对不保存');
  await page.fill('.pa-sheet [data-f=bal]', '¥300');
  await page.click('.pa-sheet-actions .pa-btn-primary'); await page.waitForTimeout(400);
  const mb = await page.evaluate(() => window.SillyTavern.getContext().extensionSettings.presetAtelier.sites[0].manualBalance);
  assert.deepEqual([mb.amount, mb.cur], [300, '¥']);
  ok('编辑窗口显示当前余额；充值后改成新余额重新计算');
  assert.deepEqual(errors, []);
  console.log('手填余额检查通过');
} finally {
  await browser.close();
}
