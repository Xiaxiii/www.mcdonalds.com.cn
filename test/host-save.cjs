const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const fixture = require('./fixtures/group-repair.cjs');
const code = fs.readFileSync(path.join(__dirname, '../src/host.js'), 'utf8');
function setup() {
  const old = fixture(), live = structuredClone(old), stored = structuredClone(old), events = [], toasts = [];
  live.preset_settings_openai = 'active';
  const state = { presetPromptGroupRuntimePresetName: 'active', presetPromptGroupRuntimeState: structuredClone(old.extensions.baibaiToolkit.presetPromptGroups), unrelated: 'keep' };
  const globals = { __baiBaiToolkitExtensionInstalled: state };
  const context = {
    getPresetManager: () => ({ getPresetList: () => ({ presets: [stored], preset_names: { active: 0 } }), getSelectedPresetName: () => 'active', savePreset: async () => {} }),
    extensionSettings: { baiBaiToolkit: {} }, saveSettingsDebounced() {},
    eventTypes: { OAI_PRESET_IMPORT_READY: 'import', OAI_PRESET_CHANGED_AFTER: 'after' },
    eventSource: { async emit(event) {
      events.push(event);
      if (event === 'import') toasts.push('[导入自动] 未找到可迁移的缝合源预设');
      if (event === 'after') {
        if (state.presetPromptGroupRuntimeState) {
          live.extensions.baibaiToolkit.presetPromptGroups = structuredClone(state.presetPromptGroupRuntimeState);
          stored.extensions.baibaiToolkit.presetPromptGroups = structuredClone(state.presetPromptGroupRuntimeState);
        } else {
          state.presetPromptGroupRuntimePresetName = live.preset_settings_openai;
          state.presetPromptGroupRuntimeState = structuredClone(live.extensions.baibaiToolkit.presetPromptGroups);
        }
      }
    } }
  };
  globals.SillyTavern = { getContext: () => context };
  const host = new Function('globalThis', 'toast', 'backupPut', 'structuredClone', 'forgetSize', code + '\nreturn {writePreset,refreshBaibaiGroupCache,mods};')(globals, () => {}, async () => {}, structuredClone, () => {});
  host.mods.openai = { oai_settings: live };
  return { host, context, globals, state, events, toasts, live, stored };
}
(async () => {
  let passed = 0;
  const test = async (name, run) => { await run(); passed++; console.log('✓', name); };
  await test('自动保存刷新柏宝箱缓存，新分组保留且不触发导入迁移提示', async () => {
    const s = setup(), next = fixture();
    next.extensions.baibaiToolkit.presetPromptGroups.groups.push({ id: 'new', name: '新组' });
    await s.host.writePreset('active', next, '分组', { backup: false });
    assert.deepEqual(s.events, ['after']); assert.deepEqual(s.toasts, []);
    for (const data of [s.live, s.stored]) assert(data.extensions.baibaiToolkit.presetPromptGroups.groups.some(g => g.id === 'new'));
    assert(s.state.presetPromptGroupRuntimeState.groups.some(g => g.id === 'new'));
    assert.equal(s.state.unrelated, 'keep');
    await s.host.writePreset('active', next, '再次保存', { backup: false });
    assert.deepEqual(s.toasts, []); assert.deepEqual(s.events, ['after', 'after']);
  });
  await test('只清当前预设的分组缓存，不碰其他预设或其他运行时字段', () => {
    const s = setup(), before = structuredClone(s.state);
    s.host.refreshBaibaiGroupCache('other'); assert.deepEqual(s.state, before);
    s.host.refreshBaibaiGroupCache('active');
    assert.deepEqual(s.state, { unrelated: 'keep' });
  });
  await test('没有柏宝箱或只有旧配置时，保存不制造导入事件', async () => {
    for (const runtime of [undefined, true, {}]) {
      const s = setup(); s.globals.__baiBaiToolkitExtensionInstalled = runtime;
      s.context.eventSource.emit = async event => s.events.push(event);
      await s.host.writePreset('active', fixture(), '普通保存', { backup: false });
      assert.deepEqual(s.events, ['after']);
    }
  });
  await test('真实导入监听仍正常工作，没有屏蔽或替换其他扩展的提示', async () => {
    const s = setup();
    await s.host.writePreset('active', fixture(), '普通保存', { backup: false });
    await s.context.eventSource.emit('import');
    assert.equal(s.toasts.length, 1); assert.match(s.toasts[0], /导入自动/);
  });
  console.log(`${passed} 项宿主保存检查通过`);
})().catch(error => { console.error(error); process.exitCode = 1; });
