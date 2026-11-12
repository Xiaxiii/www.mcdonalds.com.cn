// 名称选择：一个小按钮「名称 ▾」，点开是带搜索的列表（预设、世界书多的时候好找）。
// 预设、世界书的列表一律带搜索（不看数量），外面就不再另放搜索框；只有几个固定选项的（来源类型、排序）传 search:false。
// 代替系统下拉框：系统下拉框在手机上又大又长，也不能搜索。

/**
 * @param {{title:string, items:{value:string,label?:string,sub?:string}[], current?:string, search?:boolean}} o
 * @returns {Promise<string|null>}
 */
// extra：搜索框旁边的一个按钮（例如「取消归属」），点了就返回它的 value
async function pickName({ title, items, current = null, search, extra = null } = {}) {
  const useSearch = search ?? true;
  const q0 = useSearch ? `<input class="pa-input pa-npick-q" style="${FIELD_STYLE}" type="text" inputmode="search" enterkeyhint="search" autocorrect="off" spellcheck="false" placeholder="搜索" autocapitalize="off" autocomplete="off">` : "";
  const ex = extra ? `<button class="pa-btn pa-btn-s pa-npick-extra${extra.value === current ? " on" : ""}" type="button" data-v="${esc(extra.value)}">${esc(extra.label)}</button>` : "";
  const body = el(`<div class="pa-npick" style="${LIST_STYLE}">${ex ? `<div class="pa-npick-top" style="${LIST_STYLE}">${q0}${ex}</div>` : q0}<div class="pa-npick-list" style="${LIST_STYLE}" role="listbox"></div></div>`);
  const q = body.querySelector(".pa-npick-q");
  const box = body.querySelector(".pa-npick-list");
  let picked = null;
  const paint = () => {
    const k = (q?.value || "").trim().toLowerCase();
    const hits = items.filter((it) => !k || String(it.label ?? it.value).toLowerCase().includes(k) || String(it.sub || "").toLowerCase().includes(k));
    box.innerHTML = hits.map((it) => `<button class="pa-npick-item${it.value === current ? " on" : ""}" style="${ROW_STYLE}" data-v="${esc(it.value)}" role="option" aria-selected="${it.value === current}"><span>${esc(it.label ?? it.value)}</span>${it.sub ? `<small>${esc(it.sub)}</small>` : ""}</button>`).join("") || '<p class="pa-hint">没有匹配的</p>';
  };
  onSearchInput(q, () => paint(), items.length > 150 ? 120 : 0);
  paint();
  // 2.5.0 几个固定选项（不带搜索）贴着按钮弹出；带搜索的长列表固定高度，只滚列表
  const anchor = recentAnchor();
  const pop = !useSearch && items.length <= 9 && !!anchor;
  await sheet({ title, body, noFocus: true, actions: [], place: pop ? "pop" : "", anchor, cls: !pop ? `pa-sheet-picker${items.length > 10 ? " pa-sheet-tall" : ""}` : "", onMount: (w) => {
    body.querySelector(".pa-npick-extra")?.addEventListener("click", (e) => {
      picked = e.currentTarget.dataset.v;
      w.querySelector(".pa-sheet-x").click();
    });
    box.addEventListener("click", (e) => {
      const b = e.target.closest("[data-v]");
      if (!b) return;
      picked = b.dataset.v;
      w.querySelector(".pa-sheet-x").click();
    });
    scrollToView(box.querySelector(".on"));
  } });
  return picked;
}

// 按钮的 HTML：名称过长时省略，整名放在 title 里
function nameBtnHtml(name, cls = "", placeholder = "请选择") {
  return `<button class="pa-namebtn ${cls}" type="button" title="${esc(name || "")}"><span>${esc(name || placeholder)}</span><i aria-hidden="true">▾</i></button>`;
}

// use：显示「切换」按钮，在酒馆中切换到选中的预设（2.11.7）
function presetPicker(slot, onPick, { label = "预设", use = false } = {}) {
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
    const v = await pickName({ title: label ? `选择${label}` : "选择预设", current: current2, items: listPresets().map((n) => ({ value: n, sub: n === using ? "使用中" : "" })) });
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
