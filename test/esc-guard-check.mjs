// 2.8.7 Esc 一次只退一层；填过内容的窗口误触不丢；组外条目与分组卡片对齐；宽屏编辑栏表单靠上。
// 先构建并在仓库根目录运行 8765 静态服务。用法：PW_CHROME=/usr/bin/chromium node test/esc-guard-check.mjs
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const errors = [];
const ok = (m) => console.log('✓', m);
const boot = async (vp) => {
  const page = await browser.newPage(vp);
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://127.0.0.1:8765/test/site/index.html');
  await page.waitForFunction(() => window.__presetAtelier?.open);
  await page.evaluate(() => window.__presetAtelier.open('organize'));
  await page.waitForTimeout(300);
  return page;
};
const hidden = (page) => page.$eval('#pa-root', (x) => x.hidden);
const sheets = (page) => page.locator('.pa-sheet-mask:not(.pa-out)').count();
try {
  // —— 宽屏 ——
  const page = await boot({ viewport: { width: 1280, height: 800 } });
  const org = '#pa-root [data-page=organize]';
  await page.click(`${org} .pa-toolbar > [data-tool=search]`);
  await page.keyboard.type('思');
  await page.waitForTimeout(300);
  const filtered = await page.locator(`${org} .pa-ghead`).count();
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  assert.equal(await hidden(page), false, '搜索框里按 Esc 不关面板');
  assert.equal(await page.$eval(`${org} .pa-findrow`, (x) => x.hidden), true, '搜索行收起');
  assert.equal(await page.inputValue(`${org} .pa-find`), '', '搜索词清除');
  assert.ok(await page.locator(`${org} .pa-ghead`).count() > filtered, '列表恢复');
  ok('搜索框里按 Esc：清除并收起搜索，面板不关');
  await page.click(`${org} .pa-toolbar > [data-tool=search]`);
  await page.keyboard.type('思'); await page.waitForTimeout(300);
  await page.click(`${org} .pa-qx`); await page.waitForTimeout(300);
  assert.equal(await page.$eval(`${org} .pa-findrow`, (x) => x.hidden), true);
  assert.equal(await page.inputValue(`${org} .pa-find`), '');
  ok('搜索框右侧 ✕：清除并收起');

  // 编辑栏：表单靠上；改过后 Esc、✕ 先问，取消直接关
  await page.locator(`${org} .pa-ghead .pa-gname`).nth(3).click(); await page.waitForTimeout(250);
  await page.locator(`${org} .pa-gbody .pa-row [data-act=peek]`).first().click(); await page.waitForTimeout(300);
  const nameBox = await page.locator('.pa-editpane [data-f=name]').boundingBox();
  const nameLabel = await page.locator('.pa-editpane .pa-field > span').first().boundingBox();
  assert.ok(nameBox.height <= 44, `名称框不被拉高（${nameBox.height}）`);
  assert.ok(nameBox.y - (nameLabel.y + nameLabel.height) <= 8, '名称与输入框紧挨');
  ok('宽屏编辑栏：各行靠上紧排');
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  assert.equal(await page.$eval('.pa-editpane', (x) => x.hidden), true, '没改动时 Esc 关闭编辑栏');
  assert.equal(await hidden(page), false, '面板不关');
  await page.locator(`${org} .pa-gbody .pa-row [data-act=peek]`).first().click(); await page.waitForTimeout(300);
  await page.locator('.pa-editpane [data-f=content]').click();
  await page.keyboard.type('多写的字');
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  assert.equal(await sheets(page), 1, '改过后 Esc 先确认');
  assert.equal(await hidden(page), false);
  await page.locator('.pa-sheet-actions .pa-btn', { hasText: '继续编辑' }).click(); await page.waitForTimeout(300);
  assert.match(await page.inputValue('.pa-editpane [data-f=content]'), /多写的字/, '继续编辑：内容还在');
  await page.click('.pa-editpane [data-ep=x]'); await page.waitForTimeout(300);
  assert.equal(await sheets(page), 1, '改过后点 ✕ 先确认');
  await page.locator('.pa-sheet-actions .pa-btn-danger').click(); await page.waitForTimeout(300);
  assert.equal(await page.$eval('.pa-editpane', (x) => x.hidden), true, '放弃修改后关闭');
  ok('宽屏编辑栏：改过后 Esc、✕ 先确认');
  // 其他输入框里 Esc：先移走光标，再按一次才关面板
  await page.evaluate(() => window.__presetAtelier.open('reply')); await page.waitForTimeout(300);
  await page.locator('#pa-root [data-page=reply] [data-r=sample]').click();
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  assert.equal(await hidden(page), false, '输入框里第一次 Esc 不关面板');
  await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  assert.equal(await hidden(page), true, '再按一次关闭面板');
  ok('输入框里按 Esc：先移走光标，再按关闭面板');
  // 对齐：组外条目的手柄、开关与组头在同一条竖线上
  await page.evaluate(() => window.__presetAtelier.open('organize')); await page.waitForTimeout(300);
  const edges = async (p) => p.evaluate(() => {
    const x = (sel, side) => Math.round(document.querySelector(`#pa-root [data-page=organize] ${sel}`).getBoundingClientRect()[side]);
    return { headHandle: x('.pa-ghead .pa-handle', 'left'), looseHandle: x('.pa-loose .pa-row .pa-handle', 'left'), headSwitch: x('.pa-ghead .pa-switch', 'right'), looseSwitch: x('.pa-loose .pa-row .pa-switch', 'right'), headName: x('.pa-ghead .pa-gname', 'left'), looseName: x('.pa-loose .pa-row .pa-namebox', 'left'), title: x('.pa-toolbar .pa-picker-slot', 'left'), group: x('.pa-group', 'left') };
  });
  let e = await edges(page);
  assert.equal(e.looseHandle, e.headHandle, '手柄同列'); assert.equal(e.looseSwitch, e.headSwitch, '开关同列'); assert.equal(e.looseName, e.headName, '名称同列');
  const titleLeft = await page.$eval('#pa-root .pa-title', (x) => Math.round(x.getBoundingClientRect().left));
  assert.equal(e.group, titleLeft, '宽屏：分组卡片左边与页头标题对齐');
  await page.close();

  // —— 手机 ——
  const m = await boot({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  e = await edges(m);
  assert.equal(e.looseHandle, e.headHandle, '手机：手柄同列'); assert.equal(e.looseSwitch, e.headSwitch, '手机：开关同列'); assert.equal(e.looseName, e.headName, '手机：名称同列');
  ok('组外条目与分组卡片对齐（宽屏、手机）');
  // 编辑条目弹窗：没改动点窗口外直接关；改过先确认
  await m.locator(`${org} .pa-ghead .pa-gname`).nth(3).tap(); await m.waitForTimeout(250);
  const peek = m.locator(`${org} .pa-gbody .pa-row [data-act=peek]`).first();
  await peek.tap(); await m.waitForTimeout(350);
  await m.touchscreen.tap(195, 40); await m.waitForTimeout(350);
  assert.equal(await sheets(m), 0, '没改动：点窗口外直接关');
  await peek.tap(); await m.waitForTimeout(350);
  await m.fill('.pa-sheet [data-f=content]', '手机上多写的字');
  await m.touchscreen.tap(195, 40); await m.waitForTimeout(350);
  assert.equal(await sheets(m), 2, '改过：点窗口外先确认');
  await m.locator('.pa-sheet-mask:not(.pa-out)').last().locator('.pa-btn', { hasText: '继续编辑' }).tap(); await m.waitForTimeout(350);
  assert.equal(await m.inputValue('.pa-sheet [data-f=content]'), '手机上多写的字', '继续编辑：内容还在');
  await m.locator('.pa-sheet-actions .pa-btn', { hasText: '取消' }).tap(); await m.waitForTimeout(350);
  assert.equal(await sheets(m), 0, '点「取消」直接关闭');
  ok('编辑条目弹窗：改过后点窗口外先确认，「取消」直接关');
  // 站点窗口：填了名称后点 ✕ 先确认
  await m.evaluate(() => window.__presetAtelier.open('conn')); await m.waitForTimeout(300);
  await m.locator('#pa-root [data-a=new]').tap(); await m.waitForTimeout(350);
  await m.locator('.pa-sheet .pa-sheet-x').tap(); await m.waitForTimeout(350);
  assert.equal(await sheets(m), 0, '没填内容：✕ 直接关');
  await m.locator('#pa-root [data-a=new]').tap(); await m.waitForTimeout(350);
  await m.fill('.pa-sheet [data-f=name]', '新站点');
  await m.locator('.pa-sheet .pa-sheet-x').first().tap(); await m.waitForTimeout(350);
  assert.equal(await sheets(m), 2, '填过内容：✕ 先确认');
  await m.locator('.pa-sheet-mask:not(.pa-out)').last().locator('.pa-btn-danger').tap(); await m.waitForTimeout(400);
  assert.equal(await sheets(m), 0, '放弃修改后两个窗口都关闭');
  ok('站点窗口：填过内容后点 ✕ 先确认');
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
