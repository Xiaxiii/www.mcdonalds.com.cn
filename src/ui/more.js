// 2.7.0 「方案」「连接」各占一页，共用一个连接模块：当前连接、站点在连接页。
// 2.12.25 换聊天时提示切换方案、推理格式跟随预设（自动解析）放回「方案」页
function mountPlan(schemesPage, connPage) {
  schemesPage.innerHTML = '<div class="pa-scroll pa-plan"><div class="pa-plan-schemes"></div><div class="pa-plan-opts"></div></div>';
  connPage.innerHTML = '<div class="pa-scroll pa-plan"><div class="pa-plan-live"></div><div class="pa-plan-sites"></div></div>';
  const api = mountApi(connPage.querySelector(".pa-plan-live"), connPage.querySelector(".pa-plan-sites"), schemesPage.querySelector(".pa-plan-opts"));
  // 方案改动后刷新站点列表（站点标题显示被哪些预设的方案使用）
  const sc = mountSchemes(schemesPage.querySelector(".pa-plan-schemes"), { after: () => api.render() });
  return {
    schemes: { render: () => sc.render(), destroy: sc.destroy },
    conn: { render: () => api.render() },
    opts: () => api.render()
  };
}
// 「设置」页。2.12.19 不再外包灰盒：入口、配色、文字大小、背景图直接铺在白底上；
// 三项行为偏好（防下拉误刷新、换聊天提示、推理格式跟随预设）收进一张白底细线卡；版本和致谢在页脚一行灰字
function mountLook(page, { goBackup } = {}) {
  page.innerHTML = `<div class="pa-scroll pa-setpage pa-setflat">
    <section class="pa-setsec"><h3 class="pa-h pa-set-group">入口</h3><div class="pa-entryslot"></div></section>
    <section class="pa-setsec pa-look"></section>
    <section class="pa-setsec"><h3 class="pa-h pa-set-group">文字大小</h3><div class="pa-fsslot"></div></section>
    <section class="pa-setsec"><div class="pa-hrow"><h3 class="pa-h pa-set-group">背景图</h3><button class="pa-why" data-bgwhy type="button" aria-label="说明" aria-expanded="false" title="说明">${INFO_ICON}</button></div><div class="pa-whynote" hidden>图片只保存在本浏览器，不上传。遮罩越高，文字越清楚。</div><div class="pa-bgslot"></div></section>
    <section class="pa-setsec"><h3 class="pa-h pa-set-group">偏好</h3>
      <div class="pa-setcard pa-prefcard">
        <div class="pa-setrow"><span class="pa-setk">面板内防下拉误刷新<small>在页面顶部往下拖时，浏览器不再刷新整个酒馆</small></span><label class="pa-switch"><input type="checkbox" data-set="pull" aria-label="防止下拉误刷新"><i></i></label></div>
      </div></section>
    <p class="pa-setfoot"><span class="pa-appname"></span> ${esc(VERSION)}${BUILD_KIND === "extension" ? "" : " · 脚本版"} · by EC<button type="button" class="pa-link" data-set="rename" title="改面板名称">改名称</button></p>
  </div>`;
  const slot = page.querySelector(".pa-look");
  const bgSlot = page.querySelector(".pa-bgslot");
  const fsSlot = page.querySelector(".pa-fsslot");
  const optsSlot = page.querySelector(".pa-set-opts");
  bindFontSize(fsSlot);
  const bgWhy = page.querySelector("[data-bgwhy]");
  bgWhy.addEventListener("click", () => {
    const note = bgWhy.parentElement.nextElementSibling;
    const open = accClosed(note);
    accHidden(note, open);
    bgWhy.setAttribute("aria-expanded", String(open));
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
    const nameEl = page.querySelector(".pa-setfoot .pa-appname");
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
    page.querySelector(".pa-setfoot .pa-appname").textContent = appName();
    fsSlot.innerHTML = fontSizeSeg();
    slot.innerHTML = themeCards();
    bgSlot.innerHTML = bgPanel();
    renderOpts?.();
  };
  bindThemeCards(slot);
  bindBgPanel(bgSlot, render);
  return { render, optsSlot, setOptsRender: (fn) => { renderOpts = fn; } };
}
