// 只搬运预设内置正则数据，不编译查找表达式、不执行替换内容。
function presetRegexList(draft) {
  const extensions = draft?.preset?.extensions;
  if (extensions != null && (typeof extensions !== "object" || Array.isArray(extensions))) throw new Error("预设扩展数据格式不正确，未修改正则");
  const rules = extensions?.regex_scripts;
  if (rules === undefined) return [];
  if (!Array.isArray(rules)) throw new Error("预设内置正则必须是数组，请先核对原数据");
  return rules;
}
function presetRegexSnapshot(draft) {
  return JSON.stringify({ present: Object.hasOwn(draft?.preset?.extensions || {}, "regex_scripts"), rules: draft?.preset?.extensions?.regex_scripts });
}
function presetRegexCanonical(value) {
  if (Array.isArray(value)) return value.map(presetRegexCanonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, presetRegexCanonical(value[key])]));
  }
  return value;
}
function presetRegexIdentity(rule) {
  if (!rule || typeof rule !== "object" || Array.isArray(rule)) return null;
  const { id: _id, ...content } = rule;
  return JSON.stringify(presetRegexCanonical(content));
}
function presetRegexRuleValid(rule) {
  return !!rule && typeof rule === "object" && !Array.isArray(rule)
    && typeof rule.findRegex === "string" && typeof rule.replaceString === "string"
    && Array.isArray(rule.placement) && rule.placement.every(Number.isInteger)
    && (rule.id == null || typeof rule.id === "string");
}
function presetRegexNewId(reserved) {
  for (let i = 0; i < 100; i++) {
    const id = uid();
    if (typeof id === "string" && id && !reserved.has(id)) return id;
  }
  throw new Error("无法生成不重复的正则编号，请重新预览");
}
function presetRegexGroupRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
/** 柏宝箱 1.x 的可携带正则分组；只核对，不清理或改写既有归属。 */
function presetRegexGroupValue(draft) {
  const extensions = draft?.preset?.extensions;
  if (extensions != null && !presetRegexGroupRecord(extensions)) throw new Error("预设扩展数据格式不正确，未修改正则分组");
  const toolkit = extensions?.baibaiToolkit;
  if (toolkit !== undefined && !presetRegexGroupRecord(toolkit)) throw new Error("柏宝箱扩展数据格式不正确，未修改正则分组");
  const value = toolkit?.regexGroups;
  if (value === undefined) return undefined;
  if (!presetRegexGroupRecord(value) || !["number", "string"].includes(typeof value.version) || Number(value.version) !== 1) throw new Error("预设正则分组格式或版本不支持，未修改原分组");
  if (!Array.isArray(value.groups) || !presetRegexGroupRecord(value.scripts)) throw new Error("预设正则分组格式不正确，未修改原分组");
  const ids = new Set(["__ungrouped", "__pending_assignment"]);
  const validOrder = (order) => order === undefined || (typeof order === "number" || typeof order === "string") && Number.isFinite(Number(order));
  for (const group of value.groups) {
    if (!presetRegexGroupRecord(group) || typeof group.id !== "string" || !group.id || ids.has(group.id)
      || group.name !== undefined && typeof group.name !== "string"
      || group.collapsed !== undefined && typeof group.collapsed !== "boolean" || !validOrder(group.order)) {
      throw new Error("预设正则分组条目格式不正确，未修改原分组");
    }
    ids.add(group.id);
  }
  for (const member of Object.values(value.scripts)) {
    if (!presetRegexGroupRecord(member) || member.groupId != null && typeof member.groupId !== "string" || !validOrder(member.order)) {
      throw new Error("预设正则分组成员格式不正确，未修改原分组");
    }
  }
  if (value.ungrouped !== undefined && (!presetRegexGroupRecord(value.ungrouped)
    || value.ungrouped.name !== undefined && typeof value.ungrouped.name !== "string"
    || value.ungrouped.collapsed !== undefined && typeof value.ungrouped.collapsed !== "boolean")) {
    throw new Error("预设正则默认分组格式不正确，未修改原分组");
  }
  return value;
}
function presetRegexGroupSnapshot(draft) {
  const value = presetRegexGroupValue(draft);
  return JSON.stringify({ present: Object.hasOwn(draft?.preset?.extensions?.baibaiToolkit || {}, "regexGroups"), value });
}
function presetRegexNextGroupOrder(values) {
  const last = values.reduce((max, value) => Math.max(max, value), -1);
  const next = Math.floor(last) + 1;
  if (!Number.isSafeInteger(next) || next <= last) throw new Error("正则分组顺序超出安全范围，请先核对现有分组顺序");
  return next;
}
function planPresetRegexGroup(targetDraft, rules, rows, groupName) {
  if (typeof groupName !== "string" || !groupName.trim()) throw new Error("正则分组名称不能为空，请核对预设名称");
  const existing = presetRegexGroupValue(targetDraft);
  const changedRows = rows.filter((row) => row.action === "append" || row.action === "replace");
  const memberIds = changedRows.map((row) => rules[row.targetIndex].id);
  if (!memberIds.length) return { group: null, regexGroups: clone(existing) };
  const counts = new Map();
  for (const rule of rules) if (rule?.id) counts.set(rule.id, (counts.get(rule.id) || 0) + 1);
  if (memberIds.some((id) => counts.get(id) !== 1)) throw new Error("缝入正则的目标编号重复，无法单独分组，请先核对重复编号");
  const regexGroups = existing === undefined ? { version: 1, groups: [], scripts: {}, ungrouped: { name: "默认分组", collapsed: false } } : clone(existing);
  const orderOf = (group, index) => group.order === undefined ? index : Number(group.order);
  const sameName = regexGroups.groups.map((value, index) => ({ value, index })).filter(({ value }) => value.name === groupName)
    .sort((left, right) => orderOf(left.value, left.index) - orderOf(right.value, right.index) || left.index - right.index)[0]?.value;
  let group = sameName;
  if (!group) {
    const reserved = new Set(["__ungrouped", "__pending_assignment", ...regexGroups.groups.map((item) => item.id), ...Object.values(regexGroups.scripts).map((item) => item.groupId)]);
    group = { id: presetRegexNewId(reserved), name: groupName, order: presetRegexNextGroupOrder(regexGroups.groups.map(orderOf)), collapsed: false };
    regexGroups.groups.push(group);
  }
  const rulePositions = new Map(rules.map((rule, index) => [rule?.id, index]));
  for (const row of changedRows) {
    const id = rules[row.targetIndex].id;
    const old = Object.hasOwn(regexGroups.scripts, id) ? regexGroups.scripts[id] : undefined;
    if (row.action === "replace" && old?.groupId === group.id) continue;
    const orders = Object.entries(regexGroups.scripts).filter(([scriptId, item]) => scriptId !== id && item.groupId === group.id)
      .map(([scriptId, item], index) => item.order === undefined ? rulePositions.get(scriptId) ?? index : Number(item.order));
    const member = { ...old, groupId: group.id, order: presetRegexNextGroupOrder(orders) };
    // 预设编号属于不可信数据；__proto__ 也只能成为普通的成员键。
    Object.defineProperty(regexGroups.scripts, id, { value: member, enumerable: true, writable: true, configurable: true });
  }
  return { group: { id: group.id, name: group.name, reused: !!sameName, memberIds }, regexGroups };
}
/** 纯计划：保持目标顺序，新规则按来源顺序追加；替换必须明确选择。 */
function planPresetRegexTransfer(sourceDraft, targetDraft, { selectedIndices = [], conflictChoices = {}, groupName } = {}) {
  const source = presetRegexList(sourceDraft), target = presetRegexList(targetDraft);
  const groupSignature = groupName === undefined ? undefined : presetRegexGroupSnapshot(targetDraft);
  if (!Array.isArray(selectedIndices) || selectedIndices.some((i) => !Number.isInteger(i) || i < 0 || i >= source.length)) throw new Error("所选正则不存在，请重新选择");
  const selected = new Set(selectedIndices);
  const rules = clone(target);
  const reserved = new Set(target.map((r) => r?.id).filter((id) => typeof id === "string" && id));
  const replaced = new Set();
  const targetIdentities = target.map(presetRegexIdentity);
  const originalIdentities = new Set(targetIdentities.filter((x) => x !== null));
  const identityCounts = new Map();
  const countIdentity = (identity, delta) => {
    if (identity !== null) identityCounts.set(identity, (identityCounts.get(identity) || 0) + delta);
  };
  targetIdentities.forEach((identity) => countIdentity(identity, 1));
  const rows = [], stats = { added: 0, replaced: 0, skipped: 0 };
  for (let i = 0; i < source.length; i++) {
    const original = source[i], valid = presetRegexRuleValid(original);
    const identity = presetRegexIdentity(original);
    const name = typeof original?.scriptName === "string" ? original.scriptName.trim() : "";
    const id = typeof original?.id === "string" ? original.id : "";
    const conflicts = target.flatMap((r, index) => {
      if (!r || typeof r !== "object") return [];
      const sameId = !!id && r.id === id;
      const sameName = !!name && typeof r.scriptName === "string" && r.scriptName.trim() === name;
      return sameId || sameName ? [{ index, id: r.id, name: typeof r.scriptName === "string" && r.scriptName ? r.scriptName : "未命名正则" }] : [];
    });
    const row = { sourceIndex: i, invalid: !valid, duplicate: identity !== null && originalIdentities.has(identity), conflicts, action: "unselected" };
    rows.push(row);
    if (!selected.has(i)) continue;
    if (!valid) { row.action = "skip"; stats.skipped++; continue; }
    const decision = conflictChoices[i] ?? "keep";
    const action = typeof decision === "string" ? decision : decision?.action;
    if (!["keep", "skip", "replace"].includes(action)) throw new Error("无法识别冲突处理方式，请重新选择");
    if (action === "skip") { row.action = "skip"; stats.skipped++; continue; }
    if (row.duplicate || identityCounts.get(identity) > 0) {
      row.action = "skip";
      row.batchDuplicate = !row.duplicate;
      stats.skipped++;
      continue;
    }
    const copy = clone(original);
    if (action === "replace") {
      const index = typeof decision === "object" ? decision?.targetIndex : conflicts.length === 1 ? conflicts[0].index : undefined;
      if (!Number.isInteger(index) || !conflicts.some((c) => c.index === index)) throw new Error("请明确选择要替换的那一条目标正则，或选择保留两份/跳过");
      if (replaced.has(index)) throw new Error("多条来源正则选择替换同一目标，请只选择一条或调整冲突处理");
      const oldId = target[index]?.id;
      copy.id = typeof oldId === "string" && oldId ? oldId : presetRegexNewId(reserved);
      reserved.add(copy.id);
      countIdentity(targetIdentities[index], -1);
      rules[index] = copy;
      replaced.add(index);
      row.action = "replace";
      row.targetIndex = index;
      stats.replaced++;
    } else {
      if (!copy.id || reserved.has(copy.id)) copy.id = presetRegexNewId(reserved);
      reserved.add(copy.id);
      rules.push(copy);
      row.action = "append";
      row.targetIndex = rules.length - 1;
      stats.added++;
    }
    countIdentity(identity, 1);
  }
  const plan = {
    sourceName: sourceDraft.name, targetName: targetDraft.name,
    sourceSignature: presetRegexSnapshot(sourceDraft), targetSignature: presetRegexSnapshot(targetDraft),
    rows, rules, stats, resultSignature: JSON.stringify(rules)
  };
  if (groupName !== undefined) {
    Object.assign(plan, planPresetRegexGroup(targetDraft, rules, rows, groupName), { groupSignature });
    plan.groupResultSignature = JSON.stringify({ group: plan.group, regexGroups: plan.regexGroups, rows: plan.rows, stats: plan.stats });
  }
  return plan;
}
function validatePresetRegexTransfer(targetDraft, plan, sourceDraft) {
  presetRegexList(targetDraft);
  if (!plan || plan.targetName !== targetDraft.name || plan.targetSignature !== presetRegexSnapshot(targetDraft)) throw new Error("目标预设的正则已变化，请重新预览");
  if (!sourceDraft || plan.sourceName !== sourceDraft.name || plan.sourceSignature !== presetRegexSnapshot(sourceDraft)) throw new Error("来源预设的正则已变化，请重新预览");
  if (!Array.isArray(plan.rules) || plan.resultSignature !== JSON.stringify(plan.rules)) throw new Error("正则缝合方案已变化，请重新预览");
  if (["group", "regexGroups", "groupSignature", "groupResultSignature"].some((key) => Object.hasOwn(plan, key))) {
    if (typeof plan.groupSignature !== "string" || typeof plan.groupResultSignature !== "string") throw new Error("正则分组方案已变化，请重新预览");
    if (plan.groupSignature !== presetRegexGroupSnapshot(targetDraft)) throw new Error("目标预设的正则分组已变化，请重新预览");
    if (plan.groupResultSignature !== JSON.stringify({ group: plan.group, regexGroups: plan.regexGroups, rows: plan.rows, stats: plan.stats })) throw new Error("正则分组方案已变化，请重新预览");
  }
}
function applyPresetRegexTransfer(targetDraft, plan, sourceDraft) {
  validatePresetRegexTransfer(targetDraft, plan, sourceDraft);
  if (!plan.stats.added && !plan.stats.replaced) return false;
  const rules = clone(plan.rules), regexGroups = plan.group ? clone(plan.regexGroups) : undefined;
  if (!targetDraft.preset.extensions) targetDraft.preset.extensions = {};
  targetDraft.preset.extensions.regex_scripts = rules;
  if (regexGroups) {
    if (!targetDraft.preset.extensions.baibaiToolkit) targetDraft.preset.extensions.baibaiToolkit = {};
    targetDraft.preset.extensions.baibaiToolkit.regexGroups = regexGroups;
  }
  return true;
}

// 缝来的格式条目（状态栏、正文尾）要靠来源预设的显示正则才能变成美化；目标没有对应正则时，缝过去只会显示原文。
// 只比对查找表达式里的固定标记：<标签> 和「字段:」，不编译、不执行正则。
var REGEX_ANCHOR_SKIP = new Set(["br", "div", "span", "p", "b", "i", "a", "img", "style", "script", "details", "summary", "http", "https"]);
function presetRegexAnchors(rule) {
  const find = String(rule?.findRegex || "").replace(/\\(?=[/<>:：])/g, "");
  const tags = new Set(), fields = new Set();
  // 2.5.7 前一个字符不是 ? 或 \\ 时才算标签；不用后行断言（iOS 16.4 以前的 Safari 不认）
  for (const m of find.matchAll(/(^|[^?\\])<(?:\\s\*)?\/?(?:\\s\*)?([A-Za-z_\u3400-\u9fff][\w\u3400-\u9fff-]{0,30})/g)) {
    const t = m[2].toLowerCase();
    if (!REGEX_ANCHOR_SKIP.has(t)) tags.add(t);
  }
  // \n、\s 这类转义先换成空格，字段名才分得开
  const plain = find.replace(/\\[nrtsSdDwWbB]/g, " ");
  for (const m of plain.matchAll(/(?:^|[^\w\u3400-\u9fff\\])([A-Za-z\u3400-\u9fff][\w\u3400-\u9fff]{1,20})(?:\s*[*+?])?(?:[:：]|\[[:：]{2}\])/g)) {
    const f = m[1].toLowerCase();
    if (!REGEX_ANCHOR_SKIP.has(f)) fields.add(f);
  }
  return { tags, fields };
}
function presetRegexFormatDeps(sourceDraft, targetDraft, texts) {
  let source, target;
  try { source = presetRegexList(sourceDraft); target = presetRegexList(targetDraft); } catch { return texts.map(() => []); }
  const display = source.map((rule, index) => ({ rule, index })).filter(({ rule }) => presetRegexRuleValid(rule) && !rule.disabled && !(rule.promptOnly && !rule.markdownOnly) && (rule.placement || []).includes(2));
  const covered = { tags: new Set(), fields: new Set() };
  for (const rule of target) {
    if (!presetRegexRuleValid(rule)) continue;
    const a = presetRegexAnchors(rule);
    a.tags.forEach((t) => covered.tags.add(t));
    a.fields.forEach((f) => covered.fields.add(f));
  }
  const anchors = display.map((x) => ({ ...x, ...presetRegexAnchors(x.rule) }));
  return texts.map((text) => {
    const content = String(text || "").toLowerCase();
    const out = [];
    for (const x of anchors) {
      const tag = [...x.tags].find((t) => !covered.tags.has(t) && new RegExp(`<\\s*/?\\s*${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=[\\s>])`).test(content));
      const field = !tag && x.tags.size === 0 ? [...x.fields].filter((f) => !covered.fields.has(f) && new RegExp(`(^|[^\\w\u3400-\u9fff])${f}\\s*[:：]`, "m").test(content)) : [];
      if (tag) out.push({ index: x.index, name: x.rule.scriptName || "未命名正则", mark: `<${tag}>` });
      else if (field.length >= 2) out.push({ index: x.index, name: x.rule.scriptName || "未命名正则", mark: field.slice(0, 3).map((f) => `${f}:`).join(" ") });
    }
    return out;
  });
}
