function mostCommon(list) {
  const m = /* @__PURE__ */ new Map();
  for (const x of list) if (x != null && x !== "") m.set(x, (m.get(x) || 0) + 1);
  let best = null;
  let n = 0;
  for (const [k, v] of m) if (v > n) {
    best = k;
    n = v;
  }
  return best;
}
var HEADER_RE = /^\s*(#{1,4})\s*([A-Za-z_][\w-]*)\s*([：:])\s*(.+)$/;
// [Writing Style: 来点生活] 这种方括号标题（Ariadne）
var BRACKET_RE = /^\s*(\[([A-Za-z\u4e00-\u9fff][A-Za-z\u4e00-\u9fff _-]{0,30}?)\s*([：:])\s*)([^\]\n]{1,40})\]\s*$/;
/** 插入位置所在的最内层区段（标签或注释分区） */
function sectionAt(draft, idx) {
  const secs = structureSections(draft).filter((x) => x.openIdx < idx && idx <= x.closeIdx);
  return secs.sort((a, b) => b.openIdx - a.openIdx)[0] || null;
}
/** 参照范围：分组成员 / 前后几条；如果落在某个区段里，就只看同一区段（Ariadne 没有分组，靠区段区分基调、笔法、氛围） */
function neighborhood(draft, where, groupId, radius = 6) {
  const order = draft.order.map((o) => o.identifier);
  const idx = insertionIndex(draft, where);
  let ids = groupId ? order.filter((id) => draft.groupOf(id) === groupId) : order.slice(Math.max(0, idx - radius), idx + radius);
  const sec = sectionAt(draft, idx);
  if (sec) {
    const inSec = (groupId ? ids : order).filter((id) => {
      const i = order.indexOf(id);
      return i > sec.openIdx && i < sec.closeIdx;
    });
    if (inSec.length >= 2 || !groupId) ids = inSec.length ? inSec : ids;
    if (!groupId && ids.length > radius * 2) ids = [...ids].sort((x, y) => Math.abs(order.indexOf(x) - idx) - Math.abs(order.indexOf(y) - idx)).slice(0, radius * 2);
  }
  return { ids, idx, sec };
}
function referenceIds(draft, where, groupId) {
  const { ids } = neighborhood(draft, where, groupId);
  const region = cotRegion(draft);
  return ids.filter((id) => {
    const p = draft.prompt(id);
    if (!p || draft.isMarker(id)) return false;
    const c2 = String(p.content || "");
    if (c2.trim().length < 20) return false;
    const s = detectShape(c2);
    if (s.shape === "init" || s.shape === "empty") return false;
    if (isCotEntry(draft, id, undefined, region)) return false;
    return true;
  });
}
function inferTarget(draft, where, groupId) {
  return draft.withReadIndex(() => inferTargetIndexed(draft, where, groupId));
}
function inferTargetIndexed(draft, where, groupId) {
  const refIds = referenceIds(draft, where, groupId);
  const shapes = refIds.map((id) => ({ id, s: detectShape(draft.prompt(id).content) }));
  let shape = mostCommon(shapes.map((x) => x.s.shape)) || "plain";
  // 1.2.0：只有至少两条邻居共用同一个变量，才算"大家都写进这个变量"。
  // 像 Ako 那样每条各登记各的问句变量（嬷嬷你、summary…），如果当成共用变量，
  // 缝进来的条目会 setvar 覆盖掉邻居的问句。这种情况按直接写正文处理，再交给"挂进思维链"。
  if (shape === "wrap" || shape === "tagname") {
    const sameShape = shapes.filter((x) => x.s.shape === shape);
    const top = mostCommon(sameShape.map((x) => x.s.varName));
    if (sameShape.filter((x) => x.s.varName === top).length < 2) {
      const rest = shapes.filter((x) => x.s.shape !== "wrap" && x.s.shape !== "tagname");
      shape = rest.length ? mostCommon(rest.map((x) => x.s.shape)) || "plain" : "plain";
      if (shape === "init" || shape === "empty") shape = "plain";
    }
  }
  const same = shapes.filter((x) => x.s.shape === shape);
  const t = { shape, refIds, readerIds: [] };
  if (shape === "wrap" || shape === "tagname") {
    t.varName = mostCommon(same.map((x) => x.s.varName));
    const withVar = same.filter((x) => x.s.varName === t.varName);
    t.op = mostCommon(withVar.map((x) => x.s.op)) || "add";
    t.scope = mostCommon(withVar.map((x) => x.s.scope)) || "local";
    t.sampleId = withVar[0]?.id;
    if (shape === "wrap") t.pad = withVar[0]?.s.pad;
  } else {
    t.sampleId = same[0]?.id;
  }
  const bodies = same.map((x) => x.s.body || "");
  const tags = bodies.map((b) => outerTag(b)).filter(Boolean);
  const topTag = tags.length ? mostCommon(tags.map((x) => x.tag)) : null;
  const topCount = tags.filter((x) => x.tag === topTag).length;
  // 1.3.0：只有至少两条邻居真的用同一个标签（比如都是 <文风：xxx>），才算"统一套这个标签"。
  // 邻居各用各的标签（<人物塑造>、<场景推进>）时，约定是"每条用自己名字的标签包着"，不能把别人的标签套给新条目。
  if (tags.length && tags.length >= bodies.length / 2 && topCount >= 2) {
    const sep = mostCommon(tags.filter((x) => x.tag === topTag).map((x) => x.sep)) || "";
    t.tagTpl = { tag: topTag, sep };
  } else if (tags.length >= 2 && tags.length >= bodies.length / 2) {
    t.ownTag = true;
  } else {
    const heads = bodies.map((b) => HEADER_RE.exec(b.split("\n")[0] || "")).filter(Boolean);
    if (heads.length && heads.length >= bodies.length / 2) {
      const key = mostCommon(heads.map((h) => `${h[1]}|${h[2]}|${h[3]}`));
      const [hashes, word, sep] = key.split("|");
      t.headerTpl = { hashes, word, sep };
    }
  }
  // 单选槽位（好几条 setvar 同一个变量）：新条目要不要加入，得看它是不是同一类——见 planItem 里的 slotAllowed
  if ((shape === "tagname" || shape === "wrap") && t.varName && t.op === "set") {
    const order = draft.order.map((o) => o.identifier);
    const idx = insertionIndex(draft, where);
    const isSep = (id) => {
      const c2 = String(draft.prompt(id)?.content || "");
      return String(detectShape(c2).body || c2).replace(/\{\{[^{}]*\}\}/g, "").replace(/<[^>\n]*>/g, "").trim().length < 20;
    };
    const inSlot = (id) => {
      const s2 = detectShape(draft.prompt(id)?.content);
      return s2.shape === shape && s2.varName === t.varName;
    };
    let prev = null, next = null;
    for (let i = idx - 1; i >= 0; i--) if (!isSep(order[i])) { prev = order[i]; break; }
    for (let i = idx; i < order.length; i++) if (!isSep(order[i])) { next = order[i]; break; }
    t.slot = { varName: t.varName, shape, between: !!(prev && next && inSlot(prev) && inSlot(next)), section: neighborhood(draft, where, groupId).sec?.key || null };
  }
  // 登记的是一句问句、而且问句里带着各自的名字（Ariadne：- 以[Writing Style: 来点生活]为核心文风…）→ 记下模板，新条目照样换名字
  if (shape === "tagname" && t.varName) {
    const tpls = [];
    for (const x of same.filter((y) => y.s.varName === t.varName)) {
      const lab = x.s.label || "";
      if (lab.length < 12) continue;
      const nm = slotName(draft.prompt(x.id)?.name);
      if (nm && lab.includes(nm)) tpls.push(lab.split(nm).join("{名字}"));
    }
    const tpl = mostCommon(tpls);
    if (tpl && tpls.filter((x) => x === tpl).length >= 2) t.labelTpl = tpl;
  }
  if (!t.tagTpl && !t.headerTpl && !t.ownTag) {
    const allBodies = shapes.map((x) => x.s.body || "");
    const bs = allBodies.map((b) => BRACKET_RE.exec(String(b).trim().split("\n")[0] || "")).filter(Boolean);
    if (bs.length >= 2 && bs.length >= allBodies.length / 2) {
      const word = mostCommon(bs.map((m) => m[2]));
      const m0 = bs.find((m) => m[2] === word);
      t.headerTpl = { kind: "bracket", word, prefix: m0[1] };
    }
  }
  if (t.varName) {
    const key = t.varName;
    for (const id of draft.order.map((o) => o.identifier)) {
      const ms = listVarMacros(draft.prompt(id)?.content || "");
      if (ms.some((m) => m.name === key && m.op === "set" && isBlankValue(m.value))) {
        t.initId = t.initId || id;
        t.varInitialized = true;
      }
      if (ms.some((m) => m.name === key && m.op === "get")) t.readerIds.push(id);
    }
    // 读它的条目全都关着（小冰块的「小剧场一键开关」）：包进这个变量的内容根本发不出去
    t.readersOff = t.readerIds.length > 0 && t.readerIds.every((id) => !draft.isActive(id));
    t.readerNames = Object.fromEntries(t.readerIds.map((id) => [id, draft.prompt(id)?.name || id]));
    if (!t.initId) t.initId = findInitEntry(draft);
  }
  t.summary = describeTarget(t);
  return t;
}
function findInitEntry(draft) {
  // 初始化条目：几乎全是 {{setvar::x::}} 空赋值。允许夹少量带默认值的（比如 Ako 的 nsfwplots）
  let best = null;
  let n = 0;
  for (const o of draft.order) {
    if (o.enabled === false) continue;
    const text = String(draft.prompt(o.identifier)?.content || "");
    const tops = scanTopMacros(text);
    let outside = "";
    let last = 0;
    for (const t of tops) {
      outside += text.slice(last, t.start);
      last = t.end;
    }
    outside += text.slice(last);
    if (outside.trim()) continue;
    const sets = tops.map((t) => parseVarMacro(t.inner)).filter((v) => v && v.op === "set");
    const blank = sets.filter((v) => isBlankValue(v.value)).length;
    if (blank >= 2 && blank >= sets.length * 0.8 && blank > n) {
      best = o.identifier;
      n = blank;
    }
  }
  return best;
}
function describeTarget(t) {
  if (t.shape === "wrap") return `正文写入变量「${t.varName}」（${t.op === "set" ? "多选一" : "可叠加"}）`;
  if (t.shape === "tagname") return `正文直写，末尾将名称登记到变量「${t.varName}」`;
  return "正文直写，不使用变量";
}
/** 名字可能的几种写法（从短到长都试）：♥︎ 填充-激烈性爱 → 激烈性爱 / 填充-激烈性爱 */
function nameParts(name) {
  const c2 = cleanLabel(name || "");
  const parts = c2.split(/[·・:：|｜\-—]/).map((x) => x.trim()).filter(Boolean);
  return [...new Set([parts[parts.length - 1], slotName(name), c2].filter((x) => x && x.length >= 2))];
}
/** 照着邻居登记的内容换成自己的名字：邻居 "- 以[Writing Style: 来点生活]为核心…" → "- 以[Writing Style: 英伦锦叙]为核心…" */
function mimicValue(value, neighborName, myName) {
  const v = String(value || "");
  const mine = nameParts(myName)[0] || cleanLabel(myName);
  for (const c2 of nameParts(neighborName).sort((a, b) => b.length - a.length)) if (v.includes(c2)) return v.split(c2).join(mine);
  return null;
}
function neighborValue(draft, id, varName, op) {
  return listVarMacros(draft.prompt(id)?.content || "").filter((m) => m.name === varName && (!op || m.op === op) && !isBlankValue(m.value)).pop()?.value ?? null;
}
/** 条目名里真正的"名字"部分：│📝笔法·来点生活 → 来点生活；🍂英伦锦叙（短）→ 英伦锦叙 */
function slotName(name) {
  const c2 = cleanLabel(name || "");
  const parts = c2.split(/[·・:：|｜]/).map((x) => x.trim()).filter(Boolean);
  return (parts[parts.length - 1] || c2).trim();
}
function addHeader(body, tpl, label) {
  if (tpl.kind === "bracket") {
    const lines2 = String(body).trim().split("\n");
    // 开头的分隔线（---）和空行先拿掉，再看第一行是不是已经有标题（[名字]、[X: 名字]、# x: 名字）
    while (lines2.length && /^\s*(-{3,}|\*{3,}|={3,})?\s*$/.test(lines2[0])) lines2.shift();
    const head = `${tpl.prefix}${label}]`;
    if (BRACKET_RE.test(lines2[0] || "") || HEADER_RE.test(lines2[0] || "") || /^\s*\[[^\]\n]{1,40}\]\s*$/.test(lines2[0] || "")) lines2[0] = head;
    else lines2.unshift(head);
    return lines2.join("\n");
  }
  const lines = String(body).split("\n");
  if (BRACKET_RE.test(lines[0] || "")) lines.shift();
  if (HEADER_RE.test(lines[0] || "")) {
    lines[0] = `${tpl.hashes} ${tpl.word}${tpl.sep} ${label}`;
    return lines.join("\n");
  }
  return `${tpl.hashes} ${tpl.word}${tpl.sep} ${label}
${body}`;
}
// 1.2.0：用大白话说清楚"来源怎么写的 → 目标要怎么写 → 我改了什么"
function opText(op) {
  return op === "set" ? "多选一的写法（开启多条时只有最后一条生效）" : "可叠加的写法（开启的条目依次拼接）";
}
function explainConversion(s, want) {
  const from = s.shape === "init" || s.shape === "empty" ? "plain" : s.shape;
  const to = want.shape;
  const out = [];
  if (from === "plain" && to === "plain") out.push("来源和目标均为正文直写，正文原样保留，开启即发送");
  else if (from === "plain" && to === "wrap") out.push(`来源为正文直写，目标将正文写入变量「${want.varName}」，使用 ${opText(want.op)}。已按目标调整`);
  else if (from === "plain" && to === "tagname") out.push(`来源为正文直写，目标在正文末尾将名称登记到变量「${want.varName}」。已添加登记`);
  else if (from === "wrap" && to === "plain") out.push(`来源将正文写入变量「${s.varName}」（需有条目用 getvar 读取才会发送），目标为正文直写。已去掉外层包裹，只保留正文`);
  else if (from === "wrap" && to === "wrap") {
    if (s.varName === want.varName && s.op === want.op) out.push(`来源与目标相同，均写入变量「${want.varName}」，正文不变`);
    else out.push(`来源写入「${s.varName}」（${s.op}var），目标写入「${want.varName}」，使用 ${opText(want.op)}。已改为目标的变量和写法`);
  } else if (from === "tagname" && to === "plain") out.push(`来源在正文末尾将名称登记到「${s.varName}」（供来源预设的思维链读取），目标为正文直写。已去掉这行登记`);
  else if (from === "tagname" && to === "tagname") out.push(s.varName === want.varName ? `来源与目标写法相同，名称登记到「${want.varName}」` : `来源将名称登记到「${s.varName}」，目标登记到「${want.varName}」。已调整`);
  else if (from === "tagname" && to === "wrap") out.push(`来源为正文直写并登记名称，目标将正文写入变量「${want.varName}」，使用 ${opText(want.op)}。已调整`);
  else if (from === "wrap" && to === "tagname") out.push(`来源将正文写入「${s.varName}」，目标为正文直写，末尾将名称登记到「${want.varName}」。已调整`);
  else out.push(`写法：${SHAPE_LABEL[from] || from} → ${SHAPE_LABEL[to] || to}`);
  if ((to === "wrap" || to === "tagname") && s.op === "add" && want.op === "set") {
    out.push("注意：来源的写法可以和其他条目叠加；目标是多选一，同时开启多条时只有最后一条生效。需要叠加时，请在「高级」中把写入方式改为「可叠加」");
  }
  return out;
}
function draft0Name(target, id) {
  return target.readerNames?.[id] || id;
}
function planItem(src, target, choice = {}) {
  const s = detectShape(src.content);
  // 单选槽位守卫：加入槽位 = 开它就会顶替同类里开着的那一条。只有"明显是同一类"才自动加入：
  // 夹在同一槽位的两条中间，或者它在来源里就待在同名区段（WRITING_STYLE ↔ <Writing_Style>）
  const normKey = (k) => String(k || "").toLowerCase().replace(/[\s_\-·]/g, "");
  const slotAllowed = !target.slot || choice.shape === target.slot.shape || target.slot.between || !!target.slot.section && (src.sections || []).some((k) => normKey(k) === normKey(target.slot.section));
  const targetShape = !slotAllowed && !choice.shape ? "plain" : target.shape;
  const usesTpl = target.labelTpl && (choice.shape || targetShape) === "tagname";
  // 短名字：用于标签/标题/模板；label：最终登记进变量的内容（有模板时是一句问句）
  const regLike = (choice.shape || targetShape) === "tagname" && !target.labelTpl;
  // 登记名字的写法：来源自己登记的是短名字就沿用，登记的是一整句问句（Ako/Ariadne）就用条目名
  const shortName = (choice.label ?? (regLike && s.label && s.label.trim().length <= 20 ? s.label : slotName(src.name))).trim();
  const label = usesTpl ? target.labelTpl.split("{名字}").join(shortName) : shortName;
  const want = {
    shape: choice.shape || targetShape,
    varName: choice.varName ?? target.varName,
    op: choice.op || target.op || "add",
    scope: target.scope || "local",
    pad: target.pad
  };
  if ((want.shape === "wrap" || want.shape === "tagname") && !want.varName) want.shape = "plain";
  let body = s.shape === "init" || s.shape === "empty" ? String(src.content || "") : s.body;
  const notes = [];
  const changes = []; // 给预览卡片用的简短改动说明
  const hasOwnTag = !!outerTag(body);
  const canTag = !!(target.tagTpl || target.headerTpl && (target.headerTpl.kind !== "bracket" || slotAllowed) || target.ownTag);
  const ownBodyTag = /^\s*<([^>\/\n!]{1,30})>[\s\S]*<\/\1>\s*$/.test(body);
  const useTag = choice.useTag ?? (canTag && (target.ownTag ? !ownBodyTag : !hasOwnTag || target.tagTpl && outerTag(body)?.tag !== target.tagTpl.tag));
  if (useTag && target.ownTag) {
    const tagName = cleanLabel(shortName) || shortName;
    if (!ownBodyTag && tagName) {
      body = `<${tagName}>
${String(body).trim()}
</${tagName}>`;
      notes.push(`目标的每条正文都用以自身名称命名的标签包裹，已添加 <${tagName}>`);
      changes.push(`添加标签 <${tagName}>`);
    }
  } else if (useTag && target.tagTpl) {
    body = applyOuterTag(body, target.tagTpl, shortName);
    notes.push(`外层添加目标使用的标签 <${target.tagTpl.tag}${target.tagTpl.sep}${shortName}>`);
    changes.push(`添加标签 <${target.tagTpl.tag}${target.tagTpl.sep}${shortName}>`);
  } else if (useTag && target.headerTpl?.kind === "bracket") {
    body = addHeader(body, target.headerTpl, shortName);
    notes.push(`开头采用目标同类条目的标题格式：「${target.headerTpl.prefix}${shortName}]」`);
    changes.push(`开头标题：${target.headerTpl.prefix}${shortName}]`);
  } else if (useTag && target.headerTpl) {
    body = addHeader(body, target.headerTpl, shortName);
    notes.push(`开头采用目标同类条目的标题格式：「${target.headerTpl.hashes} ${target.headerTpl.word}${target.headerTpl.sep} ${shortName}」`);
    changes.push(`开头标题：${target.headerTpl.hashes} ${target.headerTpl.word}${target.headerTpl.sep} ${shortName}`);
  }
  if (target.slot && want.varName === target.slot.varName && want.shape === target.slot.shape) {
    changes.push(`加入多选一「${target.slot.varName}」：开启后替换同类中已开启的一条`);
  }
  if (target.slot && !slotAllowed && !choice.shape) {
    notes.push(`附近是多选一「${target.slot.varName}」（开启多条时只有一条生效）。此条目与它们不属同类，未加入，以免替换已选项。如属同类，可在「高级」中调整写法`);
  }
  const keepExtras = choice.keepExtras ?? false;
  const extras = keepExtras ? s.extras || [] : [];
  if ((s.extras || []).length && !keepExtras) {
    notes.push(`未保留来源中的 ${s.extras.length} 个附加宏（如来源自带的思维链片段）`);
    changes.push(`去掉 ${s.extras.length} 个附加宏`);
  }
  {
    const from = s.shape === "init" || s.shape === "empty" ? "plain" : s.shape;
    const to = want.shape;
    const short = (x) => (x = String(x || "").trim(), x.length > 26 ? x.slice(0, 26) + "…" : x);
    if (from === "wrap" && (to !== "wrap" || s.varName !== want.varName || s.op !== want.op)) changes.unshift(`去掉外层 {{${s.op}var::${s.varName}::…}}`);
    if (from === "tagname" && (to !== "tagname" || s.varName !== want.varName)) changes.unshift(`去掉末尾 {{${s.op}var::${s.varName}::…}}`);
    if (to === "wrap" && (from !== "wrap" || s.varName !== want.varName || s.op !== want.op)) changes.push(`写入 {{${want.op}var::${want.varName}::…}}`);
    if (to === "tagname" && (from !== "tagname" || s.varName !== want.varName || s.label !== label)) changes.push(`末尾登记 {{${want.op}var::${want.varName}::${short(label)}}}`);
  }
  const content = buildContent(body, want, { label, extras });
  if (want.shape === "tagname" && target.labelTpl) {
    notes.unshift(`目标的同类条目向变量「${want.varName}」登记问句（${want.op === "set" ? "多选一：开启多条时只有最后一条生效" : "可叠加：开启的条目依次拼接"}），由思维链读取。已按此登记：${label}`);
  } else notes.unshift(...explainConversion(s, want));
  const warnings = [];
  if (want.varName && (want.shape === "wrap" || want.shape === "tagname")) {
    if (!target.readerIds.length && want.varName === target.varName) warnings.push(`目标中没有条目读取「${want.varName}」，缝合后可能不生效`);
    if (want.varName !== target.varName) warnings.push(`已改用新变量「${want.varName}」，需有条目用 {{getvar::${want.varName}}} 读取`);
    if (want.varName === target.varName && target.readersOff) warnings.push(`读取「${want.varName}」的「${target.readerIds.map((id) => draft0Name(target, id)).join("」「")}」未开启，开启后此条目才会发送`);
  }
  return { content, label: shortName, question: label, sourceShape: s, want, notes, changes, warnings, slotAllowed };
}
function buildPrompt(draft, src, plan, target, { keepSourceInjection = false } = {}) {
  const ref = target.sampleId ? draft.prompt(target.sampleId) : null;
  const base = keepSourceInjection || !ref ? src.prompt || {} : ref;
  return {
    name: src.name,
    system_prompt: false,
    role: base.role || src.prompt?.role || "system",
    content: plan.content,
    injection_position: base.injection_position ?? 0,
    injection_depth: base.injection_depth ?? 4,
    injection_order: base.injection_order ?? 100,
    injection_trigger: Array.isArray(base.injection_trigger) ? [...base.injection_trigger] : [],
    forbid_overrides: false,
    marker: false
  };
}
function ensureInit(draft, varName, initId, scope = "local") {
  if (!varName || !initId) return false;
  const p = draft.prompt(initId);
  if (!p) return false;
  const has = listVarMacros(p.content || "").some((m) => m.name === varName && m.op === "set" && m.scope === scope);
  if (has) return false;
  const c0 = String(p.content || "");
  p.content = c0 + (c0 && !/\n\s*$/.test(c0) ? "\n" : "") + `{{set${scope === "global" ? "global" : ""}var::${varName}::}}`;
  return true;
}

// ---------- 1.2.0：挂进思维链 ----------
// 缝进来的条目，如果思维链读不到它，模型想的时候就不会专门去想这一条（看起来就像"没生效"）。
// 像 Ako 这类预设的做法是：条目末尾登记一个问句变量 → 初始化条目每轮清空 → 思维链里 getvar 读出来。
// 这里按目标预设自己的习惯，自动做这三步。
var VAR_KEY = (m) => (m.scope === "global" ? "全局:" : "") + m.name;
function allVarNames(draft) {
  const s = /* @__PURE__ */ new Set();
  for (const p of draft.preset.prompts) for (const m of listVarMacros(p.content || "")) if (m.name) s.add(m.name);
  return s;
}
function hookVarName(label, used) {
  const base = String(label || "").replace(/[{}:：\s<>\[\]|｜"'`\/\\·・╓╖╙╜║═—]/g, "").slice(0, 12) || "缝合条目";
  let name = base;
  let i = 2;
  while (used.has(name)) name = base + i++;
  return name;
}
function insertionIndex(draft, where) {
  const order = draft.order.map((o) => o.identifier);
  if (where.after) {
    const i = order.indexOf(where.after);
    return i < 0 ? order.length : i + 1;
  }
  if (where.before) {
    const i = order.indexOf(where.before);
    return i < 0 ? order.length : i;
  }
  if (where.groupEnd) {
    let last = -1;
    order.forEach((id, i) => {
      if (draft.groupOf(id) === where.groupEnd) last = i;
    });
    return last < 0 ? order.length : last + 1;
  }
  if (where.groupStart) {
    const i = order.findIndex((id) => draft.groupOf(id) === where.groupStart);
    return i < 0 ? order.length : i;
  }
  if (typeof where.index === "number") return where.index;
  return order.length;
}
function enclosingTagsAt(draft, idx, cotSet, skipId) {
  const skip = new Set(cotSet);
  if (skipId) skip.add(skipId);
  return structureSections(draft, { skip }).filter((x) => x.openIdx < idx && idx <= x.closeIdx).sort((a, b) => a.openIdx - b.openIdx);
}
function looksLikeQuestion(v) {
  const s = String(v || "").trim();
  return s.length > 0 && s.length <= 240 && s.split("\n").length <= 4;
}
function lineAround(text, needle) {
  const i = text.indexOf(needle);
  if (i < 0) return null;
  const ls = text.lastIndexOf("\n", i) + 1;
  let le = text.indexOf("\n", i);
  if (le < 0) le = text.length;
  const line = text.slice(ls, le);
  let prefix = (/^(\s*(?:[-*•·]|\d+[.、)]|[①-⑳])?\s*)/.exec(line) || ["", ""])[1];
  if (/\d|[①-⑳]/.test(prefix)) prefix = prefix.replace(/\S.*$/, "") + "- ";
  if (!prefix.trim() && /^#/.test(line.trim())) prefix = "- ";
  return { ls, le, line, prefix };
}
/** 思维链里"下一步"的写法：## Phase 11. → ## Phase 12.；1. → 2.；- → - */
function nextStep(text) {
  const lines = String(text || "").split("\n").map((l) => l.replace(/\s+$/, "")).filter((l) => l.trim() && !/^\s*<\/?[^>]+>\s*$/.test(l));
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    let m = /^(\s*#+\s*(?:Phase|Step|STEP|步骤)\s*)(\d+)(\s*[.、:：]\s*)/.exec(l);
    if (m) return { prefix: `${m[1]}${Number(m[2]) + 1}${m[3]}` };
    m = /^(\s*)(\d+)([.、)]\s*)/.exec(l);
    if (m) return { prefix: `${m[1]}${Number(m[2]) + 1}${m[3]}` };
    m = /^(\s*[-*•·]\s+)/.exec(l);
    if (m) return { prefix: m[1] };
  }
  return null;
}
function mainCotOf(draft, cotIds) {
  // 正文最长、不是"开始/结束"这种短壳子的那条
  return [...cotIds].sort((x, y) => String(draft.prompt(y)?.content || "").length - String(draft.prompt(x)?.content || "").length)[0];
}
/**
 * 判断一条（将要）放在 where 的条目会不会被思维链读到；读不到就给出挂法。
 * 三种挂法，跟着目标预设自己的习惯走：
 *   own    —— 条目登记自己的问句变量，思维链 getvar 读（Ako 这类）
 *   append —— 附近条目都 addvar 往同一个汇总变量里追加片段，照样追加
 *   text   —— 目标思维链不读变量、靠文字点名，就在思维链里提到邻居的那一行后面加一行点名
 * @param item {content, label, name, selfId?}
 * @param opts.srcCot 来源预设里，这条是否被思维链读到/提到（决定默认要不要挂）
 */
function planHook(draft, where, gid, item, options = {}) {
  return draft.withReadIndex(() => planHookIndexed(draft, where, gid, item, options));
}
function planHookIndexed(draft, where, gid, item, { taken = /* @__PURE__ */ new Set(), varName: wantVar, question: wantQ, srcCot = null, allowSlot = true, collector = null, analysis = null } = {}) {
  const content = String(item.content || "");
  const bodyText = String(detectShape(content).body || content).replace(/\{\{[^{}]*\}\}/g, "");
  if (bodyText.trim().length < 20) return { status: "skip", on: false, text: "内容过短（分隔或开关条目），无需接入" };
  if (COT_NAME.test(item.name || "") || COT_BODY.test(content)) return { status: "cot", on: false, text: "本身是思维链片段，无需接入" };
  const a = analysis || analyze(draft);
  const cotSet = new Set(a.cotIds);
  const cotIds = a.cotIds.filter((id) => id !== item.selfId);
  if (!cotIds.length) return { status: "nocot", on: false, text: "目标中未识别到开启的思维链。如名称特殊，可在「思维链」页手动指定后再缝合" };
  const varCots = cotIds.filter((id) => listVarMacros(draft.prompt(id)?.content || "").some((m) => m.op === "get" && m.name));
  const order = draft.order.map((o) => o.identifier);
  const idx = insertionIndex(draft, where);
  // 酒馆按条目顺序处理变量宏：写变量的条目排在读它的思维链后面时，思维链读到的是上一轮的值
  const lateWarn = (cid) => {
    const ci = order.indexOf(cid);
    if (ci < 0 || idx <= ci) return null;
    return `条目排在「${draft.prompt(cid)?.name || cid}」之后。酒馆按条目顺序处理变量，思维链读到的会是上一轮的内容，请把条目放到思维链前面`;
  };
  const before = order.slice(0, idx).filter((id) => id !== item.selfId && draft.isActive(id));
  const after = order.slice(idx).filter((id) => id !== item.selfId && draft.isActive(id));
  if (before.length && after.length && cotSet.has(before[before.length - 1]) && cotSet.has(after[0])) {
    return { status: "cot", on: false, text: "位于思维链之内，属于思维链的一部分" };
  }
  // ---- 已经能被读到/提到？
  const writes = listVarMacros(content).filter((m) => m.depth === 0 && m.name && (m.op === "set" || m.op === "add") && !isBlankValue(m.value));
  for (const m of writes) {
    const r = (a.vars.get(VAR_KEY(m))?.readers || []).find((x) => cotSet.has(x) && x !== item.selfId);
    if (r) return { status: "covered", on: false, text: `已通过变量「${m.name}」由「${draft.prompt(r)?.name}」读取，无需接入` };
  }
  const mentions = /* @__PURE__ */ new Map();
  for (const c2 of a.cot) mentions.set(c2.id, new Set(c2.mentions));
  const tags = [...exposedTags(content)].filter((t) => !IGNORE_TAGS.has(t));
  for (const [cid] of mentions) {
    if (cid === item.selfId) continue;
    const hit = tags.find((t) => mentionsTag(cotPlainText(draft.prompt(cid)?.content), t));
    if (hit) return { status: "mention", on: false, text: `思维链「${draft.prompt(cid)?.name}」已提及 <${hit}>` };
  }
  const myHandles = entryHandles({ name: item.name, content }).filter((h) => h.cjk);
  for (const cid of cotIds) {
    const t = cotPlainText(draft.prompt(cid)?.content);
    const h = myHandles.find((x) => t.includes(x.needle));
    if (h) return { status: "mention", on: false, text: `思维链「${draft.prompt(cid)?.name}」已提及 ${h.ref}` };
  }
  const outer = enclosingTagsAt(draft, idx, cotSet, item.selfId).filter((t) => !IGNORE_TAGS.has(t.key));
  const secLabel = (w) => w.comment ? `「${w.name}」分区` : `<${w.name}>`;
  for (let i = outer.length - 1; i >= 0; i--) {
    for (const [cid] of mentions) {
      if (cid === item.selfId) continue;
      if (mentionsTag(cotPlainText(draft.prompt(cid)?.content), outer[i].key) || CJK.test(outer[i].name) && cotPlainText(draft.prompt(cid)?.content).includes(outer[i].name)) return { status: "mention", on: false, text: `位于 ${secLabel(outer[i])} 之内，思维链「${draft.prompt(cid)?.name}」已提及此区段，无需接入` };
    }
  }
  // ---- 找挂的位置：离得最近、已经和思维链连上的邻居
  const near = neighborhood(draft, where, gid, 10).ids.filter((id) => id !== item.selfId && !cotSet.has(id));
  const dist = (id) => Math.abs(order.indexOf(id) - idx);
  near.sort((x, y) => dist(x) - dist(y));
  let pick = null;
  for (const n of near) {
    for (const m of listVarMacros(draft.prompt(n)?.content || "")) {
      if (!m.name || !(m.op === "set" || m.op === "add") || isBlankValue(m.value)) continue;
      const cots = (a.vars.get(VAR_KEY(m))?.readers || []).filter((r) => cotSet.has(r) && varCots.includes(r));
      if (cots.length) {
        pick = { kind: "var", cotId: cots[0], anchorVar: m.name, neighbor: n, op: m.op, scope: m.scope, lead: /^\s*/.exec(m.value || "")[0] };
        break;
      }
    }
    if (pick) break;
    for (const h of entryHandles(draft.prompt(n)).filter((x) => x.cjk)) {
      const cid = cotIds.find((c2) => cotPlainText(draft.prompt(c2)?.content).includes(h.needle));
      if (cid) {
        pick = { kind: "text", cotId: cid, needle: h.needle, neighbor: n, ref: h.ref };
        break;
      }
    }
    if (pick) break;
  }
  const neighborHooked = !!pick;
  // ---- 问句：优先用来源自带的（末尾那句目标里没人读的问句），没有就生成一句
  const used = /* @__PURE__ */ new Set(taken);
  for (const p of draft.preset.prompts) {
    if (p.identifier === item.selfId) continue;
    for (const m of listVarMacros(p.content || "")) if (m.name) used.add(m.name);
  }
  let reuse = null;
  for (const m of [...writes].reverse()) {
    const readAnywhere = draft.preset.prompts.some((p) => p.identifier !== item.selfId && listVarMacros(p.content || "").some((x) => x.op === "get" && x.name === m.name));
    const isWholeBody = content.slice(0, m.start).trim() === "" && content.slice(m.end).trim() === "";
    if (!readAnywhere && !isWholeBody && looksLikeQuestion(m.value)) {
      reuse = m;
      break;
    }
  }
  const myRef = entryHandles({ name: item.name, content })[0]?.ref || (() => {
    const ot = outerTag(detectShape(content).body || content);
    return ot ? `<${ot.tag}>` : `「${item.label || cleanLabel(item.name) || shortLabel(item.name)}」`;
  })();
  // 包进变量、由「一键开关」这类条目统一发出去的（小冰块的小剧场），思维链一般不用专门想它
  const wantOn = !collector && (neighborHooked || !!reuse || !!srcCot);
  const why = srcCot ? "在原预设中由思维链读取或提及。" : "";
  const offHint = wantOn ? "" : collector ? `由「${collector}」统一发送，通常无需接入，默认不勾选` : "附近条目均未接入思维链，默认不勾选。需要模型重点考虑时再勾选";
  const common = { status: "hook", on: wantOn, neighborHooked, srcCot: !!srcCot, removeRange: reuse ? [reuse.start, reuse.end] : null, offHint };
  // ---- 目标思维链靠文字点名
  if (pick?.kind === "text" || !pick && !varCots.length) {
    const cotId = pick?.cotId || mainCotOf(draft, cotIds);
    const cot = String(draft.prompt(cotId)?.content || "");
    const cotName = draft.prompt(cotId)?.name || cotId;
    const info = pick ? lineAround(cot, pick.needle) : null;
    // 没有点到邻居、但落在一个思维链没提到的区段里（众生相的 STORY_TONE）：点名整个区段，以后这个区段里的条目都会被想到
    const sec = !pick ? outer[outer.length - 1] : null;
    const ref = sec ? sec.name : myRef;
    const question = wantQ ?? (reuse ? reuse.value.trim() : sec ? `如何落实 ${sec.name} 中开启的内容？具体体现在哪里？` : `${myRef}：本段如何落实？具体体现在哪里？`);
    const step = info ? null : nextStep(cot);
    const prefix = info?.prefix ?? step?.prefix ?? "- ";
    const cotList = pick ? cotVersionsMentioning(draft, pick.needle, cotId) : [cotId];
    return {
      ...common, mode: "text", cotId, cotIds: cotList, needle: pick?.needle || null, prefix, question, line: prefix + question.replace(/\n+/g, " "), varName: null, section: sec?.name || null,
      on: common.on || !!sec && !!srcCot,
      text: pick
        ? `${why}目标的思维链通过文字提及条目，不读取变量。「${cotName}」提及了附近的 ${pick.ref}，在该行之后同样提及此条目${cotList.length > 1 ? `（${cotList.length} 个思维链版本同时添加）` : ""}`
        : sec
          ? `${why}目标的思维链通过文字提及条目，但未提及 ${secLabel(sec)}。可在「${cotName}」中添加一步提及整个区段，区段内开启的条目均会被考虑`
          : `${why}目标的思维链通过文字提及条目，附近条目也未被提及。可在「${cotName}」末尾添加一行提及`
    };
  }
  // ---- 目标思维链读变量
  if (!pick) {
    const count = (id) => listVarMacros(draft.prompt(id)?.content || "").filter((m) => m.op === "get").length;
    pick = { kind: "var", cotId: [...varCots].sort((x, y) => count(y) - count(x))[0], anchorVar: null, neighbor: null, scope: "local" };
  }
  const question = wantQ ?? (reuse ? reuse.value.trim() : `### 根据${myRef}，本段如何落实？具体体现在哪里？`);
  const cotName = draft.prompt(pick.cotId)?.name || pick.cotId;
  const anchorKey = (pick.scope === "global" ? "全局:" : "") + pick.anchorVar;
  const anchorWriters = pick.anchorVar ? [...new Set([...(a.vars.get(anchorKey)?.writers || []), ...draft.order.map((o) => o.identifier).filter((id) => listVarMacros(draft.prompt(id)?.content || "").some((m) => m.name === pick.anchorVar && (m.op === "set" || m.op === "add") && !isBlankValue(m.value)))])] : [];
  // 单选槽位：附近好几条都 setvar 同一个变量（Ariadne 的 叙事风格1），新条目也登记进这个槽位，照邻居的问句换个名字
  if (pick.op === "set" && anchorWriters.length >= 2 && !wantVar && allowSlot) {
    const mim = mimicValue(neighborValue(draft, pick.neighbor, pick.anchorVar, "set"), draft.prompt(pick.neighbor)?.name, item.name);
    const q2 = wantQ ?? (reuse ? reuse.value.trim() : mim != null ? mim.trim() : question);
    const late = lateWarn(pick.cotId);
    return {
      ...common, on: common.on && !late, warns: late ? [late] : [], clash: false, mode: "slot", cotId: pick.cotId, anchorVar: pick.anchorVar, varName: pick.anchorVar, scope: pick.scope, question: q2,
      text: `${why}附近 ${anchorWriters.length} 条向变量「${pick.anchorVar}」登记问句（多选一：开启多条时只有最后一条生效），由「${cotName}」读取。按此登记`
    };
  }
  if (pick.op === "add" && anchorWriters.length >= 2 && !wantVar) {
    const raw = neighborValue(draft, pick.neighbor, pick.anchorVar, "add");
    const mim = wantQ == null && !reuse ? mimicValue(raw, draft.prompt(pick.neighbor)?.name, item.name) : null;
    const late = lateWarn(pick.cotId);
    return {
      ...common, on: common.on && !late, warns: late ? [late] : [], clash: false, mode: "append", cotId: pick.cotId, anchorVar: pick.anchorVar, varName: pick.anchorVar, scope: pick.scope, lead: mim != null ? "" : pick.lead, question: mim != null ? mim : question,
      text: `${why}附近 ${anchorWriters.length} 条用 addvar 向变量「${pick.anchorVar}」追加思维链内容，由「${cotName}」统一读取。按此追加一句`
    };
  }
  // 邻居的变量是编号的（修复模式1…17），新变量接着编号
  let numbered = null;
  const nm = /^(.*?\D)(\d+)$/.exec(pick.anchorVar || "");
  if (nm) {
    let max = 0, n = 0;
    for (const u of used) {
      const m2 = u.startsWith(nm[1]) && /^\d+$/.test(u.slice(nm[1].length)) ? Number(u.slice(nm[1].length)) : null;
      if (m2 != null) { max = Math.max(max, m2); n++; }
    }
    if (n >= 2) numbered = nm[1] + (max + 1);
  }
  const varName = wantVar || (reuse && !used.has(reuse.name) ? reuse.name : numbered || hookVarName(item.label || cleanLabel(item.name) || shortLabel(item.name), used));
  const clash = !!wantVar && used.has(wantVar) && !(reuse && reuse.name === wantVar);
  const ownMim = wantQ == null && !reuse && pick.anchorVar ? mimicValue(neighborValue(draft, pick.neighbor, pick.anchorVar), draft.prompt(pick.neighbor)?.name, item.name) : null;
  // 思维链有好几个"选一"版本、都读同一组变量时（V2.61），每个版本都加上，换版本也不会丢
  const cotList = pick.anchorVar ? cotVersionsReading(draft, pick.anchorVar, pick.cotId) : [pick.cotId];
  const warns = [];
  const late = lateWarn(pick.cotId);
  if (late) warns.push(late);
  if (!findInitEntry(draft)) warns.push("预设里没有每轮清空变量的初始化条目，问句变量不会被清空：之后关掉这条，思维链里仍会一直出现它的问句");
  return {
    ...common, on: common.on && !late, warns, clash, mode: "own", cotIds: cotList, scope: pick.anchorVar ? pick.scope : "local", cotId: pick.cotId, anchorVar: pick.anchorVar, varName, question: ownMim != null ? ownMim.trim() : question,
    text: pick.anchorVar
      ? `${why}思维链无法读取此条目。附近的「${draft.prompt(pick.neighbor)?.name}」通过变量「${pick.anchorVar}」由「${cotName}」读取，按相同方式接入${cotList.length > 1 ? `（${cotList.length} 个思维链版本同时添加）` : ""}`
      : `${why}思维链无法读取此条目，附近条目也未接入思维链。可接入读取变量最多的「${cotName}」`
  };
}
/** 条目正文：拿掉来源自带的那句问句（避免重复），按挂法在末尾加问句 */
function contentWithHook(content, hook) {
  let c = String(content || "");
  if (hook.removeRange) c = c.slice(0, hook.removeRange[0]) + c.slice(hook.removeRange[1]);
  c = c.replace(/\s+$/, "");
  if (hook.mode === "text") return c;
  const g = hook.scope === "global" ? "global" : "";
  if (hook.mode === "slot") return `${c}
{{set${g}var::${hook.varName}::${hook.question}}}`;
  if (hook.mode === "append") return `${c}
{{add${g}var::${hook.varName}::${hook.lead ?? "\n"}${hook.question}}}`;
  return `${c}
{{set${g}var::${hook.varName}::${hook.question}}}`;
}
function insertGetvar(text, anchorVar, macro) {
  const s = String(text || "");
  if (s.includes(macro)) return s;
  if (anchorVar) {
    const re = new RegExp(`\\{\\{get(?:global)?var::${anchorVar.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\}\\}[^\\n]*`, "g");
    let last = null;
    for (const m of s.matchAll(re)) last = m;
    if (last) {
      const end = last.index + last[0].length;
      return s.slice(0, end) + "\n" + macro + s.slice(end);
    }
  }
  const lines = [...s.matchAll(/^[ \t]*\{\{get(?:global)?var::[^{}]+\}\}[ \t]*$/gm)];
  if (lines.length) {
    const l = lines[lines.length - 1];
    const end = l.index + l[0].length;
    return s.slice(0, end) + "\n" + macro + s.slice(end);
  }
  return s.replace(/\s+$/, "") + "\n" + macro + "\n";
}
function insertLine(text, needle, line) {
  const s = String(text || "");
  if (s.includes(line.trim())) return s;
  const info = needle ? lineAround(s, needle) : null;
  let pos;
  if (info) pos = info.le;
  else {
    const close2 = /\n[ \t]*<\/[^>\n]+>[ \t]*\s*$/.exec(s);
    pos = close2 ? close2.index : s.replace(/\s+$/, "").length;
  }
  return s.slice(0, pos) + "\n" + line + s.slice(pos);
}
/** 所有算思维链的条目（开着的、关着的"选一"版本都算） */
function cotLikeIds(draft) {
  const region = cotRegion(draft);
  return draft.order.map((o) => o.identifier).filter((id) => region.has(id) || isCotEntry(draft, id, undefined, region));
}
function cotVersionsReading(draft, varName, first) {
  const list = cotLikeIds(draft).filter((id) => listVarMacros(draft.prompt(id)?.content || "").some((m) => m.op === "get" && m.name === varName));
  return [first, ...list.filter((x) => x !== first)].filter(Boolean);
}
function cotVersionsMentioning(draft, needle, first) {
  if (!needle) return [first];
  const list = cotLikeIds(draft).filter((id) => cotPlainText(draft.prompt(id)?.content).includes(needle));
  return [first, ...list.filter((x) => x !== first)].filter(Boolean);
}
/** 在思维链里加读取/点名、在初始化条目里加清空。条目正文要先用 contentWithHook 写好。 */
function applyHook(draft, hook) {
  const cot = draft.prompt(hook.cotId);
  if (!cot) return { ok: false };
  if (hook.mode === "append" || hook.mode === "slot") return { ok: true, cotName: cot.name, inited: false }; // 思维链本来就读这个变量
  const targets = (hook.cotIds || [hook.cotId]).map((id) => draft.prompt(id)).filter(Boolean);
  if (hook.mode === "text") {
    for (const c2 of targets) c2.content = insertLine(c2.content, hook.needle, hook.line);
    return { ok: true, cotName: cot.name + (targets.length > 1 ? ` 等 ${targets.length} 个版本` : ""), inited: false };
  }
  const g = hook.scope === "global" ? "global" : "";
  for (const c2 of targets) c2.content = insertGetvar(c2.content, hook.anchorVar, `{{get${g}var::${hook.varName}}}`);
  const initId = findInitEntry(draft);
  const inited = initId ? ensureInit(draft, hook.varName, initId, hook.scope || "local") : false;
  return { ok: true, cotName: cot.name + (targets.length > 1 ? ` 等 ${targets.length} 个版本` : ""), inited };
}

