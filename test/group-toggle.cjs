const assert = require('node:assert/strict');
const A = require('./core.cjs');
const fixture = require('./fixtures/group-toggle.cjs');
const make = () => new A.Draft('独立分组开关', fixture());
const states = d => d.order.map(o => [o.identifier, o.enabled]);
let passed = 0;
const test = (name, run) => { run(); passed++; console.log('✓', name); };
test('分组反复开关不改变互斥选项、其他分组和正文', () => {
  const d = make(), before = states(d), prompts = structuredClone(d.preset.prompts);
  for (const on of [false, true, false, false, true]) { d.setGroupEnabled('theater', on); assert.deepEqual(states(d), before); }
  assert.deepEqual(d.preset.prompts, prompts); assert.equal(d.group('extras').enabled, true);
});
test('内部全关时分组可以独立开启，旧 restoreOn 不再全开条目', () => {
  const d = make(); d.group('extras').enabled = false; d.group('extras').restoreOn = [];
  const before = states(d); d.setGroupEnabled('extras', true);
  assert.deepEqual(states(d), before); assert.equal(d.groupOff('extras'), false); assert(!('restoreOn' in d.group('extras')));
  d.group('extras').restoreOn = ['extra1']; d.setGroupEnabled('extras', false); d.setGroupEnabled('extras', true);
  assert.deepEqual(states(d), before);
});
test('关闭期间修改单项后重新开启，保留最新独立选择', () => {
  const d = make(); d.setGroupEnabled('theater', false);
  d.setEnabled(['night'], false); d.setEnabled(['day'], true);
  const before = states(d); d.setGroupEnabled('theater', true); assert.deepEqual(states(d), before);
  assert.equal(d.isActive('day'), true); assert.equal(d.isActive('night'), false);
});
test('柏宝箱分组开关保存重载和撤销不改成员选择', () => {
  const d = make(), before = states(d); d.snapshot('分组开关'); d.setGroupEnabled('theater', false);
  const back = new A.Draft('重载', d.toPreset()); assert.equal(back.groupOff('theater'), true); assert.deepEqual(states(back), before);
  d.undo(); assert.equal(d.groupOff('theater'), false); assert.deepEqual(states(d), before);
});
test('entryGrouping 范围及成员格式保存分组标记，不引入第二套分组', () => {
  for (const members of [false, true]) {
    const p = fixture(); delete p.extensions.baibaiToolkit;
    p.extensions.entryGrouping = [members ? { id: 'g', name: '离散', memberIdentifiers: ['night', 'extra1'], enabled: true } : { id: 'g', name: '连续', startIdentifier: 'night', endIdentifier: 'day', enabled: true }];
    const d = new A.Draft('旧格式', p), before = states(d); d.setGroupEnabled('g', false);
    const out = d.toPreset(); assert.equal(out.extensions.baibaiToolkit, undefined);
    const back = new A.Draft('重载', out); assert.equal(back.groupOff('g'), true); assert.deepEqual(states(back), before);
    back.setGroupEnabled('g', true); assert.deepEqual(states(back), before);
  }
});
test('空组的标记独立切换，不影响其他条目', () => {
  const d = make(), before = states(d); d.groups.groups.push({ id: 'empty', name: '空组', enabled: true });
  for (const on of [false, true]) { d.setGroupEnabled('empty', on); assert.equal(d.groupOff('empty'), !on); assert.deepEqual(states(d), before); }
});
console.log(`${passed} 项分组独立开关检查通过`);
