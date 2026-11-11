// 别的扩展或酒馆主题按输入框类型改样式（方角、白底）时，焦香鸡翅的搜索框、密钥框不受影响；密钥框仍是密码框。
// 先构建并在仓库根目录运行 8765 静态服务。用法：PW_CHROME=/usr/bin/chromium node test/foreign-style-check.mjs
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const URL = process.env.PA_TEST_URL || 'http://127.0.0.1:8765/test/site/index.html';
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const errors = [];
const ok = (message) => console.log('✓', message);
// 2.5.12 也有按类名（带 search 的）、按 inputmode / enterkeyhint 改的，外面那层还会加底色和下边距
const FOREIGN = `html body input[type="search"], html body input[type="password"], html body input[inputmode="search"], html body input[enterkeyhint="search"], html body [class*="search"] input { border-radius: 0 !important; background: #fff !important; border: 1px solid #ddd !important; margin-bottom: 12px !important; }
  html body [class*="search"], html body div:has(> input[inputmode="search"]) { background: #f4f4f4 !important; padding-bottom: 12px !important; border: 1px solid #ddd !important; }
  html body [role="listbox"], html body div[class*="pick"]:not(.pa-sheet), html body [role="option"], html body button { background: #fafafa !important; }`;
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(URL);
  await page.waitForFunction(() => window.__presetAtelier?.open);
  await page.addStyleTag({ content: FOREIGN });
  // 2.7.1 默认配色「素」的输入框本来就是白底，这里用跟随酒馆主题（深色）区分
  await page.evaluate(() => { const st = window.SillyTavern.getContext().extensionSettings; Object.assign(st.presetAtelier || (st.presetAtelier = {}), { theme: "follow", ui271: true }); window.__presetAtelier.open(); });
  await page.click('#pa-root [data-tool=search]');
  const q = page.locator('#pa-root [data-page=organize] .pa-findrow .pa-input');
  await q.waitFor();
  const look = (loc) => loc.evaluate((x) => { const s = getComputedStyle(x); return { radius: s.borderTopLeftRadius, margin: s.marginBottom, type: x.type, mode: x.inputMode, hint: x.enterKeyHint }; });
  const a = await look(q);
  assert.notEqual(a.radius, '0px', '搜索框保持圆角');
  assert.equal(a.margin, '0px', '搜索框下面不多出一截');
  assert.equal(a.mode, 'search'); assert.equal(a.hint, 'search');
  assert.notEqual(await q.evaluate((x) => getComputedStyle(x).backgroundColor), 'rgb(255, 255, 255)', '搜索框底色是配色里的');
  const wrap = (sel) => page.locator(sel).evaluate((x) => { const s = getComputedStyle(x); return [s.backgroundColor, s.paddingBottom, s.borderTopWidth]; });
  assert.deepEqual(await wrap('#pa-root [data-page=organize] .pa-findrow'), ['rgba(0, 0, 0, 0)', '0px', '0px'], '外面那层没有外来的底色、下边距');
  ok('整理页搜索框不受别处按类型、类名、搜索键改的样式影响，键盘照样是搜索键');

  // 选预设的列表、选择模型的搜索框
  await page.click('#pa-root .pa-toolbar .pa-namebtn');
  const nq = page.locator('.pa-sheet .pa-npick-q');
  await nq.waitFor();
  const n = await look(nq);
  assert.notEqual(n.radius, '0px'); assert.equal(n.margin, '0px');
  // 2.5.17 列表外面几层和列表行不被刷成白底（弹窗的画要透出来）
  const bgs = await page.evaluate(() => ['.pa-npick', '.pa-npick-list', '.pa-npick-item'].map((q) => getComputedStyle(document.querySelector('.pa-sheet ' + q)).backgroundColor));
  assert.deepEqual(bgs.slice(0, 2), ['rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0)'], '列表外层没有外来的底色');
  assert.notEqual(bgs[2], 'rgb(250, 250, 250)', '列表行用配色里的底色');
  await page.click('.pa-sheet-mask:not(.pa-out) .pa-sheet-x'); await page.waitForTimeout(200);
  await page.evaluate(() => {
    document.body.insertAdjacentHTML('beforeend', '<select id="model_custom_select"><option value="m1">m1</option><option value="m2">m2</option></select><input id="custom_model_id">');
    window.__presetAtelier.open('conn');
  });
  await page.click('#pa-root [data-a=livemodel]');
  const mq = page.locator('.pa-sheet .pa-mfind .pa-input');
  await mq.waitFor();
  const m = await look(mq);
  assert.notEqual(m.radius, '0px'); assert.equal(m.margin, '0px');
  assert.deepEqual(await wrap('.pa-sheet .pa-mfind'), ['rgba(0, 0, 0, 0)', '0px', '0px']);
  await page.click('.pa-sheet-mask:not(.pa-out) .pa-sheet-x'); await page.waitForTimeout(200);
  ok('选预设、选择模型的搜索框同样不受影响');

  await page.evaluate(() => window.__presetAtelier.open('conn'));
  await page.click('#pa-root [data-a=new]');
  const key = page.locator('.pa-sheet [data-f=key]').first();
  await key.waitFor();
  const k = await look(key);
  assert.equal(k.type, 'password', '密钥框仍是密码框（键盘不记、读屏不念）');
  assert.notEqual(k.radius, '0px', '密钥框保持圆角');
  assert.equal(k.margin, '0px');
  assert.notEqual(await key.evaluate((x) => getComputedStyle(x).backgroundColor), 'rgb(255, 255, 255)', '底色是配色里的，不是外来的纯白');
  ok('密钥框不受别处按类型改的样式影响，仍是密码框');
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
