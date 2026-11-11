const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const A = require('./core.cjs');
const root = path.join(__dirname, '../src');
const code = ['core/macros.js', 'core/varflow.js', 'maintenance/variablewatch.js'].map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');
const settings = { variableWatch: false }, context = { chatId: 'one', chatMetadata: { variables: {} }, extensionSettings: { variables: { global: {} } } }, cleanup = [];
const F = new Function('ctx', 'settings', 'currentPresetName', 'hashStr', 'cleanups', code + '\nreturn {auditVariableFlow,flowVariableEvents,captureVariableSnapshot,variableSnapshotChanges,bindVariableWatch,variableObservations};')(() => context, () => settings, () => 'preset', A.hashStr, cleanup);
const draft = (contents, props = {}) => new A.Draft('preset', {
  prompts: contents.map((content, i) => ({ identifier: String(i), name: '条目' + i, content, ...props[i] })),
  prompt_order: [{ character_id: 100001, order: contents.map((_, i) => ({ identifier: String(i), enabled: true })) }]
});
let passed = 0;
function test(name, run) { run(); passed++; console.log('✓', name); }
const kinds = d => F.auditVariableFlow(d).issues.map(i => i.kind);
test('先读后写：跨条目和条目内部都提示风险', () => {
  assert.deepEqual(kinds(draft(['{{getvar::x}}', '{{setvar::x::新值}}'])), ['read-before-write']);
  assert.deepEqual(kinds(draft(['{{getvar::x}}{{setvar::x::新值}}'])), ['read-before-write']);
  assert.deepEqual(kinds(draft(['{{setvar::x::新值}}{{getvar::x}}'])), []);
});
test('写入后清空再读与删除后读取', () => {
  assert(kinds(draft(['{{setvar::x::正文}}', '{{setvar::x::}}', '{{getvar::x}}'])).includes('cleared'));
  for (const op of ['deletevar', 'flushvar']) assert(kinds(draft([`{{${op}::x}}{{getvar::x}}`])).includes('cleared'));
  assert.deepEqual(kinds(draft(['{{setvar::x::}}{{getvar::x}}'])), [], '仅初始化为空可能是有意的可选项');
});
test('未读即覆盖会提示，读取后覆盖与 add 追加不提示', () => {
  assert(kinds(draft(['{{setvar::x::甲}}{{setvar::x::乙}}{{getvar::x}}'])).includes('overwritten'));
  assert.deepEqual(kinds(draft(['{{setvar::x::甲}}{{getvar::x}}{{setvar::x::乙}}{{getvar::x}}'])), []);
  assert.deepEqual(kinds(draft(['{{setvar::x::甲}}{{addvar::x::乙}}{{getvar::x}}'])), []);
});
test('本地/全局隔离，中文名、存在检查和空格读取可识别', () => {
  assert.deepEqual(kinds(draft(['{{getvar::同名}}{{setglobalvar::同名::值}}'])), []);
  const report = F.auditVariableFlow(draft(['{{getglobalvar::文风}}{{setglobalvar::文风::古典}}']));
  assert.equal(report.issues[0].scope, 'global');
  assert.equal(F.flowVariableEvents('{{hasvar x}}{{getvar x}}').events.length, 2);
});
test('嵌套读取先于外层赋值，但嵌套写入不冒充确定顺序', () => {
  const report = F.auditVariableFlow(draft(['{{setvar::x::{{getvar::y}}}}', '{{setvar::y::正文}}']));
  assert.deepEqual(report.events.map(e => e.name), ['y', 'x', 'y']);
  assert(report.issues.some(i => i.name === 'y' && i.kind === 'read-before-write'));
  assert.equal(F.auditVariableFlow(draft(['{{setvar::x::{{setvar::y::正文}}}}'])).unknown.length, 1);
});
test('脚本、条件、动态名、深度和未闭合宏列为未推演', () => {
  for (const text of ['<% setvar("x",1) %>', '{{if::yes::{{setvar::x::值}}}}', '{{setvar::{{getvar::key}}::值}}', '{{getvar::x', '{{setvarkey::obj::key::值}}']) {
    assert.equal(F.auditVariableFlow(draft([text])).unknown.length, 1, text);
  }
  assert.equal(F.auditVariableFlow(draft(['{{setvar::x::值}}'], { 0: { injection_position: 1 } })).unknown.length, 1);
});
test('关闭的条目和注释内的变量不参与检查或修复扫描', () => {
  const d = draft(['{{getvar::x}}', '{{setvar::x::值}}']); d.order[1].enabled = false;
  assert.deepEqual(kinds(d), []);
  const comment = '{{// {{setvar::x::示例}}{{getvar::x}} }}';
  assert.equal(F.flowVariableEvents(comment).events.length, 0);
  assert.equal(A.listVarMacros(comment).length, 0);
});
test('状态快照只返回摘要，不执行 getter、不修改聊天、不包含变量正文', () => {
  context.chatMetadata.variables = { private: '不应出现在报告里的正文', zero: 0, flag: false, blank: '  ' };
  const before = JSON.stringify(context);
  const snapshot = F.captureVariableSnapshot();
  assert.equal(JSON.stringify(context), before);
  const rows = [...snapshot.rows.values()];
  assert.equal(rows.find(x => x.name === 'zero').empty, false);
  assert.equal(rows.find(x => x.name === 'flag').empty, false);
  assert.equal(rows.find(x => x.name === 'blank').empty, true);
  assert(!JSON.stringify(rows).includes('不应出现在报告里的正文'));
});
test('同长度值变化、新增删除可比较，不跨聊天比较', () => {
  context.chatMetadata.variables = { x: '甲', deleted: '值' };
  const a = F.captureVariableSnapshot();
  context.chatMetadata.variables = { x: '乙', added: '' };
  const b = F.captureVariableSnapshot();
  assert.deepEqual(F.variableSnapshotChanges(a, b).map(x => x.kind).sort(), ['删除', '变化', '新增']);
  context.chatId = 'two'; assert.deepEqual(F.variableSnapshotChanges(a, F.captureVariableSnapshot()), []); context.chatId = 'one';
});
test('同名聊天的不同角色不会串用快照，接口不可用不误报变量删除', () => {
  context.characterId=1; const a=F.captureVariableSnapshot();context.characterId=2;
  assert.deepEqual(F.variableSnapshotChanges(a,F.captureVariableSnapshot()),[]);
  delete context.characterId;
  context.extensionSettings.variables.global.x='值';const before=F.captureVariableSnapshot();
  delete context.extensionSettings.variables.global;const after=F.captureVariableSnapshot();
  assert.deepEqual(F.variableSnapshotChanges(before,after),[]);
  context.extensionSettings.variables.global={};
});
test('运行时记录默认关闭，开启后按生成生命周期记录，试算不打断', () => {
  const events = { GENERATION_AFTER_COMMANDS: 'before', GENERATION_ENDED: 'after', GENERATION_STOPPED: 'stop', CHAT_CHANGED: 'chat', PRESET_CHANGED: 'preset' }, hooks = {};
  F.bindVariableWatch((e, fn) => { if (e) hooks[e] = fn; }, events);
  hooks.before('normal', {}, false); hooks.after(); assert.equal(F.variableObservations.size, 0);
  settings.variableWatch = true;
  hooks.before('normal', {}, false); hooks.before('normal', {}, true);
  context.chatMetadata.variables.x = '新值'; hooks.after();
  const record = [...F.variableObservations.values()][0];
  assert.equal(record.phase, '生成后'); assert(record.changes.some(x => x.name === 'x'));
  F.variableObservations.clear(); hooks.before('quiet', {}, false); hooks.after(); assert.equal(F.variableObservations.size, 0);
  cleanup.forEach(fn => fn());
});
console.log(`${passed} 项变量顺序/状态检查通过`);
