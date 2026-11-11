var esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c2) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c2]);
function toast(msg, type = "info") {
  const t = globalThis.toastr;
  if (!t?.[type]) return console.log("[焦香鸡翅]", msg);
  // 2.8.0 点按即关闭，与酒馆其他提示一致
  const $t = t[type](msg, "", { timeOut: type === "error" ? 6e3 : 2600, preventDuplicates: true, tapToDismiss: true, closeOnHover: false });
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
const noteTap = (e) => {
  const b = e.target?.closest?.("button, [role=button], [data-a], [data-act], [data-tool], [data-s]");
  if (b) lastTap = { el: b, t: Date.now() };
};
function recentAnchor() {
  return lastTap && Date.now() - lastTap.t < 1500 && lastTap.el.isConnected && lastTap.el.offsetParent ? lastTap.el : null;
}
// 2.5.0 ⓘ 按钮（data-tipbtn）展开同一块里的说明（data-tipnote），整个面板共用，不用每处单独绑定
const onTipBtn = (e) => {
  const b = e.target?.closest?.("[data-tipbtn]");
  if (!b) return;
  e.preventDefault();
  let note = null;
  for (let p = b.parentElement; p && !note; p = p.parentElement) note = [...p.children].find((c) => c.hasAttribute("data-tipnote")) || null;
  if (!note) return;
  note.hidden = !note.hidden;
  b.setAttribute("aria-expanded", String(!note.hidden));
  b.classList.toggle("on", !note.hidden);
};
function setRoot(el2) {
  rootEl = el2;
  el2?.addEventListener("click", noteTap, true);
  el2?.addEventListener("click", onTipBtn);
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
            <div class="pa-sheet-head"><b>${esc(opt.title)}</b><button class="pa-icon-btn pa-sheet-x" aria-label="关闭">✕</button></div>
            <div class="pa-sheet-body"></div>
            <div class="pa-sheet-actions"></div></div></div>`);
    const body = wrap.querySelector(".pa-sheet-body");
    if (typeof opt.body === "string") body.innerHTML = opt.body;
    else if (opt.body) body.append(opt.body);
    const acts = wrap.querySelector(".pa-sheet-actions");
    const done = (v) => {
      if (wrap.classList.contains("pa-out")) return;
      wrap.classList.add("pa-out");
      setTimeout(() => wrap.remove(), 160);
      document.removeEventListener("keydown", onKey, true);
      wrap.dispatchEvent(new Event("pa-closed"));
      resolve(v);
    };
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
    if (place === "pop") placePop(wrap, opt.anchor);
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
function inlineEdit(target, value, { placeholder = "" } = {}) {
  return new Promise((resolve) => {
    const old = target.innerHTML;
    const input = el(`<input class="pa-input pa-inline-input" value="${esc(value)}" placeholder="${esc(placeholder)}" maxlength="120" aria-label="新名称">`);
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
      input.select();
    }, 40);
  });
}
// 贴着按钮放菜单：下面放得下就放下面，否则放上面；右边对齐按钮，不出边
function placePop(wrap, anchor) {
  const box = wrap.querySelector(".pa-sheet");
  const host = (rootEl || document.body).getBoundingClientRect();
  const a = anchor.getBoundingClientRect();
  const gap = 6, edge = 8;
  const w = Math.min(320, host.width - edge * 2);
  box.style.width = w + "px";
  const left = Math.min(Math.max(a.right - host.left - w, edge), host.width - w - edge);
  box.style.left = left + "px";
  const below = host.bottom - a.bottom - gap - edge;
  const above = a.top - host.top - gap - edge;
  const h = box.offsetHeight;
  if (h <= below || below >= above) {
    box.style.top = a.bottom - host.top + gap + "px";
    box.style.maxHeight = below + "px";
  } else {
    box.style.bottom = host.bottom - a.top + gap + "px";
    box.style.maxHeight = above + "px";
  }
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
async function pickBox(title, items, { hint = "", anchor = recentAnchor() } = {}) {
  const body = el(`<div>${hint ? `<p class="pa-hint">${esc(hint)}</p>` : ""}<div class="pa-pick"></div></div>`);
  const list = body.querySelector(".pa-pick");
  let resolveFn;
  const pop = !!anchor && !hint && items.length <= 9;
  // 先填好选项再弹出，贴按钮时才量得准高度
  // item.pair：一行放两个短按钮（如 ↑ 上移、↓ 下移），值写成 "序号.0" / "序号.1"
  list.innerHTML = items.map((it, i) => it.pair
    ? `<div class="pa-pick-pair">${it.pair.map((p, j) => `<button class="pa-pick-item" data-v="${i}.${j}">${esc(p.label)}</button>`).join("")}</div>`
    : `<button class="pa-pick-item" data-v="${i}"><span class="pa-pick-label">${esc(it.label)}</span>${it.sub ? `<small>${esc(it.sub)}</small>` : ""}</button>`).join("") || '<p class="pa-hint">无可选项</p>';
  const p = sheet({ title, body, place: pop ? "pop" : "center", anchor, actions: pop ? [] : [{ label: "取消", value: null }], onMount: (w) => {
    list.addEventListener("click", (e) => {
      const b = e.target.closest("[data-v]");
      if (!b) return;
      const [i, j] = b.dataset.v.split(".");
      resolveFn(j === undefined ? items[Number(i)].value : items[Number(i)].pair[Number(j)].value);
      w.querySelector(".pa-sheet-x").click();
    });
  } });
  let picked = null;
  resolveFn = (v) => {
    picked = v;
  };
  await p;
  return picked;
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
    note.hidden = !note.hidden;
    b.setAttribute("aria-expanded", String(!note.hidden));
  });
}
function tip(inner, label = "说明") {
  if (!String(inner || "").trim()) return "";
  // 2.8.5 按钮留在原位，说明在所在行下方展开（行内为弹性布局时排到最后、占满整行）
  return `<button type="button" class="pa-tip" data-tip aria-expanded="false">${INFO_ICON}${esc(label)}</button><div class="pa-tip-body" hidden>${inner}</div>`;
}
if (typeof document !== "undefined") document.addEventListener("click", (e) => {
  const b = e.target.closest?.(".pa-tip[data-tip]");
  const body = b?.nextElementSibling;
  if (!body?.classList.contains("pa-tip-body")) return;
  const on = body.hidden;
  body.hidden = !on;
  b.setAttribute("aria-expanded", String(on));
});
