const assert = require('node:assert/strict');
const A = require('./core.cjs');
const fixture = require('./fixtures/group-repair.cjs');
const make = () => new A.Draft('分散分区', fixture());
const ids = d => d.order.map(o => o.identifier);
const apply = (d, groups) => { d.preset.prompt_order.find(o => o.character_id === 100001).order = A.planGroupGather(d, groups).order; };
const expected = ['init', 'a1', 'a2', 'a3', 'a4', 'a5', 'loose', 'b1', 'b2', 'chatHistory', 'tail'];
let passed = 0;
function test(name, run) { run(); passed++; console.log('✓', name); }

test('识别同组四段和交错两段，空组与未分组条目不误报', () => {
  assert.deepEqual(A.fragmentedGroups(make()).map(g => [g.groupId, g.parts, g.ids.length]), [['a', 4, 5], ['b', 2, 2]]);
});
test('预览只读，保留每条顺序记录的开关和额外字段', () => {
  const d = make(), before = JSON.stringify(d.toPreset()), entries = [...d.order];
  const plan = A.planGroupGather(d);
  assert.deepEqual(plan.order.map(o => o.identifier), expected);
  for (const o of plan.order) assert.strictEqual(o, entries.find(x => x.identifier === o.identifier));
  assert.equal(JSON.stringify(d.toPreset()), before);
  assert.equal(d.dirty, false); assert.equal(d.history.length, 0);
});
test('批量归整保持组内先后、成员归属、正文、组开关和其他角色顺序', () => {
  const d = make(), before = JSON.parse(JSON.stringify(d.preset)), groups = JSON.stringify(d.groups);
  apply(d);
  assert.deepEqual(ids(d), expected);
  assert.deepEqual(A.fragmentedGroups(d), []);
  assert.deepEqual(d.preset.prompts, before.prompts);
  assert.deepEqual(d.preset.prompt_order[1], before.prompt_order[1]);
  assert.equal(JSON.stringify(d.groups), groups);
  assert.equal(d.groupOf('loose'), null); assert.equal(d.groupOf('chatHistory'), null);
});
test('只勾选一个分区，不把另一分区也强制归整', () => {
  const d = make(); apply(d, ['b']);
  assert.deepEqual(ids(d), ['init', 'a1', 'a2', 'loose', 'b1', 'b2', 'a3', 'a4', 'chatHistory', 'a5', 'tail']);
  assert.deepEqual(A.fragmentedGroups(d).map(g => [g.groupId, g.parts]), [['a', 3]]);
});
test('空选择、不存在的分区与已经连续的分区均不移动', () => {
  const d = make(), before = ids(d);
  for (const groups of [[], ['missing'], ['empty']]) assert.deepEqual(A.planGroupGather(d, groups).order.map(o => o.identifier), before);
  apply(d); const done = ids(d); apply(d);
  assert.deepEqual(ids(d), done);
  assert.deepEqual(A.planGroupGather(d).groups, []);
});
test('分区同名仍按独立 id 归整，不合并或猜测成员', () => {
  const d = make(); d.group('b').name = d.group('a').name;
  apply(d);
  assert.deepEqual(ids(d), expected);
  assert.equal(d.groupOf('a5'), 'a'); assert.equal(d.groupOf('b2'), 'b');
  assert.equal(d.groups.groups.length, 3);
});
test('柏宝箱格式保存重读后分区连续，开关与第三方数据保留', () => {
  const d = make(), switches = new Map(d.order.map(o => [o.identifier, o.enabled])); apply(d);
  const reloaded = new A.Draft('分散分区', d.toPreset());
  assert.deepEqual(ids(reloaded), expected); assert.deepEqual(A.fragmentedGroups(reloaded), []);
  for (const o of reloaded.order) assert.equal(o.enabled, switches.get(o.identifier));
  assert.deepEqual(reloaded.group('b').restoreOn, ['b2']); assert.equal(reloaded.group('b').enabled, false);
  assert.equal(reloaded.group('empty').anchor, 'loose');
  assert.equal(reloaded.groups.prompts.a3.foreign, 'a3');
  assert.deepEqual(reloaded.preset.extensions.foreign, { keep: true });
});
test('entryGrouping 成员列表格式归整后保存为连续范围，重读不吞入组外条目', () => {
  const p = fixture(); delete p.extensions.baibaiToolkit;
  p.extensions.entryGrouping = [
    { id: 'a', name: '优化分区', memberIdentifiers: ['a1', 'a2', 'a3', 'a4', 'a5'] },
    { id: 'b', name: '基础需求', memberIdentifiers: ['b1', 'b2'] }
  ];
  const d = new A.Draft('成员列表', p); apply(d);
  const saved = d.toPreset();
  assert(!saved.extensions.baibaiToolkit);
  assert(saved.extensions.entryGrouping.every(g => g.startIdentifier && g.endIdentifier && !g.memberIdentifiers));
  const reloaded = new A.Draft('成员列表', saved);
  assert.deepEqual(ids(reloaded), expected);
  assert.equal(reloaded.groupOf('loose'), null); assert.equal(reloaded.groupOf('chatHistory'), null);
  assert.equal(reloaded.groupOf('a5'), 'a'); assert.equal(reloaded.groupOf('b2'), 'b');
});
test('一次撤销完整恢复原有分散顺序与分组状态', () => {
  const d = make(), before = d.toPreset();
  d.snapshot('归整分散分区'); apply(d);
  assert.notDeepEqual(ids(d), before.prompt_order[0].order.map(o => o.identifier));
  assert.equal(d.undo(), '归整分散分区');
  assert.deepEqual(d.toPreset(), before); assert.equal(d.history.length, 0);
});
test('无分组的预设不按条目名称擅自分类', () => {
  const p = fixture(); p.extensions = {};
  const d = new A.Draft('无分组', p), before = ids(d);
  assert.deepEqual(A.fragmentedGroups(d), []); apply(d); assert.deepEqual(ids(d), before);
  assert.equal(d.groups.groups.length, 0);
});
console.log(`${passed} 项分区归整检查通过`);
