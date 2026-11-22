// 2.12.0 预设 → 正则：开关预设、角色卡、全局三处的正则，可搜索；点眼睛看查找和替换内容。
// 预设的正则走预设的草稿（自动保存、可撤销）；角色卡的写回角色卡；全局的写回酒馆设置。
var RX_PLACE = { 1: "用户输入", 2: "AI 输出", 3: "快捷命令", 5: "世界书", 6: "推理" };
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
      out.push({ kind: "preset", title: `预设「${d.name}」`, rules, note, allow: rules.length && !act.allowed && !act.extensionDisabled && !bad ? "preset" : "", empty: "这个预设没有自带正则。" });
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
    for (const g of groups()) {
      const idx = g.rules.map((r, i) => i).filter((i) => g.rules[i] && typeof g.rules[i] === "object" && hit(g.rules[i], q));
      if (q && !idx.length) continue;
      shownAny = shownAny || idx.length > 0;
      const onN = g.rules.filter((r) => r && !r.disabled).length;
      const rows = idx.map((i) => {
        const r = g.rules[i];
        const name = presetRegexRuleName(r);
        const on = !r.disabled;
        const where = (Array.isArray(r.placement) ? r.placement : []).map((p) => RX_PLACE[p]).filter(Boolean);
        return `<div class="pa-row pa-rx-row${on ? "" : " pa-off"}" data-kind="${g.kind}" data-i="${i}" tabindex="0">
          <span class="pa-namebox"><span class="pa-nameline"><span class="pa-name">${markText(name, q)}</span></span><small class="pa-meta"><span>${esc(presetRegexRuleScope(r))}</span>${where.length ? `<span>${esc(where.join("、"))}</span>` : ""}</small></span>
          <button class="pa-icon-btn pa-peek" data-r="peek" aria-label="查看「${esc(name)}」" title="查看">${ICON.eye}</button>
          <label class="pa-switch"><input type="checkbox" data-r="toggle" aria-label="开启「${esc(name)}」" ${on ? "checked" : ""}><i></i></label>
        </div>`;
      }).join("");
      const note = g.note ? `<p class="pa-gnote pa-gnote-warn">${esc(g.note)}${g.allow ? ` <button class="pa-link" data-r="allow" data-kind="${g.allow}">允许</button>` : ""}</p>` : "";
      html += `<section class="pa-group pa-rx-sec" data-kind="${g.kind}">
        <header class="pa-ghead"><span class="pa-gname">${esc(g.title)}</span>${g.rules.length ? `<span class="pa-count">${onN}/${g.rules.length}</span>` : ""}</header>
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
  async function peek(kind, i) {
    const r = ruleOf(kind, i);
    if (!r) return;
    const where = (Array.isArray(r.placement) ? r.placement : []).map((p) => RX_PLACE[p]).filter(Boolean);
    const depth = [r.minDepth, r.maxDepth].some((x) => typeof x === "number" && x >= 0) ? `${r.minDepth ?? 0} – ${r.maxDepth ?? "∞"}` : "";
    const body = `<dl class="pa-rx-kv">
        <dt>状态</dt><dd>${r.disabled ? "关着" : "开着"}</dd>
        <dt>作用</dt><dd>${esc(presetRegexRuleScope(r))}${where.length ? `，影响${esc(where.join("、"))}` : ""}</dd>
        ${depth ? `<dt>深度</dt><dd class="pa-num">${esc(depth)}</dd>` : ""}
      </dl>
      <p class="pa-sub">查找</p><pre class="pa-rx-code" translate="no">${esc(r.findRegex || "")}</pre>
      <p class="pa-sub">替换为</p><pre class="pa-rx-code" translate="no">${esc(r.replaceString || "") || '<span class="pa-hint">（空：删掉匹配到的内容）</span>'}</pre>
      ${Array.isArray(r.trimStrings) && r.trimStrings.length ? `<p class="pa-sub">修剪掉</p><pre class="pa-rx-code" translate="no">${esc(r.trimStrings.join("\n"))}</pre>` : ""}
      <p class="pa-hint">要改查找或替换内容，在酒馆的正则面板里编辑。</p>`;
    await sheet({ title: presetRegexRuleName(r), body, wide: true, actions: [{ label: "关闭", value: null }] });
  }
  list.addEventListener("click", (e) => {
    const a = e.target.closest("[data-r]");
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
