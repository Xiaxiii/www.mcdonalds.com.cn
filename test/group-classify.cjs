const assert = require('node:assert/strict');
const A = require('./core.cjs');
const fixture = require('./fixtures/ungrouped-sections.cjs');
const make = () => new A.Draft('未分组截图结构', fixture());
const scan = d => A.groupingSuggestions(d);
const proposal = (d, id) => scan(d).suggestions.find(g => g.ids.includes(id));
const apply = (d, plan) => { d.preset.prompt_order[0].order = plan.order; d.groups = plan.groups; };
let passed = 0;
const test = (name, run) => { run(); passed++; console.log('✓', name); };
test('截图中的箭头开关区可以识别，长标题正文不阻止归组', () => {
  const d = make(), g = proposal(d, 'panel');
  assert.equal(g.name, '一键开关');
  assert.deepEqual(g.ids, ['panel', 'repeat', 'base-switch', 'opt-switch', 'emotion-switch', 'nsfw-switch', 'note-switch', 'function-switch']);
  assert.equal(g.targetGroupId, null);
});
test('装饰分隔线、下一已有分组与系统占位符不会吞入开关区', () => {
  const d = make(), g = proposal(d, 'panel');
  for (const id of ['divider', 'cot', 'chatHistory']) assert(!g.ids.includes(id));
  d.prompt('panel').name = '⬇️ 一键开关 ⬇️';
  assert.equal(proposal(d, 'panel').name, '一键开关');
  d.preset.prompt_order[0].order.splice(8, 1);
  assert(!proposal(d, 'panel').ids.includes('cot'));
});
test('箭头标题可在文件末尾或向上箭头处结束', () => {
  const d = make(); d.preset.prompt_order[0].order = d.order.slice(0, 8);
  assert.equal(proposal(d, 'panel').ids.length, 8);
  d.prompt('function-switch').name = '↑ 一键开关 ↑';
  assert.equal(proposal(d, 'panel').ids.at(-1), 'function-switch');
});
test('只有一个开关的箭头分区也可识别，孤立标题不创建空组', () => {
  const d = make(); d.preset.prompt_order[0].order = d.order.slice(0, 2);
  assert.deepEqual(proposal(d, 'panel').ids, ['panel', 'repeat']);
  d.preset.prompt_order[0].order = d.order.slice(0, 1);
  assert(!proposal(d, 'panel'));
});
test('常见 ┌┐ 与 └┘ 框线和横线修饰可识别为一组', () => {
  const d = make(); d.prompt('panel').name = '┌─一键开关─┐'; d.prompt('function-switch').name = '└─一键开关─┘';
  assert.equal(proposal(d, 'panel').name, '一键开关');
  assert.equal(proposal(d, 'panel').ids.at(-1), 'function-switch');
});
test('已有同名分区时建议移入，不重复新建', () => {
  const d = make(); d.groups.groups.push({ id: 'switches', name: '一键开关区', anchor: '', enabled: true });
  assert.equal(proposal(d, 'panel').targetGroupId, 'switches');
  const result = A.planGroupingAssignments(d, scan(d).suggestions);
  assert.equal(result.newGroupIds.length, 0);
  assert.equal(result.groups.prompts.panel.groupId, 'switches');
});
test('明确分区前缀和组内至少两条共用变量可恢复已有分区归属', () => {
  const d = make();
  assert.equal(proposal(d, 'loose-prefix').targetGroupId, 'base-group');
  assert.equal(proposal(d, 'loose-variable').targetGroupId, 'opt-group');
});
test('同名分区有多个时须选择，不能擅自挑第一个', () => {
  const d = make();
  d.groups.groups.push({ id: 'switch-a', name: '一键开关', anchor: '' }, { id: 'switch-b', name: '一键开关区', anchor: '' });
  const g = proposal(d, 'panel'); assert.equal(g.needsChoice, true); assert.equal(g.targetGroupId, null);
  d.group('opt-group').name = '基础需求分区';
  assert(scan(d).unassigned.some(g => g.ids.includes('loose-prefix')));
});
test('共同变量在多个分区中使用，或只有一条样本时不自动归属', () => {
  const d = make(); d.prompt('base').content = '{{setvar::写作风格::别的分区也使用}}';
  assert(scan(d).unassigned.some(g => g.ids.includes('loose-variable')));
  const one = make(); one.groups.prompts.style2 = { groupId: 'base-group' }; one.prompt('style2').content = '其他规则';
  assert(scan(one).unassigned.some(g => g.ids.includes('loose-variable')));
});
test('名称归属与变量归属冲突时列入待指定', () => {
  const d = make(); d.prompt('loose-prefix').content = '{{setvar::写作风格::内容}}';
  assert(scan(d).unassigned.some(g => g.ids.includes('loose-prefix')));
});
test('分区控制开关不能仅因被控分区名称而误塞进该分区', () => {
  const d = make(); d.preset.prompt_order[0].order = d.order.filter(o => o.identifier !== 'panel');
  assert(!proposal(d, 'base-switch')); assert(!proposal(d, 'opt-switch'));
  assert(scan(d).unassigned.some(g => g.ids.includes('base-switch')));
});
test('局部和全局变量不能混作同一种归属依据', () => {
  const d = make(); d.prompt('loose-variable').content = '{{setglobalvar::写作风格::内容}}';
  assert(scan(d).unassigned.some(g => g.ids.includes('loose-variable')));
});
test('正文 START/END 注释跨条目分区也可识别，关闭条目不被遗漏', () => {
  const d = make();
  d.prompt('panel').name = '总标题'; d.prompt('panel').content = '<!-- START: 开关面板 -->';
  d.prompt('function-switch').content = '<!-- END: 开关面板 -->';
  const g = proposal(d, 'panel'); assert.equal(g.name, '开关面板'); assert(g.ids.includes('emotion-switch'));
});
test('预览不修改输入，应用后正文、开关、组外占位符和未知条目保留', () => {
  const d = make(), before = d.toPreset(), groups = JSON.stringify(d.groups);
  const result = A.planGroupingAssignments(d, scan(d).suggestions);
  assert.deepEqual(d.toPreset(), before); assert.equal(JSON.stringify(d.groups), groups); assert.equal(d.history.length, 0);
  apply(d, result);
  assert.deepEqual(d.preset.prompts, before.prompts);
  const switches = new Map(before.prompt_order[0].order.map(o => [o.identifier, o.enabled]));
  for (const o of d.order) assert.equal(o.enabled, switches.get(o.identifier));
  assert.equal(d.groupOf('unknown'), null); assert.equal(d.groupOf('chatHistory'), null); assert.equal(d.groupOf('divider'), null);
  assert.equal(d.groupOf('base-switch'), d.groupOf('panel'));
  assert.equal(d.groupOf('loose-prefix'), 'base-group'); assert.equal(d.groupOf('loose-variable'), 'opt-group');
});
test('移入有关闭标记的分区时放在标记之前，并收拢原分散成员', () => {
  const d = make();
  d.prompt('style2').name = '└─优化分区─┘'; d.prompt('style2').content = '</优化>';
  d.preset.prompt_order[0].order = d.order.filter(o => o.identifier !== 'unknown');
  d.preset.prompt_order[0].order.splice(12, 0, { identifier: 'unknown', enabled: true });
  const result = A.planGroupingAssignments(d, [{ ids: ['loose-variable'], targetGroupId: 'opt-group' }]); apply(d, result);
  const list = d.order.map(o => o.identifier), close = list.indexOf('style2');
  assert.equal(list[close - 1], 'loose-variable'); assert.equal(list[close - 2], 'style');
  assert.equal(d.groupOf('unknown'), null);
});
test('重复分配、移动已有成员、系统占位符或消失目标均拒绝应用', () => {
  const d = make(), before = d.toPreset();
  for (const assignments of [
    [{ name: '新组', ids: ['unknown'] }, { targetGroupId: 'base-group', ids: ['unknown'] }],
    [{ targetGroupId: 'base-group', ids: ['style'] }],
    [{ name: '新组', ids: ['chatHistory'] }],
    [{ targetGroupId: 'missing', ids: ['unknown'] }],
    [{ name: '', ids: ['unknown'] }]
  ]) assert.throws(() => A.planGroupingAssignments(d, assignments));
  assert.deepEqual(d.toPreset(), before);
});
test('归组可保存重读并一次撤销，手动指定的未知条目也可移入', () => {
  const d = make(), before = d.toPreset();
  const result = A.planGroupingAssignments(d, [...scan(d).suggestions, { ids: ['unknown'], targetGroupId: 'base-group' }]);
  d.snapshot('识别并归入分区'); apply(d, result);
  const reloaded = new A.Draft('重读', d.toPreset());
  assert.equal(reloaded.groupOf('unknown'), 'base-group'); assert.equal(reloaded.groupOf('panel'), reloaded.groupOf('base-switch'));
  assert.equal(d.undo(), '识别并归入分区'); assert.deepEqual(d.toPreset(), before);
});
console.log(`${passed} 项未分组识别检查通过`);
