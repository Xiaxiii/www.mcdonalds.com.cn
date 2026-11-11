// 2.8.0：余额记录、提示点按关闭、模型选择框搜索时可收起与长名换行、缝合两种布局。先构建并在仓库根目录运行 8765 静态服务。
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const errors = [];
const ok = (m) => console.log('✓', m);
const LONG = 'claude-sonnet-4-5-20250929-thinking-extended-context-1m-beta-preview';
const TAGGED = '「爱琴海」按次vt-claude-opus-4-1-20250805-thinking[0.086]';
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  page.on('pageerror', (e) => errors.push(e.message));
  // 中转站余额：上限 $20，累计用量按顺序 500、512、530 美分
  let usage = [500, 512, 530];
  let calls = 0;
  await page.route('https://example.com/v1/dashboard/billing/subscription', (r) => r.fulfill({ json: { hard_limit_usd: 20 }, headers: { 'access-control-allow-origin': '*' } }));
  await page.route('https://example.com/v1/dashboard/billing/usage**', (r) => {
    assert.equal(r.request().headers().authorization, 'Bearer sk-balance-test');
    r.fulfill({ json: { total_usage: usage[Math.min(calls++, usage.length - 1)] }, headers: { 'access-control-allow-origin': '*' } });
  });
  await page.route('**/api/secrets/find', (r) => r.fulfill({ json: { value: 'sk-balance-test' } }));
  // 酒馆后台：拉模型列表；网址带「#」的是经酒馆查询余额（relay 为站点的回应，null 表示站点出错）
  let relay = null;
  const relayed = [];
  await page.route('**/api/backends/chat-completions/status', (r) => {
    const b = r.request().postDataJSON();
    if (/#$/.test(b.custom_url || '')) { relayed.push(b); return r.fulfill({ json: relay ? relay(b.custom_url) : { error: true, data: { data: [] } } }); }
    r.fulfill({ json: { data: [{ id: 'claude-x' }, { id: LONG }, { id: 'gemini-z' }, { id: 'gemini-y' }, { id: TAGGED }] } });
  });
  await page.goto('http://127.0.0.1:8765/test/site/index.html');
  await page.waitForFunction(() => window.__mcdonalds?.open);
  await page.evaluate(async () => {
    const sec = await import('/test/site/scripts/secrets.js');
    sec.secret_state.api_key_custom.push({ id: 'k1', value: 'est', active: true });
    window.SillyTavern.getContext().extensionSettings.mcdonalds = { sites: [], activeSiteId: null };
    window.__mcdonalds.open('conn');
  });
  const card = page.locator('[data-page=conn] .pa-bal');
  await card.waitFor();
  assert.match(await card.innerText(), /尚未查询/);
  await card.locator('[data-a=balq]').click();
  await page.waitForFunction(() => /\$15\.00/.test(document.querySelector('.pa-bal-total')?.textContent || ''));
  await page.locator('.pa-bal [data-a=balq]').click();
  await page.waitForFunction(() => /\$14\.88/.test(document.querySelector('.pa-bal-total')?.textContent || ''));
  let txt = await page.locator('.pa-bal').innerText();
  assert.match(txt, /距上次查询\s*\$0\.120/, '手动查询时，标为「距上次查询」');
  assert.match(txt, /近 24 小时\s*\$0\.120/);
  // 打开「每轮生成后自动查询」后，生成结束自动再查一次，标为「上一轮」
  await page.locator('.pa-bal [data-o=balauto]').check({ force: true });
  assert.equal(await page.evaluate(() => window.SillyTavern.getContext().extensionSettings.mcdonalds.balanceAuto), true);
  await page.evaluate(async () => {
    // 记录提前一小时，跳过 10 秒节流
    const k = Object.keys(localStorage).find((x) => x.startsWith('mcdonalds:balance:'));
    const list = JSON.parse(localStorage.getItem(k));
    list.forEach((r) => { r.t -= 3600e3; });
    localStorage.setItem(k, JSON.stringify(list));
    const c = window.SillyTavern.getContext();
    await c.eventSource.emit(c.eventTypes.GENERATION_ENDED);
  });
  await page.waitForFunction(() => /\$14\.70/.test(document.querySelector('.pa-bal-total')?.textContent || ''), null, { timeout: 15000 });
  txt = await page.locator('.pa-bal').innerText();
  assert.match(txt, /上一轮\s*\$0\.180/);
  assert.match(txt, /近 24 小时\s*\$0\.300/);
  assert.doesNotMatch(txt, /48 小时/, '只列上一轮和近 24 小时');
  await page.screenshot({ path: new URL('./shots/v280-balance.png', import.meta.url).pathname });
  ok('余额：当前余额、上一轮、近 24 小时用量；生成结束自动查询');

  // 跨域失败给出原因
  await page.route('https://example.com/v1/dashboard/billing/subscription', (r) => r.abort('failed'));
  await page.route('**/proxy/**', (r) => r.fulfill({ status: 404, body: '' }));
  await page.locator('.pa-bal [data-a=balq]').click();
  await page.waitForFunction(() => /跨域/.test(document.querySelector('.pa-bal')?.textContent || ''));
  ok('余额：请求被拦截、经酒馆也查不到时说明原因');

  // 2.8.8 浏览器拦截时经酒馆后台查询：用当前连接的密钥编号，网址末尾带「#」
  await page.route('https://example.com/v1/dashboard/billing/usage**', (r) => r.abort('failed'));
  relay = (u) => /subscription#$/.test(u) ? { hard_limit_usd: 20 } : { total_usage: 600 };
  relayed.length = 0;
  await page.locator('.pa-bal [data-a=balq]').click();
  await page.waitForFunction(() => /\$14\.00/.test(document.querySelector('.pa-bal-total')?.textContent || ''));
  assert.equal(relayed[0].secret_id, 'k1');
  assert.equal(relayed[0].custom_url, 'https://example.com/v1/dashboard/billing/subscription#');
  assert.doesNotMatch(await page.locator('.pa-bal').innerText(), /跨域/);
  ok('余额：站点不允许跨域时经酒馆后台查询');

  // 提示点按关闭：真实 toastr 行为由酒馆提供，这里检查调用参数与点按关闭
  await page.evaluate(() => {
    window.__opts = [];
    window.__cleared = 0;
    const el = document.createElement('div');
    el.className = 'toast'; el.id = 'tt'; el.textContent = 'x';
    let c = document.getElementById('toast-container');
    if (!c) { c = document.createElement('div'); c.id = 'toast-container'; c.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999'; document.body.append(c); }
    c.append(el);
    window.toastr = { success: (m, t2, o) => { window.__opts.push(o); return [el]; }, clear: () => { window.__cleared++; el.remove(); } };
  });
  await page.locator('[data-page=conn] [data-a=livefetch]').click();
  await page.waitForFunction(() => window.__opts.length > 0);
  assert.equal(await page.evaluate(() => window.__opts[0].tapToDismiss), true);
  const z = await page.evaluate(() => [+getComputedStyle(document.getElementById('toast-container')).zIndex, +getComputedStyle(document.getElementById('mcd-root')).zIndex]);
  assert.ok(z[0] > z[1], `面板打开时提示在面板之上（${z}）`);
  await page.locator('#tt').click();
  assert.equal(await page.evaluate(() => window.__cleared), 1);
  ok('提示：面板打开时浮在面板之上，点按即关闭');

  // 模型选择框：长名换行；搜索时段落可收起，换搜索词重新展开
  await page.click('[data-a=livemodel]');
  await page.locator('.pa-mpick-item').first().waitFor();
  const long = page.locator('.pa-mpick-item', { hasText: LONG });
  const box = await long.evaluate((e) => ({ sw: e.scrollWidth, cw: e.clientWidth, h: e.getBoundingClientRect().height }));
  assert.ok(box.sw <= box.cw + 1 && box.h > 44, `长模型名换行显示（${JSON.stringify(box)}）`);
  // 2.8.8 带标签的模型名：上行模型名，下行标签；两行都完整显示
  const tagged = page.locator(`.pa-mpick-item[data-m="${TAGGED}"]`);
  assert.equal(await tagged.locator('.pa-mn').innerText(), 'vt-claude-opus-4-1-20250805-thinking');
  assert.deepEqual(await tagged.locator('.pa-mtags > span').allInnerTexts(), ['爱琴海', '按次', '0.086']);
  const tb = await tagged.evaluate((e) => ({ sh: e.scrollHeight, ch: e.clientHeight, tags: e.querySelector('.pa-mtags').getBoundingClientRect().bottom, row: e.getBoundingClientRect().bottom }));
  assert.ok(tb.sh <= tb.ch + 1 && tb.tags <= tb.row, `标签行完整显示（${JSON.stringify(tb)}）`);
  await page.locator('.pa-kview [data-v=cat]').click();
  await page.fill('.pa-mfind input', 'gemini');
  assert.equal(await page.locator('.pa-mpick-item:not(.pa-mpick-custom)').count(), 2);
  await page.locator('.pa-ksec', { hasText: 'Gemini' }).click();
  assert.equal(await page.locator('.pa-mpick-item:not(.pa-mpick-custom)').count(), 0, '搜索时可收起段落');
  assert.equal(await page.locator('.pa-ksec', { hasText: 'Gemini' }).getAttribute('aria-expanded'), 'false');
  await page.fill('.pa-mfind input', 'gem');
  assert.equal(await page.locator('.pa-mpick-item:not(.pa-mpick-custom)').count(), 2, '换搜索词后重新展开');
  await page.screenshot({ path: new URL('./shots/v280-picker.png', import.meta.url).pathname });
  await page.keyboard.press('Escape');
  ok('模型选择框：长名换行，带标签的名字分两行；搜索时可收起段落');

  // 缝合：分栏 ⇄ 切换
  await page.evaluate(() => window.__mcdonalds.open('suture'));
  await page.waitForTimeout(300);
  const btn = page.locator('.pa-top [data-g=sulayout]');
  assert.ok(await btn.isVisible(), '缝合页顶栏有布局按钮');
  assert.equal(await page.locator('[data-page=suture] .pa-swbar').isVisible(), false, '默认分栏');
  assert.ok(await page.locator('[data-page=suture] .pa-src').isVisible() && await page.locator('[data-page=suture] .pa-dst').isVisible());
  await btn.click();
  assert.equal(await page.evaluate(() => window.SillyTavern.getContext().extensionSettings.mcdonalds.sutureLayout), 'switch');
  assert.ok(await page.locator('[data-page=suture] .pa-swbar').isVisible());
  assert.ok(await page.locator('[data-page=suture] .pa-src').isVisible());
  assert.equal(await page.locator('[data-page=suture] .pa-dst').isVisible(), false, '切换布局一次显示一栏');
  const srcH = await page.locator('[data-page=suture] .pa-src').evaluate((e) => e.getBoundingClientRect().height);
  assert.ok(srcH > 400, `单栏占满高度（${srcH}）`);
  await page.locator('[data-page=suture] .pa-src-list .pa-row').first().click().catch(() => {});
  await page.locator('.pa-swbar [data-sw=dst]').click();
  assert.ok(await page.locator('[data-page=suture] .pa-dst').isVisible());
  assert.equal(await page.locator('[data-page=suture] .pa-src').isVisible(), false);
  await page.screenshot({ path: new URL('./shots/v280-suture-switch.png', import.meta.url).pathname });
  await page.evaluate(() => window.__mcdonalds.open('conn'));
  assert.equal(await btn.isVisible(), false, '其他页不显示布局按钮');
  await page.evaluate(() => window.__mcdonalds.open('suture'));
  assert.ok(await page.locator('[data-page=suture] .pa-swbar').isVisible(), '布局记在设置里');
  await btn.click();
  assert.equal(await page.locator('[data-page=suture] .pa-swbar').isVisible(), false);
  ok('缝合：分栏、切换两种布局，页顶按钮切换并记住');
  assert.deepEqual(errors, []);
  console.log('2.8.0 检查通过');
} finally {
  await browser.close();
}
