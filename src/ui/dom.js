var esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c2) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c2]);
function toast(msg, type = "info") {
  const t = globalThis.toastr;
  if (!t?.[type]) return console.log("[麦当劳]", msg);
  // 2.8.0 点按即关闭，与酒馆其他提示一致
  // 2.11.17 停留时间按字数算（约每秒 8 字）：至少 3 秒、报错至少 6 秒，至多 8 秒
  const len = String(msg).replace(/<[^>]*>/g, "").length;
  const timeOut = Math.min(8e3, Math.max(type === "error" ? 6e3 : 3e3, 1200 + len * 125));
  const $t = t[type](msg, "", { timeOut, preventDuplicates: true, tapToDismiss: true, closeOnHover: false });
  tapToClose(t, $t);
}
// 2.8.8 酒馆的提示默认「悬停时暂停」：iOS 上第一下点按只算悬停，提示既不关闭、也不再倒计时。
// 本扩展的提示关掉悬停暂停（closeOnHover: false），并在手指抬起时直接关闭
function tapToClose(t, $t) {
  const node = $t?.[0];
  if (!node?.addEventListener) return;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    t.clear($t, { force: true });
  };
  node.addEventListener("click", close);
  node.addEventListener("pointerup", close);
}
var rootEl = null;
// 2.8.9 按住把手拖动排序。拖动中被拖的行只做位移、其余行让位，松手后才改顺序：
// 拖动中移动被按住的元素会让浏览器中断这次拖动（只挪一格就停，iOS 上直接取消）。
// 把手是按钮，聚焦后按 ↑ ↓ 也能移动。onDrop(from, to) 由调用方改数据并重画
function dragSort(container, { grip, row, onDrop }) {
  container.addEventListener("keydown", (e) => {
    const g = e.target.closest?.(grip);
    if (!g || !container.contains(g) || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    const rows = [...container.querySelectorAll(row)];
    const from = rows.indexOf(g.closest(row));
    const to = from + (e.key === "ArrowUp" ? -1 : 1);
    if (from < 0 || to < 0 || to >= rows.length) return;
    e.preventDefault();
    onDrop(from, to, { keyboard: true });
  });
  container.addEventListener("pointerdown", (e) => {
    const g = e.target.closest?.(grip);
    if (!g || !container.contains(g) || e.button > 0) return;
    const me = g.closest(row);
    const rows = [...container.querySelectorAll(row)];
    const from = rows.indexOf(me);
    if (from < 0 || rows.length < 2) return;
    e.preventDefault();
    const rects = rows.map((r) => r.getBoundingClientRect());
    const gap = Math.max(0, rects[1].top - rects[0].bottom);
    const step = rects[from].height + gap;
    const mids = rects.map((r) => r.top + r.height / 2);
    const startY = e.clientY;
    let scroller = me.parentElement;
    while (scroller && scroller !== document.body && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
    const scroll0 = scroller?.scrollTop || 0;
    let to = from;
    me.classList.add("pa-dragging");
    try { g.setPointerCapture(e.pointerId); } catch {}
    const move = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      // 靠近滚动区上下边缘时跟着滚
      if (scroller && scroller !== document.body) {
        const sr = scroller.getBoundingClientRect();
        if (ev.clientY < sr.top + 40) scroller.scrollTop -= 10;
        else if (ev.clientY > sr.bottom - 40) scroller.scrollTop += 10;
      }
      const dy = ev.clientY - startY + ((scroller?.scrollTop || 0) - scroll0);
      const center = mids[from] + dy;
      to = mids.filter((m, i) => i !== from && m < center).length;
      me.style.transform = `translateY(${dy}px)`;
      rows.forEach((r, i) => {
        if (r === me) return;
        const shift = from < to && i > from && i <= to ? -step : from > to && i < from && i >= to ? step : 0;
        r.style.transform = shift ? `translateY(${shift}px)` : "";
      });
    };
    const end = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      me.classList.remove("pa-dragging");
      rows.forEach((r) => { r.style.transform = ""; });
      if (ev.type === "pointerup" && to !== from) onDrop(from, to, { keyboard: false });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  });
}
// 数组里把第 from 项移到第 to 项
function moveItem(list, from, to) {
  const [x] = list.splice(from, 1);
  list.splice(to, 0, x);
  return list;
}
// 2.8.8 只滚动 node 所在的那个滚动容器，让它居中（block = "start" 时靠上）。
// scrollIntoView 会连带滚动外层：模型很多时把整页（html）滚上去几百像素，面板和弹窗跟着上移，✕ 跑到屏幕外点不到
function scrollToView(node, block = "center", smooth = false) {
  if (!node?.isConnected) return;
  let box = node.parentElement;
  while (box && box !== document.body && box !== document.documentElement) {
    const oy = getComputedStyle(box).overflowY;
    if ((oy === "auto" || oy === "scroll") && box.scrollHeight > box.clientHeight + 1) break;
    box = box.parentElement;
  }
  if (!box || box === document.body || box === document.documentElement) return;
  const r = node.getBoundingClientRect(), br = box.getBoundingClientRect();
  const delta = block === "start" ? r.top - br.top : r.top - br.top - (box.clientHeight - r.height) / 2;
  if (Math.abs(delta) < 1) return;
  box.scrollTo({ top: box.scrollTop + delta, behavior: smooth ? "smooth" : "auto" });
}
// 等这一帧画出来再继续：先显示「正在…」，重活放到下一帧
const nextPaint = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
// 2.5.0 最近点的按钮：菜单贴着它弹出，不再从屏幕底部升上来
var lastTap = null;
// 2.12.16 弹窗的关闭键、正在淡出的弹窗里点的不算：下一级菜单贴着它会悬在半空（旧弹窗 150ms 后才移除）
const noteTap = (e) => {
  const b = e.target?.closest?.("button, [role=button], [data-a], [data-act], [data-tool], [data-s]");
  if (!b || b.closest(".pa-sheet-x, .pa-out")) return;
  lastTap = { el: b, t: Date.now() };
};
function recentAnchor() {
  const a = lastTap?.el;
  return a && Date.now() - lastTap.t < 1500 && a.isConnected && a.offsetParent && !a.closest(".pa-out") ? a : null;
}
// 2.5.0 ⓘ 按钮（data-tipbtn）展开同一块里的说明（data-tipnote），整个面板共用，不用每处单独绑定
const onTipBtn = (e) => {
  const b = e.target?.closest?.("[data-tipbtn]");
  if (!b) return;
  e.preventDefault();
  let note = null;
  for (let p = b.parentElement; p && !note; p = p.parentElement) note = [...p.children].find((c) => c.hasAttribute("data-tipnote")) || null;
  if (!note) return;
  const open = accClosed(note);
  accHidden(note, open);
  b.setAttribute("aria-expanded", String(open));
  b.classList.toggle("on", open);
};
function setRoot(el2) {
  rootEl = el2;
  el2?.addEventListener("click", noteTap, true);
  el2?.addEventListener("click", onTipBtn);
  if (el2) watchSegs(el2);
}
function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
// 2.5.12 酒馆的主题、其他扩展会改搜索框（方角白底、下面多一截底色），按类型改的、按类名改的都有。
// 输入框的外观直接写在元素上（行内 !important），样式表盖不过；玻璃主题用变量换边框和阴影。
// 外面那一层只清掉别人加的底色、边框、内外边距（类名也不再带 search）
var FIELD_STYLE = "-webkit-appearance:none!important;appearance:none!important;border-radius:8px!important;background-color:var(--pa-input-bg)!important;background-image:none!important;border:1px solid var(--pa-key-bc,var(--pa-line))!important;box-shadow:var(--pa-key-sh,none)!important;margin:0!important";
var BOX_STYLE = "background:transparent!important;background-image:none!important;border:0!important;box-shadow:none!important;padding:0!important;margin:0!important";
// 2.5.16 列表行（选预设、选模型）的底色同样写在元素上；选中等状态改 --pa-row-bg（见样式表）
var ROW_STYLE = "background-color:var(--pa-row-bg,var(--pa-card))!important;background-image:none!important";
// 2.5.17 列表外面几层（选预设、选模型）：别处的样式会给整块列表铺白底，把弹窗的画盖住；只清底色和阴影
var LIST_STYLE = "background:transparent!important;background-image:none!important;box-shadow:none!important";
// 2.5.15 复制文字。http 打开的酒馆（不是 https）里浏览器不给 navigator.clipboard，退回选中再复制；
// 传了输入框就选中框里的字，复制不了时选区还在，可以长按手动复制
async function copyText(text, input = null) {
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    try { await navigator.clipboard.writeText(text); return true; } catch {}
  }
  const box = input || Object.assign(document.createElement("textarea"), { value: text });
  if (!input) {
    box.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;font-size:16px;";
    (rootEl || document.body).append(box);
  }
  let ok = false;
  try {
    box.focus({ preventScroll: true });
    box.select();
    box.setSelectionRange(0, box.value.length);
    ok = document.execCommand("copy");
  } catch {}
  if (!input) box.remove();
  return ok;
}
function sheet(opt) {
  return new Promise((resolve) => {
    // place：省略时手机上从底部升起、电脑上居中（大窗口）；"center" 屏幕中间偏上的小卡片；"pop" 贴着 anchor 弹出的菜单
    const place = opt.place === "pop" && opt.anchor ? "pop" : opt.place === "center" ? "center" : "";
    const wrap = el(`<div class="pa-sheet-mask${place ? ` pa-mask-${place}` : ""}"><div class="pa-sheet ${opt.wide ? "pa-sheet-wide" : ""}${place ? ` pa-sheet-${place}` : ""}${opt.cls ? ` ${opt.cls}` : ""}" role="dialog" aria-modal="true" tabindex="-1" aria-label="${esc(opt.title)}">
            <div class="pa-sheet-head"><b>${esc(opt.title)}</b><button class="pa-icon-btn pa-sheet-x" aria-label="关闭"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
            <div class="pa-sheet-body"></div>
            <div class="pa-sheet-actions"></div></div></div>`);
    const body = wrap.querySelector(".pa-sheet-body");
    if (typeof opt.body === "string") body.innerHTML = opt.body;
    else if (opt.body) body.append(opt.body);
    const acts = wrap.querySelector(".pa-sheet-actions");
    const done = (v) => {
      if (wrap.classList.contains("pa-out")) return;
      // 2.12.19 贴边菜单先播 130ms 柔退（.is-closing），再卸载
      wrap.classList.add("pa-out", "is-closing");
      setTimeout(() => wrap.remove(), 150);
      document.removeEventListener("keydown", onKey, true);
      wrap.dispatchEvent(new Event("pa-closed"));
      resolve(v);
    };
    // 2.12.16 选中列表项后直接关窗：不模拟点 ✕（会触发 guardDirty 询问、被记成最近点的按钮）
    wrap._close = done;
    for (const a of opt.actions || [{ label: "确定", kind: "primary", value: true }]) {
      const b = el(`<button class="pa-btn ${a.kind ? "pa-btn-" + a.kind : ""}">${esc(a.label)}</button>`);
      b.addEventListener("click", async () => {
        if (a.validate) {
          const ok = await a.validate(wrap);
          if (!ok) return;
        }
        done(typeof a.value === "function" ? a.value(wrap) : a.value);
      });
      acts.append(b);
    }
    if (!(opt.actions || []).length) acts.remove();
    // 2.8.7 guardDirty：填过字的窗口，点窗口外、按 Esc、返回手势、点 ✕ 时先问一句，免得误触丢掉刚写的内容；「取消」按钮照常直接关
    // guardDirty 传函数时由调用方给出「填了什么」的摘要（如站点窗口里看过的密钥不算改动）
    const snap = () => typeof opt.guardDirty === "function" ? opt.guardDirty(wrap) : JSON.stringify([...wrap.querySelectorAll(".pa-sheet-body :is(input, textarea, select)")].map((x) => x.type === "checkbox" || x.type === "radio" ? x.checked : x.value));
    let snap0 = null, asking = false;
    const dismiss = async () => {
      if (asking) return;
      if (opt.guardDirty && snap0 !== null && snap() !== snap0) {
        asking = true;
        const ok = await confirmBox("放弃未保存的修改", "这个窗口里填写的内容尚未保存。", "放弃修改", true, "继续编辑");
        asking = false;
        if (!ok) return;
      }
      done(null);
    };
    wrap.querySelector(".pa-sheet-x").addEventListener("click", dismiss);
    wrap.addEventListener("click", (e) => {
      if (e.target === wrap) dismiss();
    });
    // 叠着好几个弹窗时，Esc 和 Tab 只给最上面那个
    const isTop = () => {
      const all = (rootEl || document.body).querySelectorAll(".pa-sheet-mask:not(.pa-out)");
      return all[all.length - 1] === wrap;
    };
    const onKey = (e) => {
      if (!isTop()) return;
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        e.preventDefault();
        dismiss();
        return;
      }
      // 2.11.26 菜单里上下键在选项之间移动，Home / End 到头尾
      if (place === "pop" && ["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
        const f = [...wrap.querySelectorAll(".pa-pick-item, .pa-npick-item")].filter((x) => !x.disabled && x.offsetParent !== null);
        if (!f.length) return;
        e.preventDefault();
        const i = f.indexOf(document.activeElement);
        const n = e.key === "Home" ? 0 : e.key === "End" ? f.length - 1 : e.key === "ArrowDown" ? (i + 1) % f.length : (i <= 0 ? f.length : i) - 1;
        f[n].focus();
        return;
      }
      if (e.key === "Tab") {
        // 焦点留在弹窗里
        const f = [...wrap.querySelectorAll('button, [href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])')].filter((x) => !x.disabled && x.offsetParent !== null);
        if (!f.length) return;
        const i = f.indexOf(document.activeElement);
        if (e.shiftKey && (i <= 0)) {
          e.preventDefault();
          f[f.length - 1].focus();
        } else if (!e.shiftKey && (i === -1 || i === f.length - 1)) {
          e.preventDefault();
          f[0].focus();
        }
      }
    };
    document.addEventListener("keydown", onKey, true);
    const back = document.activeElement;
    const restoreFocus = () => { try { if (back?.isConnected) back.focus({ preventScroll: true }); } catch {} };
    wrap.addEventListener("pa-closed", restoreFocus);
    // 2.8.8 打开弹窗不应滚动酒馆页面本身；滚动了（聚焦、外部脚本）就滚回去，免得面板和弹窗整体上移
    const docEl = document.scrollingElement || document.documentElement;
    const docY = docEl.scrollTop;
    (rootEl || document.body).append(wrap);
    if (place === "pop") placePop(wrap, opt.anchor, opt.popWidth);
    opt.onMount?.(wrap);
    if (opt.guardDirty) snap0 = snap();
    const first = wrap.querySelector("input:not([type=checkbox]):not([type=radio]), textarea");
    // focusInput：触屏上也直接把光标放进输入框（弹出键盘），用于点了就要打字的搜索窗
    if (first && !opt.noFocus && (opt.focusInput || matchMedia("(pointer:fine)").matches)) first.focus();
    else wrap.querySelector(".pa-sheet")?.focus({ preventScroll: true });
    if (docEl.scrollTop !== docY) docEl.scrollTop = docY;
  });
}
// 2.5.0 原地改名：把这段文字换成输入框，回车或点别处保存，Esc 取消。返回新名字，没改返回 null
// 2.12.15 wrap：长名称折行、框随内容变高，手机上改长名称也看得到全文（单行框只露出一截）。回车仍是保存
function inlineEdit(target, value, { placeholder = "", selectAll = true, wrap = false } = {}) {
  return new Promise((resolve) => {
    const old = target.innerHTML;
    const input = wrap
      ? el(`<textarea class="pa-input pa-inline-input pa-inline-wrap" rows="1" placeholder="${esc(placeholder)}" maxlength="120" aria-label="新名称" autocomplete="off" spellcheck="false"></textarea>`)
      : el(`<input class="pa-input pa-inline-input" value="${esc(value)}" placeholder="${esc(placeholder)}" maxlength="120" aria-label="新名称">`);
    if (wrap) {
      input.value = value;
      const fit = () => { input.style.height = "auto"; input.style.height = input.scrollHeight + 2 + "px"; };
      input.addEventListener("input", () => {
        if (/[\r\n]/.test(input.value)) input.value = input.value.replace(/[\r\n]+/g, "");
        fit();
      });
      requestAnimationFrame(fit);
    }
    target.innerHTML = "";
    target.append(input);
    target.classList.add("pa-inline-editing");
    let finished = false;
    const finish = (v) => {
      if (finished) return;
      finished = true;
      target.classList.remove("pa-inline-editing");
      target.innerHTML = old;
      resolve(v && v !== value ? v : null);
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !imeEnter(e)) { e.preventDefault(); finish(input.value.trim()); }
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(null); }
    });
    input.addEventListener("blur", () => finish(input.value.trim()));
    for (const t of ["click", "pointerdown"]) input.addEventListener(t, (e) => e.stopPropagation());
    setTimeout(() => {
      input.focus();
      if (selectAll) input.select();
      else input.setSelectionRange(input.value.length, input.value.length);
    }, 40);
  });
}
// 贴着按钮放菜单：宽度按内容（样式里限定 184–300px）；按钮在左半边时左对齐、右半边时右对齐，不出边；
// 下面放得下就放下面，否则放上面。2.11.25 弹出动画从按钮那一角长出来
// 2.12.19 popWidth：与选框等宽的下拉（如副 API 功能卡的模型框），宽度跟着 anchor
function placePop(wrap, anchor, popWidth = false) {
  const box = wrap.querySelector(".pa-sheet");
  if (popWidth) { box.classList.add("pa-pop-match"); box.style.width = Math.max(220, anchor.getBoundingClientRect().width) + "px"; }
  // 2.11.26 标题和点的那一行、那个按钮说的一样（如「推荐缝合位置」「新建」）就不显示；说的是哪一组、哪个方案时留着
  const title = (box.querySelector(".pa-sheet-head b")?.textContent || "").trim();
  const near = anchor.closest(".pa-aux-row, .pa-aux-ch, .pa-row, .pa-srow, .pa-site, .pa-sgroup > header") || anchor;
  if (!title || `${near.textContent} ${anchor.getAttribute("aria-label") || ""} ${anchor.title || ""}`.includes(title)) box.classList.add("pa-pop-plain");
  const host = (rootEl || document.body).getBoundingClientRect();
  const a = anchor.getBoundingClientRect();
  const gap = 6, edge = 8;
  const w = Math.min(box.offsetWidth, host.width - edge * 2);
  const leftSide = (a.left + a.right) / 2 - host.left < host.width / 2;
  const left = Math.min(Math.max(leftSide ? a.left - host.left : a.right - host.left - w, edge), host.width - w - edge);
  box.style.left = left + "px";
  const below = host.bottom - a.bottom - gap - edge;
  const above = a.top - host.top - gap - edge;
  const h = box.offsetHeight;
  const down = h <= below || below >= above;
  if (down) {
    box.style.top = a.bottom - host.top + gap + "px";
    box.style.maxHeight = below + "px";
  } else {
    box.style.bottom = host.bottom - a.top + gap + "px";
    box.style.maxHeight = above + "px";
  }
  box.style.transformOrigin = `${leftSide ? "left" : "right"} ${down ? "top" : "bottom"}`;
  box.style.setProperty("--pa-pop-dy", down ? "-6px" : "6px");
}
async function confirmBox(title, text, okLabel = "确定", danger = false, cancelLabel = "取消") {
  const r = await sheet({ title, place: "center", body: `<p class="pa-p">${esc(text)}</p>`, actions: [{ label: cancelLabel, value: false }, { label: okLabel, kind: danger ? "danger" : "primary", value: true }] });
  return !!r;
}
// 2.6.1 删除前提醒备份，不强制：「下载备份」交给浏览器下载，弹窗不关、写明下载了什么；「删除」不管下没下载都删。
// download() 负责下载并返回写在弹窗里的说明（HTML，已转义）。返回 true 才删
async function confirmDeleteOfferBackup(title, html, download) {
  let note = "";
  for (;;) {
    const v = await sheet({
      title,
      place: "center",
      body: `${html}${note ? `<p class="pa-hint pa-dl-note">${note}</p>` : ""}`,
      actions: [{ label: "取消", value: null }, { label: note ? "重新下载" : "下载备份", value: "dl" }, { label: "删除", kind: "danger", value: "del" }]
    });
    if (v === "del") return true;
    if (v !== "dl") return false;
    note = await download();
  }
}
// 2.12.15 宽屏左右两栏中间的拖动条：拖动或用方向键调右栏宽度（占 host 宽度的百分比），按 key 记在设置里。
// host 的样式用 --pa-pane 定右栏宽度
function paneSplit(host, splitter, key, def = 44) {
  const clamp = (v) => Math.min(72, Math.max(28, Number(v) || def));
  const apply = (v) => { const r = clamp(v); host.style.setProperty("--pa-pane", r + "%"); splitter.setAttribute("aria-valuenow", String(Math.round(100 - r))); return r; };
  const saved = () => settings().paneSplit?.[key] ?? def;
  const save = (v) => { (settings().paneSplit ||= {})[key] = Math.round(v); saveSettings(); };
  splitter.setAttribute("aria-orientation", "vertical");
  splitter.setAttribute("aria-valuemin", "28");
  splitter.setAttribute("aria-valuemax", "72");
  apply(saved());
  splitter.addEventListener("pointerdown", (e) => {
    if (e.button > 0) return;
    e.preventDefault();
    splitter.setPointerCapture(e.pointerId);
    splitter.classList.add("pa-dragging");
    const rect = host.getBoundingClientRect();
    let last = null;
    const move = (ev) => { last = apply((rect.right - ev.clientX) / rect.width * 100); };
    const up = () => {
      splitter.classList.remove("pa-dragging");
      splitter.removeEventListener("pointermove", move);
      splitter.removeEventListener("pointerup", up);
      splitter.removeEventListener("pointercancel", up);
      if (last != null) save(last);
    };
    splitter.addEventListener("pointermove", move);
    splitter.addEventListener("pointerup", up);
    splitter.addEventListener("pointercancel", up);
  });
  splitter.addEventListener("keydown", (e) => {
    const k = { ArrowLeft: 4, ArrowRight: -4 }[e.key];
    if (!k) return;
    e.preventDefault();
    save(apply(saved() + k));
  });
  splitter.addEventListener("dblclick", () => save(apply(def)));
}
const splitterHtml = (label) => `<div class="pa-splitter pa-vsplit" role="separator" tabindex="0" aria-label="${esc(label)}" title="拖动调整两栏宽度，双击恢复"><span></span></div>`;
async function promptBox(title, value = "", placeholder = "") {
  return sheet({
    title,
    place: "center",
    body: `<input class="pa-input" value="${esc(value)}" placeholder="${esc(placeholder)}" maxlength="120" aria-label="${esc(title)}" autocomplete="off">`,
    actions: [{ label: "取消", value: null }, { label: "确定", kind: "primary", value: (w) => w.querySelector("input").value.trim() || null }],
    onMount: (w) => {
      const i = w.querySelector("input");
      i.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !imeEnter(e)) w.querySelector(".pa-btn-primary").click();
      });
      setTimeout(() => {
        i.focus();
        i.select();
      }, 60);
    }
  });
}
// 2.5.0 选项不多的菜单贴着刚点的按钮弹出（点外面关掉）；选项多或带说明时放在屏幕中间
// 菜单选项开头的「＋」「↑」「↓」字符 → 画的图标（和其他线条图标一致）。返回 { text, icon }
function menuIcon(label) {
  const t = String(label ?? "");
  const m = /^\s*([＋+↑↓])\s+/.exec(t);
  if (!m) return { text: t, icon: "" };
  const key = { "＋": "plus", "+": "plus", "↑": "arrowUp", "↓": "arrowDown" }[m[1]];
  return { text: t.slice(m[0].length), icon: `<span class="pa-mi" aria-hidden="true">${ICON[key]}</span>` };
}
async function pickBox(title, items, { hint = "", anchor = recentAnchor() } = {}) {
  const body = el(`<div>${hint ? `<p class="pa-hint">${esc(hint)}</p>` : ""}<div class="pa-pick"></div></div>`);
  const list = body.querySelector(".pa-pick");
  let resolveFn;
  const pop = !!anchor && !hint && items.length <= 9;
  // 先填好选项再弹出，贴按钮时才量得准高度
  // item.pair：一行放两个短按钮（如 ↑ 上移、↓ 下移），值写成 "序号.0" / "序号.1"；item.danger：删除类，标危险色、前面隔一条线
  // 2.11.26 开头的「＋」「↑」「↓」换成画的图标：成对的放在文字前，单独一行的放在右边
  list.innerHTML = items.map((it, i) => {
    if (it.pair) return `<div class="pa-pick-pair">${it.pair.map((p, j) => { const L = menuIcon(p.label); return `<button class="pa-pick-item" data-v="${i}.${j}">${L.icon}<span class="pa-pick-label">${esc(L.text)}</span></button>`; }).join("")}</div>`;
    const L = menuIcon(it.label);
    return `<button class="pa-pick-item${it.danger ? " pa-pick-danger" : ""}${L.icon ? " pa-has-mi" : ""}" data-v="${i}"><span class="pa-pick-label">${esc(L.text)}</span>${it.sub ? `<small>${esc(it.sub)}</small>` : ""}${L.icon}</button>`;
  }).join("") || '<p class="pa-hint">无可选项</p>';
  const p = sheet({ title, body, place: pop ? "pop" : "center", anchor, actions: pop ? [] : [{ label: "取消", value: null }], onMount: (w) => {
    list.addEventListener("click", (e) => {
      const b = e.target.closest("[data-v]");
      if (!b) return;
      const [i, j] = b.dataset.v.split(".");
      resolveFn(j === undefined ? items[Number(i)].value : items[Number(i)].pair[Number(j)].value);
      w._close(null);
    });
  } });
  let picked = null;
  resolveFn = (v) => {
    picked = v;
  };
  await p;
  return picked;
}
// 2.12.1 滚动引导条：滚动时右边出现一条细滑块，停下后淡出；内容放得下时不出现。2.12.3 更细、用主题色，停下 0.6 秒淡出
// 酒馆主题常把滚动条藏起来，长窗口里看不出还能往下滑、滑到了哪里。host 是定位容器（position 非 static），滑块不挡点击
function scrollHint(box, host = box?.parentElement) {
  if (!box || !host) return () => {};
  const bar = document.createElement("i");
  bar.className = "pa-scrollhint";
  bar.setAttribute("aria-hidden", "true");
  host.append(bar);
  let timer = 0, raf = 0;
  const paint = (hold = 600) => {
    raf = 0;
    const H = box.clientHeight, S = box.scrollHeight;
    if (!box.isConnected || S <= H + 2) { bar.classList.remove("on"); return; }
    const h = Math.max(28, H * H / S);
    const y = box.offsetTop + (H - h) * (box.scrollTop / (S - H));
    bar.style.height = `${Math.round(h)}px`;
    bar.style.transform = `translateY(${Math.round(y)}px)`;
    bar.classList.add("on");
    clearTimeout(timer);
    timer = setTimeout(() => bar.classList.remove("on"), hold);
  };
  box.addEventListener("scroll", () => { if (!raf) raf = requestAnimationFrame(() => paint()); }, { passive: true });
  return (hold = 900) => requestAnimationFrame(() => paint(hold));
}
function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

// 说明文字默认收起：一行小字「ⓘ 说明」，点开再看。手机屏幕小，长段说明不要一上来就铺满
// 2.4.1 解释句默认收起：标题或选项旁一个 ⓘ，点开才显示；bindWhy 挂在外层容器上
// ⓘ 字符在不少字体里偏上偏小，和文字对不齐；画一个圆圈 i
// 2.5.7 输入法正在选字时按的回车（确认拼音候选）不算提交。Safari 在这个回车上报 keyCode 229
const imeEnter = (e) => e.isComposing || e.keyCode === 229;
// 2.5.7 搜索框：停一下再筛，连打几个字只筛一次（大预设在手机上筛一次要一两百毫秒）；
// 拼音还没选字时不筛（输入法每打一个字母都会触发 input）；清空时立刻恢复
function onSearchInput(input, run, delay = 120) {
  if (!input) return;
  let timer = 0;
  const go = () => { clearTimeout(timer); timer = 0; run(input.value); };
  input.addEventListener("input", (e) => {
    if (e.isComposing) return;
    clearTimeout(timer);
    if (!input.value.trim() || delay <= 0) return go();
    timer = setTimeout(go, delay);
  });
  input.addEventListener("compositionend", () => { clearTimeout(timer); timer = setTimeout(go, 0); });
}
const INFO_ICON = '<svg class="pa-info" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.6v.1"/></svg>';
const whyBtn = (key) => `<button class="pa-why" type="button" data-why="${key}" aria-label="说明" aria-expanded="false" title="说明">${INFO_ICON}</button>`;
const whyNote = (key, html) => `<div class="pa-whynote" data-whynote="${key}" hidden>${html}</div>`;
function bindWhy(box) {
  box.addEventListener("click", (e) => {
    const b = e.target.closest("[data-why]");
    if (!b || !box.contains(b)) return;
    // 在 label 里时不让它顺带勾选或聚焦
    e.preventDefault();
    const note = box.querySelector(`[data-whynote="${CSS.escape(b.dataset.why)}"]`);
    if (!note) return;
    // 2.12.19 说明呼吸展开、收起（收起动画中再点一下照样展开）
    const open = accClosed(note);
    accHidden(note, open);
    b.setAttribute("aria-expanded", String(open));
  });
}
function tip(inner, label = "说明", { caret = false } = {}) {
  if (!String(inner || "").trim()) return "";
  // 2.8.5 按钮留在原位，说明在所在行下方展开（行内为弹性布局时排到最后、占满整行）
  // 2.12.19 caret：「详情 ▾」样式（不带 ⓘ），展开时箭头翻转
  const face = caret ? `${esc(label)}<span class="pa-tip-caret" aria-hidden="true">▾</span>` : `${INFO_ICON}${esc(label)}`;
  return `<button type="button" class="pa-tip${caret ? " pa-tip-more" : ""}${label ? "" : " pa-tip-ico"}" data-tip aria-expanded="false"${label ? "" : ' aria-label="说明"'}>${face}</button><div class="pa-tip-body" hidden>${inner}</div>`;
}
// 2.12.19 <details class="pa-breathe">：点标题时内容呼吸展开、收起（内容包在 .pa-details-body 里）
if (typeof document !== "undefined") document.addEventListener("click", (e) => {
  const sum = e.target.closest?.("details.pa-breathe > summary");
  if (!sum || reducedMotion()) return;
  const d = sum.parentElement;
  const body = d.querySelector(":scope > .pa-details-body");
  if (!body) return;
  e.preventDefault();
  if (d.open && !d._closing) {
    d._closing = true;
    accOut(body).then((done) => { if (!done) return; d._closing = false; d.open = false; body._accAnim?.cancel(); body.style.overflow = ""; });
  } else {
    d._closing = false;
    d.open = true;
    accIn(body);
  }
});
if (typeof document !== "undefined") document.addEventListener("click", (e) => {
  const b = e.target.closest?.(".pa-tip[data-tip]");
  const body = b?.nextElementSibling;
  if (!body?.classList.contains("pa-tip-body")) return;
  const on = accClosed(body);
  accHidden(body, on);
  b.setAttribute("aria-expanded", String(on));
});

// ---------- 2.12.19 呼吸微交互：展开收起、原地补丁、三态图标、分段滑块 ----------
const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const EASE_ACC = "cubic-bezier(0.2, 0, 0, 1)";
// 展开：从 1px 长到内容高度（220ms），结束后清掉行内样式；收起：缩到 0 后 resolve，由调用方移除或藏起
function accIn(node, ms = 220) {
  node && (node._accTok = {});
  if (!node?.isConnected || reducedMotion() || typeof node.animate !== "function") return Promise.resolve();
  node._accAnim?.cancel();
  const h = node.scrollHeight;
  if (!h) return Promise.resolve();
  node.style.overflow = "hidden";
  const a = node.animate([{ height: "1px", opacity: 0.35 }, { height: h + "px", opacity: 1 }], { duration: ms, easing: EASE_ACC });
  node._accAnim = a;
  return a.finished.catch(() => {}).then(() => { if (node._accAnim === a) { node._accAnim = null; node.style.overflow = ""; } });
}
function accOut(node, ms = 220) {
  if (!node?.isConnected || reducedMotion() || typeof node.animate !== "function") return Promise.resolve(true);
  const tok = node._accTok = {};
  node._accAnim?.cancel();
  node.style.overflow = "hidden";
  const a = node.animate([{ height: node.offsetHeight + "px", opacity: 1 }, { height: "0px", opacity: 0 }], { duration: ms, easing: EASE_ACC, fill: "forwards" });
  node._accAnim = a;
  return a.finished.catch(() => {}).then(() => node._accTok === tok);
}
// 用 hidden 显隐的说明、详情：展开时先去掉 hidden 再长出来，收起时缩回去再加 hidden
// 收起动画进行中也算「收着」：再点一下就重新展开
const accClosed = (node) => node.hidden || !!node._closing;
async function accHidden(node, open) {
  if (!node) return;
  if (open) {
    node._closing = false;
    node.hidden = false;
    node.classList.add("open");
    return accIn(node);
  }
  node.classList.remove("open");
  node._closing = true;
  if (!await accOut(node)) return;
  node._closing = false;
  node.hidden = true;
  node._accAnim?.cancel();
  node._accAnim = null;
  node.style.overflow = "";
}
// 原地补丁：把 fresh 的属性、子节点同步到 live 上，结构相同的节点原地复用，不整块重建（选中底色、折叠状态、过渡都留得住）。
// 标签或 data-id / data-k / data-ch / data-use 不同时才换掉那个节点（带 data-morph-keep 的只看标签，如当前连接卡换站点时）；换进来的元素交给 onEnter（给状态胶囊加入场动效）
const morphKey = (n) => n.nodeType === 1 ? n.hasAttribute("data-morph-keep") ? n.tagName : `${n.tagName}|${n.getAttribute("data-id") ?? n.getAttribute("data-k") ?? n.getAttribute("data-ch") ?? n.getAttribute("data-use") ?? n.getAttribute("data-site") ?? ""}` : `#${n.nodeType}`;
// 说明（data-whynote）展开着就让它开着：只同步文字，不动 hidden、class、style
const MORPH_HOLD = new Set(["hidden", "class", "style"]);
function morphEl(x, y, onEnter) {
  const hold = x.hasAttribute("data-whynote");
  for (const { name } of [...x.attributes]) if (!y.hasAttribute(name) && !(hold && MORPH_HOLD.has(name))) x.removeAttribute(name);
  for (const { name, value } of [...y.attributes]) if (x.getAttribute(name) !== value && !(hold && MORPH_HOLD.has(name))) x.setAttribute(name, value);
  if (x.tagName === "INPUT") {
    if (x.checked !== y.checked) x.checked = y.checked;
    if (x.type !== "file" && x.type !== "checkbox" && x.value !== y.value) x.value = y.value;
  }
  morphChildren(x, y, onEnter);
}
function morphChildren(live, fresh, onEnter) {
  const a = [...live.childNodes], b = [...fresh.childNodes];
  for (let i = 0; i < b.length; i++) {
    const x = a[i], y = b[i];
    if (!x) { live.append(y); if (y.nodeType === 1) onEnter?.(y); continue; }
    if (morphKey(x) !== morphKey(y)) { x.replaceWith(y); if (y.nodeType === 1) onEnter?.(y); continue; }
    if (y.nodeType === 1) morphEl(x, y, onEnter);
    else if (x.nodeValue !== y.nodeValue) x.nodeValue = y.nodeValue;
  }
  for (let i = b.length; i < a.length; i++) a[i].remove();
}
function morphHtml(box, html, onEnter) {
  const t = document.createElement("template");
  t.innerHTML = html;
  morphChildren(box, t.content, onEnter);
}
// 重播一次性动效（呼吸、回响）：去掉类名、强制重排再加上，ms 后去掉
function replay(node, cls, ms = 700) {
  if (!node) return;
  node.classList.remove(cls);
  void node.offsetWidth;
  node.classList.add(cls);
  clearTimeout(node[`_rp_${cls}`]);
  node[`_rp_${cls}`] = setTimeout(() => node.classList.remove(cls), ms);
}
// 三态叠化图标：idle / busy（转圈）/ ok（勾），三层常驻，切状态只改 data-st，不重建按钮
var SPIN_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-8-8"/></svg>';
const icoMorph = (idle, st = "idle") => `<span class="ico-morph" data-st="${st}" aria-hidden="true"><i class="im-idle">${idle}</i><i class="im-busy">${SPIN_SVG}</i><i class="im-ok">${ICON.check}</i></span>`;
function setIco(btn, st) {
  const m = btn?.querySelector?.(".ico-morph");
  if (m && m.dataset.st !== st) m.dataset.st = st;
}
// 分段槽滑块：.pa-seg 里选中的按钮（.on / aria-pressed / aria-selected）下面垫一块白底，换选项时滑过去。
// 整块重画后按「同一组按钮」记下的上次位置起步，看起来也是滑过去的
var segLast = new Map();
const segOn = (b) => b.classList.contains("on") || b.getAttribute("aria-pressed") === "true" || b.getAttribute("aria-selected") === "true";
const segSig = (seg) => seg.getAttribute("aria-label") || [...seg.children].filter((c) => c.tagName === "BUTTON").map((c) => c.textContent.replace(/[\d\s]+/g, "")).join("|");
function placeSegInk(seg) {
  const btns = [...seg.children].filter((c) => c.tagName === "BUTTON");
  const on = btns.find(segOn);
  let ink = seg.querySelector(":scope > .pa-seg-ink");
  if (!on) { if (ink) ink.style.opacity = "0"; return; }
  if (!on.offsetWidth) return;
  const sig = segSig(seg);
  const to = { x: on.offsetLeft, y: on.offsetTop, w: on.offsetWidth, h: on.offsetHeight };
  const put = (p) => { ink.style.width = p.w + "px"; ink.style.height = p.h + "px"; ink.style.transform = `translate(${p.x}px, ${p.y}px)`; };
  if (!ink) {
    ink = document.createElement("i");
    ink.className = "pa-seg-ink";
    ink.setAttribute("aria-hidden", "true");
    seg.prepend(ink);
    seg.classList.add("pa-seg-inked");
    ink.style.transition = "none";
    put(segLast.get(sig) || to);
    void ink.offsetWidth;
    ink.style.transition = "";
  }
  ink.style.opacity = "";
  put(to);
  segLast.set(sig, to);
}
function watchSegs(root) {
  if (typeof MutationObserver !== "function" || typeof requestAnimationFrame !== "function") return;
  const dirty = new Set();
  const seen = new WeakSet();
  let raf = 0;
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver((es) => { for (const e of es) dirty.add(e.target); flush(); }) : null;
  const flush = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      for (const s of dirty) {
        if (!s.isConnected) continue;
        if (ro && !seen.has(s)) { seen.add(s); ro.observe(s); }
        placeSegInk(s);
      }
      dirty.clear();
    });
  };
  const BIG = ".pa-list, .pa-src-list, .pa-dst-list, .pa-mpick-list, .pa-npick-list";
  const mo = new MutationObserver((ms) => {
    for (const m of ms) {
      const t = m.target;
      if (m.type === "attributes") { if (t.parentElement?.classList.contains("pa-seg")) dirty.add(t.parentElement); continue; }
      if (t.classList?.contains("pa-seg")) { dirty.add(t); continue; }
      if (t.closest?.(BIG)) continue;
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1 || n.classList.contains("pa-seg-ink")) continue;
        if (n.classList.contains("pa-seg")) dirty.add(n);
        for (const s of n.getElementsByClassName("pa-seg")) dirty.add(s);
      }
    }
    if (dirty.size) flush();
  });
  mo.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "aria-pressed", "aria-selected"] });
}
