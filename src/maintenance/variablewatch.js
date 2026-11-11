// 仅保留变量状态摘要，不显示/保存变量正文，不替换酒馆的变量函数。
var variableObservations = new Map();
var variableWatchPending = null;
function variableContextKey(c = ctx()) {
  const actor = c.groupId != null ? ["group", c.groupId] : ["character", c.characters?.[c.characterId]?.avatar ?? c.characterId ?? ""];
  return JSON.stringify([actor, String(c.getCurrentChatId?.() || c.chatId || ""), String(currentPresetName() || "")]);
}
function variableSummary(value) {
  const type = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  const empty = value == null || typeof value === "string" && value.trim() === "";
  let raw;
  try { raw = JSON.stringify(value); } catch { raw = type; }
  return { type, empty, size: typeof value === "string" ? value.length : null, stamp: hashStr(raw || type) };
}
function captureVariableSnapshot(c = ctx()) {
  const local = c.chatMetadata?.variables;
  const global = c.extensionSettings?.variables?.global;
  const available = { local: !!c.chatMetadata && !!(c.getCurrentChatId?.() || c.chatId), global: !!global && typeof global === "object" };
  const rows = new Map();
  for (const [scope, store] of [["local", local], ["global", global]]) {
    if (!store || typeof store !== "object") continue;
    for (const [name, value] of Object.entries(store)) rows.set(variableIdentity(scope, name), { scope, name, ...variableSummary(value) });
  }
  return { key: variableContextKey(c), at: Date.now(), available, rows };
}
function variableSnapshotChanges(before, after) {
  if (!before || before.key !== after.key) return [];
  const changes = [];
  for (const key of new Set([...before.rows.keys(), ...after.rows.keys()])) {
    const a = before.rows.get(key), b = after.rows.get(key);
    if (!before.available[(b || a).scope] || !after.available[(b || a).scope]) continue;
    if (!a || !b || a.stamp !== b.stamp || a.type !== b.type) changes.push({ scope: (b || a).scope, name: (b || a).name, kind: !a ? "新增" : !b ? "删除" : "变化", empty: b?.empty });
  }
  return changes;
}
function recordVariableSnapshot(phase) {
  if (!settings().variableWatch) return;
  const after = captureVariableSnapshot();
  const record = variableObservations.get(after.key) || {};
  if (phase === "生成前") { record.before = after; record.changes = []; }
  else record.changes = variableSnapshotChanges(record.before, after);
  record.after = after; record.phase = phase;
  variableObservations.set(after.key, record);
  while (variableObservations.size > 10) variableObservations.delete(variableObservations.keys().next().value);
}
function bindVariableWatch(on, events) {
  on(events.GENERATION_AFTER_COMMANDS, (type, options, dryRun) => {
    if (dryRun) return;
    variableWatchPending = null;
    if (settings().variableWatch && !dryRun && !["quiet", "impersonate"].includes(type)) {
      recordVariableSnapshot("生成前"); variableWatchPending = variableContextKey();
    }
  });
  const finish = (phase) => {
    if (variableWatchPending === variableContextKey()) recordVariableSnapshot(phase);
    variableWatchPending = null;
  };
  on(events.GENERATION_ENDED, () => finish("生成后"));
  on(events.GENERATION_STOPPED, () => finish("停止后"));
  for (const event of [events.CHAT_CHANGED, events.PRESET_CHANGED]) on(event, () => { variableWatchPending = null; });
  cleanups.push(() => { variableObservations.clear(); variableWatchPending = null; });
}
