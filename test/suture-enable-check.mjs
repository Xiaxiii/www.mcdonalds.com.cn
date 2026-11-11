import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { choose, chooseDstType } from './choose.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = JSON.parse(fs.readFileSync(path.join(root, 'order.json'), 'utf8'));
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
let bundle = `var BUILD_KIND='extension',VERSION=${JSON.stringify(version)},CHANGELOG='公开合成缝合开关回归';\n`;
for (const file of files) {
  const body = fs.readFileSync(path.join(root, 'src', file), 'utf8');
  bundle += file.endsWith('.css') ? `\nvar style_default=${JSON.stringify(body)};\n` : `\n${body}\n`;
}
const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (pathname === '/index.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end(bundle); }
  const file = path.resolve(root, `.${pathname}`);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
  try {
    const body = fs.readFileSync(file);
    res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' })[path.extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(8769, '127.0.0.1', resolve); });
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const targetName = '独立缝合目标（公开合成）', sourceName = '四条来源（公开合成）';
const prompt = (identifier, name, content) => ({ identifier, name, content, role: 'system', injection_position: 0, injection_depth: 4 });
const target = {
  temperature: 0.61,
  prompts: [prompt('existing-a', '已有条目甲', '已有甲正文'), prompt('existing-b', '已有条目乙', '已有乙正文'), prompt('existing-c', '已有条目丙', '已有丙正文')],
  prompt_order: [
    { character_id: 100001, order: [{ identifier: 'existing-a', enabled: true }, { identifier: 'existing-b', enabled: false }, { identifier: 'existing-c', enabled: true }] },
    { character_id: 42, order: [{ identifier: 'existing-a', enabled: false }] }
  ],
  extensions: { unrelatedExtension: { kept: ['原样', 42] }, baibaiToolkit: { presetPromptGroups: { version: 1,
    groups: [{ id: 'g1', name: '关闭但保留内部选择', order: 0, enabled: false, collapsed: true }, { id: 'g2', name: '普通分组', order: 1, enabled: true, collapsed: true }],
    prompts: { 'existing-a': { groupId: 'g1' }, 'existing-b': { groupId: 'g1' }, 'existing-c': { groupId: 'g2' } }
  } } }
};
const source = {
  prompts: Array.from({ length: 4 }, (_, i) => prompt(`source-${i}`, `新增条目${i + 1}`, `公开合成来源正文${i + 1}，确认前不改变目标。`)),
  prompt_order: [{ character_id: 100001, order: Array.from({ length: 4 }, (_, i) => ({ identifier: `source-${i}`, enabled: i % 2 === 0 })) }],
  extensions: { preservedSource: true }
};
const errors = [];
const equal = (a, b, message) => assert.ok(JSON.stringify(a) === JSON.stringify(b), message);
const saved = page => page.evaluate(name => structuredClone(window.__mock.presets[window.__mock.names.indexOf(name)]), targetName);
async function boot() {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:8769/test/site/index.html');
  await page.waitForFunction(() => window.__presetAtelier?.open);
  await page.evaluate(({ target, source, targetName, sourceName }) => {
    const m = window.__mock;
    m.names.splice(0, m.names.length, targetName, sourceName);
    m.presets.splice(0, m.presets.length, target, source);
    m.live.preset_settings_openai = targetName;
    Object.assign(m.live, structuredClone(target));
    window.__presetAtelier.open('suture');
  }, { target, source, targetName, sourceName });
  await choose(page, '.pa-src-name', sourceName);
  await choose(page, '.pa-dst-picker .pa-namebtn', targetName);
  return page;
}
async function selectFour(page) {
  for (let i = 0; i < 4; i++) await page.locator(`.pa-src-list [data-id="source-${i}"] .pa-name`).click();
  assert.match(await page.locator('.pa-picked-n').innerText(), /已选 4 条/);
}
async function count(page, n) {
  assert.equal(await page.locator('[data-enable-count]').innerText(), `${n > 0 && n < 4 ? '部分开启' : '缝后开启'}：${n} / 4`);
  assert.equal(await page.locator('.pa-review [data-c=on]:checked').count(), n);
  assert.deepEqual(await page.locator('[data-enable-toggle]').evaluate(x => [x.checked, x.indeterminate]), [n === 4, n > 0 && n < 4]);
}
try {
  for (const scenario of ['all-off', 'all-on', 'one-on']) {
    const page = await boot();
    await selectFour(page);
    await page.locator('.pa-dst-list .pa-group').first().locator('.pa-gname').click();
    await page.click('[data-st=go]');
    await page.waitForSelector('.pa-review .pa-item');
    await count(page, 2);
    equal(await page.locator('.pa-review [data-c=on]').evaluateAll(xs => xs.map(x => x.checked)), [true, false, true, false], '缝后开关默认与来源条目一致');
    // 部分开启时点总开关先全开，再点全关
    await page.locator('[data-enable-toggle]').check();
    await count(page, 4);
    await page.locator('[data-enable-toggle]').uncheck();
    await count(page, 0);
    await page.click('[data-enable-source]');
    await count(page, 2);
    await page.locator('[data-enable-toggle]').check();
    await page.locator('[data-enable-toggle]').uncheck();
    await count(page, 0);
    if (scenario === 'all-on') { await page.locator('[data-enable-toggle]').check(); await count(page, 4); }
    if (scenario === 'one-on') { await page.locator('.pa-review [data-c=on]').nth(2).check(); await count(page, 1); }
    equal(await saved(page), target, `${scenario}：未确认只改变预览开关`);
    await page.locator('.pa-sheet-actions .pa-btn-primary').click();
    await page.waitForFunction(name => {
      const m = window.__mock;
      return m.presets[m.names.indexOf(name)].prompts.length === 7;
    }, targetName);
    const result = await saved(page);
    const added = result.prompts.filter(p => !target.prompts.some(x => x.identifier === p.identifier));
    assert.equal(added.length, 4);
    equal(result.prompts.filter(p => target.prompts.some(x => x.identifier === p.identifier)), target.prompts, '已有正文和条目属性保持原样');
    equal(added.map(p => [p.name, p.content]), source.prompts.map(p => [p.name, p.content]), '新增正文保持来源原文');
    equal(result.prompt_order[0].order.filter(o => o.identifier.startsWith('existing-')), target.prompt_order[0].order, '已有条目开关和顺序保持原样');
    equal(result.prompt_order[1], target.prompt_order[1], '其他角色的条目顺序保持原样');
    equal(result.extensions.baibaiToolkit, target.extensions.baibaiToolkit, '既有分组开关、成员及折叠标记保持原样');
    equal(result.extensions.unrelatedExtension, target.extensions.unrelatedExtension);
    assert.equal(result.temperature, target.temperature);
    const enabled = added.map(p => result.prompt_order[0].order.find(o => o.identifier === p.identifier).enabled);
    equal(enabled, scenario === 'all-off' ? [false, false, false, false] : scenario === 'all-on' ? [true, true, true, true] : [false, false, true, false], '确认后仅为新增条目保存选择');
    equal(await page.evaluate(name => window.__mock.presets[window.__mock.names.indexOf(name)], sourceName), source, '来源预设不改变');
    await page.click('[data-g=undo]');
    await page.waitForFunction(name => {
      const m = window.__mock;
      return m.presets[m.names.indexOf(name)].prompts.length === 3;
    }, targetName);
    equal(await saved(page), target, '撤销恢复缝合前整份目标');
    console.log(`✓ 真实预设缝合 ${scenario}：新增条目状态正确，已有开关/正文/分组/其他角色及来源不变，可完整撤销`);
    await page.close();
  }
  {
    const page = await boot();
    await selectFour(page);
    await chooseDstType(page, 'world');
    await choose(page, '.pa-dst-wb', '示例世界书');
    const before = await page.evaluate(() => structuredClone(window.__wiStore['示例世界书']));
    await page.locator('.pa-dst-list [data-act=top]').click();
    await page.click('[data-st=go]');
    await page.waitForSelector('.pa-review .pa-item');
    await count(page, 2);
    await page.locator('[data-enable-toggle]').check(); await count(page, 4);
    await page.locator('[data-enable-toggle]').uncheck(); await count(page, 0);
    await page.locator('[data-enable-toggle]').check(); await count(page, 4);
    await page.locator('[data-enable-toggle]').uncheck(); await count(page, 0);
    await page.locator('.pa-review [data-c=on]').nth(1).check(); await count(page, 1);
    await page.locator('[data-enable-toggle]').focus();
    await page.keyboard.press('Space'); await count(page, 4);
    await page.keyboard.press('Space'); await count(page, 0);
    equal(await page.evaluate(() => window.__wiStore['示例世界书']), before, '世界书预览开关也不提前保存');
    await page.locator('.pa-sheet-actions .pa-btn-primary').click();
    await page.waitForFunction(() => Object.values(window.__wiStore['示例世界书'].entries).length === 6);
    const after = await page.evaluate(() => window.__wiStore['示例世界书']);
    const added = Object.values(after.entries).filter(e => !(String(e.uid) in before.entries));
    assert.equal(added.length, 4);
    assert.ok(added.every(e => e.disable === true), '世界书全部关闭保存为disable=true');
    equal(added.map(e => [e.comment, e.content]), source.prompts.map(p => [p.name, p.content]));
    for (const [key, old] of Object.entries(before.entries)) {
      const { displayIndex: oldDisplay, ...oldRest } = old, { displayIndex: newDisplay, ...newRest } = after.entries[key];
      equal(newRest, oldRest, '原世界书正文、开关及触发设置不变，仅插入位置序号顺延');
    }
    await page.click('[data-st=wbundo]');
    await page.locator('.pa-sheet .pa-btn-danger').click();
    await page.waitForFunction(() => Object.values(window.__wiStore['示例世界书'].entries).length === 2);
    equal(await page.evaluate(() => window.__wiStore['示例世界书']), before, '世界书撤销恢复原始条目和排列');
    equal(await saved(page), target, '世界书缝合不改变预设目标');
    equal(await page.evaluate(name => window.__mock.presets[window.__mock.names.indexOf(name)], sourceName), source);
    console.log('✓ 世界书：批量开关预览未提前保存，全部关闭落为disable=true，正文及原条目不变，可撤销');
    await page.close();
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
