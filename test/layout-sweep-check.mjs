// 各种屏幕尺寸下，各页面和常用弹窗没有内容超出屏幕、没有横向滚动（320 小屏、标准手机、手机横屏、iPad 竖屏、电脑）。
// 先构建并在仓库根目录运行 8765 静态服务。用法：PW_CHROME=/usr/bin/chromium node test/layout-sweep-check.mjs
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const src = (await import('node:fs')).readFileSync('test/cot-fragment-check.mjs', 'utf8');
const cotPreset = eval('(() => {' + src.slice(src.indexOf("const p = ("), src.indexOf("const stored")) + '; return preset; })()');
const NAME = '思维链片段检查（公开合成）';
const sizes = [[320, 568, true], [390, 844, true], [844, 390, true], [768, 1024, true], [1440, 900, false]];
const b = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const problems = [];
const scan = (p, where) => p.evaluate((where) => {
  const W = innerWidth, out = [];
  if (document.documentElement.scrollWidth > W + 1) out.push(`页面横向滚动 ${document.documentElement.scrollWidth}>${W}`);
  const root = document.getElementById('mcd-root');
  const visible = (e) => { const r = e.getBoundingClientRect(); return r.width && r.height && getComputedStyle(e).visibility !== 'hidden'; };
  for (const e of root.querySelectorAll('button, input, select, label, .pa-chip, h3, b, .pa-card')) {
    if (!visible(e) || e.closest('.pa-tabs-scroll, .pa-seg, [style*="overflow"]')) continue;
    const r = e.getBoundingClientRect();
    if (r.right > W + 1 || r.left < -1) { out.push(`超出屏幕：${e.tagName.toLowerCase()}.${[...e.classList].join('.')} 「${(e.textContent || e.placeholder || '').trim().slice(0, 16)}」 ${Math.round(r.left)}..${Math.round(r.right)}`); }
  }
  for (const box of root.querySelectorAll('.pa-sheet-body, .pa-scroll, .pa-page')) {
    if (!visible(box)) continue;
    if (box.scrollWidth > box.clientWidth + 2 && getComputedStyle(box).overflowX !== 'visible') out.push(`横向滚动：${[...box.classList].join('.')} ${box.scrollWidth}>${box.clientWidth}`);
  }
  return [...new Set(out)].slice(0, 6).map((x) => `${where}：${x}`);
}, where);
for (const [w, h, mobile] of sizes) {
  const p = await b.newPage({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile });
  p.setDefaultTimeout(4000);
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://127.0.0.1:8765/test/site/index.html');
  await p.waitForFunction(() => window.__mcdonalds?.open);
  await p.evaluate(() => { window.SillyTavern.getContext().extensionSettings.mcdonalds = { theme: 'sage' }; });
  const tag = `${w}×${h}`;
  const go = async (where, fn) => { try { await fn(); await p.waitForTimeout(350); problems.push(...await scan(p, `${tag} ${where}`)); } catch (e) { problems.push(`${tag} ${where}：打不开 ${e.message.split('\n')[0]}`); } };
  await go('整理', async () => { await p.evaluate(() => window.__mcdonalds.open()); await p.click('#mcd-root [data-tool=search]'); });
  await go('缝合', () => p.evaluate(() => window.__mcdonalds.open('suture')));
  for (const sec of ['schemes', 'conn', 'reply', 'look', 'health', 'clean']) await go(`更多/${sec}`, () => p.evaluate((s) => window.__mcdonalds.open('more', s), sec));
  await go('添加站点', async () => { await p.evaluate(() => window.__mcdonalds.open('conn')); await p.click('#mcd-root [data-a=new]'); });
  await go('添加站点·看密钥', async () => { await p.locator('.pa-sheet [data-f=keyeye]').first().click(); });
  await p.evaluate(() => document.querySelectorAll('#mcd-root .pa-sheet-mask').forEach((m) => m.remove()));
  await go('思维链（待核对）', () => p.evaluate(({ cotPreset, NAME }) => { const m = window.__mock; m.names.splice(0, m.names.length, NAME); m.presets.splice(0, m.presets.length, cotPreset); m.live.preset_settings_openai = NAME; Object.assign(m.live, structuredClone(cotPreset)); window.__mcdonalds.open('cot'); }, { cotPreset, NAME }));
  await go('回复规则·报错', async () => { await p.evaluate(() => window.__mcdonalds.open('reply-rules')); const r = p.locator('[data-page=reply] [data-r=required]'); await r.fill('1状态 lxs——status'); await r.blur(); });
  for (const sec of ['reply-check', 'reply-auto', 'reply-ai', 'vars', 'suture']) await go(`页面/${sec}`, () => p.evaluate((s) => window.__mcdonalds.open(s), sec));
  if (errs.length) problems.push(`${tag} 页面错误：${errs.join(' | ')}`);
  await p.close();
  console.log('✓', tag);
}
await b.close();
assert.deepEqual(problems, [], problems.join('\n'));
console.log('各尺寸都没有超出屏幕或横向滚动');
