var SEP_PAIRS = [
  [/^\s*╔(.+?)╗\s*$/, /^\s*╚(.+?)╝\s*$/],
  [/^\s*╓(.+?)╖\s*$/, /^\s*╙(.+?)╜\s*$/],
  [/^\s*[┌╭](.+?)[┐╮]\s*$/, /^\s*[└╰](.+?)[┘╯]\s*$/]
];
var SEP_SINGLE = [
  /^\s*[—–-]{2,}\s*(.+?)\s*[—–-]{2,}\s*$/,
  /^\s*✧[─—-]+(.+?)[─—-]+✧/,
  /^\s*♬[─—-]+(.+?)[─—-]+♬/,
  /^\s*♫•\*(.+?)\*•♫/,
  /^\s*˙⟡(.+?)₊˚⊹\s*$/,
  /^\s*[=＝]{2,}\s*(.+?)\s*[=＝]{2,}\s*$/,
  /^\s*[【\[](.+?)[】\]]\s*$/
];
function cleanTitle(t) {
  return String(t || "").replace(/^[\s─━╌┄┅┈┉—–-]+|[\s─━╌┄┅┈┉—–-]+$/g, "").replace(/(开始|结束|开启|关闭|start|end|↓|↑)\s*$/i, "").replace(/[↓↑]/g, "").trim();
}
function separatorInfo(name, content) {
  const n = String(name || "").replace(/[\uFE0E\uFE0F]/g, "").trim();
  const down = /^[↓⇩⬇↧]+\s*(.+?)\s*[↓⇩⬇↧]+$/u.exec(n);
  if (down) return { title: cleanTitle(down[1]), kind: "open", implicitEnd: true };
  const up = /^[↑⇧⬆↥]+\s*(.+?)\s*[↑⇧⬆↥]+$/u.exec(n);
  if (up) return { title: cleanTitle(up[1]), kind: "close" };
  for (const [o, c2] of SEP_PAIRS) {
    let m = o.exec(n);
    if (m) return { title: cleanTitle(m[1]), kind: "open" };
    m = c2.exec(n);
    if (m) return { title: cleanTitle(m[1]), kind: "close" };
  }
  const short = String(content || "").trim().length < 60;
  for (let k = 0; k < SEP_SINGLE.length; k++) {
    const m = SEP_SINGLE[k].exec(n);
    if (m && short && /[\p{L}\p{N}]/u.test(m[1])) {
      const raw = m[1];
      const kind = /(结束|关闭|end|↑)\s*$/i.test(raw) ? "close" : /(开始|开启|start|↓)\s*$/i.test(raw) ? "open" : "line";
      return { title: cleanTitle(raw), kind, style: k };
    }
  }
  return null;
}
function decorativeGroupDivider(name, content) {
  const n = String(name || "").trim();
  return n.length >= 4 && /[─━╌┄┅┈┉—–=-]{2}/u.test(n) && !/[\p{L}\p{N}]/u.test(n) && String(content || "").trim().length < 60;
}
function leadingSymbol(name) {
  const m = /^\s*([^\p{L}\p{N}\s]+)/u.exec(String(name || ""));
  if (!m) return "";
  const seg = typeof Intl !== "undefined" && Intl.Segmenter ? [...new Intl.Segmenter("zh", { granularity: "grapheme" }).segment(m[1])][0]?.segment : [...m[1]][0];
  return seg || "";
}
function suggestGroups(draft, { minSize = 3, onlyUngrouped = true } = {}) {
  const order = draft.order.map((o) => o.identifier);
  const free = (id) => (!onlyUngrouped || !draft.groupOf(id)) && !draft.isMarker(id);
  const used = /* @__PURE__ */ new Set();
  const out = [];
  for (let i = 0; i < order.length; i++) {
    const id = order[i];
    if (!free(id) || used.has(id)) continue;
    const p = draft.prompt(id);
    const sep = separatorInfo(p?.name, p?.content);
    if (!sep || sep.kind === "close") continue;
    let end = -1;
    for (let j = i + 1; j < order.length; j++) {
      const q = draft.prompt(order[j]);
      if (!free(order[j]) || draft.isMarker(order[j]) || decorativeGroupDivider(q?.name, q?.content)) {
        end = j - 1;
        break;
      }
      const s2 = separatorInfo(q?.name, q?.content);
      if (!s2) continue;
      const same = s2.title && sep.title && groupTitleKey(s2.title) === groupTitleKey(sep.title);
      if (same && (s2.kind === "close" || s2.kind === "line" || s2.kind === "open")) {
        end = j;
        break;
      }
      if (s2.kind === "open" && !same) {
        end = j - 1;
        break;
      }
      if (s2.kind === "close" || s2.kind === "line" && s2.style === sep.style && !same) {
        end = j - 1;
        break;
      }
    }
    if (end < 0 && sep.implicitEnd) end = order.length - 1;
    if (end < 0) continue;
    const ids = order.slice(i, end + 1).filter((x) => free(x) && !used.has(x));
    if (ids.length >= (sep.implicitEnd ? Math.min(minSize, 2) : minSize)) {
      out.push({ name: sep.title || (p?.name || "分组"), ids, reason: "首尾分隔条目" });
      ids.forEach((x) => used.add(x));
    }
  }
  const heads = [];
  order.forEach((id, i) => {
    if (!free(id) || used.has(id)) return;
    const p = draft.prompt(id);
    const sep = separatorInfo(p?.name, p?.content);
    if (sep && sep.kind === "line" && sep.style !== void 0) heads.push({ i, id, style: sep.style, title: sep.title });
  });
  const styles = [...new Set(heads.map((h) => h.style))].filter((st) => heads.filter((h) => h.style === st).length >= 3);
  if (styles.length) {
    const primary = heads.find((h) => styles.includes(h.style)).style;
    const secondary = styles.find((st) => st !== primary);
    const prim = heads.filter((h) => h.style === primary);
    const sections = [];
    prim.forEach((h, k) => {
      const stop = k + 1 < prim.length ? prim[k + 1].i : order.length;
      let ids = order.slice(h.i, stop).filter((x) => free(x) && !used.has(x));
      const cut = order.slice(h.i, stop).findIndex((x) => !free(x));
      if (cut > 0) ids = order.slice(h.i, h.i + cut).filter((x) => !used.has(x));
      sections.push({ title: h.title, ids, start: h.i });
    });
    for (const sec of sections) {
      const subs = secondary === void 0 ? [] : heads.filter((h) => h.style === secondary && sec.ids.includes(h.id));
      if (sec.ids.length > 25 && subs.length) {
        const first = sec.ids.indexOf(subs[0].id);
        const headPart = sec.ids.slice(0, first);
        if (headPart.length >= minSize) out.push({ name: sec.title, ids: headPart, reason: "分隔小标题" });
        headPart.forEach((x) => used.add(x));
        subs.forEach((sub, k) => {
          const a = sec.ids.indexOf(sub.id);
          const b = k + 1 < subs.length ? sec.ids.indexOf(subs[k + 1].id) : sec.ids.length;
          const ids = sec.ids.slice(a, b);
          if (ids.length >= Math.min(minSize, 2)) {
            out.push({ name: `${sec.title}\xB7${sub.title}`, ids, reason: "分隔小标题" });
            ids.forEach((x) => used.add(x));
          }
        });
      } else if (sec.ids.length >= minSize) {
        out.push({ name: sec.title, ids: sec.ids, reason: "分隔小标题" });
        sec.ids.forEach((x) => used.add(x));
      }
    }
  }
  const varOf = (id) => {
    const s = detectShape(draft.prompt(id)?.content);
    return s.shape === "wrap" || s.shape === "tagname" ? s.varName : null;
  };
  let run = [];
  let runVar = null;
  const flushVar = () => {
    if (runVar && run.length >= minSize) {
      out.push({ name: runVar, ids: [...run], reason: `均写入变量「${runVar}」` });
      run.forEach((x) => used.add(x));
    }
    run = [];
    runVar = null;
  };
  for (const id of order) {
    if (!free(id) || used.has(id)) {
      flushVar();
      continue;
    }
    const v = varOf(id);
    const p = draft.prompt(id);
    const isBlank = !String(p?.content || "").trim();
    if (v && v === runVar) {
      run.push(id);
      continue;
    }
    if (!v && isBlank && runVar) {
      continue;
    }
    flushVar();
    if (v) {
      runVar = v;
      run = [id];
    }
  }
  flushVar();
  let sym = "";
  run = [];
  const flushSym = () => {
    if (sym && run.length >= minSize) {
      const names = run.map((x) => draft.prompt(x)?.name || "");
      out.push({ name: guessName(sym, names), ids: [...run], reason: `均以「${sym}」开头` });
      run.forEach((x) => used.add(x));
    }
    run = [];
    sym = "";
  };
  for (const id of order) {
    if (!free(id) || used.has(id)) {
      flushSym();
      continue;
    }
    const s = leadingSymbol(draft.prompt(id)?.name);
    if (s && s === sym) {
      run.push(id);
      continue;
    }
    flushSym();
    if (s) {
      sym = s;
      run = [id];
    }
  }
  flushSym();
  const pos = new Map(order.map((x, i) => [x, i]));
  out.sort((a, b) => pos.get(a.ids[0]) - pos.get(b.ids[0]));
  return out;
}
function groupTitleKey(name) {
  return cleanTitle(String(name || "").normalize("NFKC")).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "").replace(/^(.{2,}?)(?:分区|区域|区)$/u, "$1");
}
function isGroupControl(p) {
  return /一键(?:开关|开启|关闭)|总开关|开关总控/.test(String(p?.name || ""));
}
/** 给未分组条目建议归属。结构优先；同名分组和共同变量必须能唯一匹配。 */
function groupingSuggestions(draft) {
  const order = draft.order.map((o) => o.identifier);
  const prompts = draft.promptMap();
  const free = (id) => !draft.groupOf(id) && prompts.has(id) && !draft.isMarker(id);
  const known = new Map();
  for (const g of draft.groups.groups) {
    const key = groupTitleKey(g.name);
    if (key) { if (!known.has(key)) known.set(key, []); known.get(key).push(g.id); }
  }
  const used = new Set(), suggestions = [];
  const offer = (name, ids, reason) => {
    ids = ids.filter((id) => free(id) && !used.has(id) && !decorativeGroupDivider(prompts.get(id)?.name, prompts.get(id)?.content));
    if (!ids.length) return;
    const targets = known.get(groupTitleKey(name)) || [];
    suggestions.push({ name, ids, reason, targetGroupId: targets.length === 1 ? targets[0] : null, needsChoice: targets.length > 1 });
    ids.forEach((id) => used.add(id));
  };
  for (const g of suggestGroups(draft)) offer(g.name, g.ids, g.reason);
  // 正文中的跨条目标签、START/END 注释也可以声明分区；关闭条目同样属于结构的一部分。
  const sections = structureSections(draft, { activeOnly: false }).sort((a, b) => (a.closeIdx - a.openIdx) - (b.closeIdx - b.openIdx));
  for (const sec of sections) {
    const ids = order.slice(sec.openIdx, sec.closeIdx + 1);
    const occupied = ids.some((id) => draft.groupOf(id) || used.has(id));
    if (occupied && !known.has(groupTitleKey(sec.name))) continue;
    offer(sec.name, ids, sec.comment ? "正文 START/END 分区" : "正文跨条目标签分区");
  }
  const signatures = new Map();
  const signature = (p) => {
    if (!p || isGroupControl(p)) return null;
    const shape = detectShape(p.content);
    return ["wrap", "tagname"].includes(shape.shape) && shape.varName && !/[{}]/.test(shape.varName) ? { key: `${shape.scope || "local"}:${shape.varName}`, name: shape.varName } : null;
  };
  for (const id of order) {
    const gid = draft.groupOf(id), sig = signature(prompts.get(id));
    if (!gid || !draft.group(gid) || !sig) continue;
    if (!signatures.has(sig.key)) signatures.set(sig.key, new Map());
    const owners = signatures.get(sig.key);
    if (!owners.has(gid)) owners.set(gid, new Set());
    owners.get(gid).add(id);
  }
  const unassigned = [];
  for (const id of order) {
    const p = prompts.get(id);
    if (!free(id) || used.has(id) || decorativeGroupDivider(p?.name, p?.content)) continue;
    const targets = new Map();
    if (!isGroupControl(p)) {
      const label = String(p.name || "");
      const bracket = /^\s*[【\[（(]([^】\]）)\n]{1,50})[】\]）)]/.exec(label);
      const prefix = /^\s*(.{1,50}?)\s*[|｜:：·—–-]\s*\S/.exec(label);
      for (const name of [label, bracket?.[1], prefix?.[1]].filter(Boolean)) {
        for (const gid of known.get(groupTitleKey(name)) || []) targets.set(gid, "条目名称含明确分区名称");
      }
      const sig = signature(p), owners = sig && signatures.get(sig.key);
      if (owners?.size === 1) {
        const [gid, members] = [...owners][0];
        if (members.size >= 2) targets.set(gid, `与组内至少 2 条共用变量「${sig.name}」`);
      }
    }
    if (targets.size === 1) {
      const [gid, reason] = [...targets][0];
      suggestions.push({ name: draft.group(gid).name, ids: [id], reason, targetGroupId: gid, needsChoice: false });
      used.add(id);
    } else unassigned.push({ name: p.name || id, ids: [id], reason: targets.size > 1 ? "存在多个归属候选，请手动选择" : "没有明确分区标记，请手动选择", targetGroupId: null, needsChoice: true });
  }
  const merged = new Map();
  for (const g of suggestions) {
    const key = g.targetGroupId ? `group:${g.targetGroupId}` : `${g.needsChoice ? "choose" : "new"}:${groupTitleKey(g.name)}`;
    const previous = merged.get(key);
    if (previous) { previous.ids.push(...g.ids); if (!previous.reason.includes(g.reason)) previous.reason += "；" + g.reason; }
    else merged.set(key, { ...g, ids: [...g.ids] });
  }
  const position = new Map(order.map((id, i) => [id, i]));
  const result = [...merged.values()];
  result.forEach((g) => g.ids.sort((a, b) => position.get(a) - position.get(b)));
  result.sort((a, b) => position.get(a.ids[0]) - position.get(b.ids[0]));
  return { suggestions: result, unassigned };
}
/** 在副本上计算实际归组结果，预览与应用采用同一份结果，不执行条目里的宏。 */
function planGroupingAssignments(draft, assignments) {
  const next = new Draft(draft.name, draft.preset);
  next.groups = clone(draft.groups);
  const used = new Set(), newGroupIds = [];
  const position = new Map(draft.order.map((o, i) => [o.identifier, i]));
  const sorted = [...assignments].sort((a, b) => (position.get(a.ids[0]) ?? Infinity) - (position.get(b.ids[0]) ?? Infinity));
  for (const a of sorted) {
    if (!a.ids.length || a.ids.some((id) => !position.has(id) || !next.prompt(id) || next.isMarker(id) || draft.groupOf(id) || used.has(id))) throw new Error("条目不存在、已有归属或被重复分配，请重新识别");
    const ids = next.sortByOrder(a.ids);
    if (a.targetGroupId) {
      if (!next.group(a.targetGroupId)) throw new Error("目标分区已不存在，请重新识别");
      next.gatherGroup(a.targetGroupId);
      const members = next.order.filter((o) => next.groupOf(o.identifier) === a.targetGroupId);
      const last = members[members.length - 1]?.identifier, p = last && next.prompt(last);
      const marks = p ? structureMarks(p.content) : [];
      const closing = p && (separatorInfo(p.name, p.content)?.kind === "close" || marks.length > 0 && marks.every((m) => !m.open));
      if (closing) next.move(ids, { before: last }, a.targetGroupId);
      else next.moveIntoGroup(ids, a.targetGroupId);
    } else {
      const name = String(a.name || "").trim();
      if (!name || name.length > 120) throw new Error("请填写 1–120 字的新分组名称");
      newGroupIds.push(next.createGroup(name, ids));
    }
    ids.forEach((id) => used.add(id));
  }
  return { order: next.order, groups: next.groups, newGroupIds, assignedIds: [...used] };
}
/** 同一分组在条目顺序中被隔开的区段；只采用已有归属，不按名称猜测。 */
function fragmentedGroups(draft) {
  const known = new Map(draft.groups.groups.map((g) => [g.id, g]));
  const found = new Map();
  let previous = null;
  for (const o of draft.order) {
    const gid = draft.groupOf(o.identifier);
    if (known.has(gid)) {
      if (!found.has(gid)) found.set(gid, { groupId: gid, name: known.get(gid).name || "分组", ids: [], parts: 0 });
      const g = found.get(gid);
      g.ids.push(o.identifier);
      if (gid !== previous) g.parts++;
    }
    previous = gid;
  }
  return [...found.values()].filter((g) => g.parts > 1);
}
/** 预览与实际应用共用的顺序：各组收拢到首次出现处，组内和其余条目的相对先后不变。 */
function planGroupGather(draft, groupIds) {
  const wanted = groupIds == null ? null : new Set(groupIds);
  const groups = fragmentedGroups(draft).filter((g) => !wanted || wanted.has(g.groupId));
  const members = new Map(groups.map((g) => [g.groupId, []]));
  for (const o of draft.order) members.get(draft.groupOf(o.identifier))?.push(o);
  const emitted = new Set();
  const order = [];
  for (const o of draft.order) {
    const gid = draft.groupOf(o.identifier);
    if (!members.has(gid)) order.push(o);
    else if (!emitted.has(gid)) {
      order.push(...members.get(gid));
      emitted.add(gid);
    }
  }
  return { groups, order };
}
function guessName(sym, names) {
  const stripped = names.map((n) => n.replace(/^[^\p{L}\p{N}]+/u, ""));
  let pre = stripped[0] || "";
  for (const n of stripped) {
    while (pre && !n.startsWith(pre)) pre = pre.slice(0, -1);
  }
  pre = pre.replace(/[|｜\-—_·:：\s]+$/, "");
  if (pre.length >= 2) return `${sym}${pre}`;
  return `${sym}${stripped[0] ? stripped[0].slice(0, 6) : ""}等`;
}

