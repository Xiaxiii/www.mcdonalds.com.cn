// 2.7.0 「方案」「连接」各占一页，共用一个连接模块：当前连接、站点在连接页。
// 2.12.16 换角色提示、推理格式跟随预设移到「设置」页（optsBox 由设置页给）
function mountPlan(schemesPage, connPage, optsBox) {
  schemesPage.innerHTML = '<div class="pa-scroll pa-plan"><div class="pa-plan-schemes"></div></div>';
  connPage.innerHTML = '<div class="pa-scroll pa-plan"><div class="pa-plan-live"></div><div class="pa-plan-sites"></div></div>';
  const api = mountApi(connPage.querySelector(".pa-plan-live"), connPage.querySelector(".pa-plan-sites"), optsBox);
  // 方案改动后刷新站点列表（站点标题显示被哪些预设的方案使用）
  const sc = mountSchemes(schemesPage.querySelector(".pa-plan-schemes"), { after: () => api.render() });
  return {
    schemes: { render: () => sc.render(), destroy: sc.destroy },
    conn: { render: () => api.render() },
    opts: () => api.render()
  };
}
// 「设置」页。2.12.16 分三组：通用与备份（入口、防下拉误刷新、换聊天提示、推理格式跟随预设、自动备份）、外观（配色、文字大小、背景图）、关于（名称、版本）
function mountLook(page, { goBackup } = {}) {
  page.innerHTML = `<div class="pa-scroll pa-setpage">
    <h3 class="pa-h pa-set-group">通用与备份</h3>
    <div class="pa-setcard">
      <div class="pa-setrow pa-setrow-col"><span class="pa-setk">入口</span><div class="pa-entryslot"></div></div>
      <div class="pa-setrow"><span class="pa-setk">防止下拉误刷新<small>在页面顶部往下拖时，浏览器不再刷新整个酒馆</small></span><label class="pa-switch"><input type="checkbox" data-set="pull" aria-label="防止下拉误刷新"><i></i></label></div>
      <button type="button" class="pa-setrow pa-setlink" data-set="backup"><span class="pa-setk">自动备份<small class="pa-set-bksum"></small></span><i aria-hidden="true">›</i></button>
    </div>
    <div class="pa-plan-opts pa-set-opts"></div>
    <h3 class="pa-h pa-set-group">外观</h3>
    <div class="pa-look"></div>
    <h3 class="pa-h">文字大小</h3><div class="pa-fsslot"></div>
    <div class="pa-hrow"><h3 class="pa-h">背景图</h3><button class="pa-why" data-bgwhy type="button" aria-label="说明" aria-expanded="false" title="说明">${INFO_ICON}</button></div><div class="pa-whynote" hidden>图片只保存在本浏览器，不上传。遮罩越高，文字越清楚。</div><div class="pa-bgslot"></div>
    <h3 class="pa-h pa-set-group">关于</h3>
    <div class="pa-setcard">
      <div class="pa-setrow pa-set-name"><span class="pa-setk">名称</span><span class="pa-setv pa-appname"></span><button type="button" class="pa-btn pa-btn-s" data-set="rename">修改</button></div>
      <div class="pa-setrow"><span class="pa-setk">版本</span><span class="pa-setv">${esc(VERSION)}${BUILD_KIND === "extension" ? "" : " · 脚本版"}</span></div>
    </div>
  </div>`;
  const slot = page.querySelector(".pa-look");
  const bgSlot = page.querySelector(".pa-bgslot");
  const fsSlot = page.querySelector(".pa-fsslot");
  const optsSlot = page.querySelector(".pa-set-opts");
  bindFontSize(fsSlot);
  const bgWhy = page.querySelector("[data-bgwhy]");
  bgWhy.addEventListener("click", () => {
    const note = bgWhy.parentElement.nextElementSibling;
    note.hidden = !note.hidden;
    bgWhy.setAttribute("aria-expanded", String(!note.hidden));
  });
  const entrySlot = page.querySelector(".pa-entryslot");
  entrySlot.addEventListener("click", (e) => { const b = e.target.closest("[data-entry]"); if (b) setEntryMode(b.dataset.entry); });
  page.addEventListener("change", (e) => {
    if (e.target.dataset?.set !== "pull") return;
    settings().noPullRefresh = e.target.checked;
    saveSettings();
    applyPullGuard();
    const other = document.querySelector("#mcd-settings [data-opt=noPullRefresh]");
    if (other) other.checked = e.target.checked;
  });
  page.addEventListener("click", async (e) => {
    const a = e.target.closest("[data-set]")?.dataset.set;
    if (a === "backup") return goBackup?.();
    if (a !== "rename") return;
    const nameEl = page.querySelector(".pa-set-name .pa-setv");
    const v = await inlineEdit(nameEl, appName(), { placeholder: DEFAULT_APP_NAME });
    if (v == null) return;
    settings().appName = v && v !== DEFAULT_APP_NAME ? v : "";
    saveSettings();
    refreshAppName();
    const row = document.querySelector("#mcd-settings .pa-set-namerow");
    if (row) row.innerHTML = nameRowHtml();
  });
  let renderOpts = null;
  const render = () => {
    entrySlot.innerHTML = `<div class="pa-seg pa-seg-s" role="group" aria-label="打开${esc(appName())}的入口">${ENTRY_MODES.map(([k, l]) => `<button type="button" data-entry="${k}" class="${k === entryMode() ? "on" : ""}">${l}</button>`).join("")}</div>
      <small class="pa-dim pa-entry-note pa-noentry" ${entryMode() === "none" ? "" : "hidden"}>${NO_ENTRY_NOTE}</small>`;
    page.querySelector("[data-set=pull]").checked = settings().noPullRefresh !== false;
    page.querySelector(".pa-set-bksum").textContent = backupOn() ? `已开启 · 每个预设保留 ${backupMax()} 份` : "已关闭";
    page.querySelector(".pa-set-name .pa-setv").textContent = appName();
    fsSlot.innerHTML = fontSizeSeg();
    slot.innerHTML = themeCards();
    bgSlot.innerHTML = bgPanel();
    renderOpts?.();
  };
  bindThemeCards(slot);
  bindBgPanel(bgSlot, render);
  return { render, optsSlot, setOptsRender: (fn) => { renderOpts = fn; } };
}
