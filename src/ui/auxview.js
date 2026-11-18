// 2.11.23 连接 → 副 API：每种用途一行，左边写用途和用在哪，右边是用的站点和模型，点这一行换；
// 闪电发一句 Hi 试试这个 API 能不能用。站点就是「主 API」里的站点，不另存网址和密钥。
function mountAux(page, { show: go } = {}) {
  page.innerHTML = '<div class="pa-scroll pa-plan pa-aux"></div>';
  const box = page.firstElementChild;
  // 测试结果：用途 → { label, ok, text }；换了站点或模型就不再显示旧结果
  const tests = new Map();
  const busy = new Set();
  function row(u) {
    const t = auxTarget(u.key);
    const label = auxLabel(t);
    const res = tests.get(u.key);
    const value = t.follow
      ? `<b>跟随主 API</b><small>${esc(t.model || "酒馆当前连接")}</small>`
      : `<b>${esc(t.name)}</b><small>${esc(t.model || "未选模型")}</small>`;
    return `<div class="pa-aux-row" data-use="${u.key}">
        <button class="pa-aux-pick" type="button" data-a="pick" aria-label="${esc(`${u.label}：${label}，点按更换`)}">
          <span class="pa-aux-k"><b>${esc(u.label)}</b><small>${esc(u.where)}</small></span>
          <span class="pa-aux-v">${value}</span>
          <span class="pa-aux-caret" aria-hidden="true">${ICON.caret}</span>
        </button>
        <button class="pa-icon-btn pa-aux-test${busy.has(u.key) ? " pa-busy" : ""}" type="button" data-a="test" aria-label="测试${esc(u.label)}用的 API" title="发一句 Hi，看能不能用"${busy.has(u.key) ? " disabled" : ""}>${ICON.bolt}</button>
        ${t.missing ? '<p class="pa-live-res bad">选过的站点已删除，现在跟随主 API</p>' : ""}
        ${res && res.label === label ? `<p class="pa-live-res ${res.ok ? "ok" : "bad"}"${res.raw ? ` title="${esc(res.raw)}"` : ""}>${res.ok ? RES_OK : RES_BAD}${esc(res.text)}</p>` : ""}
      </div>`;
  }
  function render() {
    const n = (settings().sites || []).filter((x) => SOURCES[x.source]).length;
    box.innerHTML = `
      <p class="pa-aux-lead">麦当劳自己的 AI 功能用哪个 API。选了站点，这些请求用站点的密钥和模型发出，酒馆的连接不变，聊天照常用主 API。</p>
      <div class="pa-card pa-aux-list">${AUX_USES.map(row).join("")}</div>
      <p class="pa-hint">推荐用便宜、快的模型，如 DeepSeek Flash、豆包。${n ? "" : "还没有站点。"}火山方舟、硅基流动等在「主 API」的站点里点 ＋ 添加，类型选「自定义」，填网址和密钥。</p>
      <button class="pa-link pa-aux-add" type="button" data-a="add">去添加站点</button>`;
  }
  async function choose(use) {
    const u = AUX_USES.find((x) => x.key === use);
    const cur = auxChoice(use);
    const live = auxLiveModel();
    const list = (settings().sites || []).filter((x) => SOURCES[x.source]);
    const items = [{ value: "", label: "跟随主 API", sub: `酒馆当前连接${live ? ` · ${live}` : ""}` },
      ...list.map((s) => ({ value: s.id, label: s.name || "站点", sub: siteMulti(s) ? `${s.keys.length} 个分组` : s.model || s.url || "" })),
      { value: "\u0002add", label: "＋ 添加站点", sub: "到「主 API」添加" }];
    const v = await pickName({ title: `${u.label}用哪个 API`, items, current: cur && list.some((s) => s.id === cur.siteId) ? cur.siteId : "", search: items.length > 9 });
    if (v === null) return;
    if (v === "\u0002add") return addSite();
    if (v === "") {
      if (!cur) return;
      delete auxSettings()[use];
      saveSettings();
      return toast(`${u.label}改为跟随主 API`, "success");
    }
    const site = list.find((s) => s.id === v);
    if (!site) return;
    let keyId, model;
    const same = cur?.siteId === site.id;
    if (siteMulti(site)) {
      const r = await pickKeyModel(site, { keyId: same ? cur.keyId : site.keyId, model: same ? cur.model : siteKey(site).model }, { title: `选择模型 · ${site.name}` });
      if (!r) return;
      keyId = r.keyId;
      model = r.model;
    } else {
      const models = [...new Set([...site.models || [], site.model].filter(Boolean))];
      const was = same && cur.model || site.model || "";
      if (models.length > 1) {
        model = await pickModel(models, was, { title: `选择模型 · ${site.name}`, site });
        if (!model) return;
      } else model = models[0] || await promptBox(`填写「${site.name}」的模型名`, was, "如 deepseek-v4-flash");
      if (!model) return toast("没有选模型，未更改", "warning");
    }
    auxSettings()[use] = { siteId: site.id, ...keyId ? { keyId } : {}, model: String(model).trim() };
    saveSettings();
    toast(`${u.label}改用「${auxLabel(auxTarget(use))}」`, "success");
  }
  function addSite() {
    go?.("conn");
    setTimeout(() => rootEl?.querySelector('[data-page="conn"] [data-a="new"]')?.click(), 0);
  }
  async function test(use) {
    if (busy.has(use)) return;
    busy.add(use);
    render();
    const label = auxLabel(auxTarget(use));
    const t0 = performance.now();
    try {
      await auxRequest(use, [{ role: "user", content: "Hi" }], { maxTokens: 60, timeout: 6e4 });
      tests.set(use, { label, ok: true, text: `可用 · ${((performance.now() - t0) / 1e3).toFixed(1)} 秒` });
    } catch (e) {
      tests.set(use, { label, ok: false, text: e.why || e.message, raw: e.raw || "" });
    } finally {
      busy.delete(use);
      render();
    }
  }
  box.addEventListener("click", async (e) => {
    const a = e.target.closest("[data-a]")?.dataset.a;
    if (a === "add") return addSite();
    const use = e.target.closest("[data-use]")?.dataset.use;
    if (!use) return;
    if (a === "pick") {
      await choose(use);
      return render();
    }
    if (a === "test") return test(use);
  });
  return { render };
}
