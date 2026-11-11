// 1.7.5 双层分组提示。去掉过一次又出现，说明有别的地方拿旧版本写回来了：说清楚是谁（本机能抓到时）、该怎么办
function dupBannerHtml(d, dups) {
  const fixed = settings().mirrorFixed?.[d.name];
  const w = settings().mirrorWrites?.[d.name];
  const when = (t) => { const x = new Date(t); return `${x.getMonth() + 1}/${x.getDate()} ${String(x.getHours()).padStart(2, "0")}:${String(x.getMinutes()).padStart(2, "0")}`; };
  const names = esc(dups.slice(0, 4).map((g) => g.name).join("、")) + (dups.length > 4 ? " 等" : "");
  if (!fixed) return `<div class="pa-card pa-card-warn pa-dupgroups"><p><b>这个预设的分组存了两份，所以每个分组里又套了一层同名分组。</b></p><small>预设里同时有柏宝箱分组和另一种分组格式（entryGrouping），两个扩展各显示一层。共 ${dups.length} 个分组重复：${names}。去掉重复的一层后，条目和分组都不变。</small><div class="pa-card-act"><button class="pa-btn pa-btn-primary pa-btn-s" data-dup="fix">去掉重复的一层</button></div></div>`;
  const who = w && w.at > fixed
    ? `${when(w.at)} 在这台设备上，是${w.by ? `「${esc(w.by)}」` : "酒馆的「保存预设」"}把旧分组写回了预设。`
    : "这台设备上没看到谁写回来的，多半是另一台设备或另一个浏览器标签页里开着的酒馆：它内存里还是旧版本，一保存就把旧分组写回去了。";
  const known = w && w.at > fixed && w.by;
  const todo = known
    ? `「${esc(w.by)}」会把它自己记着的分组写进预设（entryGrouping），关掉它的条目分组功能也照写，去掉多少次都会回来。<br>只要酒馆里分组显示正常（没有套两层），这份数据留着不影响使用，点「保留，不再提示」即可；之后焦香鸡翅保存时也不再动它，不会和它来回改。`
    : "先把其他设备、其他标签页里的酒馆刷新一下（或关掉），再点「再去掉一次」。如果分组显示已经正常，也可以点「保留，不再提示」。";
  return `<div class="pa-card pa-card-warn pa-dupgroups"><p><b>重复的一层去掉过（${when(fixed)}），又被写回来了。</b></p><small>${who}<br>${todo}<br>共 ${dups.length} 个分组重复：${names}。</small><div class="pa-card-act"><button class="pa-btn pa-btn-primary pa-btn-s" data-dup="keep">保留，不再提示</button><button class="pa-btn pa-btn-s" data-dup="fix">再去掉一次</button></div></div>`;
}
// 编辑条目弹窗（整理页、缝合页共用）。打开时不把光标放进输入框：手机上点了正文才弹键盘。
// promptOnly：世界书条目只有名称和正文。返回填写的值，取消返回 null；由调用方决定写到哪里
// 2.7.2 表单拆出来：手机用弹窗，宽屏整理页用右侧编辑栏
function entryForm(p, { marker = false, promptOnly = false, hint = "" } = {}) {
  const s = detectShape(p.content);
  const info = s.shape === "wrap" || s.shape === "tagname" ? `${SHAPE_LABEL[s.shape]}「${s.varName}」` : SHAPE_LABEL[s.shape];
  const depthPos = p.injection_position === 1;
  const body = el(`<div class="pa-form">
          ${hint ? `<p class="pa-hint pa-edit-where">${esc(hint)}</p>` : ""}
          <label class="pa-field"><span>名称</span><input class="pa-input" data-f="name" autocomplete="off" value="${esc(p.name || "")}"></label>
          ${marker ? '<p class="pa-hint">系统位置条目，正文由酒馆填入，这里只能改名称。</p>' : `
          ${promptOnly ? "" : `<div class="pa-item-ctl">
            <label class="pa-field"><span>角色</span><select class="pa-select" data-f="role">${[["system", "系统"], ["user", "用户"], ["assistant", "AI"]].map(([k, l]) => `<option value="${k}" ${(p.role || "system") === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
            <label class="pa-field"><span>位置</span><select class="pa-select" data-f="pos"><option value="0" ${depthPos ? "" : "selected"}>按条目顺序</option><option value="1" ${depthPos ? "selected" : ""}>插入聊天记录（按深度）</option></select></label>
            <label class="pa-field" data-show="depth" ${depthPos ? "" : "hidden"}><span>深度</span><input class="pa-input" type="number" min="0" data-f="depth" value="${esc(p.injection_depth ?? 4)}"></label>
            <label class="pa-field" data-show="depth" ${depthPos ? "" : "hidden"}><span>同深度时的顺序</span><input class="pa-input" type="number" data-f="order" value="${esc(p.injection_order ?? 100)}"></label>
          </div>`}
          <div class="pa-edit-bar"><p class="pa-hint">写法：${esc(info)}</p><button type="button" class="pa-icon-btn pa-expand" data-f="expand" aria-label="展开正文" title="展开正文">${ICON.expand}</button></div>
          <textarea class="pa-input pa-text pa-edit-text" data-f="content" spellcheck="false">${esc(p.content || "")}</textarea>`}
      </div>`);
  // 2.8.5 正文框随内容增高，整个窗口一起滚动，不在框里单独滚
  const ta = body.querySelector(".pa-edit-text");
  if (ta) {
    const fit = () => {
      if (!ta.isConnected) return;
      const box = ta.closest(".pa-sheet-body, .pa-editpane-body");
      const top = box?.scrollTop;
      ta.style.height = "auto";
      ta.style.height = ta.scrollHeight + 2 + "px";
      if (box && top != null) box.scrollTop = top;
    };
    ta.addEventListener("input", fit);
    requestAnimationFrame(() => requestAnimationFrame(fit));
    // 2.9.1 字体载入、弹窗升起的动画结束后再量一次：量早了高度偏小，末尾几行露不出来
    setTimeout(fit, 350);
    try { document.fonts?.ready?.then(fit); } catch {}
    let lastW = 0;
    new ResizeObserver((es) => { const w = Math.round(es[0].contentRect.width); if (w !== lastW) { lastW = w; requestAnimationFrame(fit); } }).observe(body);
  }
  // 展开：正文占满弹窗（或编辑栏），其他设置先收起；再点一次恢复。触屏上不顺手聚焦，免得一展开就弹键盘
  body.querySelector("[data-f=expand]")?.addEventListener("click", (e) => {
    const sh = body.closest(".pa-sheet, .pa-editpane");
    const on = !sh.classList.contains("pa-sheet-max");
    sh.classList.toggle("pa-sheet-max", on);
    e.currentTarget.innerHTML = on ? ICON.collapse : ICON.expand;
    e.currentTarget.setAttribute("aria-label", on ? "收起正文" : "展开正文");
    e.currentTarget.title = on ? "收起正文" : "展开正文";
    ta?.dispatchEvent(new Event("input"));
    if (matchMedia("(pointer:fine)").matches) body.querySelector("[data-f=content]")?.focus({ preventScroll: true });
  });
  body.querySelector("[data-f=pos]")?.addEventListener("change", (e) => {
    body.querySelectorAll("[data-show=depth]").forEach((x) => { x.hidden = e.target.value !== "1"; });
  });
  const read = () => {
    const v = (k) => body.querySelector(`[data-f=${k}]`)?.value;
    return { name: v("name"), content: v("content"), role: v("role"), pos: v("pos"), depth: v("depth"), order: v("order") };
  };
  const initial = JSON.stringify(read());
  return { body, read, dirty: () => JSON.stringify(read()) !== initial };
}
// 编辑条目弹窗（整理页、缝合页共用）。输入时不保存；点「保存」才写入，点「取消」或 ✕ 不改动
async function editEntrySheet(p, { marker = false, promptOnly = false, hint = "", title = "编辑条目" } = {}) {
  const f = entryForm(p, { marker, promptOnly, hint });
  return sheet({
    title, body: f.body, wide: true, noFocus: true, guardDirty: true,
    onMount: (w) => { if (!marker) w.querySelector(".pa-sheet").classList.add("pa-sheet-edit"); },
    actions: [{ label: "取消", value: null }, { label: "保存", kind: "primary", value: f.read }]
  });
}
// 把弹窗填的值换成条目字段；只返回有变化的部分（没有变化返回 null）
function entryChanges(cur, r) {
  const next = { name: r.name };
  if (r.content !== void 0) {
    next.content = r.content;
    if (r.role !== void 0) {
      next.role = r.role || "system";
      next.injection_position = r.pos === "1" ? 1 : 0;
      if (next.injection_position === 1) {
        next.injection_depth = Math.max(0, Math.floor(Number(r.depth) || 0));
        next.injection_order = Math.floor(Number(r.order) || 100);
      }
    }
  }
  const changed = Object.entries(next).some(([k, v]) => (cur[k] ?? (k === "role" ? "system" : k === "injection_position" ? 0 : "")) !== v);
  return changed ? next : null;
}
function mountOrganize(page) {
  const st = {
    selected: /* @__PURE__ */ new Set(),
    collapsed: null,
    collapsedFor: null,
    query: "",
    // null：普通；"move"：给选中的条目选位置；"newgroup"：给新分组选位置
    mode: null,
    newName: "",
    keep: [],
    highlight: /* @__PURE__ */ new Set()
  };
  page.innerHTML = `
        <div class="pa-toolbar">
            <div class="pa-picker-slot"></div>
            <button class="pa-icon-btn" data-tool="search" aria-label="搜索条目" title="搜索条目">${ICON.search}</button>
            <button class="pa-icon-btn pa-tools-more" data-tool="add" aria-label="新建" title="新建条目或分组">${ICON.plus}</button>
            <button class="pa-icon-btn pa-tools-more" data-tool="menu" aria-label="工具" title="工具">⋯</button>
            <div class="pa-findrow pa-qrow" style="${BOX_STYLE}" hidden><input class="pa-input pa-find" style="${FIELD_STYLE}" type="text" inputmode="search" enterkeyhint="search" autocorrect="off" autocapitalize="off" autocomplete="off" spellcheck="false" placeholder="搜名称、分组名、标签或正文" aria-label="搜索条目"><button type="button" class="pa-icon-btn pa-qx" data-tool="searchclose" aria-label="关闭搜索"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
            <div class="pa-tools">
                <button class="pa-btn pa-btn-soft" data-tool="newgroup">＋ 新建分组</button>
                <button class="pa-btn pa-btn-soft" data-tool="newentry">＋ 新建条目</button>
                <button class="pa-btn pa-btn-soft" data-tool="smart">智能分组</button>
                <button class="pa-btn pa-btn-soft" data-tool="fold">全部折叠</button>
                <button class="pa-btn pa-btn-soft" data-tool="clickorder"></button>
            </div>
        </div>
        <div class="pa-movebar" hidden><b class="pa-move-n"></b>
            <button class="pa-btn pa-sq" data-mv="up" aria-label="上移一位">↑</button><button class="pa-btn pa-sq" data-mv="down" aria-label="下移一位">↓</button><button class="pa-btn pa-btn-soft" data-mv="end">移到最后</button>
            <button class="pa-btn" data-mv="cancel">退出移动</button><small class="pa-move-hint"></small></div>
        <div class="pa-scroll pa-list" role="list"></div>
        <div class="pa-selbar" hidden>
            <div class="pa-selbar-top"><b class="pa-selcount"></b>
                <button class="pa-link" data-sel="all">全选</button><button class="pa-btn pa-btn-s pa-selcancel" data-sel="none">取消</button></div>
            <div class="pa-selbar-btns">
                <button class="pa-btn pa-btn-primary" data-sel="moveto">移动</button>
                <button class="pa-btn pa-seltoggle" data-sel="on">开启</button>
                <button class="pa-btn" data-sel="copy" title="每条的副本放在原条目后面">复制</button>
                <button class="pa-btn pa-btn-danger-soft" data-sel="delete">删除</button>
                <button class="pa-btn" data-sel="more">更多</button>
            </div>
        </div>
        <aside class="pa-editpane" aria-label="编辑条目" hidden></aside>`;
  const list = page.querySelector(".pa-list");
  const selbar = page.querySelector(".pa-selbar");
  const movebar = page.querySelector(".pa-movebar");
  const search = page.querySelector(".pa-find");
  const picker = presetPicker(page.querySelector(".pa-picker-slot"), (name) => {
    st.selected.clear();
    st.mode = null;
    setFocusPreset(name);
  });
  const draft = () => getDraft(focusPreset());
  // 2.6.8 分组折叠记住最后一次的状态：按「预设名 + 分组名（同名第几个）」存在设置里（fold.org），没动过的组按预设里存的状态。
  // 以前只在内存里记、按分组编号记：重新加载或切换预设后回到预设里存的状态，编号变了也对不上，合上的组又展开
  function orgFoldKeys(d) {
    const seen = new Map(), out = new Map();
    for (const g of d.groups.groups) {
      const n = seen.get(g.name) || 0;
      seen.set(g.name, n + 1);
      out.set(g.id, `${d.name}\u0001${g.name}\u0001${n}`);
    }
    return out;
  }
  function setOpen(d, gid, on) {
    const k = orgFoldKeys(d).get(gid);
    if (k) foldSet("org", k, on, 600);
  }
  function ensureCollapsed(d) {
    const keys = orgFoldKeys(d);
    st.collapsedFor = d.name;
    st.collapsed = new Set(d.groups.groups.filter((g) => !foldGet("org", keys.get(g.id), !g.collapsed)).map((g) => g.id));
  }
  const allFolded = (d) => d.groups.groups.length > 0 && d.groups.groups.every((g) => st.collapsed.has(g.id));
  function render() {
    let d;
    try {
      d = draft();
    } catch (e) {
      list.innerHTML = `<p class="pa-empty">${esc(e.message)}</p>`;
      return;
    }
    ensureCollapsed(d);
    picker.set(d.name);
    for (const id of [...st.selected]) if (!d.order.some((o) => o.identifier === id)) st.selected.delete(id);
    const placing = !!st.mode;
    const top = list.scrollTop;
    // 1.7.5 双层分组提示
    const dups = placing || st.query || settings().mirrorIgnore?.[d.name] ? [] : d.dupEntryGroups();
    const dupBanner = dups.length ? dupBannerHtml(d, dups) : "";
    const fragments = placing || st.query ? [] : fragmentedGroups(d);
    const repairBanner = fragments.length ? `<div class="pa-card pa-group-repair"><p><b>检测到 ${fragments.length} 个分区被拆成多段</b></p><small>${esc(fragments.slice(0, 4).map((g) => `${g.name}（${g.parts} 段）`).join("、"))}${fragments.length > 4 ? " 等" : ""}。可以按已有归属收拢到各组首段，先预览再应用。</small><div class="pa-card-act"><button class="pa-btn pa-btn-s" data-repair-groups>归整分区</button></div></div>` : "";
    list.innerHTML = dupBanner + repairBanner + renderList(d, { mode: "organize", place: placing, inside: st.mode !== "newgroup", selected: st.mode === "newgroup" ? void 0 : st.selected, collapsed: st.collapsed, query: st.query, searchBody: st.searchBody, highlight: st.highlight });
    list.scrollTop = top;
    if (pane.id && (pane.preset !== d.name || !d.prompt(pane.id) || !wideEdit())) closePane();
    else markPaneRow();
    list.classList.toggle("pa-placing", placing);
    const n = st.selected.size;
    selbar.hidden = n === 0 || placing;
    rootEl?.classList.toggle("pa-selecting", !selbar.hidden);
    movebar.hidden = !placing;
    movebar.classList.toggle("pa-movebar-ng", st.mode === "newgroup");
    page.querySelector(".pa-selcount").textContent = `已选 ${n} 条`;
    page.querySelector(".pa-move-n").textContent = st.mode === "newgroup" ? `新分组「${st.newName}」的位置` : `移动 ${n} 条`;
    page.querySelector(".pa-move-hint").textContent = st.mode === "newgroup" ? "点组名：放在该组之后。点条目：放在该条目之后。" : "点组名：移到该组之后。展开分组后点条目：移入组内。";
    movebar.querySelectorAll("[data-mv=up], [data-mv=down], [data-mv=end]").forEach((b) => { b.hidden = st.mode === "newgroup"; });
    page.querySelector("[data-tool=fold]").textContent = allFolded(d) ? "全部展开" : "全部折叠";
    const co = page.querySelector("[data-tool=clickorder]");
    co.textContent = `多选排列：${settings().keepClickOrder ? "按点选先后" : "保持原顺序"}`;
    co.title = "移动、建组时，多选条目按什么先后排列。点击切换";
    if (st.highlight.size) {
      const first = list.querySelector(".pa-flash");
      scrollToView(first);
      setTimeout(() => {
        st.highlight.clear();
        list.querySelectorAll(".pa-flash").forEach((x) => x.classList.remove("pa-flash"));
      }, 1600);
    }
  }
  // 2.3.6 只改选中状态时不重建整个列表：直接改各行、各组的勾选样式和底栏
  function paintSel() {
    const d = draft();
    list.querySelectorAll(".pa-row[data-id]").forEach((r) => r.classList.toggle("pa-sel", st.selected.has(r.dataset.id)));
    list.querySelectorAll(".pa-group[data-gid]:not(.pa-gempty-box)").forEach((sec) => {
      const gid = sec.dataset.gid;
      const ids = d.order.filter((o) => d.groupOf(o.identifier) === gid).map((o) => o.identifier);
      const all = ids.length > 0 && ids.every((i) => st.selected.has(i));
      sec.classList.toggle("pa-gsel", all);
      sec.querySelector(":scope > .pa-ghead [data-act=gselect]")?.setAttribute("aria-pressed", String(all));
    });
    const n = st.selected.size;
    selbar.hidden = n === 0;
    rootEl?.classList.toggle("pa-selecting", !selbar.hidden);
    page.querySelector(".pa-selcount").textContent = `已选 ${n} 条`;
    if (!n) return;
    const vis = visibleRows();
    const allSel = vis.length && vis.every((id) => st.selected.has(id));
    page.querySelector('[data-sel="all"]').textContent = allSel ? "取消全选" : "全选";
    page.querySelector(".pa-selcancel").hidden = !!allSel;
    // 所选全部开着时按钮为「关闭」，否则为「开启」
    const allOn = [...st.selected].every((id) => d.order.find((o) => o.identifier === id)?.enabled !== false);
    const tg = page.querySelector(".pa-seltoggle");
    tg.dataset.sel = allOn ? "off" : "on";
    tg.textContent = allOn ? "关闭" : "开启";
  }
  const visibleRows = () => [...list.querySelectorAll(".pa-row[data-id]")].filter((r) => !r.closest(".pa-collapsed")).map((r) => r.dataset.id);
  const ordered = () => {
    const d = draft();
    return settings().keepClickOrder ? [...st.selected] : d.sortByOrder([...st.selected]);
  };
  // gid：放进哪个组；null＝放在组外（整组选中的分组保持成组）
  function doMove(where, gid, label = "移动") {
    const d = draft();
    const ids = ordered();
    mutate(d, label, (x) => x.place(ids, where, gid, { keep: st.keep }));
    st.mode = null;
    st.keep = [];
    st.selected.clear();
    if (gid) setOpen(d, gid, true);
    toast(`已移动 ${ids.length} 条`, "success");
    flash(ids);
    render();
  }
  function flash(ids) {
    ids.forEach((i) => st.highlight.add(i));
  }
  function showGroup(gid) {
    setOpen(draft(), gid, true);
    render();
    scrollToView(list.querySelector(`.pa-group[data-gid="${CSS.escape(gid)}"]`));
  }
  // 新建空白分组：先起名，再点位置
  async function startNewGroup() {
    const name = await promptBox("新分组名称", "", "例如：文风");
    if (!name) return;
    st.newName = name;
    st.mode = "newgroup";
    render();
  }
  function placeNewGroup(m) {
    const d = draft();
    const p = placeOf(d, m);
    const anchor = p.where.index === 0 ? "" : p.where.after;
    let gid = null;
    mutate(d, `新建分组「${st.newName}」`, (x) => { gid = x.createEmptyGroup(st.newName, anchor); });
    toast(`已新建分组「${st.newName}」`, "success");
    st.mode = null;
    showGroup(gid);
  }
  list.addEventListener("click", async (e) => {
    if (e.target.closest("[data-repair-groups]")) return repairGroups(draft());
    if (e.target.closest("[data-act=qbody]")) {
      st.searchBody = !st.searchBody;
      return render();
    }
    if (e.target.closest("[data-dup=keep]")) {
      if (!settings().mirrorIgnore || typeof settings().mirrorIgnore !== "object") settings().mirrorIgnore = {};
      settings().mirrorIgnore[draft().name] = true;
      saveSettings();
      toast("这个预设里的 entryGrouping 保留，不再提示；焦香鸡翅保存时也不再动它", "success");
      return render();
    }
    if (e.target.closest("[data-dup=fix]")) {
      if (settings().mirrorIgnore) delete settings().mirrorIgnore[draft().name];
      const d = draft();
      const n = d.dupEntryGroups().length;
      mutate(d, "去掉重复的分组", (x) => {
        const dupKeys = new Set(x.dupEntryGroups().map((g) => `${g.id}|${g.name}`));
        const eg = x.preset.extensions.entryGrouping.filter((g) => !g || !dupKeys.has(`${g.id}|${g.name}`));
        if (eg.length) x.preset.extensions.entryGrouping = eg;
        else delete x.preset.extensions.entryGrouping;
      });
      if (!settings().mirrorFixed || typeof settings().mirrorFixed !== "object") settings().mirrorFixed = {};
      settings().mirrorFixed[d.name] = Date.now();
      saveSettings();
      toast(`已去掉 ${n} 个重复的分组`, "success");
      return;
    }
    const d = draft();
    const actEl = e.target.closest("[data-act]");
    const act = actEl?.dataset.act;
    const rowEl = e.target.closest(".pa-row");
    const head = e.target.closest(".pa-ghead");
    if (act === "drag" || act === "gdrag") return;
    if (e.target.closest(".pa-switch") && act !== "toggle" && act !== "gtoggle") return;
    if (act === "toggle") {
      patchNext = { kind: "row", id: rowEl.dataset.id };
      mutate(d, "开关", (x) => x.setEnabled([rowEl.dataset.id], actEl.checked));
      return;
    }
    if (act === "peek") {
      e.stopPropagation();
      return peek(d, rowEl.dataset.id);
    }
    if (st.mode && act === "collapse" && head) {
      const gid = head.dataset.gid;
      setOpen(d, gid, st.collapsed.has(gid));
      return render();
    }
    if (st.mode) {
      const m = placeFromClick(d, e, st.mode !== "newgroup");
      if (!m) return;
      if (st.mode === "newgroup") return placeNewGroup(m);
      if (m.at === "row" && st.selected.has(m.id)) return toast("不能移到自身之后");
      if (m.at === "block" && m.id) {
        const b = d.blocks().find((x) => x.ids.includes(m.id));
        if (b?.ids.every((i) => st.selected.has(i))) return toast("不能移到自身之后");
      }
      const p = placeOf(d, m);
      return doMove(p.where, p.gid, m.at === "block" ? "移到组后" : m.at === "gstart" ? "移入分组" : m.at === "top" ? "移到最前" : "移动");
    }
    if (head) {
      const gid = head.dataset.gid;
      if (act === "collapse" || !act) {
        setOpen(d, gid, st.collapsed.has(gid));
        return render();
      }
      if (act === "gtoggle") {
        patchNext = { kind: "group", gid };
        mutate(d, "分组开关", (x) => x.setGroupEnabled(gid, actEl.checked));
        return;
      }
      if (act === "gmenu") return groupMenu(d, gid);
      if (act === "gselect") {
        const ids = d.order.filter((o) => d.groupOf(o.identifier) === gid).map((o) => o.identifier);
        const all = ids.every((i) => st.selected.has(i));
        ids.forEach((i) => all ? st.selected.delete(i) : st.selected.add(i));
        return paintSel();
      }
      return;
    }
    if (rowEl) {
      const id = rowEl.dataset.id;
      st.selected.has(id) ? st.selected.delete(id) : st.selected.add(id);
      paintSel();
    }
  });
  onSearchInput(search, () => {
    if (!search.value.trim()) st.searchBody = false;
    st.query = search.value;
    render();
  });
  page.querySelector(".pa-toolbar").addEventListener("click", async (e) => {
    let t = e.target.closest("[data-tool]")?.dataset.tool;
    if (!t) return;
    const d = draft();
    if (t === "menu") {
      const keep = settings().keepClickOrder;
      t = await pickBox("工具", [
        { label: "智能分组", sub: "识别未分组条目的归属，或归整分散分区", value: "smart" },
        { label: allFolded(d) ? "全部展开" : "全部折叠", value: "fold" },
        { label: `多选排列：${keep ? "按点选先后" : "保持原顺序"}`, sub: "移动、建组时，多选条目按什么先后排列。点击切换", value: "clickorder" }
      ]);
      if (!t) return;
    }
    if (t === "search" || t === "searchclose") {
      const row = page.querySelector(".pa-findrow");
      row.hidden = t === "searchclose" || !row.hidden;
      if (row.hidden) {
        search.value = "";
        if (st.query) {
          st.query = "";
          render();
        }
      }
      if (!row.hidden) search.focus();
      return;
    }
    if (t === "add") {
      t = await pickBox("新建", [
        { label: "＋ 新建条目", sub: "放在选中的条目之后；没选时放在最后", value: "newentry" },
        { label: "＋ 新建分组", sub: "先起名，再点一个位置", value: "newgroup" }
      ]);
      if (!t) return;
    }
    if (t === "newgroup") return startNewGroup();
    if (t === "newentry") return newEntry();
    if (t === "clickorder") {
      settings().keepClickOrder = !settings().keepClickOrder;
      saveSettings();
      toast(`多选排列：${settings().keepClickOrder ? "按点选先后" : "保持原顺序"}`);
      return render();
    }
    if (t === "fold") {
      const openAll = allFolded(d);
      d.groups.groups.forEach((g) => setOpen(d, g.id, openAll));
      render();
    }
    if (t === "smart") smartGroups(d);
  });
  movebar.addEventListener("click", (e) => {
    const a = e.target.closest("[data-mv]")?.dataset.mv;
    if (a === "cancel") {
      if (st.mode === "move") st.selected.clear();
      st.mode = null;
      st.keep = [];
      return render();
    }
    if (st.mode !== "move") return;
    if (a === "end") doMove({ index: draft().order.length }, null, "移到最后");
    if (a === "up" || a === "down") {
      const ids = ordered();
      mutate(draft(), "移动", (x) => x.moveStep(ids, a === "up" ? -1 : 1));
      flash(ids);
      render();
    }
  });
  selbar.addEventListener("click", async (e) => {
    const a = e.target.closest("[data-sel]")?.dataset.sel;
    if (!a) return;
    const ids = ordered();
    if (a === "none") {
      st.selected.clear();
      return paintSel();
    }
    if (a === "all") {
      // 只选看得见的：折叠分组里的条目不选，免得接着「关闭」「删除」动到看不见的条目；已全选时再点为取消全选
      const vis = visibleRows();
      if (vis.length && vis.every((id) => st.selected.has(id))) st.selected.clear();
      else vis.forEach((id) => st.selected.add(id));
      return paintSel();
    }
    if (a === "more") {
      const v = await pickBox(`已选 ${ids.length} 条`, [
        { label: "建成分组…", value: "newgroup" },
        { label: "移入分组…", value: "intogroup" },
        { label: "移出分组", value: "ungroup" },
        { label: "按变量名排序…", sub: "按条目登记的变量名（如 文风1、文风2）分类，类别内按编号排", value: "sorttags" }
      ]);
      if (!v) return;
      return selAction(v);
    }
    return selAction(a);
  });
  async function selAction(a) {
    const d = draft();
    const ids = ordered();
    if (a === "newgroup") {
      const name = await promptBox("新分组名称", "", "例如：文风");
      if (!name) return;
      let gid = null;
      mutate(d, "建成分组", (x) => { gid = x.createGroup(name, ids, { keepClickOrder: settings().keepClickOrder }); });
      st.selected.clear();
      flash(ids);
      toast(`已建成分组「${name}」`, "success");
      return showGroup(gid);
    }
    if (a === "intogroup") {
      const groups = d.groups.groups.filter((g) => !d.isEmptyGroup(g.id) || g.anchor !== void 0).map((g) => ({ label: g.name, sub: `${d.order.filter((o) => d.groupOf(o.identifier) === g.id).length} 条`, value: g.id }));
      groups.push({ label: "＋ 新建分组…", value: "__new" });
      const gid = await pickBox("移入分组", groups, { hint: "条目排在组内最后" });
      if (!gid) return;
      if (gid === "__new") return selAction("newgroup");
      mutate(d, "移入分组", (x) => x.moveIntoGroup(ids, gid, { keepClickOrder: settings().keepClickOrder }));
      st.selected.clear();
      flash(ids);
      setOpen(d, gid, true);
      return render();
    }
    if (a === "sorttags") {
      await sortTagsDialog(d, ids);
      return render();
    }
    if (a === "moveto") {
      st.mode = "move";
      st.keep = [];
      return render();
    }
    if (a === "on" || a === "off") {
      mutate(d, a === "on" ? "批量开启" : "批量关闭", (x) => x.setEnabled(ids, a === "on"));
      return paintSel();
    }
    if (a === "copy") {
      if (ids.some((id) => d.isMarker(id))) return toast("系统位置条目（如聊天记录、角色描述）不能复制", "warning");
      let made = [];
      mutate(d, `复制 ${ids.length} 条`, (x) => {
        for (const id of [...ids].reverse()) {
          const p = x.prompt(id);
          const on = x.order.find((o) => o.identifier === id)?.enabled !== false;
          made.push(...x.insertPrompts([{ prompt: { ...clone(p), identifier: uid(), name: `${p.name || id}（副本）` }, enabled: on }], { after: id }, x.groupOf(id)));
        }
      });
      st.selected.clear();
      flash(made);
      toast(`已复制 ${made.length} 条`, "success");
      return render();
    }
    if (a === "ungroup") {
      mutate(d, "移出分组", (x) => x.removeFromGroup(ids));
      return;
    }
    if (a === "delete") {
      if (ids.some((id) => d.isMarker(id))) return toast("选中的条目包含系统位置条目（如聊天记录、角色描述），不能删除", "warning");
      if (!await confirmBox("删除条目", `删除选中的 ${ids.length} 条？可撤销${backupOn() ? "，也可从备份恢复" : ""}。`, "删除", true)) return;
      mutate(d, "删除", (x) => x.deletePrompts(ids));
      st.selected.clear();
      return render();
    }
  }
  async function groupMenu(d, gid) {
    const g = d.group(gid);
    if (d.isEmptyGroup(gid)) {
      const v2 = await pickBox(`分组「${g?.name}」`, [{ label: "重命名", value: "rename" }, { label: "删除空分组", value: "dissolve" }]);
      if (v2 === "rename") {
        const name = await promptBox("分组名称", g.name);
        if (name) mutate(d, "重命名分组", (x) => x.renameGroup(gid, name));
      }
      if (v2 === "dissolve") mutate(d, "删除空分组", (x) => x.dissolveGroup(gid));
      return;
    }
    const parts = d.blocks().filter((b) => b.groupId === gid).length;
    const items = [
      { label: "重命名", value: "rename" },
      { pair: [{ label: "组内全部开启", value: "allon" }, { label: "组内全部关闭", value: "alloff" }] },
      { label: "移动整组…", sub: "再点目标位置", value: "move" },
      { pair: [{ label: "↑ 上移一位", value: "up" }, { label: "↓ 下移一位", value: "down" }] }
    ];
    if (parts > 1) items.push({ label: `合并分散的 ${parts} 段`, value: "gather" });
    items.push({ label: "解散分组", sub: "条目保留在原位置", value: "dissolve" });
    const v = await pickBox(`分组「${g?.name}」`, items);
    if (!v) return;
    if (v === "rename") {
      const name = await promptBox("分组名称", g.name);
      if (name) mutate(d, "重命名分组", (x) => x.renameGroup(gid, name));
    }
    if (v === "move") {
      st.selected = new Set(d.order.filter((o) => d.groupOf(o.identifier) === gid).map((o) => o.identifier));
      st.keep = [gid];
      st.mode = "move";
      render();
    }
    if (v === "gather") return repairGroups(d, gid);
    // 组内每条的开关一起开或关（分组标题上的开关只管分组本身）
    if (v === "allon" || v === "alloff") {
      const ids = d.order.filter((o) => d.groupOf(o.identifier) === gid).map((o) => o.identifier);
      mutate(d, v === "allon" ? "组内全部开启" : "组内全部关闭", (x) => x.setEnabled(ids, v === "allon"));
      toast(`「${g.name}」组内 ${ids.length} 条已全部${v === "allon" ? "开启" : "关闭"}`, "success");
    }
    if (v === "up" || v === "down") mutate(d, "移动分组", (x) => x.moveGroupBlock(gid, v === "up" ? -1 : 1));
    if (v === "dissolve" && await confirmBox("解散分组", `解散「${g.name}」？条目保留在原位置。`, "解散")) mutate(d, "解散分组", (x) => x.dissolveGroup(gid));
  }
  // 新建条目：先起名，放在选中的那条后面（没选就放最后），然后打开编辑
  async function newEntry() {
    const d = draft();
    const name = await promptBox("新条目名称", "", "例如：文风·简洁");
    if (!name) return;
    const sel = ordered();
    const after = sel.length ? sel[sel.length - 1] : null;
    let id = null;
    mutate(d, `新建条目「${name}」`, (x) => {
      const where = after ? { after } : { index: x.order.length };
      [id] = x.insertPrompts([{ prompt: { identifier: uid(), name, content: "", role: "system", system_prompt: false, marker: false, injection_position: 0, injection_depth: 4, injection_order: 100, injection_trigger: [], forbid_overrides: false }, enabled: true }], where, after ? x.groupOf(after) : null);
    });
    st.selected.clear();
    const g = d.groupOf(id);
    if (g) setOpen(d, g, true);
    flash([id]);
    render();
    return peek(getDraft(d.name), id);
  }
  // 2.7.2 宽屏（≥1000px）在右侧编辑栏里编辑，列表不被遮住；手机仍用弹窗
  const paneEl = page.querySelector(".pa-editpane");
  let pane = { id: null, preset: null, form: null };
  const wideEdit = () => matchMedia("(min-width: 1000px)").matches;
  function markPaneRow() {
    list.querySelectorAll(".pa-row.pa-editing").forEach((r) => r.classList.remove("pa-editing"));
    if (pane.id) list.querySelector(`.pa-row[data-id="${CSS.escape(pane.id)}"]`)?.classList.add("pa-editing");
  }
  function closePane() {
    // 光标在编辑栏里时，关闭后回到这一条的「查看或编辑」按钮，键盘操作不断开
    const back = paneEl.contains(document.activeElement) ? pane.id : null;
    pane = { id: null, preset: null, form: null };
    paneEl.hidden = true;
    paneEl.replaceChildren();
    page.classList.remove("pa-edit-open");
    markPaneRow();
    if (back) list.querySelector(`.pa-row[data-id="${CSS.escape(back)}"] [data-act="peek"]`)?.focus({ preventScroll: true });
  }
  async function openPane(d, id, { force = false } = {}) {
    if (!force && pane.form?.dirty() && pane.id !== id && !await confirmBox("放弃未保存的修改", `「${paneEl.querySelector(".pa-editpane-head b")?.textContent || ""}」的修改尚未保存。`, "放弃修改", true, "继续编辑")) return;
    const p = d.prompt(id);
    if (!p) return closePane();
    const form = entryForm(p, { marker: d.isMarker(id) });
    pane = { id, preset: d.name, form };
    paneEl.innerHTML = `<div class="pa-editpane-head"><b></b><button class="pa-icon-btn" data-ep="x" aria-label="关闭编辑栏" title="关闭"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
      <div class="pa-editpane-body"></div>
      <div class="pa-editpane-foot"><button class="pa-btn" data-ep="close">取消</button><button class="pa-btn pa-btn-primary" data-ep="save">保存</button></div>`;
    paneEl.querySelector(".pa-editpane-head b").textContent = p.name || id;
    paneEl.querySelector(".pa-editpane-body").append(form.body);
    paneEl.hidden = false;
    page.classList.add("pa-edit-open");
    markPaneRow();
  }
  function savePane() {
    const dd = getDraft(pane.preset);
    const cur = dd?.prompt(pane.id);
    if (!cur) {
      toast("条目已不存在，未保存", "warning");
      return closePane();
    }
    const next = entryChanges(cur, pane.form.read());
    if (next) {
      const id = pane.id;
      mutate(dd, "编辑条目", (x) => Object.assign(x.prompt(id), next));
      toast("已保存", "success");
    }
    openPane(getDraft(pane.preset), pane.id, { force: true });
  }
  // ✕ 和 Esc：有没保存的修改时先问；「取消」直接放弃
  let paneAsking = false;
  paneEl.addEventListener("click", async (e) => {
    const a = e.target.closest("[data-ep]")?.dataset.ep;
    if (a === "close") closePane();
    else if (a === "save") savePane();
    else if (a === "x") {
      if (paneAsking) return;
      if (pane.form?.dirty()) {
        paneAsking = true;
        const ok = await confirmBox("放弃未保存的修改", `「${paneEl.querySelector(".pa-editpane-head b")?.textContent || ""}」的修改尚未保存。`, "放弃修改", true, "继续编辑");
        paneAsking = false;
        if (!ok) return;
      }
      closePane();
    }
  });
  async function peek(d, id) {
    const p = d.prompt(id);
    if (!p) return;
    if (wideEdit()) return openPane(d, id);
    const r = await editEntrySheet(p, { marker: d.isMarker(id) });
    if (!r) return;
    // 弹窗开着时草稿可能被换过（切换预设、别处修改），按名称重新取
    const dd = getDraft(d.name);
    const cur = dd.prompt(id);
    if (!cur) return toast("条目已不存在，未保存", "warning");
    const next = entryChanges(cur, r);
    if (!next) return;
    mutate(dd, "编辑条目", (x) => Object.assign(x.prompt(id), next));
    toast("已保存", "success");
  }
  async function repairGroups(d, groupId) {
    const fragments = fragmentedGroups(d).filter((g) => !groupId || g.groupId === groupId);
    if (!fragments.length) return toast("没有需要归整的分散分区");
    const original = JSON.stringify(d.toPreset());
    const positions = new Map(d.order.map((o, i) => [o.identifier, i + 1]));
    const body = el(`<div><p class="pa-hint">按已有分组归属，把同组条目集中到该组首次出现的位置。保留组内先后、条目正文和开关。此操作会调整预设的条目顺序，请核对预览后应用；之后可撤销。</p>
      <div class="pa-sug">${fragments.map((g, i) => `<label class="pa-sug-item"><span class="pa-inline-check"><input type="checkbox" data-gather="${i}" checked></span><span class="pa-sug-main"><b>${esc(g.name)}</b><small>${g.parts} 段 · ${g.ids.length} 条 · 汇到「${esc(d.prompt(g.ids[0])?.name || g.ids[0])}」所在首段</small></span></label>`).join("")}</div>
      <div data-group-preview></div></div>`);
    const selected = () => fragments.filter((g, i) => body.querySelector(`[data-gather="${i}"]`).checked).map((g) => g.groupId);
    const paint = () => {
      const plan = planGroupGather(d, selected());
      body.querySelector("[data-group-preview]").innerHTML = `<p class="pa-hint">${plan.groups.length ? `将归整 ${plan.groups.length} 个分区，共 ${plan.groups.reduce((n, g) => n + g.ids.length, 0)} 条成员。` : "未选择分区，不会移动条目。"}只按已有归属归整；未分组条目不会被猜测归类。</p><details><summary>查看归整后的完整顺序（${plan.order.length} 条）</summary><ol class="pa-group-preview">${plan.order.map((o, i) => `<li data-preview-id="${esc(o.identifier)}"><b>${esc(d.prompt(o.identifier)?.name || o.identifier)}</b><small>${esc(d.group(d.groupOf(o.identifier))?.name || "未分组")} · 原第 ${positions.get(o.identifier)} 条 → 第 ${i + 1} 条 · ${o.enabled === false ? "关闭" : "开启"}</small></li>`).join("")}</ol></details>`;
      const apply = body.closest(".pa-sheet")?.querySelector(".pa-btn-primary");
      if (apply) apply.disabled = plan.groups.length === 0;
    };
    body.addEventListener("change", paint);
    const result = await sheet({ title: "归整分散分区", body, wide: true, noFocus: true, onMount: paint, actions: [{ label: "取消", value: null }, { label: "应用归整", kind: "primary", value: selected }] });
    if (!result?.length) return;
    if (focusPreset() !== d.name || getDraft(d.name) !== d || JSON.stringify(d.toPreset()) !== original) return toast("预设已变化，请重新预览归整", "warning");
    const plan = planGroupGather(d, result);
    if (!plan.groups.length) return;
    mutate(d, "归整分散分区", (x) => { findOrderList(x.preset).order = plan.order; });
    toast(`已归整 ${plan.groups.length} 个分区，可撤销`, "success");
    render();
  }
  async function smartGroups(d) {
    const fragments = fragmentedGroups(d);
    if (fragments.length) {
      const mode = await pickBox("智能分组", [
        { label: `归整分散的 ${fragments.length} 个分区`, sub: "按已有归属集中到各组首段，先预览再应用", value: "gather" },
        { label: "识别未分组条目并归入分区", sub: "识别分区标记，可移入已有分区或新建", value: "new" }
      ]);
      if (!mode) return;
      if (mode === "gather") return repairGroups(d);
    }
    const scan = groupingSuggestions(d), rows = [...scan.suggestions, ...scan.unassigned];
    if (!rows.length) return toast("当前没有待归组的条目");
    const original = JSON.stringify(d.toPreset());
    const positions = new Map(d.order.map((o, i) => [o.identifier, i + 1]));
    const rowHtml = (g, i) => {
      const target = g.targetGroupId ? `group:${g.targetGroupId}` : g.needsChoice ? "choose" : "new";
      return `<div class="pa-sug-item" data-grouping-row="${i}"><label class="pa-inline-check"><input type="checkbox" data-grouping-on="${i}" ${g.needsChoice ? "" : "checked"} aria-label="采用${esc(g.name)}的归组建议"></label><div class="pa-sug-main"><b>${esc(g.name)} · ${g.ids.length} 条</b><small title="${esc(g.reason)}">${esc(g.reason)}</small>
        <label>归入分区 <select class="pa-select" data-grouping-target="${i}"><option value="choose" ${target === "choose" ? "selected" : ""}>请选择目标</option><option value="new" ${target === "new" ? "selected" : ""}>＋ 新建分组</option>${d.groups.groups.map((group) => `<option value="group:${esc(group.id)}" ${target === `group:${group.id}` ? "selected" : ""}>${esc(group.name)}</option>`).join("")}</select></label>
        <input class="pa-input pa-input-s" data-grouping-name="${i}" value="${esc(g.name)}" maxlength="120" aria-label="新分组名称" ${target === "new" ? "" : "hidden"}>
        <details><summary>查看 ${g.ids.length} 条成员</summary><ul>${g.ids.map((id) => `<li>${esc(d.prompt(id)?.name || id)}</li>`).join("")}</ul></details></div></div>`;
    };
    const body = el(`<div><p class="pa-hint">识别分区标题、明确分类前缀和组内共用变量，可移入已有分区，也可新建。先核对目标与完整顺序；移入已有分区时会收拢该分区的分散成员，应用后可撤销。</p>
      ${scan.suggestions.length ? `<div class="pa-sug">${scan.suggestions.map(rowHtml).join("")}</div>` : '<p class="pa-hint">暂未识别出明确归属，下面仍可手动指定目标分区。</p>'}
      ${scan.unassigned.length ? `<details data-grouping-unassigned><summary>未识别归属的 ${scan.unassigned.length} 条（可手动指定）</summary><p class="pa-hint">默认保持未分组。选择目标后会勾选该条目，应用前仍可取消。</p><div class="pa-sug">${scan.unassigned.map((g, i) => rowHtml(g, i + scan.suggestions.length)).join("")}</div></details>` : ""}
      <div data-grouping-preview></div></div>`);
    let plan = null;
    const paint = () => {
      const choices = []; let invalid = false;
      rows.forEach((g, i) => {
        const target = body.querySelector(`[data-grouping-target="${i}"]`).value;
        const name = body.querySelector(`[data-grouping-name="${i}"]`);
        name.hidden = target !== "new";
        if (!body.querySelector(`[data-grouping-on="${i}"]`).checked) return;
        if (target === "choose" || target === "new" && !name.value.trim()) { invalid = true; return; }
        choices.push({ ids: g.ids, name: name.value.trim(), targetGroupId: target.startsWith("group:") ? target.slice(6) : null });
      });
      const preview = body.querySelector("[data-grouping-preview]");
      plan = null;
      try {
        if (invalid) throw new Error("请为已勾选的建议选择目标，并填写新分组名称");
        plan = planGroupingAssignments(d, choices);
        const names = new Map(plan.groups.groups.map((g) => [g.id, g.name]));
        preview.innerHTML = `<p class="pa-hint">将归组 ${plan.assignedIds.length} 条，新建 ${plan.newGroupIds.length} 个分区。未勾选的条目保留原有归属。</p><details><summary>查看应用后的完整顺序（${plan.order.length} 条）</summary><ol class="pa-group-preview">${plan.order.map((o, i) => `<li data-grouping-preview-id="${esc(o.identifier)}"><b>${esc(d.prompt(o.identifier)?.name || o.identifier)}</b><small>${esc(names.get(plan.groups.prompts[o.identifier]?.groupId) || "未分组")} · 原第 ${positions.get(o.identifier)} 条 → 第 ${i + 1} 条 · ${o.enabled === false ? "关闭" : "开启"}</small></li>`).join("")}</ol></details>`;
      } catch (e) { preview.textContent = e.message; }
      const apply = body.closest(".pa-sheet")?.querySelector(".pa-btn-primary");
      if (apply) apply.disabled = !plan?.assignedIds.length;
    };
    body.addEventListener("change", (e) => {
      if (e.target.matches("[data-grouping-target]")) body.querySelector(`[data-grouping-on="${e.target.dataset.groupingTarget}"]`).checked = e.target.value !== "choose";
      paint();
    });
    body.addEventListener("input", (e) => { if (e.target.matches("[data-grouping-name]")) paint(); });
    const result = await sheet({ title: "识别并归入分区", body, wide: true, noFocus: true, onMount: paint, actions: [{ label: "取消", value: null }, { label: "应用分组", kind: "primary", value: () => plan }] });
    if (!result?.assignedIds.length) return;
    if (focusPreset() !== d.name || getDraft(d.name) !== d || JSON.stringify(d.toPreset()) !== original) return toast("预设已变化，请重新识别分区", "warning");
    mutate(d, "识别并归入分区", (x) => { findOrderList(x.preset).order = result.order; x.groups = result.groups; });
    result.newGroupIds.forEach((id) => setOpen(d, id, false));
    toast(`已归组 ${result.assignedIds.length} 条，可撤销`, "success");
    render();
  }
  // ---- 拖动：条目右侧的把手拖条目；分组头右侧的把手拖整个分组
  let drag = null;
  list.addEventListener("pointerdown", (e) => {
    const h = e.target.closest(".pa-handle");
    if (!h || st.mode) return;
    e.preventDefault();
    const d = draft();
    const head = h.closest(".pa-ghead");
    let ids, label, group = null;
    if (head) {
      group = head.dataset.gid;
      ids = d.order.filter((o) => d.groupOf(o.identifier) === group).map((o) => o.identifier);
      label = `分组「${d.group(group)?.name || ""}」`;
      head.closest(".pa-group").classList.add("pa-dragging");
    } else {
      const id = h.closest(".pa-row").dataset.id;
      ids = st.selected.has(id) ? ordered() : [id];
      label = `${d.prompt(id)?.name || id}${ids.length > 1 ? ` 等 ${ids.length} 条` : ""}`;
      ids.forEach((i) => list.querySelector(`.pa-row[data-id="${CSS.escape(i)}"]`)?.classList.add("pa-dragging"));
    }
    const ghost = el(`<div class="pa-ghost">${ICON.grip}<span>${esc(label)}</span></div>`);
    page.append(ghost);
    const line = el('<div class="pa-drop-line"></div>');
    list.append(line);
    drag = { ids, group, ghost, line, target: null, y: e.clientY, x: e.clientX, raf: 0, pid: e.pointerId };
    try {
      h.setPointerCapture(e.pointerId);
    } catch {
    }
    moveGhost(e.clientX, e.clientY);
    drag.raf = requestAnimationFrame(autoScroll);
  });
  // 拖整个分组：只能落在分组之间或散条目之间
  function groupTarget(under, y, lr) {
    const d = draft();
    const sec = under?.closest?.(".pa-group");
    const loose = !sec && under?.closest?.(".pa-loose .pa-row");
    const box = sec || loose;
    if (!box || !list.contains(box) || sec?.dataset.gid === drag.group) return null;
    const r = box.getBoundingClientRect();
    const upper = y < r.top + r.height / 2;
    const lineY = (upper ? r.top - 3 : r.bottom + 3) - lr.top + list.scrollTop;
    if (loose) return { where: upper ? { before: loose.dataset.id } : { after: loose.dataset.id }, gid: null, lineY };
    const hd = sec.querySelector(".pa-ghead");
    const gid = hd.dataset.gid;
    if (upper) return { where: hd.dataset.first ? { before: hd.dataset.first } : d.afterEmpty(gid), gid: null, lineY };
    return { where: hd.dataset.last ? { after: hd.dataset.last } : { ...d.afterEmpty(gid), behind: gid }, gid: null, lineY };
  }
  function moveGhost(x, y) {
    drag.x = x;
    drag.y = y;
    const pr = page.getBoundingClientRect();
    drag.ghost.style.transform = `translate(12px, ${y - pr.top - 18}px)`;
    drag.ghost.style.visibility = "hidden";
    const under = document.elementFromPoint(x, y);
    drag.ghost.style.visibility = "";
    const lr = list.getBoundingClientRect();
    let target = null;
    let lineY = null;
    if (drag.group) {
      target = groupTarget(under, y, lr);
      lineY = target?.lineY ?? null;
    } else {
      const row = under?.closest?.(".pa-row");
      const head = under?.closest?.(".pa-ghead");
      if (row && list.contains(row) && !drag.ids.includes(row.dataset.id)) {
        const r = row.getBoundingClientRect();
        const after = y > r.top + r.height / 2;
        target = { where: after ? { after: row.dataset.id } : { before: row.dataset.id }, gid: draft().groupOf(row.dataset.id) };
        lineY = (after ? r.bottom : r.top) - lr.top + list.scrollTop;
      } else if (head && list.contains(head)) {
        // 组头上半＝放在这组前面（组外）；下半：展开着或空分组＝放进组内最前，折叠着＝这组后面（组外）
        const r = head.getBoundingClientRect();
        const box = head.closest(".pa-group").getBoundingClientRect();
        const upper = y < r.top + r.height / 2;
        const gid = head.dataset.gid;
        const empty = !head.dataset.first;
        const open = !head.closest(".pa-group").classList.contains("pa-collapsed");
        if (empty) {
          target = { where: draft().afterEmpty(gid), gid };
          lineY = r.bottom - lr.top + list.scrollTop;
        } else if (upper) {
          target = { where: { before: head.dataset.first }, gid: null };
          lineY = box.top - lr.top + list.scrollTop - 3;
        } else if (open) {
          target = { where: { before: head.dataset.first }, gid };
          lineY = r.bottom - lr.top + list.scrollTop;
        } else {
          target = { where: { after: head.dataset.last }, gid: null };
          lineY = box.bottom - lr.top + list.scrollTop + 3;
        }
      }
    }
    drag.target = target;
    if (lineY == null) drag.line.style.display = "none";
    else {
      drag.line.style.display = "block";
      drag.line.style.top = `${lineY - 1}px`;
    }
  }
  function autoScroll() {
    if (!drag) return;
    const r = list.getBoundingClientRect();
    const edge = 56;
    let dy = 0;
    if (drag.y < r.top + edge) dy = -Math.ceil((r.top + edge - drag.y) / 4);
    else if (drag.y > r.bottom - edge) dy = Math.ceil((drag.y - (r.bottom - edge)) / 4);
    if (dy) {
      list.scrollTop += dy;
      moveGhost(drag.x, drag.y);
    }
    drag.raf = requestAnimationFrame(autoScroll);
  }
  const endDrag = (commit) => {
    if (!drag) return;
    cancelAnimationFrame(drag.raf);
    drag.ghost.remove();
    drag.line.remove();
    const { ids, target, group } = drag;
    drag = null;
    if (!commit || !target) return render();
    const d = draft();
    if (group && !ids.length) {
      // 空分组：只改它跟在哪一条后面
      const w = target.where;
      const anchor = w.index === 0 ? "" : w.after !== void 0 ? w.after : (() => {
        const k = d.order.findIndex((o) => o.identifier === w.before);
        return k > 0 ? d.order[k - 1].identifier : "";
      })();
      mutate(d, "移动分组", (x) => {
        x.group(group).anchor = anchor;
      });
      return;
    }
    mutate(d, group ? "移动分组" : "拖动", (x) => x.place(ids, target.where, target.gid, { keep: group ? [group] : [] }));
    flash(ids);
  };
  list.addEventListener("pointermove", (e) => {
    if (drag && e.pointerId === drag.pid) {
      e.preventDefault();
      moveGhost(e.clientX, e.clientY);
    }
  });
  list.addEventListener("pointerup", (e) => {
    if (drag && e.pointerId === drag.pid) endDrag(true);
  });
  list.addEventListener("pointercancel", () => endDrag(false));
  // 2.3.6 单条开关、分组开关只改了开关状态：就地改这一行（或这一组）和计数，不重建整个列表
  let patchNext = null;
  function patchSwitch(p) {
    const d = draft();
    if (p.kind === "group") {
      list.querySelectorAll(`.pa-group[data-gid="${CSS.escape(p.gid)}"]`).forEach((sec) => {
        const off = d.groupOff(p.gid);
        sec.classList.toggle("pa-goff", off);
        const box = sec.querySelector(":scope > .pa-ghead [data-act=gtoggle]");
        if (box) box.checked = !off;
      });
      return true;
    }
    const row = list.querySelector(`.pa-row[data-id="${CSS.escape(p.id)}"]`);
    const b = d.blocks().find((x) => x.ids.includes(p.id));
    if (!row || !b) return false;
    const en = new Map(d.order.map((x) => [x.identifier, x.enabled !== false]));
    row.classList.toggle("pa-off", !en.get(p.id));
    const box = row.querySelector("[data-act=toggle]");
    if (box) box.checked = en.get(p.id);
    const count = row.closest(".pa-group")?.querySelector(":scope > .pa-ghead .pa-count");
    if (count) count.textContent = `${b.ids.filter((i) => en.get(i)).length}/${b.ids.length}`;
    return true;
  }
  const off = onDraftChange((name, kind) => {
    const p = patchNext;
    patchNext = null;
    if (kind !== "status" && name === focusPreset() && draftViewVisible(page)) {
      if (p && kind === "content" && patchSwitch(p)) return;
      render();
    }
  });
  return { render: () => {
    picker.refresh();
    render();
  }, destroy: off, focusIds: (ids) => {
    const d = draft();
    ids.forEach((i) => {
      const g = d.groupOf(i);
      if (g) setOpen(d, g, true);
    });
    flash(ids);
    render();
  } };
}
