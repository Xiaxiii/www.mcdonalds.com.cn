// 合并新版的核心逻辑：node test/merge-core.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const code = ['core/model.js', 'core/regex.js', 'core/merge.js'].map((f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8')).join('\n');
const A = new Function(code + '\nreturn { Draft, mergePlan, mergeItems, mergeChoose, mergeMove, mergeStats, mergeTouches, mergeGroupMap, mergeGroupInfo, mergeSyncOrder, mergeItemDiff, mergeLineDiff, applyMerge, mergedPreset };')();
const p = (identifier, name, content, extra = {}) => ({ identifier, name, content, role: 'system', ...extra });
const rule = (id, scriptName, findRegex, extra = {}) => ({ id, scriptName, findRegex, replaceString: '<b>$1</b>', trimStrings: [], placement: [2], disabled: false, markdownOnly: true, promptOnly: false, runOnEdit: true, substituteRegex: 0, minDepth: null, maxDepth: null, ...extra });
const preset = (prompts, { off = [], groups, members, entryGrouping, regex, helper, extra } = {}) => ({
  temperature: 1,
  prompts,
  prompt_order: [{ character_id: 100001, order: prompts.map((x) => ({ identifier: x.identifier, enabled: !off.includes(x.identifier) })) }],
  extensions: {
    ...(groups ? { baibaiToolkit: { presetPromptGroups: { version: 1, groups, prompts: Object.fromEntries(Object.entries(members).map(([k, v]) => [k, { groupId: v }])) } } } : {}),
    ...(entryGrouping ? { entryGrouping } : {}), ...(regex ? { regex_scripts: regex } : {}), ...(helper ? { tavern_helper: helper } : {}), ...(extra || {})
  }
});
const long = (tag, n = 6) => Array.from({ length: n }, (_, i) => `${tag} 第 ${i + 1} 行`).join('\n');
const ids = (d) => d.order.map((o) => o.identifier);
const item = (plan, tab, name) => A.mergeItems(plan, tab).find((it) => it.name === name || it.name.startsWith(name + ' →'));
let passed = 0;
const test = (name, run) => { run(); passed++; console.log('✓', name); };

const baseRaw = () => preset([
  p('main', '主提示', ''), p('a1', '文风·白描', long('白描')), p('a2', '文风·我自己写的', long('自写')), p('a3', '规则', long('规则')), p('a4', '旧名字', long('改名内容')), p('tail', '结尾', '结尾')
], { off: ['a2'], groups: [{ id: 'g1', name: '文风' }, { id: 'g2', name: '规则组' }], members: { a1: 'g1', a2: 'g1', a3: 'g2' } });
const nextRaw = () => preset([
  p('main', '主提示', ''), p('b1', '文风·白描', long('白描') + '\n新增一行'), p('b5', '文风·哥特', long('哥特')), p('b3', '规则', long('规则')), p('b6', '新分组条目', long('新组')), p('b4', '新名字', long('改名内容')), p('tail', '结尾', '结尾')
], { off: ['b5'], groups: [{ id: 'h1', name: '文风' }, { id: 'h2', name: '规则组' }, { id: 'h3', name: '新增的组' }], members: { b1: 'h1', b5: 'h1', b3: 'h2', b6: 'h3' } });
const pair = () => [new A.Draft('旧版', baseRaw()), new A.Draft('新版', nextRaw())];

test('比对：同名配对、内容相似的改名配对、新增、旧版独有', () => {
  const [base, next] = pair();
  const before = [JSON.stringify(base), JSON.stringify(next)];
  const plan = A.mergePlan(base, next);
  const types = Object.fromEntries(plan.prompts.map((it) => [it.name, it.type]));
  assert.deepEqual(types, { '主提示': 'same', '文风·白描': 'changed', '文风·我自己写的': 'removed', '规则': 'same', '旧名字 → 新名字': 'changed', '结尾': 'same', '文风·哥特': 'added', '新分组条目': 'added' });
  assert.equal(item(plan, 'prompts', '旧名字').renamed, true);
  assert.deepEqual(A.mergeStats(plan, 'prompts'), { all: 8, same: 3, changed: 2, added: 2, removed: 1, useNew: 0, addIn: 2, dropOut: 0 });
  assert.deepEqual([JSON.stringify(base), JSON.stringify(next)], before, '比对不改两份草稿');
});
test('默认选择：新增条目按新版位置进组，开关照新版；旧版的改动和独有条目都保留', () => {
  const [base, next] = pair();
  const plan = A.mergePlan(base, next);
  A.applyMerge(plan);
  assert.deepEqual(ids(base), ['main', 'a1', 'b5', 'a2', 'a3', 'b6', 'a4', 'tail']);
  assert.equal(base.groupOf('b5'), 'g1');
  assert.equal(base.order.find((o) => o.identifier === 'b5').enabled, false);
  assert.equal(base.prompt('a1').content, long('白描'));
  assert.equal(base.group(base.groupOf('b6')).name, '新增的组');
  const out = base.toPreset().extensions.baibaiToolkit.presetPromptGroups;
  assert.deepEqual(out.groups.map((g) => g.name), ['文风', '规则组', '新增的组']);
});
test('采用新版：正文和名字换成新版，编号和开关不变；删除旧版独有条目', () => {
  const [base, next] = pair();
  const plan = A.mergePlan(base, next);
  A.mergeChoose(plan, 'prompts', 'a1', 'new');
  A.mergeChoose(plan, 'prompts', 'a4', 'new');
  A.mergeChoose(plan, 'prompts', 'a2', 'skip');
  A.mergeChoose(plan, 'prompts', item(plan, 'prompts', '文风·哥特').key, 'skip');
  const stats = A.applyMerge(plan);
  assert.equal(stats.prompts.useNew, 2); assert.equal(stats.prompts.dropOut, 1); assert.equal(stats.prompts.addIn, 1);
  assert.equal(base.prompt('a1').content, long('白描') + '\n新增一行');
  assert.equal(base.prompt('a4').name, '新名字');
  assert.ok(!base.prompt('a2') && !base.prompt('b5'));
  assert.ok(!ids(base).includes('a2'));
});
test('采用新版的条目：新版里没有可参照的邻居时留在原位，新增条目仍排在它后面', () => {
  const [base, next] = pair();
  const plan = A.mergePlan(base, next);
  A.mergeChoose(plan, 'prompts', 'a1', 'new');
  assert.deepEqual(A.mergeSyncOrder(plan, 'prompts'), ['main', 'a1', 'b5', 'a2', 'a3', 'b6', 'a4', 'tail']);
  A.mergeChoose(plan, 'prompts', 'a1', 'keep');
  assert.deepEqual(A.mergeSyncOrder(plan, 'prompts'), ['main', 'a1', 'b5', 'a2', 'a3', 'b6', 'a4', 'tail']);
});
test('全部保留旧版、忽略新增：不改动基底', () => {
  const [base, next] = pair();
  const plan = A.mergePlan(base, next);
  for (const it of plan.prompts) if (it.type === 'added') A.mergeChoose(plan, 'prompts', it.key, 'skip');
  assert.equal(A.mergeTouches(plan), false);
  const before = JSON.stringify(base.toPreset());
  A.applyMerge(plan);
  assert.equal(JSON.stringify(base.toPreset()), before);
});
test('新增条目的编号和基底已有条目相同：换新编号，不覆盖旧条目', () => {
  const base = new A.Draft('旧版', preset([p('x', '甲', long('甲')), p('y', '乙', long('乙'))]));
  const next = new A.Draft('新版', preset([p('k', '甲', long('甲')), p('x', '丙', long('丙'))]));
  const plan = A.mergePlan(base, next);
  const added = item(plan, 'prompts', '丙');
  assert.equal(added.type, 'added'); assert.notEqual(added.key, 'x');
  A.applyMerge(plan);
  assert.equal(base.prompt('x').name, '甲');
  assert.equal(base.prompt(added.key).name, '丙');
  assert.deepEqual(ids(base), ['x', added.key, 'y']);
});
test('拖动：换位置并改分组；导出不改基底，结果与并入一致', () => {
  const [base, next] = pair();
  const plan = A.mergePlan(base, next);
  assert.ok(A.mergeMove(plan, 'prompts', 'tail', 'a3', true, 'g2'));
  assert.equal(A.mergeGroupMap(plan).tail, 'g2');
  assert.equal(A.mergeTouches(plan), true);
  const before = JSON.stringify(base);
  const out = A.mergedPreset(plan);
  assert.equal(JSON.stringify(base), before);
  assert.deepEqual(out.prompt_order[0].order.map((o) => o.identifier), ['main', 'a1', 'b5', 'a2', 'a3', 'tail', 'b6', 'a4']);
  assert.equal(out.extensions.baibaiToolkit.presetPromptGroups.prompts.tail.groupId, 'g2');
  A.applyMerge(plan);
  assert.equal(JSON.stringify(base.toPreset()), JSON.stringify(out));
});
test('分组改名：按成员重合认出同一组，名字跟新版', () => {
  const base = new A.Draft('旧版', preset([p('a', '甲', long('甲')), p('b', '乙', long('乙'))], { groups: [{ id: 'g', name: '老组名' }], members: { a: 'g', b: 'g' } }));
  const next = new A.Draft('新版', preset([p('a', '甲', long('甲')), p('b', '乙', long('乙')), p('c', '丙', long('丙'))], { groups: [{ id: 'h', name: '新组名' }], members: { a: 'h', b: 'h', c: 'h' } }));
  const plan = A.mergePlan(base, next);
  assert.equal(A.mergeGroupInfo(plan).get('g').newName, '新组名');
  A.applyMerge(plan);
  assert.equal(base.group('g').name, '新组名');
  assert.equal(base.groupOf('c'), 'g');
});
test('只有 entryGrouping 的预设：合并后仍只写 entryGrouping', () => {
  const eg = (id, name, mem) => ({ id, name, enabled: true, mode: 'inclusive', memberIdentifiers: mem });
  const base = new A.Draft('旧版', preset([p('a', '甲', long('甲')), p('b', '乙', long('乙')), p('z', '尾', '尾')], { entryGrouping: [eg('g', '组', ['a', 'b'])] }));
  const next = new A.Draft('新版', preset([p('a', '甲', long('甲')), p('n', '新', long('新')), p('b', '乙', long('乙')), p('z', '尾', '尾')], { entryGrouping: [eg('q', '组', ['a', 'n', 'b'])] }));
  A.applyMerge(A.mergePlan(base, next));
  const out = base.toPreset();
  assert.ok(!out.extensions.baibaiToolkit);
  assert.deepEqual(out.extensions.entryGrouping.map((g) => [g.name, g.startIdentifier, g.endIdentifier]), [['组', 'a', 'b']]);
  assert.deepEqual(out.prompt_order[0].order.map((o) => o.identifier), ['a', 'n', 'b', 'z']);
});
test('正则：同编号改名算改动并保留旧编号；新增按新版位置插入；删除旧版独有', () => {
  const base = new A.Draft('旧版', preset([p('a', '甲', '甲')], { regex: [rule('r1', '状态栏', '/<a>(.*)<\\/a>/g'), rule('r2', '我加的', '/mine/g'), rule('r3', '尾巴', '/<t>/g')], extra: { baibaiToolkit: { regexGroups: { version: 1, groups: [{ id: 'rg', name: '组' }], scripts: { r2: { groupId: 'rg' } } } } } }));
  const next = new A.Draft('新版', preset([p('a', '甲', '甲')], { regex: [rule('r1', '状态栏 v2', '/<a>([\\s\\S]*?)<\\/a>/g'), rule('n1', '新美化', '/<n>/g'), rule('x3', '尾巴', '/<t>/g')] }));
  const plan = A.mergePlan(base, next);
  assert.deepEqual(plan.regex.map((it) => [it.name, it.type]), [['状态栏 → 状态栏 v2', 'changed'], ['我加的', 'removed'], ['尾巴', 'same'], ['新美化', 'added']]);
  A.mergeChoose(plan, 'regex', 'a:0', 'new');
  A.mergeChoose(plan, 'regex', 'a:1', 'skip');
  A.applyMerge(plan);
  const out = base.preset.extensions.regex_scripts;
  assert.deepEqual(out.map((r) => [r.id, r.scriptName]), [['r1', '状态栏 v2'], ['n1', '新美化'], ['r3', '尾巴']]);
  assert.equal(out[0].findRegex, '/<a>([\\s\\S]*?)<\\/a>/g');
  assert.deepEqual(base.preset.extensions.baibaiToolkit.regexGroups.scripts, {});
});
test('酒馆助手脚本：文件夹内按编号、名字、代码相似度配对；新文件夹照新版建；只补新变量', () => {
  const sc = (id, name, content) => ({ type: 'script', id, name, content, enabled: true });
  const base = new A.Draft('旧版', preset([p('a', '甲', '甲')], { helper: { scripts: [{ type: 'folder', name: '内置脚本', scripts: [sc('s1', '界面', long('界面')), sc('s2', '我的脚本', long('我的'))] }, sc('s9', '顶层', long('顶层'))], variables: { keep: 1 } } }));
  const next = new A.Draft('新版', preset([p('a', '甲', '甲')], { helper: { scripts: [{ type: 'folder', name: '内置脚本', scripts: [sc('s1', '界面', long('界面') + '\n新功能'), sc('s3', '新脚本', long('新'))] }, { type: 'folder', name: '工具', scripts: [sc('s4', '工具甲', long('工具'))] }, sc('s9', '顶层', long('顶层'))], variables: { keep: 2, fresh: 3 } } }));
  const plan = A.mergePlan(base, next);
  assert.deepEqual(plan.scripts.map((it) => [it.name, it.type]), [['界面', 'changed'], ['我的脚本', 'removed'], ['顶层', 'same'], ['新脚本', 'added'], ['工具甲', 'added']]);
  A.mergeChoose(plan, 'scripts', 'a:0:0', 'new');
  A.applyMerge(plan);
  const th = base.preset.extensions.tavern_helper;
  assert.deepEqual(th.scripts.map((x) => [x.name, x.scripts ? x.scripts.map((s) => s.name) : null]), [['内置脚本', ['界面', '我的脚本', '新脚本']], ['顶层', null], ['工具', ['工具甲']]]);
  assert.ok(th.scripts[0].scripts[0].content.endsWith('新功能'));
  assert.deepEqual(th.variables, { keep: 1, fresh: 3 });
});
test('逐行比对：只标出变化的行；超长内容不占用大量内存', () => {
  assert.deepEqual(A.mergeLineDiff('a\nb\nc', 'a\nx\nc'), [['ctx', 'a'], ['del', 'b'], ['add', 'x'], ['ctx', 'c']]);
  const big = (t) => Array.from({ length: 3000 }, (_, i) => `${t}${i}`).join('\n');
  const d = A.mergeLineDiff('头\n' + big('a') + '\n尾', '头\n' + big('b') + '\n尾');
  assert.equal(d.length, 6002); assert.equal(d[0][0], 'ctx'); assert.equal(d[6001][0], 'ctx');
});
test('基底在比对后变了：拒绝写入', () => {
  const [base, next] = pair();
  const plan = A.mergePlan(base, next);
  base.deletePrompts(['a3']);
  const before = JSON.stringify(base);
  assert.throws(() => A.applyMerge(plan), /已变化/);
  assert.equal(JSON.stringify(base), before);
});
console.log(`${passed} 项合并新版检查通过`);
