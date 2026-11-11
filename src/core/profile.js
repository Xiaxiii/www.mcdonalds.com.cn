// 1.3.0：写法分析——一个预设"是怎么让条目生效的"，以及某一条在它自己的预设里是怎么起作用的。
// 缝合时同时分析来源和目标，按两边的差异自动改写，并决定要不要挂进思维链。

var TRIGGER_NAMES = { normal: "普通发送", continue: "继续", impersonate: "代拟", swipe: "重抽", regenerate: "重新生成", quiet: "后台生成" };
function hasConditional(text) {
  return /\{\{\s*(?:if|else|\/if)\b/i.test(text);
}
function hasScript(text) {
  return /<%[\s\S]*?%>/.test(text) || /\{\{\s*(?:run|eval)\b/i.test(text);
}
function hasRandom(text) {
  return /\{\{\s*(?:random|pick|roll)\s*[:}]/i.test(text);
}
function namesOf(draft, ids, n = 3) {
  const list = ids.map((id) => draft.prompt(id)?.name || id);
  return list.slice(0, n).map((x) => `「${x}」`).join("") + (list.length > n ? ` 等 ${list.length} 条` : "");
}

/** 整个预设的写法画像 */
function profilePreset(draft) {
  return draft.withReadIndex(() => profilePresetIndexed(draft));
}
function profilePresetIndexed(draft) {
  const a = analyze(draft);
  const cotSet = new Set(a.cotIds);
  const order = draft.order.map((o) => o.identifier);
  const active = order.filter((id) => draft.isActive(id));
  const P = (id) => draft.prompt(id);
  // 思维链怎么读条目
  const cotVarReads = a.cotIds.reduce((n, id) => n + listVarMacros(P(id)?.content || "").filter((m) => m.op === "get").length, 0);
  let covVar = 0, covMention = 0;
  for (const c2 of a.coverage.values()) {
    if (c2.level === "var" || c2.level === "chain") covVar++;
    else if (c2.level === "mention") covMention++;
  }
  const cotStyle = !a.cotIds.length ? "none" : cotVarReads >= 3 && covVar >= covMention ? "vars" : covMention > 0 && cotVarReads < 3 ? "text" : cotVarReads ? "mixed" : "text";
  // 变量用法
  const perEntry = [];
  const shared = [];
  // 写同一个变量的条目要把关着的也算上（单选槽位一般只开一条）
  const writersAll = /* @__PURE__ */ new Map();
  for (const o of draft.order) {
    if (cotSet.has(o.identifier)) continue;
    for (const m of listVarMacros(P(o.identifier)?.content || "")) {
      if (!m.name || !(m.op === "set" || m.op === "add") || isBlankValue(m.value) || m.depth !== 0) continue;
      const k = (m.scope === "global" ? "全局:" : "") + m.name;
      if (!writersAll.has(k)) writersAll.set(k, []);
      const list = writersAll.get(k);
      if (!list.includes(o.identifier)) list.push(o.identifier);
    }
  }
  const readersAll = /* @__PURE__ */ new Map();
  for (const o of draft.order) {
    for (const m of listVarMacros(P(o.identifier)?.content || "")) {
      if (m.op !== "get" || !m.name) continue;
      const k = (m.scope === "global" ? "全局:" : "") + m.name;
      if (!readersAll.has(k)) readersAll.set(k, []);
      if (!readersAll.get(k).includes(o.identifier)) readersAll.get(k).push(o.identifier);
    }
  }
  const varKeys = new Set([...a.vars.keys(), ...writersAll.keys()]);
  for (const key of varKeys) {
    const v = { readers: readersAll.get(key) || [] };
    const name = key.replace(/^全局:/, "");
    const cotReaders = v.readers.filter((r) => cotSet.has(r));
    const writers = writersAll.get(key) || [];
    if (!writers.length) continue;
    if (writers.length === 1 && cotReaders.length) perEntry.push(name);
    if (writers.length >= 2) {
      const ops = writers.flatMap((w) => listVarMacros(P(w)?.content || "").filter((m) => m.name === name && (m.op === "set" || m.op === "add") && !isBlankValue(m.value)).map((m) => m.op));
      // 按"这个变量"在每条里扮演的角色分类：整段包裹 / 末尾登记 / 附带的
      const shapes = writers.map((w) => {
        const sh = detectShape(P(w)?.content);
        return sh.varName === name ? sh.shape : "extra";
      });
      const vals = writers.flatMap((w) => listVarMacros(P(w)?.content || "").filter((m) => m.name === name && !isBlankValue(m.value)).map((m) => m.value.trim()));
      const avgLen = vals.length ? vals.reduce((n, x) => n + x.length, 0) / vals.length : 0;
      const op = mostCommon(ops) || "set";
      const wrap = shapes.filter((s) => s === "wrap").length >= writers.length / 2;
      shared.push({ name, writers, op, wrap, names: !wrap && avgLen <= 20, slot: op === "set" && cotReaders.length > 0 && shapes.filter((s) => s === "tagname").length >= writers.length / 2 && avgLen > 20, cotReads: cotReaders.length > 0, readers: v.readers });
    }
  }
  const rank = (x) => x.wrap && x.readers.length && x.readers.every((r) => !draft.isActive(r)) ? 0 : x.wrap ? 1 : x.slot ? 2 : 3;
  shared.sort((x, y) => rank(x) - rank(y) || y.writers.length - x.writers.length);
  const usesGlobal = [...a.vars.keys()].some((k) => k.startsWith("全局:"));
  const initId = findInitEntry(draft);
  // 外层结构区段（<text_style> 这种标签，或 <!-- START: STORY_TONE --> 这种注释分区）
  const wrappers = structureSections(draft, { skip: cotSet }).map((w) => ({ ...w, label: w.comment ? `「${w.name}」分区` : `<${w.name}>` }));
  // 特殊触发
  const depth = active.filter((id) => P(id)?.injection_position === 1);
  const gen = active.filter((id) => (P(id)?.injection_trigger || []).length);
  const cond = active.filter((id) => hasConditional(P(id)?.content || ""));
  const script = active.filter((id) => hasScript(P(id)?.content || ""));
  const random = active.filter((id) => hasRandom(P(id)?.content || ""));
  const regex = (draft.preset.extensions?.regex_scripts || []).filter((r) => !r.disabled);
  const regexPrompt = regex.filter((r) => r.promptOnly || !r.markdownOnly);
  // 用大白话总结
  const lines = [];
  if (cotStyle === "none") lines.push("未识别到开启的思维链。如名称特殊，可在「思维链」页手动指定。");
  else {
    const how = cotStyle === "vars" ? "主要通过变量读取条目（{{getvar}}）" : cotStyle === "text" ? "通过文字提及条目的名称或标签，不读取变量" : "部分通过变量读取，部分通过文字提及";
    lines.push(`思维链 ${a.cotIds.length} 条（${namesOf(draft, a.cotIds, 2)}），${how}。`);
  }
  // 包进变量的：按"由谁统一发出去"合并成一行（小冰块的一键开关）
  const wrapGroups = /* @__PURE__ */ new Map();
  for (const s of shared.filter((x) => x.wrap && !x.slot)) {
    const key = [...s.readers].sort().join("|") || "(无人读)";
    if (!wrapGroups.has(key)) wrapGroups.set(key, { readers: s.readers, vars: [], n: 0, ops: [] });
    const g = wrapGroups.get(key);
    g.vars.push(s.name);
    g.n += s.writers.length;
    g.ops.push(s.op);
  }
  for (const g of [...wrapGroups.values()].sort((x, y) => y.n - x.n).slice(0, 4)) {
    const off = g.readers.length && g.readers.every((r) => !draft.isActive(r));
    const vars = g.vars.slice(0, 4).map((v) => `「${v}」`).join("") + (g.vars.length > 4 ? ` 等 ${g.vars.length} 个变量` : "");
    if (!g.readers.length) lines.push(`${g.n} 条将正文写入 ${vars}，但没有条目读取这些变量，开启后也不会发送。`);
    else lines.push(`${g.n} 条将正文写入 ${vars}，由 ${namesOf(draft, g.readers, 2)} 统一发送${off ? "。该条目目前关闭，这些条目开启后也不会发送" : ""}。`);
  }
  for (const s of shared.filter((x) => x.slot).slice(0, 4)) {
    lines.push(`${s.writers.length} 条向「${s.name}」登记问句（多选一：开启多条时只有最后一条生效），由「${P(s.readers.find((r) => cotSet.has(r)))?.name}」读取。缝合的同类条目按此方式登记。`);
  }
  for (const s of shared.filter((x) => !x.slot && !x.wrap).slice(0, 3)) {
    const who = s.readers.length ? namesOf(draft, s.readers, 1) : "";
    if (s.names) lines.push(`${s.writers.length} 条将名称登记到「${s.name}」（${s.op === "set" ? "多选一：只有最后一条生效" : "可叠加：列出全部开启的条目"}）${who ? `，由 ${who} 读取` : ""}。`);
    else if (s.op === "add" && s.cotReads) lines.push(`${s.writers.length} 条用 addvar 向「${s.name}」追加思维链内容，思维链统一读取。`);
    else lines.push(`${s.writers.length} 条写入同一变量「${s.name}」（${s.op}var）${who ? `，由 ${who} 读取` : ""}。`);
  }
  if (perEntry.length >= 2) lines.push(`部分条目各自登记问句变量，由思维链逐个读取（如 ${perEntry.slice(0, 3).join("、")}）。缝合的条目宜采用相同方式接入。`);
  if (usesGlobal) lines.push("使用全局变量（setglobalvar），切换聊天后仍保留。");
  if (initId) lines.push(`「${P(initId)?.name}」为初始化条目，每轮清空变量。`);
  const mentioned = (w) => a.cotIds.some((c2) => mentionsTag(cotPlainText(P(c2)?.content), w.key)) || a.cotIds.some((c2) => CJK.test(w.name) && cotPlainText(P(c2)?.content).includes(w.name));
  for (const w of wrappers.slice(0, 4)) lines.push(`${w.label} 从「${P(w.openId)?.name}」开始，到「${P(w.closeId)?.name}」结束，其间条目均在其内${a.cotIds.length ? mentioned(w) ? "（思维链提及此区段）" : "（思维链未提及此区段）" : ""}。`);
  const trig = [];
  if (depth.length) trig.push(`${depth.length} 条按深度插入聊天记录`);
  if (gen.length) trig.push(`${gen.length} 条只在特定生成类型下发送`);
  if (cond.length) trig.push(`${cond.length} 条含 {{if}} 条件`);
  if (script.length) trig.push(`${script.length} 条含脚本（如 EJS，需相应插件）`);
  if (random.length) trig.push(`${random.length} 条含随机宏`);
  if (regexPrompt.length) trig.push(`${regexPrompt.length} 条正则会修改发送内容`);
  if (trig.length) lines.push(`特殊生效方式：${trig.join("；")}。`);
  if (!lines.length) lines.push("条目均为正文直写，开启即发送。");
  return { a, cotStyle, perEntry, shared, usesGlobal, initId, wrappers, depth, gen, cond, script, random, regex: regexPrompt, lines };
}

/** 某一条在它自己的预设里是怎么起作用的 */
function describeEntry(draft, id, prof = null) {
  const p = draft.prompt(id);
  if (!p) return { lines: [], cot: null, needsVars: [] };
  const pr = prof || profilePreset(draft);
  const a = pr.a;
  const content = String(p.content || "");
  const s = detectShape(content);
  const lines = [];
  const nm = (x) => draft.prompt(x)?.name || x;
  const readersOf = (name) => (a.vars.get(name)?.readers || []).filter((r) => r !== id);
  const vk = (s.scope === "global" ? "全局:" : "") + (s.varName || "");
  if (!draft.isActive(id)) lines.push("在原预设中处于关闭状态");
  if (s.shape === "wrap") {
    const rs = readersOf(vk);
    lines.push(`正文写入变量「${s.varName}」（${s.op}var），${rs.length ? `由「${nm(rs[0])}」读取后发送` : "原预设中没有条目读取"}`);
  } else if (s.shape === "tagname") {
    const rs = readersOf(vk);
    lines.push(`正文直接发送，末尾将名称登记到「${s.varName}」${rs.length ? `（由「${nm(rs[0])}」读取）` : ""}`);
  } else if (s.shape === "init") lines.push("变量初始化条目，用于清空变量");
  else lines.push("正文直写，开启即发送");
  const extraWrites = listVarMacros(content).filter((m) => m.depth === 0 && (m.op === "set" || m.op === "add") && !isBlankValue(m.value) && m.name !== s.varName);
  for (const m of extraWrites.slice(0, 2)) {
    const rs = readersOf((m.scope === "global" ? "全局:" : "") + m.name);
    lines.push(`另登记变量「${m.name}」${rs.length ? `，由「${nm(rs[0])}」读取` : ""}`);
  }
  if (p.injection_position === 1) lines.push(`插入聊天记录：深度 ${p.injection_depth ?? 4}，角色 ${p.role || "system"}`);
  if ((p.injection_trigger || []).length) lines.push(`只在${p.injection_trigger.map((t) => TRIGGER_NAMES[t] || t).join("、")}时发送`);
  if (hasConditional(content)) lines.push("含 {{if}} 条件，满足条件时才发送相应部分");
  if (hasScript(content)) lines.push("含脚本（如 EJS），需要安装相应插件才能生效");
  if (hasRandom(content)) lines.push("含随机宏，每次发送的内容可能不同");
  const reads = [...new Set(listVarMacros(content).filter((m) => m.op === "get" && m.name).map((m) => (m.scope === "global" ? "全局:" : "") + m.name))];
  const needsVars = reads.filter((k) => (a.vars.get(k)?.writers || []).some((w) => w !== id));
  if (needsVars.length) lines.push(`读取变量 ${needsVars.slice(0, 4).map((k) => `「${k}」`).join("")}，这些变量由其他条目写入`);
  let cov = a.coverage.get(id);
  if (!cov || cov.level === "none") {
    // 关着的条目不在分析范围里，单独看一下：它写的变量有没有思维链读、思维链里有没有提到它
    const cotSet = new Set(a.cotIds);
    for (const m of listVarMacros(content)) {
      if (!m.name || !(m.op === "set" || m.op === "add") || isBlankValue(m.value)) continue;
      const r = (a.vars.get((m.scope === "global" ? "全局:" : "") + m.name)?.readers || []).find((x) => cotSet.has(x));
      if (r) { cov = { level: "var", via: m.name, cot: r }; break; }
    }
    if (!cov || cov.level === "none") {
      const tags = [...exposedTags(content)].filter((t) => !IGNORE_TAGS.has(t));
      const hs = entryHandles(p).filter((h) => h.cjk);
      for (const c2 of a.cot) {
        const t = tags.find((x) => mentionsTag(cotPlainText(draft.prompt(c2.id)?.content), x));
        if (t) { cov = { level: "mention", via: t, cot: c2.id }; break; }
        const txt = cotPlainText(draft.prompt(c2.id)?.content);
        const h = hs.find((x) => txt.includes(x.needle));
        if (h) { cov = { level: "mention", via: h.ref, cot: c2.id }; break; }
      }
    }
  }
  let cot = null;
  if (a.cotIds.includes(id) || isCotEntry(draft, id)) cot = { level: "self", text: "本身是思维链条目" };
  else if (cov && cov.level !== "none") cot = { level: cov.level, text: cov.level === "mention" ? `思维链「${nm(cov.cot)}」中提及（${cov.via}）` : `思维链「${nm(cov.cot)}」通过「${cov.via}」读取` };
  else if (pr.cotStyle !== "none") cot = { level: "none", text: "原预设的思维链未读取或提及" };
  // 在原预设里位于哪个外层标签里
  const pos = draft.order.findIndex((o) => o.identifier === id);
  const inside = pr.wrappers.filter((w) => {
    const i1 = draft.order.findIndex((o) => o.identifier === w.openId);
    const i2 = draft.order.findIndex((o) => o.identifier === w.closeId);
    return i1 < pos && pos < i2;
  }).map((w) => w.name);
  if (inside.length) lines.push(`在原预设中位于 ${inside.map((n) => pr.wrappers.find((w) => w.name === n)?.label || `<${n}>`).join(" / ")} 之内`);
  return { lines, cot, needsVars, inside };
}

/** 缝到目标的某个位置后，会在哪些外层标签里 */
function wrappersAt(draft, prof, idx) {
  return prof.wrappers.filter((w) => {
    const i1 = draft.order.findIndex((o) => o.identifier === w.openId);
    const i2 = draft.order.findIndex((o) => o.identifier === w.closeId);
    return i1 < idx && idx <= i2;
  }).map((w) => w.name);
}
