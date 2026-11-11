// 性能回归依靠工作量与结果一致性验收；耗时只报告，不作为容易受机器负载影响的门槛。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const fixture = require('./fixtures/performance.cjs');
const root = path.resolve(__dirname, '..');
const files = ['ui/dom.js', 'core/model.js', 'core/macros.js', 'core/cot.js', 'ui/list.js'];
function load(ref = null) {
  const source = files.map(file => ref
    ? execFileSync('git', ['show', `${ref}:src/${file}`], { cwd: root, encoding: 'utf8' })
    : fs.readFileSync(path.join(root, 'src', file), 'utf8')).join('\n');
  return new Function(`${source}\n
    const measuredRegion = cotRegion, measuredShape = detectShape;
    const metrics = { regions: 0, shapes: 0, promptFinds: 0, promptFindSteps: 0 };
    cotRegion = function(...args) { metrics.regions++; return measuredRegion(...args); };
    detectShape = function(...args) { metrics.shapes++; return measuredShape(...args); };
    return { Draft, renderList, metrics };
  `)();
}
function measure(core, preset, options) {
  const d = new core.Draft('1200条公开合成预设', preset);
  const m = core.metrics;
  for (const key of Object.keys(m)) m[key] = 0;
  // 只统计旧版线性查询实际扫描的元素数，索引构建的线性遍历不会被误计。
  Object.defineProperty(d.preset.prompts, 'find', { configurable: true, value(fn, self) {
    m.promptFinds++;
    return Array.prototype.find.call(this, (p, i, arr) => { m.promptFindSteps++; return fn.call(self, p, i, arr); });
  } });
  const start = performance.now();
  const html = core.renderList(d, options);
  const ms = Number((performance.now() - start).toFixed(2));
  const ids = [...html.matchAll(/class="pa-row[^\"]*" data-id="([^\"]+)"/g)].map(x => x[1]);
  return { d, html, ids, ms, ...m };
}
const p = fixture(), folded = new Set(p.extensions.baibaiToolkit.presetPromptGroups.groups.map(g => g.id));
// PERF_BASE_REF=c7521e3 可报告旧版对比；默认回归不依赖浅克隆中可能不存在的历史提交。
const current = load(), baseline = process.env.PERF_BASE_REF ? load(process.env.PERF_BASE_REF) : null;
const results = {};
for (const [name, collapsed] of [['expanded', new Set()], ['collapsed', folded]]) {
  const options = { mode: 'organize', collapsed };
  const before = baseline ? measure(baseline, p, options) : null, after = measure(current, p, options);
  results[name] = { ...(before ? { before: { ms: before.ms, regions: before.regions, promptFindSteps: before.promptFindSteps, rows: before.ids.length } } : {}), after: { ms: after.ms, regions: after.regions, promptFindSteps: after.promptFindSteps, rows: after.ids.length } };
  assert.ok(after.regions <= 2, `${name}: 一次列表渲染只准备一次完整思维链区段`);
  assert.equal(after.promptFindSteps, 0, `${name}: 批次只读索引避免每行线性查找提示词`);
  assert.equal(after.ids.length, name === 'expanded' ? 1200 : 0);
  if (name === 'expanded') assert.deepEqual(after.ids, before ? before.ids : p.prompts.map(x => x.identifier), '展开列表保持所有条目原顺序');
  assert.equal((after.html.match(/class="pa-group/g) || []).length, 12);
  assert.ok(JSON.stringify(after.d.toPreset()) === JSON.stringify(p), '列表浏览不得改变任何预设数据');
}
const search = measure(current, p, { mode: 'organize', collapsed: folded, query: '性能条目 01199' });
assert.deepEqual(search.ids, ['perf-1199'], '搜索会展开折叠组中的匹配条目');
assert.match(search.html, /pa-chip-cot/, '批次预备区段后仍显示正确的思维链徽标');
const bodyHidden = measure(current, p, { mode: 'organize', collapsed: folded, query: 'body-only-needle' });
assert.deepEqual(bodyHidden.ids, []);
assert.match(bodyHidden.html, /正文里还有 1 条/);
const bodyShown = measure(current, p, { mode: 'organize', collapsed: folded, query: 'body-only-needle', searchBody: true });
assert.deepEqual(bodyShown.ids, ['perf-37']);
assert.match(bodyShown.html, /pa-hitline/);
const selected = new Set(p.prompts.slice(0, 100).map(x => x.identifier));
const groupSelected = measure(current, p, { mode: 'organize', collapsed: folded, selected });
assert.match(groupSelected.html, /pa-gsel/);
assert.deepEqual(groupSelected.ids, [], '整组选中不要求先生成折叠组的所有行');
const d = search.d;
d.prompt('perf-1199').name = '已修改的名称';
d.prompt('perf-1199').content = '正文已编辑';
const changed = current.renderList(d, { mode: 'organize', collapsed: folded, query: '已修改的名称' });
assert.match(changed, /已修改的名称/);
assert.doesNotMatch(changed, /pa-chip-cot/, '后续正文/名称直接编辑不会被批次索引缓存遮住');
assert.equal(d._readIndex, undefined, '临时只读索引不可持久化到草稿');
console.log(JSON.stringify({ syntheticEntries: p.prompts.length, baseline: process.env.PERF_BASE_REF || null, results }, null, 2));
console.log('✓ 大预设：线性查询及区段扫描工作量、折叠DOM、搜索、选择和只读数据安全均通过');
