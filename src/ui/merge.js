// 2.10.0 合并新版（缝合页 → 来源旁「⋯」）：来源 = 新版，目标 = 自己改过的旧版。
// 逐条比对提示词、预设内置正则、酒馆助手脚本，每条选保留旧版、采用新版、加入或删除；可拖动调整顺序，确认后并入目标，也可只导出文件
var MERGE_TABS = [["prompts", "提示词"], ["regex", "正则"], ["scripts", "酒馆助手脚本"]];
var MERGE_FILTERS = [["all", "全部"], ["changed", "改动"], ["added", "新增"], ["removed", "新版已删"], ["same", "无改"]];
var MERGE_TAG = { changed: "改动", added: "新增", removed: "已删", same: "无改" };
var MERGE_CHOICES = {
  changed: [["keep", "旧版"], ["new", "新版"]],
  added: [["skip", "忽略"], ["new", "加入"]],
  removed: [["keep", "保留"], ["skip", "删除"]]
};
// 差异正文：改动的条目里，连续 8 行以上没改的折成一行提示，只留前后各 3 行
function mergeDiffHtml(diff, fold) {
  const out = [];
  const line = (t, l) => out.push(`<span class="pa-mdl pa-mdl-${t}">${esc((t === "add" ? "+ " : t === "del" ? "- " : "  ") + l)}</span>`);
  for (let i = 0; i < diff.length; i++) {
    if (fold && diff[i][0] === "ctx") {
      let j = i;
      while (j < diff.length && diff[j][0] === "ctx") j++;
      const n = j - i, head = i === 0 ? 0 : 3, tail = j === diff.length ? 0 : 3;
      if (n >= 8 && n > head + tail) {
        for (let k = i; k < i + head; k++) line("ctx", diff[k][1]);
        out.push(`<span class="pa-mdl pa-mdl-gap">${n - head - tail} 行未改动</span>`);
        for (let k = j - tail; k < j; k++) line("ctx", diff[k][1]);
        i = j - 1;
        continue;
      }
    }
    line(diff[i][0], diff[i][1]);
  }
  return out.join("") || '<span class="pa-mdl pa-mdl-gap">正文为空</span>';
}
async function presetMergeDialog(nextDraft, baseDraft) {
  let plan;
  try { plan = mergePlan(baseDraft, nextDraft); }
  catch (error) { toast("无法比对：" + error.message, "error"); return false; }
  const sigOf = () => presetSig(baseDraft.preset) + JSON.stringify(baseDraft.groups);
  const sig0 = sigOf();
  const managed = drafts.get(baseDraft.name) === baseDraft;
  const stale = () => managed && drafts.get(baseDraft.name) !== baseDraft || sigOf() !== sig0;
  const tabs = MERGE_TABS.filter(([k]) => k === "prompts" || mergeItems(plan, k).length);
  let tab = "prompts", filter = "all", wrap = null;
  const open = new Set();
  const body = el(`<div class="pa-merge">
    <div class="pa-merge-head">
      <p class="pa-merge-dir"><span><small>旧版（保留自己的改动）</small><b>${esc(baseDraft.name)}</b></span><i aria-hidden="true">←</i><span><small>新版</small><b>${esc(nextDraft.name)}</b></span></p>
      ${tabs.length > 1 ? `<div class="pa-seg pa-merge-tabs" role="tablist" aria-label="比对内容">${tabs.map(([k, l]) => `<button type="button" role="tab" data-mtab="${k}">${l}</button>`).join("")}</div>` : ""}
      <div class="pa-merge-filters" role="group" aria-label="筛选">${MERGE_FILTERS.map(([k, l]) => `<button type="button" class="pa-mfilter" data-mfilter="${k}">${l}<small></small></button>`).join("")}</div>
      <div class="pa-merge-stat"><span data-mstat aria-live="polite"></span><span class="pa-merge-batch"><button type="button" class="pa-link" data-mbatch="new">改动全选新版</button><button type="button" class="pa-link" data-mbatch="keep">改动全选旧版</button></span></div>
    </div>
    <div class="pa-merge-list"></div>
  </div>`);
  const list = body.querySelector(".pa-merge-list");
  const shown = () => {
    const items = mergeItems(plan, tab);
    const byKey = new Map(items.map((it) => [it.key, it]));
    const seq = tab === "scripts" ? items : mergeSyncOrder(plan, tab).map((k) => byKey.get(k)).filter(Boolean);
    return seq.filter((it) => filter === "all" || it.type === filter);
  };
  const rowHtml = (it, n) => {
    const renameOnly = it.renamed && it.type === "changed" && (tab === "prompts" ? (it.a.content || "") === (it.b.content || "") : tab === "regex" && mergeRegexBlob({ ...it.a, scriptName: "" }) === mergeRegexBlob({ ...it.b, scriptName: "" }));
    const choices = MERGE_CHOICES[it.type];
    const off = (it.type === "added" || it.type === "removed") && it.choice === "skip";
    const name = it.name || "（未命名）";
    return `<div class="pa-mgrow${off ? " pa-mgrow-off" : ""}${open.has(it.key) ? " open" : ""}" data-key="${esc(it.key)}">
      <div class="pa-mgrow-head">
        ${tab === "scripts" ? "" : `<button type="button" class="pa-mgrip" aria-label="拖动排序：${esc(name)}（方向键上下移动）" title="拖动排序">${ICON.grip}</button>`}
        <span class="pa-mtag pa-mtag-${renameOnly ? "changed" : it.type}">${renameOnly ? "改名" : MERGE_TAG[it.type]}</span>
        <button type="button" class="pa-mname" data-mopen aria-expanded="${open.has(it.key)}"><small>${n}.</small> ${esc(name)}</button>
        ${choices ? `<div class="pa-seg pa-seg-s pa-mchoice" role="group" aria-label="${esc(name)}">${choices.map(([c, l]) => `<button type="button" data-mc="${c}" class="${it.choice === c ? "on" : ""}" aria-pressed="${it.choice === c}">${l}</button>`).join("")}</div>` : ""}
      </div>
      <div class="pa-mbody"${open.has(it.key) ? "" : " hidden"}>${open.has(it.key) ? bodyHtml(it) : ""}</div>
    </div>`;
  };
  const bodyHtml = (it) => {
    const note = it.type === "removed" ? "新版中已没有这一条，以下为旧版内容。"
      : tab === "scripts" && it.type === "changed" ? `变化的字段：${mergeScriptFields(it.a, it.b).join("、") || "无"}。以下为代码差异。` : "";
    return `${note ? `<p class="pa-hint">${esc(note)}</p>` : ""}<div class="pa-mdiff">${mergeDiffHtml(mergeItemDiff(tab, it), it.type === "changed")}</div>`;
  };
  const paintHead = () => {
    const s = mergeStats(plan, tab);
    body.querySelectorAll("[data-mtab]").forEach((b) => {
      const on = b.dataset.mtab === tab;
      b.classList.toggle("on", on);
      b.setAttribute("aria-selected", String(on));
    });
    body.querySelectorAll("[data-mfilter]").forEach((b) => {
      const k = b.dataset.mfilter, on = k === filter;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", String(on));
      b.querySelector("small").textContent = ` ${s[k]}`;
    });
    body.querySelector("[data-mstat]").textContent = `改动 ${s.changed} 条，采用新版 ${s.useNew} · 新增 ${s.added} 条，加入 ${s.addIn} · 新版已删 ${s.removed} 条，删除 ${s.dropOut}`;
    body.querySelector(".pa-merge-batch").hidden = !s.changed;
    const go = wrap?.querySelector(".pa-sheet-actions .pa-btn-primary");
    if (go) go.disabled = !mergeTouches(plan);
  };
  const paint = () => {
    paintHead();
    list.dataset.tab = tab;
    const rows = shown();
    if (!rows.length) {
      list.innerHTML = `<p class="pa-empty">${filter === "all" ? "两个版本中都没有这类内容。" : "这一类下没有条目。"}</p>`;
      return;
    }
    if (tab !== "prompts") {
      list.innerHTML = rows.map((it, i) => rowHtml(it, i + 1)).join("");
      return;
    }
    // 提示词：分组变了就插一行组头。组头只是标注，条目顺序照合并后的顺序
    const groupMap = mergeGroupMap(plan), info = mergeGroupInfo(plan);
    const count = new Map();
    for (const it of rows) count.set(groupMap[it.key] || "", (count.get(groupMap[it.key] || "") || 0) + 1);
    let last = null, html = "";
    rows.forEach((it, i) => {
      const gid = groupMap[it.key] || "";
      if (gid !== last) {
        const g = info.get(gid);
        const chip = !gid ? "" : g?.newName ? '<span class="pa-chip">改名</span>' : g?.status === "added" ? '<span class="pa-chip pa-chip-cot">新增分组</span>' : g?.status === "removed" ? '<span class="pa-chip pa-chip-dim">新版已无此组</span>' : "";
        html += `<div class="pa-mgroup"><b>${gid ? esc(g?.newName ? `${g.name} → ${g.newName}` : g?.name || "（未命名分组）") : "未分组"}</b>${chip}<small>${count.get(gid)} 条</small></div>`;
        last = gid;
      }
      html += rowHtml(it, i + 1);
    });
    list.innerHTML = html;
  };
  const keyOf = (node) => node.closest(".pa-mgrow")?.dataset.key;
  body.addEventListener("click", (e) => {
    const t = e.target.closest("[data-mtab]");
    if (t) { tab = t.dataset.mtab; filter = "all"; open.clear(); return paint(); }
    const f = e.target.closest("[data-mfilter]");
    if (f) { filter = f.dataset.mfilter; return paint(); }
    const batch = e.target.closest("[data-mbatch]");
    if (batch) {
      for (const it of mergeItems(plan, tab)) if (it.type === "changed") mergeChoose(plan, tab, it.key, batch.dataset.mbatch);
      return paint();
    }
    const c = e.target.closest("[data-mc]");
    if (c) {
      const key = keyOf(c);
      if (!mergeChoose(plan, tab, key, c.dataset.mc)) return;
      paint();
      // 整个列表重画了，把焦点放回刚点的按钮
      const again = [...list.querySelectorAll(".pa-mgrow")].find((r) => r.dataset.key === key)?.querySelector(`[data-mc="${c.dataset.mc}"]`);
      again?.focus({ preventScroll: true });
      return;
    }
    const o = e.target.closest("[data-mopen]");
    if (o) {
      const row = o.closest(".pa-mgrow"), key = row.dataset.key, on = !open.has(key);
      on ? open.add(key) : open.delete(key);
      row.classList.toggle("open", on);
      o.setAttribute("aria-expanded", String(on));
      const box = row.querySelector(".pa-mbody");
      box.hidden = !on;
      if (on && !box.firstChild) box.innerHTML = bodyHtml(mergeItems(plan, tab).find((it) => it.key === key));
    }
  });
  // 拖动排序。往下拖：放在上一行后面，归上一行的组；往上拖：放在下一行前面，归下一行的组
  dragSort(list, {
    grip: ".pa-mgrip", row: ".pa-mgrow",
    onDrop(from, to, { keyboard }) {
      const keys = shown().map((it) => it.key);
      const key = keys[from];
      const rest = keys.filter((_, i) => i !== from);
      const prev = rest[to - 1], nextKey = rest[to];
      const down = to > from;
      const ref = down || nextKey === void 0 ? prev : nextKey;
      if (ref === void 0) return;
      const after = ref === prev;
      const gid = tab === "prompts" ? mergeGroupMap(plan)[ref] || null : void 0;
      if (!mergeMove(plan, tab, key, ref, after, gid)) return;
      paint();
      if (keyboard) [...list.querySelectorAll(".pa-mgrow")].find((r) => r.dataset.key === key)?.querySelector(".pa-mgrip")?.focus();
    }
  });
  paint();
  const exportFile = () => {
    try {
      if (stale()) throw new Error("目标预设已在别处改动，请关闭后重新比对");
      downloadPresetJson(baseDraft.name, mergedPreset(plan), "合并");
      toast("已导出合并后的预设文件，目标预设未改动", "success");
    } catch (error) { toast("导出失败：" + error.message, "error"); }
    return false;
  };
  const accepted = await sheet({
    title: "合并新版",
    body,
    wide: true,
    noFocus: true,
    cls: "pa-sheet-merge",
    actions: [
      { label: "取消", value: false },
      { label: "导出文件", value: false, validate: exportFile },
      { label: "并入旧版", kind: "primary", value: true, validate: () => {
        if (stale()) { toast("目标预设已在别处改动，请关闭后重新比对", "error"); return false; }
        return mergeTouches(plan);
      } }
    ],
    onMount: (mounted) => { wrap = mounted; paintHead(); }
  });
  if (!accepted) return false;
  try {
    let stats;
    mutate(baseDraft, `合并新版「${nextDraft.name}」`, (d) => { stats = applyMerge(plan, d); });
    const sum = (k) => stats.prompts[k] + stats.regex[k] + stats.scripts[k];
    toast(`已并入「${baseDraft.name}」：采用新版 ${sum("useNew")} 条，加入 ${sum("addIn")} 条，删除 ${sum("dropOut")} 条，可撤销`, "success");
    return true;
  } catch (error) {
    // 写到一半出错：退回合并前的状态
    if (baseDraft.history.length && baseDraft.history[baseDraft.history.length - 1].label === `合并新版「${nextDraft.name}」`) { baseDraft.undo(); emitChange(baseDraft.name); }
    toast("合并失败，目标预设未改动：" + error.message, "error");
    return false;
  }
}
