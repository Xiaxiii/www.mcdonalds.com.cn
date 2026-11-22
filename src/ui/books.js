// 2.12.0 预设 → 世界书：按角色卡绑定世界书，查看、修改条目。
// 列表分四段：这个角色（角色卡自带的、只给它的、猜出来的）、所有角色（全局）、本聊天、其他世界书。
// 每行的开关管它在本段的意思；点行或眼睛进到这本书的条目。手机上条目页盖住列表（返回回到原位置），宽屏左右并排。
var WI_POS_SHORT = { 0: "角色定义前", 1: "角色定义后", 2: "作者注释前", 3: "作者注释后", 4: "按深度", 5: "示例前", 6: "示例后" };
var BACK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 6-6 6 6 6"/></svg>';
function wbKeysText(e) {
  return (Array.isArray(e?.key) ? e.key : []).map((k) => String(k).trim()).filter(Boolean);
}
function wbEntryName(e) {
  return String(e?.comment || "").trim() || wbKeysText(e).join("、") || `条目 ${e?.uid}`;
}
// 编辑世界书条目：名称、触发、关键词、插入位置、深度、顺序、正文。返回改了的字段（没改返回 {}），取消返回 null，删除返回 "delete"
async function wbEntrySheet(e, { title = "编辑条目", hint = "", canDelete = true } = {}) {
  const pos = Number(e.position ?? 0);
  const keys = wbKeysText(e).join(", ");
  const body = el(`<div class="pa-form">
      ${hint ? `<p class="pa-hint pa-edit-where">${esc(hint)}</p>` : ""}
      <label class="pa-field"><span>名称</span><input class="pa-input" data-w="comment" autocomplete="off" value="${esc(e.comment || "")}"></label>
      <div class="pa-wb-trig${e.constant ? " pa-kw-none" : ""}">
        <label class="pa-field"><span>触发</span><select class="pa-select" data-w="constant"><option value="1" ${e.constant ? "selected" : ""}>常驻</option><option value="0" ${e.constant ? "" : "selected"}>关键词</option></select></label>
        <div class="pa-field pa-wb-kw" data-show="keys" ${e.constant ? "hidden" : ""}><span class="pa-wb-kwhead"><span>关键词</span><button type="button" class="pa-icon-btn pa-expand" data-w="kwexpand" aria-label="展开关键词" aria-expanded="false" title="展开关键词">${ICON.expand}</button></span><textarea class="pa-input pa-wb-kwtext" data-w="key" rows="1" wrap="off" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="逗号分隔，如：雾港, 港口" aria-label="关键词，逗号分隔">${esc(keys)}</textarea></div>
      </div>
      <div class="pa-item-ctl pa-wbset">
        <label class="pa-field"><span>插入位置</span><select class="pa-select" data-w="position">${WI_POS.map(([k, l]) => `<option value="${k}" ${pos === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        <label class="pa-field" data-show="depth" ${pos === 4 ? "" : "hidden"}><span>深度</span><input class="pa-input" type="number" min="0" inputmode="numeric" autocomplete="off" data-w="depth" value="${esc(e.depth ?? 4)}"></label>
        <label class="pa-field" data-show="depth" ${pos === 4 ? "" : "hidden"}><span>角色</span><select class="pa-select" data-w="role">${[[0, "系统"], [1, "用户"], [2, "AI"]].map(([k, l]) => `<option value="${k}" ${Number(e.role ?? 0) === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        <label class="pa-field"><span>顺序</span><input class="pa-input" type="number" inputmode="numeric" autocomplete="off" data-w="order" value="${esc(e.order ?? 100)}"></label>
      </div>
      <div class="pa-edit-bar"><p class="pa-hint">正文</p><button type="button" class="pa-icon-btn pa-expand" data-w="expand" aria-label="展开正文" title="展开正文">${ICON.expand}</button></div>
      <textarea class="pa-input pa-text pa-edit-text" data-w="content" spellcheck="false" aria-label="正文">${esc(e.content || "")}</textarea>
    </div>`);
  const ta = body.querySelector("[data-w=content]");
  const fit = () => {
    if (!ta.isConnected) return;
    const box = ta.closest(".pa-sheet-body");
    const top = box?.scrollTop;
    ta.style.height = "auto";
    ta.style.height = ta.scrollHeight + 2 + "px";
    if (box && top != null) box.scrollTop = top;
  };
  ta.addEventListener("input", fit);
  requestAnimationFrame(() => requestAnimationFrame(fit));
  setTimeout(fit, 350);
  body.querySelector("[data-w=constant]").addEventListener("change", (ev) => {
    body.querySelector("[data-show=keys]").hidden = ev.target.value === "1";
    body.querySelector(".pa-wb-trig").classList.toggle("pa-kw-none", ev.target.value === "1");
  });
  // 关键词：平时一行（左右滑动看），展开后占满一行、自动换行、全部显示
  const kw = body.querySelector("[data-w=key]");
  const fitKw = () => {
    const open = body.querySelector(".pa-wb-trig").classList.contains("pa-kw-open");
    kw.style.height = "auto";
    if (open) kw.style.height = kw.scrollHeight + 2 + "px";
  };
  kw.addEventListener("input", fitKw);
  kw.addEventListener("keydown", (ev) => {
    // 一行时回车不换行（关键词用逗号分隔）
    if (ev.key === "Enter" && !imeEnter(ev) && !body.querySelector(".pa-wb-trig").classList.contains("pa-kw-open")) ev.preventDefault();
  });
  body.querySelector("[data-w=kwexpand]").addEventListener("click", (ev) => {
    const row = body.querySelector(".pa-wb-trig");
    const on = !row.classList.contains("pa-kw-open");
    row.classList.toggle("pa-kw-open", on);
    kw.setAttribute("wrap", on ? "soft" : "off");
    const b = ev.currentTarget;
    b.innerHTML = on ? ICON.collapse : ICON.expand;
    b.setAttribute("aria-expanded", String(on));
    b.setAttribute("aria-label", on ? "收起关键词" : "展开关键词");
    b.title = on ? "收起关键词" : "展开关键词";
    fitKw();
  });
  body.querySelector("[data-w=position]").addEventListener("change", (ev) => {
    body.querySelectorAll("[data-show=depth]").forEach((x) => { x.hidden = ev.target.value !== "4"; });
  });
  body.querySelector("[data-w=expand]").addEventListener("click", (ev) => {
    const sh = body.closest(".pa-sheet");
    const on = !sh.classList.contains("pa-sheet-max");
    sh.classList.toggle("pa-sheet-max", on);
    ev.currentTarget.innerHTML = on ? ICON.collapse : ICON.expand;
    ev.currentTarget.setAttribute("aria-label", on ? "收起正文" : "展开正文");
    ev.currentTarget.title = on ? "收起正文" : "展开正文";
    fit();
  });
  const read = () => {
    const v = (k) => body.querySelector(`[data-w=${k}]`).value;
    const out = {};
    const comment = v("comment").trim();
    if (comment !== String(e.comment || "")) out.comment = comment;
    if (v("content") !== String(e.content || "")) out.content = v("content");
    const constant = v("constant") === "1";
    if (constant !== !!e.constant) out.constant = constant;
    const key = v("key").split(/[,，\n]/).map((x) => x.trim()).filter(Boolean);
    if (JSON.stringify(key) !== JSON.stringify(wbKeysText(e))) out.key = key;
    const p = Number(v("position"));
    if (p !== Number(e.position ?? 0)) out.position = p;
    if (p === 4) {
      const depth = Math.max(0, Math.floor(Number(v("depth")) || 0));
      if (depth !== Number(e.depth ?? 4)) out.depth = depth;
      const role = Number(v("role"));
      if (role !== Number(e.role ?? 0)) out.role = role;
    }
    const order = Math.floor(Number(v("order")) || 0);
    if (order !== Number(e.order ?? 100)) out.order = order;
    return out;
  };
  const acts = [{ label: "取消", value: null }, { label: "保存", kind: "primary", value: read }];
  if (canDelete) acts.unshift({ label: "删除", kind: "danger-soft", value: "delete" });
  return sheet({
    title, body, wide: true, noFocus: true, guardDirty: true, actions: acts,
    onMount: (w) => {
      const sh = w.querySelector(".pa-sheet");
      sh.classList.add("pa-sheet-edit", "pa-sheet-wbentry");
      const flash = scrollHint(w.querySelector(".pa-sheet-body"), sh);
      setTimeout(() => flash(1500), 400);
    }
  });
}
function mountBooks(page) {
  const st = {
    key: null, // 选中的角色；null 跟随正在聊天的角色
    keyChat: null, // 选角色时所在的聊天：换了聊天就回到正在聊天的角色
    query: "",
    counts: new Map(),
    flash: null, // 刚换了段的书：{ n, at }
    open: null, // 打开的世界书
    entries: null,
    equery: "",
    backedUp: new Set(),
    listTop: 0,
    busy: false
  };
  page.innerHTML = `
    <div class="pa-toolbar pa-bk-bar">
      <div class="pa-picker pa-char-picker"><span>角色</span><button class="pa-namebtn" type="button" data-b="char" aria-label="选择角色"><img class="pa-ava" alt="" width="22" height="22" hidden><span></span><i aria-hidden="true">▾</i></button></div>
      <button class="pa-icon-btn" data-b="search" aria-label="搜索世界书" title="搜索世界书">${ICON.search}</button>
      <div class="pa-findrow pa-qrow" style="${BOX_STYLE}" hidden><input class="pa-input pa-find" style="${FIELD_STYLE}" type="text" inputmode="search" enterkeyhint="search" autocorrect="off" autocapitalize="off" autocomplete="off" spellcheck="false" placeholder="搜世界书名称" aria-label="搜索世界书"><button type="button" class="pa-icon-btn pa-qx" data-b="searchclose" aria-label="关闭搜索"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
    </div>
    <div class="pa-bk">
      <div class="pa-scroll pa-bk-list" role="list" aria-label="世界书"></div>
      <section class="pa-bk-detail" aria-label="世界书条目" hidden></section>
    </div>`;
  const list = page.querySelector(".pa-bk-list");
  const detail = page.querySelector(".pa-bk-detail");
  const search = page.querySelector(".pa-find");
  const charBtn = page.querySelector("[data-b=char]");
  const wide = () => matchMedia("(min-width: 1000px)").matches;
  const char = () => (st.key ? charByKey(st.key) : null) || (st.key ? null : currentChar());
  // ---------- 列表
  // 2.12.2 分段随状态即时变化：给这个角色开的书马上挂到角色名下（角色卡自带的、开着的、名称像的依次排），
  // 关掉就回到「其他世界书」；角色卡自带的那本关了也留在角色名下。换了段的行闪一下，并提示去了哪里
  function computeLayout(ci) {
    const names = listWorldbooks();
    const have = new Set(names);
    const glob = new Set(globalBooks());
    const charList = [];
    const add = (n) => { if (n && have.has(n) && !charList.includes(n)) charList.push(n); };
    if (ci) {
      add(charPrimaryBook(ci));
      charExtraBooks(ci.key).forEach(add);
      guessCharBooks(ci, names).forEach(add);
    }
    const all = names.filter((n) => glob.has(n) && !charList.includes(n));
    const chat = chatBook();
    const chatList = chat && have.has(chat) && !charList.includes(chat) && !glob.has(chat) ? [chat] : [];
    const used = new Set([...charList, ...all, ...chatList]);
    return { char: charList, all, chat: chatList, other: names.filter((n) => !used.has(n)) };
  }
  // 这一次画列表时的状态，一行一行查时不再各自重算（世界书几百本时）
  let snap = null;
  function snapshot(ci) {
    const extra = new Set(ci ? charExtraBooks(ci.key) : []);
    const primary = ci ? charPrimaryBook(ci) : "";
    snap = {
      glob: new Set(globalBooks()),
      chat: chatBook(),
      primary,
      primaryOn: !!primary && (!ci || !ownBookOff(ci.key) || extra.has(primary)),
      extra,
      guess: new Set(ci ? guessCharBooks(ci) : [])
    };
    return snap;
  }
  const charOn = (n) => n === snap.primary ? snap.primaryOn : snap.extra.has(n);
  function rowOn(ci, sec, n) {
    if (sec === "all" || !ci && sec !== "chat") return snap.glob.has(n);
    if (sec === "chat") return snap.chat === n;
    return snap.glob.has(n) || charOn(n);
  }
  function rowMeta(ci, sec, n) {
    const out = [];
    if (n === snap.primary) out.push('<span class="pa-chip pa-chip-cot">角色卡自带</span>');
    else if (ci && sec === "char" && snap.guess.has(n) && !snap.extra.has(n)) out.push('<span class="pa-chip pa-chip-dim">名称像这个角色的</span>');
    if (sec !== "all" && snap.glob.has(n)) out.push('<span class="pa-chip">所有角色</span>');
    if (sec !== "chat" && snap.chat === n) out.push('<span class="pa-chip">本聊天</span>');
    if (sec === "other" && ci && charOn(n)) out.push('<span class="pa-chip">这个角色</span>');
    const c = st.counts.get(n);
    if (c?.total) out.push(`<span class="pa-num">${c.on === c.total ? `${c.total} 条` : `${c.on}/${c.total} 条开着`}</span>`);
    else if (c) out.push("<span>没有条目</span>");
    return out.join("");
  }
  function row(ci, sec, n) {
    const on = rowOn(ci, sec, n);
    const meta = rowMeta(ci, sec, n);
    const label = sec === "all" ? `所有角色都开「${n}」` : sec === "chat" ? `本聊天开「${n}」` : ci ? `给「${ci.name}」开「${n}」` : `所有角色都开「${n}」`;
    const fl = flashAttr(n);
    return `<div class="pa-row pa-bk-row${on ? "" : " pa-off"}${st.open === n ? " pa-editing" : ""}${fl.cls}" data-book="${esc(n)}" data-sec="${sec}" tabindex="0"${fl.style}>
      <span class="pa-namebox"><span class="pa-nameline"><span class="pa-name">${markText(n, st.query.trim().toLowerCase())}</span></span>${meta ? `<small class="pa-meta">${meta}</small>` : ""}</span>
      <button class="pa-icon-btn pa-peek" data-b="peek" aria-label="查看「${esc(n)}」的条目" title="查看条目">${ICON.eye}</button>
      <label class="pa-switch"><input type="checkbox" data-b="toggle" aria-label="${esc(label)}" ${on ? "checked" : ""}><i></i></label>
    </div>`;
  }
  function section(ci, sec, title, names, { note = "", empty = "", count = true } = {}) {
    const q = st.query.trim().toLowerCase();
    const shown = q ? names.filter((n) => n.toLowerCase().includes(q)) : names;
    if (q && !shown.length) return "";
    if (!names.length && !empty) return "";
    const onN = names.filter((n) => rowOn(ci, sec, n)).length;
    // 2.12.1 每段都能折叠，记住最后一次的状态；搜索时全部展开
    const col = !q && !foldGet("books", sec, true);
    return `<section class="pa-group pa-bk-sec${col ? " pa-collapsed" : ""}" data-sec="${sec}">
      <header class="pa-ghead" data-b="fold" role="button" tabindex="0" aria-expanded="${!col}">
        <span class="pa-icon-btn pa-caret" aria-hidden="true">${ICON.caret}</span>
        <span class="pa-gname">${esc(title)}</span>
        ${count && names.length ? `<span class="pa-count">${sec === "other" ? names.length : `${onN}/${names.length}`}</span>` : ""}
      </header>
      <div class="pa-gbody" style="--n:${shown.length}">${note ? `<p class="pa-gnote">${note}</p>` : ""}${shown.length ? shown.map((n) => row(ci, sec, n)).join("") : `<p class="pa-gnote">${empty}</p>`}</div>
    </section>`;
  }
  function paintCharBtn(ci) {
    const cur = currentChar();
    const img = charBtn.querySelector(".pa-ava");
    const name = ci ? ci.name : inGroupChat() ? "群聊" : "没有打开角色";
    charBtn.querySelector("span").textContent = name;
    charBtn.title = ci ? `${ci.name}${ci.key === cur?.key ? "（正在聊天）" : ""}` : name;
    charBtn.classList.toggle("pa-chatting", !!ci && ci.key === cur?.key);
    const url = ci ? charAvatarUrl(ci) : "";
    if (url && img.dataset.src !== url) {
      img.hidden = true;
      img.dataset.src = url;
      img.onload = () => { img.hidden = false; };
      img.onerror = () => { img.hidden = true; };
      img.src = url;
    } else if (!url) {
      img.hidden = true;
      img.removeAttribute("src");
      delete img.dataset.src;
    }
  }
  const chatNow = () => { try { return String(ctx().getCurrentChatId?.() || ctx().chatId || ""); } catch { return ""; } };
  function render() {
    if (st.key && st.keyChat !== chatNow()) {
      st.key = null;
      closeBook();
    }
    const ci = char();
    paintCharBtn(ci);
    const names = listWorldbooks();
    const top = list.scrollTop;
    if (!mods.wi) {
      list.innerHTML = '<p class="pa-empty">读不到酒馆的世界书模块，酒馆版本可能过旧。</p>';
      return;
    }
    if (!names.length) {
      list.innerHTML = '<p class="pa-empty">还没有世界书。在酒馆的世界书面板里新建或导入。</p>';
      closeBook();
      return;
    }
    const L = computeLayout(ci);
    snapshot(ci);
    let html = "";
    if (ci) {
      html += section(ci, "char", ci.name, L.char, { empty: "这个角色还没有绑世界书。在「其他世界书」里打开的书只给这个角色用。" });
    } else {
      html += `<p class="pa-hint pa-bk-none">${inGroupChat() ? "群聊没有单个角色卡。" : "没有打开角色。"}点上方「角色」选一个角色来绑世界书；不选时，这里的开关对所有角色生效。</p>`;
    }
    html += section(ci, "all", "所有角色", L.all, { note: L.all.length ? "换角色后仍然开着。" : "" });
    html += section(ci, "chat", "本聊天", L.chat);
    html += section(ci, "other", "其他世界书", L.other);
    if (st.query.trim() && !html.includes("pa-bk-row")) html += '<p class="pa-empty">没有匹配的世界书</p>';
    list.innerHTML = html;
    list.scrollTop = top;
    loadCounts([...L.char, ...L.all, ...L.chat]);
    if (wide() && !st.open) {
      const first = L.char.find((n) => rowOn(ci, "char", n)) || L.char[0] || L.all[0] || L.chat[0];
      if (first) openBook(first, { focus: false });
    }
  }
  // 段里的书：条目数和开着的条数（酒馆读过的直接用缓存）
  let counting = false;
  async function loadCounts(names) {
    const need = names.filter((n) => !st.counts.has(n));
    if (!need.length || counting) return;
    counting = true;
    try {
      for (const n of need) {
        try {
          const data = await mods.wi.loadWorldInfo(n);
          const es = Object.values(data?.entries || {});
          st.counts.set(n, { total: es.length, on: es.filter((e) => !e.disable).length });
        } catch {
          st.counts.set(n, null);
        }
      }
    } finally {
      counting = false;
    }
    if (draftViewVisible(page)) render();
  }
  // 闪一下：列表随后重画（条目数读回来时）也接着闪完，不从头再闪
  function flashRow(n) {
    st.flash = { n, at: Date.now() };
    const r = list.querySelector(`.pa-bk-row[data-book="${CSS.escape(n)}"]`);
    if (!r) return;
    r.classList.remove("pa-flash");
    void r.offsetWidth;
    r.classList.add("pa-flash");
  }
  function flashAttr(n) {
    const f = st.flash;
    const t = f && f.n === n ? Date.now() - f.at : Infinity;
    return t < 1400 ? { cls: " pa-flash", style: ` style="animation-delay:-${t}ms"` } : { cls: "", style: "" };
  }
  const SEC_NAME = { all: "所有角色", chat: "本聊天", other: "其他世界书" };
  function secOf(ci, n) {
    const L = computeLayout(ci);
    return Object.keys(L).find((k) => L[k].includes(n)) || null;
  }
  // 行换到了别的段：那一段收着时展开，行闪一下，提示去了哪里
  function noteMoved(ci, n, from) {
    const to = secOf(ci, n);
    if (!to || to === from) return;
    if (!foldGet("books", to, true)) foldSet("books", to, true);
    render();
    flashRow(n);
    toast(to === "char" ? `「${n}」已挂到「${ci.name}」名下` : to === "all" ? `「${n}」已开给所有角色` : `「${n}」已移到「${SEC_NAME[to]}」`, "success");
  }
  async function toggle(sec, n, on) {
    const ci = char();
    try {
      if (sec === "all") setGlobalBook(n, on);
      else if (sec === "chat") await setChatBook(on ? n : null);
      else if (!ci) setGlobalBook(n, on);
      else if (n === charPrimaryBook(ci)) {
        if (!on && globalBooks().includes(n)) setGlobalBook(n, false);
        setCharBookOn(ci, n, on);
      } else setBookScope(ci, n, on ? "char" : "none");
    } catch (e) {
      toast(e.message, "error");
    }
    render();
    if (st.open === n) paintScope();
    noteMoved(ci, n, sec);
  }
  list.addEventListener("click", (e) => {
    const fold = e.target.closest("[data-b=fold]");
    if (fold) {
      const sec = fold.closest(".pa-bk-sec");
      const open = sec.classList.contains("pa-collapsed");
      foldSet("books", sec.dataset.sec, open);
      return render();
    }
    const r = e.target.closest(".pa-bk-row");
    if (!r) return;
    const box = e.target.closest("[data-b=toggle]");
    if (box) return void toggle(r.dataset.sec, r.dataset.book, box.checked);
    if (e.target.closest(".pa-switch")) return;
    openBook(r.dataset.book);
  });
  // ---------- 条目
  function closeBook() {
    if (!st.open) return;
    st.open = null;
    st.entries = null;
    detail.hidden = true;
    detail.replaceChildren();
    page.classList.remove("pa-bk-open");
    list.querySelectorAll(".pa-bk-row.pa-editing").forEach((x) => x.classList.remove("pa-editing"));
  }
  function backToList() {
    const n = st.open;
    closeBook();
    list.scrollTop = st.listTop;
    if (n) list.querySelector(`.pa-bk-row[data-book="${CSS.escape(n)}"]`)?.focus({ preventScroll: true });
  }
  async function openBook(n, { focus = true } = {}) {
    if (!wide()) st.listTop = list.scrollTop;
    if (st.open !== n) { st.equery = ""; st.backedUp.delete(n); }
    st.open = n;
    st.entries = null;
    page.classList.add("pa-bk-open");
    detail.hidden = false;
    list.querySelectorAll(".pa-bk-row").forEach((x) => x.classList.toggle("pa-editing", x.dataset.book === n));
    detail.innerHTML = `<div class="pa-bk-dhead">
        <button class="pa-icon-btn pa-bk-back" data-e="back" data-esc-back aria-label="返回世界书列表" title="返回">${BACK_ICON}</button>
        <b class="pa-bk-dname" title="${esc(n)}">${esc(n)}</b>
        <button class="pa-icon-btn" data-e="search" aria-label="搜索条目" aria-expanded="false" title="搜索条目">${ICON.search}</button>
        <button class="pa-icon-btn" data-e="new" aria-label="新建条目" title="新建条目">${ICON.plus}</button>
      </div>
      <div class="pa-bk-q" hidden><div class="pa-findrow pa-qrow" style="${BOX_STYLE}"><input class="pa-input" data-e="q" style="${FIELD_STYLE}" type="text" inputmode="search" enterkeyhint="search" autocorrect="off" autocapitalize="off" autocomplete="off" spellcheck="false" placeholder="搜条目名称、关键词或正文" aria-label="搜索条目"><button type="button" class="pa-icon-btn pa-qx" data-e="searchclose" aria-label="关闭搜索"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div></div>
      <div class="pa-scroll pa-bk-entries"><div class="pa-bk-scope"></div><div class="pa-bk-rows" role="list" aria-label="条目"><p class="pa-empty">正在读取…</p></div></div>`;
    const q = detail.querySelector("[data-e=q]");
    onSearchInput(q, () => { st.equery = q.value; paintEntries(); });
    scrollHint(detail.querySelector(".pa-bk-entries"), detail);
    paintScope();
    if (focus && !wide()) detail.querySelector("[data-e=back]")?.focus({ preventScroll: true });
    await loadEntries(n);
  }
  async function loadEntries(n) {
    try {
      const data = await mods.wi.loadWorldInfo(n);
      if (st.open !== n) return;
      if (!data?.entries) throw new Error(`读不到世界书「${n}」`);
      st.entries = wiSorted(data);
      st.counts.set(n, { total: st.entries.length, on: st.entries.filter((e) => !e.disable).length });
    } catch (e) {
      if (st.open !== n) return;
      st.entries = null;
      const box = detail.querySelector(".pa-bk-rows");
      if (box) box.innerHTML = `<p class="pa-empty">读取失败：${esc(e.message)}<br><button class="pa-btn pa-btn-s" data-e="retry">重试</button></p>`;
      return;
    }
    paintEntries();
  }
  function paintScope() {
    const box = detail.querySelector(".pa-bk-scope");
    if (!box || !st.open) return;
    const ci = char();
    const n = st.open;
    const scope = bookScope(ci, n);
    const primary = ci && n === charPrimaryBook(ci);
    const opts = ci ? [["none", "不用"], ["char", "这个角色"], ["all", "所有角色"]] : [["none", "不用"], ["all", "所有角色"]];
    const noOff = primary && !ownOffSupported();
    let note = "";
    if (scope === "all") note = "所有角色都会用到，换角色后仍然开着。";
    else if (scope === "char") note = primary ? `「${ci.name}」的角色卡自带，只在和它聊天时生效。` : `只在和「${ci.name}」聊天时生效。`;
    else if (primary) note = noOff ? "酒馆版本较旧，角色卡自带的世界书不能单独关。" : "已关掉。角色卡里的绑定不变，生成时跳过这本。";
    else note = ci ? "没给这个角色用。选「这个角色」只在和它聊天时生效。" : "没开。";
    const chat = chatBook() === n ? `<p class="pa-hint pa-bk-chatnote">也绑在当前聊天上：在这个聊天里一直生效。<button class="pa-link" data-e="unchat">解除本聊天绑定</button></p>` : "";
    box.innerHTML = `<div class="pa-bk-scoperow"><span>用在</span><div class="pa-seg pa-seg-s" role="group" aria-label="「${esc(n)}」用在">${opts.map(([k, l]) => `<button type="button" data-scope="${k}" class="${scope === k ? "on" : ""}" aria-pressed="${scope === k}" ${k === "none" && noOff ? "disabled" : ""}>${l}</button>`).join("")}</div></div>
      <p class="pa-hint pa-bk-scopenote">${esc(note)}</p>${chat}`;
  }
  function paintEntries() {
    const box = detail.querySelector(".pa-bk-rows");
    if (!box || !st.entries) return;
    const q = st.equery.trim().toLowerCase();
    const all = st.entries;
    const hit = (e) => !q || wbEntryName(e).toLowerCase().includes(q) || wbKeysText(e).some((k) => k.toLowerCase().includes(q));
    const bodyHit = (e) => q && !hit(e) && String(e.content || "").toLowerCase().includes(q);
    const shown = all.filter((e) => hit(e) || bodyHit(e));
    const onN = all.filter((e) => !e.disable).length;
    const head = `<p class="pa-qsum pa-bk-sum">${q ? `匹配 <b>${shown.length}</b> 条，共 ${all.length} 条` : all.length ? `共 <b>${all.length}</b> 条，开着 ${onN} 条` : ""}</p>`;
    if (!all.length) {
      box.innerHTML = '<p class="pa-empty">这本世界书还没有条目。<br><button class="pa-btn pa-btn-s" data-e="new">＋ 新建条目</button></p>';
      return;
    }
    const sc = detail.querySelector(".pa-bk-entries");
    const top = sc.scrollTop;
    box.innerHTML = head + (shown.length ? shown.map((e) => {
      const on = !e.disable;
      const name = wbEntryName(e);
      const keys = wbKeysText(e);
      const meta = [e.constant ? "常驻" : keys.length ? `关键词：${keys.slice(0, 3).join("、")}${keys.length > 3 ? " 等" : ""}` : "没有关键词", WI_POS_SHORT[Number(e.position ?? 0)] || "", Number(e.position) === 4 ? `深度 ${e.depth ?? 4}` : ""].filter(Boolean);
      const snip = bodyHit(e) ? (() => { const c = String(e.content || ""); const i = c.toLowerCase().indexOf(q); return hitSnippet(c, i, q.length); })() : "";
      return `<div class="pa-row pa-wbe-row${on ? "" : " pa-off"}" data-uid="${esc(e.uid)}" tabindex="0">
        <span class="pa-namebox"><span class="pa-nameline"><span class="pa-name">${markText(name, q)}</span></span>${snip ? `<small class="pa-hitline">正文：${snip}</small>` : ""}<small class="pa-meta">${meta.map((m) => `<span>${esc(m)}</span>`).join("")}</small></span>
        <button class="pa-icon-btn pa-peek" data-e="edit" aria-label="查看或编辑「${esc(name)}」" title="查看或编辑">${ICON.eye}</button>
        <label class="pa-switch"><input type="checkbox" data-e="toggle" aria-label="开启「${esc(name)}」" ${on ? "checked" : ""}><i></i></label>
      </div>`;
    }).join("") : '<p class="pa-empty">没有匹配的条目</p>');
    sc.scrollTop = top;
  }
  // 每打开一本书，第一次写入前备份一次
  async function backupOnce(n) {
    if (st.backedUp.has(n) || !backupOn()) return true;
    try {
      await backupPut(`世界书：${n}`, await mods.wi.loadWorldInfo(n), "编辑前");
      st.backedUp.add(n);
      return true;
    } catch (e) {
      const ok = await confirmBox("备份失败", `修改前备份世界书「${n}」没有成功（${e.message}）。仍要保存吗？`, "仍要保存");
      if (ok) st.backedUp.add(n);
      return ok;
    }
  }
  async function afterWrite(n) {
    st.counts.delete(n);
    if (st.open === n) await loadEntries(n);
    render();
  }
  async function editEntry(uid) {
    const n = st.open;
    const e = st.entries?.find((x) => String(x.uid) === String(uid));
    if (!e) return;
    const r = await wbEntrySheet(e, { title: wbEntryName(e) });
    if (!r) return;
    if (r === "delete") {
      if (!await confirmBox("删除条目", `删除「${wbEntryName(e)}」？${backupOn() ? "删除前会备份这本世界书，可在「清理 → 本地备份」找回。" : ""}`, "删除", true)) return;
      if (!await backupOnce(n)) return;
      try {
        await deleteWorldEntry(n, uid);
        toast("已删除", "success");
      } catch (err) {
        return toast("删除失败：" + err.message, "error");
      }
      return afterWrite(n);
    }
    if (!Object.keys(r).length) return;
    if (!await backupOnce(n)) return;
    try {
      await updateWorldEntry(n, uid, r);
      toast("已保存", "success");
    } catch (err) {
      return toast("保存失败：" + err.message, "error");
    }
    afterWrite(n);
  }
  async function newEntry() {
    const n = st.open;
    if (!n) return;
    const blank = { comment: "", content: "", constant: false, key: [], position: 0, depth: 4, order: 100, role: 0 };
    const r = await wbEntrySheet(blank, { title: "新建条目", hint: `保存后写入世界书「${n}」，放在最后。`, canDelete: false });
    if (!r || r === "delete") return;
    const fields = { ...blank, ...r, disable: false };
    if (!await backupOnce(n)) return;
    try {
      const last = st.entries?.length ? st.entries[st.entries.length - 1].uid : null;
      await writeWorldEntries(n, [fields], last);
      toast("已新建", "success");
    } catch (err) {
      return toast("新建失败：" + err.message, "error");
    }
    await afterWrite(n);
    const box = detail.querySelector(".pa-bk-entries");
    if (box) box.scrollTop = box.scrollHeight;
  }
  detail.addEventListener("click", async (e) => {
    const a = e.target.closest("[data-e], [data-scope]");
    if (a?.dataset.scope) {
      const ci = char();
      const from = secOf(ci, st.open);
      try { setBookScope(ci, st.open, a.dataset.scope); } catch (err) { toast(err.message, "error"); }
      paintScope();
      render();
      noteMoved(ci, st.open, from);
      return;
    }
    const act = a?.dataset.e;
    if (act === "back") return backToList();
    if (act === "search" || act === "searchclose") {
      const qbox = detail.querySelector(".pa-bk-q");
      const q = detail.querySelector("[data-e=q]");
      const open = act === "search" && qbox.hidden;
      qbox.hidden = !open;
      detail.querySelector("[data-e=search]").setAttribute("aria-expanded", String(open));
      if (open) return q.focus();
      if (q.value || st.equery) { q.value = ""; st.equery = ""; paintEntries(); }
      detail.querySelector("[data-e=search]").focus({ preventScroll: true });
      return;
    }
    if (act === "new") return newEntry();
    if (act === "retry") return st.open && loadEntries(st.open);
    if (act === "unchat") {
      try { await setChatBook(null); } catch (err) { toast(err.message, "error"); }
      paintScope();
      return render();
    }
    const r = e.target.closest(".pa-wbe-row");
    if (!r) return;
    if (act === "toggle") {
      const n = st.open;
      const on = a.checked;
      if (!await backupOnce(n)) { a.checked = !on; return; }
      try {
        await updateWorldEntry(n, r.dataset.uid, { disable: !on });
      } catch (err) {
        a.checked = !on;
        return toast("保存失败：" + err.message, "error");
      }
      const ent = st.entries?.find((x) => String(x.uid) === r.dataset.uid);
      if (ent) ent.disable = !on;
      r.classList.toggle("pa-off", !on);
      st.counts.set(n, { total: st.entries.length, on: st.entries.filter((x) => !x.disable).length });
      const sum = detail.querySelector(".pa-bk-sum");
      if (sum && !st.equery.trim()) sum.innerHTML = `共 <b>${st.entries.length}</b> 条，开着 ${st.counts.get(n).on} 条`;
      return;
    }
    if (e.target.closest(".pa-switch")) return;
    editEntry(r.dataset.uid);
  });
  // ---------- 工具栏
  page.querySelector(".pa-bk-bar").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-b]")?.dataset.b;
    if (b === "search" || b === "searchclose") {
      const r = page.querySelector(".pa-bk-bar .pa-findrow");
      r.hidden = b === "searchclose" || !r.hidden;
      if (r.hidden) {
        search.value = "";
        if (st.query) { st.query = ""; render(); }
      } else search.focus();
      return;
    }
    if (b === "char") {
      const cur = currentChar();
      const chars = listChars();
      if (!chars.length) return toast("还没有角色卡");
      const dup = new Map();
      chars.forEach((c) => dup.set(c.name, (dup.get(c.name) || 0) + 1));
      const ci = char();
      const v = await pickName({
        title: "选择角色",
        current: ci?.key || null,
        items: chars.map((c) => ({ value: c.key, label: c.name, sub: c.key === cur?.key ? "正在聊天" : dup.get(c.name) > 1 ? c.avatar : "" })),
        extra: cur && st.key && st.key !== cur.key ? { label: "回到正在聊天的", value: "__cur" } : null
      });
      if (!v) return;
      st.key = v === "__cur" || v === cur?.key ? null : v;
      st.keyChat = chatNow();
      closeBook();
      render();
    }
  });
  onSearchInput(search, () => { st.query = search.value; render(); });
  return {
    render(_k, fresh) {
      if (fresh) st.counts.clear();
      render();
      if (st.open && !st.entries) loadEntries(st.open);
    },
    // 换了聊天（可能换了角色）：跟随正在聊天的角色
    onChat() {
      st.key = null;
      closeBook();
      render();
    },
    onWorldSettings() {
      render();
      if (st.open) paintScope();
    }
  };
}
