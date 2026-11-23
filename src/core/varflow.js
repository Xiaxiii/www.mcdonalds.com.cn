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
  // steps：这项风险经过的几步（哪条条目、做了什么、第几个操作），界面按它写「赋值 → 清空 → 读取」
  const add = (kind, event, steps, text) => issues.push({ kind, scope: event.scope, name: event.name, ids: [...new Set(steps.map((x) => x.id))], steps, text });
  const step = (op, ev) => ({ op, id: ev.id, index: ev.index });
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
        if (previous.kind === "deleted" || previous.hadValue || writes.get(key)?.some((w) => w.index > e.index)) {
          add("cleared", e, [...previous.valueAt ? [step("set", previous.valueAt)] : [], step(previous.kind === "deleted" ? "delete" : "clear", previous.at), step("get", e)], "读取前最近一次操作是清空或删除，可能读不到本轮内容");
        }
      } else if (!previous && writes.get(key)?.some((w) => w.index > e.index)) {
        add("read-before-write", e, [step("get", e), step("set", writes.get(key).find((w) => w.index > e.index))], "在本轮可见写入之前读取，可能读到空值或上一轮的旧值");
      }
      if (previous) previous.consumed = true;
      continue;
    }
    if (e.op === "has") { if (previous) previous.consumed = true; continue; }
    if (e.op === "flush" || e.op === "set" && !e.dynamicValue && isBlankValue(e.value)) {
      states.set(key, { kind: e.op === "flush" ? "deleted" : "empty", id: e.id, at: e, valueAt: previous?.kind === "value" ? previous.at : previous?.valueAt || null, hadValue: previous?.kind === "value" || previous?.hadValue, consumed: false });
      continue;
    }
    if (e.op === "set" && previous?.kind === "value" && !previous.consumed) add("overwritten", e, [step("set", previous.at), step("reset", e)], "前一次赋值尚未被可见读取使用，就被再次赋值覆盖；也可能是有意切换选项，请核对");
    states.set(key, { kind: e.dynamicValue ? "unknown" : "value", id: e.id, at: e, consumed: false, hadValue: true });
  }
  return { events, issues, unknown };
}

// 2.12.8「清空后读取」的一键改法，返回能用的几种（没有就是空数组）：
// move：赋值的那条整条只写这一个变量（不出字），挪到清空之后、读取之前，发出去的文字不变；
//       中间还有别处读这个变量、那条还写别的变量、或找不到这样的位置时不给
// unclear（2.12.11）：去掉清空那条里对这个变量的清空（清空宏不出字）；赋值那条会出字、挪不了时也能用
function planClearedFix(draft, issue, events) {
  if (issue.kind !== "cleared" || issue.steps.length !== 3 || issue.steps[0].op !== "set") return [];
  const [set, clear, read] = issue.steps;
  if (set.id === clear.id || clear.id === read.id) return [];
  const out = [];
  const name = (id) => draft.prompt(id)?.name || id;
  const key = variableIdentity(issue.scope, issue.name);
  const move = (() => {
    if (detectShape(draft.prompt(set.id)?.content).shape !== "wrap") return null;
    if (events.some((e) => e.id === set.id && variableIdentity(e.scope, e.name) !== key)) return null;
    if (events.some((e) => e.index > set.index && e.index < clear.index && variableIdentity(e.scope, e.name) === key && (e.op === "get" || e.op === "has"))) return null;
    const pos = (id) => draft.order.findIndex((o) => o.identifier === id);
    if (!(pos(set.id) < pos(clear.id) && pos(clear.id) < pos(read.id))) return null;
    const sg = draft.groupOf(set.id), cg = draft.groupOf(clear.id);
    // 同组：放在清空那条后面；赋值那条不在组里：清空那条在组里就放在那一组后面（组外），读取不能在那一组里
    if (sg) return sg === cg ? { id: set.id, where: { after: clear.id }, gid: cg, to: `「${name(clear.id)}」后面` } : null;
    if (!cg) return { id: set.id, where: { after: clear.id }, gid: null, to: `「${name(clear.id)}」后面` };
    const block = draft.blocks().find((b) => b.ids.includes(clear.id));
    const last = block?.ids[block.ids.length - 1];
    if (!last || pos(last) >= pos(read.id)) return null;
    return { id: set.id, where: { after: last }, gid: null, to: `「${draft.group(cg)?.name || "分组"}」组后面` };
  })();
  if (move) out.push({ kind: "move", ...move, label: `挪到${move.to}` });
  // 清空那条里对这个变量的清空宏（顶层的 setvar 空值、flushvar、deletevar），整句去掉
  const text = String(draft.prompt(clear.id)?.content || "");
  const hits = scanTopMacros(text).filter((m) => {
    const v = flowVariableMacro(m.inner);
    return v && variableIdentity(v.scope, v.name) === key && (v.op === "flush" || v.op === "set" && isBlankValue(v.value));
  });
  if (hits.length) {
    let content = text;
    for (const m of [...hits].reverse()) content = content.slice(0, m.start) + content.slice(m.end);
    out.push({ kind: "unclear", id: clear.id, content, label: `去掉「${name(clear.id)}」里的清空` });
  }
  return out;
}
