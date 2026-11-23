// 2.12.0 预设 → 正则：开关预设、角色卡、全局三处的正则，可搜索。2.12.4 点行或眼睛编辑：名称、查找、替换、修剪、作用于、改哪里、宏、深度；可删除。
// 预设的正则走预设的草稿（自动保存、可撤销）；角色卡的写回角色卡；全局的写回酒馆设置。
var RX_PLACE = { 1: "用户输入", 2: "AI 输出", 3: "快捷命令", 5: "世界书", 6: "推理" };
// 柏宝箱保存在预设里的正则分组（只读）：[{ id, name, collapsed, idx: 规则下标 }]，没有分组时返回 null
function regexSubgroups(d, rules) {
  let v;
  try { v = presetRegexGroupValue(d); } catch { return null; }
  if (!v || !Array.isArray(v.groups) || !v.groups.length) return null;
  const groups = v.groups.map((g, i) => ({ id: g.id, name: String(g.name || "").trim() || "未命名分组", collapsed: g.collapsed === true, o: g.order === undefined ? i : Number(g.order), idx: [] }))
    .sort((a, b) => a.o - b.o);
  const byId = new Map(groups.map((g) => [g.id, g]));
  const rest = { id: "__ungrouped", name: String(v.ungrouped?.name || "").trim() || "未分组", collapsed: v.ungrouped?.collapsed === true, idx: [] };
  const orderOf = new Map();
  rules.forEach((r, i) => {
    if (!r || typeof r !== "object") return;
    const m = typeof r.id === "string" && Object.hasOwn(v.scripts, r.id) ? v.scripts[r.id] : null;
    (m?.groupId && byId.get(m.groupId) || rest).idx.push(i);
    orderOf.set(i, m?.order === undefined || m?.order === null ? i : Number(m.order));
  });
  for (const g of [...groups, rest]) g.idx.sort((a, b) => orderOf.get(a) - orderOf.get(b) || a - b);
  const out = [...groups, rest].filter((g) => g.idx.length);
  return out.length > 1 || out[0]?.id !== "__ungrouped" ? out : null;
}
// 编辑一条正则。返回新的字段（保留原有的其他字段），取消返回 null，删除返回 "delete"
var RX_SUB = [[0, "不替换"], [1, "原样替换"], [2, "转义后替换"]];
function rxScopeNote(md, pr) {
  const s = presetRegexRuleScope({ markdownOnly: md, promptOnly: pr });
  return md || pr ? `现在：${s}` : `现在：${s}，直接改聊天记录里的原文`;
}
async function regexEditSheet(rule) {
  const place = new Set(Array.isArray(rule.placement) ? rule.placement : []);
  const sub = rule.substituteRegex === true ? 1 : Number(rule.substituteRegex) || 0;
  const num = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 ? String(v) : "";
  const body = el(`<div class="pa-form pa-rx-form">
      <label class="pa-field"><span>名称</span><input class="pa-input" data-x="name" autocomplete="off" value="${esc(rule.scriptName || "")}" aria-describedby="pa-rx-name-err"></label>
      <small class="pa-field-err" id="pa-rx-name-err" data-err="name" hidden></small>
      <label class="pa-field"><span>查找</span><textarea class="pa-input pa-rx-ta" data-x="find" rows="1" spellcheck="false" autocapitalize="off" autocomplete="off" translate="no" placeholder="/内容/g" aria-describedby="pa-rx-find-help pa-rx-find-err">${esc(rule.findRegex || "")}</textarea></label>
      <small class="pa-hint pa-rx-help" id="pa-rx-find-help">写成 /内容/标志，例如 /&lt;状态&gt;([\\s\\S]*?)&lt;\\/状态&gt;/g；不带斜杠时整段当作正则。</small>
      <small class="pa-field-err" id="pa-rx-find-err" data-err="find" hidden></small>
      <label class="pa-field"><span>替换为</span><textarea class="pa-input pa-rx-ta" data-x="replace" rows="1" spellcheck="false" autocapitalize="off" autocomplete="off" translate="no" placeholder="留空：删掉匹配到的内容" aria-describedby="pa-rx-rep-help">${esc(rule.replaceString || "")}</textarea></label>
      <small class="pa-hint pa-rx-help" id="pa-rx-rep-help">$1 是第一个括号里的内容，{{match}} 是整段匹配。</small>
      <label class="pa-field"><span>修剪掉（每行一个）</span><textarea class="pa-input pa-rx-ta" data-x="trim" rows="1" spellcheck="false" autocapitalize="off" autocomplete="off" translate="no">${esc((Array.isArray(rule.trimStrings) ? rule.trimStrings : []).join("\n"))}</textarea></label>
      <fieldset class="pa-rx-set" aria-describedby="pa-rx-place-err"><legend>作用于</legend>
        <div class="pa-rx-checks">${Object.entries(RX_PLACE).map(([k, l]) => `<label class="pa-inline-check"><input type="checkbox" data-place="${k}" ${place.has(Number(k)) ? "checked" : ""}><span>${l}</span></label>`).join("")}</div>
        <small class="pa-field-err" id="pa-rx-place-err" data-err="place" hidden></small>
      </fieldset>
      <fieldset class="pa-rx-set"><legend>改哪里</legend>
        <div class="pa-rx-checks"><label class="pa-inline-check"><input type="checkbox" data-x="md" ${rule.markdownOnly ? "checked" : ""}><span>只改显示</span></label><label class="pa-inline-check"><input type="checkbox" data-x="pr" ${rule.promptOnly ? "checked" : ""}><span>只改发给模型的内容</span></label></div>
        <small class="pa-hint" data-x="scope">${esc(rxScopeNote(!!rule.markdownOnly, !!rule.promptOnly))}</small>
      </fieldset>
      <div class="pa-item-ctl pa-rx-more">
        <label class="pa-field"><span>查找里的宏</span><select class="pa-select" data-x="sub">${RX_SUB.map(([k, l]) => `<option value="${k}" ${sub === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        <label class="pa-field"><span>最小深度</span><input class="pa-input" type="number" min="-1" inputmode="numeric" autocomplete="off" data-x="min" placeholder="不限" value="${num(rule.minDepth)}"></label>
        <label class="pa-field"><span>最大深度</span><input class="pa-input" type="number" min="0" inputmode="numeric" autocomplete="off" data-x="max" placeholder="不限" value="${num(rule.maxDepth)}"></label>
      </div>
      <label class="pa-inline-check"><input type="checkbox" data-x="edit" ${rule.runOnEdit ? "checked" : ""}><span>编辑消息时也运行</span></label>
    </div>`);
  const q = (k) => body.querySelector(`[data-x=${k}]`);
  const grow = (ta) => {
    const box = ta.closest(".pa-sheet-body");
    const top = box?.scrollTop;
    ta.style.height = "auto";
    ta.style.height = ta.scrollHeight + 2 + "px";
    if (box && top != null) box.scrollTop = top;
  };
  body.querySelectorAll(".pa-rx-ta").forEach((ta) => {
    ta.addEventListener("input", () => grow(ta));
    requestAnimationFrame(() => requestAnimationFrame(() => grow(ta)));
  });
  const paintScope = () => { q("scope").textContent = rxScopeNote(q("md").checked, q("pr").checked); };
  q("md").addEventListener("change", paintScope);
  q("pr").addEventListener("change", paintScope);
  const setErr = (k, msg) => {
    const e = body.querySelector(`[data-err=${k}]`);
    e.hidden = !msg;
    e.textContent = msg || "";
    const field = k === "name" ? q("name") : k === "find" ? q("find") : null;
    if (field) { if (msg) field.setAttribute("aria-invalid", "true"); else field.removeAttribute("aria-invalid"); }
  };
  const depth = (v) => { const t = String(v).trim(); if (!t) return null; const n = Math.floor(Number(t)); return Number.isFinite(n) ? n : null; };
  const read = () => {
    const placement = [...body.querySelectorAll("[data-place]")].filter((x) => x.checked).map((x) => Number(x.dataset.place));
    return {
      ...rule,
      scriptName: q("name").value.trim(),
      findRegex: q("find").value,
      replaceString: q("replace").value,
      trimStrings: q("trim").value.split("\n").map((x) => x.trim()).filter(Boolean),
      placement,
      markdownOnly: q("md").checked,
      promptOnly: q("pr").checked,
      runOnEdit: q("edit").checked,
      substituteRegex: Number(q("sub").value) || 0,
      minDepth: depth(q("min").value),
      maxDepth: depth(q("max").value)
    };
  };
  // 名称、查找必填，查找要能被酒馆解析，至少作用于一处；有错时写在对应的框下面，焦点移到第一个错处
  const validate = () => {
    const v = read();
    const errs = [];
    setErr("name", v.scriptName ? "" : (errs.push(q("name")), "名称不能空着"));
    let findErr = "";
    if (!v.findRegex.trim()) findErr = "查找不能空着";
    else { try { regexFromText(v.findRegex); } catch (e) { findErr = `酒馆解析不了这个正则：${e.message}`; } }
    if (findErr) errs.push(q("find"));
    setErr("find", findErr);
    setErr("place", v.placement.length ? "" : (errs.push(body.querySelector("[data-place]")), "至少选一处，不然这条正则不会运行"));
    errs[0]?.focus();
    return !errs.length;
  };
  return sheet({
    title: rule.scriptName || "编辑正则", body, wide: true, noFocus: true, guardDirty: true,
    actions: [{ label: "删除", kind: "danger-soft", value: "delete" }, { label: "取消", value: null }, { label: "保存", kind: "primary", value: read, validate }],
    onMount: (w) => {
      const sh = w.querySelector(".pa-sheet");
      sh.classList.add("pa-sheet-rxedit");
      scrollHint(w.querySelector(".pa-sheet-body"), sh);
    }
  });
}
function mountRegexPage(page) {
  const st = { query: "" };
  page.innerHTML = `
    <div class="pa-toolbar">
      <div class="pa-picker-slot"></div>
      <button class="pa-icon-btn" data-r="search" aria-label="搜索正则" title="搜索正则">${ICON.search}</button>
      <div class="pa-findrow pa-qrow" style="${BOX_STYLE}" hidden><input class="pa-input pa-find" style="${FIELD_STYLE}" type="text" inputmode="search" enterkeyhint="search" autocorrect="off" autocapitalize="off" autocomplete="off" spellcheck="false" placeholder="搜正则名称或查找内容" aria-label="搜索正则"><button type="button" class="pa-icon-btn pa-qx" data-r="searchclose" aria-label="关闭搜索"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
    </div>
    <div class="pa-scroll pa-rx-list" role="list" aria-label="正则"></div>`;
  const list = page.querySelector(".pa-rx-list");
  const search = page.querySelector(".pa-find");
  const picker = presetPicker(page.querySelector(".pa-picker-slot"), (name) => setFocusPreset(name), { use: true });
  // 每段：{ kind, title, rules, note, allow }
  function groups() {
    const out = [];
    let d = null;
    try { d = getDraft(focusPreset()); } catch {}
    if (d) {
      let rules = [], bad = "";
      try { rules = presetRegexList(d); } catch (e) { bad = e.message; }
      const act = presetRegexActivationInfo(d.name);
      const note = bad || (act.extensionDisabled ? "酒馆的正则扩展已停用，这里的开关暂不生效。" : rules.length && !act.allowed ? "酒馆还没允许这个预设的正则，现在都不生效。" : "");
      out.push({ kind: "preset", title: `预设「${d.name}」`, rules, d, note, allow: rules.length && !act.allowed && !act.extensionDisabled && !bad ? "preset" : "", empty: "这个预设没有自带正则。" });
    }
    const ci = currentChar();
    if (ci) {
      const rules = charRegexList(ci);
      out.push({ kind: "char", title: `角色卡「${ci.name}」`, rules, ci, note: rules.length && !charRegexAllowed(ci) ? "酒馆还没允许这张角色卡的正则，现在都不生效。" : "", allow: rules.length && !charRegexAllowed(ci) ? "char" : "", empty: "这张角色卡没有自带正则。" });
    }
    out.push({ kind: "global", title: "全局", rules: globalRegexList(), note: "", allow: "", empty: "还没有全局正则。" });
    return out;
  }
  function hit(rule, q) {
    return !q || presetRegexRuleName(rule).toLowerCase().includes(q) || String(rule?.findRegex || "").toLowerCase().includes(q);
  }
  function render() {
    picker.refresh();
    try { picker.set(focusPreset()); } catch {}
    const q = st.query.trim().toLowerCase();
    const top = list.scrollTop;
    let html = "", shownAny = false;
    const rowHtml = (g, i) => {
      const r = g.rules[i];
      const name = presetRegexRuleName(r);
      const on = !r.disabled;
      const where = (Array.isArray(r.placement) ? r.placement : []).map((p) => RX_PLACE[p]).filter(Boolean);
      return `<div class="pa-row pa-rx-row${on ? "" : " pa-off"}" data-kind="${g.kind}" data-i="${i}" tabindex="0">
          <span class="pa-namebox"><span class="pa-nameline"><span class="pa-name">${markText(name, q)}</span></span><small class="pa-meta"><span>${esc(presetRegexRuleScope(r))}</span>${where.length ? `<span>${esc(where.join("、"))}</span>` : ""}</small></span>
          <button class="pa-icon-btn pa-del" data-r="del" aria-label="删除「${esc(name)}」" title="删除">${ICON.trash}</button>
          <button class="pa-icon-btn pa-peek" data-r="peek" aria-label="查看或编辑「${esc(name)}」" title="查看或编辑">${ICON.eye}</button>
          <label class="pa-switch"><input type="checkbox" data-r="toggle" aria-label="开启「${esc(name)}」" ${on ? "checked" : ""}><i></i></label>
        </div>`;
    };
    const onCount = (g, idx) => idx.filter((i) => g.rules[i] && !g.rules[i].disabled).length;
    for (const g of groups()) {
      const idx = g.rules.map((r, i) => i).filter((i) => g.rules[i] && typeof g.rules[i] === "object" && hit(g.rules[i], q));
      if (q && !idx.length) continue;
      shownAny = shownAny || idx.length > 0;
      const onN = g.rules.filter((r) => r && !r.disabled).length;
      // 2.12.1 预设带柏宝箱的正则分组时，段内按分组列出，每组可折叠
      const subs = g.kind === "preset" ? regexSubgroups(g.d, g.rules) : null;
      let rows;
      if (subs) {
        const shownSet = new Set(idx);
        rows = subs.map((sg) => {
          const mine = sg.idx.filter((i) => shownSet.has(i));
          if (!mine.length) return "";
          const fk = `${g.d.name}::${sg.id}`;
          const col = !q && !foldGet("rx", fk, !sg.collapsed);
          return `<div class="pa-rx-grp${col ? " pa-collapsed" : ""}" data-fk="${esc(fk)}">
            <div class="pa-rx-ghead" data-r="gfold" role="button" tabindex="0" aria-expanded="${!col}"><span class="pa-icon-btn pa-caret" aria-hidden="true">${ICON.caret}</span><span class="pa-rx-gname">${markText(sg.name, q)}</span><span class="pa-count">${onCount(g, sg.idx)}/${sg.idx.length}</span></div>
            <div class="pa-rx-gbody">${mine.map((i) => rowHtml(g, i)).join("")}</div>
          </div>`;
        }).join("");
      } else rows = idx.map((i) => rowHtml(g, i)).join("");
      const note = g.note ? `<p class="pa-gnote pa-gnote-warn">${esc(g.note)}${g.allow ? ` <button class="pa-link" data-r="allow" data-kind="${g.allow}">允许</button>` : ""}</p>` : "";
      const col = !q && !foldGet("rx", g.kind, true);
      html += `<section class="pa-group pa-rx-sec${col ? " pa-collapsed" : ""}" data-kind="${g.kind}">
        <header class="pa-ghead" data-r="fold" role="button" tabindex="0" aria-expanded="${!col}"><span class="pa-icon-btn pa-caret" aria-hidden="true">${ICON.caret}</span><span class="pa-gname">${esc(g.title)}</span>${g.rules.length ? `<span class="pa-count">${onN}/${g.rules.length}</span>` : ""}</header>
        <div class="pa-gbody" style="--n:${idx.length}">${note}${rows || (g.rules.length ? "" : `<p class="pa-gnote">${esc(g.empty)}</p>`)}</div>
      </section>`;
    }
    if (q && !shownAny) html = '<p class="pa-empty">没有匹配的正则</p>';
    list.innerHTML = html;
    list.scrollTop = top;
  }
  function ruleOf(kind, i) {
    if (kind === "preset") { try { return presetRegexList(getDraft(focusPreset()))[i]; } catch { return null; } }
    if (kind === "char") return charRegexList(currentChar())[i];
    return globalRegexList()[i];
  }
  async function toggle(kind, i, on) {
    try {
      if (kind === "preset") {
        const d = getDraft(focusPreset());
        const rule = presetRegexList(d)[i];
        if (!rule) throw new Error("这条正则已不存在");
        mutate(d, on ? "开启正则" : "关闭正则", (x) => { presetRegexList(x)[i].disabled = !on; });
        if (d.name === currentPresetName()) noteRegexDisplay(rule);
      } else if (kind === "char") await setCharRegexOn(currentChar(), i, on);
      else setGlobalRegexOn(i, on);
    } catch (e) {
      toast("修改失败：" + e.message, "error");
    }
    render();
  }
  // 删除一条正则：编辑窗口里的「删除」和行上的垃圾桶都走这里。预设的可在页头撤销
  async function remove(kind, i, r = ruleOf(kind, i)) {
    if (!r) return;
    const name = presetRegexRuleName(r);
    const undo = kind === "preset" ? "可在页头撤销。" : "删除后不能撤销。";
    if (!await confirmBox("删除正则", `删除「${name}」？${undo}`, "删除", true)) return;
    if (ruleOf(kind, i) !== r) return toast("这条正则已变动，没有删除，请重试", "warning");
    try {
      if (kind === "preset") {
        const d = getDraft(focusPreset());
        mutate(d, "删除正则", (x) => { presetRegexList(x).splice(i, 1); });
        if (d.name === currentPresetName()) noteRegexDisplay(r);
      } else if (kind === "char") await deleteCharRegex(currentChar(), i);
      else deleteGlobalRegex(i);
      toast(`已删除「${name}」`, "success");
    } catch (e) {
      toast("删除失败：" + e.message, "error");
    }
    render();
  }
  async function peek(kind, i) {
    const r = ruleOf(kind, i);
    if (!r) return;
    const name = presetRegexRuleName(r);
    const next = await regexEditSheet(r);
    if (!next) return;
    // 编辑窗口开着时，预设、角色或列表可能变了：按同一个位置再取一次，对不上就不写
    const cur = ruleOf(kind, i);
    if (cur !== r && !(kind === "preset" && cur && cur.id === r.id)) return toast("这条正则已变动，没有保存，请重新打开", "warning");
    try {
      if (next === "delete") return remove(kind, i, r);
      else {
        if (kind === "preset") {
          const d = getDraft(focusPreset());
          mutate(d, "编辑正则", (x) => { presetRegexList(x)[i] = next; });
          if (d.name === currentPresetName() && (r.markdownOnly || next.markdownOnly)) noteRegexDisplay({ markdownOnly: true });
        } else if (kind === "char") await saveCharRegex(currentChar(), i, next);
        else saveGlobalRegex(i, next);
        toast("已保存", "success");
      }
    } catch (e) {
      toast("保存失败：" + e.message, "error");
    }
    render();
  }
  list.addEventListener("click", (e) => {
    const a = e.target.closest("[data-r]");
    if (a?.dataset.r === "fold") {
      const sec = a.closest(".pa-rx-sec");
      foldSet("rx", sec.dataset.kind, sec.classList.contains("pa-collapsed"));
      return render();
    }
    if (a?.dataset.r === "gfold") {
      const grp = a.closest(".pa-rx-grp");
      foldSet("rx", grp.dataset.fk, grp.classList.contains("pa-collapsed"), 400);
      return render();
    }
    if (a?.dataset.r === "allow") {
      if (a.dataset.kind === "preset") allowPresetRegex(focusPreset());
      else { const ci = currentChar(); if (ci) allowCharRegex(ci); }
      toast("已允许，这些正则按各自的开关生效", "success");
      noteRegexDisplay({ markdownOnly: true });
      return render();
    }
    const row = e.target.closest(".pa-rx-row");
    if (!row) return;
    const kind = row.dataset.kind, i = Number(row.dataset.i);
    if (a?.dataset.r === "toggle") return void toggle(kind, i, a.checked);
    if (a?.dataset.r === "del") return remove(kind, i);
    if (e.target.closest(".pa-switch")) return;
    peek(kind, i);
  });
  page.querySelector(".pa-toolbar").addEventListener("click", (e) => {
    const b = e.target.closest("[data-r]")?.dataset.r;
    if (b !== "search" && b !== "searchclose") return;
    const r = page.querySelector(".pa-findrow");
    r.hidden = b === "searchclose" || !r.hidden;
    if (r.hidden) {
      search.value = "";
      if (st.query) { st.query = ""; render(); }
    } else search.focus();
  });
  onSearchInput(search, () => { st.query = search.value; render(); });
  const off = onDraftChange((name, kind) => {
    if (name === focusPreset() && kind !== "status" && draftViewVisible(page)) render();
  });
  return { render, destroy: off, onChat: render };
}
