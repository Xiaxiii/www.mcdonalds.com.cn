import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import fixture from './fixtures/performance.cjs';
import { choose } from './choose.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const order = JSON.parse(fs.readFileSync(path.join(root, 'order.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
// 直接测试工作区源码，不写共享index.js，允许与其他回归检查同时运行。
let bundle = `var BUILD_KIND='extension',VERSION=${JSON.stringify(pkg.version)},CHANGELOG='公开合成性能回归';\n`;
for (const file of order) {
  if (file === 'main.js') bundle += `
    window.__perf = { renders: [], regions: 0, analyses: 0 };
    const testRender = renderList, testRegion = cotRegion, testAnalyze = analyze;
    renderList = function(d, options) {
      const t = performance.now(), html = testRender(d, options);
      window.__perf.renders.push({ name:d.name, mode:options.mode, ms:performance.now()-t, rows:(html.match(/class="pa-row/g)||[]).length });
      return html;
    };
    cotRegion = function(...args) { window.__perf.regions++; return testRegion(...args); };
    analyze = function(...args) { window.__perf.analyses++; return testAnalyze(...args); };
    window.__perfNotify = () => notifyDraft(focusPreset());
    window.__perfContentNotify = () => emitChange(focusPreset());
  `;
  const content = fs.readFileSync(path.join(root, 'src', file), 'utf8');
  bundle += file.endsWith('.css') ? `\nvar style_default=${JSON.stringify(content)};\n` : `\n${content}\n`;
}
const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (pathname === '/index.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end(bundle); }
  const file = path.resolve(root, `.${pathname}`);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
  try {
    const body = fs.readFileSync(file);
    res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css' })[path.extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(8768, '127.0.0.1', resolve); });
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const errors = [], reports = [];
const targetName = '性能目标（公开合成1200条）', sourceName = '性能来源（公开合成1200条）';
const original = fixture(), source = fixture({ prefix: 'source' });
const saved = page => page.evaluate(name => structuredClone(window.__mock.presets[window.__mock.names.indexOf(name)]), targetName);
const states = p => p.prompt_order[0].order.map(x => [x.identifier, x.enabled]);
async function foldAll(page) {
  const desktop = page.locator('[data-page=organize] [data-tool=fold]');
  if (await desktop.isVisible()) await desktop.click();
  else {
    await page.locator('[data-page=organize] [data-tool=menu]').click();
    await page.locator('.pa-pick-item').filter({ hasText: /全部展开|全部折叠/ }).click();
  }
}
async function waitSaved(page, predicate) {
  await page.waitForFunction(({ name, check }) => {
    const m = window.__mock, preset = m.presets[m.names.indexOf(name)];
    return new Function('p', `return (${check})(p)`)(preset);
  }, { name: targetName, check: String(predicate) });
}
try {
  for (const mobile of [true, false]) {
    const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1100, height: 900 }, isMobile: mobile, hasTouch: mobile });
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://127.0.0.1:8768/test/site/index.html');
    await page.waitForFunction(() => window.__mcdonalds?.open);
    await page.evaluate(({ original, source, targetName, sourceName }) => {
      const m = window.__mock;
      m.names.splice(0, m.names.length, targetName, sourceName);
      m.presets.splice(0, m.presets.length, original, source);
      m.live.preset_settings_openai = targetName;
      Object.assign(m.live, structuredClone(original));
      window.__mcdonalds.open('organize');
    }, { original, source, targetName, sourceName });
    await choose(page, '[data-page=organize] .pa-picker-slot .pa-namebtn', targetName);
    const list = page.locator('[data-page=organize] .pa-list');
    assert.equal(await list.locator('.pa-group').count(), 12);
    assert.equal(await list.locator('.pa-row').count(), 0, '全部折叠时不创建1200个隐藏条目');
    await list.locator('[data-gid="perf-g0"] [data-act=gselect]').click();
    assert.equal(await page.locator('[data-page=organize] .pa-selcount').innerText(), '已选 100 条');
    assert.equal(await list.locator('.pa-row').count(), 0);
    await page.locator('[data-page=organize] [data-sel=none]').click();
    assert.ok(JSON.stringify(await saved(page)) === JSON.stringify(original), '折叠与选择不写入预设');

    await foldAll(page);
    assert.equal(await list.locator('.pa-row').count(), 1200);
    await page.evaluate(() => { window.__perf.anchor = document.querySelector('.pa-list .pa-row'); window.__perf.before = window.__perf.renders.length; window.__perfNotify(); });
    assert.equal(await page.evaluate(() => window.__perf.renders.length - window.__perf.before), 0, '仅保存状态通知不重建列表');
    assert.equal(await page.evaluate(() => window.__perf.anchor.isConnected), true);

    // 单条开关就地改这一行，不重建列表；保存开始、完成也不重建。正文、其他角色顺序和其余1199个开关均保留。
    const beforeToggle = await page.evaluate(() => window.__perf.renders.length);
    await list.locator('[data-id="perf-1"] .pa-switch').click();
    await waitSaved(page, p => p.prompt_order[0].order[1].enabled === true);
    assert.equal(await page.evaluate(() => window.__perf.renders.length) - beforeToggle, 0, '单条开关不重建列表');
    assert.equal(await list.locator('[data-id="perf-1"]').evaluate((r) => !r.classList.contains('pa-off') && r.querySelector('[data-act=toggle]').checked), true, '这一行就地改成开启');
    assert.equal(await page.evaluate(() => window.__perf.anchor.isConnected), true, '列表节点没有被替换');
    const expected = structuredClone(original); expected.prompt_order[0].order[1].enabled = true;
    let now = await saved(page);
    assert.deepEqual(now.prompts, expected.prompts);
    assert.deepEqual(now.prompt_order, expected.prompt_order);
    assert.deepEqual(now.extensions.syntheticUnrelatedData, expected.extensions.syntheticUnrelatedData);
    const chosen = states(now);
    await list.locator('[data-gid="perf-g0"] .pa-switch-s').click();
    await waitSaved(page, p => p.extensions.baibaiToolkit.presetPromptGroups.groups[0].enabled === false);
    assert.deepEqual(states(await saved(page)), chosen, '性能优化不能重新引入分组开关联动');
    await list.locator('[data-gid="perf-g0"] .pa-switch-s').click();
    await waitSaved(page, p => p.extensions.baibaiToolkit.presetPromptGroups.groups[0].enabled === true);
    assert.deepEqual(states(await saved(page)), chosen);
    await foldAll(page);
    assert.equal(await list.locator('.pa-row').count(), 0);
    await page.locator('[data-page=organize] [data-tool=search]').click();
    await page.locator('[data-page=organize] .pa-find').fill('性能条目 01199');
    await page.waitForFunction(() => document.querySelectorAll('[data-page=organize] .pa-list .pa-row').length === 1);
    assert.equal(await list.locator('.pa-row').getAttribute('data-id'), 'perf-1199');
    await page.locator('[data-page=organize] .pa-find').fill('body-only-needle');
    await page.waitForFunction(() => document.querySelector('[data-page=organize] .pa-qsum')?.textContent.includes('正文里还有 1 条'));
    assert.equal(await list.locator('.pa-row').count(), 0);
    await list.locator('[data-act=qbody]').click();
    assert.equal(await list.locator('.pa-row').getAttribute('data-id'), 'perf-37');
    await page.locator('[data-page=organize] .pa-find').fill('');
    await page.waitForFunction(() => document.querySelectorAll('[data-page=organize] .pa-list .pa-row').length === 0);

    // 页签切换仅绘制可见页；缝合1200→1200仍只为选中4条生成预览。
    await page.click('.pa-tabs [data-nav=check]'); await page.click('[data-tab=cot]');
    await page.waitForSelector('[data-page=cot]:not([hidden])');
    const beforeContent = await page.evaluate(() => ({ renders: window.__perf.renders.length, analyses: window.__perf.analyses }));
    await page.evaluate(() => window.__perfContentNotify());
    assert.equal(await page.evaluate(() => window.__perf.renders.length) - beforeContent.renders, 0, '思维链可见时内容通知不会重画后台整理列表');
    assert.equal(await page.evaluate(() => window.__perf.analyses) - beforeContent.analyses, 1, '内容通知只重新分析可见思维链页一次');
    await page.evaluate(() => window.__mcdonalds.open("suture"));
    await page.waitForSelector('.pa-src-list .pa-group');
    assert.equal(await page.locator('.pa-src-list .pa-row').count(), 0);
    await page.locator('.pa-src-list .pa-group').first().locator('.pa-gname').click();
    assert.equal(await page.locator('.pa-src-list .pa-row').count(), 100);
    for (const i of [0, 1, 2, 3]) await page.locator(`.pa-src-list [data-id="source-${i}"] .pa-name`).click();
    assert.match(await page.locator('.pa-picked-n').innerText(), /已选 4 条/);
    await page.locator('.pa-dst-list .pa-group').first().locator('.pa-gname').click();
    const beforePreview = await saved(page);
    const beforePreviewAnalyses = await page.evaluate(() => window.__perf.analyses);
    await page.click('[data-st=go]');
    await page.waitForSelector('.pa-review .pa-item');
    assert.equal(await page.evaluate(() => window.__perf.analyses) - beforePreviewAnalyses, 2, '4条预览只分析来源与目标各一次');
    assert.equal(await page.locator('.pa-review .pa-item').count(), 4);
    // 缝后开关默认与来源一致：source-1 在来源里关着
    assert.deepEqual(await page.locator('.pa-review [data-c=on]').evaluateAll(xs => xs.map(x => x.checked)), [true, false, true, true]);
    assert.equal(await page.locator('[data-enable-count]').innerText(), '部分开启：3 / 4');
    const master = page.locator('[data-enable-toggle]');
    assert.deepEqual(await master.evaluate(x => [x.checked, x.indeterminate]), [false, true]);
    await page.evaluate(() => {
      window.__perf.bulk = {
        article: document.querySelector('.pa-review .pa-item'), input: document.querySelector('.pa-review [data-c=on]'),
        analyses: window.__perf.analyses, regions: window.__perf.regions, renders: window.__perf.renders.length
      };
    });
    for (const on of [true, false, true, false]) {
      await master.setChecked(on);
      assert.equal(await page.locator('.pa-review [data-c=on]:checked').count(), on ? 4 : 0);
      assert.equal(await page.locator('[data-enable-count]').innerText(), `缝后开启：${on ? 4 : 0} / 4`);
      assert.deepEqual(await master.evaluate(x => [x.checked, x.indeterminate]), [on, false]);
    }
    await page.locator('.pa-review [data-c=on]').first().check();
    assert.equal(await page.locator('[data-enable-count]').innerText(), '部分开启：1 / 4');
    assert.deepEqual(await master.evaluate(x => [x.checked, x.indeterminate]), [false, true]);
    // 原生checkbox的混合态可以直接用键盘切换；总开关仅作用于当前预览。
    await master.focus();
    await page.keyboard.press('Space');
    assert.equal(await page.locator('.pa-review [data-c=on]:checked').count(), 4);
    assert.equal(await page.locator('[data-enable-count]').innerText(), '缝后开启：4 / 4');
    assert.deepEqual(await master.evaluate(x => [x.checked, x.indeterminate]), [true, false]);
    await page.keyboard.press('Space');
    assert.equal(await page.locator('.pa-review [data-c=on]:checked').count(), 0);
    assert.deepEqual(await master.evaluate(x => [x.checked, x.indeterminate]), [false, false]);
    await page.locator('.pa-review [data-c=on]').first().check();
    assert.equal(await page.locator('[data-enable-count]').innerText(), '部分开启：1 / 4');
    assert.deepEqual(await master.evaluate(x => [x.checked, x.indeterminate]), [false, true]);
    assert.deepEqual(await page.evaluate(() => ({
      article: window.__perf.bulk.article.isConnected, input: window.__perf.bulk.input.isConnected,
      analyses: window.__perf.analyses - window.__perf.bulk.analyses, regions: window.__perf.regions - window.__perf.bulk.regions,
      renders: window.__perf.renders.length - window.__perf.bulk.renders
    })), { article: true, input: true, analyses: 0, regions: 0, renders: 0 }, '全部开关及随后单条调整只改预览状态，不重建DOM或重新分析');
    assert.ok(JSON.stringify(await saved(page)) === JSON.stringify(beforePreview), '预览内调整未确认时不得保存或改正文');
    assert.equal(await page.locator('.pa-sheet').evaluate(x => x.scrollWidth > x.clientWidth + 2), false);
    await page.locator('.pa-sheet-actions .pa-btn').filter({ hasText: '取消' }).click();
    assert.ok(JSON.stringify(await saved(page)) === JSON.stringify(beforePreview), '取消4条预览保持目标原值');
    assert.ok(JSON.stringify(await page.evaluate(name => window.__mock.presets[window.__mock.names.indexOf(name)], sourceName)) === JSON.stringify(source));
    await page.click('.pa-tabs [data-nav="preset"]');
    await page.click('.pa-tabs [data-nav=preset]');
    assert.equal(await list.locator('.pa-row').count(), 0, '返回整理保留折叠与搜索状态');
    const report = await page.evaluate(() => ({ renders: window.__perf.renders, regions: window.__perf.regions, analyses: window.__perf.analyses }));
    reports.push({ viewport: mobile ? 'phone' : 'desktop', ...report });
    console.log(`✓ ${mobile ? '手机' : '桌面'}1200→1200：折叠/展开/搜索/整组选中/独立开关保存/页签/4条预览及取消通过`);
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify(reports.map(x => ({ viewport: x.viewport, listRenders: x.renders.length, maxRenderMs: Number(Math.max(...x.renders.map(r => r.ms)).toFixed(2)), regions: x.regions, analyses: x.analyses })), null, 2));
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
