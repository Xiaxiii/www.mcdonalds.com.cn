import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { choose, chooseSrcType } from './choose.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const order = JSON.parse(fs.readFileSync(path.join(root, 'order.json'), 'utf8'));
let bundle = "var BUILD_KIND='extension',VERSION='正则缝制合成回归',CHANGELOG='';\n";
for (const file of order) {
  const content = fs.readFileSync(path.join(root, 'src', file), 'utf8');
  bundle += file.endsWith('.css') ? `\nvar style_default=${JSON.stringify(content)};\n` : `\n${content}\n`;
}
// 仅供本地回归观察真实草稿与失效机制；测试不替换计划、应用或保存逻辑。
bundle += '\nglobalThis.__regexTransferTest={getDraft,notifyDraft,setFocusPreset,dropDraft,getRefreshName:()=>presetRegexRefreshName};\n';
const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (pathname === '/index.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end(bundle); }
  const file = path.resolve(root, `.${pathname}`);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
  try {
    const content = fs.readFileSync(file);
    res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' })[path.extname(file)] || 'application/octet-stream' });
    res.end(content);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const targetName = '正则缝制目标（公开合成）', sourceName = '状态栏正则来源（公开合成）';
const regex = (id, scriptName, extra = {}) => ({ id, scriptName, findRegex: '/\\[状态\\]([\\s\\S]*?)\\[\\/状态\\]/g', replaceString: '<div class="status">$1</div>', trimStrings: [], placement: [2], disabled: false, markdownOnly: true, promptOnly: false, runOnEdit: true, substituteRegex: 0, minDepth: 0, maxDepth: null, ...extra });
const exact = regex('exact', '已存在的相同美化');
const maliciousHtml = '<img src=x onerror="window.__regexPwn=1"><script>window.__regexPwn=2</script><div>$1</div>';
const sourceRules = [
  regex('new-style', '来源美化 <img src=x onerror="window.__regexPwn=3">', { replaceString: maliciousHtml, nativeExtra: { preserve: ['来源自定义字段', 7] } }),
  exact,
  regex('source-conflict', '同名状态栏', { replaceString: '<section class="new">$1</section>' }),
  regex('source-off', '来源关闭的美化', { disabled: true, minDepth: 2, maxDepth: 5 }),
  regex('prompt', '发送内容处理', { markdownOnly: false, promptOnly: true, replaceString: '$1' }),
  regex('unrestricted', '通用处理', { markdownOnly: false, promptOnly: false, replaceString: '$1' })
];
const target = {
  temperature: 0.71,
  prompts: [{ identifier: 'existing', name: '既有正文', content: '不改提示词内容', role: 'system' }],
  prompt_order: [{ character_id: 100001, order: [{ identifier: 'existing', enabled: false }] }],
  extensions: { regex_scripts: [exact, regex('target-conflict', '同名状态栏', { replaceString: '<article class="old">$1</article>' }), regex('target-kept', '目标其他规则', { disabled: true })], unrelated: { preserved: 42 }, baibaiToolkit: { otherTargetFeature: { kept: ['目标其他柏宝箱字段', 42] }, regexGroups: { version: 1, groups: [{ id: 'target-group', name: '目标原有正则组', order: 0, collapsed: true, nativeExtra: '目标组未知字段保留' }], scripts: { exact: { groupId: 'target-group', order: 0, nativeMemberExtra: true }, 'target-conflict': { groupId: 'target-group', order: 1 } }, ungrouped: { name: '目标默认分组', collapsed: true, nativeUngroupedExtra: 7 }, nativeSchemaExtra: { kept: true } } } }
};
const source = { prompts: [{ identifier: 'source-prompt', name: '来源提示词', content: '不必选择提示词即可缝正则', role: 'system' }], prompt_order: [{ character_id: 100001, order: [{ identifier: 'source-prompt', enabled: true }] }], extensions: { regex_scripts: sourceRules, unrelatedSource: true, baibaiToolkit: { sourceOnlyFeature: '不复制来源其他扩展字段', regexGroups: { version: 1, groups: [{ id: 'source-group', name: '来源原分组不整搬', order: 0, collapsed: false, sourceOnlyExtra: '不复制来源组未知字段' }], scripts: { 'new-style': { groupId: 'source-group', order: 0, sourceMemberExtra: true } }, ungrouped: { name: '来源默认分组', collapsed: false }, sourceSchemaExtra: { notImported: true } } } } };
const errors = [];
const equal = (a, b, label) => assert.deepEqual(a, b, label);
const stored = (page, name = targetName) => page.evaluate(name => structuredClone(window.__mock.presets[window.__mock.names.indexOf(name)]), name);
const dialog = page => page.getByRole('dialog', { name: '缝合预设正则', exact: true });
const luminance = rgb => rgb.map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
const contrastRatio = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
function renderedTextSurface(node) {
  const parse = value => { const n = value.match(/[\d.]+/g).map(Number); return value.startsWith('color(srgb') ? [n[0] * 255, n[1] * 255, n[2] * 255, n[3] ?? 1] : [...n.slice(0, 3), n[3] ?? 1]; };
  const mix = (fg, bg, alpha = fg[3]) => [0, 1, 2].map(i => fg[i] * alpha + bg[i] * (1 - alpha));
  const chain = [], opacity = [];
  for (let current = node; current; current = current.parentElement) chain.unshift(current);
  let bg = [255, 255, 255];
  for (const current of chain) {
    const cs = getComputedStyle(current);
    opacity.push({ behind: bg, value: Number(cs.opacity) });
    bg = mix(parse(cs.backgroundColor), bg);
  }
  const cs = getComputedStyle(node);
  let fg = mix(parse(cs.webkitTextFillColor || cs.color), bg);
  for (const layer of opacity.reverse()) if (layer.value !== 1) { fg = mix(fg, layer.behind, layer.value); bg = mix(bg, layer.behind, layer.value); }
  return { fg, bg, fontSize: parseFloat(cs.fontSize) };
}
function withoutTransferredRegex(preset) {
  const result = structuredClone(preset);
  result.extensions.regex_scripts = [];
  if (result.extensions.baibaiToolkit) delete result.extensions.baibaiToolkit.regexGroups;
  return result;
}
// 按柏宝箱真实存储格式读取成员；不伪造原生平铺面板的分组能力，也不改规则开关。
function readSavedGroupMembers(preset, id) {
  const state = preset.extensions.baibaiToolkit.regexGroups;
  return preset.extensions.regex_scripts.filter(rule => state.scripts[rule.id]?.groupId === id)
    .sort((a, b) => Number(state.scripts[a.id].order) - Number(state.scripts[b.id].order));
}
function assertTransferGroup(preset, name, memberIds, { existing = target, reused = false } = {}) {
  const state = preset.extensions.baibaiToolkit.regexGroups;
  const previous = existing.extensions.baibaiToolkit.regexGroups;
  const groups = state.groups.filter(group => group.name === name);
  assert.equal(groups.length, 1, '指定名称只有一个正则分组');
  const group = groups[0];
  assert.equal(state.version, 1);
  assert.equal(state.groups.length, previous.groups.length + (reused ? 0 : 1), '创建或复用正则组');
  equal(readSavedGroupMembers(preset, group.id).map(rule => rule.id).filter(id => memberIds.includes(id)), memberIds, '真实最终规则 ID 按来源顺序进入指定组');
  const actualNewMembers = Object.entries(state.scripts).filter(([id, membership]) => membership.groupId === group.id && !Object.hasOwn(previous.scripts, id)).map(([id]) => id);
  equal(actualNewMembers, memberIds.filter(id => !Object.hasOwn(previous.scripts, id)), '只登记实际新增或替换的规则');
  assert.equal(state.scripts.exact.groupId, previous.scripts.exact.groupId, '精确重复规则保留原组');
  for (const [id, membership] of Object.entries(previous.scripts)) if (!memberIds.includes(id)) equal(state.scripts[id], membership, '未参与缝入的原成员及未知字段保持不变');
  equal(state.ungrouped, previous.ungrouped, '默认组及未知字段原样保留');
  equal(state.nativeSchemaExtra, previous.nativeSchemaExtra, '目标schema未知字段保留');
  equal(preset.extensions.baibaiToolkit.otherTargetFeature, existing.extensions.baibaiToolkit.otherTargetFeature, '柏宝箱其他功能字段保留');
  assert.equal(Object.hasOwn(state, 'sourceSchemaExtra'), false, '不搬来源组未知元数据');
  assert.equal(Object.hasOwn(preset.extensions.baibaiToolkit, 'sourceOnlyFeature'), false);
  assert.equal(state.groups.some(item => item.id === 'source-group'), false);
  if (!reused) equal(state.groups[0], previous.groups[0], '原有分组原样保留');
  return group;
}
async function boot(width, targetPreset = target) {
  const page = await browser.newPage({ viewport: { width, height: width < 500 ? 844 : 900 }, isMobile: width < 500, hasTouch: width < 500 });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${base}/test/site/index.html`);
  await page.waitForFunction(() => window.__presetAtelier?.open);
  await page.evaluate(({ target, source, targetName, sourceName }) => {
    const m = window.__mock;
    m.names.splice(0, m.names.length, targetName, sourceName);
    m.presets.splice(0, m.presets.length, structuredClone(target), structuredClone(source));
    m.live.preset_settings_openai = targetName;
    Object.assign(m.live, structuredClone(target));
    const settings = window.SillyTavern.getContext().extensionSettings;
    settings.regex = [{ id: 'global-kept', scriptName: '全局规则保持原样' }];
    settings.preset_allowed_regex = { openai: ['其他授权预设'] };
    window.__presetAtelier.open('suture');
  }, { target: targetPreset, source, targetName, sourceName });
  await choose(page, '.pa-src-name', sourceName);
  await choose(page, '.pa-dst-picker .pa-namebtn', targetName);
  return page;
}
// 2.6.1：缝合正则在来源类型「正则」里（选中即打开）；之后点来源栏的「选择正则…」再打开。正则文件读入后自动打开
async function clickRegex(page) {
  await page.waitForTimeout(150);
  if (await page.locator('.pa-sheet-mask:not(.pa-out) .pa-regex-transfer').count()) return;
  if (await page.locator('.pa-rx-src [data-st=regex]').isVisible()) return page.click('.pa-rx-src [data-st=regex]');
  return chooseSrcType(page, 'regex');
}
async function openRegex(page) {
  assert.equal(await page.locator('[data-st=go]').isDisabled(), true, '无需选择提示词或位置');
  await clickRegex(page);
  await dialog(page).waitFor();
}
async function waitSaved(page, count) {
  await page.waitForFunction(({ name, count }) => {
    const m = window.__mock;
    return m.presets[m.names.indexOf(name)].extensions.regex_scripts.length === count;
  }, { name: targetName, count });
}
async function cancel(page) {
  await dialog(page).getByRole('button', { name: '取消', exact: true }).click();
  await page.waitForTimeout(190);
}
try {
  for (const width of [390, 1100]) {
    const page = await boot(width);
    await openRegex(page);
    const d = dialog(page);
    assert.equal(await d.locator('[data-rx-group-name]').inputValue(), sourceName);
    assert.match(await d.locator('[data-rx-group-preview]').innerText(), /新建分组/);
    assert.ok((await d.locator('[data-rx-group-preview]').innerText()).includes(sourceName));
    assert.match(await d.getByText('分组保存在目标预设中', { exact: false }).textContent(), /柏宝箱.*原生.*平铺/);
    assert.match(await d.locator('[data-rx-activation]').innerText(), /尚未允许.*酒馆「正则」面板/);
    if (width === 390) {
      await page.evaluate(name => {
        const settings = window.SillyTavern.getContext().extensionSettings;
        settings.preset_allowed_regex.openai.push(name);
        window.__regexTransferTest.notifyDraft(name, 'status');
      }, targetName);
      assert.match(await d.locator('[data-rx-activation]').innerText(), /已允许使用内置正则/);
      await page.evaluate(name => {
        window.SillyTavern.getContext().extensionSettings.disabledExtensions = ['regex'];
        window.__regexTransferTest.notifyDraft(name, 'status');
      }, targetName);
      assert.match(await d.locator('[data-rx-activation]').innerText(), /全局停用.*开启正则功能/);
      await page.evaluate(name => {
        const settings = window.SillyTavern.getContext().extensionSettings;
        settings.preset_allowed_regex = { openai: ['其他授权预设'] };
        settings.disabledExtensions = [];
        window.__regexTransferTest.notifyDraft(name, 'status');
      }, targetName);
      assert.match(await d.locator('[data-rx-activation]').innerText(), /尚未允许/);
    }
    assert.match(await d.getByText('状态栏仍需配套提示词或世界书', { exact: false }).textContent(), /相应的标签和格式/);
    equal(await d.locator('[data-rx-select]').evaluateAll(inputs => inputs.filter(x => x.checked).map(x => Number(x.dataset.rxSelect))), [0, 1, 2, 3], '默认只选显示美化');
    assert.match(await d.locator('[data-rx-index="3"]').innerText(), /来源关闭/);
    assert.match(await d.locator('[data-rx-index="1"]').innerText(), /相同规则.*跳过/);
    assert.equal(await d.locator('[data-rx-conflict="2"]').inputValue(), 'keep');
    assert.equal(await d.locator('img,script,iframe').count(), 0, '名称与 HTML 尚未变成 DOM');
    await d.locator('[data-rx-details="0"] summary').click();
    assert.equal(await d.locator('[data-rx-details="0"] pre').nth(1).textContent(), maliciousHtml);
    assert.equal(await d.locator('img,script,iframe').count(), 0, '展开替换内容也只显示文本');
    assert.equal(await page.evaluate(() => window.__regexPwn || 0), 0);
    await d.locator('[data-rx-search]').fill('同名状态栏');
    // 搜索停一下才筛（2.5.7），等结果出来再数
    await page.waitForFunction(() => [...document.querySelectorAll('[data-rx-index]')].filter((x) => x.offsetParent !== null).length === 1, null, { timeout: 3000 });
    assert.equal(await d.locator('[data-rx-index]:visible').count(), 1);
    await d.locator('[data-rx-search]').fill('');
    equal(await stored(page), target, '纯预览不改目标');
    equal(await stored(page, sourceName), source, '纯预览不改来源');
    await cancel(page);
    equal(await stored(page), target, '取消不改目标');
    await openRegex(page);
    await d.locator('[data-rx-order] summary').click();
    await d.locator('[data-rx-final-order] li').first().waitFor();
    equal(await d.locator('[data-rx-final-order] li').evaluateAll(nodes => nodes.map(n => n.firstChild.textContent.trim())), [...target.extensions.regex_scripts.map(r => r.scriptName), sourceRules[0].scriptName, sourceRules[2].scriptName, sourceRules[3].scriptName], '保留两份时的最终真实顺序');
    await d.locator('[data-rx-conflict="2"]').selectOption('skip');
    assert.equal(await d.locator('[data-rx-final-order] li').count(), 5, '跳过冲突只搬两条新规则');
    await d.locator('[data-rx-conflict="2"]').selectOption('replace');
    assert.equal(await d.locator('[data-rx-final-order] li').count(), 5, '明确替换保留目标位置');
    assert.equal(await d.locator('[data-rx-final-order] li').nth(1).evaluate(n => n.firstChild.textContent.trim()), sourceRules[2].scriptName);
    await d.locator('[data-rx-conflict="2"]').selectOption('keep');
    await d.locator('[data-rx-pick=all]').click();
    assert.equal(await d.locator('[data-rx-select]:checked').count(), 6, '影响发送的规则也可主动手选');
    assert.equal(await d.locator('[data-rx-final-order] li').count(), 8);
    await d.locator('[data-rx-pick=none]').click();
    assert.equal(await d.getByRole('button', { name: '确认缝合正则', exact: true }).isDisabled(), true);
    await d.locator('[data-rx-pick=display]').click();
    assert.equal(await d.locator('[data-rx-select]:checked').count(), 4);
    const overflow = await d.evaluate(n => [...n.querySelectorAll('.pa-sheet-body, .pa-regex-transfer, .pa-card')].some(x => x.scrollWidth > x.clientWidth + 2));
    assert.equal(overflow, false, '手机与桌面预览均不横向溢出');
    fs.mkdirSync(path.join(root, 'test/shots'), { recursive: true });
    if (width < 500) await d.screenshot({ path: path.join(root, 'test/shots/regex-transfer-phone.png') });
    await d.getByRole('button', { name: '确认缝合正则', exact: true }).click();
    await waitSaved(page, 6);
    const saved = await stored(page);
    equal(saved.extensions.regex_scripts.slice(0, 3), target.extensions.regex_scripts, '原有规则顺序与内容保持');
    equal(saved.extensions.regex_scripts.slice(3).map(({ id, ...rest }) => rest), [sourceRules[0], sourceRules[2], sourceRules[3]].map(({ id, ...rest }) => rest), '新增完整原生字段与 disabled 状态保留');
    equal(withoutTransferredRegex(saved), withoutTransferredRegex(target), '提示词、参数及其他扩展字段不改');
    assertTransferGroup(saved, sourceName, saved.extensions.regex_scripts.slice(3).map(rule => rule.id));
    equal(saved.extensions.baibaiToolkit.regexGroups.scripts.exact, target.extensions.baibaiToolkit.regexGroups.scripts.exact, '跳过的精确重复不被挪入新组');
    equal(await stored(page, sourceName), source, '确认也不改来源');
    equal(await page.evaluate(() => window.SillyTavern.getContext().extensionSettings.preset_allowed_regex), { openai: ['其他授权预设'] }, '不擅自扩大原生启用授权');
    equal(await page.evaluate(() => window.SillyTavern.getContext().extensionSettings.regex), [{ id: 'global-kept', scriptName: '全局规则保持原样' }]);
    await page.click('[data-g=undo]');
    await waitSaved(page, 3);
    equal(await stored(page), target, '撤销恢复整份目标');
    console.log(`✓ 正则缝制 ${width}px：默认美化/来源开关、全选清空、重复与冲突、最终顺序、安全文本、保存撤销及授权范围`);
    await page.close();
  }
  {
    const page = await boot(390);
    await page.evaluate(({ targetName }) => {
      const c = window.SillyTavern.getContext();
      c.extensionSettings.preset_allowed_regex.openai.push(targetName);
      c.extensionSettings.disabledExtensions = [];
      window.__regexSourceNode = document.querySelector('.pa-src-name');
      window.__nativeRegexEvents = [];
      // 模拟原生面板只监听实际事件、读取已同步的当前预设数据；不替换宿主保存和刷新实现。
      c.eventSource.on(c.eventTypes.PRESET_CHANGED, (event) => {
        window.__nativeRegexEvents.push({ event: structuredClone(event), rules: structuredClone(window.__mock.live.extensions.regex_scripts),
          sourceConnected: window.__regexSourceNode.isConnected,
          sourceSame: window.__regexSourceNode === document.querySelector('.pa-src-name'),
          refreshName: window.__regexTransferTest.getRefreshName() });
      });
    }, { targetName });
    await openRegex(page);
    assert.match(await dialog(page).locator('[data-rx-activation]').innerText(), /已允许使用内置正则/);
    await dialog(page).getByRole('button', { name: '确认缝合正则', exact: true }).click();
    await waitSaved(page, 6);
    await page.waitForFunction(() => window.__nativeRegexEvents.length === 1 && window.__regexTransferTest.getRefreshName() === null);
    let nativeEvents = await page.evaluate(() => window.__nativeRegexEvents);
    equal(nativeEvents[0].event, { apiId: 'openai', name: targetName }, '已允许目标收到真实原生刷新事件');
    equal(nativeEvents[0].rules, (await stored(page)).extensions.regex_scripts, '原生监听读取到保存后的新规则');
    assert.equal(nativeEvents[0].sourceConnected && nativeEvents[0].sourceSame, true, '自身刷新不重画来源 DOM');
    assert.equal(nativeEvents[0].refreshName, targetName, '自身事件派发期间持有精确预设标记');
    assert.equal(await page.locator('.pa-src-name').innerText(), sourceName + '\n▾');
    assert.equal(await page.locator('[data-st=go]').isDisabled(), true, '仍未选提示词或位置');
    equal(await stored(page, sourceName), source, '刷新没有修改来源');
    await page.click('[data-g=undo]');
    await waitSaved(page, 3);
    await page.waitForFunction(() => window.__nativeRegexEvents.length === 2 && window.__regexTransferTest.getRefreshName() === null);
    nativeEvents = await page.evaluate(() => window.__nativeRegexEvents);
    equal(nativeEvents[1].rules, target.extensions.regex_scripts, '撤销后的原生监听也读取到恢复规则');
    assert.equal(nativeEvents[1].sourceConnected && nativeEvents[1].sourceSame, true, '撤销刷新同样保留来源 DOM');
    equal(await stored(page), target, '已授权目标也能完整撤销');
    const naturalSourceName = '真正预设变化后刷新的来源条目';
    await page.evaluate(async ({ sourceName, targetName, naturalSourceName }) => {
      const m = window.__mock;
      m.presets[m.names.indexOf(sourceName)].prompts[0].name = naturalSourceName;
      const c = window.SillyTavern.getContext();
      await c.eventSource.emit(c.eventTypes.PRESET_CHANGED, { apiId: 'openai', name: targetName });
    }, { sourceName, targetName, naturalSourceName });
    // 用 textContent：.pa-loose 是 content-visibility: auto，刚重画、还没画到屏幕上时 innerText 会是空的
    assert.equal(await page.locator('.pa-src-list [data-id="source-prompt"] .pa-name').textContent(), naturalSourceName, '随后真实预设变化照常重新读取来源');
    assert.equal(await page.evaluate(() => window.__regexSourceNode.isConnected), false, '自然事件仍正常刷新页面，而非被旧 guard 吞掉');
    nativeEvents = await page.evaluate(() => window.__nativeRegexEvents);
    assert.equal(nativeEvents.length, 3);
    assert.equal(nativeEvents[2].refreshName, null, 'finally 已清理自身刷新标记');
    console.log('✓ 已授权原生刷新：读到新规则、自身保存及撤销保留来源 DOM，自然预设事件仍正常刷新');
    await page.close();
  }
  {
    const ambiguous = structuredClone(target);
    ambiguous.extensions.regex_scripts.push(regex('second-conflict', '同名状态栏', { replaceString: '<aside class="old-second">$1</aside>' }));
    const page = await boot(390, ambiguous);
    await openRegex(page);
    const d = dialog(page);
    await d.locator('[data-rx-conflict="2"]').selectOption('replace');
    assert.equal(await d.locator('[data-rx-replace="2"]').inputValue(), '', '不猜测多个冲突中的替换目标');
    assert.equal(await d.getByRole('button', { name: '确认缝合正则', exact: true }).isDisabled(), true);
    await d.locator('[data-rx-replace="2"]').selectOption('3');
    assert.equal(await d.getByRole('button', { name: '确认缝合正则', exact: true }).isDisabled(), false);
    await d.getByRole('button', { name: '确认缝合正则', exact: true }).click();
    await waitSaved(page, 6);
    const saved = await stored(page);
    equal(saved.extensions.regex_scripts[1], ambiguous.extensions.regex_scripts[1], '未选中的同名目标不改');
    equal(saved.extensions.regex_scripts[3], { ...sourceRules[2], id: 'second-conflict' }, '只替换指定规则，保留目标 ID 和位置');
    assertTransferGroup(saved, sourceName, ['new-style', 'second-conflict', 'source-off'], { existing: ambiguous });
    equal(await stored(page, sourceName), source);
    console.log('✓ 多个同名冲突：必须明确选择单条替换目标，不覆盖其他规则');
    await page.close();
  }
  {
    const page = await boot(390);
    await page.evaluate(() => {
      for (const [key, value] of Object.entries({ SmartThemeBlurTintColor: 'rgb(32,33,38)', SmartThemeBodyColor: '#e4e1dc', SmartThemeQuoteColor: '#d0debd', SmartThemeEmColor: '#a9bfae' })) document.body.style.setProperty('--' + key, value);
      // 2.7.1 默认配色为「素」，这一段检查跟随酒馆的深色主题
      Object.assign(window.SillyTavern.getContext().extensionSettings.presetAtelier, { theme: 'follow', ui271: true });
      if (!document.getElementById('pa-root').hidden) window.__presetAtelier.open();
    });
    await page.waitForFunction(() => document.getElementById('pa-root').style.getPropertyValue('--pa-tint') === 'rgb(32, 33, 38)');
    await openRegex(page);
    const d = dialog(page);
    await d.locator('[data-rx-group-name]').fill('   ');
    assert.equal(await d.getByRole('button', { name: '确认缝合正则', exact: true }).isDisabled(), true, '空分组名不能确认');
    equal(await stored(page), target, '空名字及预览不落地任何分组');
    const customName = '手动命名｜' + '很长的中文状态栏美化分组'.repeat(7) + '＜手机可读＞';
    await d.locator('[data-rx-group-name]').fill('  ' + customName + '  ');
    assert.equal(await d.getByRole('button', { name: '确认缝合正则', exact: true }).isDisabled(), false);
    assert.ok((await d.locator('[data-rx-group-preview]').innerText()).includes(customName));
    assert.equal(await d.locator('[data-rx-group-preview]').evaluate(node => node.scrollWidth > node.clientWidth + 2), false, '长中文分组预览完整换行，无横溢');
    await d.evaluate(async node => { await Promise.all(node.closest('.pa-sheet-mask').getAnimations({ subtree: true }).map(animation => animation.finished)); });
    const inputSurface = await d.locator('[data-rx-group-name]').evaluate(renderedTextSurface);
    const previewSurface = await d.locator('[data-rx-group-preview]').evaluate(renderedTextSurface);
    assert.ok(inputSurface.fontSize >= 14 && previewSurface.fontSize >= 14, '手机深色组名输入与预览保留14px基准字号');
    assert.ok(contrastRatio(inputSurface.fg, inputSurface.bg) >= 4.5 && contrastRatio(previewSurface.fg, previewSurface.bg) >= 4.5, '深色实际叠加背景上的组名字色可读：' + JSON.stringify({ inputSurface, previewSurface, inputContrast: contrastRatio(inputSurface.fg, inputSurface.bg), previewContrast: contrastRatio(previewSurface.fg, previewSurface.bg) }));
    await d.locator('[data-rx-group-preview]').scrollIntoViewIfNeeded();
    fs.mkdirSync(path.join(root, 'test/shots'), { recursive: true });
    await page.screenshot({ path: path.join(root, 'test/shots/regex-group-long-dark-phone.png') });
    // 来源分组从不复制，它的无关元信息改变不应影响已选正则的搬运。
    await page.evaluate(name => {
      window.__regexTransferTest.getDraft(name).preset.extensions.baibaiToolkit.regexGroups = { sourceOnlyChanged: true };
      window.__regexTransferTest.notifyDraft(name, 'content');
    }, sourceName);
    assert.equal(await d.locator('[data-rx-stale]').isVisible(), false);
    await d.getByRole('button', { name: '确认缝合正则', exact: true }).click();
    await waitSaved(page, 6);
    assertTransferGroup(await stored(page), customName, ['new-style', 'source-conflict', 'source-off']);
    assert.equal((await stored(page)).extensions.regex_scripts.at(-1).disabled, true, '建组不联动正则开关');
    equal(await stored(page, sourceName), source, '来源分组内容不会被写回');
    await page.click('[data-g=undo]');
    await waitSaved(page, 3);
    equal(await stored(page), target, '一次撤销恢复规则与整个新建组');
    console.log('✓ 自动正则分组：空名拦截、长中文可读、自定义名称保存、来源分组忽略及完整撤销');
    await page.close();
  }
  {
    const reusable = structuredClone(target);
    reusable.extensions.baibaiToolkit.regexGroups.groups[0].name = sourceName;
    const page = await boot(390, reusable);
    await openRegex(page);
    const d = dialog(page);
    assert.match(await d.locator('[data-rx-group-preview]').innerText(), /加入已有分组/);
    await d.getByRole('button', { name: '确认缝合正则', exact: true }).click();
    await waitSaved(page, 6);
    const saved = await stored(page);
    const group = assertTransferGroup(saved, sourceName, ['new-style', 'source-conflict', 'source-off'], { existing: reusable, reused: true });
    assert.equal(group.id, 'target-group');
    equal(saved.extensions.baibaiToolkit.regexGroups.groups, reusable.extensions.baibaiToolkit.regexGroups.groups, '复用同名组保留原组ID、折叠与未知字段');
    equal(saved.extensions.baibaiToolkit.regexGroups.scripts.exact, reusable.extensions.baibaiToolkit.regexGroups.scripts.exact, '原成员及其未知字段不变');
    equal(readSavedGroupMembers(saved, group.id).map(rule => rule.id), ['exact', 'target-conflict', 'new-style', 'source-conflict', 'source-off'], '新成员追加在同名组已有成员之后');
    await page.click('[data-g=undo]');
    await waitSaved(page, 3);
    equal(await stored(page), reusable, '撤销复用组恢复既有成员');
    console.log('✓ 同名正则组复用：保留组和原成员，仅追加本次实际缝入规则，可撤销');
    await page.close();
  }
  for (const broken of ['version', 'groups', 'scripts']) {
    const invalid = structuredClone(target);
    const state = invalid.extensions.baibaiToolkit.regexGroups;
    if (broken === 'version') state.version = 99;
    if (broken === 'groups') state.groups = '格式损坏';
    if (broken === 'scripts') state.scripts = [];
    const page = await boot(390, invalid);
    await clickRegex(page);
    assert.equal(await dialog(page).count(), 0, '坏分组schema不能进入可确认预览');
    equal(await stored(page), invalid, '拒绝坏schema不覆盖原数据');
    equal(await stored(page, sourceName), source);
    console.log(`✓ 分组schema保护：${broken} 损坏时阻止缝制并保留原数据`);
    await page.close();
  }
  for (const changed of ['source', 'target', 'identity', 'focus', 'target-groups', 'target-groups-invalid']) {
    const page = await boot(390);
    await openRegex(page);
    await page.evaluate(({ changed, sourceName, targetName }) => {
      const api = window.__regexTransferTest;
      if (changed === 'focus') return api.setFocusPreset(sourceName);
      if (changed === 'identity') { api.dropDraft(targetName); api.getDraft(targetName); api.notifyDraft(targetName, 'content'); return; }
      if (changed === 'target-groups' || changed === 'target-groups-invalid') {
        const d = api.getDraft(targetName);
        if (changed === 'target-groups') d.preset.extensions.baibaiToolkit.regexGroups.groups[0].name = '预览后分组已改名';
        else d.preset.extensions.baibaiToolkit.regexGroups.groups = '损坏后的分组列表';
        api.notifyDraft(targetName, 'content');
        return;
      }
      const name = changed === 'source' ? sourceName : targetName;
      api.getDraft(name).preset.extensions.regex_scripts.push({ id: 'changed', scriptName: '规则列表在预览后发生变化' });
      api.notifyDraft(name, 'content');
    }, { changed, sourceName, targetName });
    assert.equal(await dialog(page).locator('[data-rx-stale]').isVisible(), true);
    assert.equal(await dialog(page).getByRole('button', { name: '确认缝合正则', exact: true }).isDisabled(), true);
    await cancel(page);
    equal(await stored(page), target, '失效计划没有写入原目标');
    equal(await stored(page, sourceName), source, '失效计划没有写入来源');
    console.log(`✓ 正则预览过期保护：${changed}`);
    await page.close();
  }
  {
    const page = await boot(390);
    await chooseSrcType(page, 'file');
    const fileSource = { prompts: [], extensions: { regex_scripts: sourceRules } };
    await page.locator('.pa-src-pick input[type=file]').setInputFiles({ name: '仅含正则的完整预设.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fileSource)) });
    await openRegex(page);
    assert.equal(await dialog(page).locator('[data-rx-index]').count(), 6, '完整 JSON 文件无需提示词条目也能独立缝制');
    await dialog(page).getByRole('button', { name: '确认缝合正则', exact: true }).click();
    await waitSaved(page, 6);
    assert.equal((await stored(page)).extensions.regex_scripts.at(-1).disabled, true);
    assertTransferGroup(await stored(page), '仅含正则的完整预设', ['new-style', 'source-conflict', 'source-off']);
    equal(await stored(page, sourceName), source, '文件搬运不改任何已保存来源预设');
    console.log('✓ 完整预设 JSON：不选择提示词和位置即可独立缝制，原生关闭状态保留');
    await page.close();
  }
  {
    const page = await boot(390);
    await chooseSrcType(page, 'file');
    const malformed = { scriptName: { toString: null }, id: { toString: null }, findRegex: { toString: null }, replaceString: { toString: null }, placement: [{ toString: null }], markdownOnly: true };
    const fileSource = { prompts: [], extensions: { regex_scripts: [sourceRules[0], malformed] } };
    await page.locator('.pa-src-pick input[type=file]').setInputFiles({ name: '包含损坏规则的预设.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fileSource)) });
    await openRegex(page);
    const d = dialog(page);
    assert.equal(await d.locator('[data-rx-select="1"]').isDisabled(), true, '损坏规则可以看到但不能搬运');
    assert.equal(await d.locator('[data-rx-select]:checked').count(), 1);
    await d.locator('[data-rx-details="1"] summary').click();
    await d.locator('[data-rx-details="1"] pre').first().waitFor();
    assert.match(await d.locator('[data-rx-details="1"] [data-rx-code]').innerText(), /查找表达式格式无效.*替换文本格式无效/s);
    await d.getByRole('button', { name: '确认缝合正则', exact: true }).click();
    await waitSaved(page, 4);
    equal((await stored(page)).extensions.regex_scripts.slice(0, 3), target.extensions.regex_scripts);
    assert.equal((await stored(page)).extensions.regex_scripts[3].id, sourceRules[0].id);
    assertTransferGroup(await stored(page), '包含损坏规则的预设', ['new-style']);
    console.log('✓ 损坏的规则字段：单条禁选并安全展示，不阻塞有效规则搬运');
    await page.close();
  }
  {
    const page = await boot(390);
    await chooseSrcType(page, 'file');
    const duplicateOnly = { prompts: [], extensions: { regex_scripts: structuredClone(target.extensions.regex_scripts) } };
    await page.locator('.pa-src-pick input[type=file]').setInputFiles({ name: '全部精确重复的来源.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(duplicateOnly)) });
    await openRegex(page);
    const d = dialog(page);
    assert.match(await d.locator('[data-rx-group-preview]').innerText(), /不创建分组/);
    assert.equal(await d.getByRole('button', { name: '确认缝合正则', exact: true }).isDisabled(), true);
    await cancel(page);
    equal(await stored(page), target, '全部跳过时不留下空组或重复归属');
    console.log('✓ 全部精确重复：禁确认且不创建空正则组');
    await page.close();
  }
  assert.deepEqual(errors, [], '无页面脚本异常');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
