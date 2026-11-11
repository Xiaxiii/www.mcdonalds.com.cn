// 推理内容格式化按预设记忆：离开一个预设时记下当时的设置，切到有记录的预设时恢复。默认关闭。
var REASONING_KEYS = ["name", "auto_parse", "add_to_prompts", "auto_expand", "show_hidden", "prefix", "suffix", "separator", "max_additions"];
var reasoningPreset = null;
function reasoningNow(c = ctx()) {
  const r = c.powerUserSettings?.reasoning;
  if (!r || typeof r !== "object") return null;
  return Object.fromEntries(REASONING_KEYS.filter((k) => r[k] !== undefined).map((k) => [k, r[k]]));
}
function reasoningStore() {
  const s = settings();
  if (!s.reasoningByPreset || typeof s.reasoningByPreset !== "object") s.reasoningByPreset = {};
  return s.reasoningByPreset;
}
function rememberReasoning(name = reasoningPreset) {
  const now = reasoningNow();
  if (!name || !now) return;
  const store = reasoningStore();
  if (JSON.stringify(store[name]) === JSON.stringify(now)) return;
  store[name] = now;
  saveSettings();
}
// 写回酒馆设置并同步「推理内容格式化」面板；不触发模板下拉框的 change，以免模板覆盖记住的前后缀
function applyReasoning(saved) {
  const c = ctx(), r = c.powerUserSettings?.reasoning;
  if (!r || !saved) return false;
  const keys = REASONING_KEYS.filter((k) => saved[k] !== undefined && r[k] !== saved[k]);
  if (!keys.length) return false;
  for (const k of keys) r[k] = saved[k];
  const jq = globalThis.jQuery;
  const set = (id, value) => {
    const node = jq?.(`#${id}`);
    if (!node?.length) return;
    if (typeof value === "boolean") node.prop("checked", value);
    else node.val(value);
  };
  set("reasoning_select", r.name);
  set("reasoning_prefix", r.prefix);
  set("reasoning_suffix", r.suffix);
  set("reasoning_separator", r.separator);
  set("reasoning_max_additions", r.max_additions);
  set("reasoning_auto_parse", !!r.auto_parse);
  set("reasoning_add_to_prompts", !!r.add_to_prompts);
  set("reasoning_show_hidden", !!r.show_hidden);
  set("reasoning_auto_expand", !!r.auto_expand);
  // 已显示的消息按新设置展开或收起思考区
  jq?.("#reasoning_auto_expand").trigger("change");
  jq?.("#chat").attr("data-show-hidden-reasoning", r.show_hidden ? "true" : null);
  c.saveSettingsDebounced?.();
  return true;
}
function reasoningFollowOn() {
  return settings().reasoningFollowPreset === true;
}
function initReasoningFollow() {
  try { reasoningPreset = currentPresetName(); } catch { reasoningPreset = null; }
}
function onPresetSwitchReasoning(name) {
  const next = name || currentPresetName();
  if (!next || next === reasoningPreset) return;
  const prev = reasoningPreset;
  reasoningPreset = next;
  if (!reasoningFollowOn()) return;
  rememberReasoning(prev);
  const saved = reasoningStore()[next];
  if (saved && applyReasoning(saved)) toast(`推理格式已切换为「${next}」记住的设置`);
}
