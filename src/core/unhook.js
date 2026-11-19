// 2.11.29 取消接入思维链：去掉「接入思维链」写进预设的三处——条目里写入问句变量的那句、
// 思维链里读取它的那行、初始化条目里每轮清空它的那行。不靠接入时的记录，按现在的预设推算，以前接入的也能取消。
// 只处理条目自己写入、思维链直接读取的变量（「变量读到」）。别的条目也写同一个变量时（多选一、追加），
// 只去掉这一条的写入，思维链的读取和清空留给其他条目。
/** 返回 { id, key, name, scope, writes, others, cotIds, initId }；不是「变量读到」或找不到写入时返回 null */
function planUnhook(draft, id, manual = {}) {
  const p = draft.prompt(id);
  if (!p) return null;
  const a = analyze(draft, manual);
  const cov = a.coverage.get(id);
  if (!cov || cov.level !== "var") return null;
  const key = cov.via;
  const scope = key.startsWith("全局:") ? "global" : "local";
  const name = key.replace(/^全局:/, "");
  const mine = (m) => m.depth === 0 && m.name === name && m.scope === scope;
  const writes = listVarMacros(p.content || "").filter((m) => mine(m) && (m.op === "set" || m.op === "add") && !isBlankValue(m.value));
  if (!writes.length) return null;
  const initId = findInitEntry(draft);
  // 关着的条目也算：它们开起来时还要靠思维链读取（多选一的其他选项）
  const others = draft.order.map((o) => o.identifier).filter((x) => x !== id && x !== initId && listVarMacros(draft.prompt(x)?.content || "").some((m) => mine(m) && (m.op === "set" || m.op === "add") && !isBlankValue(m.value)));
  const reads = (x) => listVarMacros(draft.prompt(x)?.content || "").some((m) => m.name === name && m.scope === scope && m.op === "get");
  const cotIds = others.length ? [] : cotLikeIds(draft).filter(reads);
  const clears = initId && !others.length && listVarMacros(draft.prompt(initId)?.content || "").some((m) => mine(m) && m.op === "set" && isBlankValue(m.value));
  return { id, key, name, scope, writes: writes.map((m) => p.content.slice(m.start, m.end)), others, cotIds, initId: clears ? initId : null };
}
// 去掉一段宏：整行只有它（和行首的「-」「1.」之类）就连这一行一起去掉，否则只去掉宏本身
function cutMacro(text, start, end) {
  const s = String(text || "");
  const ls = s.lastIndexOf("\n", start - 1) + 1;
  let le = s.indexOf("\n", end);
  if (le < 0) le = s.length;
  const rest = s.slice(ls, start) + s.slice(end, le);
  if (/^[\s\-*•·>#\d.、)）]*$/.test(rest)) {
    if (le < s.length) return s.slice(0, ls) + s.slice(le + 1);
    return s.slice(0, ls).replace(/\n$/, "");
  }
  return s.slice(0, start) + s.slice(end);
}
// 只删顶层的宏（嵌在别的宏里的位置是相对外层算的）
function cutMacros(text, pick) {
  let s = String(text || "");
  // 从后往前删，前面的位置不变
  for (const m of listVarMacros(s).filter(pick).sort((x, y) => y.start - x.start)) s = cutMacro(s, m.start, m.end);
  return s;
}
/** 按 planUnhook 的结果改预设；返回改了几处 */
function applyUnhook(draft, plan) {
  const mine = (m) => m.depth === 0 && m.name === plan.name && m.scope === plan.scope;
  let n = 0;
  const p = draft.prompt(plan.id);
  if (p) {
    const c = cutMacros(p.content, (m) => mine(m) && (m.op === "set" || m.op === "add") && !isBlankValue(m.value));
    if (c !== p.content) { p.content = c.replace(/\s+$/, ""); n++; }
  }
  for (const cid of plan.cotIds) {
    const c2 = draft.prompt(cid);
    if (!c2) continue;
    const c = cutMacros(c2.content, (m) => m.depth === 0 && m.name === plan.name && m.scope === plan.scope && m.op === "get");
    if (c !== c2.content) { c2.content = c; n++; }
  }
  if (plan.initId) {
    const ip = draft.prompt(plan.initId);
    const c = ip ? cutMacros(ip.content, (m) => mine(m) && m.op === "set" && isBlankValue(m.value)) : null;
    if (ip && c !== ip.content) { ip.content = c; n++; }
  }
  return n;
}
