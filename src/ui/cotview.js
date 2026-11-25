var LEVEL = {
  var: ["pa-lv-ok", "变量读到"],
  chain: ["pa-lv-ok", "间接读到"],
  mention: ["pa-lv-maybe", "文字提及"],
  none: ["pa-lv-none", "未提及"]
};
async function repairAllVariables(d, manual = {}) {
  const version = JSON.stringify(d.toPreset());
  const work = new Draft(d.name, d.toPreset());
  const normalized = applyWrapperNormalization(work);
  const issues = analyze(work, manual).issues.filter((i) => i.kind === "dead" || i.kind === "cotfrag");
  const keys = [...new Set(issues.map((i) => i.varName))];
  const plans = [], skipped = [];
  for (const key of keys) {
    try { plans.push(variableRepairPlan(work, key, manual)); }
    catch (e) { skipped.push({ key, reason: e.message }); }
  }
  if (!keys.length && !normalized.length) return toast("未发现可自动补读的变量");
  const byAnchor = new Map();
  for (const plan of plans) {
    if (!byAnchor.has(plan.last)) byAnchor.set(plan.last, []);
    byAnchor.get(plan.last).push(plan);
  }
  const nm = (id) => esc(work.prompt(id)?.name || id);
  // 先列出要改什么，确认后再改
  const can = plans.length || normalized.length;
  const body = el(`<div>
    ${normalized.length ? `<h3 class="pa-h">整理外层包裹（${normalized.length}）</h3><ul class="pa-notes">${normalized.map((x) => `<li>「${nm(x.id)}」去掉没人读取的外层 {{setvar::${esc(x.outer.name)}}}，保留里面的写入</li>`).join("")}</ul>` : ""}
    ${byAnchor.size ? `<h3 class="pa-h">新增读取条目（${byAnchor.size}）</h3><ul class="pa-notes">${[...byAnchor].map(([last, list]) => `<li>在「${nm(last)}」之后新增「变量读取 · ${esc(list.map((p) => p.name).join("、"))}」，正文：${esc(list.map((p) => p.macro).join(" "))}</li>`).join("")}</ul>` : ""}
    ${skipped.length ? `<h3 class="pa-h">不自动修改，需人工核对（${skipped.length}）</h3>${skipped.map((x) => `<div class="pa-card"><b>${esc(x.key)}</b><p>${esc(x.reason)}</p></div>`).join("")}` : ""}
    <p class="pa-hint">仅补缺失的读取、整理可确认的多余包裹。计数、思维链片段、脚本/条件和执行顺序需人工核对。修改后可在页头撤销。</p></div>`);
  const ok = await sheet({ title: "修复变量问题", place: "center", body, wide: true, noFocus: true, actions: can ? [{ label: "取消", value: false }, { label: "修改", kind: "primary", value: true }] : [{ label: "知道了", kind: "primary", value: false }] });
  if (!ok) return;
  if (JSON.stringify(d.toPreset()) !== version) return toast("预设已变化，请重新打开修复方案", "warning");
  mutate(d, "修复变量问题", (x) => {
    applyWrapperNormalization(x);
    for (const [last, list] of byAnchor) {
      x.insertPrompts([{ prompt: {
        identifier: uid(), name: "变量读取 · " + list.map((p) => p.name).join("、"),
        content: list.map((p) => p.macro).join("\n"), role: "system",
        system_prompt: false, marker: false, injection_position: 0, injection_depth: 4, injection_order: 100
      }, enabled: true }], { after: last }, x.groupOf(last));
    }
  });
  toast(`已修改：整理包裹 ${normalized.length} 个，新增读取 ${byAnchor.size} 条`, "success");
}

async function hookExistingDialog(d, id) {
  const p = d.prompt(id);
  if (!p) return;
  const gid = d.groupOf(id);
  const plan0 = planHook(d, { after: id }, gid, { content: p.content, name: p.name, selfId: id });
  if (plan0.status !== "hook") {
    await sheet({ place: "center", title: p.name, body: `<p class="pa-p">${esc(plan0.text)}</p>`, actions: [{ label: "确定", value: true }] });
    return;
  }
  const initId = findInitEntry(d);
  const cotName = esc(d.prompt(plan0.cotId)?.name || "");
  let how;
  if (plan0.mode === "text") how = `<label class="pa-field"><span>在「${cotName}」中添加一行</span><input class="pa-input" data-h="q" value="${esc(plan0.question)}"></label>
      <p class="pa-hint">${plan0.needle ? `添加在提到 ${esc(plan0.needle)} 的一行之后` : "添加在思维链末尾"}。条目正文不变。</p>`;
  else if (plan0.mode === "append") how = `<label class="pa-field"><span>追加的内容</span><input class="pa-input" data-h="q" value="${esc(plan0.question)}"></label>
      <p class="pa-hint">「${esc(p.name)}」末尾添加 {{addvar::${esc(plan0.varName)}::内容}}。思维链已读取该变量，不改动。</p>`;
  else how = `<label class="pa-field"><span>问句变量</span><input class="pa-input" data-h="v" value="${esc(plan0.varName)}"></label>
      <label class="pa-field"><span>思维链中的问句</span><input class="pa-input" data-h="q" value="${esc(plan0.question)}"></label>
      <p class="pa-hint">「${esc(p.name)}」末尾添加 {{setvar::变量::问句}}；${initId ? `「${esc(d.prompt(initId)?.name)}」中添加一行清空` : "未找到初始化条目，不添加清空"}；「${cotName}」中${plan0.anchorVar ? `在 {{getvar::${esc(plan0.anchorVar)}}} 之后` : ""}添加一行读取。${plan0.removeRange ? "沿用条目里原有的问句。" : ""}</p>`;
  const body = el(`<div class="pa-form"><p class="pa-p">${esc(plan0.text)}。</p>${(plan0.warns || []).map((w) => `<p class="pa-warn">${esc(w)}</p>`).join("")}${how}</div>`);
  // 2.11.19 思维链靠文字提及时，也可改用变量接入
  const alt = plan0.mode === "text" ? [{ label: "用变量接入", value: "var" }] : [];
  const ok = await sheet({ title: `将「${p.name}」接入思维链`, place: "center", body, wide: true, actions: [{ label: "取消", value: null }, ...alt, { label: "接入", kind: "primary", value: (w) => ({ v: (w.querySelector("[data-h=v]")?.value || "").replace(/[{}:：\s]/g, ""), q: (w.querySelector("[data-h=q]")?.value || "").trim() }) }] });
  if (ok === "var") return varHookDialog(d, id, { cotId: plan0.cotId });
  if (!ok) return;
  const plan = planHook(d, { after: id }, gid, { content: p.content, name: p.name, selfId: id }, { varName: ok.v && ok.v !== plan0.varName ? ok.v : void 0, question: ok.q || void 0 });
  if (plan.status !== "hook") return toast(plan.text);
  if (plan.clash) return toast(`变量「${plan.varName}」在预设中已有其他用途，请更换名称`, "warning");
  mutate(d, `接入思维链：${p.name}`, (x) => {
    const q = x.prompt(id);
    q.content = contentWithHook(q.content, plan);
    applyHook(x, plan);
  });
  toast(`已接入「${d.prompt(plan.cotId)?.name}」`, "success");
}
// 2.11.29 取消接入：列出要去掉的几处，确认后去掉，可在页头撤销
async function unhookDialog(d, id, manual = {}) {
  const p = d.prompt(id);
  const plan = p ? planUnhook(d, id, manual) : null;
  if (!plan) return toast("这一条不是用变量接入的，没有可去掉的读取", "warning");
  const nm = (x) => esc(d.prompt(x)?.name || x);
  const code = (t) => `<code>${esc(t.length > 64 ? `${t.slice(0, 60)}…}}` : t)}</code>`;
  const g = plan.scope === "global" ? "global" : "";
  const items = [`<li>「${nm(id)}」：去掉 ${plan.writes.map(code).join("、")}</li>`];
  if (plan.cotIds.length) items.push(`<li>${plan.cotIds.map((x) => `「${nm(x)}」`).join("")}：去掉读取 ${code(`{{get${g}var::${plan.name}}}`)}</li>`);
  if (plan.initId) items.push(`<li>「${nm(plan.initId)}」：去掉清空 ${code(`{{set${g}var::${plan.name}::}}`)}</li>`);
  const shared = plan.others.length ? `<p class="pa-hint">${plan.others.slice(0, 3).map((x) => `「${nm(x)}」`).join("")}${plan.others.length > 3 ? ` 等 ${plan.others.length} 条` : ""}也写入变量「${esc(plan.name)}」，思维链的读取和清空保留。</p>` : "";
  const ok = await sheet({ place: "center", title: `取消接入「${p.name}」`, body: `<ul class="pa-notes pa-unhook">${items.join("")}</ul>${shared}<p class="pa-hint">去掉后可在页头撤销。</p>`, actions: [{ label: "保留", value: false }, { label: "取消接入", kind: "danger", value: true }] });
  if (!ok) return;
  mutate(d, `取消接入思维链：${p.name}`, (x) => applyUnhook(x, plan));
  toast(`已取消接入「${p.name}」`, "success");
}
// 思维链各行做成「放在哪一行之后」的选项；值是插在第几行之前
function cotLineOptions(content) {
  const lines = String(content || "").split("\n");
  return `<option value="0">（最前面）</option>` + lines.map((l, i) => `<option value="${i + 1}">${i + 1}. ${esc(l.trim().slice(0, 40) || "（空行）")}</option>`).join("");
}
// 2.11.19 用变量接入：条目末尾写入问句变量，所选思维链在选定的行读取，初始化条目每轮清空（没有就在最前面新建）。
// 思维链已用变量读取附近条目时，沿用它的写法（多选一、追加、编号变量名、照邻居的问句）
async function varHookDialog(d, id, { cotId = null } = {}) {
  const p = d.prompt(id);
  if (!p) return;
  const version = JSON.stringify(d.toPreset());
  const gid = d.groupOf(id);
  const item = { content: p.content, name: p.name, selfId: id };
  const cotIds = analyze(d).cotIds.filter((x) => x !== id);
  // 变量名、问句改过就按填的来；没改过的跟着所选思维链和行重新生成
  const st = { cot: cotId && cotIds.includes(cotId) ? cotId : null, line: null, v: "", q: "", vTouched: false, qTouched: false };
  const planNow = () => planHook(d, { after: id }, gid, item, { viaVar: true, cotId: st.cot, line: st.line, varName: st.vTouched && st.v || void 0, question: st.qTouched && st.q || void 0 });
  let plan = planNow();
  if (plan.status !== "hook") {
    await sheet({ place: "center", title: p.name, body: `<p class="pa-p">${esc(plan.text)}</p>`, actions: [{ label: "确定", value: true }] });
    return;
  }
  st.cot = plan.cotId;
  const nm = (x) => esc(d.prompt(x)?.name || x);
  const body = el(`<div class="pa-form pa-varhook">
    <div data-k="head"></div>
    <label class="pa-field"><span>思维链</span><select class="pa-input" data-k="cot">${cotIds.map((x) => `<option value="${esc(x)}">${nm(x)}</option>`).join("")}</select></label>
    <label class="pa-field" data-own><span>放在哪一行之后</span><select class="pa-input" data-k="line"></select></label>
    <label class="pa-field" data-own><span>问句变量</span><input class="pa-input" data-h="v" name="varName" autocomplete="off" spellcheck="false" translate="no" aria-describedby="pa-err-varhook"><small class="pa-field-err" id="pa-err-varhook" data-k="verr" aria-live="polite" hidden></small></label>
    <label class="pa-field"><span>思维链中的问句</span><input class="pa-input" data-h="q" name="question" autocomplete="off"></label>
    <p class="pa-hint" data-k="how"></p>
    <details class="pa-card" open data-own><summary>加入后的思维链</summary><pre class="pa-pre" data-k="preview" translate="no"></pre></details></div>`);
  const $ = (sel) => body.querySelector(sel);
  const cotSel = $("[data-k=cot]"), lineSel = $("[data-k=line]"), vIn = $("[data-h=v]"), qIn = $("[data-h=q]"), verr = $("[data-k=verr]");
  const fillLines = () => { lineSel.innerHTML = cotLineOptions(d.prompt(st.cot)?.content); };
  const show = () => {
    const own = plan.mode === "own";
    const cotName = nm(plan.cotId);
    $("[data-k=head]").innerHTML = `<p class="pa-p">${esc(plan.text)}。</p>${(plan.warns || []).map((w) => `<p class="pa-warn">${esc(w)}</p>`).join("")}`;
    for (const x of body.querySelectorAll("[data-own]")) x.hidden = !own;
    if (!st.qTouched) qIn.value = plan.question;
    if (own) {
      if (!st.vTouched) vIn.value = plan.varName;
      lineSel.value = String(plan.line ?? 0);
      const g = plan.scope === "global" ? "global" : "";
      const macro = `{{get${g}var::${plan.varName}}}`;
      const lines = String(d.prompt(plan.cotId)?.content || "").split("\n");
      const at = Math.min(plan.line ?? lines.length, lines.length);
      $("[data-k=preview]").innerHTML = [...lines.slice(0, at).map(esc), `<mark>${esc(macro)}</mark>`, ...lines.slice(at).map(esc)].join("\n");
      const initId = findInitEntry(d);
      const init = plan.createInit ? "在最前面新增「变量初始化」，每轮清空该变量" : initId ? `「${nm(initId)}」中添加一行清空` : "";
      $("[data-k=how]").innerHTML = `「${esc(p.name)}」末尾添加 <code translate="no">{{set${g}var::${esc(plan.varName)}::问句}}</code>；${init ? init + "；" : ""}「${cotName}」${plan.line ? `第 ${plan.line} 行之后` : "最前面"}添加 <code translate="no">${esc(macro)}</code>${plan.cotIds?.length > 1 ? `（另有 ${plan.cotIds.length - 1} 个版本加在同一变量的读取之后）` : ""}。可在页头撤销。`;
    } else {
      const g = plan.scope === "global" ? "global" : "";
      $("[data-k=how]").innerHTML = `「${esc(p.name)}」末尾添加 <code translate="no">{{${plan.mode === "append" ? "add" : "set"}${g}var::${esc(plan.varName)}::问句}}</code>。「${cotName}」已读取该变量，不改动。可在页头撤销。`;
    }
  };
  cotSel.value = st.cot;
  fillLines();
  show();
  const replan = () => { plan = planNow(); show(); };
  cotSel.addEventListener("change", () => { st.cot = cotSel.value; st.line = null; fillLines(); replan(); });
  lineSel.addEventListener("change", () => { st.line = Number(lineSel.value); replan(); });
  const readInputs = () => {
    st.v = vIn.value.replace(/[{}:：\s]/g, "");
    st.q = qIn.value.trim();
  };
  vIn.addEventListener("input", () => { st.vTouched = true; verr.hidden = true; });
  vIn.addEventListener("change", () => { readInputs(); replan(); });
  qIn.addEventListener("input", () => { st.qTouched = true; });
  const check = () => {
    readInputs();
    plan = planNow();
    const bad = plan.mode === "own" && !st.v ? "填写变量名" : plan.clash ? `变量「${plan.varName}」在预设中已有其他用途，请换一个名称` : "";
    verr.textContent = bad;
    verr.hidden = !bad;
    if (bad) vIn.focus();
    return !bad;
  };
  const ok = await sheet({ title: `将「${p.name}」用变量接入思维链`, place: "center", body, wide: true, noFocus: true, guardDirty: true, actions: [{ label: "取消", value: false }, { label: "接入", kind: "primary", value: true, validate: check }] });
  if (!ok) return;
  if (JSON.stringify(d.toPreset()) !== version) return toast("预设已变化，请重新打开", "warning");
  let r = null;
  mutate(d, `用变量接入思维链：${p.name}`, (x) => {
    const q = x.prompt(id);
    q.content = contentWithHook(q.content, plan);
    r = applyHook(x, plan);
  });
  toast(`已用变量「${plan.varName}」接入「${d.prompt(plan.cotId)?.name}」${r?.initCreated ? "，并在最前面新增「变量初始化」" : ""}`, "success");
}
// 2.11.20 批量用变量接入：勾选多条（开着的、关着的都行），各写入一个问句变量，思维链在选定的行按预设顺序依次读取
async function batchVarHookDialog(d, cotId = null) {
  const a = analyze(d);
  if (!a.cotIds.length) return toast("未识别到开启的思维链，可在「手动指定思维链」中指定", "warning");
  const cands = varHookCandidates(d);
  if (!cands.length) {
    await sheet({ place: "center", title: "批量用变量接入", body: `<p class="pa-p">没有可接入的条目：其余条目已被思维链用变量读到，或是思维链、分隔等短条目。</p>`, actions: [{ label: "确定", value: true }] });
    return;
  }
  const version = JSON.stringify(d.toPreset());
  // 默认思维链：卡片上点的那条；从列表上方进来时，取文字提及最多的那条
  const mentionCot = (() => {
    const n = new Map();
    for (const c2 of a.coverage.values()) if (c2.level === "mention" && c2.cot) n.set(c2.cot, (n.get(c2.cot) || 0) + 1);
    return [...n].sort((x, y) => y[1] - x[1])[0]?.[0];
  })();
  const st = { cot: cotId && a.cotIds.includes(cotId) ? cotId : mentionCot || mainCotOf(d, a.cotIds), line: null, sel: new Set() };
  const nm = (x) => esc(d.prompt(x)?.name || x);
  // 按分组列出，组名一行可整组勾选
  const groups = [];
  const byKey = new Map();
  for (const c of cands) {
    const gid = d.groupOf(c.id) || "";
    if (!byKey.has(gid)) {
      byKey.set(gid, { gid, name: gid ? d.group(gid)?.name || "未命名分组" : "未分组", ids: [] });
      groups.push(byKey.get(gid));
    }
    byKey.get(gid).ids.push(c.id);
  }
  const candOf = new Map(cands.map((c) => [c.id, c]));
  const status = (c) => !c.active ? `<span class="pa-lv pa-lv-none">未开启</span>` : `<span class="pa-lv ${LEVEL[c.level]?.[0] || "pa-lv-none"}">${LEVEL[c.level]?.[1] || ""}</span>`;
  const body = el(`<div class="pa-form pa-varbatch">
    <p class="pa-p">勾选的条目各写入一个问句变量，思维链在选定的行按预设顺序依次读取。关着的条目，思维链里那一行为空，换着开也不用再改思维链。</p>
    <label class="pa-field"><span>思维链</span><select class="pa-input" data-k="cot">${a.cotIds.map((x) => `<option value="${esc(x)}">${nm(x)}</option>`).join("")}</select></label>
    <label class="pa-field"><span>放在哪一行之后</span><select class="pa-input" data-k="line"></select></label>
    <div class="pa-vb" role="group" aria-label="要接入的条目">${groups.map((g, gi) => `<div class="pa-vb-g">
      <label class="pa-vb-row pa-vb-ghead"><input type="checkbox" data-vg="${gi}" aria-label="整组勾选：${esc(g.name)}"><span class="pa-vb-name">${esc(g.name)}</span><small>${g.ids.length} 条</small></label>
      ${g.ids.map((id) => `<label class="pa-vb-row"><input type="checkbox" data-vid="${esc(id)}"><span class="pa-vb-name">${nm(id)}</span>${status(candOf.get(id))}</label>`).join("")}</div>`).join("")}</div>
    <div data-k="warns"></div>
    <p class="pa-hint" data-k="how"></p>
    <details class="pa-card" open><summary>加入后的思维链</summary><pre class="pa-pre" data-k="preview" translate="no"></pre></details></div>`);
  const $ = (sel) => body.querySelector(sel);
  const cotSel = $("[data-k=cot]"), lineSel = $("[data-k=line]");
  cotSel.value = st.cot;
  const fillLines = () => { lineSel.innerHTML = cotLineOptions(d.prompt(st.cot)?.content); };
  let batch = null;
  const paint = () => {
    batch = planVarHookBatch(d, [...st.sel], { cotId: st.cot, line: st.line });
    const own = batch.done.filter((x) => x.plan.mode === "own" && x.plan.cotId === st.cot);
    const at = Number.isInteger(batch.line) ? batch.line : hookLine(d, { cotId: st.cot }, st.line).line;
    lineSel.value = String(at);
    groups.forEach((g, gi) => {
      const box = body.querySelector(`[data-vg="${gi}"]`);
      const n = g.ids.filter((id) => st.sel.has(id)).length;
      box.checked = n === g.ids.length;
      box.indeterminate = n > 0 && n < g.ids.length;
    });
    // 同一句提醒（如排在思维链之后）合成一条，前面列出是哪几条
    const warns = new Map();
    for (const x of batch.done) for (const w of x.plan.warns || []) warns.set(w, [...(warns.get(w) || []), x.id]);
    for (const x of batch.skipped) warns.set(x.text, [...(warns.get(x.text) || []), x.id]);
    $("[data-k=warns]").innerHTML = [...warns].map(([w, ids]) => `<p class="pa-warn">${ids.map((id) => `「${nm(id)}」`).join("")}：${esc(w)}</p>`).join("");
    const lines = String(d.prompt(st.cot)?.content || "").split("\n");
    const pos = Math.min(at, lines.length);
    const macros = own.map((x) => `{{get${x.plan.scope === "global" ? "global" : ""}var::${x.plan.varName}}}`);
    $("[data-k=preview]").innerHTML = [...lines.slice(0, pos).map(esc), ...macros.map((m) => `<mark>${esc(m)}</mark>`), ...lines.slice(pos).map(esc)].join("\n");
    const others = batch.done.filter((x) => !own.includes(x));
    const initId = findInitEntry(d);
    const init = !own.length ? "" : own.some((x) => x.plan.createInit) ? "在最前面新增「变量初始化」，每轮清空这些变量；" : initId ? `「${nm(initId)}」中添加清空；` : "";
    $("[data-k=how]").innerHTML = !batch.done.length ? "勾选要接入的条目。" : `${own.length ? `${own.length} 条末尾各添加 <code translate="no">{{setvar::变量::问句}}</code>；${init}「${nm(st.cot)}」${at ? `第 ${at} 行之后` : "最前面"}添加 ${own.length} 行读取。` : ""}${others.map((x) => `「${nm(x.id)}」沿用变量「${esc(x.plan.varName)}」，思维链已读取。`).join("")}可在页头撤销。`;
    const ok = body.closest(".pa-sheet")?.querySelector(".pa-btn-primary");
    if (ok) {
      ok.disabled = !batch.done.length;
      ok.textContent = batch.done.length ? `接入 ${batch.done.length} 条` : "接入";
    }
  };
  fillLines();
  body.addEventListener("change", (e) => {
    const t = e.target;
    if (t === cotSel) { st.cot = cotSel.value; st.line = null; fillLines(); }
    else if (t === lineSel) st.line = Number(lineSel.value);
    else if (t.dataset.vid) t.checked ? st.sel.add(t.dataset.vid) : st.sel.delete(t.dataset.vid);
    else if (t.dataset.vg) {
      const g = groups[Number(t.dataset.vg)];
      for (const id of g.ids) t.checked ? st.sel.add(id) : st.sel.delete(id);
      for (const id of g.ids) { const b = body.querySelector(`[data-vid="${CSS.escape(id)}"]`); if (b) b.checked = t.checked; }
    } else return;
    paint();
  });
  const ok = await sheet({ title: "批量用变量接入", body, wide: true, noFocus: true, guardDirty: true, onMount: paint, actions: [{ label: "取消", value: false }, { label: "接入", kind: "primary", value: true, validate: () => !!batch?.done.length }] });
  if (!ok) return;
  if (JSON.stringify(d.toPreset()) !== version) return toast("预设已变化，请重新打开", "warning");
  let r = null;
  mutate(d, `批量用变量接入思维链（${batch.done.length} 条）`, (x) => { r = applyVarHookBatch(x, batch); });
  toast(`已用变量接入 ${r?.count ?? 0} 条到「${d.prompt(batch.cotId)?.name}」${r?.initCreated ? "，并在最前面新增「变量初始化」" : ""}`, "success");
}
function mountCot(page, app) {
  const st = { filter: "none" };
  page.innerHTML = `
        <div class="pa-toolbar"><div class="pa-picker-slot"></div><button class="pa-btn pa-btn-primary" data-repair-all title="修复变量问题">修复</button></div>
        <div class="pa-scroll pa-cot"></div>`;
  const box = page.querySelector(".pa-cot");
  const picker = presetPicker(page.querySelector(".pa-picker-slot"), (n) => setFocusPreset(n));
  // 2.7.7 变量检查只在「检查 → 变量」页，正文格式只在「检查 → 回复」页
  page.querySelector('[data-repair-all]').addEventListener('click', async () => {
    try { await repairAllVariables(getDraft(focusPreset()), manualFor(focusPreset())); }
    catch(err) { toast('修复失败：'+err.message,'error'); }
  });
  const manualFor = (name) => {
    const s = settings();
    if (!s.cotManual[name]) s.cotManual[name] = {};
    return s.cotManual[name];
  };
  function render() {
    let d;
    try {
      d = getDraft(focusPreset());
    } catch (e) {
      box.innerHTML = `<p class="pa-empty">${esc(e.message)}</p>`;
      return;
    }
    picker.set(d.name);
    // 2.7.8 分析结果按预设改动缓存（手动指定的思维链也算在缓存键里）；条目名查索引
    const manual = manualFor(d.name);
    const a = memoByDraft(d, "cot:" + JSON.stringify(manual || {}), () => analyze(d, manual));
    const names = new Map(d.preset.prompts.map((p) => [p.identifier, p.name]));
    const nm = (id) => esc(names.get(id) || id);
    const dead = a.issues.filter((i) => i.kind === "dead" || i.kind === "cotfrag");
    const counts = { var: 0, chain: 0, mention: 0, none: 0 };
    for (const c2 of a.coverage.values()) counts[c2.level]++;
    const cotVarReads = a.cot.reduce((n, c2) => n + c2.reads.length, 0);
    const okN = counts.var + counts.chain;
    const style = !a.cotIds.length ? "" : cotVarReads >= 3 && okN >= counts.mention ? "以变量读取为主" : cotVarReads >= 3 ? "变量读取与文字提及并用" : "以文字提及为主，不读取变量";
    page.querySelector("[data-repair-all]").disabled = !dead.length;
    // 2.5.0 结论就是「待核对」的标题，下面是要核对的条目，四个数字放在条目下面；没有问题时只留一行
    const styleLine = a.cotIds.length ? `思维链${style}` : "未识别到开启的思维链，可在下方手动指定";
    const info = `<button class="pa-why" type="button" data-tipbtn aria-label="说明" aria-expanded="false" title="说明">${INFO_ICON}</button>`;
    const legendNote = `<div class="pa-whynote" data-tipnote hidden><ul class="pa-legend">
                <li><span class="pa-lv pa-lv-ok">变量读到</span><span>思维链用 {{getvar}} 读取该条目写入的变量。</span></li>
                <li><span class="pa-lv pa-lv-maybe">文字提及</span><span>思维链写到该条目的名称或标签，也算接入；关掉条目后这句仍在思维链里。</span></li>
                <li><span class="pa-lv pa-lv-none">未提及</span><span>思维链没有写到该条目。规则、破限、格式类条目无需接入。</span></li>
                <li><span class="pa-lv pa-lv-none" style="color:var(--pa-warn)">待核对</span><span>内容存入变量后，没有开启的条目读取，未进入提示词。脚本、世界书和其他扩展的读取无法识别。</span></li>
                <li><span class="pa-lv pa-lv-term">修复范围</span><span>识别 setvar、getvar、addvar、incvar、decvar、hasvar 及全局写法。自动修复只补缺失的读取、整理缝合留下的多余包裹；计数、条件、脚本、读写顺序及 MVU、酒馆助手等变量系统需人工核对。</span></li>
                <li><span class="pa-lv pa-lv-term">加入思维链读取</span><span>用于思维链片段（变量名多以 cot 结尾）。在对应卡片上操作，可选思维链和插入行。</span></li>
                <li><span class="pa-lv pa-lv-term">接入思维链</span><span>位于页面底部「未提及」列表各条右侧。按本预设原有写法加入读取或提及，可撤销。</span></li>
                <li><span class="pa-lv pa-lv-term">用变量接入</span><span>位于「文字提及」各条右侧。条目末尾写入问句变量，思维链在选定的行读取，每轮清空；关掉条目后这一行为空。思维链不读变量也可以用。多条一起接入：点列表上方「批量用变量接入」或思维链卡片上的「接入条目」，关着的条目也能勾选。</span></li>
                <li><span class="pa-lv pa-lv-term">取消接入</span><span>位于「变量读到」各条右侧。去掉条目里写入问句变量的那句、思维链里读取它的那行、初始化条目里清空它的那行；其他条目也写这个变量时，只去掉这一条的写入。可撤销。</span></li>
                <li><span class="pa-lv pa-lv-term">手动指定思维链</span><span>思维链未被识别时手动指定；误判的，在该条下点「不是思维链」。</span></li>
            </ul></div>`;
    let deadHtml = "";
    if (dead.length) {
      // 一行写清是哪条、哪个变量、为什么；原因和操作收起，点开看
      for (const i of dead) {
        const vn = esc(i.varName.replace(/^全局:/, ""));
        const similar = (i.similar || []).map((k) => k.replace(/^全局:/, ""));
        // 写入方是思维链本身，或变量名以 cot 结尾：内容是思考步骤，要由思维链读，不能补成普通读取
        const forCot = i.kind === "cotfrag" || i.ids.every((id) => a.cotIds.includes(id));
        // 读它的是另一套关着的思维链时，不提供「开启」：会同时开两套思维链
        const offCot = forCot ? (i.readersOff || []).filter((id) => isCotEntry(d, id, manualFor(d.name))) : [];
        const offIds = (i.readersOff || []).filter((id) => !offCot.includes(id));
        const off = (i.readersOff || []).map((id) => `「${nm(id)}」`).join("");
        const tag = similar.length ? "名字对不上" : off ? "读取它的条目关着" : forCot ? "思维链没读" : "没有条目读取";
        const why = similar.length
          ? `写入的是「${vn}」，读取的是「${esc(similar.join("」「"))}」。酒馆变量名区分大小写和空格，不一致即读不到。`
          : forCot
            ? `该条把思考步骤存入变量「${vn}」，需由思维链中的 {{getvar::${vn}}} 取出。${off ? `读取它的 ${off} 未开启。` : "当前思维链没有这一句，模型思考时看不到。"}${offCot.length ? "那是另一套思维链，开启会导致两套并行，应在当前思维链中加入读取。" : "点「加入思维链读取」补上；不需要的可忽略。"}`
            : off
              ? `内容存入变量「${vn}」，读取它的 ${off} 未开启，未进入提示词。开启前核对原用途。`
              : `内容存入变量「${vn}」，没有开启的条目读取，未进入提示词。由脚本、世界书或其他扩展读取的，以实际发送的提示词为准。`;
        // 同一条目可能写多个变量：下方「变量读到/间接读到」说的是另一个变量，这里只说这一个
        const other = i.ids.filter((id) => ["var", "chain"].includes(a.coverage.get(id)?.level)).map((id) => `「${nm(id)}」经变量「${esc(String(a.coverage.get(id).via).split(" → ")[0].replace(/^全局:/, ""))}」已被思维链读到`);
        // 2.5.1 两行：条目名在上、原因胶囊固定在右边，变量名小字在下
        deadHtml += `<details class="pa-card pa-card-warn pa-dead"><summary><span class="pa-dead-main"><b class="pa-dead-name">${i.ids.map((id) => nm(id)).join("、")}</b><small class="pa-dead-var">变量「${vn}」</small></span><span class="pa-chip pa-chip-warn">${tag}</span></summary>
                    <p class="pa-hint">${why}</p>${other.length ? `<p class="pa-hint">${other.join("；")}，与本条不矛盾：本条指变量「${vn}」。</p>` : ""}
                    <div class="pa-card-act">${similar.length ? similar.map((k) => `<button class="pa-btn pa-btn-soft pa-btn-s" data-rename="${esc(i.varName)}" data-to="${esc((i.varName.startsWith("全局:") ? "全局:" : "") + k)}">改成「${esc(k)}」</button>`).join("") : ""}${offIds.length ? `<button class="pa-btn pa-btn-soft pa-btn-s" data-fix="${esc(offIds.join("|"))}">开启读取它的条目</button>` : ""}
                    ${forCot ? `<button class="pa-btn pa-btn-s" data-cotread="${esc(i.varName)}">加入思维链读取</button>` : `<button class="pa-btn pa-btn-s" data-repair="${esc(i.varName)}">查看修复方案</button>`}<button class="pa-link" data-goto="${esc(i.ids.join("|"))}">在预设页查看</button></div></details>`;
      }
    }
    // 2.5.0 标题和各项分开：标题一行不加框，每一项各自一个框
    let html = dead.length
      ? `<div class="pa-verdict-head">
            <div class="pa-verdict-top"><p><b>${dead.length} 项变量读取待核对</b><small class="pa-verdict-sub">${styleLine}</small></p>${info}</div>
            ${legendNote}
        </div>
        <div class="pa-cards pa-dead-list">${deadHtml}</div>`
      : `<div class="pa-verdict-line${a.cotIds.length ? " pa-good" : ""}"><div class="pa-verdict-top"><p>${a.cotIds.length ? "没有读取问题 · " : ""}${styleLine}</p>${info}</div>${legendNote}</div>`;
    html += `<div class="pa-cot-sum">
            <div><b>${a.cotIds.length}</b><span>思维链</span></div>
            <div><b>${okN}</b><span>变量读到</span></div>
            <div><b>${counts.mention}</b><span>文字提及</span></div>
            <div><b>${counts.none}</b><span>未提及</span></div>
        </div>
        ${a.openers.length > 1 ? `<div class="pa-card pa-card-warn"><b>同时开着 ${a.openers.length} 套思维链开头</b>
            <p class="pa-hint">${a.openers.map((id) => `「${nm(id)}」`).join("")}均以思考标签开头，模型会连写多套思考，篇幅变长、易爆思维链。通常只开一套，以条目名称或作者说明为准。</p>
            <div class="pa-card-act"><button class="pa-link" data-goto="${esc(a.openers.join("|"))}">在预设页查看</button></div></div>` : ""}`;
    html += `<div class="pa-row-head"><h3 class="pa-h">思维链读取的变量</h3><button class="pa-link" data-markpick="1">手动指定思维链</button></div>`;
    html += '<div class="pa-cards">';
    for (const c2 of a.cot) {
      const reads = c2.reads.map((r) => `<li><span class="pa-chip">${esc(r.name)}</span>${r.suppliers.length ? r.suppliers.map((s) => `<span class="pa-sup">${nm(s)}</span>`).join("") : '<span class="pa-sup pa-dim">无开启的选项（为空）</span>'}</li>`).join("");
      html += `<details class="pa-card"><summary><b>${nm(c2.id)}</b><small>${c2.reads.length ? `读取 ${c2.reads.length} 个变量` : "不读取变量（文字提及）"}</small></summary>
                ${reads ? `<ul class="pa-reads">${reads}</ul>` : ""}
                ${c2.mentions.length ? `<p class="pa-hint">文中出现的标签和英文词：${c2.mentions.slice(0, 12).map(esc).join("、")}</p>` : ""}
                <div class="pa-card-act"><button class="pa-btn pa-btn-soft pa-btn-s" data-cotpick="${esc(c2.id)}">接入条目</button><button class="pa-link" data-mark="${esc(c2.id)}" data-v="0">不是思维链</button></div></details>`;
    }
    html += "</div>";
    html += `<div class="pa-row-head"><h3 class="pa-h">开启条目与思维链的关联</h3>${a.cotIds.length ? `<button class="pa-link" data-batchhook="1">批量用变量接入</button>` : ""}</div>
            <p class="pa-hint">「未提及」不等于有问题。只需为文风、人设、玩法等重点条目接入思维链；接入越多，思考越长。</p>
            <div class="pa-seg pa-seg-s" role="tablist">
                ${[["none", `未提及 ${counts.none}`], ["mention", `文字提及 ${counts.mention}`], ["ok", `变量读到 ${counts.var + counts.chain}`], ["all", "全部"]].map(([k, l]) => `<button data-f="${k}" class="${st.filter === k ? "on" : ""}">${l}</button>`).join("")}
            </div>`;
    const groupsOrder = [];
    const byGroup = /* @__PURE__ */ new Map();
    for (const [id, c2] of a.coverage) {
      const ok = st.filter === "all" || (st.filter === "ok" ? c2.level === "var" || c2.level === "chain" : c2.level === st.filter);
      if (!ok) continue;
      const g = d.groupOf(id);
      const gname = g ? d.group(g)?.name : "未分组";
      if (!byGroup.has(gname)) {
        byGroup.set(gname, []);
        groupsOrder.push(gname);
      }
      byGroup.get(gname).push([id, c2]);
    }
    for (const gname of groupsOrder) {
      // 2.7.8 --n：行数；屏幕外的组跳过排版，按它占位（条目多时切到这一页不卡）
      html += `<div class="pa-cov-group" style="--n:${byGroup.get(gname).length}"><h4>${esc(gname)}</h4>`;
      for (const [id, c2] of byGroup.get(gname)) {
        const [cls, label] = LEVEL[c2.level];
        const via = c2.level === "none" ? "" : `${esc(c2.via)} → ${nm(c2.cot)}`;
        const act = c2.level === "none" ? `<button class="pa-btn pa-btn-soft pa-hookbtn" data-hook="${esc(id)}">接入思维链</button>`
          : c2.level === "mention" ? `<button class="pa-link" data-varhook="${esc(id)}" data-cot="${esc(c2.cot)}">用变量接入</button>`
          : c2.level === "var" ? `<button class="pa-link pa-unhookbtn" data-unhook="${esc(id)}">取消接入</button>` : "";
        html += `<div class="pa-cov"><span class="pa-lv ${cls}">${label}</span><span class="pa-cov-name">${nm(id)}</span>${via ? `<small>${via}</small>` : ""}${act}</div>`;
      }
      html += "</div>";
    }
    if (!groupsOrder.length) html += '<p class="pa-hint">无</p>';
    if (a.optional.length) {
      html += `<details class="pa-card pa-optional"><summary>思维链已预留、但没有开启选项的变量（${a.optional.length}）</summary>
                <ul class="pa-reads">${a.optional.map((o) => `<li><span class="pa-chip">${esc(o.varName)}</span>${o.ids.map((id) => `<span class="pa-sup">${nm(id)}</span>`).join("")}</li>`).join("")}</ul></details>`;
    }
    box.innerHTML = html;
  }
  const a0 = (d) => analyze(d, manualFor(d.name));
  box.addEventListener("click", async (e) => {
    const d = getDraft(focusPreset());
    if (e.target.closest("[data-repair-all]")) { try { await repairAllVariables(d, manualFor(d.name)); } catch(err) { toast("修复失败："+err.message,"error"); } return; }
    const repair = e.target.closest("[data-repair]");
    if (repair) { try { await repairVariableDialog(d, repair.dataset.repair, manualFor(d.name)); } catch(err) { toast(err.message, "error"); } return; }
    const cr = e.target.closest("[data-cotread]");
    if (cr) { try { await cotReadDialog(d, cr.dataset.cotread, manualFor(d.name)); } catch(err) { toast(err.message, "error"); } return; }
    const rn = e.target.closest("[data-rename]");
    if (rn) { try { await renameWritesDialog(d, rn.dataset.rename, rn.dataset.to); } catch(err) { toast(err.message, "error"); } return; }
    const hk = e.target.closest("[data-hook]");
    if (hk) { try { await hookExistingDialog(d, hk.dataset.hook); } catch(err) { toast("接入思维链失败：" + err.message, "error"); } return; }
    const uh = e.target.closest("[data-unhook]");
    if (uh) { try { await unhookDialog(d, uh.dataset.unhook, manualFor(d.name)); } catch(err) { toast("取消接入失败：" + err.message, "error"); } return; }
    const vh = e.target.closest("[data-varhook]");
    if (vh) { try { await varHookDialog(d, vh.dataset.varhook, { cotId: vh.dataset.cot }); } catch(err) { toast("用变量接入失败：" + err.message, "error"); } return; }
    const cp = e.target.closest("[data-cotpick]");
    if (cp) { try { await batchVarHookDialog(d, cp.dataset.cotpick); } catch(err) { toast("用变量接入失败：" + err.message, "error"); } return; }
    if (e.target.closest("[data-batchhook]")) { try { await batchVarHookDialog(d); } catch(err) { toast("用变量接入失败：" + err.message, "error"); } return; }
    const f = e.target.closest("[data-f]");
    if (f) {
      st.filter = f.dataset.f;
      return render();
    }
    const fix = e.target.closest("[data-fix]");
    if (fix) {
      const ids = fix.dataset.fix.split("|");
      // 只开这几条，并去掉所在分组的「关」标记；不带动组里其他条目
      mutate(d, "开启读取条目", (x) => {
        x.setEnabled(ids, true);
        for (const id of ids) {
          const g = x.group(x.groupOf(id));
          if (g && g.enabled === false) {
            g.enabled = true;
            delete g.restoreOn;
          }
        }
      });
      toast(`已开启 ${ids.length} 条`, "success");
      return;
    }
    const go = e.target.closest("[data-goto]");
    if (go) return app.showOrganize(go.dataset.goto.split("|"));
    if (e.target.closest("[data-markpick]")) {
      const cot = new Set(a0(d).cotIds);
      const items = d.order.filter((o) => o.enabled !== false && !cot.has(o.identifier) && !d.isMarker(o.identifier)).map((o) => ({ label: d.prompt(o.identifier)?.name || o.identifier, value: o.identifier }));
      const id = await pickBox("选择思维链条目", items);
      if (!id) return;
      manualFor(d.name)[id] = true;
      saveSettings();
      return render();
    }
    const mk = e.target.closest("[data-mark]");
    if (mk) {
      manualFor(d.name)[mk.dataset.mark] = mk.dataset.v === "1";
      saveSettings();
      render();
    }
  });
  const off = onDraftChange((name, kind) => {
    if (kind !== "status" && name === focusPreset() && draftViewVisible(page)) render();
  });
  return { render: () => {
    picker.refresh();
    render();
  }, destroy: off };
}

// 思维链片段：选一条思维链和放在哪一行，预览后加入 {{getvar::片段}}
async function cotReadDialog(d, key, manual = {}) {
  const version = JSON.stringify(d.toPreset());
  let plan = cotReadPlan(d, key, null, null, manual);
  const name = (id) => esc(d.prompt(id)?.name || id);
  const body = el(`<div class="pa-form">
    <p class="pa-p">在思维链中加入一行 <code>${esc(plan.macro)}</code>，模型思考时即可读到这段步骤。可在页头撤销。</p>
    <label class="pa-field"><span>加到哪条思维链</span><select class="pa-input" data-k="cot">${plan.choices.map((id) => `<option value="${esc(id)}">${name(id)}</option>`).join("")}</select></label>
    <label class="pa-field"><span>放在哪一行之后</span><select class="pa-input" data-k="line"></select></label>
    <p class="pa-hint">默认位置：最后一个片段读取之后；没有则放在结束标签或最后一个分步标题之前。</p>
    <details class="pa-card" open><summary>加入后的思维链</summary><pre class="pa-pre" data-k="preview"></pre></details></div>`);
  const cotSel = body.querySelector("[data-k=cot]"), lineSel = body.querySelector("[data-k=line]");
  const fillLines = () => {
    lineSel.innerHTML = cotLineOptions(d.prompt(plan.cotId)?.content);
    lineSel.value = String(plan.line);
  };
  const show = () => { body.querySelector("[data-k=preview]").textContent = plan.content; };
  cotSel.value = plan.cotId;
  fillLines(); show();
  cotSel.addEventListener("change", () => { plan = cotReadPlan(d, key, cotSel.value, null, manual); fillLines(); show(); });
  lineSel.addEventListener("change", () => { plan = cotReadPlan(d, key, cotSel.value, Number(lineSel.value), manual); show(); });
  const ok = await sheet({ title: `加入思维链读取：${key.replace(/^全局:/, "")}`, place: "center", body, wide: true, actions: [{ label: "取消", value: false }, { label: "加入", kind: "primary", value: true }] });
  if (!ok) return;
  if (JSON.stringify(d.toPreset()) !== version) return toast("预设已变化，请重新打开", "warning");
  mutate(d, `加入思维链读取：${plan.name}`, (x) => { x.prompt(plan.cotId).content = plan.content; });
  toast(`已在「${d.prompt(plan.cotId)?.name}」加入读取`, "success");
}
async function renameWritesDialog(d, from, to) {
  const plan = renameWritesPlan(d, from, to);
  const a = from.replace(/^全局:/, ""), b = to.replace(/^全局:/, "");
  const ok = await sheet({ place: "center", title: "统一变量名", body: `<p class="pa-p">将写入宏中的「${esc(a)}」改为读取用的「${esc(b)}」：</p><ul class="pa-notes">${plan.edits.map((x) => `<li>「${esc(d.prompt(x.id)?.name || x.id)}」${x.count} 处</li>`).join("")}</ul><p class="pa-hint">只改 setvar、addvar、incvar、decvar 中的变量名，可撤销。</p>`, actions: [{ label: "取消", value: false }, { label: "改名", kind: "primary", value: true }] });
  if (!ok) return;
  const now = renameWritesPlan(d, from, to);
  mutate(d, `统一变量名：${b}`, (x) => { for (const e of now.edits) x.prompt(e.id).content = e.content; });
  toast(`已改名 ${now.edits.reduce((n, e) => n + e.count, 0)} 处`, "success");
}

// 单个变量的修复方案：先说明要加什么，确认后再加
async function repairVariableDialog(d, key, manual = {}) {
  let plan;
  try {
    plan = variableRepairPlan(d, key, manual);
  } catch (e) {
    await sheet({ place: "center", title: "需人工核对", body: `<p class="pa-p">${esc(e.message)}</p>`, actions: [{ label: "确定", value: true }] });
    return;
  }
  const version = JSON.stringify(d.toPreset());
  const p = d.prompt(plan.last);
  const body = el(`<div><p class="pa-p">新增条目「变量读取 · ${esc(plan.name)}」，放在「${esc(p.name)}」之后（最后一个写入该变量的开启条目），角色为系统，正文：</p>
    <pre class="pa-pre">${esc(plan.macro)}</pre>
    <p class="pa-hint">思维链不改动。内容会进入上下文，模型是否采用需在实际发送的提示词中核对。</p></div>`);
  const ok = await sheet({ title: "补充变量读取", place: "center", body, wide: true, actions: [{ label: "取消", value: false }, { label: "添加", kind: "primary", value: true }] });
  if (!ok) return;
  if (JSON.stringify(d.toPreset()) !== version) return toast("预设已变化，请重新打开修复方案", "warning");
  variableRepairPlan(d, key, manual);
  mutate(d, "补充变量读取", (x) => x.insertPrompts([{
    prompt: { identifier: uid(), name: "变量读取 · " + plan.name, content: plan.macro, role: "system", system_prompt: false, marker: false, injection_position: 0, injection_depth: 4, injection_order: 100 },
    enabled: true
  }], { after: plan.last }, d.groupOf(plan.last)));
  toast("已添加读取条目", "success");
}
