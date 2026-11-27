// 变量顺序与现状：只在「预设 → 变量」页显示
var VAR_STEP = { set: "赋值", clear: "清空", delete: "删除", get: "读取", reset: "再次赋值" };
var VAR_KIND = { cleared: "清空后读取", "read-before-write": "先读后写", overwritten: "未读即覆盖" };
// 2.12.20 左栏顺序诊断、右栏实时聊天变量；宽于 900px 时并排。进入页面、换预设时已自动检查，不再有「刷新顺序检查」
function variableForm(d) {
  let snapshot = null, liveOpen = true;
  const body = el(`<div class="pa-form pa-varform"><div class="pa-vargrid" data-vf="result" aria-live="polite"></div></div>`);
  const result = body.querySelector('[data-vf="result"]');
  let fixes = [];
  function render() { d.withReadIndex(renderIndexed); }
  function renderIndexed() {
    const notCur = d.name !== currentPresetName();
    const report = memoByDraft(d, "varflow", () => auditVariableFlow(d)), nm = (id) => esc(d.prompt(id)?.name || id);
    // 2.12.8 每一步写明哪条条目做了什么；清空后读取写一句改法，赋值那条整条只写这个变量时给一键挪动（planClearedFix）
    fixes = report.issues.map((i) => planClearedFix(d, i, report.events));
    const stepLabel = (i, x) => x.op === "get" ? (i.kind === "cleared" ? "读取为空" : "读取") : x.op === "clear" ? "被清空" : x.op === "delete" ? "被删除" : VAR_STEP[x.op] || "";
    const hit = (i, x, k) => i.kind === "cleared" ? x.op !== "set" : k === i.steps.length - 1;
    const trail = (i) => `<ol class="pa-var-trail">${i.steps.map((x, k) => `<li${hit(i, x, k) ? ' class="is-hit"' : ""}><span class="pa-vt-name">「${nm(x.id)}」</span><span class="pa-vt-op">${esc(stepLabel(i, x))}</span></li>`).join("")}</ol>`;
    const advice = (i, fs, k) => {
      if (i.kind !== "cleared") return "";
      const [a, b, c] = i.steps.length === 3 ? i.steps : [null, ...i.steps];
      const mv = fs.find((f) => f.kind === "move");
      const move = mv ? `把「${nm(mv.id)}」挪到${esc(mv.to)}` : a ? `把「${nm(a.id)}」挪到「${nm(b.id)}」和「${nm(c.id)}」之间` : `在「${nm(c.id)}」之前赋值`;
      const btns = fs.map((f, j) => `<button class="pa-btn pa-btn-s" data-vf="fix" data-i="${k}" data-j="${j}" type="button">${esc(f.label)}</button>`).join("");
      return `<p class="pa-var-fix">改法：${move}，或在「${nm(b.id)}」里去掉对「${esc(i.name)}」的清空</p>${btns ? `<div class="pa-var-fixbtns">${btns}</div>` : ""}`;
    };
    const card = (i, k) => `<article class="pa-card pa-var-issue">
        <header class="pa-var-ihead"><span class="pa-var-iname"><code>${esc(i.name)}</code><small>${i.scope === "global" ? "全局变量" : "聊天变量"}</small></span><span class="pa-var-ikind">${esc(VAR_KIND[i.kind] || "顺序风险")}</span></header>
        <p class="pa-var-itext">${esc(i.text)}</p>${trail(i)}${advice(i, fixes[k], k)}</article>`;
    let left = `<section class="pa-vcol pa-vcol-flow"><div class="pa-vcol-head"><h3 class="pa-h">顺序诊断</h3>${tip(`按「${esc(d.name)}」的预设列表顺序检查先读后写、清空后读取和未读即覆盖。酒馆可能重排提示词；脚本、条件、深度插入、对象/数组键和其他扩展变量需另行核对。`, "")}</div>
      <p class="pa-p">发现 ${report.issues.length} 项顺序风险，${report.unknown.length} 个条目需运行时核对。</p>`;
    left += report.issues.map(card).join("");
    if (report.unknown.length) left += `<details class="pa-card pa-breathe"><summary>未推演的条目（${report.unknown.length}）</summary><div class="pa-details-body"><ul class="pa-notes">${report.unknown.map((i) => `<li>「${nm(i.id)}」：${esc(i.reasons.join("；"))}</li>`).join("")}</ul></div></details>`;
    left += `<details class="pa-card pa-breathe"><summary>可见变量操作顺序（${report.events.length}）</summary><div class="pa-details-body"><ol class="pa-notes">${report.events.map((e) => `<li>「${nm(e.id)}」：${esc(e.op)} · ${e.scope === "global" ? "全局" : "聊天"}变量「${esc(e.name)}」</li>`).join("")}</ol></div></details></section>`;
    let rows = "";
    if (snapshot && (snapshot.key !== variableContextKey() || d.name !== currentPresetName())) rows = '<p class="pa-warn pa-var-stale">已切换聊天或预设，请重新读取。</p>';
    else if (snapshot) {
      const keys = new Map(report.events.map((e) => [variableIdentity(e.scope, e.name), e]));
      for (const [key, row] of snapshot.rows) if (!keys.has(key)) keys.set(key, row);
      const listHtml = `<ul class="pa-var-rows">${[...keys].map(([key, e]) => {
        const row = snapshot.rows.get(key);
        const status = !snapshot.available[e.scope] ? "接口不可读取" : !row ? "不存在" : row.empty ? "空值" : `有值${row.size == null ? "" : ` · ${row.size} 字`}`;
        const cls = row && !row.empty ? "is-on" : "";
        return `<li><span class="pa-var-rk"><code>${esc(e.name)}</code><small>${e.scope === "global" ? "全局" : "聊天"}${row?.type ? ` · ${esc(row.type)}` : ""}</small></span><span class="pa-var-rv ${cls}">${esc(status)}</span></li>`;
      }).join("") || "<li><span class=\"pa-var-rk\">没有可显示的变量</span></li>"}</ul>`;
      const lid = accId("varlive");
      rows = `<div class="pa-var-atrow"><p class="pa-hint pa-var-at">${esc(new Date(snapshot.at).toLocaleTimeString())} 读取 · 共 ${keys.size} 项</p><button type="button" class="pa-link pa-var-fold" data-vf="fold" aria-expanded="${liveOpen}" aria-controls="${lid}">${liveOpen ? "收起" : "展开"}${CARET_SVG}</button></div>${accBox(listHtml, liveOpen, lid)}`;
    } else rows = `<p class="pa-hint pa-var-empty">${notCur ? "读取变量状态只对酒馆正在用的预设有效。点上方「切换」改用这个预设后再读。" : "点「读取当前值」查看本聊天里这些变量现在有没有值。"}</p>`;
    const record = variableObservations.get(variableContextKey());
    const rec = record && d.name === currentPresetName() ? `<details class="pa-card pa-breathe"><summary>最近一次生成前后变化（${record.changes?.length || 0}，${esc(record.phase)}）</summary><div class="pa-details-body"><ul class="pa-notes">${(record.changes || []).map((x) => `<li>${x.scope === "global" ? "全局" : "聊天"}变量「${esc(x.name)}」：${esc(x.kind)}${x.empty === true ? "，当前为空" : ""}</li>`).join("") || "<li>未发现状态变化</li>"}</ul></div></details>` : "";
    const right = `<section class="pa-vcol pa-vcol-live"><div class="pa-vcol-head"><h3 class="pa-h">实时聊天变量</h3><button class="pa-btn pa-btn-s" data-vf="snapshot" type="button"${notCur ? " disabled" : ""}>读取当前值</button></div>
      <p class="pa-hint pa-vf-why"${notCur ? "" : " hidden"}>不是酒馆正在用的预设，不能读取。</p>
      <div class="pa-card pa-var-live">${rows}</div>${rec}
      <div class="pa-card pa-setrow pa-var-watch"><span class="pa-var-wt"><b>记录生成前后变化</b><small>只记变量名、是否为空和类型，不存正文；只留在本页内存</small></span><label class="pa-switch"><input type="checkbox" data-vf="watch" aria-label="记录生成前后变化" ${settings().variableWatch ? "checked" : ""}><i></i></label></div></section>`;
    result.innerHTML = left + right;
  }
  body.addEventListener("click", (e) => {
    const fixBtn = e.target.closest('[data-vf="fix"]');
    if (fixBtn) {
      const f = fixes[Number(fixBtn.dataset.i)]?.[Number(fixBtn.dataset.j)];
      if (!f) return;
      const name = d.prompt(f.id)?.name || f.id;
      if (f.kind === "move") mutate(d, `挪动「${name}」`, (x) => x.place([f.id], f.where, f.gid));
      else mutate(d, `去掉「${name}」里的清空`, (x) => { x.prompt(f.id).content = f.content; });
      toast(`已${f.label}，可撤销`, "success");
      return render();
    }
    const foldBtn = e.target.closest('[data-vf="fold"]');
    if (foldBtn) {
      liveOpen = !liveOpen;
      const acc = body.querySelector(".pa-var-live .pa-acc[data-acc]");
      accSet(acc, liveOpen, foldBtn);
      const t = foldBtn.firstChild;
      if (t && t.nodeType === 3) t.nodeValue = liveOpen ? "收起" : "展开";
      return;
    }
    if (!e.target.closest('[data-vf="snapshot"]')) return;
    if (d.name !== currentPresetName()) return toast("只能读取酒馆当前使用中预设的聊天变量，请先切换预设", "warning");
    snapshot = captureVariableSnapshot();
    liveOpen = true;
    render();
  });
  body.addEventListener("change", (e) => {
    if (!e.target.matches('[data-vf="watch"]')) return;
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
  const picker = presetPicker(page.querySelector(".pa-picker-slot"), (n) => setFocusPreset(n), { use: true });
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
