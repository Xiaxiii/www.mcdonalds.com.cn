// 「回复 → 规则」页：标签填错时报错写在那个输入框下面；全角、零宽字符、尖括号、输入法的「——」清理后照常保存（离开输入框即保存）。
// 先构建并在仓库根目录运行 8765 静态服务。用法：PW_CHROME=/usr/bin/chromium node test/reply-tag-input-check.mjs
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const URL = process.env.PA_TEST_URL || 'http://127.0.0.1:8765/test/site/index.html';
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const errors = [];
const ok = (message) => console.log('✓', message);
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(URL);
  await page.waitForFunction(() => window.__presetAtelier?.open);
  await page.evaluate(() => window.__presetAtelier.open('reply-rules'));
  const required = page.locator('[data-page=reply] [data-r="required"]');
  const err = page.locator('[data-page=reply] [data-err="required"]');
  await required.waitFor();

  // 填错：离开输入框就在框下面报错，框标红
  await required.fill('1状态');
  await required.blur();
  await err.waitFor();
  assert.match(await err.textContent(), /「1状态」不是有效的标签名/);
  assert.equal(await required.getAttribute('aria-invalid'), 'true');
  ok('填错的标签离开输入框就在框下面报错');

  // 一改就清掉
  await required.fill('1状');
  assert.equal(await err.isHidden(), true);
  assert.equal(await required.getAttribute('aria-invalid'), null);
  ok('改动时清掉报错');

  // 离开输入框时仍有错：报错留在框下面，不写在结果区，也不保存
  await required.blur();
  await err.waitFor();
  assert.equal(await page.locator('[data-page=reply] [data-r="result"]').textContent(), '', '结果区不放这条报错');
  assert.equal(Object.keys(await page.evaluate(() => window.SillyTavern.getContext().extensionSettings.presetAtelier.replyGuard || {})).length, 0, '有错的标签不保存');
  ok('有错时离开输入框：报错在框下面，不保存');

  // 零宽字符、全角、尖括号、输入法的「——」：清理后保存
  await required.fill('card​_status、<状态栏>，ｍｅｍｏ；mood——bar');
  await required.blur();
  await page.waitForTimeout(200);
  const saved = await page.evaluate(() => Object.values(window.SillyTavern.getContext().extensionSettings.presetAtelier.replyGuard || {})[0]?.requiredTags);
  assert.deepEqual(saved, ['card_status', '状态栏', 'memo', 'mood_bar']);
  ok('看不见的字符、全角、尖括号和「——」清理后照常保存');

  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
