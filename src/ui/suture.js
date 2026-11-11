var repainting = false;
function repaint(node, html) {
  repainting = true;
  try {
    if (node.isConnected) node.outerHTML = html;
  } finally {
    repainting = false;
  }
}
function sutureEnableTools() {
  return `<div class="pa-field-row pa-enablebar" data-enable-tools role="group" aria-label="本次缝合的开启状态">
    <span data-enable-count aria-live="polite"></span>
    <label class="pa-switch" title="向右全部开启，向左全部关闭；仍可逐条调整"><input type="checkbox" data-enable-toggle aria-label="本次缝后全部开启"><i></i></label>
    <button type="button" class="pa-link" data-enable-source title="每条恢复成来源里的开关状态">按来源</button></div>
    <p class="pa-hint">默认与来源一致：来源里开着的缝后开启，关着的缝后关闭。</p>`;
}
function bindSutureEnableTools(body, items) {
  const tools = body.querySelector("[data-enable-tools]");
  const toggle = tools.querySelector("[data-enable-toggle]");
  const refresh = () => {
    const count = items.filter((it) => it.enabled).length;
    tools.querySelector("[data-enable-count]").textContent = `${count && count < items.length ? "部分开启" : "缝后开启"}：${count} / ${items.length}`;
    toggle.checked = count === items.length;
    toggle.indeterminate = count > 0 && count < items.length;
  };
  toggle.addEventListener("change", () => {
    const on = toggle.checked;
    for (const it of items) it.enabled = on;
    // 仅更新预览选择，不重算写法/思维链，也不改目标预设；确认缝合后才写入。
    body.querySelectorAll(".pa-items [data-c=on]").forEach((input) => { input.checked = on; });
    refresh();
  });
  body.addEventListener("change", (e) => {
    if (e.target.matches(".pa-items [data-c=on]")) refresh();
  });
  const source = tools.querySelector("[data-enable-source]");
  source.addEventListener("click", () => {
    for (const it of items) it.enabled = it.srcEnabled !== false;
    body.querySelectorAll(".pa-items [data-c=on]").forEach((input) => {
      const it = items[Number(input.closest(".pa-item")?.dataset.i)];
      if (it) input.checked = it.enabled;
    });
    refresh();
  });
  refresh();
}
function mountSuture(page, app) {
  const st = {
    srcType: "preset",
    srcPreset: null,
    srcWorld: null,
    fileDraft: null,
    // 2.6.1 文件来源的种类：preset / world / regex；world 时条目在 fileWorld
    fileKind: null,
    fileWorld: null,
    picked: /* @__PURE__ */ new Map(),
    // key -> {name, content, prompt, from}
    // 2.6.4 分组折叠：记展开了哪些组（按分组名，见 foldKeys），其余收起。2.6.5 存进设置（sutureFold），重新加载后保持最后一次的状态
    fold: /* @__PURE__ */ new Map(),
    dstFor: null,
    marker: null,
    newName: null,
    pasteN: 0,
    worldCache: /* @__PURE__ */ new Map(),
    // 1.6.0 目标可以是世界书
    dstType: "preset",
    dstWorld: null,
    wbDraft: null,
    wbMarker: null
  };
  // 2.8.0 两种布局：split 分栏（从、到同屏）；switch 切换（一次只显示一栏，顶部切换）
  const layout = () => settings().sutureLayout === "switch" ? "switch" : "split";
  let side = "src";
  page.innerHTML = `
    <div class="pa-swbar" role="tablist" aria-label="来源与目标"><button type="button" role="tab" data-sw="src">从<small class="pa-sw-n"></small></button><button type="button" role="tab" data-sw="dst">到<small class="pa-sw-pos"></small></button></div>
    <div class="pa-suture pa-compact">
        <div class="pa-pane pa-src">
            <div class="pa-pane-head pa-fromto"><b class="pa-ft">从</b>
                <button class="pa-typebtn" data-st="srctype" type="button" aria-label="来源类型"><span>预设</span><i aria-hidden="true">▾</i></button>
                <div class="pa-src-pick"></div>
                <button class="pa-icon-btn pa-qbtn" data-st="srcsearch" aria-label="搜索来源条目" title="搜索条目">${ICON.search}</button>
                <button class="pa-icon-btn pa-src-menu" data-st="srcmenu" aria-label="更多操作" title="更多操作">⋯</button>
            </div>
            <div class="pa-findrow pa-qrow" data-qside="src" style="${BOX_STYLE.replace("padding:0!important;", "")}" hidden><input class="pa-input pa-find" style="${FIELD_STYLE}" type="search" inputmode="search" enterkeyhint="search" autocorrect="off" spellcheck="false" autocapitalize="off" autocomplete="off" placeholder="搜名称、分组名、标签或正文" aria-label="搜索来源条目"><button type="button" class="pa-icon-btn pa-qx" data-qx="src" aria-label="关闭搜索"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
            <div class="pa-scroll pa-src-list"></div>
        </div>
        <div class="pa-splitter" role="separator" tabindex="0" aria-label="拖动调整两栏大小" title="拖动调整大小"><span></span></div>
        <div class="pa-pane pa-dst">
            <div class="pa-pane-head pa-fromto"><b class="pa-ft">到</b>
                <button class="pa-typebtn" data-st="dsttype" type="button" aria-label="目标类型"><span>预设</span><i aria-hidden="true">▾</i></button>
                <div class="pa-dst-picker"></div>
                <div class="pa-dst-wbslot" hidden></div>
                <button class="pa-icon-btn pa-qbtn" data-st="dstsearch" aria-label="搜索目标条目" title="搜索条目">${ICON.search}</button>
            </div>
            <div class="pa-findrow pa-qrow" data-qside="dst" style="${BOX_STYLE.replace("padding:0!important;", "")}" hidden><input class="pa-input pa-find" style="${FIELD_STYLE}" type="search" inputmode="search" enterkeyhint="search" autocorrect="off" spellcheck="false" autocapitalize="off" autocomplete="off" placeholder="搜名称、分组名、标签或正文" aria-label="搜索目标条目"><button type="button" class="pa-icon-btn pa-qx" data-qx="dst" aria-label="关闭搜索"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
            <div class="pa-scroll pa-dst-list"></div>
        </div>
    </div>
    <div class="pa-stitchbar pa-sbar">
        <div class="pa-stitch-info"><button class="pa-link pa-picked-n" data-st="picked" title="查看已选的条目">未选条目</button><span class="pa-where">未选位置</span></div>
        <button class="pa-btn" data-st="wbundo" hidden>撤销</button>
        <button class="pa-btn" data-st="clear" title="清空已选的条目和缝合位置">清空</button>
        <button class="pa-btn pa-btn-primary" data-st="go" disabled>预览</button>
    </div>
    <div class="pa-stitchbar pa-ngbar" hidden>
        <div class="pa-stitch-info"><b class="pa-ng-n"></b><span>点组名或条目，放在它后面</span></div>
        <button class="pa-btn" data-st="ngcancel">取消</button>
    </div>`;
  const srcPick = page.querySelector(".pa-src-pick");
  const srcList = page.querySelector(".pa-src-list");
  const dstList = page.querySelector(".pa-dst-list");
  const bar = page.querySelector(".pa-sbar");
  const swbar = page.querySelector(".pa-swbar");
  function paintLayout() {
    const sw = layout() === "switch";
    sutureEl.classList.toggle("pa-sw", sw);
    sutureEl.dataset.sw = side;
    swbar.hidden = !sw;
    swbar.querySelectorAll("[data-sw]").forEach((b) => {
      const on = b.dataset.sw === side;
      b.classList.toggle("on", on);
      b.setAttribute("aria-selected", String(on));
    });
  }
  function setSide(v) {
    side = v;
    paintLayout();
  }
  swbar.addEventListener("click", (e) => {
    const b = e.target.closest("[data-sw]");
    if (b) setSide(b.dataset.sw);
  });
  const ngbar = page.querySelector(".pa-ngbar");
  const dstPicker = presetPicker(page.querySelector(".pa-dst-picker"), (name) => {
    st.marker = null;
    setFocusPreset(name);
  }, { label: "" });
  const target = () => getDraft(focusPreset());
  // ---- 上下（宽屏是左右）分区可以拖动调大小，记住比例
  const sutureEl = page.querySelector(".pa-suture");
  const splitter = page.querySelector(".pa-splitter");
  const applySplit = (v) => {
    const r = Math.min(85, Math.max(15, Number(v) || 50));
    sutureEl.style.setProperty("--pa-split", r + "%");
    return r;
  };
  applySplit(settings().sutureSplit ?? 45);
  paintLayout();
  splitter.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    splitter.setPointerCapture(e.pointerId);
    splitter.classList.add("pa-dragging");
    const rect = sutureEl.getBoundingClientRect();
    const vertical = getComputedStyle(sutureEl).gridTemplateColumns.split(" ").length < 3;
    let last = null;
    const move = (ev) => {
      const ratio = vertical ? (ev.clientY - rect.top) / rect.height * 100 : (ev.clientX - rect.left) / rect.width * 100;
      last = applySplit(ratio);
    };
    const up = () => {
      splitter.classList.remove("pa-dragging");
      splitter.removeEventListener("pointermove", move);
      splitter.removeEventListener("pointerup", up);
      splitter.removeEventListener("pointercancel", up);
      if (last != null) {
        settings().sutureSplit = Math.round(last);
        saveSettings();
      }
    };
    splitter.addEventListener("pointermove", move);
    splitter.addEventListener("pointerup", up);
    splitter.addEventListener("pointercancel", up);
  });
  splitter.addEventListener("keydown", (e) => {
    const k = { ArrowUp: -5, ArrowLeft: -5, ArrowDown: 5, ArrowRight: 5 }[e.key];
    if (!k) return;
    e.preventDefault();
    settings().sutureSplit = applySplit((settings().sutureSplit ?? 45) + k);
    saveSettings();
  });
  // 来源类型：预设 / 世界书 / 文件 / 粘贴。2.6.1 菜单里多一项「正则」：打开缝合正则窗口，来源类型不变
  const SRC_TYPES = [["preset", "预设"], ["regex", "正则"], ["world", "世界书"], ["file", "文件"], ["paste", "粘贴"]];
  // 正则文件读入后，来源栏显示正则条数和打开按钮
  const regexSource = () => st.srcType === "file" && st.fileKind === "regex";
  function paintSrcHead() {
    page.querySelector('[data-st="srctype"] span').textContent = SRC_TYPES.find(([k]) => k === st.srcType)[1];
  }
  async function setSrcType(type) {
    if (type === "regex") return regexSuture({ ask: true });
    if (!type || type === st.srcType) return;
    st.srcType = type;
    renderSrcPick();
    renderSrc();
    renderBar();
  }
  function renderSrcPick() {
    paintSrcHead();
    page.querySelector('[data-st="srcsearch"]').hidden = st.srcType === "paste" || regexSource();
    if (st.srcType === "preset") {
      const names = listPresets();
      if (!st.srcPreset || !names.includes(st.srcPreset)) st.srcPreset = names.find((n) => n !== focusPreset()) || names[0];
      srcPick.innerHTML = nameBtnHtml(st.srcPreset, "pa-src-name");
    } else if (st.srcType === "world") {
      const names = listWorldbooks();
      if (!st.srcWorld || !names.includes(st.srcWorld)) st.srcWorld = names[0] || null;
      srcPick.innerHTML = names.length ? nameBtnHtml(st.srcWorld, "pa-src-name") : '<span class="pa-hint">没有世界书</span>';
    } else if (st.srcType === "file") {
      srcPick.innerHTML = `<label class="pa-namebtn pa-file" title="${esc(fileName() || "")}"><span>${esc(fileName() || "选择文件…")}</span><i aria-hidden="true">${ICON.folder}</i><input type="file" accept=".json,application/json,text/plain" hidden></label>`;
    } else {
      srcPick.innerHTML = '<span class="pa-hint pa-src-paste">粘贴一段文字</span>';
    }
  }
  srcPick.addEventListener("click", async (e) => {
    if (!e.target.closest(".pa-src-name")) return;
    if (st.srcType === "preset") {
      const using = currentPresetName();
      const v = await pickName({ title: "从哪个预设", current: st.srcPreset, items: listPresets().map((n) => ({ value: n, sub: n === using ? "使用中" : n === focusPreset() ? "目标" : "" })) });
      if (!v || v === st.srcPreset) return;
      st.srcPreset = v;
    } else if (st.srcType === "world") {
      const v = await pickName({ title: "从哪本世界书", current: st.srcWorld, items: listWorldbooks().map((n) => ({ value: n })) });
      if (!v) return;
      st.srcWorld = v;
      st.worldCache.delete(v); // 每次选择都重新读，酒馆里改过的内容才能看到
    }
    renderSrcPick();
    renderSrc();
  });
  srcPick.addEventListener("change", async (e) => {
    if (e.target.matches("input[type=file]")) {
      const f = e.target.files[0];
      if (!f) return;
      e.target.value = "";
      try {
        const data = JSON.parse((await f.text()).replace(/^\uFEFF/, ""));
        const name = f.name.replace(/\.json$/i, "");
        const got = readSourceFile(name, data);
        Object.assign(st, got);
        renderSrcPick();
        renderSrc();
        renderBar();
        if (st.fileKind === "regex") regexSuture();
      } catch (err) {
        toast("无法读取文件：" + err.message, "error");
      }
    }
  });
  // 2.6.1 文件来源认三种：聊天补全预设（prompts）、世界书（entries，含角色卡内嵌的 character_book）、正则（酒馆导出的单条、多条或 regex_scripts）
  const isRegexScript = (x) => !!x && typeof x === "object" && typeof x.findRegex === "string";
  function readSourceFile(name, data) {
    // 只有正则、没有提示词条目的预设文件按正则文件处理
    if (Array.isArray(data?.prompts) && (data.prompts.length || !data.extensions?.regex_scripts?.length)) return { fileKind: "preset", fileDraft: new Draft(name, data), fileWorld: null };
    const book = data?.entries ?? data?.character_book?.entries ?? data?.data?.character_book?.entries;
    if (book && typeof book === "object") {
      const items = worldItems(`wf:${name}`, Object.values(book));
      if (items.length) return { fileKind: "world", fileDraft: null, fileWorld: { name, items } };
    }
    const scripts = isRegexScript(data) ? [data] : Array.isArray(data) && data.length && data.every(isRegexScript) ? data
      : Array.isArray(data?.regex_scripts) ? data.regex_scripts : Array.isArray(data?.extensions?.regex_scripts) ? data.extensions.regex_scripts : null;
    if (scripts?.length) return { fileKind: "regex", fileDraft: new Draft(name, { prompts: [], extensions: { regex_scripts: scripts } }), fileWorld: null };
    throw new Error("无法识别。支持聊天补全预设、世界书、正则文件");
  }
  const fileName = () => st.fileKind === "world" ? st.fileWorld?.name : st.fileDraft?.name;
  function regexSourceDraft() {
    if (st.srcType === "file") return st.fileKind === "world" ? null : st.fileDraft;
    return st.srcType === "preset" && st.srcPreset ? getDraft(st.srcPreset) : null;
  }
  // 正则来源：列出条数，按钮打开缝合正则窗口
  function renderRegexSrc() {
    let d = null, n = 0;
    try {
      d = regexSourceDraft();
      n = d ? presetRegexList(d).length : 0;
    } catch (e) {
      srcList.innerHTML = `<p class="pa-empty">${esc(e.message)}</p>`;
      return;
    }
    srcList.dataset.kind = "regex";
    if (!d) {
      srcList.innerHTML = `<p class="pa-empty">${st.srcType === "file" ? "请选择文件" : "没有预设"}</p>`;
      return;
    }
    let to = "";
    try { to = st.dstType === "preset" ? target().name : ""; } catch {}
    srcList.innerHTML = `<div class="pa-card pa-rx-src"><b>「${esc(d.name)}」中有 ${n} 条正则</b>
      <p class="pa-hint">${n ? to ? `缝入目标预设「${esc(to)}」，可逐条选择。` : "正则只能缝入预设，请将目标切换为「预设」。" : "文件中没有正则。"}</p>
      ${n && to ? '<div class="pa-card-act"><button class="pa-btn" data-st="regex" type="button">选择正则…</button></div>' : ""}</div>`;
  }
  // 2.6.4 分组折叠按「分组名 + 同名第几个」记，不按分组编号：预设重新读取时，没有编号的分组（entryGrouping）每次分到新编号，
  // 按编号记就对不上，所有组都显示成展开，收起后再进来又展开。记的是展开的组，对不上的一律收起
  function foldKeys(d) {
    const seen = new Map(), out = new Map();
    for (const g of d.groups.groups) {
      const n = seen.get(g.name) || 0;
      seen.set(g.name, n + 1);
      out.set(g.id, `${g.name}\u0001${n}`);
    }
    return out;
  }
  const collapsedFrom = (d, open) => {
    const keys = foldKeys(d);
    return new Set(d.groups.groups.filter((g) => !open.has(keys.get(g.id))).map((g) => g.id));
  };
  function foldStore() {
    const s = settings();
    if (!s.sutureFold || typeof s.sutureFold !== "object" || Array.isArray(s.sutureFold)) s.sutureFold = {};
    return s.sutureFold;
  }
  // key：来源「src:类型:预设名」，目标「dst:预设名」
  function openSetFor(key) {
    if (!st.fold.has(key)) st.fold.set(key, new Set(Array.isArray(foldStore()[key]) ? foldStore()[key] : []));
    return st.fold.get(key);
  }
  function toggleOpen(d, key, gid, on) {
    const k = foldKeys(d).get(gid);
    if (!k) return;
    const open = openSetFor(key);
    if (on ?? !open.has(k)) open.add(k);
    else open.delete(k);
    // 最近改过的排在后面，只留最近 40 个预设的记录
    const store = foldStore();
    delete store[key];
    if (open.size) store[key] = [...open];
    const keys = Object.keys(store);
    for (const x of keys.slice(0, Math.max(0, keys.length - 40))) delete store[x];
    saveSettings();
  }
  // 世界书条目列表（酒馆里的世界书和世界书文件共用）
  function renderWorldRows(items, from) {
    srcList.dataset.kind = "world";
    srcList._items = items;
    srcList._from = from;
    const wq = qOf("src").toLowerCase();
    const shown = wq ? items.filter((it) => String(it.name).toLowerCase().includes(wq) || String(it.content || "").toLowerCase().includes(wq)) : items;
    srcList.innerHTML = qBar("src") + (wq ? `<div class="pa-qsum">匹配 <b>${shown.length}</b> 条（名称或正文）</div>` : "") + `<div class="pa-loose">${shown.map((it) => `<div class="pa-row${st.picked.has(it.id) ? " pa-sel" : ""}${it.enabled ? "" : " pa-off"}" data-wid="${esc(it.id)}" tabindex="0"><span class="pa-check"></span><span class="pa-name">${markText(it.name, wq)}</span><button class="pa-icon-btn pa-peek" data-act="peek" aria-label="查看或编辑" title="查看或编辑">${ICON.eye}</button></div>`).join("") || `<p class="pa-empty">${wq ? "没有匹配的条目" : "没有条目"}</p>`}</div>`;
  }
  async function renderSrc() {
    if (regexSource()) return renderRegexSrc();
    const keyOf = (id) => `${st.srcType}:${st.srcType === "preset" ? st.srcPreset : st.srcType === "file" ? st.fileDraft?.name : ""}:${id}`;
    if (st.srcType === "preset" || st.srcType === "file" && st.fileKind !== "world") {
      let d;
      try {
        d = st.srcType === "preset" ? st.srcPreset ? getDraft(st.srcPreset) : null : st.fileDraft;
      } catch (e) {
        srcList.innerHTML = `<p class="pa-empty">${esc(e.message)}</p>`;
        return;
      }
      if (!d) {
        srcList.innerHTML = `<p class="pa-empty">${st.srcType === "file" ? "请选择文件" : "没有预设"}</p>`;
        return;
      }
      const ck = `${st.srcType}:${d.name}`;
      st.srcFoldKey = `src:${ck}`;
      st.srcCollapsed = collapsedFrom(d, openSetFor(st.srcFoldKey));
      const sel = new Set(d.order.map((o) => o.identifier).filter((id) => st.picked.has(keyOf(id))));
      srcList.innerHTML = qBar("src") + renderList(d, { mode: "source", selected: sel, collapsed: st.srcCollapsed, query: qOf("src"), searchBody: st.srcBody });
      srcList.dataset.kind = "draft";
      srcList._draft = d;
      srcList._keyOf = keyOf;
    } else if (st.srcType === "file" && st.fileKind === "world") {
      renderWorldRows(st.fileWorld.items, `世界书文件 ${st.fileWorld.name}`);
    } else if (st.srcType === "world") {
      if (!st.srcWorld) {
        srcList.innerHTML = '<p class="pa-empty">没有世界书</p>';
        return;
      }
      // 记下发请求时选的是哪本：网慢时用户可能已经换了别的书，旧结果不能记到新书名下
      const wname = st.srcWorld;
      let items = st.worldCache.get(wname);
      if (!items) {
        srcList.innerHTML = '<p class="pa-empty">读取中…</p>';
        try {
          items = await readWorldbook(wname);
          st.worldCache.set(wname, items);
        } catch (e) {
          if (st.srcType === "world" && st.srcWorld === wname) srcList.innerHTML = `<p class="pa-empty">读取失败：${esc(e.message)}</p>`;
          return;
        }
        if (st.srcType !== "world" || st.srcWorld !== wname) return;
      }
      renderWorldRows(items, `世界书 ${wname}`);
    } else {
      srcList.dataset.kind = "paste";
      const pasted = [...st.picked.entries()].filter(([k]) => k.startsWith("paste:"));
      srcList.innerHTML = `<div class="pa-form pa-paste">
                <input class="pa-input" data-p="name" placeholder="条目名称">
                <textarea class="pa-input pa-text pa-text-s" data-p="content" placeholder="条目正文。变量写法会按目标预设自动调整"></textarea>
                <button class="pa-btn pa-btn-soft" data-p="add">加入</button>
                ${pasted.length ? `<p class="pa-hint">已加入：${pasted.map(([, v]) => esc(v.name)).join("、")}</p>` : ""}
            </div>`;
    }
    renderBar();
  }
  srcList.addEventListener("click", async (e) => {
    const qa = e.target.closest("[data-act=qedit],[data-act=qclear],[data-act=qbody]")?.dataset.act;
    if (qa === "qedit") return qRow("src").querySelector("input").focus();
    if (qa === "qclear") { setQuery("src", ""); return saveSettings(); }
    if (qa === "qbody") { st.srcBody = !st.srcBody; return renderSrc(); }
    const kind = srcList.dataset.kind;
    if (kind === "paste") {
      if (e.target.closest("[data-p=add]")) {
        const name = srcList.querySelector("[data-p=name]").value.trim() || `粘贴条目${st.pasteN + 1}`;
        const content = srcList.querySelector("[data-p=content]").value;
        if (!content.trim()) return toast("正文为空");
        st.picked.set(`paste:${++st.pasteN}`, { name, content, prompt: null, from: "粘贴" });
        renderSrc();
      }
      return;
    }
    const peekBtn = e.target.closest("[data-act=peek]");
    if (kind === "world") {
      const r = e.target.closest("[data-wid]");
      if (!r) return;
      const it = srcList._items.find((x) => x.id === r.dataset.wid);
      if (peekBtn) return st.srcType === "file" ? editFileWorldEntry(it) : editWorldEntry(st.srcWorld, it.uid, it.name, it.content);
      st.picked.has(it.id) ? st.picked.delete(it.id) : st.picked.set(it.id, { name: it.name, content: it.content, prompt: null, from: srcList._from, raw: it.raw });
      return renderSrc();
    }
    const d = srcList._draft;
    const head = e.target.closest(".pa-ghead");
    if (head) {
      const gid = head.dataset.gid;
      if (e.target.closest("[data-act=gselect]")) {
        const ids = d.order.filter((o) => d.groupOf(o.identifier) === gid).map((o) => o.identifier).filter((id2) => !d.isMarker(id2));
        const all = ids.every((id2) => st.picked.has(srcList._keyOf(id2)));
        for (const id2 of ids) {
          const k2 = srcList._keyOf(id2);
          if (all) st.picked.delete(k2);
          else {
            const p2 = d.prompt(id2);
            st.picked.set(k2, { name: p2.name, content: p2.content, prompt: p2, from: d.name, srcDraft: d, srcId: id2 });
          }
        }
      } else {
        toggleOpen(d, st.srcFoldKey, gid);
      }
      return renderSrc();
    }
    const row = e.target.closest(".pa-row");
    if (!row) return;
    const id = row.dataset.id;
    const p = d.prompt(id);
    if (peekBtn) return editPresetEntry(d, id);
    if (d.isMarker(id)) return toast("系统位置条目不能缝合");
    const k = srcList._keyOf(id);
    st.picked.has(k) ? st.picked.delete(k) : st.picked.set(k, { name: p.name, content: p.content, prompt: p, from: d.name, srcDraft: d, srcId: id });
    renderSrc();
  });
  // 「查看」弹窗可以直接改（和整理页一样，点了正文才弹键盘）：
  // 已安装预设存回预设（可撤销），文件只改这次读入的内容，世界书写回世界书（写前备份）。已选的条目跟着更新
  function syncPicked(test, patch, rawPatch) {
    for (const v of st.picked.values()) {
      if (!test(v)) continue;
      Object.assign(v, patch);
      if (v.raw && rawPatch) Object.assign(v.raw, rawPatch);
    }
  }
  async function editPresetEntry(d, id) {
    const p = d.prompt(id);
    if (!p) return;
    const file = d === st.fileDraft;
    const r = await editEntrySheet(p, { marker: d.isMarker(id), hint: file ? "只改这次读入的文件内容，不会写回文件。" : `保存后写入预设「${d.name}」，可撤销。` });
    if (!r) return;
    // 弹窗开着时草稿可能被换过（切换预设、别处修改），按名称重新取
    let dd = d;
    if (!file) {
      try { dd = getDraft(d.name); } catch (e) { return toast(e.message, "error"); }
    }
    const cur = dd.prompt(id);
    if (!cur) return toast("条目已不存在，未保存", "warning");
    const next = entryChanges(cur, r);
    if (!next) return;
    if (file) Object.assign(cur, next);
    else mutate(dd, "编辑条目", (x) => Object.assign(x.prompt(id), next));
    syncPicked((v) => v.srcId === id && v.from === dd.name, { name: cur.name, content: cur.content, prompt: cur, srcDraft: dd });
    renderSrc();
    toast("已保存", "success");
  }
  // 2.6.1 世界书文件里的条目：只改这次读入的内容
  async function editFileWorldEntry(it) {
    const r = await editEntrySheet({ name: it.name, content: it.content }, { promptOnly: true, hint: "只改这次读入的文件内容，不会写回文件。" });
    if (!r || r.name === it.name && r.content === it.content) return;
    Object.assign(it, { name: r.name, content: r.content });
    Object.assign(it.raw, { comment: r.name, content: r.content });
    const v = st.picked.get(it.id);
    if (v) Object.assign(v, { name: r.name, content: r.content });
    renderSrc();
    toast("已保存", "success");
  }
  async function editWorldEntry(wname, uid, name, content) {
    const r = await editEntrySheet({ name, content }, { promptOnly: true, hint: `保存后写入世界书「${wname}」。` });
    if (!r || r.name === name && r.content === content) return;
    const fields = { content: r.content };
    if (r.name !== name) fields.comment = r.name;
    try {
      await backupPut(`世界书：${wname}`, await mods.wi.loadWorldInfo(wname), "编辑前");
    } catch (e) {
      if (!await confirmBox("备份失败", `编辑前备份世界书「${wname}」没有成功（${e.message}）。仍要保存吗？`, "仍要保存")) return;
    }
    try {
      await updateWorldEntry(wname, uid, fields);
    } catch (e) {
      return toast("保存失败：" + e.message, "error");
    }
    syncPicked((v) => v.raw && String(v.raw.uid) === String(uid) && v.from === `世界书 ${wname}`, { name: r.name, content: r.content }, fields);
    st.worldCache.delete(wname);
    toast("已保存", "success");
    if (st.srcType === "world" && st.srcWorld === wname) renderSrc();
    if (st.dstType === "world" && st.dstWorld === wname) {
      try { await loadWbDraft(true); } catch {}
      renderDst();
    }
  }
  // 世界书目标：把条目包装成一个只读的「预设」，列表、选位置都沿用预设那一套（没有分组）
  async function loadWbDraft(force = false) {
    const names = listWorldbooks();
    if (!st.dstWorld || !names.includes(st.dstWorld)) st.dstWorld = names[0] || null;
    if (!st.dstWorld) {
      st.wbDraft = null;
      return;
    }
    if (!force && st.wbDraft?.name === st.dstWorld) return;
    const wname = st.dstWorld;
    const data = await mods.wi.loadWorldInfo(wname);
    // 读的时候用户换了别的书：丢掉这次结果
    if (st.dstWorld !== wname) return;
    const list = wiSorted(data);
    const prompts = list.map((e) => ({ identifier: `wb${e.uid}`, name: e.comment || (e.key || []).join(",") || `条目${e.uid}`, content: e.content || "", role: "system", system_prompt: false, marker: false, injection_position: 0 }));
    const dd = new Draft(wname, { prompts, prompt_order: [{ character_id: 100001, order: list.map((e) => ({ identifier: `wb${e.uid}`, enabled: !e.disable })) }] });
    dd.wb = Object.fromEntries(list.map((e) => [`wb${e.uid}`, e]));
    if (st.wbDraft?.name !== wname) st.wbMarker = null;
    st.wbDraft = dd;
    st.wbMarker = fixPlace(dd, st.wbMarker);
  }
  async function renderDstWorld() {
    const slot = page.querySelector(".pa-dst-wbslot");
    try {
      await loadWbDraft();
    } catch (e) {
      dstList.innerHTML = `<p class="pa-empty">读取失败：${esc(e.message)}</p>`;
      return;
    }
    slot.innerHTML = st.dstWorld ? nameBtnHtml(st.dstWorld, "pa-dst-wb") : '<span class="pa-hint">没有世界书</span>';
    const d = st.wbDraft;
    if (!d) {
      dstList.innerHTML = '<p class="pa-empty">没有世界书</p>';
      return renderBar();
    }
    const top = dstList.scrollTop;
    dstList.classList.add("pa-placing");
    dstList.innerHTML = qBar("dst") + renderList(d, { mode: "target", place: true, inside: false, collapsed: new Set(), marker: st.wbMarker, markLabel: "缝合位置", highlight: st.highlight || void 0, query: qOf("dst"), searchBody: st.dstBody });
    bar.hidden = false;
    ngbar.hidden = true;
    dstList.scrollTop = top;
    renderBar();
  }
  // 目标类型：预设 / 世界书
  function setDstType(type) {
    if (!type || type === st.dstType) return;
    st.dstType = type;
    st.newName = null;
    page.querySelector('[data-st="dsttype"] span').textContent = type === "world" ? "世界书" : "预设";
    page.querySelector(".pa-dst-picker").hidden = type !== "preset";
    page.querySelector(".pa-dst-wbslot").hidden = type !== "world";
    renderSrcPick();
    renderDst();
  }
  page.querySelector(".pa-dst-wbslot").addEventListener("click", async (e) => {
    if (!e.target.closest(".pa-dst-wb")) return;
    const v = await pickName({ title: "到哪本世界书", current: st.dstWorld, items: listWorldbooks().map((n) => ({ value: n })) });
    if (!v || v === st.dstWorld) return;
    st.dstWorld = v;
    st.wbMarker = null;
    renderDst();
  });
  function renderDst() {
    if (st.dstType === "world") return renderDstWorld();
    let d;
    try {
      d = target();
    } catch (e) {
      dstList.innerHTML = `<p class="pa-empty">${esc(e.message)}</p>`;
      return;
    }
    dstPicker.set(d.name);
    if (st.dstFor !== d.name) {
      st.dstFor = d.name;
      st.marker = null;
    }
    // 位置指向的条目/分组已经不在了（换了预设、被撤销、被别的插件改过）就清掉
    st.marker = fixPlace(d, st.marker);
    st.dstFoldKey = `dst:${d.name}`;
    st.dstCollapsed = collapsedFrom(d, openSetFor(st.dstFoldKey));
    const top = dstList.scrollTop;
    dstList.classList.add("pa-placing");
    dstList.innerHTML = qBar("dst") + (st.newName || qOf("dst") ? "" : '<button class="pa-slot pa-slot-new" data-st="newgroup">＋ 新建分组…</button>') + renderList(d, { mode: "target", place: true, inside: !st.newName, collapsed: st.dstCollapsed, marker: st.newName ? null : st.marker, markLabel: "缝合位置", highlight: st.highlight || void 0, query: qOf("dst"), searchBody: st.dstBody });
    bar.hidden = !!st.newName;
    ngbar.hidden = !st.newName;
    ngbar.querySelector(".pa-ng-n").textContent = st.newName ? `新分组「${st.newName}」的位置` : "";
    dstList.scrollTop = top;
    renderBar();
  }
  dstList.addEventListener("click", (e) => {
    const qa = e.target.closest("[data-act=qedit],[data-act=qclear],[data-act=qbody]")?.dataset.act;
    if (qa === "qedit") return qRow("dst").querySelector("input").focus();
    if (qa === "qclear") { setQuery("dst", ""); return saveSettings(); }
    if (qa === "qbody") { st.dstBody = !st.dstBody; return renderDst(); }
    if (st.dstType === "world") {
      const d2 = st.wbDraft;
      if (!d2) return;
      if (e.target.closest("[data-act]")?.dataset.act === "peek") {
        const id = e.target.closest(".pa-row").dataset.id;
        const p = d2.prompt(id);
        return editWorldEntry(d2.name, d2.wb[id].uid, p.name, p.content);
      }
      const m2 = placeFromClick(d2, e, false);
      if (!m2) return;
      st.wbMarker = m2;
      return renderDst();
    }
    const d = target();
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "peek") {
      return editPresetEntry(d, e.target.closest(".pa-row").dataset.id);
    }
    const head = e.target.closest(".pa-ghead");
    if (head && act === "collapse") {
      const gid = head.dataset.gid;
      toggleOpen(d, st.dstFoldKey, gid);
      return renderDst();
    }
    const m = placeFromClick(d, e, !st.newName);
    if (!m) return;
    if (st.newName) {
      // 新建空白分组：放好以后，缝合位置就定在这个新组里
      const p = placeOf(d, m);
      let gid = null;
      mutate(d, `新建分组「${st.newName}」`, (x) => { gid = x.createEmptyGroup(st.newName, p.where.index === 0 ? "" : p.where.after); });
      toast(`已新建分组「${st.newName}」`, "success");
      st.newName = null;
      toggleOpen(d, st.dstFoldKey, gid, true);
      st.marker = { at: "gstart", gid };
      renderDst();
      scrollToView(dstList.querySelector(`.pa-group[data-gid="${CSS.escape(gid)}"]`));
      return;
    }
    st.marker = m;
    renderDst();
  });
  // ---- 🔍 搜索：点放大镜在栏头下方展开输入框，边打边在「从」「到」的列表里筛出来（和预设页一样）；
  // 搜的词存进设置，关掉面板后列表仍按它筛；点输入框右侧 ✕ 或再点放大镜清除
  const qStore = () => {
    if (!settings().sutureQuery || typeof settings().sutureQuery !== "object") settings().sutureQuery = {};
    return settings().sutureQuery;
  };
  const qKey = (side) => side === "src" ? (st.srcType === "world" ? "qSrcWb" : "qSrc") : (st.dstType === "world" ? "qDstWb" : "qDst");
  const qOf = (side) => String(qStore()[qKey(side)] || "").trim();
  const qRow = (side) => page.querySelector(`.pa-qrow[data-qside="${side}"]`);
  const qOpen = { src: false, dst: false };
  const qBar = () => "";
  function paintQBtns() {
    for (const side of ["src", "dst"]) {
      const q = qOf(side), row = qRow(side), inp = row.querySelector("input");
      const off = side === "src" && (st.srcType === "paste" || regexSource());
      row.hidden = off || !(q || qOpen[side]);
      if (document.activeElement !== inp && inp.value.trim() !== q) inp.value = q;
      page.querySelector(`[data-st="${side}search"]`).classList.toggle("on", !row.hidden);
    }
  }
  function setQuery(side, v) {
    qStore()[qKey(side)] = v;
    if (!v) st[side === "src" ? "srcBody" : "dstBody"] = false;
    side === "src" ? renderSrc() : renderDst();
  }
  for (const side of ["src", "dst"]) {
    const inp = qRow(side).querySelector("input");
    onSearchInput(inp, () => setQuery(side, inp.value.trim()));
    inp.addEventListener("change", () => saveSettings());
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter" && !imeEnter(e)) { e.preventDefault(); inp.blur(); } });
    qRow(side).querySelector(".pa-qx").addEventListener("click", () => closeSearch(side));
  }
  function closeSearch(side) {
    qOpen[side] = false;
    qRow(side).querySelector("input").value = "";
    if (qOf(side)) { setQuery(side, ""); saveSettings(); } else paintQBtns();
  }
  function searchBox(side) {
    if (!qRow(side).hidden) return closeSearch(side);
    qOpen[side] = true;
    paintQBtns();
    qRow(side).querySelector("input").focus();
  }
  function searchSrc() { if (st.srcType !== "paste") return searchBox("src"); }
  function searchDst() { return searchBox("dst"); }
  function renderBar() {
    paintQBtns();
    const n = st.picked.size;
    let d = null;
    try {
      d = st.dstType === "world" ? st.wbDraft : target();
    } catch {
    }
    const m = st.dstType === "world" ? st.wbMarker : st.marker;
    const pn = bar.querySelector(".pa-picked-n");
    pn.textContent = n ? `已选 ${n} 条 ▸` : "未选条目";
    pn.disabled = !n;
    bar.querySelector(".pa-where").textContent = d && m ? `位置：${st.dstType === "world" ? `世界书「${d.name}」，` : ""}${placeText(d, m)}` : st.dstType === "world" ? "在「到」一栏点条目选位置" : "在「到」一栏点组名或条目选位置";
    bar.querySelector("[data-st=go]").disabled = !(n && m);
    swbar.querySelector(".pa-sw-n").textContent = n ? ` ${n}` : "";
    swbar.querySelector(".pa-sw-pos").textContent = m ? " ✓" : "";
    if (layout() === "switch" && !(d && m) && n) bar.querySelector(".pa-where").textContent = "切到「到」，点组名或条目选位置";
    bar.querySelector("[data-st=clear]").hidden = !(n || m);
    const undo = bar.querySelector("[data-st=wbundo]");
    undo.hidden = !(st.dstType === "world" && st.lastWb && st.lastWb.name === st.dstWorld);
    if (!undo.hidden) undo.textContent = `撤销刚缝的 ${st.lastWb.uids.length} 条`;
  }
  // ask：来源不是预设或含正则的文件时（世界书、粘贴等），先问从哪个预设缝
  async function regexSuture({ ask = false } = {}) {
    if (st.dstType !== "preset") return toast("正则只能缝入预设，请将目标切换为「预设」");
    try {
      let source = regexSourceDraft();
      if (!source && ask) {
        const v = await pickName({ title: "缝合哪个预设的正则", current: st.srcPreset, items: listPresets().map((n) => ({ value: n, sub: n === focusPreset() ? "目标" : "" })) });
        if (!v) return;
        source = getDraft(v);
      }
      if (!source) return toast(st.srcType === "file" && st.fileKind === "world" ? "世界书文件不含正则" : "请先选择来源预设或文件");
      await presetRegexDialog(source, target());
      if (regexSource()) renderSrc();
    } catch (err) { toast("正则缝制失败：" + err.message, "error"); }
  }
  page.addEventListener("click", async (e) => {
    const a = e.target.closest("[data-st]")?.dataset.st;
    if (!a) return;
    // 取消：清掉已选的条目和缝合位置
    if (a === "clear") {
      st.picked.clear();
      st.marker = null;
      st.wbMarker = null;
      renderSrc();
      renderDst();
    }
    if (a === "go") st.dstType === "world" ? reviewWorld() : review();
    if (a === "regex") return regexSuture();
    if (a === "migrate") migrate();
    if (a === "picked") return pickedSheet();
    if (a === "srcsearch") return searchSrc();
    if (a === "dstsearch") return searchDst();
    if (a === "srctype") return setSrcType(await pickName({ title: "从哪里缝", current: st.srcType, search: false, items: SRC_TYPES.map(([k, l]) => ({ value: k, label: l, sub: { regex: "缝合预设中的正则", file: "预设、世界书或正则文件" }[k] || "" })) }));
    if (a === "dsttype") return setDstType(await pickName({ title: "缝到哪里", current: st.dstType, search: false, items: [{ value: "preset", label: "预设" }, { value: "world", label: "世界书" }] }));
    if (a === "srcmenu") {
      // 2.6.1 缝合正则移到来源类型「正则」；预设文件里的正则从这里缝
      let fileRegex = 0;
      try { fileRegex = st.srcType === "file" && st.fileKind === "preset" ? presetRegexList(st.fileDraft).length : 0; } catch {}
      const v = await pickBox("更多操作", [
        ...fileRegex ? [{ label: "缝合文件中的正则…", sub: `文件中有 ${fileRegex} 条正则`, value: "regex" }] : [],
        { label: "搬到新版…", sub: "来源选旧版、目标选新版，将旧版中缝入的条目按原位置搬到新版", value: "migrate" },
        { label: "合并新版…", sub: "来源选新版、目标选自己改过的旧版，逐条比对提示词、正则、酒馆助手脚本后并入旧版", value: "merge" },
        { label: "清空已选条目", value: "clearpicked" }
      ]);
      if (v === "regex") return regexSuture();
      if (v === "migrate") {
        if (st.srcType !== "preset" || st.dstType !== "preset") return toast("请把来源和目标都切到「预设」：来源选旧版，目标选新版");
        return migrate();
      }
      if (v === "merge") return mergeNewVersion();
      if (v === "clearpicked") {
        st.picked.clear();
        renderSrc();
        return renderBar();
      }
    }
    if (a === "wbundo") undoWorld();
    if (a === "newgroup") {
      const n = await promptBox("新分组名称", "", "例如：文风");
      if (!n) return;
      st.newName = n;
      renderDst();
    }
    if (a === "ngcancel") {
      st.newName = null;
      renderDst();
    }
  });
  // 2.10.0 合并新版：来源（预设或预设文件）= 新版，目标预设 = 旧版
  async function mergeNewVersion() {
    if (st.dstType !== "preset") return toast("请将目标切换为「预设」，并选择自己改过的旧版");
    const fromFile = st.srcType === "file" && st.fileKind === "preset";
    if (!fromFile && st.srcType !== "preset") return toast("请将来源切换为「预设」或预设文件，并选择新版");
    try {
      const neu = fromFile ? st.fileDraft : st.srcPreset ? getDraft(st.srcPreset) : null;
      if (!neu) return toast("请先选择新版预设");
      const old = target();
      if (!fromFile && neu.name === old.name) return toast("来源和目标是同一个预设。请在来源选新版，目标选旧版");
      await presetMergeDialog(neu, old);
    } catch (err) { toast("无法合并：" + err.message, "error"); }
  }
  // 已选条目清单：跨预设、世界书、粘贴选的都在这里，可以单独去掉
  async function pickedSheet() {
    if (!st.picked.size) return;
    const body = el('<div class="pa-pick"></div>');
    const paint = () => {
      const rows = [...st.picked.entries()];
      body.innerHTML = rows.map(([k, v]) => `<div class="pa-pick-item pa-picked-row"><span><b>${esc(v.name || "（无名）")}</b><small>${esc(v.from || "")}</small></span><button class="pa-btn pa-btn-s" data-k="${esc(k)}">去掉</button></div>`).join("") || '<p class="pa-hint">没有已选的条目</p>';
    };
    paint();
    body.addEventListener("click", (e) => {
      const b = e.target.closest("[data-k]");
      if (!b) return;
      st.picked.delete(b.dataset.k);
      paint();
      renderSrc();
    });
    await sheet({ title: "已选的条目", body, actions: [{ label: "完成", kind: "primary", value: true }] });
    renderSrc();
  }
  // 这条材料所在的来源分组是不是整组都选了（酒馆位置条目不算）
  function wholeGroupOf(src) {
    const sd = src.srcDraft;
    if (!sd || !src.srcId) return null;
    const g = sd.groupOf(src.srcId);
    if (!g) return null;
    const picked = new Set([...st.picked.values()].filter((v) => v.srcDraft?.name === sd.name).map((v) => v.srcId));
    const mem = sd.order.map((o) => o.identifier).filter((x) => sd.groupOf(x) === g && !sd.isMarker(x));
    return mem.length && mem.every((x) => picked.has(x)) ? { key: `${sd.name}|${g}`, name: sd.group(g)?.name || "分组" } : null;
  }
  // spec（1.6.0 搬到新版用）：{ entries: [{ src, marker, hook }] }，每条可以有自己的位置；不传时用左边选中的条目和右边选的位置
  async function review(spec = null) {
    const d = target();
    let entries;
    if (spec) entries = spec.entries.map((e) => ({ ...e, marker: fixPlace(d, e.marker) || { at: "top" } }));
    else {
      const marker = fixPlace(d, st.marker);
      if (!marker) return renderDst();
      entries = [...st.picked.values()].map((src) => ({ src, marker }));
    }
    if (!entries.length) return;
    const tgtProf = profilePreset(d);
    const posCache = /* @__PURE__ */ new Map();
    const posOf = (marker) => {
      const k = JSON.stringify(marker);
      if (!posCache.has(k)) {
        const pw = placeOf(d, marker);
        posCache.set(k, { key: k, marker, where: pw.where, gid: pw.gid, t: inferTarget(d, pw.where, pw.gid), tgtWr: wrappersAt(d, tgtProf, insertionIndex(d, pw.where)) });
      }
      return posCache.get(k);
    };
    const srcProfs = /* @__PURE__ */ new Map();
    const items = entries.map(({ src, marker, hook, enabled }) => {
      let desc = null;
      if (src.srcDraft && src.srcId) {
        try {
          if (!srcProfs.has(src.srcDraft)) srcProfs.set(src.srcDraft, profilePreset(src.srcDraft));
          desc = describeEntry(src.srcDraft, src.srcId, srcProfs.get(src.srcDraft));
        } catch (e) {
          console.warn("[焦香鸡翅] 来源分析失败", e);
        }
      }
      // 缝后开关默认与来源条目一致：来源开着就勾选，关着就不勾选（看条目自身开关，不看分组总开关）
      const from = enabled ?? (src.srcDraft && src.srcId ? src.srcDraft.order.find((o) => o.identifier === src.srcId)?.enabled !== false : true);
      return { src: { ...src, sections: desc?.inside || [] }, desc, choice: hook ? { hook: true } : {}, autoHook: !!spec && !hook, manual: null, enabled: from, srcEnabled: from, srcGroup: spec ? null : wholeGroupOf(src), pos: posOf(marker) };
    });
    // 缝来的格式条目要靠来源预设的显示正则美化；目标没有对应正则时提醒，缝完可一起缝正则
    const regexDeps = /* @__PURE__ */ new Map();
    for (const it of items) {
      const sd = it.src.srcDraft;
      if (!sd || sd === d) continue;
      it.regexDeps = presetRegexFormatDeps(sd, d, [it.src.content])[0];
      if (!it.regexDeps.length) continue;
      if (!regexDeps.has(sd)) regexDeps.set(sd, new Set());
      it.regexDeps.forEach((x) => regexDeps.get(sd).add(x.index));
    }
    const single = posCache.size === 1;
    const P0 = items[0].pos;
    const { gid, t } = P0;
    const marker = P0.marker;
    const tgtWr = P0.tgtWr;
    // 整组选中的来源分组：成员排在一起（在第一次出现的位置），缝到组外时可以保持成组
    const groupKeys = [];
    for (const it of items) if (it.srcGroup && !groupKeys.some((g) => g.key === it.srcGroup.key)) groupKeys.push(it.srcGroup);
    items.splice(0, items.length, ...items.reduce((acc, it) => {
      if (!it.srcGroup) acc.push(it);
      else if (!acc.some((x) => x.srcGroup?.key === it.srcGroup.key)) acc.push(...items.filter((x) => x.srcGroup?.key === it.srcGroup.key));
      return acc;
    }, []));
    const grpDefault = groupKeys.length ? "keep" : "none";
    const grpRow = gid || !single || spec ? "" : `<div class="pa-field-row"><span>分组</span>
                <select class="pa-select pa-select-s" data-g="grp">
                    ${groupKeys.length ? `<option value="keep">保留原分组（${esc(groupKeys.map((g) => g.name).join("、"))}）</option>` : ""}
                    <option value="none" ${grpDefault === "none" ? "selected" : ""}>不分组</option>
                    <option value="new">放入新分组</option>
                </select>
                <input class="pa-input pa-input-s" data-g="gname" placeholder="新分组名称" hidden></div>`;
    const fromLabel = (it) => {
      const f = String(it.src.from || "").replace(/^世界书\s*/, "");
      return f && f !== "粘贴" ? f : "";
    };
    const nameOf = (it) => it.customName ?? (settings().nameWithSource && fromLabel(it) ? `${it.src.name}（来自${fromLabel(it)}）` : it.src.name);
    const body = el(`<div class="pa-review">
            <div class="pa-target-card">
                ${single ? `<div><b>位置：${esc(placeText(d, marker))}</b></div>
                ${grpRow}
                <small>附近条目的写法：${esc(t.summary)}${tgtWr.length ? `。位于 &lt;${tgtWr.map(esc).join("&gt; / &lt;")}&gt; 之内` : ""}</small>` : `<div><b>缝到 ${posCache.size} 个位置</b></div><small>按各条目在来源中的位置，分别放在目标中对应条目之后。每条的位置见条目详情。</small>`}
                <details class="pa-explain"><summary>更多选项和两边写法的分析</summary>
                <div class="pa-explain-body">
                <label class="pa-inline-check"><input type="checkbox" data-g="inj" ${settings().followTargetInjection ? "checked" : ""}> 按目标写法缝合时，角色和插入位置与目标一致</label>
                <label class="pa-inline-check"><input type="checkbox" data-g="from" ${settings().nameWithSource ? "checked" : ""}> 条目名称后加「（来自来源预设）」</label>
                ${tgtProf.lines.length ? `<b class="pa-sub">目标预设怎样让条目生效</b><ul class="pa-notes">${tgtProf.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>` : ""}
                ${[...srcProfs].map(([sd, pr]) => pr.lines.length ? `<b class="pa-sub">来源「${esc(sd.name)}」怎样让条目生效</b><ul class="pa-notes">${pr.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>` : "").join("")}
                </div></details>
                ${sutureEnableTools()}
                <div class="pa-hookbar"><span class="pa-hookbar-n"></span><button class="pa-btn pa-btn-s" data-g="hook-all">全部接入</button><button class="pa-btn pa-btn-s" data-g="hook-rec">推荐接入</button><button class="pa-btn pa-btn-s" data-g="hook-none">全部不接入</button></div>
                <small>接入思维链：让模型思考时专门想一下这条。每接入一条，思考就多一个问题，默认不接入。</small>
            </div>
            <div class="pa-items"></div>
        </div>`);
    const box = body.querySelector(".pa-items");
    const initName = (() => {
      const id = findInitEntry(d);
      return id ? d.prompt(id)?.name : null;
    })();
    // 正文缩略预览：开头几行 + 结尾几行（变量、标题这些改动通常就在头尾）
    const snip = (text) => {
      const lines = String(text || "").split("\n").filter((l) => l.trim() && !/^\s*(-{3,}|\*{3,}|={3,})\s*$/.test(l));
      const cut = (l) => (l = l.trim(), l.length > 46 ? l.slice(0, 46) + "…" : l);
      const show = lines.length <= 5 ? lines.map(cut) : [...lines.slice(0, 2).map(cut), "⋯", ...lines.slice(-2).map(cut)];
      return esc(show.join("\n"));
    };
    const hookBlock = (it) => {
      const h = it.hook;
      if (h.status !== "hook") return `<div class="pa-hook pa-hook-${esc(h.status)}"><small><b>思维链：</b>${esc(h.text)}</small></div>`;
      const cotName = esc(d.prompt(h.cotId)?.name || "");
      const more = (h.cotIds || []).length > 1 ? `（共 ${h.cotIds.length} 个思维链版本）` : "";
      let detail = "";
      if (it.hookOn && h.mode === "text") {
        detail = `<label class="pa-field pa-field-wide"><span>在「${cotName}」中添加一行${more}</span><input class="pa-input" data-c="hq" value="${esc(h.question)}"></label>
            <small>${h.needle ? `添加在提到 ${esc(h.needle)} 的一行之后` : "添加在思维链末尾"}。条目正文不变。</small>`;
      } else if (it.hookOn && (h.mode === "append" || h.mode === "slot")) {
        detail = `<label class="pa-field pa-field-wide"><span>${h.mode === "slot" ? "登记的问句" : "追加的内容"}</span><input class="pa-input" data-c="hq" value="${esc(h.question)}"></label>
            <small>条目末尾添加 {{${h.mode === "slot" ? "setvar" : "addvar"}::${esc(h.varName)}::…}}。「${cotName}」已读取「${esc(h.varName)}」，思维链不变。</small>`;
      } else if (it.hookOn) {
        detail = `<div class="pa-item-ctl">
                <label class="pa-field"><span>问句变量</span><input class="pa-input pa-input-s" data-c="hv" value="${esc(h.varName)}"></label>
                <label class="pa-field pa-field-wide"><span>思维链中的问句</span><input class="pa-input" data-c="hq" value="${esc(h.question)}"></label></div>
            ${h.clash ? `<p class="pa-warn">目标中已有变量「${esc(h.varName)}」，同名会互相覆盖，请更换名称</p>` : ""}
            <small>条目末尾添加 {{setvar::${esc(h.varName)}::…}}；${initName ? `「${esc(initName)}」中添加一行清空` : "未找到初始化条目，不添加清空"}；「${cotName}」${more}中${h.anchorVar ? `在 {{getvar::${esc(h.anchorVar)}}} 之后` : ""}添加 {{getvar::${esc(h.varName)}}}。</small>`;
      }
      return `<div class="pa-hook">
            <label class="pa-inline-check"><input type="checkbox" data-c="hook" ${it.hookOn ? "checked" : ""}> <b>接入思维链</b>${h.on ? '<span class="pa-chip pa-chip-cot">推荐</span>' : ""}</label>
            <small>${esc(h.text)}${it.hookOn || h.on ? "" : "。" + esc(h.offHint || "")}</small>${(h.warns || []).map((w) => `<p class="pa-warn">${esc(w)}</p>`).join("")}${detail}</div>`;
    };
    const renderItem = (it, i, analysis = null) => {
      const { t, where, gid, tgtWr } = it.pos;
      const src = { ...it.src, name: it.src.name };
      const base = { ...it.choice };
      delete base.shape;
      const planFix = planItem(src, t, base);
      const planSlot = t.slot && !planFix.slotAllowed ? planItem(src, t, { ...base, shape: t.slot.shape }) : null;
      const rawContent = String(it.src.content || "");
      const same = planFix.content.trim() === rawContent.trim();
      let mode = it.choice.mode || (same ? "raw" : "fix");
      if (mode === "slot" && !planSlot) mode = "fix";
      it.mode = mode;
      const chosen = mode === "raw" ? { content: rawContent, label: planFix.label, want: { shape: "plain" }, slotAllowed: false } : mode === "slot" ? planSlot : planFix;
      it.plan = chosen;
      const taken = new Set(items.filter((o) => o !== it && o.hookOn && o.hook?.varName).map((o) => o.hook.varName));
      const srcCot = it.desc?.cot ? ["var", "chain", "mention"].includes(it.desc.cot.level) : null;
      const collectors = chosen.want?.shape === "wrap" && chosen.want.varName === t.varName ? t.readerIds.filter((r) => !isCotEntry(d, r)) : [];
      try {
        it.hook = planHook(d, where, gid, { content: chosen.content, name: it.src.name, label: planFix.label }, { taken, varName: it.choice.hookVar || void 0, question: it.choice.hookQ ?? void 0, srcCot, allowSlot: mode === "slot" || planFix.slotAllowed, collector: collectors.length ? d.prompt(collectors[0])?.name : null, analysis });
      } catch (e) {
        console.warn("[焦香鸡翅] 思维链检查失败", e);
        it.hook = { status: "skip", on: false, text: "思维链检查出错，已跳过" };
      }
      // 搬到新版：没有缝合记录的条目，原预设的思维链读取过它就默认接入
      if (it.autoHook && it.choice.hook === void 0) it.choice.hook = !!it.hook.on;
      // 1.4.1：默认不接入（每接入一条，思维链就多一问，思考时间变长）；推荐与否见 hook.on，由顶部「推荐接入」一键勾选
      it.hookOn = it.hook.status === "hook" && !!it.choice.hook;
      it.finalContent = it.hookOn ? contentWithHook(chosen.content, it.hook) : chosen.content;
      // 两边差异提醒（不管哪种缝法都要知道的）
      const warns = [];
      const sp = it.src.prompt;
      if (sp?.injection_position === 1) warns.push(`来源中此条目插入聊天记录（深度 ${sp.injection_depth ?? 4}）。原样缝合时保留；按目标写法缝合时${settings().followTargetInjection ? "改为普通位置" : "同样保留"}`);
      if ((sp?.injection_trigger || []).length) warns.push("来源中此条目只在特定生成类型下发送，此设置一并保留");
      const raw = it.src.raw;
      if (raw && !raw.constant && (raw.key || []).length) warns.push(`在世界书中按关键词触发（${raw.key.slice(0, 4).join("、")}${raw.key.length > 4 ? "等" : ""}），缝进预设后会一直生效`);
      if (hasScript(it.src.content || "")) warns.push("含脚本（如 EJS），需要安装相应插件才能生效");
      if (hasConditional(it.src.content || "")) warns.push("含 {{if}} 条件，条件中的变量需在目标中存在");
      for (const dep of it.regexDeps || []) warns.push(`这条要求输出 ${dep.mark}，来源预设靠正则「${dep.name}」显示成美化，目标预设没有对应正则，缝入后只显示原文。确认缝合后可一起缝入`);
      for (const k of it.desc?.needsVars || []) {
        const nm2 = k.replace(/^全局:/, "");
        const has = d.preset.prompts.some((p) => listVarMacros(p.content || "").some((m) => m.name === nm2 && (m.op === "set" || m.op === "add") && !isBlankValue(m.value)));
        if (!has) warns.push(`读取变量「${nm2}」，目标中没有条目写入此变量，该部分将为空`);
      }
      for (const w of it.desc?.inside || []) {
        const tw = tgtProf.wrappers.find((x) => x.name === w);
        if (!tw || tgtWr.includes(w)) continue;
        warns.push(`来源中此条目位于 ${tw.label} 之内。目标的 ${tw.label} 在「${d.prompt(tw.openId)?.name}」与「${d.prompt(tw.closeId)?.name}」之间，当前位置不在其中`);
      }
      const card = (value, title, sub, content, notes = []) => `<label class="pa-mode${mode === value ? " on" : ""}">
            <span class="pa-mode-head"><input type="radio" name="pa-mode-${i}" data-c="mode" value="${value}" ${mode === value ? "checked" : ""}><b>${esc(title)}</b><small>${esc(sub)}</small></span>
            <pre class="pa-snip">${snip(content)}</pre>
            ${notes.length && mode === value ? `<ul class="pa-notes">${notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}</label>`;
      const modes = same && !planSlot ? card("raw", "原样缝合", "两边写法相同，无需调整", rawContent) : [
        card("raw", "原样缝合", "不调整写法", rawContent),
        card("fix", "按目标写法缝合", `按「${d.name}」的写法调整`, planFix.content, [...(planFix.changes.length ? planFix.changes : ["正文不变，位置和角色与目标一致"]), ...planFix.warnings.map((w) => "注意：" + w)]),
        planSlot ? card("slot", `按目标写法缝合，并加入多选一「${t.slot.varName}」`, "开启后，同类中已开启的一条会被替换", planSlot.content, planSlot.changes) : ""
      ].join("");
      const showAdv = mode !== "raw" && (/[{]{2}/.test(chosen.content) || t.headerTpl || t.tagTpl || t.ownTag);
      const modeLabel = { raw: "原样", fix: "按目标写法", slot: "加入多选一" }[mode];
      const hookLabel = it.hook.status !== "hook" ? "" : it.hookOn ? '<span class="pa-chip pa-chip-cot">接入思维链</span>' : it.hook.on ? '<span class="pa-chip pa-chip-dim">推荐接入</span>' : "";
      // 默认收起，只显示一行摘要；点开看详情
      return `<article class="pa-item${it.open ? " open" : ""}" data-i="${i}">
                <header class="pa-item-head" data-c="toggle"><span class="pa-item-name">${esc(nameOf(it))}</span><span class="pa-item-caret">${it.open ? "▾" : "▸"}</span>
                <span class="pa-item-meta"><label class="pa-item-on" title="缝进去以后是开着还是关着。不想缝这一条，请回到来源里取消选择"><input type="checkbox" data-c="on" ${it.enabled ? "checked" : ""}>缝后开启</label><span class="pa-badges"><span class="pa-chip">${modeLabel}</span>${hookLabel}${warns.length ? `<span class="pa-chip pa-chip-warn">提醒 ${warns.length}</span>` : ""}</span></span></header>
                <div class="pa-item-body"${it.open ? "" : " hidden"}>
                <label class="pa-field"><span>条目名称</span><input class="pa-input pa-input-s" data-c="name" value="${esc(nameOf(it))}"></label>
                ${single ? "" : `<small class="pa-from">位置：${esc(placeText(d, it.pos.marker))}</small>`}
                ${it.desc ? `<details class="pa-was"><summary>在「${esc(it.src.from || "")}」中的作用</summary><ul class="pa-notes">${it.desc.lines.map((l) => `<li>${esc(l)}</li>`).join("")}${it.desc.cot ? `<li>${esc(it.desc.cot.text)}</li>` : ""}</ul></details>` : `<small class="pa-from">来自 ${esc(it.src.from || "")}</small>`}
                <div class="pa-modes" role="radiogroup">${modes}</div>
                ${warns.length ? `<ul class="pa-notes">${warns.map((w) => `<li class="pa-warn">${esc(w)}</li>`).join("")}</ul>` : ""}
                ${hookBlock(it)}
                ${showAdv ? `<details class="pa-adv" ${it.choice.adv ? "open" : ""}><summary>高级</summary>
                <div class="pa-item-ctl">
                    <label class="pa-field"><span>标题或标签中的名称</span><input class="pa-input pa-input-s" data-c="label" value="${esc(planFix.label)}"></label>
                    ${chosen.want?.varName && (chosen.want.shape === "wrap" || chosen.want.shape === "tagname") ? `<label class="pa-field"><span>变量</span><input class="pa-input pa-input-s" data-c="var" value="${esc(chosen.want.varName)}"></label>
                    <label class="pa-field"><span>写入方式</span><select class="pa-select" data-c="op"><option value="add" ${chosen.want.op !== "set" ? "selected" : ""}>可叠加（开启几条就拼几条，addvar）</option><option value="set" ${chosen.want.op === "set" ? "selected" : ""}>多选一（只有最后一条开着的生效，setvar）</option></select></label>` : ""}
                    ${planFix.sourceShape.extras?.length ? `<label class="pa-inline-check"><input type="checkbox" data-c="extras" ${it.choice.keepExtras ? "checked" : ""}> 保留来源中的 ${planFix.sourceShape.extras.length} 个附加宏</label>` : ""}
                </div></details>` : ""}
                <details class="pa-body" ${it.bodyOpen ? "open" : ""}><summary>缝合后的完整正文${it.manual != null ? "（已手动修改）" : ""}</summary>
                <textarea class="pa-input pa-text" data-c="content" spellcheck="false">${esc(it.manual ?? it.finalContent)}</textarea>
                ${it.manual != null ? '<button class="pa-link" data-c="reset">撤销手动修改，按上方选项重新生成</button>' : ""}</details>
                </div>
            </article>`;
    };
    const rerender = (art, it) => {
      const i = Number(art.dataset.i);
      it.bodyOpen = art.querySelector(".pa-body")?.open || void 0;
      it.choice.adv = art.querySelector(".pa-adv")?.open || void 0;
      repaint(art, d.withReadIndex(() => renderItem(it, i)));
    };
    const renderItems = (analysis = null) => d.withReadIndex(() => {
      const currentAnalysis = analysis || analyze(d);
      return items.map((it, i) => renderItem(it, i, currentAnalysis)).join("");
    });
    box.innerHTML = renderItems(tgtProf.a);
    // 思维链批量选择：全部接入 / 推荐接入 / 全部不接入
    const hookable = () => items.filter((it) => it.hook?.status === "hook");
    // 缝后关着的条目不推荐接入：思维链会去想一条没开的内容
    const recommended = () => hookable().filter((it) => it.hook.on && it.enabled);
    const paintHookBar = () => {
      const bar = body.querySelector(".pa-hookbar");
      const n = hookable().length, rec = recommended().length;
      bar.hidden = !n;
      bar.querySelector("[data-g=hook-rec]").textContent = `推荐接入（${rec}）`;
      bar.querySelector(".pa-hookbar-n").textContent = `思维链：已接入 ${items.filter((it) => it.hookOn).length} / ${n}`;
      let warn = bar.querySelector(".pa-hookbar-warn");
      if (!warn) { warn = document.createElement("p"); warn.className = "pa-warn pa-hookbar-warn"; bar.append(warn); }
      warn.hidden = rec <= 10;
      warn.textContent = rec > 10 ? `推荐的 ${rec} 条在来源中已被思维链读取。全部接入将增加 ${rec} 个思考问题，思考变长、易爆思维链。整套缝合时，只接入需重点落实的几条。` : "";
    };
    paintHookBar();
    body.querySelector(".pa-hookbar").addEventListener("click", (e) => {
      const g = e.target.closest("[data-g]")?.dataset.g;
      if (!g) return;
      for (const it of hookable()) {
        it.choice.hook = g === "hook-all" ? true : g === "hook-rec" ? !!it.hook.on && it.enabled : false;
        it.manual = null;
      }
      box.innerHTML = renderItems();
      paintHookBar();
    });
    bindSutureEnableTools(body, items);
    body.addEventListener("change", (e) => { if (e.target.matches("[data-enable-toggle], .pa-items [data-c=on]")) paintHookBar(); });
    body.querySelector("[data-enable-source]")?.addEventListener("click", () => paintHookBar());
    const grpSel = body.querySelector("[data-g=grp]");
    const grpName = body.querySelector("[data-g=gname]");
    grpSel?.addEventListener("change", () => {
      grpName.hidden = grpSel.value !== "new";
      if (!grpName.hidden) grpName.focus();
    });
    body.querySelector("[data-g=from]").addEventListener("change", (e) => {
      settings().nameWithSource = e.target.checked;
      saveSettings();
      box.querySelectorAll(".pa-item").forEach((art) => {
        const it = items[Number(art.dataset.i)];
        const inp = art.querySelector("[data-c=name]");
        if (it.customName == null) {
          if (inp) inp.value = nameOf(it);
          art.querySelector(".pa-item-name").textContent = nameOf(it);
        }
      });
    });
    box.addEventListener("change", (e) => {
      const art = e.target.closest(".pa-item");
      // 重画时，正在编辑的输入框被移走会再触发一次 change（失焦），忽略这一次
      if (!art || !art.isConnected || repainting) return;
      const it = items[Number(art.dataset.i)];
      const c2 = e.target.dataset.c;
      if (c2 === "on") {
        it.enabled = e.target.checked;
        return;
      }
      if (c2 === "name") {
        it.customName = e.target.value;
        art.querySelector(".pa-item-name").textContent = e.target.value;
        return;
      }
      if (c2 === "content") {
        it.manual = e.target.value;
        return;
      }
      if (c2 === "mode") it.choice.mode = e.target.value;
      if (c2 === "var") it.choice.varName = e.target.value.trim();
      if (c2 === "op") it.choice.op = e.target.value;
      if (c2 === "label") it.choice.label = e.target.value;
      if (c2 === "extras") it.choice.keepExtras = e.target.checked;
      if (c2 === "hook") it.choice.hook = e.target.checked;
      if (c2 === "hv") it.choice.hookVar = e.target.value.replace(/[{}:：\s]/g, "");
      if (c2 === "hq") it.choice.hookQ = e.target.value.trim() || void 0;
      it.manual = null;
      rerender(art, it);
      paintHookBar();
    });
    box.addEventListener("click", (e) => {
      const head = e.target.closest("[data-c=toggle]");
      if (head && !e.target.closest("input, .pa-item-on")) {
        const art = head.closest(".pa-item");
        const it = items[Number(art.dataset.i)];
        it.open = !it.open;
        return rerender(art, it);
      }
      if (e.target.dataset.c !== "reset") return;
      const art = e.target.closest(".pa-item");
      const it = items[Number(art.dataset.i)];
      it.manual = null;
      rerender(art, it);
      paintHookBar();
    });
    const ok = await sheet({ title: spec?.title || `缝合 ${items.length} 条到「${d.name}」`, body, wide: true, noFocus: true, actions: [{ label: "取消", value: null }, {
      label: "确认缝合",
      kind: "primary",
      validate: () => {
        if (grpSel?.value === "new" && !grpName.value.trim()) {
          grpName.focus();
          toast("请填写新分组名称");
          return false;
        }
        return true;
      },
      value: (w) => ({ inj: w.querySelector("[data-g=inj]").checked, grp: grpSel?.value || "none", gname: grpName?.value.trim() || "" })
    }] });
    if (!ok) return;
    settings().followTargetInjection = ok.inj;
    saveSettings();
    let newIds = [];
    const inits = [];
    const hooked = [];
    const hookedIdx = /* @__PURE__ */ new Set();
    mutate(d, spec ? "搬到新版" : `缝合 ${items.length} 条`, (x) => {
      const build = (it) => {
        const t2 = it.pos.t;
        const content = it.manual ?? it.finalContent ?? it.plan.content;
        const prompt = buildPrompt(x, it.src, { content }, t2, { keepSourceInjection: it.mode === "raw" || !ok.inj });
        prompt.name = nameOf(it);
        const v = it.plan.want;
        if ((v.shape === "wrap" || v.shape === "tagname") && v.varName && v.varName !== t2.varName) {
          const initId = t2.initId || findInitEntry(x);
          if (initId && ensureInit(x, v.varName, initId)) inits.push(v.varName);
        }
        return { prompt, enabled: it.enabled };
      };
      // 同一位置的条目一起插入，保持原来的先后顺序
      const byPos = /* @__PURE__ */ new Map();
      items.forEach((it, i) => (byPos.get(it.pos.key) || byPos.set(it.pos.key, []).get(it.pos.key)).push(i));
      newIds = new Array(items.length);
      for (const [k, idxs] of byPos) {
        const P = posCache.get(k);
        const ids = x.insertPrompts(idxs.map((i) => build(items[i])), P.where, P.gid);
        idxs.forEach((i, j) => { newIds[i] = ids[j]; });
      }
      if (!gid && ok.grp === "new") x.createGroup(ok.gname, newIds);
      if (!gid && ok.grp === "keep") {
        // 整组选中的来源分组：在目标里照原名建组（它们已经排在一起了）
        for (const g of groupKeys) {
          const mem = newIds.filter((_, i) => items[i].srcGroup?.key === g.key);
          if (mem.length) x.createGroup(g.name, mem);
        }
      }
      // 挂进思维链：同一个位置挂好几条时，按缝合顺序一条接一条往下排
      const chain = /* @__PURE__ */ new Map();
      items.forEach((it, i) => {
        if (!it.hookOn || it.hook?.status !== "hook") return;
        const h = { ...it.hook };
        const content = x.prompt(newIds[i])?.content || "";
        if (h.mode !== "text" && !content.includes(`var::${h.varName}::`)) return; // 手动改正文时删掉了问句，就不挂
        if (h.mode === "text") h.line = h.prefix + String(h.question || "").replace(/\n+/g, " ");
        const key = `${h.cotId}|${h.mode === "text" ? h.needle || "" : h.anchorVar || ""}`;
        if (chain.has(key)) {
          if (h.mode === "text") h.needle = chain.get(key);
          else h.anchorVar = chain.get(key);
        }
        const r = applyHook(x, h);
        if (r.ok) {
          chain.set(key, h.mode === "text" ? h.line.trim() : h.varName);
          hooked.push(`${nameOf(it)} → ${r.cotName}`);
          hookedIdx.add(i);
        }
      });
      // 1.6.0：记下哪些条目是缝进来的（来源、是否接入思维链），预设更新后「搬到新版」靠它找回
      const ext = x.preset.extensions || (x.preset.extensions = {});
      const rec = ext.presetAtelier && typeof ext.presetAtelier === "object" ? ext.presetAtelier : (ext.presetAtelier = {});
      const live = new Set(x.order.map((o) => o.identifier));
      rec.stitched = (Array.isArray(rec.stitched) ? rec.stitched : []).filter((r) => live.has(r.id));
      // 只记编号、时间、是否接入思维链；不记来源预设名，分享预设时不会带出你缝过哪些预设
      items.forEach((it, i) => rec.stitched.push({ id: newIds[i], at: Date.now(), ...(hookedIdx.has(i) ? { cot: 1 } : {}) }));
      for (const r of rec.stitched) delete r.from;
    });
    if (!spec) st.picked.clear();
    // 下次接着往后缝：落在新分组里就放在这组后面，否则接在最后一条后面
    const lastNew = newIds[newIds.length - 1];
    st.marker = !gid && d.groupOf(lastNew) ? fixPlace(d, { at: "block", id: lastNew }) : { at: "row", id: lastNew };
    toast(`已缝合 ${newIds.length} 条${hooked.length ? `，${hooked.length} 条接入思维链` : ""}${inits.length ? `，初始化条目已添加变量 ${inits.join("、")}` : ""}`, "success");
    for (const [sd, set] of regexDeps) {
      const names = [...set].map((i) => presetRegexList(sd)[i]?.scriptName || "未命名正则");
      const go = await sheet({ place: "center", title: "一起缝显示正则？", body: `<p class="pa-p">刚缝入的条目要求特定输出格式，来源「${esc(sd.name)}」用正则「${esc(names.join("」「"))}」将其显示为美化。目标预设缺少对应正则，不缝入则聊天中只显示原文。</p><p class="pa-hint">下一步打开正则缝合，已预选这几条。</p>`, actions: [{ label: "以后再说", value: false }, { label: "去缝正则", kind: "primary", value: true }] });
      if (go) {
        try { await presetRegexDialog(sd, d, { preselect: [...set] }); } catch (err) { toast("正则缝制失败：" + err.message, "error"); }
      }
    }
    if (gid) toggleOpen(d, `dst:${d.name}`, gid, true);
    st.highlight = new Set(newIds);
    renderSrc();
    renderDst();
    scrollToView(dstList.querySelector(".pa-flash"));
    setTimeout(() => {
      st.highlight = null;
    }, 1500);
  }

  // ---- 1.6.0 缝进世界书：没有思维链和分组；每条可设触发方式、插入位置、深度、顺序
  async function reviewWorld() {
    try {
      await loadWbDraft(true);
    } catch (e) {
      return toast("读取世界书失败：" + e.message, "error");
    }
    const d = st.wbDraft;
    const marker = d && fixPlace(d, st.wbMarker);
    if (!marker) return renderDst();
    const { where } = placeOf(d, marker);
    const t = inferTarget(d, where, null);
    const afterId = marker.at === "top" ? null : marker.id;
    const firstId = d.order[0]?.identifier;
    const anchor = d.wb[afterId || firstId] || null;
    const roleNum = (r) => ({ system: 0, user: 1, assistant: 2 })[r] ?? 0;
    const base = { position: anchor?.position ?? 0, depth: anchor?.depth ?? 4, role: anchor?.role ?? 0, order: anchor?.order ?? 100 };
    // 预设和本世界书里写入过的变量（读取没人写的变量时提醒）
    const written = new Set();
    const addW = (txt) => listVarMacros(txt || "").forEach((m) => { if ((m.op === "set" || m.op === "add") && !isBlankValue(m.value)) written.add(m.name); });
    Object.values(d.wb).forEach((e) => addW(e.content));
    try {
      getDraft(focusPreset()).preset.prompts.forEach((x) => addW(x.content));
    } catch {
    }
    const items = [...st.picked.values()].map((src) => {
      const raw = src.raw;
      const sp = src.prompt;
      const wb = raw ? { constant: !!raw.constant, keys: (raw.key || []).join(", "), position: raw.position ?? 0, depth: raw.depth ?? 4, role: raw.role ?? 0, order: raw.order ?? 100, from: true }
        : { constant: true, keys: "", ...base, ...(sp?.injection_position === 1 ? { position: 4, depth: sp.injection_depth ?? 4, role: roleNum(sp.role) } : {}) };
      const from = raw ? !raw.disable : src.srcDraft && src.srcId ? src.srcDraft.order.find((o) => o.identifier === src.srcId)?.enabled !== false : true;
      return { src: { ...src, sections: [] }, wb, choice: {}, manual: null, enabled: from, srcEnabled: from, open: false };
    });
    const snip = (text) => {
      const lines = String(text || "").split("\n").filter((l) => l.trim());
      const cut = (l) => (l = l.trim(), l.length > 46 ? l.slice(0, 46) + "…" : l);
      return esc((lines.length <= 5 ? lines.map(cut) : [...lines.slice(0, 2).map(cut), "⋯", ...lines.slice(-2).map(cut)]).join("\n"));
    };
    const posName = (v) => WI_POS.find(([k]) => k === Number(v))?.[1] || "角色定义之前";
    const renderItem = (it, i) => {
      const raw = String(it.src.content || "");
      const plan = planItem({ ...it.src }, t, it.choice);
      const same = plan.content.trim() === raw.trim();
      const mode = same ? "raw" : it.choice.mode || "fix";
      it.content = mode === "raw" ? raw : plan.content;
      const warns = [];
      for (const m of listVarMacros(it.content)) if (m.op === "get" && !written.has(m.name)) warns.push(`读取变量「${m.name}」，世界书和当前预设中都没有条目写入此变量，该部分将为空`);
      if (hasScript(raw)) warns.push("含脚本（如 EJS），需要安装相应插件才能生效");
      if (hasConditional(raw)) warns.push("含 {{if}} 条件，条件中的变量需存在");
      if (!it.wb.constant && !it.wb.keys.trim()) warns.push("按关键词触发但没有填写关键词，条目不会生效");
      const card = (value, title, sub, content) => `<label class="pa-mode${mode === value ? " on" : ""}">
            <span class="pa-mode-head"><input type="radio" name="pa-wmode-${i}" data-c="mode" value="${value}" ${mode === value ? "checked" : ""}><b>${esc(title)}</b><small>${esc(sub)}</small></span>
            <pre class="pa-snip">${snip(content)}</pre>${mode === value && value === "fix" && plan.changes.length ? `<ul class="pa-notes">${plan.changes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}</label>`;
      const w = it.wb;
      return `<article class="pa-item${it.open ? " open" : ""}" data-i="${i}">
        <header class="pa-item-head" data-c="toggle"><span class="pa-item-name">${esc(it.name ?? it.src.name)}</span><span class="pa-item-caret">${it.open ? "▾" : "▸"}</span>
                <span class="pa-item-meta"><label class="pa-item-on" title="缝进去以后是开着还是关着。不想缝这一条，请回到来源里取消选择"><input type="checkbox" data-c="on" ${it.enabled ? "checked" : ""}>缝后开启</label><span class="pa-badges"><span class="pa-chip">${w.constant ? "常驻" : "关键词"}</span><span class="pa-chip">${esc(posName(w.position))}${Number(w.position) === 4 ? ` ${w.depth}` : ""}</span>${warns.length ? `<span class="pa-chip pa-chip-warn">提醒 ${warns.length}</span>` : ""}</span></span></header>
        <div class="pa-item-body"${it.open ? "" : " hidden"}>
          <label class="pa-field"><span>条目名称</span><input class="pa-input pa-input-s" data-c="name" value="${esc(it.name ?? it.src.name)}"></label>
          <small class="pa-from">来自 ${esc(it.src.from || "")}${w.from ? "，沿用原世界书中的触发和插入设置" : ""}</small>
          <div class="pa-modes" role="radiogroup">${same ? card("raw", "原样缝合", "两边写法相同，无需调整", raw) : card("raw", "原样缝合", "不调整写法", raw) + card("fix", "按目标写法缝合", `按「${d.name}」的写法调整`, plan.content)}</div>
          ${warns.length ? `<ul class="pa-notes">${warns.map((x) => `<li class="pa-warn">${esc(x)}</li>`).join("")}</ul>` : ""}
          <div class="pa-item-ctl pa-wbset">
            <label class="pa-field"><span>触发</span><select class="pa-select pa-select-s" data-c="constant"><option value="1" ${w.constant ? "selected" : ""}>常驻（一直生效）</option><option value="0" ${w.constant ? "" : "selected"}>按关键词触发</option></select></label>
            ${w.constant ? "" : `<label class="pa-field pa-field-wide"><span>关键词（逗号分隔）</span><input class="pa-input pa-input-s" data-c="keys" value="${esc(w.keys)}"></label>`}
            <label class="pa-field"><span>插入位置</span><select class="pa-select pa-select-s" data-c="position">${WI_POS.map(([k, l]) => `<option value="${k}" ${Number(w.position) === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
            ${Number(w.position) === 4 ? `<label class="pa-field"><span>深度</span><input class="pa-input pa-input-s" type="number" min="0" data-c="depth" value="${esc(w.depth)}"></label>
            <label class="pa-field"><span>角色</span><select class="pa-select pa-select-s" data-c="role">${[[0, "系统"], [1, "用户"], [2, "AI"]].map(([k, l]) => `<option value="${k}" ${Number(w.role) === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>` : ""}
            <label class="pa-field"><span>顺序</span><input class="pa-input pa-input-s" type="number" data-c="order" value="${esc(w.order)}"></label>
          </div>
          <details class="pa-body" ${it.bodyOpen ? "open" : ""}><summary>缝合后的完整正文${it.manual != null ? "（已手动修改）" : ""}</summary>
            <textarea class="pa-input pa-text" data-c="content" spellcheck="false">${esc(it.manual ?? it.content)}</textarea></details>
        </div></article>`;
    };
    const body = el(`<div class="pa-review">
        <div class="pa-target-card"><div><b>位置：世界书「${esc(d.name)}」，${esc(placeText(d, marker))}</b></div>
          <small>位置决定条目在世界书编辑器中的排列。实际发送顺序由每条的「插入位置」和「顺序」决定，默认与${anchor ? `「${esc(d.prompt(afterId || firstId)?.name || "")}」` : "世界书默认值"}相同。预设条目缝入后默认「常驻」，与在预设中一样一直生效。</small>${sutureEnableTools()}</div>
        <div class="pa-items"></div></div>`);
    const box = body.querySelector(".pa-items");
    const paint = () => { box.innerHTML = items.map(renderItem).join(""); };
    paint();
    bindSutureEnableTools(body, items);
    box.addEventListener("change", (e) => {
      const art = e.target.closest(".pa-item");
      // 重画时，正在编辑的输入框被移走会再触发一次 change（失焦），忽略这一次
      if (!art || !art.isConnected || repainting) return;
      const it = items[Number(art.dataset.i)];
      const c2 = e.target.dataset.c, v = e.target.value;
      if (c2 === "on") return void (it.enabled = e.target.checked);
      if (c2 === "name") return void (it.name = v, art.querySelector(".pa-item-name").textContent = v);
      if (c2 === "content") return void (it.manual = v);
      if (c2 === "keys") it.wb.keys = v;
      if (c2 === "mode") { it.choice.mode = v; it.manual = null; }
      if (c2 === "constant") it.wb.constant = v === "1";
      if (c2 === "position") it.wb.position = Number(v);
      if (c2 === "depth") it.wb.depth = Math.max(0, Number(v) || 0);
      if (c2 === "role") it.wb.role = Number(v);
      if (c2 === "order") it.wb.order = Number(v) || 0;
      it.bodyOpen = art.querySelector(".pa-body")?.open || void 0;
      repaint(art, renderItem(it, Number(art.dataset.i)));
    });
    box.addEventListener("click", (e) => {
      const head = e.target.closest("[data-c=toggle]");
      if (!head || e.target.closest("input, .pa-item-on")) return;
      const art = head.closest(".pa-item");
      const it = items[Number(art.dataset.i)];
      it.open = !it.open;
      repaint(art, renderItem(it, Number(art.dataset.i)));
    });
    const ok = await sheet({ title: `缝合 ${items.length} 条到世界书「${d.name}」`, body, wide: true, noFocus: true, actions: [{ label: "取消", value: null }, { label: "确认缝合", kind: "primary", value: true }] });
    if (!ok) return;
    const fields = items.map((it) => {
      const w = it.wb;
      const raw = it.src.raw ? structuredClone(it.src.raw) : {};
      delete raw.uid;
      delete raw.displayIndex;
      return {
        ...raw,
        comment: it.name ?? it.src.name,
        content: it.manual ?? it.content,
        constant: w.constant,
        key: w.constant && !w.keys.trim() ? raw.key || [] : w.keys.split(/[,，]/).map((x) => x.trim()).filter(Boolean),
        position: w.position,
        depth: w.depth,
        role: w.role,
        order: w.order,
        disable: !it.enabled
      };
    });
    // 写之前备份整本世界书（存在本浏览器，「更多 → 清理 → 本地备份」可见）
    try {
      await backupPut(`世界书：${d.name}`, await mods.wi.loadWorldInfo(d.name), "缝合前");
    } catch (e) {
      if (!await confirmBox("备份失败", `缝合前备份世界书「${d.name}」没有成功（${e.message}）。仍可在缝合后用底栏的「撤销」删掉刚缝进去的条目。继续缝合吗？`, "继续缝合")) return;
    }
    try {
      const uids = await writeWorldEntries(d.name, fields, afterId ? d.wb[afterId]?.uid : null);
      st.lastWb = { name: d.name, uids };
      st.worldCache.delete(d.name);
      st.picked.clear();
      await loadWbDraft(true);
      st.wbMarker = { at: "row", id: `wb${uids[uids.length - 1]}` };
      st.highlight = new Set(uids.map((u) => `wb${u}`));
      toast(`已缝合 ${uids.length} 条到世界书「${d.name}」`, "success");
      renderSrc();
      await renderDst();
      scrollToView(dstList.querySelector(".pa-flash"));
      setTimeout(() => { st.highlight = null; }, 1500);
    } catch (e) {
      toast("写入世界书失败：" + e.message, "error");
    }
  }
  // 世界书不在撤销记录里：单独记下刚缝进去的条目，可以删回去
  async function undoWorld() {
    const last = st.lastWb;
    if (!last) return;
    if (!await confirmBox("撤销缝合", `从世界书「${last.name}」删掉刚缝进去的 ${last.uids.length} 条？`, "删除", true)) return;
    try {
      const data = await mods.wi.loadWorldInfo(last.name);
      const gone = new Set(last.uids.map(String));
      for (const k of Object.keys(data.entries || {})) if (gone.has(String(data.entries[k].uid))) delete data.entries[k];
      wiSorted(data).forEach((e, i) => { e.displayIndex = i; });
      await mods.wi.saveWorldInfo(last.name, data, true);
      try { mods.wi.reloadEditor?.(last.name); } catch {}
      st.lastWb = null;
      st.worldCache.delete(last.name);
      st.wbMarker = null;
      await loadWbDraft(true);
      toast("已撤销", "success");
      renderDst();
    } catch (e) {
      toast("撤销失败：" + e.message, "error");
    }
  }
  // ---- 1.6.0 搬到新版：来源 = 旧版，目标 = 新版。把旧版里缝进去的条目按原位置搬过去
  async function migrate() {
    if (st.srcType !== "preset" || !st.srcPreset) return;
    const neu = target();
    if (st.srcPreset === neu.name) return toast("来源和目标是同一个预设。请在左边选旧版，右边选新版");
    const old = getDraft(st.srcPreset);
    const rec = new Map((old.preset.extensions?.presetAtelier?.stitched || []).map((r) => [r.id, r]));
    const norm = (x) => String(x || "").replace(/\s+/g, "");
    const newIds = new Set(neu.order.map((o) => o.identifier));
    const newContent = new Set(neu.preset.prompts.map((p) => norm(p.content)).filter(Boolean));
    const newByName = new Map(neu.preset.prompts.map((p) => [p.name, p.identifier]));
    const order = old.order.map((o) => o.identifier);
    const inNew = (id) => newIds.has(id) && !rec.has(id) ? id : (() => {
      const nm = old.prompt(id)?.name;
      const hit = nm && newByName.get(nm);
      return hit && !rec.has(id) ? hit : null;
    })();
    const cands = [];
    order.forEach((id, i) => {
      if (old.isMarker(id)) return;
      const p = old.prompt(id);
      if (!p) return;
      const recorded = rec.has(id);
      // 新版里已经有（同 id 或正文完全一样）的，不用搬
      if (newContent.has(norm(p.content)) && norm(p.content)) return;
      if (!recorded && (newIds.has(id) || newByName.has(p.name))) return;
      // 位置：往前找最近一个新版里也有的条目，放在它后面
      let anchor = null;
      for (let j = i - 1; j >= 0 && !anchor; j--) anchor = inNew(order[j]);
      const og = old.groupOf(id), ag = anchor ? neu.groupOf(anchor) : null;
      const sameGroup = og && anchor && old.group(og)?.name === neu.group(ag)?.name;
      const marker = !anchor ? { at: "top" } : ag && !sameGroup ? { at: "block", id: anchor } : { at: "row", id: anchor };
      cands.push({ id, p, recorded, marker, on: recorded, hook: !!rec.get(id)?.cot });
    });
    if (!cands.length) return toast(`「${old.name}」中没有找到需要搬到「${neu.name}」的条目`);
    const body = el(`<div>
      <p class="pa-p">从「${esc(old.name)}」搬到「${esc(neu.name)}」。有缝合记录的条目已勾选；没有记录、但新版中没有的条目未勾选，可能是后来添加的，也可能是作者在新版中删除的，需自行核对。</p>
      <div class="pa-mig">${cands.map((c, i) => `<label class="pa-crow${c.on ? " on" : ""}"><input type="checkbox" data-i="${i}" ${c.on ? "checked" : ""}>
        <span class="pa-crow-main"><b>${esc(c.p.name || c.id)}</b><span class="pa-crow-tags">${c.recorded ? '<span class="pa-chip pa-chip-cot">缝合记录</span>' : '<span class="pa-chip">新版中没有</span>'}${c.hook ? '<span class="pa-chip">原先接入思维链</span>' : ""}<span class="pa-chip pa-chip-dim">${esc(placeText(neu, fixPlace(neu, c.marker) || { at: "top" }))}</span></span></span></label>`).join("")}</div>
      <p class="pa-hint">下一步会打开缝合预览，可逐条检查写法和思维链。早于 1.6.0 缝合的条目没有记录，只能按「新版中没有」找出。</p></div>`);
    body.addEventListener("change", (e) => {
      const i = e.target.dataset.i;
      if (i == null) return;
      cands[Number(i)].on = e.target.checked;
      e.target.closest(".pa-crow").classList.toggle("on", e.target.checked);
    });
    const ok = await sheet({ title: `搬到新版：找到 ${cands.length} 条`, body, wide: true, noFocus: true, actions: [{ label: "取消", value: null }, { label: "下一步：预览", kind: "primary", value: true }] });
    if (!ok) return;
    const pick = cands.filter((c) => c.on);
    if (!pick.length) return toast("没有勾选条目");
    await review({
      title: `搬 ${pick.length} 条到「${neu.name}」`,
      // 开关沿用旧版里的状态（旧版保留了几种文风只开一种，搬过去也只开那一种）
      entries: pick.map((c) => ({ src: { name: c.p.name, content: c.p.content, prompt: c.p, from: old.name, srcDraft: old, srcId: c.id }, marker: c.marker, hook: c.hook || void 0, enabled: old.order.find((o) => o.identifier === c.id)?.enabled !== false }))
    });
  }
  const off = onDraftChange((name, kind) => {
    if (kind !== "status" && name === focusPreset() && draftViewVisible(page) && st.dstType === "preset") renderDst();
  });
  return {
    toggleLayout() {
      settings().sutureLayout = layout() === "switch" ? "split" : "switch";
      saveSettings();
      paintLayout();
      return layout();
    },
    layout,
    render() {
      dstPicker.refresh();
      renderSrcPick();
      renderSrc();
      renderDst();
    },
    destroy: off
  };
}

