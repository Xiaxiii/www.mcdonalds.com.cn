// 名称选择：一个小按钮「名称 ▾」，点开是带搜索的列表（预设、世界书多的时候好找）。
// 预设、世界书的列表一律带搜索（不看数量），外面就不再另放搜索框；只有几个固定选项的（来源类型、排序）传 search:false。
// 代替系统下拉框：系统下拉框在手机上又大又长，也不能搜索。

/**
 * @param {{title:string, items:{value:string,label?:string,sub?:string}[], current?:string, search?:boolean}} o
 * @returns {Promise<string|null>}
 */
// extra：搜索框旁边的一个按钮（例如「取消归属」），点了就返回它的 value
async function pickName({ title, items, current = null, search, extra = null, manage = null } = {}) {
  const useSearch = search ?? true;
  const q0 = useSearch ? `<input class="pa-input pa-npick-q" style="${FIELD_STYLE}" type="text" inputmode="search" enterkeyhint="search" autocorrect="off" spellcheck="false" placeholder="搜索" autocapitalize="off" autocomplete="off">` : "";
  const ex = extra ? `<button class="pa-btn pa-btn-s pa-npick-extra${extra.value === current ? " on" : ""}" type="button" data-v="${esc(extra.value)}">${esc(extra.label)}</button>` : "";
  const body = el(`<div class="pa-npick" style="${LIST_STYLE}">${ex ? `<div class="pa-npick-top" style="${LIST_STYLE}">${q0}${ex}</div>` : q0}<div class="pa-npick-dmhead" hidden></div><div class="pa-npick-list" style="${LIST_STYLE}" role="listbox"></div><p class="pa-hint pa-dl-note" hidden></p>${manage ? '<div class="pa-npick-foot"></div>' : ""}</div>`);
  const q = body.querySelector(".pa-npick-q");
  const dmHead = body.querySelector(".pa-npick-dmhead");
  const box = body.querySelector(".pa-npick-list");
  const dlNote = body.querySelector(".pa-dl-note");
  const foot = body.querySelector(".pa-npick-foot");
  let picked = null;
  let delMode = false;
  let dmItems = [];
  const dmSel = new Set();
  let dlDone = false;
  let wrapEl = null;
  const paintFoot = () => {
    if (!foot) return;
    if (!delMode) {
      foot.innerHTML = `<button type="button" class="pa-btn pa-btn-s pa-btn-danger-soft" data-np="delmode">${esc(manage.buttonLabel || "删除预设…")}</button>`;
      return;
    }
    const n = dmSel.size;
    const unit = manage.unit || "个";
    foot.innerHTML = `<button type="button" class="pa-btn pa-btn-s" data-np="cancel">返回</button>${manage.download ? `<button type="button" class="pa-btn pa-btn-s" data-np="dl" ${n ? "" : "disabled"}>${dlDone ? "重新下载" : "下载备份"}</button>` : ""}<button type="button" class="pa-btn pa-btn-s pa-btn-danger" data-np="del" ${n ? "" : "disabled"}>${n ? `删除 ${n} ${unit}` : "删除"}</button>`;
  };
  const paint = () => {
    const k = (q?.value || "").trim().toLowerCase();
    if (delMode && manage) {
      const hits = dmItems.filter((it) => !k || String(it.label ?? it.name).toLowerCase().includes(k) || String(it.why || it.sub || "").toLowerCase().includes(k));
      const can = hits.filter((it) => !it.disabled);
      const allOn = can.length > 0 && can.every((it) => dmSel.has(it.name));
      const someOn = can.some((it) => dmSel.has(it.name));
      dmHead.hidden = false;
      dmHead.innerHTML = `${manage.hint ? `<p class="pa-hint">${esc(manage.hint)}</p>` : ""}<label class="pa-dm-all"><input type="checkbox" data-np="all" ${allOn ? "checked" : ""} ${can.length ? "" : "disabled"}><span>全选${k ? "当前匹配" : ""}</span></label>`;
      const allBox = dmHead.querySelector("[data-np=all]");
      if (allBox) allBox.indeterminate = someOn && !allOn;
      box.setAttribute("role", "group");
      box.innerHTML = hits.map((it) => `<label class="pa-dm-row${it.disabled ? " pa-off" : ""}${dmSel.has(it.name) ? " pa-sel" : ""}"><input type="checkbox" data-dm-name="${esc(it.name)}" ${dmSel.has(it.name) ? "checked" : ""} ${it.disabled ? "disabled" : ""}><span class="pa-dm-t"><span class="pa-dm-name">${esc(it.label ?? it.name)}</span>${it.why || it.sub ? `<small>${esc(it.why || it.sub)}</small>` : ""}</span></label>`).join("") || '<p class="pa-hint">没有匹配的</p>';
      paintFoot();
      return;
    }
    dmHead.hidden = true;
    dmHead.innerHTML = "";
    dlNote.hidden = true;
    dlNote.innerHTML = "";
    box.setAttribute("role", "listbox");
    const hits = items.filter((it) => !k || String(it.label ?? it.value).toLowerCase().includes(k) || String(it.sub || "").toLowerCase().includes(k));
    // 2.11.26 当前选中的标一个勾；开头的「＋」换成画的图标
    box.innerHTML = hits.map((it) => {
      const on = it.value === current;
      const L = menuIcon(it.label ?? it.value);
      const mark = on ? `<span class="pa-mi pa-mi-check" aria-hidden="true">${ICON.check}</span>` : L.icon;
      return `<button class="pa-npick-item${on ? " on" : ""}${mark ? " pa-has-mi" : ""}" style="${ROW_STYLE}" data-v="${esc(it.value)}" role="option" aria-selected="${on}"><span>${esc(L.text)}</span>${it.sub ? `<small>${esc(it.sub)}</small>` : ""}${mark}</button>`;
    }).join("") || '<p class="pa-hint">没有匹配的</p>';
    paintFoot();
  };
  onSearchInput(q, () => paint(), items.length > 150 ? 120 : 0);
  paint();
  // 2.12.25 贴着按钮下拉展开，给足舒适宽度（不因触发按钮窄而被压成细条）
  const anchor = recentAnchor();
  const pop = !!anchor;
  await sheet({ title, body, noFocus: true, actions: [], place: pop ? "pop" : "center", anchor, cls: pop ? "pa-pop-picker" : `pa-sheet-picker${items.length > 10 ? " pa-sheet-tall" : ""}`, onMount: (w) => {
    wrapEl = w;
    const headTitle = w.querySelector(".pa-sheet-head b");
    const setMode = (on) => {
      delMode = on;
      dmSel.clear();
      dlDone = false;
      dlNote.hidden = true;
      dlNote.innerHTML = "";
      if (on && manage) dmItems = manage.items();
      if (headTitle) headTitle.textContent = on ? (manage.title || "删除预设") : title;
      paint();
    };
    body.querySelector(".pa-npick-extra")?.addEventListener("click", (e) => {
      picked = e.currentTarget.dataset.v;
      w._close(null);
    });
    dmHead.addEventListener("change", (e) => {
      if (e.target.dataset?.np !== "all") return;
      const k = (q?.value || "").trim().toLowerCase();
      const hits = dmItems.filter((it) => !it.disabled && (!k || String(it.label ?? it.name).toLowerCase().includes(k) || String(it.why || it.sub || "").toLowerCase().includes(k)));
      for (const it of hits) e.target.checked ? dmSel.add(it.name) : dmSel.delete(it.name);
      paint();
    });
    box.addEventListener("change", (e) => {
      const name = e.target.dataset?.dmName;
      if (name === void 0) return;
      e.target.checked ? dmSel.add(name) : dmSel.delete(name);
      paint();
    });
    box.addEventListener("click", (e) => {
      if (delMode) return;
      const b = e.target.closest("[data-v]");
      if (!b) return;
      picked = b.dataset.v;
      w._close(null);
    });
    foot?.addEventListener("click", async (e) => {
      const act = e.target.closest("[data-np]")?.dataset.np;
      if (!act) return;
      if (act === "delmode") return setMode(true);
      if (act === "cancel") return setMode(false);
      const chosen = dmItems.filter((it) => dmSel.has(it.name));
      if (!chosen.length) return;
      if (act === "dl" && manage.download) {
        const msg = await manage.download(chosen);
        dlDone = true;
        dlNote.innerHTML = msg;
        dlNote.hidden = !msg;
        paintFoot();
        return;
      }
      if (act === "del" && manage.onDelete) {
        const ok = await manage.onDelete(chosen);
        if (ok !== false) wrapEl._close(null);
      }
    });
    scrollToView(box.querySelector(".on"));
  } });
  return picked;
}

// 按钮的 HTML：名称过长时省略，整名放在 title 里
function nameBtnHtml(name, cls = "", placeholder = "请选择") {
  return `<button class="pa-namebtn ${cls}" type="button" title="${esc(name || "")}"><span>${esc(name || placeholder)}</span><i aria-hidden="true">▾</i></button>`;
}

// use：显示「切换」按钮，在酒馆中切换到选中的预设（2.11.7）；manage：预设选择器底部的管理/删除预设入口
function presetPicker(slot, onPick, { label = "预设", use = false, manage = null } = {}) {
  slot.innerHTML = `<div class="pa-picker">${label ? `<span>${esc(label)}</span>` : ""}${nameBtnHtml("")}${use ? '<button class="pa-btn pa-btn-s pa-use-preset" type="button" hidden>切换</button>' : ""}</div>`;
  const btn = slot.querySelector(".pa-namebtn");
  const useBtn = slot.querySelector(".pa-use-preset");
  btn.setAttribute("aria-label", label || "预设");
  let current2 = null;
  const paintBtn = () => {
    const using = currentPresetName();
    btn.title = current2 || "";
    btn.querySelector("span").textContent = current2 || "请选择";
    btn.classList.toggle("pa-using", !!current2 && current2 === using);
    if (useBtn) {
      useBtn.hidden = !current2 || current2 === using;
      useBtn.title = current2 ? `在酒馆中切换到「${current2}」` : "";
      useBtn.setAttribute("aria-label", useBtn.title || "切换预设");
    }
  };
  useBtn?.addEventListener("click", async () => {
    const name = current2;
    if (!name || name === currentPresetName()) return;
    useBtn.disabled = true;
    try {
      // 这个预设还有没存完的修改：先存，酒馆切换时读到的才是最新内容
      if (drafts.get(name)?.dirty) await saveDraft(name, "切换前保存");
      await selectPreset(name);
      toast(`已切换到「${name}」`, "success");
    } catch (e) {
      toast("切换失败：" + e.message, "error");
    } finally {
      useBtn.disabled = false;
      paintBtn();
    }
  });
  btn.addEventListener("click", async () => {
    const using = currentPresetName();
    const v = await pickName({ title: label ? `选择${label}` : "选择预设", current: current2, items: listPresets().map((n) => ({ value: n, sub: n === using ? "使用中" : "" })), manage });
    paintBtn();
    if (!v || v === current2) return;
    current2 = v;
    paintBtn();
    onPick(v);
  });
  return {
    set(name) {
      current2 = name;
      paintBtn();
    },
    refresh: paintBtn,
    el: btn
  };
}
