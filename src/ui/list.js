var ICON = {
  // 拉取：带箭头的圆圈；测试：闪电
  bolt: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v5h-5"/></svg>',
  // 展开：四个角（边不连），收起：四个角朝内
  expand: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/></svg>',
  collapse: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5"/></svg>',
  eye: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>',
  copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/></svg>',
  grip: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14M5 12h14M5 16h14"/></svg>',
  more: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>',
  caret: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>',
  // 2.5.0 代替表情符号的图标（表情在各家手机上画法不同，和其他线条图标也不搭）
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  pencil: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/></svg>',
  trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5"/></svg>',
  link: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>',
  folder: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"/></svg>',
  needle: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 4 7 17"/><path d="M17 4h3v3"/><path d="M7 17c-2 2-4 2-4 2s0-2 2-4"/></svg>'
};
/**
 * 列表渲染。o.place 为 true 时是"选位置"：
 *   点组头＝放在这组后面（组外）；展开后点组内条目＝放进组里、它的后面；
 *   顶部「最前面」、展开组的第一行「组内最前」。o.inside === false 时不能放进组里（给新分组选位置）。
 * o.marker：{ at: "top" } | { at: "row", id } | { at: "block", id: 组块最后一条 } | { at: "block", gid }（空分组）| { at: "gstart", gid }
 */
function renderList(draft, o) {
  return draft.withReadIndex(() => renderIndexedList(draft, o));
}
function renderIndexedList(draft, o) {
  const q = (o.query || "").trim().toLowerCase();
  const sel = o.selected || /* @__PURE__ */ new Set();
  const collapsed = o.collapsed || /* @__PURE__ */ new Set();
  const place = !!o.place;
  const inside = place && o.inside !== false;
  const showSwitch = o.mode === "organize" && !place;
  const showHandle = showSwitch;
  const m = o.marker || null;
  const mark = `<div class="pa-insert-mark">${esc(o.markLabel || "插入位置")}</div>`;
  // 搜索：先看看得见的（条目名、标签、分组名）；只在正文里出现的另算，默认不列出，
  // 打开「正文里还有 N 条」后列出来，并在名称下面显示正文里匹配的那一句，免得看不出为什么会搜到它
  const hits = new Map();
  let nameHits = 0, bodyHits = 0;
  if (q) {
    for (const o2 of draft.order) {
      const id = o2.identifier;
      const p = draft.prompt(id);
      const gName = String(draft.group(draft.groupOf(id))?.name || "").toLowerCase();
      if ((p?.name || id).toLowerCase().includes(q) || tagText(draft, id).toLowerCase().includes(q) || gName.includes(q)) {
        hits.set(id, { body: false });
        nameHits++;
      } else {
        const c = String(p?.content || "");
        const i = c.toLowerCase().indexOf(q);
        if (i >= 0) {
          bodyHits++;
          if (o.searchBody) hits.set(id, { body: true, snip: hitSnippet(c, i, q.length) });
        }
      }
    }
  }
  const matches = (id) => !q || hits.has(id);
  const enabledMap = new Map(draft.order.map((x) => [x.identifier, x.enabled !== false]));
  const manual = draft.cotManual || {};
  let region;
  const row = (id) => {
    if (!matches(id)) return "";
    const p = draft.prompt(id);
    const name = p?.name || id;
    const on = enabledMap.get(id);
    const marker = draft.isMarker(id);
    const empty = !String(p?.content || "").trim();
    let badge = "";
    if (o.badge) badge = o.badge(id);
    else if (!marker && !empty) {
      const s = detectShape(p?.content);
      if (s.shape === "wrap" || s.shape === "tagname") badge = `<span class="pa-chip" title="写入变量">${markText(tagText(draft, id), q)}</span>`;
      else if (s.shape === "init") badge = '<span class="pa-chip pa-chip-dim">变量初始化</span>';
      if (isCotEntry(draft, id, manual, region || (region = cotRegion(draft)))) badge += '<span class="pa-chip pa-chip-cot">CoT</span>';
    }
    if (marker) badge = '<span class="pa-chip pa-chip-dim">系统位置</span>';
    // 2.7.4 名称下一行：角色、插入深度、标签
    const meta = marker || empty && !marker ? "" : `${p?.role && p.role !== "system" && ROLE_TEXT[p.role] ? `<span>${ROLE_TEXT[p.role]}</span>` : ""}${p?.injection_position === 1 ? `<span>深度 ${esc(p.injection_depth ?? 4)}</span>` : ""}`;
    const at = m?.at === "row" && m.id === id;
    const hl = o.highlight?.has(id) ? " pa-flash" : "";
    return `<div class="pa-row${at ? " pa-at" : ""}${sel.has(id) ? " pa-sel" : ""}${on ? "" : " pa-off"}${empty && !marker ? " pa-sep" : ""}${hl}" data-id="${esc(id)}" tabindex="0">
            <span class="pa-check" aria-hidden="true"></span>
            <span class="pa-namebox"><span class="pa-nameline"><span class="pa-name">${hits.get(id)?.body ? esc(name) : markText(name, q)}</span>${badge ? `<span class="pa-badges">${badge}</span>` : ""}</span>${hits.get(id)?.body ? `<small class="pa-hitline">正文：${hits.get(id).snip}</small>` : ""}${meta ? `<small class="pa-meta">${meta}</small>` : ""}</span>
            <button class="pa-icon-btn pa-peek" data-act="peek" aria-label="查看或编辑" title="查看或编辑">${ICON.eye}</button>
            ${showSwitch ? `<label class="pa-switch" title="开关"><input type="checkbox" data-act="toggle" aria-label="开启「${esc(name)}」" ${on ? "checked" : ""}><i></i></label>` : ""}
            ${showHandle ? `<span class="pa-handle" data-act="drag" aria-label="拖动">${ICON.grip}</span>` : ""}
        </div>${at ? mark : ""}`;
  };
  let html = "";
  if (q) {
    const more = bodyHits ? `<button class="pa-link" data-act="qbody">${o.searchBody ? `收起正文里出现的 ${bodyHits} 条` : `正文里还有 ${bodyHits} 条 ›`}</button>` : "";
    html += `<div class="pa-qsum">${nameHits ? `名称、标签、分组名匹配 <b>${nameHits}</b> 条` : "名称、标签、分组名里没有"}${more ? " · " + more : ""}</div>`;
    if (!nameHits && !(o.searchBody && bodyHits)) return html + (bodyHits ? "" : '<p class="pa-empty">没有匹配的条目</p>');
  }
  if (place) html += m?.at === "top" ? mark : `<button class="pa-slot" data-act="top">↑ 最前面</button>`;
  for (const b of draft.blocks()) {
    if (b.empty && (q || o.mode === "source")) continue;
    if (!b.groupId) {
      const rows = b.ids.map(row).filter(Boolean);
      // --n：行数，屏幕外整块跳过渲染时按它占位（见样式 2.4.0）
      if (rows.length) html += `<div class="pa-loose" style="--n:${rows.length}">${rows.join("")}</div>`;
      continue;
    }
    const g = draft.group(b.groupId);
    const isCol = !q && collapsed.has(b.groupId);
    const shown = isCol ? [] : b.ids.map(row).filter(Boolean);
    const visibleRows = shown.join("");
    if (q && !visibleRows) continue;
    const onCount = b.ids.filter((id) => enabledMap.get(id)).length;
    const allSel = b.ids.length && b.ids.every((id) => sel.has(id));
    const first = b.ids[0] || "";
    const last = b.ids[b.ids.length - 1] || "";
    const afterHere = m?.at === "block" && (b.empty ? !m.id && m.gid === b.groupId : m.id === last);
    const atStart = m?.at === "gstart" && m.gid === b.groupId && b.part === 1;
    const hasAt = atStart || m?.at === "row" && b.ids.includes(m.id);
    const caret = place || o.mode === "target";
    const startSlot = inside && !isCol && b.part === 1 ? atStart ? mark : `<button class="pa-slot pa-slot-in" data-act="gstart" data-gid="${esc(b.groupId)}">${b.empty ? "↓ 放入此组" : "↑ 组内最前"}</button>` : "";
    const emptyNote = b.empty && !startSlot ? '<p class="pa-gempty">空分组</p>' : "";
    html += `<section class="pa-group${hasAt ? " pa-has-at" : ""}${afterHere ? " pa-after-at" : ""}${isCol ? " pa-collapsed" : ""}${b.empty ? " pa-gempty-box" : ""}${draft.groupOff(b.groupId) ? " pa-goff" : ""}${allSel && !b.empty ? " pa-gsel" : ""}" data-gid="${esc(b.groupId)}">
            <header class="pa-ghead" data-gid="${esc(b.groupId)}" data-first="${esc(first)}" data-last="${esc(last)}" tabindex="0">
                ${caret ? `<button class="pa-icon-btn pa-caret${isCol ? "" : " open"}" data-act="collapse" aria-label="展开或折叠" aria-expanded="${!isCol}">${ICON.caret}</button>` : `<button class="pa-icon-btn pa-group-select" data-act="gselect" aria-label="选择整组" aria-pressed="${!!allSel && !b.empty}"><span class="pa-check"></span></button>`}
                <span class="pa-gname"${place ? "" : ' data-act="collapse"'}>${markText(g?.name || "分组", q)}${b.parts > 1 ? `<em class="pa-split">第 ${b.part}/${b.parts} 段</em>` : ""}</span>
                ${hasAt && isCol ? '<span class="pa-at-chip">位置在组内</span>' : ""}<span class="pa-count">${onCount}/${b.ids.length}</span>
                ${showSwitch ? `<label class="pa-switch pa-switch-s" title="分组开关（不修改内部条目）"><input type="checkbox" aria-label="分组开关" data-act="gtoggle" ${draft.groupOff(b.groupId) ? "" : "checked"}><i></i></label>
                <button class="pa-icon-btn" data-act="gmenu" aria-label="分组操作">${ICON.more}</button>
                <span class="pa-handle" data-act="gdrag" aria-label="拖动分组">${ICON.grip}</span>` : ""}
            </header>
            <div class="pa-gbody" style="--n:${shown.length}">${startSlot}${emptyNote}${visibleRows}</div>
        </section>${afterHere ? mark : ""}`;
  }
  return html || '<p class="pa-empty">没有匹配的条目</p>';
}
// 条目的标签（列表右侧显示的变量名）
var ROLE_TEXT = { system: "系统", user: "用户", assistant: "AI" };
function tagText(draft, id) {
  const p = draft.prompt(id);
  if (!p || draft.isMarker(id) || !String(p.content || "").trim()) return "";
  const s = detectShape(p.content);
  return s.shape === "wrap" || s.shape === "tagname" ? String(draft.preset.extensions.presetAtelierEntryLabels?.[id] || s.varName || "") : "";
}
// 把文字里搜到的部分标出来（先拆开再分别转义，不会把转义后的 &amp; 之类拆坏）
function markText(text, q) {
  const t = String(text ?? "");
  if (!q) return esc(t);
  const i = t.toLowerCase().indexOf(q);
  if (i < 0) return esc(t);
  return esc(t.slice(0, i)) + `<mark>${esc(t.slice(i, i + q.length))}</mark>` + esc(t.slice(i + q.length));
}
// 正文里匹配的那一句：前后各取一点，换行压成空格
function hitSnippet(content, i, len) {
  const a = Math.max(0, i - 14), z = Math.min(content.length, i + len + 26);
  const flat = (x) => x.replace(/\s+/g, " ");
  return (a > 0 ? "…" : "") + esc(flat(content.slice(a, i))) + `<mark>${esc(content.slice(i, i + len))}</mark>` + esc(flat(content.slice(i + len, z))) + (z < content.length ? "…" : "");
}
/** 选好的位置 → 插入点 + 归属分组（null＝组外） */
function placeOf(d, m) {
  if (!m) return null;
  if (m.at === "top") return { where: { index: 0 }, gid: null };
  if (m.at === "gstart") return d.isEmptyGroup(m.gid) ? { where: d.afterEmpty(m.gid), gid: m.gid } : { where: { groupStart: m.gid }, gid: m.gid };
  if (m.at === "block") return m.id ? { where: { after: m.id }, gid: null } : { where: { ...d.afterEmpty(m.gid), behind: m.gid }, gid: null };
  return { where: { after: m.id }, gid: d.groupOf(m.id) };
}
/** 点了列表里的什么 → 位置。inside 为 false 时，点组里的条目也算放在这组后面 */
function placeFromClick(d, e, inside = true) {
  const t = e.target;
  const act = t.closest("[data-act]")?.dataset.act;
  if (act === "top") return { at: "top" };
  if (act === "gstart") return { at: "gstart", gid: t.closest("[data-act]").dataset.gid };
  const head = t.closest(".pa-ghead");
  if (head) return head.dataset.last ? { at: "block", id: head.dataset.last } : { at: "block", gid: head.dataset.gid };
  const row = t.closest(".pa-row");
  if (!row) return null;
  const id = row.dataset.id;
  if (inside || !d.groupOf(id)) return { at: "row", id };
  const b = d.blocks().find((x) => x.ids.includes(id));
  return { at: "block", id: b.ids[b.ids.length - 1] };
}
/** 位置还有效吗；组块标记总是指向那一块的最后一条（组被改过就跟着挪），失效返回 null */
function fixPlace(d, m) {
  if (!m) return null;
  if (m.at === "top") return m;
  if (m.at === "gstart") return d.group(m.gid) && (!d.isEmptyGroup(m.gid) || d.group(m.gid).anchor !== void 0) ? m : null;
  if (m.at === "block" && !m.id) {
    if (!d.group(m.gid)) return null;
    if (!d.isEmptyGroup(m.gid)) {
      const bs = d.blocks().filter((b) => b.groupId === m.gid);
      const lb = bs[bs.length - 1];
      return { at: "block", id: lb.ids[lb.ids.length - 1] };
    }
    return m;
  }
  if (!d.order.some((o) => o.identifier === m.id)) return null;
  if (m.at === "block") {
    const b = d.blocks().find((x) => x.ids.includes(m.id));
    if (!b?.groupId) return { at: "row", id: m.id };
    const last = b.ids[b.ids.length - 1];
    return last === m.id ? m : { at: "block", id: last };
  }
  return m;
}
function placeText(d, m) {
  const nm = (id) => d.prompt(id)?.name || id;
  const gn = (g) => d.group(g)?.name || "分组";
  if (m.at === "top") return "最前面";
  if (m.at === "gstart") return d.isEmptyGroup(m.gid) ? `「${gn(m.gid)}」组内` : `「${gn(m.gid)}」组内最前`;
  if (m.at === "block") return `「${gn(m.id ? d.groupOf(m.id) : m.gid)}」组之后（组外）`;
  const g = d.groupOf(m.id);
  return g ? `「${gn(g)}」组内，「${nm(m.id)}」之后` : `「${nm(m.id)}」之后`;
}
