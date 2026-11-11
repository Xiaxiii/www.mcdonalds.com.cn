// 2.7.0 「方案」「连接」各占一页，共用一个连接模块：当前连接、站点在连接页，换角色提示、推理格式跟随预设在方案页
function mountPlan(schemesPage, connPage) {
  schemesPage.innerHTML = '<div class="pa-scroll pa-plan"><div class="pa-plan-schemes"></div><div class="pa-plan-opts"></div></div>';
  connPage.innerHTML = '<div class="pa-scroll pa-plan"><div class="pa-plan-live"></div><div class="pa-plan-sites"></div></div>';
  const api = mountApi(connPage.querySelector(".pa-plan-live"), connPage.querySelector(".pa-plan-sites"), schemesPage.querySelector(".pa-plan-opts"));
  // 方案改动后刷新站点列表（站点标题显示被哪些预设的方案使用）
  const sc = mountSchemes(schemesPage.querySelector(".pa-plan-schemes"), { after: () => api.render() });
  return {
    schemes: { render: () => sc.render(), destroy: sc.destroy },
    conn: { render: () => api.render() }
  };
}
// 「设置」页：入口、配色、文字大小、背景图
function mountLook(page) {
  page.innerHTML = `<div class="pa-scroll"><h3 class="pa-h">入口</h3><div class="pa-entryslot"></div><div class="pa-look"></div><h3 class="pa-h">文字大小</h3><div class="pa-fsslot"></div><div class="pa-hrow"><h3 class="pa-h">背景图</h3><button class="pa-why" data-bgwhy type="button" aria-label="说明" aria-expanded="false" title="说明">${INFO_ICON}</button></div><div class="pa-whynote" hidden>图片只保存在本浏览器，不上传。遮罩越高，文字越清楚。</div><div class="pa-bgslot"></div></div>`;
  const slot = page.querySelector(".pa-look");
  const bgSlot = page.querySelector(".pa-bgslot");
  const fsSlot = page.querySelector(".pa-fsslot");
  bindFontSize(fsSlot);
  const bgWhy = page.querySelector("[data-bgwhy]");
  bgWhy.addEventListener("click", () => {
    const note = bgWhy.parentElement.nextElementSibling;
    note.hidden = !note.hidden;
    bgWhy.setAttribute("aria-expanded", String(!note.hidden));
  });
  const entrySlot = page.querySelector(".pa-entryslot");
  entrySlot.addEventListener("click", (e) => { const b = e.target.closest("[data-entry]"); if (b) setEntryMode(b.dataset.entry); });
  const render = () => {
    entrySlot.innerHTML = `<div class="pa-seg pa-seg-s" role="group" aria-label="打开${esc(appName())}的入口">${ENTRY_MODES.map(([k, l]) => `<button type="button" data-entry="${k}" class="${k === entryMode() ? "on" : ""}">${l}</button>`).join("")}</div>
      <small class="pa-dim pa-entry-note pa-noentry" ${entryMode() === "none" ? "" : "hidden"}>${NO_ENTRY_NOTE}</small>`;
    fsSlot.innerHTML = fontSizeSeg();
    slot.innerHTML = themeCards();
    bgSlot.innerHTML = bgPanel();
  };
  bindThemeCards(slot);
  bindBgPanel(bgSlot, render);
  return { render };
}
