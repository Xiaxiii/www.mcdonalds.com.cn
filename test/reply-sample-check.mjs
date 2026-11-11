// 2.9.0 「回复」页按范本诊断：粘贴格式正确的回复，给出改法并一键写回设置；记为范本后可开关「提醒时照范本的标签顺序写」；
// 说明文字不出现具体角色卡的标签名。手机、平板、电脑宽度下页面不横向溢出。先构建并在仓库根目录运行 8765 静态服务。
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const SITE = process.env.PA_TEST_URL || 'http://127.0.0.1:8765/test/site/index.html';
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const errors = [];
const ok = (message) => console.log('✓', message);
const SAMPLE = '<think>想一想</think>\n<正文>她推开窗，夜风带着海盐味涌进屋里。</正文>\n<mood_bar>心情：好</mood_bar>\n这里是一段写在正文标签外面的作者的话，长度超过二十个字才会被检查到。';
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(SITE);
  await page.waitForFunction(() => window.__mcdonalds?.open);
  await page.evaluate(() => window.__mcdonalds.open('reply-rules'));
  const R = (r) => page.locator(`[data-page=reply] [data-r="${r}"]`);
  await R('required').waitFor();
  const cfg = () => page.evaluate(() => Object.values(window.SillyTavern.getContext().extensionSettings.mcdonalds.replyGuard || {})[0]);

  assert.doesNotMatch(await page.locator('[data-page=reply]').innerHTML(), /lxs/i);
  ok('说明文字不出现具体角色卡的标签名');

  await R('diagnose').click();
  assert.match(await R('result').innerText(), /先在上面的框里粘贴/);
  await R('body').fill('content');
  await R('body').blur();
  await R('sample').fill(SAMPLE);
  await R('diagnose').click();
  const text = await R('result').innerText();
  assert.match(text, /正文标签改为 正文/);
  assert.match(text, /正文标签外允许有文字/, '改正文标签后才查得到的问题一并给出');
  assert.match(text, /修改后，这份范本不再报问题/);
  assert.equal(await R('bysample').isDisabled(), true, '没有范本时开关不可用');
  await R('diag-apply').click();
  assert.equal(await R('body').inputValue(), '正文');
  assert.equal(await R('outside').isChecked(), true);
  assert.match(await R('result').innerText(), /这份范本没有问题/);
  let c = await cfg();
  assert.equal(c.bodyTag, '正文');
  assert.deepEqual(c.requiredTags, []);
  assert.equal(c.allowOutside, true);
  ok('按范本诊断：逐条给出改法，一键写回设置并保存');

  await R('sample-save').click();
  c = await cfg();
  assert.deepEqual(c.skeleton, ['正文', 'mood_bar']);
  assert.equal(c.remindBySample, true);
  assert.equal(await R('bysample').isChecked(), true);
  assert.equal(c.skeleton.join().includes('夜风'), false, '只存标签名');
  await R('bysample').uncheck();
  assert.equal((await cfg()).remindBySample, false);
  await R('outside').uncheck();
  assert.equal((await cfg()).allowOutside, undefined);
  await R('sample-clear').click();
  assert.equal((await cfg()).skeleton, undefined);
  assert.equal(await R('bysample').isDisabled(), true);
  ok('范本可记下、可清除；照范本提醒和正文外允许有文字各有开关');

  // 各种设备宽度：页面不横向溢出，三个检查按钮都在屏幕内
  for (const [name, w, h, mobile] of [['iPhone SE', 320, 568, true], ['iPhone', 390, 844, true], ['安卓', 360, 800, true], ['iPad 竖屏', 768, 1024, true], ['iPad 横屏', 1180, 820, true], ['电脑', 1440, 900, false]]) {
    const p = await browser.newPage({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile });
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(SITE);
    await p.waitForFunction(() => window.__mcdonalds?.open);
    await p.evaluate(() => window.__mcdonalds.open('reply-rules'));
    await p.locator('[data-page=reply] [data-r="diagnose"]').waitFor();
    await p.locator('[data-page=reply] [data-r="sample"]').fill(SAMPLE);
    await p.locator('[data-page=reply] [data-r="diagnose"]').click();
    const m = await p.evaluate(() => {
      const sc = document.querySelector('[data-page=reply] .pa-scroll');
      const over = [...document.querySelectorAll('[data-page=reply] *')].filter((e) => e.offsetParent && e.getBoundingClientRect().right > innerWidth + 1).map((e) => e.className || e.tagName).slice(0, 3);
      return { sw: sc.scrollWidth, cw: sc.clientWidth, over };
    });
    assert.ok(m.sw <= m.cw + 1 && !m.over.length, `${name}（${w}×${h}）不横向溢出：${JSON.stringify(m)}`);
    await p.screenshot({ path: new URL(`./shots/reply-sample-${w}.png`, import.meta.url).pathname });
    await p.close();
  }
  ok('手机、平板、电脑宽度下「回复」页不横向溢出');
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
