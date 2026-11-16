// 2.11.15 账户余额查询放进站点编辑窗口：不是当前连接的站点也能填用户 ID 和系统访问令牌，保存后立刻查这个站点。
// 先构建并在仓库根目录运行 8765 静态服务。用法：PW_CHROME=/usr/bin/chromium node test/acct-edit-check.mjs
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const errors = [];
const ok = (m) => console.log('✓', m);
const cors = { 'access-control-allow-origin': '*' };
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/api/secrets/find', (r) => r.fulfill({ status: 403, body: '' }));
  // 梧桐（不是当前连接）的账户：剩余 41190000 = $82.38
  const seen = [];
  await page.route('https://b.example.com/api/user/self', (r) => {
    seen.push(r.request().headers());
    const auth = r.request().headers().authorization;
    r.fulfill({ json: auth === 'Bearer tok-b' ? { success: true, data: { quota: 41190000, used_quota: 0 } } : { success: false, message: 'access token 无效' }, headers: cors });
  });
  await page.route('https://b.example.com/api/status', (r) => r.fulfill({ json: { success: true, data: { quota_per_unit: 500000 } }, headers: cors }));
  await page.goto('http://127.0.0.1:8765/test/site/index.html');
  await page.waitForFunction(() => window.__mcdonalds?.open);
  await page.evaluate(async () => {
    const sec = await import('/test/site/scripts/secrets.js');
    sec.secret_state.api_key_custom.push({ id: 'k1', value: '-k1', active: true }, { id: 'k2', value: '-k2', active: false });
    window.SillyTavern.getContext().extensionSettings.mcdonalds = { sites: [
      { id: 's1', name: '月栖', source: 'custom', url: 'https://example.com/v1', model: 'm', models: [], secretId: 'k1' },
      { id: 's2', name: '梧桐', source: 'custom', url: 'https://b.example.com/v1', model: 'm', models: [], secretId: 'k2' },
      { id: 's3', name: '深海', source: 'deepseek', url: '', model: 'deepseek-chat', models: [], secretId: 'k4' }], activeSiteId: 's1' };
    window.__mcdonalds.open('conn');
  });
  const S = () => page.evaluate(() => window.SillyTavern.getContext().extensionSettings.mcdonalds);
  const vault = () => page.evaluate(async () => (await import('/test/site/scripts/secrets.js')).secret_state.api_key_custom.map((x) => ({ ...x })));
  const row = (name) => page.locator('.pa-plan-sites .pa-site', { hasText: name }).first();
  const sheet = (name) => page.locator(`.pa-sheet:has-text("编辑「${name}」")`);

  // DeepSeek 站点没有这一栏
  await row('深海').locator('[data-a=edit]').first().click();
  await sheet('深海').waitFor();
  assert.equal(await sheet('深海').locator('[data-f=uid]').isVisible(), false);
  await sheet('深海').locator('.pa-btn >> text=取消').click();
  await sheet('深海').waitFor({ state: 'detached' });
  ok('只有中转站类型显示「账户余额查询」');

  // 只填用户 ID 不填令牌：不保存
  await row('梧桐').locator('[data-a=edit]').first().click();
  const w = sheet('梧桐');
  await w.waitFor();
  assert.ok(await w.locator('[data-f=uid]').isVisible());
  await w.locator('[data-f=uid]').fill('9');
  await w.locator('.pa-btn-primary').click();
  assert.equal(await w.count(), 1, '只填用户 ID 不保存');
  ok('只填用户 ID、没填令牌时提示，不保存');

  await w.locator('[data-f=token]').fill('Bearer tok-b');
  await w.locator('.pa-btn-primary').click();
  await w.waitFor({ state: 'detached' });
  await page.waitForFunction(() => /余额 \$82\.38/.test([...document.querySelectorAll('.pa-plan-sites .pa-site')].find((x) => x.textContent.includes('梧桐'))?.textContent || ''));
  const s2 = (await S()).sites[1];
  assert.equal(s2.acct.uid, '9');
  assert.ok(!JSON.stringify(await S()).includes('tok-b'), '令牌不写进酒馆设置文件');
  const v = await vault();
  assert.ok(v.some((x) => x.id === s2.acct.secretId && /梧桐·系统访问令牌/.test(x.label)), '令牌存进酒馆密钥库');
  assert.equal(v.find((x) => x.active)?.id, 'k1', '当前连接的密钥不变');
  assert.equal((await S()).activeSiteId, 's1', '没有切换站点');
  assert.equal(seen.at(-1).authorization, 'Bearer tok-b');
  assert.equal(seen.at(-1)['new-api-user'], '9');
  ok('不是当前连接的站点：在编辑窗口填用户 ID 和令牌，保存后立刻查到账户余额，不切换连接');

  // 再打开：令牌已保存，留空不改；只改用户 ID
  await row('梧桐').locator('[data-a=edit]').first().click();
  await w.waitFor();
  assert.match(await w.locator('[data-f=token]').getAttribute('placeholder'), /已保存/);
  assert.equal(await w.locator('[data-f=uid]').inputValue(), '9');
  await w.locator('[data-f=uid]').fill('10');
  await w.locator('.pa-btn-primary').click();
  await w.waitFor({ state: 'detached' });
  await page.waitForFunction(() => window.SillyTavern.getContext().extensionSettings.mcdonalds.sites[1].acct?.uid === '10');
  assert.equal((await S()).sites[1].acct.secretId, s2.acct.secretId, '令牌留空时不改');
  await page.waitForFunction(() => /access token 无效|余额/.test(document.querySelector('.pa-plan-sites')?.textContent || ''));
  ok('再次编辑：令牌留空不改，只改用户 ID');

  // 停用：删除令牌
  await row('梧桐').locator('[data-a=edit]').first().click();
  await w.waitFor();
  await w.locator('[data-f=acctoff]').click();
  assert.ok(await w.locator('[data-f=token]').isDisabled());
  assert.match(await w.innerText(), /保存后停用/);
  await w.locator('.pa-btn-primary').click();
  await w.waitFor({ state: 'detached' });
  await page.waitForFunction(() => !window.SillyTavern.getContext().extensionSettings.mcdonalds.sites[1].acct);
  assert.ok(!(await vault()).some((x) => x.id === s2.acct.secretId), '停用后从密钥库删除');
  ok('编辑窗口里点「停用」并保存，删除令牌');
  assert.deepEqual(errors, []);
  console.log('编辑窗口账户余额检查通过');
} finally {
  await browser.close();
}
