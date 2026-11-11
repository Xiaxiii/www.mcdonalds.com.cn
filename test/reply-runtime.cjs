// 临时格式提醒的生成前检查与生命周期，不修改聊天和预设。
// 用法：node test/reply-runtime.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = ['../src/core/replycheck.js', '../src/maintenance/replyguard.js']
  .map((file) => fs.readFileSync(path.join(__dirname, file), 'utf8')).join('\n');
const KEY = 'mcdonalds:reply-format';
const EVENTS = Object.fromEntries(['GENERATION_AFTER_COMMANDS', 'CHAT_CHANGED', 'PRESET_CHANGED', 'GENERATION_STARTED', 'GENERATION_ENDED', 'GENERATION_STOPPED'].map((key) => [key, key.toLowerCase()]));
let passed = 0;
function test(name, run) {
  try { run(); passed++; console.log(`ok - ${name}`); }
  catch (error) { console.error(`not ok - ${name}`); throw error; }
}
function fixture() {
  const calls = [], prompts = {}, cleanups = [], warnings = [];
  const state = { replyGuard: {} };
  let selected = 'A';
  const context = {
    chat: [{ is_user: false, mes: '开场白无标签' }, { is_user: true, mes: '继续' }, { is_user: false, mes: '正文掉标签了', extra: { reasoning: '<think>原生推理字段</think>' } }],
    mainApi: 'openai', eventTypes: { ...EVENTS },
    setExtensionPrompt(...args) { calls.push(args); prompts[args[0]] = args[1]; }
  };
  const functions = new Function('ctx', 'settings', 'currentPresetName', 'cleanups', 'console', source + '\nreturn { replyGuardConfig, replyGuardAvailable, latestReplyForCheck, clearReplyGuard, prepareReplyGuard, bindReplyGuard };')(
    () => context, () => state, () => selected, cleanups, { warn: (...args) => warnings.push(args) }
  );
  const hooks = new Map();
  functions.bindReplyGuard((event, fn) => {
    if (event) hooks.set(event, [...(hooks.get(event) || []), fn]);
  }, context.eventTypes);
  return {
    ...functions, context, state, calls, prompts, cleanups, warnings,
    select(name) { selected = name; },
    enable(name = selected, config = {}) { state.replyGuard[name] = { enabled: true, ...config }; },
    emit(event, ...args) { for (const fn of hooks.get(event) || []) fn(...args); },
    generate(type = 'normal', dryRun = false) { this.emit(EVENTS.GENERATION_AFTER_COMMANDS, type, {}, dryRun); },
    prompt() { return prompts[KEY] || ''; }
  };
}
test('disabled by default and no automatic saved config', () => {
  const f = fixture();
  f.generate();
  assert.equal(f.prompt(), '');
  assert.deepEqual(f.state.replyGuard, {});
});
test('bad reply injects a temporary system prompt at depth zero', () => {
  const f = fixture(); f.enable();
  const chat = structuredClone(f.context.chat), settings = structuredClone(f.state);
  f.generate();
  assert.match(f.prompt(), /<content>…<\/content>/);
  assert.match(f.prompt(), /剧情照常接着写/);
  assert.deepEqual(f.calls.at(-1), [KEY, f.prompt(), 1, 0, false, 0]);
  assert.deepEqual(f.context.chat, chat);
  assert.deepEqual(f.state, settings);
});
test('checks only AI messages after a user turn and ignores greetings and system messages', () => {
  const f = fixture(); f.enable();
  for (const chat of [[], [{ is_user: false, mes: '开场白' }], [{ is_user: true, mes: '用户输入' }], [{ is_user: true, mes: '你好' }, { is_user: false, is_system: true, mes: '系统消息' }]]) {
    f.context.chat = chat; f.generate(); assert.equal(f.prompt(), '');
    assert.equal(f.latestReplyForCheck(chat), null);
  }
  f.context.chat = [{ is_user: false, mes: '开场白' }, { is_user: true, mes: '你好' }, { is_user: false, mes: '<content>正常正文</content>' }, { is_system: true, mes: '系统无标签' }, { is_user: true, mes: '用户无标签' }];
  f.generate(); assert.equal(f.prompt(), '');
  assert.equal(f.latestReplyForCheck(f.context.chat).index, 2);
});
test('detects swallowed body and thought tags leaking into body', () => {
  const f = fixture(); f.enable();
  for (const text of ['<think><content>故事</content></think>', '<content>故事<thinking>内部分析</thinking></content>']) {
    f.context.chat.at(-1).mes = text; f.generate(); assert.ok(f.prompt());
  }
});
test('recomputes latest mes after editing, swiping and deleting replies', () => {
  const f = fixture(); f.enable(); f.generate(); assert.ok(f.prompt());
  f.context.chat.at(-1).mes = '<content>已修正</content>'; f.generate(); assert.equal(f.prompt(), '');
  f.context.chat.push({ is_user: false, mes: '滑动后的坏回复' }); f.generate(); assert.ok(f.prompt());
  f.context.chat.pop(); f.generate(); assert.equal(f.prompt(), '');
});
test('native reasoning metadata is outside the reply check', () => {
  const f = fixture(); f.enable();
  f.context.chat.at(-1).mes = '<content>正常正文</content>';
  f.context.chat.at(-1).extra.reasoning = '<think><content>不可见原生推理</content></think>';
  f.generate(); assert.equal(f.prompt(), '');
});
test('dry runs and quiet, impersonate, first_message and continue clear stale reminders', () => {
  const f = fixture(); f.enable();
  for (const type of ['quiet', 'impersonate', 'first_message', 'continue']) {
    f.generate(); assert.ok(f.prompt()); f.generate(type); assert.equal(f.prompt(), '');
  }
  f.generate(); assert.ok(f.prompt()); f.generate('normal', true); assert.equal(f.prompt(), '');
});
test('chat, preset and generation lifecycle events clear temporary prompts', () => {
  const f = fixture(); f.enable();
  for (const event of [EVENTS.CHAT_CHANGED, EVENTS.PRESET_CHANGED, EVENTS.GENERATION_STARTED, EVENTS.GENERATION_ENDED, EVENTS.GENERATION_STOPPED]) {
    f.generate(); assert.ok(f.prompt()); f.emit(event); assert.equal(f.prompt(), '', event);
  }
  f.generate(); assert.ok(f.prompt()); f.cleanups.forEach((cleanup) => cleanup()); assert.equal(f.prompt(), '');
});
test('per-preset rules use the active preset and retain custom required tags', () => {
  const f = fixture();
  f.enable('A', { bodyTag: '正文', requiredTags: ['摘要'], thinkingTag: '分析区' });
  f.enable('B', { bodyTag: 'story', requiredTags: [] });
  f.generate(); assert.match(f.prompt(), /<正文>…<\/正文>/); assert.match(f.prompt(), /<摘要>…<\/摘要>/);
  f.select('B'); f.generate(); assert.match(f.prompt(), /<story>…<\/story>/); assert.doesNotMatch(f.prompt(), /<正文>/);
  f.select('C'); f.generate(); assert.equal(f.prompt(), '');
  assert.equal(f.state.replyGuard.C, undefined);
});
test('non-openai API and missing host APIs degrade without touching chats', () => {
  const f = fixture(); f.enable();
  const chat = structuredClone(f.context.chat);
  f.context.mainApi = 'textgenerationwebui'; f.generate(); assert.equal(f.prompt(), '');
  f.context.mainApi = 'openai';
  delete f.context.eventTypes.GENERATION_AFTER_COMMANDS;
  assert.equal(f.replyGuardAvailable(), false); f.prepareReplyGuard('normal', {}, false); assert.equal(f.prompt(), '');
  f.context.eventTypes.GENERATION_AFTER_COMMANDS = EVENTS.GENERATION_AFTER_COMMANDS;
  delete f.context.setExtensionPrompt;
  assert.equal(f.replyGuardAvailable(), false); assert.doesNotThrow(() => f.generate());
  assert.equal(f.latestReplyForCheck(f.context.chat).index, 2);
  assert.deepEqual(f.context.chat, chat);
});
test('invalid saved rules fail closed and clear a previous prompt', () => {
  const f = fixture(); f.enable(); f.generate(); assert.ok(f.prompt());
  f.state.replyGuard.A.bodyTag = '1broken';
  assert.doesNotThrow(() => f.generate()); assert.equal(f.prompt(), ''); assert.equal(f.warnings.length, 1);
});
console.log(`${passed} reply-format runtime tests passed`);
