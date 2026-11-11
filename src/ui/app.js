// 2.7.0 导航：手机底部五栏「预设 · 方案 · 连接 · 回复 · 更多」；宽屏（≥1000px）改为左侧栏，「更多」里的工具直接列在侧栏
var NAV_ICON = {
  preset: '<path d="M12 3 3 8l9 5 9-5-9-5Z"/><path d="m3 13 9 5 9-5"/>',
  schemes: '<path d="M7 3.5h10a1 1 0 0 1 1 1V21l-6-4-6 4V4.5a1 1 0 0 1 1-1Z"/>',
  conn: '<path d="M9 3v5M15 3v5"/><path d="M6 8h12v3a6 6 0 0 1-12 0V8Z"/><path d="M12 17v4"/>',
  reply: '<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H9l-5 4V5.5Z"/><path d="M8 9h8M8 12h5"/>',
  more: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>',
  suture: '<circle cx="6" cy="5.5" r="2.5"/><circle cx="6" cy="18.5" r="2.5"/><circle cx="18" cy="12" r="2.5"/><path d="M6 8v8"/><path d="M6 8c0 2.8 3.2 4 9.5 4"/>',
  clean: '<rect x="3.5" y="4" width="17" height="4.5" rx="1"/><path d="M5.5 8.5V19a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V8.5"/><path d="M10 12.5h4"/>',
  health: '<path d="M3 12h4l2.5-6 5 12 2.5-6h4"/>',
  check: '<path d="M9 3.5h6v3H9z"/><path d="M8 5H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2"/><path d="m9 14 2 2 4-4"/>',
  look: '<path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17" r="2"/>'
};
// 2.8.0 手机底部五栏「预设 · 缝合 · 检查 · 连接 · 更多」：缝合单列；检查含回复格式、思维链、变量；方案移入更多
var NAV = [
  ["preset", "预设", "work"], ["suture", "缝合", "work"], ["check", "检查", "work"], ["conn", "连接", "work"],
  ["more", "更多", "phone"],
  ["schemes", "方案", "tool"], ["clean", "清理", "tool"], ["health", "体检", "tool"], ["look", "设置", "tool"]
];
// 各页面所属栏目；「检查」「更多」在页头下方分页
var SECTION_OF = { organize: "preset", suture: "suture", reply: "check", cot: "check", vars: "check", conn: "conn", schemes: "more", clean: "more", health: "more", look: "more" };
var SUBNAV = { check: [["cot", "思维链"], ["vars", "变量"], ["reply", "回复"]], more: [["schemes", "方案"], ["clean", "清理"], ["health", "体检"], ["look", "设置"]] };
var PAGE_TITLE = { organize: "预设", suture: "缝合", reply: "检查", cot: "检查", vars: "检查", conn: "连接", schemes: "方案", clean: "清理", health: "体检", look: "设置" };
var PAGE_EL = {};
var navSvg = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true">${NAV_ICON[k]}</svg>`;
var rootEl2;
var pages = {};
var current = "organize";
var lastCheckPage = "cot";
var cleanups = [];
function injectStyle() {
  document.getElementById("pa-style")?.remove();
  const s = document.createElement("style");
  s.id = "pa-style";
  s.textContent = style_default;
  document.head.append(s);
}
// 1.9.10 适配各种外壳（TT、App 内嵌网页、PWA、平板、电脑）：
// 有的外壳里 100dvh 比实际看得见的区域高（底部页签被挤出屏幕），安全区也会被重复留白（顶部一大块空白）。
// 按实际可见高度定面板高度；网页本身没盖住状态栏、底部横条时，不再额外留安全区
function syncViewport() {
  const r = rootEl2;
  if (!r) return;
  const h = Math.round(window.innerHeight || document.documentElement.clientHeight || 0);
  if (h > 0) r.style.setProperty("--pa-vh", h + "px");
  let probe = document.getElementById("pa-safe-probe");
  if (!probe) {
    probe = document.createElement("div");
    probe.id = "pa-safe-probe";
    probe.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)";
    document.documentElement.append(probe);
  }
  const cs = getComputedStyle(probe);
  const t = parseFloat(cs.paddingTop) || 0, b = parseFloat(cs.paddingBottom) || 0;
  const land = window.innerWidth > window.innerHeight;
  const sw = window.screen?.width || 0, sh0 = window.screen?.height || 0;
  const sh = land ? Math.min(sw, sh0) : Math.max(sw, sh0);
  const gap = sh && h ? Math.max(0, sh - h) : 0;
  r.style.setProperty("--pa-sat", (t && gap >= t - 2 ? 0 : t) + "px");
  // 底部只在「顶部也报了安全区、且网页高度连同底部一起少了」时才去掉；
  // 普通 Safari（顶部是浏览器栏，不报顶部安全区）收起工具栏后要保留底部横条的位置
  r.style.setProperty("--pa-sab", (b && t > 0 && gap >= t + b - 2 ? 0 : b) + "px");
  // 外层被别的样式改了定位基准（transform 等）时，面板顶部会偏移：补回来
  if (!r.hidden) {
    r.style.top = "0px";
    const off = r.getBoundingClientRect().top;
    if (Math.abs(off) > 1) r.style.top = -off + "px";
  }
}
function buildRoot() {
  document.getElementById("pa-root")?.remove();
  const navBtn = ([k, l, grp]) => `<button type="button" class="pa-nav-${grp}" data-nav="${k}" aria-label="${l}">${navSvg(k)}<span>${l}</span></button>`;
  rootEl2 = el(`<div id="pa-root" class="pa-root" hidden>
        <div class="pa-shell">
            <nav class="pa-tabs" aria-label="主导航">
                <div class="pa-brand"><span class="pa-logo" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12"/></svg></span><span class="pa-brand-t"><b class="pa-appname">${esc(appName())}</b><small>v${esc(VERSION)} · by EC</small></span></div>
                <span class="pa-navgl">工作</span>
                ${NAV.filter((x) => x[2] !== "tool").map(navBtn).join("")}
                <span class="pa-navgl">工具</span>
                ${NAV.filter((x) => x[2] === "tool").map(navBtn).join("")}
            </nav>
            <header class="pa-top">
                <div class="pa-head-t"><small class="pa-kicker"><span class="pa-appname">${esc(appName())}</span><span class="pa-by">by EC</span></small><h2 class="pa-title"></h2></div>
                <div class="pa-savebar" role="status" hidden>
                    <span class="pa-dirty-text"></span>
                    <button class="pa-btn" data-g="undo">撤销</button>
                    <button class="pa-btn pa-btn-primary" data-g="confirm" title="修改已自动保存。点「完成」结束这一批修改，之后不能再撤销">完成</button>
                    <button class="pa-btn pa-btn-primary" data-g="save" hidden>重试保存</button>
                </div>
                <button class="pa-icon-btn pa-sulayout" data-g="sulayout" hidden></button>
                <button class="pa-icon-btn pa-backup-btn" data-g="backups" aria-label="备份" title="备份（只存在这个浏览器里）"><svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v4h4"/><path d="M12 7v5l3 2"/></svg></button>
                <button class="pa-icon-btn pa-close" data-g="close" aria-label="关闭"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
            </header>
            <div class="pa-subnav" role="tablist" hidden></div>
            <main class="pa-main">${Object.keys(SECTION_OF).filter((k) => !PAGE_EL[k]).map((k) => `<section class="pa-page" data-page="${k}" hidden></section>`).join("")}</main>
        </div>
    </div>`);
  document.body.append(rootEl2);
  setRoot(rootEl2);
  syncViewport();
  const onVp = () => syncViewport();
  window.addEventListener("resize", onVp);
  window.addEventListener("orientationchange", onVp);
  window.visualViewport?.addEventListener("resize", onVp);
  cleanups.push(() => { window.removeEventListener("resize", onVp); window.removeEventListener("orientationchange", onVp); window.visualViewport?.removeEventListener("resize", onVp); });
  const app = {
    showOrganize(ids) {
      show("organize");
      pages.organize.focusIds?.(ids);
    }
  };
  const pageEl = (k) => rootEl2.querySelector(`[data-page="${k}"]`);
  const plan = mountPlan(pageEl("schemes"), pageEl("conn"));
  pages = {
    organize: mountOrganize(pageEl("organize"), app),
    cot: mountCot(pageEl("cot"), app),
    vars: mountVariables(pageEl("vars")),
    schemes: plan.schemes,
    conn: plan.conn,
    reply: mountReply(pageEl("reply"), { go: (k) => show(k) }),
    suture: mountSuture(pageEl("suture"), app),
    clean: mountCleanup(pageEl("clean")),
    health: mountHealth(pageEl("health"), { goClean: () => show("clean") }),
    look: mountLook(pageEl("look"))
  };
  applyTheme(rootEl2);
  // 键盘：在条目行、分组头、当作按钮用的行（站点名、导入文件等）上按回车或空格，等于点一下
  rootEl2.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " " || e.defaultPrevented) return;
    const t = e.target;
    if (!(t instanceof HTMLElement) || !t.matches('.pa-row, .pa-ghead, [role="button"]:not(button)')) return;
    e.preventDefault();
    t.click();
  });
  rootEl2.querySelector(".pa-tabs").addEventListener("click", (e) => {
    const t = e.target.closest("[data-nav]");
    if (t) show(t.dataset.nav);
  });
  rootEl2.querySelector(".pa-subnav").addEventListener("click", (e) => {
    const t = e.target.closest("[data-tab], [data-m]");
    if (t) show(t.dataset.tab || t.dataset.m);
  });
  rootEl2.querySelector(".pa-shell").addEventListener("click", async (e) => {
    const g = e.target.closest(".pa-top [data-g], .pa-savebar [data-g]")?.dataset.g;
    if (!g) return;
    if (g === "close") return close();
    if (g === "undo") {
      const d = getDraft(focusPreset());
      const label = d.undo();
      if (label) {
        toast(`已撤销：${label}`);
        emitChange(d.name);
      }
    }
    if (g === "confirm") {
      try {
        await confirmDraft(focusPreset());
        toast("已完成，这批修改已保存", "success");
      } catch (err) {
        handleSaveError(focusPreset(), err);
      }
    }
    if (g === "backups") return backupsSheet(focusPreset());
    if (g === "sulayout") {
      pages.suture?.toggleLayout?.();
      return paintSutureLayoutBtn(true);
    }
    if (g === "save") {
      const name = focusPreset();
      if (saveBlocked.has(name)) return resolveSaveProblem(name);
      const btn = e.target.closest("button");
      btn.disabled = true;
      btn.textContent = "保存中…";
      try {
        await saveDraft(name, "保存");
        toast("已保存", "success");
      } catch (err) {
        handleSaveError(name, err);
      }
      btn.disabled = false;
      updateSavebar();
    }
  });
  cleanups.push(onDraftChange(updateSavebar));
}
function updateSavebar() {
  if (!rootEl2) return;
  const bar = rootEl2.querySelector(".pa-savebar");
  let d = null;
  try {
    d = getDraft(focusPreset());
  } catch {
  }
  // 修改即时自动保存；有未确认的修改时显示「撤销」「确认」
  const err = saveErrors.has(d?.name);
  const blocked = d ? saveBlocked.get(d.name) : null;
  const pending = !!d?.history.length;
  bar.hidden = !d || !pending && !err && !saveJobs.has(d.name);
  bar.classList.toggle("pa-save-err", !!(err || blocked));
  const dirtyText = rootEl2.querySelector(".pa-dirty-text");
  dirtyText.textContent = blocked
    ? (blocked.kind === "conflict" ? "已暂停保存：预设在别处被改过" : "已暂停保存：备份失败")
    : err ? `保存失败：${String(saveErrors.get(d.name)).slice(0, 40)}` : saveJobs.has(d?.name) || d?.dirty ? "保存中…" : "已自动保存";
  dirtyText.title = dirtyText.textContent;
  const saveBtn = rootEl2.querySelector("[data-g=save]");
  saveBtn.hidden = !err;
  saveBtn.textContent = blocked ? "处理" : "重试保存";
  rootEl2.querySelector("[data-g=undo]").hidden = !pending;
  rootEl2.querySelector("[data-g=confirm]").hidden = !pending || err;
}
// 页面键：organize cot schemes conn reply suture clean health look；栏目键 preset、more 打开上次所在的分页。
// 兼容旧写法：open("more", "health") 等
function resolvePage(key, sub) {
  if (key === "more" && sub && SECTION_OF[sub]) return sub;
  if (key === "api") return "conn";
  if (key === "preset") return "organize";
  if (key === "check") return lastCheckPage;
  if (/^reply-/.test(key)) return "reply";
  if (key === "more") {
    const m = settings().moreTab;
    return SUBNAV.more.some(([k]) => k === m) ? m : "clean";
  }
  return SECTION_OF[key] ? key : "organize";
}
function show(key, sub) {
  const k = resolvePage(key, sub);
  const sec = SECTION_OF[k];
  const wasVisible = !rootEl2.hidden && (PAGE_EL[current] || current) === (PAGE_EL[k] || k) && rootEl2.dataset.paShown === "1";
  current = k;
  if (k !== "organize") rootEl2.classList.remove("pa-selecting");
  if (sec === "check") lastCheckPage = k;
  if (sec === "more" && settings().moreTab !== k) {
    settings().moreTab = k;
    saveSettings();
  }
  rootEl2.dataset.paSec = sec;
  rootEl2.querySelectorAll(".pa-tabs [data-nav]").forEach((b) => {
    const on = b.dataset.nav === sec || b.dataset.nav === k;
    if (on) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
  const subnav = rootEl2.querySelector(".pa-subnav");
  const subs = SUBNAV[sec];
  subnav.hidden = !subs;
  subnav.classList.toggle("pa-subnav-more", sec === "more");
  if (subs) {
    const attr = sec === "more" ? "data-m" : "data-tab";
    subnav.innerHTML = subs.map(([sk, l]) => `<button type="button" role="tab" ${attr}="${sk}" aria-selected="${sk === k}" class="${sk === k ? "on" : ""}">${l}</button>`).join("");
  }
  rootEl2.querySelector(".pa-title").textContent = PAGE_TITLE[k];
  paintSutureLayoutBtn(sec === "suture");
  const pk = PAGE_EL[k] || k;
  rootEl2.querySelectorAll(".pa-page").forEach((p) => {
    p.hidden = p.dataset.page !== pk;
  });
  try {
    const subLabel = SUBNAV[sec]?.find(([x]) => x === k)?.[1];
    jankTime(`显示页面：${sec === "more" ? subLabel : PAGE_TITLE[k] + (subLabel ? " · " + subLabel : "")}`, () => pages[pk].render(k, !wasVisible));
  } catch (e) {
    console.error(e);
    toast("出错：" + e.message, "error");
  }
  updateSavebar();
}
// 2.8.0 缝合页顶栏的布局按钮：分栏 ⇄ 切换。图标画的是点下去之后的样子
const LAYOUT_ICON = {
  split: '<svg viewBox="0 0 24 24"><rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M12 4.5v15"/></svg>',
  switch: '<svg viewBox="0 0 24 24"><rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9h17"/></svg>'
};
function paintSutureLayoutBtn(on) {
  const b = rootEl2?.querySelector(".pa-sulayout");
  if (!b) return;
  b.hidden = !on;
  if (!on) return;
  const next = settings().sutureLayout === "switch" ? "split" : "switch";
  b.innerHTML = LAYOUT_ICON[next];
  const label = next === "split" ? "改为分栏：从、到同屏" : "改为切换：一次显示一栏";
  b.setAttribute("aria-label", label);
  b.title = label;
}
function open(tab, sub) {
  if (!rootEl2) buildRoot();
  rootEl2.querySelectorAll(".pa-page").forEach((page) => { page.hidden = true; });
  dropClean();
  setFocusPreset(currentPresetName());
  applyTheme(rootEl2);
  rootEl2.hidden = false;
  syncViewport();
  document.documentElement.classList.add("pa-open");
  document.getElementById("pa-ball")?.setAttribute("hidden", "");
  rootEl2.dataset.paShown = "";
  show(tab || current, sub);
  rootEl2.dataset.paShown = "1";
  pushBackState();
  setTimeout(flushAsks, 0);
}
// 安卓返回手势 / 浏览器返回键：先关面板，而不是离开酒馆
var backArmed = false;
function pushBackState() {
  if (backArmed) return;
  try {
    history.pushState({ ...(history.state || {}), paOpen: true }, "");
    backArmed = true;
  } catch {}
}
function onPopState() {
  if (!backArmed) return;
  backArmed = false;
  if (!rootEl2 || rootEl2.hidden) return;
  // 有弹窗时，返回只关弹窗
  const masks = rootEl2.querySelectorAll(".pa-sheet-mask:not(.pa-out)");
  if (masks.length) {
    masks[masks.length - 1].querySelector(".pa-sheet-x")?.click();
    pushBackState();
    return;
  }
  close({ fromBack: true });
}
function onRootKey(e) {
  if (e.key !== "Escape" || !rootEl2 || rootEl2.hidden) return;
  if (rootEl2.querySelector(".pa-sheet-mask")) return; // 弹窗自己处理
  const t = e.target;
  if (t?.classList?.contains("pa-inline-input")) return; // 原地改名自己处理
  // 2.8.7 Esc 一次只退一层：搜索框里清除并收起搜索，编辑栏里关编辑栏，其他输入框里先移走光标；都不是时才关面板
  if (t instanceof HTMLElement && rootEl2.contains(t)) {
    const row = t.closest(".pa-findrow");
    if (row) {
      e.preventDefault();
      const pg = row.closest(".pa-page");
      const x = row.querySelector(".pa-qx") || pg?.querySelector('[data-tool="search"]');
      if (x) x.click();
      else { t.value = ""; t.dispatchEvent(new Event("input", { bubbles: true })); t.blur(); }
      (pg?.querySelector(row.dataset.qside ? `[data-st="${row.dataset.qside}search"]` : '[data-tool="search"]'))?.focus({ preventScroll: true });
      return;
    }
    const pane = t.closest(".pa-editpane");
    if (pane) {
      e.preventDefault();
      pane.querySelector('[data-ep="x"]')?.click();
      return;
    }
    if (t.matches("input:not([type=checkbox]):not([type=radio]), textarea, select")) {
      e.preventDefault();
      t.blur();
      return;
    }
  }
  // 宽屏编辑栏开着时，先关编辑栏
  const openPane = rootEl2.querySelector('.pa-page:not([hidden]) .pa-editpane:not([hidden]) [data-ep="x"]');
  if (openPane) {
    e.preventDefault();
    openPane.click();
    return;
  }
  e.preventDefault();
  close();
}
async function close({ fromBack = false } = {}) {
  // 已经发出的保存撤不回来：先等它们结束，再看还剩哪些没存上
  if (saveJobs.size) {
    toast("正在等保存完成…");
    for (const job of [...saveJobs.values()]) { try { await job; } catch {} }
  }
  const dirty = dirtyDrafts().filter((d) => !saveBlocked.has(d.name));
  const blocked = dirtyDrafts().filter((d) => saveBlocked.has(d.name));
  if (blocked.length) {
    if (fromBack) pushBackState();
    for (const d of blocked) await resolveSaveProblem(d.name);
    if (dirtyDrafts().some((d) => saveBlocked.has(d.name))) return;
  }
  if (dirty.length) {
    if (fromBack) pushBackState();
    const r = await sheet({
      place: "center",
      title: "有未保存的修改",
      body: `<p class="pa-p">${dirty.map((d) => `「${esc(d.name)}」`).join("")}有还没存上的修改。</p><p class="pa-hint">「放弃」只丢掉还没存上的部分；之前已经自动保存的修改不会撤回${backupOn() ? "，需要时可在顶栏的备份里恢复到修改前" : ""}。</p>`,
      actions: [{ label: "暂不处理（下次打开仍在）", value: "keep" }, { label: "放弃没存上的部分", kind: "danger", value: "drop" }, { label: "全部保存", kind: "primary", value: "save" }]
    });
    if (!r) return;
    if (r === "keep") dirty.forEach((d) => checkpoint(d));
    if (r === "drop") dirty.forEach((d) => dropDraft(d.name));
    if (r === "save") {
      for (const d of dirty) {
        try {
          await saveDraft(d.name, "保存");
        } catch (e) {
          handleSaveError(d.name, e);
          return;
        }
      }
      toast("已全部保存", "success");
    }
  }
  rootEl2.hidden = true;
  document.documentElement.classList.remove("pa-open");
  document.getElementById("pa-ball")?.removeAttribute("hidden");
  flushPresetNotice();
  if (backArmed) {
    backArmed = false;
    try { history.back(); } catch {}
  }
}
function addMenuEntry() {
  if (document.getElementById("pa-menu-entry")) return;
  const menu = document.getElementById("extensionsMenu");
  if (!menu) return;
  const item = el(`<div id="pa-menu-entry" class="list-group-item flex-container flexGap5 interactable" tabindex="0" role="listitem">
        <div class="fa-solid fa-scissors extensionsMenuExtensionButton"></div><span class="pa-appname">${esc(appName())}</span></div>`);
  item.addEventListener("click", () => open());
  item.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      open();
    }
  });
  menu.append(item);
  applyMenuEntry();
  // 别的扩展加载有先有后，有的晚于本扩展才往魔棒菜单里加，本项的位置就会跟着变。始终把它挪回最下面
  const keepLast = new MutationObserver(() => {
    if (item.isConnected && item.parentElement === menu && menu.lastElementChild !== item) menu.append(item);
  });
  keepLast.observe(menu, { childList: true });
  cleanups.push(() => keepLast.disconnect());
}
// 1.3.4：扩展页里的设置框，照酒馆扩展的标准样子做：标题带版本号，按钮横排，能检查更新、看更新说明
var EXT_DIR = (() => {
  if (BUILD_KIND !== "extension") return null;
  try {
    return (/\/third-party\/([^/?#]+)\//.exec(decodeURIComponent(import.meta.url)) || [])[1] || null;
  } catch {
    return null;
  }
})();
function changelogSections() {
  const parts = String(CHANGELOG || "").split(/\n(?=\d+\.\d+(?:\.\d+)?[^\n]*\n)/);
  return parts.slice(1).map((t) => {
    const nl = t.indexOf("\n");
    return { head: t.slice(0, nl).trim(), body: t.slice(nl + 1).trim() };
  });
}
async function extensionType() {
  try {
    const r = await fetch(stUrl("api/extensions/discover"), { headers: ctx().getRequestHeaders?.() || {} });
    const list = r.ok ? await r.json() : [];
    return list.find((x) => x.name === `third-party/${EXT_DIR}`)?.type || "local";
  } catch {
    return "local";
  }
}
async function extApi(path) {
  const r = await fetch(stUrl(`api/extensions/${path}`), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...ctx().getRequestHeaders?.() || {} },
    body: JSON.stringify({ extensionName: EXT_DIR, global: await extensionType() === "global" })
  });
  if (!r.ok) throw new Error((await r.text().catch(() => "")) || r.statusText || `HTTP ${r.status}`);
  return r.json();
}
async function manifestVersion(url) {
  try {
    const r = await fetch(url, { cache: "no-store" });
    return r.ok ? String((await r.json())?.version || "") : "";
  } catch {
    return "";
  }
}
function addSettingsEntry() {
  if (document.getElementById("pa-settings")) return;
  const host2 = document.getElementById("extensions_settings2") || document.getElementById("extensions_settings");
  if (!host2) return;
  const log = changelogSections();
  const kind = BUILD_KIND === "extension" ? "" : " · 脚本版";
  const box = el(`<div id="pa-settings" class="pa-set">
    <div class="inline-drawer">
      <div class="inline-drawer-toggle inline-drawer-header">
        <b><span class="pa-appname">${esc(appName())}</span> <span class="pa-set-badge">v${esc(VERSION)}</span></b>
        <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
      </div>
      <div class="inline-drawer-content">
        <div class="pa-set-intro">整理分组、跨预设缝合、思维链检查、方案、加载体检、预设清理。</div>
        <div class="pa-set-btns">
          <div class="menu_button menu_button_icon" data-a="open" tabindex="0" role="button"><i class="fa-solid fa-scissors"></i><span>打开<span class="pa-appname">${esc(appName())}</span></span></div>
          <div class="menu_button menu_button_icon" data-a="health" tabindex="0" role="button"><i class="fa-solid fa-gauge-high"></i><span>加载体检</span></div>
        </div>
        <div class="pa-set-card">
          <div class="pa-set-row pa-set-namerow">${nameRowHtml()}</div>
          <div class="pa-set-row">
            <span class="pa-set-k">版本</span>
            <span class="pa-set-v">${esc(VERSION)}${kind}<small class="pa-set-by">by EC</small></span>
            ${EXT_DIR ? '<div class="menu_button menu_button_icon pa-set-mini" data-a="check" tabindex="0" role="button"><i class="fa-solid fa-rotate"></i><span>检查更新</span></div>' : ""}
          </div>
          <div class="pa-set-status" hidden></div>
          <div class="pa-set-row pa-set-optrow">
            <label class="checkbox_label pa-set-check"><input type="checkbox" data-opt="noPullRefresh" ${settings().noPullRefresh !== false ? "checked" : ""}><span>防止下拉误刷新</span></label>
            <div class="pa-set-why" data-a="why" tabindex="0" role="button" aria-label="说明" title="说明">?</div>
          </div>
          <div class="pa-set-note pa-set-whynote" hidden>在页面顶部往下拖时，浏览器会刷新整个酒馆（iPhone、iPad 的 Safari 最常见，安卓 Chrome 也会）。开启后阻止这种刷新；浏览器的刷新按钮照常可用。</div>
          <div class="pa-set-row pa-set-optrow">
            <label class="pa-set-check pa-set-entry"><span>入口</span><select class="text_pole" data-opt="entry">${ENTRY_MODES.map(([k, l]) => `<option value="${k}" ${k === entryMode() ? "selected" : ""}>${l}</option>`).join("")}</select></label>
          </div>
          <div class="pa-set-note pa-noentry" ${entryMode() === "none" ? "" : "hidden"}>${NO_ENTRY_NOTE}</div>
        </div>
        <div class="pa-set-maint"></div>
        ${log.length ? `<details class="pa-set-log pa-set-fold"><summary><span class="pa-set-fold-t">更新说明</span><small class="pa-set-sum">${esc(log[0].head)}</small></summary><div class="pa-set-logs">${log.slice(0, 2).map((x) => `<div class="pa-set-logv"><b>${esc(x.head)}</b><div>${esc(x.body).replace(/\n/g, "<br>")}</div></div>`).join("")}</div></details>` : ""}
        <div class="pa-set-foot">打开方式：点上方按钮，或用选好的入口（魔棒菜单、悬浮球），或在聊天输入框发送 /atelier。<a href="https://github.com/Xiaxiii/Burnt-chicken-wings" target="_blank" rel="noopener">GitHub</a></div>
      </div>
    </div>
  </div>`);
  // 维护模块的卡片自己处理点击（data-c），和这里的 data-a 分开
  const card = mountCompatCard(box.querySelector(".pa-set-maint"), { openHealth: () => open("health") });
  box.querySelector(".inline-drawer-toggle")?.addEventListener("click", () => setTimeout(() => card.refresh(), 0));
  const status = box.querySelector(".pa-set-status");
  const say = (html, cls = "") => {
    status.hidden = false;
    status.className = "pa-set-status " + cls;
    status.innerHTML = html;
  };
  let busy = false;
  async function act(a, btn) {
    if (a === "open") return open();
    if (a === "health") return open("health");
    if (a === "reload") return location.reload();
    if (a === "why") {
      const n = box.querySelector(".pa-set-whynote");
      n.hidden = !n.hidden;
      return;
    }
    // 改名就在这一行里改，不弹浏览器自带的输入框
    if (a === "rename") {
      const row = box.querySelector(".pa-set-namerow");
      row.innerHTML = `<span class="pa-set-k">名称</span><input class="text_pole pa-set-input" maxlength="30" value="${esc(appName())}" placeholder="${esc(DEFAULT_APP_NAME)}" aria-label="扩展名称">
        <div class="menu_button menu_button_icon pa-set-mini" data-a="rename-ok" tabindex="0" role="button"><i class="fa-solid fa-check"></i><span>保存</span></div>
        <div class="menu_button menu_button_icon pa-set-mini" data-a="rename-cancel" tabindex="0" role="button"><i class="fa-solid fa-xmark"></i><span>取消</span></div>`;
      const input = row.querySelector("input");
      input.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" && !imeEnter(ev)) { ev.preventDefault(); act("rename-ok", null); }
        if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); act("rename-cancel", null); }
      });
      input.focus();
      input.select();
      return;
    }
    if (a === "rename-ok" || a === "rename-cancel") {
      const row = box.querySelector(".pa-set-namerow");
      if (a === "rename-ok") {
        const v = String(row.querySelector("input")?.value || "").trim();
        settings().appName = v && v !== DEFAULT_APP_NAME ? v : "";
        saveSettings();
      }
      row.innerHTML = nameRowHtml();
      refreshAppName();
      return;
    }
    if (busy) return;
    busy = true;
    const icon = btn.querySelector("i");
    icon?.classList.add("fa-spin");
    try {
      if (a === "check") {
        say("正在检查更新…");
        const v = await extApi("version");
        if (v.isUpToDate) {
          // 已经更新过但还没刷新页面时，磁盘上的版本比正在运行的新：显示磁盘上的，并提示刷新
          const disk = await manifestVersion(stUrl(`scripts/extensions/third-party/${EXT_DIR}/manifest.json`)) || VERSION;
          say(disk !== VERSION ? `已是最新版本（${esc(disk)}），刷新页面后生效。<div class="menu_button menu_button_icon pa-set-mini" data-a="reload" tabindex="0" role="button"><i class="fa-solid fa-arrows-rotate"></i><span>刷新页面</span></div>` : `已是最新版本（${esc(VERSION)}）。`, "ok");
        } else {
          const remote = await manifestVersion(`https://raw.githubusercontent.com/Xiaxiii/Burnt-chicken-wings/${encodeURIComponent(v.currentBranchName || "main")}/manifest.json`);
          say(`检测到新版本${remote ? `（${esc(remote)}）` : ""}。<div class="menu_button menu_button_icon pa-set-mini" data-a="update" tabindex="0" role="button"><i class="fa-solid fa-download"></i><span>更新</span></div>`, "new");
        }
      } else if (a === "update") {
        say("正在更新…");
        const v = await extApi("update");
        if (v.isUpToDate) say("已是最新版本。", "ok");
        else say(`已更新${await manifestVersion(stUrl(`scripts/extensions/third-party/${EXT_DIR}/manifest.json`)).then((x) => x ? `到 ${esc(x)}` : "")}，刷新页面后生效。<div class="menu_button menu_button_icon pa-set-mini" data-a="reload" tabindex="0" role="button"><i class="fa-solid fa-arrows-rotate"></i><span>刷新页面</span></div>`, "ok");
      }
    } catch (e) {
      say(`更新失败：${esc(e.message).slice(0, 200)}<br>可在「扩展管理」中更新。`, "bad");
    } finally {
      icon?.classList.remove("fa-spin");
      busy = false;
    }
  }
  const handler = (e) => {
    const b = e.target.closest("[data-a]");
    if (!b || !box.contains(b)) return;
    if (e.type === "keydown" && e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    act(b.dataset.a, b);
  };
  box.addEventListener("click", handler);
  box.addEventListener("keydown", handler);
  box.addEventListener("change", (e) => {
    if (e.target.closest("[data-opt=entry]")) return setEntryMode(e.target.value);
    const t = e.target.closest("[data-opt=noPullRefresh]");
    if (!t) return;
    settings().noPullRefresh = t.checked;
    saveSettings();
    applyPullGuard();
  });
  host2.append(box);
}
// 1.5.1：iOS Safari 在页面顶部下拉会刷新整页（酒馆没有关掉这个行为），玩着玩着就被刷新了。
// 给 html、body 加 overscroll-behavior-y: none 即可阻止（Safari 16 起支持）。只影响「拖到顶再往下拖」，不影响正常滚动。
function applyPullGuard() {
  let st = document.getElementById("pa-pull-guard");
  const on = settings().noPullRefresh !== false;
  if (on && !st) {
    st = document.createElement("style");
    st.id = "pa-pull-guard";
    st.textContent = "html, body { overscroll-behavior-y: none; }";
    document.head.append(st);
  } else if (!on && st) st.remove();
}
// 2.3.5 悬浮球：点一下打开，按住拖动换位置，松手贴到左右边。默认关闭，扩展页设置框和「更多 → 外观」里开关
var BALL = 44, BALL_GAP = 8;
// 2.5.4 入口自选：魔棒菜单、悬浮球、两个都要；2.6.1 加「都不要」，这时从扩展页的「打开」按钮或 /atelier 打开。
// 以前开了悬浮球的（floatBall），魔棒菜单也一直在，算「两个都要」
var ENTRY_MODES = [["wand", "魔棒菜单"], ["ball", "悬浮球"], ["both", "两个都要"], ["none", "都不要"]];
var NO_ENTRY_NOTE = "从扩展页设置框点「打开」，或在聊天输入框发送 /atelier。";
function entryMode() {
  const s = settings();
  if (ENTRY_MODES.some(([k]) => k === s.entry)) return s.entry;
  return s.floatBall === true ? "both" : "wand";
}
function setEntryMode(mode) {
  if (!ENTRY_MODES.some(([k]) => k === mode)) return;
  settings().entry = mode;
  settings().floatBall = mode === "ball" || mode === "both";
  saveSettings();
  applyFloatBall();
  applyMenuEntry();
  const sel = document.querySelector("#pa-settings [data-opt=entry]");
  if (sel) sel.value = mode;
  document.querySelectorAll("#pa-root [data-entry]").forEach((b) => b.classList.toggle("on", b.dataset.entry === mode));
  document.querySelectorAll(".pa-noentry").forEach((n) => { n.hidden = mode !== "none"; });
}
// 魔棒菜单项用 display 藏：酒馆给菜单项的 flex 样式会盖过 hidden 属性
function applyMenuEntry() {
  const item = document.getElementById("pa-menu-entry");
  if (item) item.style.display = entryMode() === "ball" || entryMode() === "none" ? "none" : "";
}
// 位置按可移动范围的比例存，换横竖屏、改窗口大小后仍在同一侧
function placeBall(ball) {
  const p = settings().floatBallPos || { x: 1, y: 0.6 };
  const w = window.innerWidth, h = window.innerHeight;
  ball.style.left = Math.round(BALL_GAP + Math.min(1, Math.max(0, p.x)) * Math.max(0, w - BALL - BALL_GAP * 2)) + "px";
  ball.style.top = Math.round(BALL_GAP + Math.min(1, Math.max(0, p.y)) * Math.max(0, h - BALL - BALL_GAP * 2)) + "px";
}
function applyFloatBall() {
  let ball = document.getElementById("pa-ball");
  if (entryMode() === "wand" || entryMode() === "none") return ball?.remove();
  if (ball) return placeBall(ball);
  ball = el(`<button id="pa-ball" type="button" aria-label="打开${esc(appName())}" title="${esc(appName())}"><i class="fa-solid fa-scissors"></i></button>`);
  let start = null, moved = false, frame = 0, dx = 0, dy = 0;
  // 酒馆在 html 上监听 mousedown/touchstart，点到抽屉外就收起打开着的抽屉（扩展页等）。拖球、点球都不该让它收起
  for (const t of ["mousedown", "touchstart", "click"]) ball.addEventListener(t, (e) => e.stopPropagation());
  // 拖动时只改 transform，每帧最多一次，不触发重新排版；松手再落到 left/top
  const paint = () => {
    frame = 0;
    ball.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
  };
  ball.addEventListener("pointerdown", (e) => {
    if (e.button) return;
    const r = ball.getBoundingClientRect();
    start = { x: e.clientX, y: e.clientY, left: r.left, top: r.top, w: window.innerWidth, h: window.innerHeight };
    moved = false;
    try { ball.setPointerCapture(e.pointerId); } catch {}
  });
  ball.addEventListener("pointermove", (e) => {
    if (!start) return;
    if (!moved && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 6) return;
    if (!moved) { moved = true; ball.classList.add("pa-ball-drag"); }
    dx = Math.min(start.w - BALL, Math.max(0, start.left + e.clientX - start.x)) - start.left;
    dy = Math.min(start.h - BALL, Math.max(0, start.top + e.clientY - start.y)) - start.top;
    if (!frame) frame = requestAnimationFrame(paint);
  });
  const drop = () => {
    if (!start) return;
    const s0 = start;
    start = null;
    if (frame) { cancelAnimationFrame(frame); frame = 0; }
    if (!moved) return;
    const left = s0.left + dx, top = s0.top + dy;
    ball.style.left = left + "px";
    ball.style.top = top + "px";
    ball.style.transform = "";
    dx = dy = 0;
    settings().floatBallPos = { x: left + BALL / 2 < s0.w / 2 ? 0 : 1, y: Math.min(1, Math.max(0, (top - BALL_GAP) / Math.max(1, s0.h - BALL - BALL_GAP * 2))) };
    saveSettings();
    // 先落在松手的位置并让浏览器算好，再去掉拖动标记贴边，才有从松手处滑过去的动画
    void ball.offsetLeft;
    ball.classList.remove("pa-ball-drag");
    placeBall(ball);
  };
  ball.addEventListener("pointerup", drop);
  ball.addEventListener("pointercancel", drop);
  // 拖动结束时浏览器还会补发一次 click，不算打开
  ball.addEventListener("click", () => {
    if (moved) { moved = false; return; }
    if (rootEl2 && !rootEl2.hidden) return;
    open();
  });
  if (rootEl2 && !rootEl2.hidden) ball.hidden = true;
  document.body.append(ball);
  placeBall(ball);
}
function registerSlash() {
  try {
    const c2 = ctx();
    if (c2.SlashCommandParser && c2.SlashCommand) {
      c2.SlashCommandParser.addCommandObject(c2.SlashCommand.fromProps({
        name: "atelier",
        aliases: ["焦香鸡翅"],
        helpString: "打开焦香鸡翅",
        callback: () => {
          open();
          return "";
        }
      }));
    } else if (c2.registerSlashCommand) {
      c2.registerSlashCommand("atelier", () => {
        open();
        return "";
      }, ["焦香鸡翅"], "打开焦香鸡翅");
    }
  } catch (e) {
    console.warn("[焦香鸡翅] 注册斜杠命令失败", e);
  }
}
var applying = false;
// 自动套用只在「进入一个聊天」时做一次。酒馆和别的扩展在同一个聊天里也会反复发出聊天切换事件
// （重新载入聊天、改角色卡等），以前每次都套用，手动换的预设会被立刻换回去。现在同一个聊天只处理一次。
var handledChat = null;
function chatKeyNow() {
  try {
    return String(ctx().getCurrentChatId?.() || ctx().chatId || "");
  } catch {
    return "";
  }
}
function markChatHandled() {
  handledChat = chatKeyNow();
}
// 换角色、换聊天时弹一个小提示：现在用的预设和模型（3 秒后消失）
function chatInfoToast(scheme) {
  if (settings().chatToast === false) return;
  try {
    if ((ctx().mainApi || $("#main_api").val()) !== "openai") return;
    const t = globalThis.toastr;
    const preset = currentPresetName() || "（未选预设）";
    const model = liveConnection().model || "（未选模型）";
    const msg = `模型：${model}${scheme ? `\n方案：${scheme.name}` : ""}`;
    if (t?.info) tapToClose(t, t.info(msg, `预设：${preset}`, { timeOut: 3e3, extendedTimeOut: 1e3, closeOnHover: false, preventDuplicates: false, toastClass: "toast pa-chat-toast", escapeHtml: true, tapToDismiss: true }));
  } catch (e) {
    console.warn("[焦香鸡翅] 提示当前预设失败", e);
  }
}
var onChatChanged = debounce(async () => {
  const key = chatKeyNow();
  if (!key || key === handledChat) return;
  handledChat = key;
  let applied = null;
  try {
    const t0 = performance.now();
    const job = autoApplyBinding();
    jankOwn("切换聊天：自动套用方案", t0, performance.now() - t0);
    applied = await job;
  } finally {
    // 等自动连回站点、预设切换的事件处理完，再读当前的预设和模型
    setTimeout(() => { if (chatKeyNow() === key) jankTime("切换聊天：提示预设和模型", () => chatInfoToast(applied)); }, 900);
  }
}, 600);
async function autoApplyBinding() {
  const bind = bindingNow();
  const id = bind?.id;
  if (!id) return null;
  const sc = settings().schemes.find((x) => x.id === id);
  if (!sc) return null;
  try {
    // 预设已归档：读不到，直接交给 applyScheme，它会先从归档恢复
    if (!listPresets().includes(sc.preset)) {
      return await applyScheme(sc, { quiet: true, silent: true }) ? sc : null;
    }
    const d = getDraft(sc.preset, { fresh: true });
    const presetOk = currentPresetName() === sc.preset;
    const personaOk = !sc.persona || currentPersona() === sc.persona;
    const siteOk = !connDiffers(schemeConn(sc));
    if (presetOk && personaOk && siteOk && schemeMatches(d, sc)) return sc;
    return await applyScheme(sc, { quiet: true, silent: true }) ? sc : null;
  } catch (e) {
    console.warn("[焦香鸡翅] 套用聊天绑定方案失败", e);
    toast(`套用本聊天绑定的方案「${sc.name}」失败：${e.message}`, "warning");
    return null;
  }
}
function whoFromStack(stack) {
  const names = [...String(stack || "").matchAll(/extensions\/third-party\/([^/?#]+)\//g)].map((m) => decodeURIComponent(m[1]));
  const other = names.find((n) => !/burnt|chicken|atelier|焦香/i.test(n));
  if (other) return other;
  const scripts = [...String(stack || "").matchAll(/scripts\/extensions\/([^/?#]+)\//g)].map((m) => m[1]).find((n) => n !== "third-party");
  return scripts ? `酒馆内置扩展 ${scripts}` : "";
}
function watchMirrorWrites() {
  const orig = window.fetch;
  if (typeof orig !== "function" || orig.__paWatch) return;
  const wrapped = function(input, init) {
    const t0 = performance.now();
    try {
      const url = typeof input === "string" ? input : input?.url || "";
      const body = init?.body;
      if (/api\/presets\/save/.test(url) && typeof body === "string" && body.includes("entryGrouping")) {
        const b = JSON.parse(body);
        const ext = b?.preset?.extensions;
        const bai = ext?.baibaiToolkit?.presetPromptGroups?.groups;
        if (b?.name && Array.isArray(ext?.entryGrouping) && Array.isArray(bai)) {
          const ids = new Set(bai.map((g) => g?.id).filter(Boolean));
          if (ext.entryGrouping.some((g) => g && ids.has(g.id)) && settings().mirrorFixed?.[b.name] && !settings().mirrorIgnore?.[b.name]) {
            const by = whoFromStack(new Error().stack);
            if (!settings().mirrorWrites || typeof settings().mirrorWrites !== "object") settings().mirrorWrites = {};
            settings().mirrorWrites[b.name] = { at: Date.now(), by };
            saveSettings();
            console.warn("[焦香鸡翅] 有人把旧的重复分组写回了预设", b.name, by || "(酒馆保存预设)", new Error().stack);
          }
        }
      }
    } catch {
    }
    const ms = performance.now() - t0;
    if (ms > 1) jankOwn("保存预设时检查重复分组", t0, ms);
    return orig.apply(this, arguments);
  };
  wrapped.__paWatch = true;
  window.fetch = wrapped;
  cleanups.push(() => { if (window.fetch === wrapped) window.fetch = orig; });
}
// 1.9.8 规则：换预设，API 不变；切方案，恢复方案记录的 API。
// 去掉「切换预设后连回使用中站点」；关闭酒馆的「预设绑定连接」（只在升级后做一次，之后由用户在酒馆里自行决定）
function migrateApiRule() {
  const s = settings();
  if (s.apiRule === 2) return;
  s.apiRule = 2;
  s.keepApi = false;
  try { if (bindPresetToConnection()) setBindPresetToConnection(false); } catch {}
  saveSettings();
}
function bindEvents() {
  const c2 = ctx();
  const et2 = c2.eventTypes || c2.event_types;
  // 2.7.8 每个处理函数都计时，供「体检 → 运行中的卡顿」核对
  const EV_NAME = { CHAT_CHANGED: "切换聊天", PRESET_CHANGED: "切换预设", GENERATION_STARTED: "开始生成", GENERATION_AFTER_COMMANDS: "生成前", GENERATION_ENDED: "生成结束", GENERATION_STOPPED: "停止生成" };
  const evLabel = (ev) => EV_NAME[Object.keys(et2).find((k) => et2[k] === ev)] || ev;
  const on = (ev, fn) => {
    if (!ev) return;
    const timed = jankWrap(`事件：${evLabel(ev)}`, fn);
    c2.eventSource.on(ev, timed);
    cleanups.push(() => c2.eventSource.removeListener?.(ev, timed));
  };
  on(et2.PRESET_CHANGED, (e) => {
    if (e?.apiId && e.apiId !== "openai") return;
    try { onPresetSwitchReasoning(e?.name); } catch (err) { console.warn("[焦香鸡翅] 切换推理格式失败", err); }
    // 正则保存只刷新原生面板，保留正在操作的来源选择和缝合位置。
    if (presetRegexRefreshName && e?.apiId === "openai" && e?.name === presetRegexRefreshName) return;
    try { notePresetUse(currentPresetName()); } catch {}
    dropClean();
    // 整页重画（含预设下拉框里的「使用中」标记）
    if (rootEl2 && !rootEl2.hidden) show(current);
  });
  on(et2.CHAT_CHANGED, () => onChatChanged());
  bindReplyGuard(on, et2);
  bindVariableWatch(on, et2);
  bindSemanticReview(on, et2);
  bindBalanceWatch(on, et2);
}
async function start() {
  const prev = globalThis.__presetAtelier;
  if (prev && prev.kind === "extension" && BUILD_KIND === "script") {
    console.info("[焦香鸡翅] 已经装了扩展版，脚本版不再启动");
    return;
  }
  if (prev?.destroy) {
    try {
      prev.destroy();
    } catch {
    }
  }
  jankStart();
  await initHost();
  migrateApiRule();
  watchMirrorWrites();
  const checkpointAll = () => { for (const d of dirtyDrafts()) checkpoint(d); };
  window.addEventListener("pagehide", checkpointAll);
  const hiddenCheckpoint = () => { if (document.hidden) { checkpointAll(); flushPresetNotice(); } };
  document.addEventListener("visibilitychange", hiddenCheckpoint);
  cleanups.push(() => { checkpointAll(); flushPresetNotice(); window.removeEventListener("pagehide", checkpointAll); document.removeEventListener("visibilitychange", hiddenCheckpoint); for(const t of autoTimers.values()) clearTimeout(t); });
  window.addEventListener("popstate", onPopState);
  document.addEventListener("keydown", onRootKey);
  cleanups.push(() => { window.removeEventListener("popstate", onPopState); document.removeEventListener("keydown", onRootKey); });
  injectStyle();
  try { applyPullGuard(); } catch {}
  // 1.8.0 去掉了后台中断补救，清掉它留下的记录
  try { localStorage.removeItem("presetAtelier:generating"); } catch {}
  try { delete settings().rescue; } catch {}
  try { if (migrateLegacyKeys(settings().sites)) saveSettings(); } catch {}
  cleanups.push(() => document.getElementById("pa-pull-guard")?.remove());
  addMenuEntry();
  addSettingsEntry();
  try { applyFloatBall(); } catch {}
  const replaceBall = () => { const b = document.getElementById("pa-ball"); if (b) placeBall(b); };
  window.addEventListener("resize", replaceBall);
  cleanups.push(() => { window.removeEventListener("resize", replaceBall); document.getElementById("pa-ball")?.remove(); });
  registerSlash();
  bindEvents();
  try { notePresetUse(currentPresetName(), { save: false }); } catch {}
  initReasoningFollow();
  let tries = 0;
  const timer = setInterval(() => {
    addMenuEntry();
    addSettingsEntry();
    if (++tries > 20 || document.getElementById("pa-menu-entry") && document.getElementById("pa-settings")) clearInterval(timer);
  }, 1e3);
  globalThis.__presetAtelier = {
    version: VERSION,
    kind: BUILD_KIND,
    open,
    jank: jankSummary,
    destroy() {
      clearInterval(timer);
      cleanups.splice(0).forEach((f) => {
        try {
          f();
        } catch {
        }
      });
      document.getElementById("pa-root")?.remove();
      document.getElementById("pa-style")?.remove();
      document.getElementById("pa-menu-entry")?.remove();
      document.getElementById("pa-settings")?.remove();
      rootEl2 = null;
    }
  };
  console.log(`[焦香鸡翅] ${VERSION} 已加载`);
}
// 备份：每批修改开始前自动备份一次修改前的版本，每个预设保留最近 backupMax() 份（2.4.2 可关闭）
async function backupsSheet(name) {
  let list = [];
  try {
    list = await backupList(name);
  } catch (e) {
    return toast("读取备份失败：" + e.message, "error");
  }
  if (!list.length) return toast(backupOn() ? `「${name}」暂无备份` : "自动备份已关闭，可在「清理 → 本地备份」开启");
  const items = list.map((b) => ({ label: new Date(b.time).toLocaleString(), sub: b.reason, value: b.id }));
  const id = await pickBox(`「${name}」的备份（${list.length} 份）`, items, { hint: `${backupOn() ? "每批修改前自动备份一次。" : "自动备份已关闭。"}备份只存在本浏览器，换设备或清除数据后丢失，重要版本请下载。点一份可恢复或下载。` });
  if (!id) return;
  const b = await backupGet(id);
  const how = await pickBox("选择操作", [{ label: "恢复", sub: "恢复后自动保存，可撤销", value: "restore" }, { label: "下载 JSON 文件", value: "download" }]);
  if (how === "download") {
    downloadBlob(new Blob([JSON.stringify(b.data, null, 4)], { type: "application/json" }), `${name}-备份-${new Date(b.time).toISOString().slice(0, 16).replace(/[:T]/g, "")}.json`);
  }
  if (how === "restore") {
    const d = getDraft(name);
    mutate(d, "恢复备份", (x) => x.replaceWith(b.data));
    toast("已恢复", "success");
  }
}
// 1.4.1：扩展名称可修改，默认「焦香鸡翅」。酒馆「扩展管理」列表里的名称来自 manifest.json，无法按用户修改
var DEFAULT_APP_NAME = "焦香鸡翅";
function appName() {
  try {
    return settings().appName || DEFAULT_APP_NAME;
  } catch {
    return DEFAULT_APP_NAME;
  }
}
function nameRowHtml() {
  return `<span class="pa-set-k">名称</span>
          <span class="pa-set-v pa-appname">${esc(appName())}</span>
          <div class="menu_button menu_button_icon pa-set-mini" data-a="rename" tabindex="0" role="button" title="修改名称（留空恢复默认）"><i class="fa-solid fa-pencil"></i><span>修改</span></div>`;
}
function refreshAppName() {
  document.querySelectorAll(".pa-appname").forEach((x) => { x.textContent = appName(); });
  const ball = document.getElementById("pa-ball");
  if (ball) { ball.title = appName(); ball.setAttribute("aria-label", `打开${appName()}`); }
}
