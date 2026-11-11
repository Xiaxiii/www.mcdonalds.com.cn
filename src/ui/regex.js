// 预设正则只搬运原生数据；查找表达式和替换 HTML 在此处始终作为文本展示。
function presetRegexRuleName(rule) {
  return typeof rule?.scriptName === "string" && rule.scriptName ? rule.scriptName : "未命名正则";
}
function presetRegexRuleScope(rule) {
  if (rule?.markdownOnly && !rule?.promptOnly) return "仅显示美化";
  if (rule?.promptOnly && !rule?.markdownOnly) return "发送给模型";
  if (rule?.markdownOnly && rule?.promptOnly) return "显示美化及发送";
  return "通用处理";
}
function presetRegexRulesSnapshot(draft) {
  return presetRegexSnapshot(draft);
}
async function presetRegexDialog(sourceDraft, targetDraft, options = {}) {
  let sourceRules;
  try { sourceRules = presetRegexList(sourceDraft); }
  catch (error) { toast("无法预览预设正则：" + error.message, "error"); return false; }
  if (!sourceRules.length) {
    toast("这个来源预设没有随预设保存的正则");
    return false;
  }
  const sourceSig = presetRegexRulesSnapshot(sourceDraft);
  const targetSig = presetRegexRulesSnapshot(targetDraft);
  const targetGroupSig = presetRegexGroupSnapshot(targetDraft);
  const sourceManaged = drafts.get(sourceDraft.name) === sourceDraft;
  const targetManaged = drafts.get(targetDraft.name) === targetDraft;
  const targetFocus = focusPreset();
  const selected = new Set();
  const choices = new Map();
  const names = sourceRules.map((rule) => presetRegexRuleName(rule));
  const searchText = sourceRules.map((rule, i) => `${names[i]}\n${typeof rule?.id === "string" ? rule.id : ""}\n${typeof rule?.findRegex === "string" ? rule.findRegex : ""}`.toLowerCase());
  sourceRules.forEach((rule, i) => {
    if (rule?.markdownOnly && !rule?.promptOnly) selected.add(i);
  });
  // 从缝合预览跳过来时，只预选缝来的格式条目需要的那几条
  if (Array.isArray(options.preselect) && options.preselect.length) {
    selected.clear();
    options.preselect.filter((i) => Number.isInteger(i) && sourceRules[i]).forEach((i) => selected.add(i));
  }
  let plan = null;
  let basePlan = null;
  let planError = "";
  let query = "";
  let stale = false;
  let wrap = null;
  let groupName = sourceDraft.name;
  const activationText = () => {
    const state = presetRegexActivationInfo(targetDraft.name);
    if (state.extensionDisabled) return `正则功能已全局停用，当前不会生效。请在酒馆开启正则功能${state.allowed ? "" : "，再到「正则」面板允许目标预设"}；此处保留现有启用状态。`;
    if (!state.allowed) return "目标预设尚未允许使用内置正则。缝入后请到酒馆「正则」面板允许该预设，才能生效；此处保留现有启用状态。";
    return `目标预设已允许使用内置正则，保留现有启用状态。${state.current ? "保存后" : "切换到该预设后"}，由酒馆按各条规则的开关和作用范围处理。`;
  };
  const body = el(`<div class="pa-regex-transfer">
    <div class="pa-card"><b>从「${esc(sourceDraft.name)}」缝入「${esc(targetDraft.name)}」</b>
      <p class="pa-hint">默认选择仅用于显示美化的正则，保留每条规则原来的开关、作用位置和其他设置。新规则按来源顺序放到目标末尾；明确替换的规则保留目标位置。</p>
      <label class="pa-field-row"><span>缝入分组</span><input class="pa-input" data-rx-group-name type="text" value="${esc(groupName)}" aria-label="缝入正则的分组名称"></label>
      <p class="pa-hint">确认后自动将本次新增或替换的正则归入该组，同名组继续使用，保留各条正则的开关。</p>
      <p class="pa-hint">分组保存在目标预设中，由柏宝箱的正则分组面板显示；酒馆原生正则面板仍按平铺列表显示。</p>
      <p class="pa-hint" data-rx-activation>${esc(activationText())}</p>
      ${tip("<p>状态栏仍需配套提示词或世界书输出相应的标签和格式，正则才能匹配并显示美化。搬运正则后，请同时核对这些配套内容。</p>", "状态栏美化的使用条件")}
      <p class="pa-warn" data-rx-stale hidden>来源或目标已变化，请关闭后重新预览。</p></div>
    <input class="pa-input" data-rx-search style="${FIELD_STYLE}" type="text" inputmode="search" enterkeyhint="search" autocorrect="off" spellcheck="false" placeholder="搜索正则名称、ID 或查找表达式" aria-label="搜索来源正则">
    <div class="pa-card-act" role="group" aria-label="选择来源正则">
      <button class="pa-btn pa-btn-s" data-rx-pick="display">仅选显示美化</button>
      <button class="pa-btn pa-btn-s" data-rx-pick="all">全选</button>
      <button class="pa-btn pa-btn-s" data-rx-pick="none">清空</button>
      <span data-rx-count aria-live="polite"></span></div>
    <div data-rx-source></div>
    <div class="pa-card" data-rx-plan aria-live="polite"></div>
    <details class="pa-card" data-rx-order><summary>缝合后的正则顺序 <span data-rx-order-count></span></summary><ol data-rx-final-order></ol></details>
  </div>`);
  const staleReason = () => {
    try {
      if (sourceManaged && drafts.get(sourceDraft.name) !== sourceDraft) return true;
      if (targetManaged && drafts.get(targetDraft.name) !== targetDraft) return true;
      if (focusPreset() !== targetFocus) return true;
      return sourceSig !== presetRegexRulesSnapshot(sourceDraft) || targetSig !== presetRegexRulesSnapshot(targetDraft) || targetGroupSig !== presetRegexGroupSnapshot(targetDraft);
    } catch {
      return true;
    }
  };
  const markStale = () => {
    stale = true;
    body.querySelector("[data-rx-stale]").hidden = false;
    const button = wrap?.querySelector(".pa-sheet-actions .pa-btn-primary");
    if (button) button.disabled = true;
  };
  // 核心计划同时校验精确重复、同名/同 ID 冲突，并产生最终规则数组。
  const makePlan = (indices) => planPresetRegexTransfer(sourceDraft, targetDraft, {
    selectedIndices: indices,
    conflictChoices: Object.fromEntries(choices),
    groupName
  });
  try {
    basePlan = makePlan(sourceRules.map((_, i) => i));
  } catch (error) {
    toast("无法预览预设正则：" + error.message, "error");
    return false;
  }
  const rowInfo = (index) => basePlan.rows.find((row) => row.sourceIndex === index);
  const ruleMarkup = (rule, i) => {
    const info = rowInfo(i);
    const disabled = !rule || typeof rule !== "object" || Array.isArray(rule) || info?.invalid;
    const conflicts = info?.conflicts || [];
    return `<article class="pa-card" data-rx-index="${i}">
      <header><label class="pa-inline-check"><input type="checkbox" data-rx-select="${i}" ${selected.has(i) ? "checked" : ""} ${disabled ? "disabled" : ""}> <b>${esc(names[i])}</b></label></header>
      <small>${esc(presetRegexRuleScope(rule))} · 来源${rule?.disabled ? "关闭" : "开启"}${Array.isArray(rule?.placement) ? ` · 作用位置 ${esc(rule.placement.filter(Number.isInteger).map((value) => ({ 0: "旧版显示", 1: "用户输入", 2: "AI 输出", 3: "快捷命令", 5: "世界书", 6: "推理" }[value] || `位置 ${value}`)).join("、"))}` : ""}</small>
      ${info?.duplicate ? '<p class="pa-dim">目标已有相同规则，将自动跳过。</p>' : ""}
      ${disabled ? '<p class="pa-warn">规则数据不完整，不能搬运。</p>' : ""}
      ${conflicts.length && !info?.duplicate ? `<div class="pa-field-row"><span>冲突处理</span><select class="pa-select pa-select-s" data-rx-conflict="${i}" aria-label="${esc(names[i])}的冲突处理"><option value="keep">保留两份</option><option value="skip">跳过来源规则</option><option value="replace">替换目标规则</option></select></div>${conflicts.length > 1 ? `<label class="pa-field-row" data-rx-replace-row="${i}" hidden><span>替换哪条</span><select class="pa-select pa-select-s" data-rx-replace="${i}" aria-label="${esc(names[i])}要替换的目标"><option value="">请选择目标规则</option>${conflicts.map((r) => `<option value="${r.index}">第 ${r.index + 1} 条：${esc(presetRegexRuleName({ scriptName: r.name }))}</option>`).join("")}</select></label>` : ""}<small class="pa-warn">与目标中的 ${conflicts.map((r) => `第 ${r.index + 1} 条「${esc(presetRegexRuleName({ scriptName: r.name }))}」`).join("、")} 同名或同 ID，但内容不同。</small>` : ""}
      <details data-rx-details="${i}"><summary>查看查找与替换内容</summary><div data-rx-code></div></details>
    </article>`;
  };
  const displayIndices = sourceRules.map((rule, i) => rule?.markdownOnly && !rule?.promptOnly ? i : -1).filter((i) => i >= 0);
  const otherIndices = sourceRules.map((_, i) => i).filter((i) => !displayIndices.includes(i));
  body.querySelector("[data-rx-source]").innerHTML = `
    <section data-rx-section="display"><h3 class="pa-h">显示美化（${displayIndices.length}）</h3>${displayIndices.map((i) => ruleMarkup(sourceRules[i], i)).join("") || '<p class="pa-hint">来源没有仅显示美化的规则，可在下面手动选择。</p>'}</section>
    ${otherIndices.length ? `<section data-rx-section="other"><h3 class="pa-h">其他规则（${otherIndices.length}）</h3><p class="pa-hint">这些规则也可能改变发送给模型的内容，请核对后选择。</p>${otherIndices.map((i) => ruleMarkup(sourceRules[i], i)).join("")}</section>` : ""}`;
  body.querySelectorAll("[data-rx-select]:disabled").forEach((input) => {
    selected.delete(Number(input.dataset.rxSelect));
    input.checked = false;
  });
  const paintOrder = () => {
    const order = body.querySelector("[data-rx-order]");
    const list = body.querySelector("[data-rx-final-order]");
    if (!order.open) { list.replaceChildren(); return; }
    list.innerHTML = (plan?.rules || []).map((rule) => `<li>${esc(presetRegexRuleName(rule))} <small>${rule?.disabled ? "关闭" : "开启"} · ${esc(presetRegexRuleScope(rule))}</small></li>`).join("");
  };
  const refreshPlan = () => {
    if (staleReason()) markStale();
    planError = "";
    try { plan = makePlan([...selected]); }
    catch (error) { plan = null; planError = error.message; }
    body.querySelector("[data-rx-count]").textContent = `已选 ${selected.size} / ${sourceRules.length}`;
    const stats = plan?.stats;
    body.querySelector("[data-rx-plan]").innerHTML = planError ? `<p class="pa-warn">${esc(planError)}</p>` : `<b>本次预览</b><p>新增 ${stats.added} 条 · 替换 ${stats.replaced} 条 · 跳过 ${stats.skipped} 条</p><p data-rx-group-preview>${plan.group ? `${plan.group.reused ? "加入已有分组" : "新建分组"}「${esc(plan.group.name)}」：${plan.group.memberIds.length} 条` : "没有可缝入的正则，不创建分组"}</p><small>目标原有顺序保留，新规则按来源顺序追加；不会更改提示词条目或全局正则。</small>`;
    body.querySelector("[data-rx-order-count]").textContent = `（${plan?.rules?.length || 0} 条）`;
    const button = wrap?.querySelector(".pa-sheet-actions .pa-btn-primary");
    if (button) button.disabled = stale || !plan || !(stats.added || stats.replaced);
    paintOrder();
  };
  const filterRows = () => {
    body.querySelectorAll("[data-rx-index]").forEach((row) => {
      row.hidden = !searchText[Number(row.dataset.rxIndex)].includes(query);
    });
  };
  onSearchInput(body.querySelector("[data-rx-search]"), (value) => {
    query = value.trim().toLowerCase();
    filterRows();
  }, 80);
  body.querySelector("[data-rx-group-name]").addEventListener("input", (event) => {
    groupName = event.target.value.trim();
    refreshPlan();
  });
  body.addEventListener("click", (event) => {
    const pick = event.target.closest("[data-rx-pick]")?.dataset.rxPick;
    if (!pick) return;
    selected.clear();
    if (pick === "display") displayIndices.forEach((i) => selected.add(i));
    if (pick === "all") sourceRules.forEach((_, i) => selected.add(i));
    body.querySelectorAll("[data-rx-select]").forEach((input) => {
      if (input.disabled) selected.delete(Number(input.dataset.rxSelect));
      input.checked = selected.has(Number(input.dataset.rxSelect));
    });
    refreshPlan();
  });
  body.addEventListener("change", (event) => {
    const select = event.target.dataset.rxSelect;
    if (select != null) {
      if (event.target.checked) selected.add(Number(select));
      else selected.delete(Number(select));
      refreshPlan();
    }
    const conflict = event.target.dataset.rxConflict;
    if (conflict != null) {
      const targetRow = body.querySelector(`[data-rx-replace-row="${conflict}"]`);
      if (targetRow) targetRow.hidden = event.target.value !== "replace";
      const targetValue = targetRow?.querySelector("select").value;
      choices.set(Number(conflict), event.target.value === "replace" && targetRow
        ? { action: "replace", ...(targetValue !== "" ? { targetIndex: Number(targetValue) } : {}) }
        : event.target.value);
      refreshPlan();
    }
    const replacement = event.target.dataset.rxReplace;
    if (replacement != null) {
      const targetValue = event.target.value;
      choices.set(Number(replacement), { action: "replace", ...(targetValue !== "" ? { targetIndex: Number(targetValue) } : {}) });
      refreshPlan();
    }
  });
  body.addEventListener("toggle", (event) => {
    const details = event.target;
    if (details.matches("[data-rx-order]")) return paintOrder();
    if (!details.matches("[data-rx-details]") || !details.open || details.dataset.loaded) return;
    const rule = sourceRules[Number(details.dataset.rxDetails)];
    details.querySelector("[data-rx-code]").innerHTML = `<p class="pa-hint">查找表达式</p><pre class="pa-snip">${esc(typeof rule?.findRegex === "string" ? rule.findRegex : "（查找表达式格式无效）")}</pre><p class="pa-hint">替换文本 / HTML</p><pre class="pa-snip">${esc(typeof rule?.replaceString === "string" ? rule.replaceString : "（替换文本格式无效）")}</pre>`;
    details.dataset.loaded = "1";
  }, true);
  refreshPlan();
  const accepted = await sheet({
    title: "缝合预设正则",
    body,
    wide: true,
    noFocus: true,
    actions: [{ label: "取消", value: false }, {
      label: "确认缝合正则", kind: "primary", value: true,
      validate: () => {
        if (staleReason()) { markStale(); toast("来源或目标已变化，请重新预览", "error"); return false; }
        if (!plan || planError || !(plan.stats.added || plan.stats.replaced)) return false;
        try { validatePresetRegexTransfer(targetDraft, plan, sourceDraft); }
        catch (error) { markStale(); toast(error.message, "error"); return false; }
        return true;
      }
    }],
    onMount: (mounted) => {
      wrap = mounted;
      body.querySelector("[data-rx-activation]").textContent = activationText();
      options.onMount?.(mounted, body);
      const button = mounted.querySelector(".pa-sheet-actions .pa-btn-primary");
      if (button) button.disabled = stale || !plan || !(plan.stats.added || plan.stats.replaced);
      const off = onDraftChange((name, kind) => {
        body.querySelector("[data-rx-activation]").textContent = activationText();
        if ((name === sourceDraft.name || name === targetDraft.name || kind === "focus") && staleReason()) markStale();
      });
      mounted.addEventListener("pa-closed", off, { once: true });
    }
  });
  if (!accepted) return false;
  if (staleReason()) { toast("来源或目标已变化，请重新预览", "error"); return false; }
  try {
    validatePresetRegexTransfer(targetDraft, plan, sourceDraft);
    mutate(targetDraft, "缝合预设正则", (draft) => applyPresetRegexTransfer(draft, plan, sourceDraft));
    toast(`已缝入分组「${plan.group.name}」：新增 ${plan.stats.added} 条，替换 ${plan.stats.replaced} 条，可撤销`, "success");
    try { await options.afterApply?.(targetDraft, plan, body); }
    catch (error) { toast("正则已缝合，酒馆列表刷新失败，请重新打开正则面板：" + error.message, "error"); }
    return true;
  } catch (error) {
    toast("未能缝合预设正则：" + error.message, "error");
    return false;
  }
}
