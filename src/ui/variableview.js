// 变量顺序与现状：只在「预设 → 变量」页显示
function variableForm(d) {
  let snapshot = null;
  const body = el(`<div class="pa-form">
    <div class="pa-toolbar pa-rcheck"><button class="pa-btn" data-vf="refresh">刷新顺序检查</button><button class="pa-btn" data-vf="snapshot">读取当前变量状态</button>${tip(`按「${esc(d.name)}」的预设列表顺序检查先读后写、清空后读取和未读即覆盖。这里只做风险检查，不移动条目、不执行宏。酒馆可能重排提示词；脚本、条件、深度插入、对象/数组键和其他扩展变量需另行核对。`)}</div>
    <div class="pa-rcheck"><label class="pa-field-row"><input type="checkbox" data-vf="watch" ${settings().variableWatch ? "checked" : ""}>记录生成前后变量变化</label>${tip("状态只包含变量名、是否为空及类型，不保存正文。生成前后对比仅保留在本页内存中，默认关闭；不是每一次宏调用的执行追踪。")}</div>
    <div data-vf="result" aria-live="polite"></div></div>`);
  const result = body.querySelector('[data-vf="result"]');
  function render() { d.withReadIndex(renderIndexed); }
  function renderIndexed() {
    const report = memoByDraft(d, "varflow", () => auditVariableFlow(d)), nm = (id) => esc(d.prompt(id)?.name || id);
    let html = `<p class="pa-p">发现 ${report.issues.length} 项顺序风险，${report.unknown.length} 个条目需运行时核对。</p>`;
    if (report.issues.length) html += `<ul class="pa-notes">${report.issues.map((i) => `<li><b>${i.scope === "global" ? "全局" : "聊天"}变量「${esc(i.name)}」</b>：${esc(i.text)}<br><small>${i.ids.map(nm).join(" → ")}</small></li>`).join("")}</ul>`;
    if (report.unknown.length) html += `<details class="pa-card"><summary>未推演的条目（${report.unknown.length}）</summary><ul class="pa-notes">${report.unknown.map((i) => `<li>「${nm(i.id)}」：${esc(i.reasons.join("；"))}</li>`).join("")}</ul></details>`;
    html += `<details class="pa-card"><summary>可见变量操作顺序（${report.events.length}）</summary><ol class="pa-notes">${report.events.map((e) => `<li>「${nm(e.id)}」：${esc(e.op)} · ${e.scope === "global" ? "全局" : "聊天"}变量「${esc(e.name)}」</li>`).join("")}</ol></details>`;
    if (snapshot) {
      if (snapshot.key !== variableContextKey() || d.name !== currentPresetName()) {
        html += '<p class="pa-warn">已切换聊天或预设，请重新读取变量状态。</p>';
      } else {
        const keys = new Map(report.events.map((e) => [variableIdentity(e.scope, e.name), e]));
        for (const [key, row] of snapshot.rows) if (!keys.has(key)) keys.set(key, row);
        html += `<h3 class="pa-h">当前状态（${esc(new Date(snapshot.at).toLocaleTimeString())}）</h3><ul class="pa-notes">${[...keys].map(([key, e]) => {
          const row = snapshot.rows.get(key);
          const status = !snapshot.available[e.scope] ? "当前接口不可读取" : !row ? "当前不存在" : `${row.empty ? "空值" : "有值"} · ${row.type}${row.size == null ? "" : ` · ${row.size} 字符`}`;
          return `<li>${e.scope === "global" ? "全局" : "聊天"}变量「${esc(e.name)}」：${esc(status)}</li>`;
        }).join("") || "<li>没有可显示的变量</li>"}</ul><p class="pa-hint">快照是当前状态；先读后写可能有意读取上一轮的值，不能据此自动调整顺序。</p>`;
      }
    }
    const record = variableObservations.get(variableContextKey());
    if (record && d.name === currentPresetName()) html += `<details class="pa-card"><summary>最近一次生成前后变化（${record.changes?.length || 0}，${esc(record.phase)}）</summary><ul class="pa-notes">${(record.changes || []).map((x) => `<li>${x.scope === "global" ? "全局" : "聊天"}变量「${esc(x.name)}」：${esc(x.kind)}${x.empty === true ? "，当前为空" : ""}</li>`).join("") || "<li>未发现状态变化</li>"}</ul></details>`;
    result.innerHTML = html;
  }
  body.addEventListener("click", (e) => {
    if (e.target.closest('[data-vf="snapshot"]')) {
      if (d.name !== currentPresetName()) return toast("只能读取酒馆当前使用中预设的聊天变量，请先切换预设", "warning");
      snapshot = captureVariableSnapshot();
    } else if (!e.target.closest('[data-vf="refresh"]')) return;
    render();
  });
  body.querySelector('[data-vf="watch"]').addEventListener("change", (e) => {
    settings().variableWatch = e.target.checked;
    if (!e.target.checked) { variableObservations.clear(); variableWatchPending = null; }
    saveSettings(); render();
  });
  render();
  return { body, render, name: d.name };
}
function mountVariables(page) {
  page.innerHTML = '<div class="pa-toolbar"><div class="pa-picker-slot"></div></div><div class="pa-scroll pa-varpage"></div>';
  const box = page.querySelector(".pa-varpage");
  const picker = presetPicker(page.querySelector(".pa-picker-slot"), (n) => setFocusPreset(n));
  let form = null, shownDraft = null;
  function render() {
    const name = focusPreset();
    picker.set(name);
    let d;
    try { d = name && getDraft(name); } catch (e) { d = null; }
    if (!d) {
      form = shownDraft = null;
      box.innerHTML = '<p class="pa-empty">酒馆尚未选择预设。</p>';
      return;
    }
    if (form && shownDraft === d) return form.render();
    shownDraft = d;
    form = variableForm(d);
    box.replaceChildren(form.body);
  }
  const off = onDraftChange((name, kind) => {
    if (draftViewVisible(page) && (kind === "focus" || name === focusPreset())) render();
  });
  return { render: () => { picker.refresh(); render(); }, destroy: off };
}
