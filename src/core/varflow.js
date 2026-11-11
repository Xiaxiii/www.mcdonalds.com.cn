// 只按可见的预设列表顺序检查风险；不执行宏、脚本，也不改变变量。
function flowVariableMacro(inner) {
  const head = /^\s*([a-z]+)(?=::|\s|$)/i.exec(inner);
  if (!head) return null;
  let op, scope;
  const match = /^(set|get|add|inc|dec|has|delete|flush)(global)?var$/i.exec(head[1]);
  const exists = /^(global)?varexists$/i.exec(head[1]);
  if (match) { op = match[1].toLowerCase(); scope = match[2] ? "global" : "local"; }
  else if (exists) { op = "has"; scope = exists[1] ? "global" : "local"; }
  else return null;
  if (op === "delete") op = "flush";
  const rest = inner.slice(head[0].length).trimStart().replace(/^::/, "");
  const split = rest.indexOf("::");
  return { op, scope, name: (split < 0 ? rest : rest.slice(0, split)).trim(), value: split < 0 ? null : rest.slice(split + 2) };
}
function flowVariableEvents(text, depth = 0) {
  const events = [], unknown = [];
  if (depth > 8) return { events, unknown: ["嵌套层级过深"] };
  const source = String(text || ""), tops = scanTopMacros(source);
  let outside = "", last = 0;
  for (const m of tops) {
    outside += source.slice(last, m.start); last = m.end;
    if (/^\s*\/\//.test(m.inner)) continue;
    const v = flowVariableMacro(m.inner);
    if (!v) {
      if (/^(?:set|add|get|has|delete|flush)(?:global)?var(?:key|index)\b|^var(?:::|\s)/i.test(m.inner.trim())) unknown.push("对象/数组键或脚本局部变量未推演");
      if (/\{\{|^(?:if|else|while|run|eval)\b/i.test(m.inner.trim())) unknown.push("条件或非变量宏中的读写未推演");
      continue;
    }
    if (!v.name || /[{}]/.test(v.name)) { unknown.push("变量名为空或由动态宏计算"); continue; }
    if (["set", "add"].includes(v.op) && v.value === null) { unknown.push("赋值宏未提供可确认的参数分隔"); continue; }
    if (v.value?.includes("{{")) {
      const nested = flowVariableEvents(v.value, depth + 1);
      if (nested.events.some((x) => x.op !== "get" && x.op !== "has")) unknown.push("嵌套宏含写入，执行顺序需运行时核对");
      else events.push(...nested.events);
      unknown.push(...nested.unknown);
    }
    events.push({ ...v, dynamicValue: !!v.value?.includes("{{") });
  }
  outside += source.slice(last);
  if (/\{\{\s*(?:set|get|add|inc|dec|has|flush|delete)(?:global)?var\b/i.test(outside)) unknown.push("变量宏括号未完整闭合");
  return { events, unknown: [...new Set(unknown)] };
}
function variableIdentity(scope, name) { return JSON.stringify([scope, name]); }
function auditVariableFlow(draft) {
  return draft.withReadIndex ? draft.withReadIndex(() => auditVariableFlowIndexed(draft)) : auditVariableFlowIndexed(draft);
}
function auditVariableFlowIndexed(draft) {
  const events = [], unknown = [], issues = [], states = new Map();
  const add = (kind, event, ids, text) => issues.push({ kind, scope: event.scope, name: event.name, ids: [...new Set(ids)], text });
  for (const o of draft.order) {
    if (!draft.isActive(o.identifier) || draft.isMarker(o.identifier)) continue;
    const p = draft.prompt(o.identifier), content = String(p?.content || "");
    const scanned = flowVariableEvents(content);
    const reasons = [...scanned.unknown];
    if (p.injection_position === 1 || p.injection_trigger?.length) reasons.push("深度插入或触发条件会改变执行顺序");
    if (/<%|\{\{\s*(?:if|else|while|run|eval)(?:::|\s|\}\})|^\s*\/(?:set|add|flush|run|if|while)\b/im.test(content)) reasons.push("包含脚本、条件或命令");
    if (reasons.length) { unknown.push({ id: o.identifier, reasons: [...new Set(reasons)] }); continue; }
    events.push(...scanned.events.map((e) => ({ ...e, id: o.identifier })));
  }
  const writes = new Map();
  events.forEach((e, index) => {
    e.index = index;
    if (["set", "add", "inc", "dec"].includes(e.op)) {
      const key = variableIdentity(e.scope, e.name);
      if (!writes.has(key)) writes.set(key, []);
      writes.get(key).push(e);
    }
  });
  for (const e of events) {
    const key = variableIdentity(e.scope, e.name);
    const previous = states.get(key);
    if (e.op === "get") {
      if (previous?.kind === "empty" || previous?.kind === "deleted") {
        if (previous.kind === "deleted" || previous.hadValue || writes.get(key)?.some((w) => w.index > e.index)) add("cleared", e, [previous.id, e.id], "读取前最近一次操作是清空或删除，可能读不到本轮内容");
      } else if (!previous && writes.get(key)?.some((w) => w.index > e.index)) {
        add("read-before-write", e, [e.id, writes.get(key).find((w) => w.index > e.index).id], "在本轮可见写入之前读取，可能读到空值或上一轮的旧值");
      }
      if (previous) previous.consumed = true;
      continue;
    }
    if (e.op === "has") { if (previous) previous.consumed = true; continue; }
    if (e.op === "flush" || e.op === "set" && !e.dynamicValue && isBlankValue(e.value)) {
      states.set(key, { kind: e.op === "flush" ? "deleted" : "empty", id: e.id, hadValue: previous?.kind === "value" || previous?.hadValue, consumed: false });
      continue;
    }
    if (e.op === "set" && previous?.kind === "value" && !previous.consumed) add("overwritten", e, [previous.id, e.id], "前一次赋值尚未被可见读取使用，就被再次赋值覆盖；也可能是有意切换选项，请核对");
    states.set(key, { kind: e.dynamicValue ? "unknown" : "value", id: e.id, consumed: false, hadValue: true });
  }
  return { events, issues, unknown };
}
