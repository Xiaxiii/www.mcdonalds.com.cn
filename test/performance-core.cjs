const assert = require('node:assert/strict');
const A = require('./core.cjs');
const make = (rows, groups = [], memberships = {}) => new A.Draft('读取索引检查', {
  prompts: rows.map(([identifier, name, content]) => ({ identifier, name, content })),
  prompt_order: [{ character_id: 100001, order: rows.map(([identifier]) => ({ identifier, enabled: true })) }],
  extensions: { baibaiToolkit: { presetPromptGroups: { groups, prompts: memberships } } }
});
let passed = 0;
const test = (name, run) => { run(); passed++; console.log('✓', name); };

test('只读索引保持首个重复编号、分组过滤和缺失条目的原有语义', () => {
  const d = make([['a', '首个', '正文'], ['a', '重复', '另一个正文']], [{ id: 'g', enabled: false }, { id: 'g', enabled: true }], { a: { groupId: 'g' } });
  d.order[1].enabled = false;
  const check = () => {
    assert.equal(d.prompt('a').name, '首个'); assert.equal(d.prompt('missing'), undefined);
    assert.equal(d.group('g').enabled, false); assert.equal(d.group('missing'), null);
    assert.equal(d.isActive('a'), false); assert.equal(d.isActive('missing'), false);
    d.groupGate = false; assert.equal(d.isActive('a'), true); delete d.groupGate;
  };
  check(); d.withReadIndex(check); assert.equal(d._readIndex, undefined);
});

test('嵌套读取共用索引，异常退出也清理，不留跨操作缓存', () => {
  const d = make([['a', '甲', '正文']]);
  assert.throws(() => d.withReadIndex(() => {
    const index = d._readIndex;
    assert.equal(d.withReadIndex(() => { assert.equal(d._readIndex, index); return 7; }), 7);
    assert.equal(d._readIndex, index); throw new Error('中止');
  }), /中止/);
  assert.equal(d._readIndex, undefined);
  d.withReadIndex(() => assert.equal(d.prompt('a').name, '甲'));
});

test('直接替换正文对象、顺序数组和分组数组后，下次读取使用最新数据', () => {
  const d = make([['a', '甲', '正文']]);
  d.withReadIndex(() => assert.equal(d.isActive('a'), true));
  d.preset.prompts = [{ identifier: 'b', name: '乙', content: '新的正文' }];
  d.preset.prompt_order[0].order = [{ identifier: 'b', enabled: false }];
  d.groups.groups = [{ id: 'new', enabled: true }]; d.groups.prompts = { b: { groupId: 'new' } };
  d.withReadIndex(() => {
    assert.equal(d.prompt('a'), undefined); assert.equal(d.prompt('b').name, '乙');
    assert.equal(d.order[0].identifier, 'b'); assert.equal(d.isActive('b'), false);
    assert.equal(d.group('new').enabled, true);
  });
  d.order[0].enabled = true; d.groups.groups[0].enabled = false;
  d.withReadIndex(() => assert.equal(d.isActive('b'), false));
  d.groupGate = false; d.withReadIndex(() => assert.equal(d.isActive('b'), true));
});

test('思维链分析在正文编辑、顺序变化、开关变化和整份替换后重新识别', () => {
  const d = make([['a', '开头', '<thinking>'], ['b', '中间', '检查本次场景。'], ['c', '结尾', '</thinking>']]);
  assert(A.analyze(d).cotIds.includes('b'));
  d.prompt('a').content = '普通开头'; assert(!A.analyze(d).cotIds.includes('b'));
  d.prompt('a').content = '<thinking>'; assert(A.analyze(d).cotIds.includes('b'));
  d.order.reverse(); assert(!A.analyze(d).cotIds.includes('b'));
  d.order.reverse(); d.order[0].enabled = false; assert(!A.analyze(d).cotIds.includes('b'));
  d.order[0].enabled = true; assert(A.profilePreset(d).a.cotIds.includes('b'));
  d.replaceWith(make([['other', '普通条目', '正文']]).toPreset());
  assert.deepEqual(A.analyze(d).cotIds, []); assert.equal(d.prompt('a'), undefined);
});

test('手动思维链指定和分组开关直接编辑后立即生效，局部全局变量仍独立', () => {
  const d = make([
    ['local', '局部规则', '{{setvar::同名::局部内容}}'],
    ['global', '全局规则', '{{setglobalvar::同名::全局内容}}'],
    ['reader', '最后检查', '{{getvar::同名}}\n{{getglobalvar::同名}}']
  ], [{ id: 'g', enabled: true }], { reader: { groupId: 'g' } });
  assert.deepEqual(A.analyze(d).cotIds, []);
  d.cotManual = { reader: true };
  let a = A.analyze(d);
  assert.deepEqual(a.cotIds, ['reader']); assert.deepEqual(a.vars.get('同名').writers, ['local']);
  assert.deepEqual(a.vars.get('全局:同名').writers, ['global']);
  assert.equal(a.coverage.get('local').level, 'var'); assert.equal(a.coverage.get('global').level, 'var');
  d.group('g').enabled = false; assert.deepEqual(A.profilePreset(d).a.cotIds, []);
  d.groupGate = false; assert.deepEqual(A.profilePreset(d).a.cotIds, ['reader']);
  d.cotManual.reader = false; assert.deepEqual(A.analyze(d).cotIds, []);
});

test('分析和画像不改预设、历史和待保存状态，之后快照与撤销仍正常', () => {
  const d = make([['a', '规则', '正文'], ['cot', '思维链', '<thinking>检查正文。</thinking>']]);
  const before = JSON.stringify(d.toPreset());
  A.profilePreset(d); A.analyze(d);
  assert.equal(JSON.stringify(d.toPreset()), before); assert.equal(d.history.length, 0);
  assert.equal(d.dirty, false); assert.equal(d._readIndex, undefined);
  d.snapshot('修改正文'); d.prompt('a').content = '新正文'; A.profilePreset(d); d.undo();
  assert.equal(d.prompt('a').content, '正文'); assert.equal(d._readIndex, undefined);
});

test('大预设分析按批检查思维链区段，避免逐条全量重扫', () => {
  const n = 400;
  const d = make([...Array.from({ length: n }, (_, i) => ['p' + i, '规则' + i, '普通正文内容。']), ['cot', '思维链', '<thinking>检查场景。</thinking>']]);
  const prompt = d.prompt.bind(d);
  let calls = 0; d.prompt = id => { calls++; return prompt(id); };
  for (const analyze of [A.analyze, A.profilePreset]) {
    calls = 0; analyze(d);
    assert(calls < n * 40, `批次不应逐条扫描全预设：${calls} 次查询`);
    assert.equal(d._readIndex, undefined);
  }
});

console.log(`${passed} 项读取索引及分析性能检查通过`);
