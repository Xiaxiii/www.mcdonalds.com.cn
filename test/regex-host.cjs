// Native preset-regex permission uses preset_allowed_regex.openai: string[]
// (SillyTavern 1.19.0, scripts/extensions/regex/engine.js). The provider may
// still be Claude: the preset manager and PRESET_CHANGED apiId are openai.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const hostSource = fs.readFileSync(path.join(__dirname, '../src/host.js'), 'utf8');
const Draft = new Function(fs.readFileSync(path.join(__dirname, '../src/core/model.js'), 'utf8') + '\nreturn Draft;')();
const copy = structuredClone;
const rule = (id, extra = {}) => ({
  id, scriptName: `状态栏 ${id}`, findRegex: '/<status>([\\s\\S]*?)<\\/status>/g',
  replaceString: '<section class="status">$1</section>', placement: [2],
  trimStrings: ['<status>'], disabled: false, markdownOnly: true,
  promptOnly: false, runOnEdit: true, substituteRegex: 2,
  minDepth: 0, maxDepth: 12, futureOption: { preserved: ['x', 3] }, ...extra
});
const preset = () => ({
  temperature: 0.73, top_p: 0.91,
  prompts: [{ identifier: 'main', name: '主提示词', role: 'system', content: '保持正文', enabled: true }],
  prompt_order: [
    { character_id: 100001, order: [{ identifier: 'main', enabled: true }] },
    { character_id: 42, order: [{ identifier: 'main', enabled: false }] }
  ],
  extensions: {
    regex_scripts: [rule('original')],
    statusbarPlugin: { template: '<div>{{value}}</div>', settings: [1, 2] },
    unrelated: { enabled: true }
  }
});

function setup(options = {}) {
  const stored = preset(), other = preset(), live = copy(stored);
  live.preset_settings_openai = 'active';
  live.chat_completion_source = 'claude';
  const presets = [stored, other];
  const extensionSettings = {
    preset_allowed_regex: { openai: options.allowed === false ? ['other'] : ['active', 'other'], textgenerationwebui: ['text-preset'] },
    disabledExtensions: options.disabled ? ['regex'] : [],
    regex: [rule('global')],
    unrelatedPlugin: { keep: true }
  };
  const beforeSettings = copy(extensionSettings);
  const events = [], toasts = [], warnings = [], backups = [], saves = [], timeline = [];
  const server = new Map([['active', copy(stored)], ['other', copy(other)]]);
  const control = { failBackup: false, failSave: false, failRefresh: false };
  const manager = {
    getPresetList: () => ({ presets, preset_names: { active: 0, other: 1 } }),
    getSelectedPresetName: () => 'active',
    async savePreset(name, data, flags) {
      timeline.push('save');
      saves.push({ name, data: copy(data), flags: copy(flags) });
      if (control.failSave) throw new Error('server save rejected');
      server.set(name, copy(data));
    }
  };
  const context = {
    getPresetManager(apiId) { assert.equal(apiId, 'openai'); return manager; },
    extensionSettings,
    eventTypes: { OAI_PRESET_CHANGED_AFTER: 'oai-after', PRESET_CHANGED: 'preset-changed' },
    saveSettingsDebounced() { timeline.push('save-settings'); },
    eventSource: {
      async emit(type, payload) {
        timeline.push(type);
        events.push({ type, payload: copy(payload), live: copy(live), stored: copy(stored) });
        if (type === 'preset-changed' && control.failRefresh) throw new Error('native listener failed');
      }
    }
  };
  const globals = { SillyTavern: { getContext: () => context } };
  const host = new Function('globalThis', 'toast', 'backupMock', 'structuredClone', 'console', 'forgetSize', hostSource + '\nbackupPut = backupMock;\nreturn {writePreset, presetRegexActivationInfo, readPreset, mods};')(
    globals,
    (message, kind) => toasts.push({ message, kind }),
    async (name, data, reason) => {
      timeline.push('backup');
      backups.push({ name, data: copy(data), reason });
      if (control.failBackup) throw new Error('backup storage full');
    },
    copy,
    { warn: (...args) => warnings.push(args) },
    () => {}
  );
  host.mods.openai = {
    oai_settings: live,
    getChatCompletionPreset: settings => copy(settings)
  };
  return { host, stored, other, live, presets, context, extensionSettings, beforeSettings, events, toasts, warnings, backups, saves, timeline, server, control };
}

const refreshes = state => state.events.filter(event => event.type === 'preset-changed');

(async () => {
  let passed = 0;
  const test = async (name, run) => { await run(); passed++; console.log('✓', name); };

  await test('预设正则许可按 openai 名称数组判断，Claude 模型不改变预设 apiId', () => {
    const s = setup();
    assert.equal(s.live.chat_completion_source, 'claude');
    assert.deepEqual(s.host.presetRegexActivationInfo('active'), { allowed: true, extensionDisabled: false, current: true });
    assert.deepEqual(s.host.presetRegexActivationInfo('other'), { allowed: true, extensionDisabled: false, current: false });
    assert.deepEqual(s.host.presetRegexActivationInfo('absent'), { allowed: false, extensionDisabled: false, current: false });
    s.extensionSettings.preset_allowed_regex.openai = { active: true };
    assert.equal(s.host.presetRegexActivationInfo('active').allowed, false, '不把其他版本或损坏格式当作原生许可');
    delete s.extensionSettings.preset_allowed_regex;
    assert.equal(s.host.presetRegexActivationInfo('active').allowed, false);
  });

  await test('当前且已获许可：先保存并同步数据，再发原生 PRESET_CHANGED', async () => {
    const s = setup(), before = copy(s.stored), next = copy(s.stored);
    next.extensions.regex_scripts.push(rule('new', { disabled: true, promptOnly: true, markdownOnly: false }));
    const liveExtensionsReference = s.live.extensions, storedReference = s.stored;
    await s.host.writePreset('active', next, '缝合预设正则');
    assert.equal(s.backups.length, 1);
    assert.deepEqual(s.backups[0], { name: 'active', data: before, reason: '缝合预设正则' });
    assert.deepEqual(s.saves[0].flags, { skipUpdate: true });
    assert.deepEqual(s.timeline, ['backup', 'save', 'save-settings', 'oai-after', 'preset-changed']);
    assert.equal(s.live.extensions, liveExtensionsReference, '保留宿主正拿着的 extensions 对象引用');
    assert.equal(s.presets[0], storedReference, '保留预设列表对象引用');
    assert.deepEqual(s.stored, next);
    assert.deepEqual(s.server.get('active'), next);
    assert.deepEqual(s.live.extensions, next.extensions);
    assert.deepEqual(s.live.prompts, before.prompts);
    assert.deepEqual(s.live.prompt_order, before.prompt_order);
    assert.equal(s.live.temperature, before.temperature);
    assert.deepEqual(s.extensionSettings, s.beforeSettings, '不改全局正则、原生许可或其他插件设置');
    assert.deepEqual(s.other, before, '不改其他预设');
    const [event] = refreshes(s);
    assert.deepEqual(event.payload, { apiId: 'openai', name: 'active' });
    assert.deepEqual(event.live.extensions.regex_scripts, next.extensions.regex_scripts);
    assert.deepEqual(event.stored.extensions.regex_scripts, next.extensions.regex_scripts);
    assert.equal(s.toasts.length, 0);
  });

  await test('普通提示词修改不制造正则刷新事件，原有正则字段全部保留', async () => {
    const s = setup(), next = copy(s.stored);
    next.prompts[0].content = '只改提示词';
    await s.host.writePreset('active', next, '编辑条目');
    assert.equal(refreshes(s).length, 0);
    assert.deepEqual(s.events.map(event => event.type), ['oai-after']);
    assert.deepEqual(s.stored.extensions, next.extensions);
    assert.deepEqual(s.extensionSettings, s.beforeSettings);
  });

  await test('未许可或全局禁用时仍保存规则，保留原生 opt-in，不弹首次信任确认', async () => {
    for (const options of [{ allowed: false }, { disabled: true }, { allowed: false, disabled: true }]) {
      const s = setup(options), next = copy(s.stored);
      next.extensions.regex_scripts.push(rule('new'));
      await s.host.writePreset('active', next, '缝合预设正则');
      assert.equal(refreshes(s).length, 0);
      assert.deepEqual(s.server.get('active').extensions.regex_scripts, next.extensions.regex_scripts);
      assert.deepEqual(s.live.extensions.regex_scripts, next.extensions.regex_scripts);
      assert.deepEqual(s.extensionSettings, s.beforeSettings);
      assert.equal(s.toasts.length, 0);
    }
  });

  await test('保存非当前预设只更新该预设，不触发当前预设正则或改变当前实时设置', async () => {
    const s = setup(), beforeLive = copy(s.live), beforeActive = copy(s.stored), next = copy(s.other);
    next.extensions.regex_scripts.push(rule('other-new'));
    await s.host.writePreset('other', next, '缝合预设正则');
    assert.deepEqual(s.events, []);
    assert.deepEqual(s.live, beforeLive);
    assert.deepEqual(s.stored, beforeActive);
    assert.deepEqual(s.other, next);
    assert.deepEqual(s.server.get('other'), next);
    assert.deepEqual(s.extensionSettings, s.beforeSettings);
  });

  await test('当前正则变化比较实时数据，避免缓存列表导致漏报或无意义刷新', async () => {
    const s = setup(), next = copy(s.stored);
    next.extensions.regex_scripts.push(rule('live-only'));
    s.live.extensions.regex_scripts = copy(next.extensions.regex_scripts);
    await s.host.writePreset('active', next, '同步已有实时正则');
    assert.equal(refreshes(s).length, 0, '实时数据已经相同，不因陈旧列表触发刷新');
    s.live.extensions.regex_scripts = [rule('original')];
    await s.host.writePreset('active', next, '恢复实时正则');
    assert.equal(refreshes(s).length, 1, '列表相同但实时数据改变时仍刷新');
  });

  await test('原生正则面板监听失败不撤销成功保存，给出可执行刷新提示', async () => {
    const s = setup(), next = copy(s.stored);
    s.control.failRefresh = true;
    next.extensions.regex_scripts.push(rule('new'));
    await s.host.writePreset('active', next, '缝合预设正则');
    assert.deepEqual(s.server.get('active'), next);
    assert.deepEqual(s.stored, next);
    assert.deepEqual(s.live.extensions, next.extensions);
    assert.equal(refreshes(s).length, 1);
    assert.equal(s.toasts.length, 1);
    assert.equal(s.toasts[0].kind, 'warning');
    assert.match(s.toasts[0].message, /正则已保存.*重新选择预设/);
    assert.equal(s.warnings.length, 1);
    assert.deepEqual(s.extensionSettings, s.beforeSettings);
  });

  await test('服务器保存失败保留旧列表和实时正则，不发刷新或设置保存事件', async () => {
    const s = setup(), beforeStored = copy(s.stored), beforeLive = copy(s.live), next = copy(s.stored);
    s.control.failSave = true;
    next.extensions.regex_scripts.push(rule('new'));
    await assert.rejects(s.host.writePreset('active', next, '缝合预设正则'), /server save rejected/);
    assert.deepEqual(s.stored, beforeStored);
    assert.deepEqual(s.live, beforeLive);
    assert.deepEqual(s.server.get('active'), beforeStored);
    assert.deepEqual(s.events, []);
    assert.deepEqual(s.timeline, ['backup', 'save']);
    assert.equal(s.backups.length, 1);
    assert.equal(s.toasts.length, 0);
  });

  await test('备份失败立即停止，不调用服务器保存或更改实时数据', async () => {
    const s = setup(), beforeStored = copy(s.stored), beforeLive = copy(s.live), next = copy(s.stored);
    s.control.failBackup = true;
    next.extensions.regex_scripts.push(rule('new'));
    await assert.rejects(s.host.writePreset('active', next, '缝合预设正则'), error => error.kind === 'backup' && /backup storage full/.test(error.message));
    assert.equal(s.saves.length, 0);
    assert.deepEqual(s.timeline, ['backup']);
    assert.deepEqual(s.stored, beforeStored);
    assert.deepEqual(s.live, beforeLive);
    assert.deepEqual(s.events, []);
    assert.equal(s.warnings.length, 1);
  });

  await test('Draft 撤销后沿相同宿主路径恢复正则和其他字段，并刷新已许可的当前预设', async () => {
    const s = setup(), original = copy(s.stored), draft = new Draft('active', original);
    draft.snapshot('缝合预设正则');
    draft.preset.extensions.regex_scripts.push(rule('new', { disabled: true }));
    await s.host.writePreset('active', draft.toPreset(), '缝合预设正则');
    assert.equal(s.stored.extensions.regex_scripts.length, 2);
    assert.equal(draft.undo(), '缝合预设正则');
    await s.host.writePreset('active', draft.toPreset(), '撤销：缝合预设正则');
    assert.deepEqual(s.stored, original);
    assert.deepEqual(s.server.get('active'), original);
    assert.deepEqual(s.live.extensions, original.extensions);
    assert.deepEqual(s.live.prompts, original.prompts);
    assert.deepEqual(s.live.prompt_order, original.prompt_order);
    assert.equal(refreshes(s).length, 2);
    assert.equal(s.backups.length, 2);
    assert.equal(s.backups[1].data.extensions.regex_scripts.length, 2, '撤销前备份保存的是缝合后版本');
    assert.deepEqual(s.extensionSettings, s.beforeSettings);
  });

  console.log(`${passed} 项预设正则宿主检查通过`);
})().catch(error => { console.error(error); process.exitCode = 1; });
