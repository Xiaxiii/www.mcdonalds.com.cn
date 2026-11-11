// 按预设开着的条目和显示正则猜标签；读不到预设时不猜
function replyTagGuess(name) {
  try {
    const d = getDraft(name);
    return memoByDraft(d, "replyguess", () => d.withReadIndex(() => replyTagGuessOf(d)));
  } catch { return null; }
}
function replyTagGuessOf(d) {
  try {
    const texts = d.order.filter((o) => d.isActive(o.identifier)).map((o) => d.prompt(o.identifier)?.content);
    const regexTags = [];
    try { for (const rule of presetRegexList(d)) if (!rule?.disabled) regexTags.push(...presetRegexAnchors(rule).tags); } catch {}
    return guessReplyTags(texts, regexTags);
  } catch { return null; }
}
// 酒馆「推理内容格式化」的前缀，如 <ECoT>：预设用它包思考，检查时当作思考标签
function stReasoningTag(c = ctx()) {
  const r = c.powerUserSettings?.reasoning;
  const m = /^<\s*([A-Za-z_\u3400-\u9fff][A-Za-z0-9_\u3400-\u9fff-]{0,39})\s*>$/u.exec(String(r?.prefix || "").trim());
  return m ? { tag: m[1], autoParse: !!r.auto_parse } : null;
}
// 模型自带思考（Gemini、Claude 等返回的推理）已经放进思考区时，酒馆不再自动解析 <ECoT>，它会留在正文里
function nativeReasoningNote(message) {
  const st = stReasoningTag();
  if (!st?.autoParse || !message?.extra?.reasoning || message.extra.reasoning_type !== "model") return "";
  if (!new RegExp(`<\\s*${st.tag}\\s*>`, "iu").test(replyCheckMask(String(message.mes || "")))) return "";
  return `<div class="pa-card pa-card-warn"><b>思考区里是模型自带的思考，&lt;${esc(st.tag)}&gt; 留在了正文里</b><p class="pa-hint">模型回传了自己的思考，酒馆不再把 &lt;${esc(st.tag)}&gt; 解析进思考区，生成时它先出现在正文中，写完才被美化正则收起。只保留预设思维链：酒馆「AI 响应配置」关闭「请求思维链」。模型仍会思考，只是不再回传。</p></div>`;
}
// 正文格式检查表单：只在「回复」页显示
function replyForm(name, { onSaved } = {}) {
  const saved = replyGuardConfig(name);
  const stTag = stReasoningTag();
  const thinkingDefault = saved.thinkingTag ?? (stTag && !/^think(ing)?$/i.test(stTag.tag) ? stTag.tag : "");
  const fresh = !saved.bodyTag;
  const guess = replyTagGuess(name);
  const bodyDefault = saved.bodyTag || guess?.bodyTag || "content";
  const available = replyGuardAvailable();
  const semanticAvailable = semanticReviewAvailable();
  let reviewCancel = null;
  // 2.8.0 一页排完：检查（按钮、粘贴框、结果）在上，标签和自动处理在下，语义审查和检测范围折叠
  const body = el(`<div class="pa-form pa-replyform">
    <div class="pa-toolbar pa-rcheck"><button class="pa-btn pa-btn-primary" data-r="latest">检查最近回复</button><button class="pa-btn" data-r="paste">检查下方文字</button><button class="pa-btn" data-r="diagnose">按范本诊断</button></div>
    <textarea class="pa-input" data-r="sample" rows="3" aria-label="粘贴一条 AI 回复" placeholder="粘贴一条 AI 回复，点「检查下方文字」；粘贴格式正确的回复，点「按范本诊断」（只在本页检测，不保存）"></textarea>
    <div data-r="result" aria-live="polite"></div>
    <div data-r="lastremind"></div>
    <h3 class="pa-h">标签 <small class="pa-dim" data-r="stamp">按预设自动保存，须与预设的输出格式一致</small></h3>
    <div class="pa-rtags">
    <label class="pa-field"><span>正文标签${fresh && guess?.bodyTag ? whyBtn("body") : ""}</span><input class="pa-input" data-r="body" value="${esc(bodyDefault)}" placeholder="content" maxlength="40" aria-describedby="pa-err-body"><small class="pa-field-err" id="pa-err-body" data-err="body" hidden></small></label>
    <label class="pa-field pa-rtag-req"><span>必需标签${guess?.suggest.length ? whyBtn("required") : ""}</span><input class="pa-input" data-r="required" value="${esc((saved.requiredTags || []).join("、"))}" placeholder="可选，填卡里的原标签名，几张卡的可一起填" aria-describedby="pa-err-required"><small class="pa-field-err" id="pa-err-required" data-err="required" hidden></small><small class="pa-hint" data-r="unused" hidden></small></label>
    <label class="pa-field"><span>思考标签${!saved.thinkingTag && thinkingDefault ? whyBtn("thinking") : ""}</span><input class="pa-input" data-r="thinking" value="${esc(thinkingDefault)}" placeholder="可选，已识别 think" maxlength="40" aria-describedby="pa-err-thinking"><small class="pa-field-err" id="pa-err-thinking" data-err="thinking" hidden></small></label>
    </div>
    ${fresh && guess ? guess.bodyTag ? whyNote("body", `已按预设填入 &lt;${esc(guess.bodyTag)}&gt;（条目中出现 ${guess.count} 处），有误可改。`) : '<p class="pa-warn">预设开启的条目中没有正文标签。预设不要求标签包裹正文时，不要开启提醒，否则会让 AI 输出多余标签。</p>' : ""}
    ${guess?.suggest.length ? whyNote("required", `显示正则依赖 ${guess.suggest.map((t) => `&lt;${esc(t)}&gt;`).join("、")} 美化。如需检查是否掉落，可填入这里。`) : ""}
    ${!saved.thinkingTag && thinkingDefault ? whyNote("thinking", `已按酒馆推理前缀填入 &lt;${esc(thinkingDefault)}&gt;。`) : ""}
    <h3 class="pa-h">发现问题时</h3>
    <div class="pa-rautoset">
    <label class="pa-field-row"><input type="checkbox" data-r="enabled" ${saved.enabled ? "checked" : ""} ${available ? "" : "disabled"}>下一轮提醒 AI</label>
    <label class="pa-field-row"><input type="checkbox" data-r="autofix" ${saved.autoFix ? "checked" : ""}>自动修正回复问题</label>
<label class="pa-field-row"><input type="checkbox" data-r="outside" ${saved.allowOutside ? "checked" : ""}>正文标签外允许有文字</label>
    <div class="pa-whyrow pa-whyrow-check"><label class="pa-field-row"><input type="checkbox" data-r="bysample" ${saved.skeleton?.length && saved.remindBySample !== false ? "checked" : ""} ${saved.skeleton?.length ? "" : "disabled"}>提醒时照范本的标签顺序写</label>${whyBtn("bysample")}</div>
    ${whyNote("bysample", "先粘贴一份格式正确的回复，点「按范本诊断」，再点「记为范本」。只保存标签名和顺序。")}
    <p class="pa-hint pa-rsample" data-r="sampleinfo" hidden></p>
    <label class="pa-field-row"><input type="checkbox" data-r="semantic" ${saved.semanticAfterReply ? "checked" : ""} ${semanticAvailable ? "" : "disabled"}>生成完成后自动 AI 语义审查（每次多一次请求）</label>
    </div>
    ${available ? "" : '<p class="pa-warn">当前酒馆缺少生成前事件或临时提示接口，手动检测可用，自动提醒不可用。</p>'}
    <details class="pa-card pa-rai"><summary>AI 语义审查</summary>
      <p class="pa-hint">通过酒馆当前连接发送这一条回复，检查是否夹带任务规划、自我指令等内部分析。每次增加一次请求和费用；结果可能误判，仅供核对，不改动正文。</p>
      ${semanticAvailable ? "" : '<p class="pa-warn">当前酒馆或连接不支持独立聊天补全请求，请升级酒馆并选择聊天补全连接。结构检查仍可使用。</p>'}
      <div class="pa-toolbar"><button class="pa-btn" data-r="ai-latest" ${semanticAvailable ? "" : "disabled"}>审查最近回复</button><button class="pa-btn" data-r="ai-paste" ${semanticAvailable ? "" : "disabled"}>审查粘贴文字</button><button class="pa-btn" data-r="ai-cancel" hidden>取消审查</button><button class="pa-link" data-r="ai-result">查看最近结果</button></div>
      <div data-r="semantic-result" aria-live="polite"></div>
    </details>
    <details class="pa-card pa-rscope"><summary>检测范围</summary><ul class="pa-notes">
      <li>检查掉标签、重复或未闭合、正文裹进思考区、状态栏等留在思考区、正文夹入思考标签、正文外大段文字（爆思维链）、疑似推理标题。</li>
      <li>开启提醒后，仅在该预设使用中且上一条回复有问题时，向下一轮加入临时提醒。续写不提醒。提醒只点名正文标签和下面填的必需标签，不提其他标签。</li>
      <li>代码块和注释中的标签示例不计。可见回复没有正文标签时，在本地查看思考区的标签位置，不展示、不发送。</li>
      <li>一键修正只改名、补齐或移动标签，正文前露出的思考原样移进思考区，不增删文字。提醒不保证模型遵守。</li>
      <li>必需标签只对用到它的对话生效：当前预设开着的条目、角色卡或当前对话生效的世界书里写着这个标签时，才检查、提醒、修正。几张卡的状态栏标签可以一起填，每张卡只按自己的标签检查。</li>
      <li>必需标签整个没出现、回复里却多了预设和角色卡都没用到的块（如把 &lt;status&gt; 写成 &lt;状态&gt;）时，当作写错了名字：提醒只写正确的标签名，不写出错误的名字；只多一个这样的块时，修正会把它改名；自动修正只在块里的子标签和预设里写的对得上时才改。</li>
      <li>必需标签外面多套了一层预设、角色卡、世界书和正则都没用到的标签（如 &lt;状态&gt;&lt;status&gt;…&lt;/status&gt;&lt;/状态&gt;），且外层里没有别的文字时，提醒直接输出必需标签，修正去掉外层标签。</li>
      <li>正文被吞进思考区时，紧挨着的状态栏、小剧场等完整标签块一起搬出来；正文前的块照前几条回复判断。</li>
      <li>按范本诊断：粘贴一份格式正确的回复，凡是被判出的问题都算设置与范本不符，逐条给出改法，可一键写回设置。范本只在本页使用；点「记为范本」只保存标签名和顺序，不保存正文。</li></ul></details>
  </div>`);
  bindWhy(body);
  // 2.9.0 范本的标签顺序（只有标签名）：随设置一起保存
  let skeleton = Array.isArray(saved.skeleton) ? [...saved.skeleton] : [];
  const paintSample = () => {
    const info = body.querySelector('[data-r="sampleinfo"]'), box = body.querySelector('[data-r="bysample"]');
    box.disabled = !skeleton.length;
    if (!skeleton.length) box.checked = false;
    info.hidden = !skeleton.length;
    info.innerHTML = skeleton.length ? `范本：${skeleton.map((t) => `&lt;${esc(t)}&gt;`).join("、")} <button type="button" class="pa-link" data-r="sample-clear">清除范本</button>` : "";
  };
  paintSample();
  const read = () => {
    const thinkingTag = body.querySelector('[data-r="thinking"]').value.trim();
    const input = { bodyTag: body.querySelector('[data-r="body"]').value.trim(), requiredTags: body.querySelector('[data-r="required"]').value };
    if (thinkingTag) input.thinkingTag = thinkingTag;
    const rules = normalizeReplyRules(input);
    const value = { bodyTag: rules.bodyTag, requiredTags: rules.requiredTags, thinkingTag, enabled: available && body.querySelector('[data-r="enabled"]').checked };
    if (body.querySelector('[data-r="autofix"]').checked) value.autoFix = true;
    if (semanticAvailable && body.querySelector('[data-r="semantic"]').checked) value.semanticAfterReply = true;
    if (body.querySelector('[data-r="outside"]').checked) value.allowOutside = true;
    if (skeleton.length) {
      value.skeleton = [...skeleton];
      value.remindBySample = body.querySelector('[data-r="bysample"]').checked;
    }
    return value;
  };
  const result = body.querySelector('[data-r="result"]');
  // 2.5.1 标签填错时，报错写在那个输入框下面并滚过去；改动时清掉，离开输入框时重新检查
  const fieldError = (key, message) => {
    const box = body.querySelector(`[data-err="${key}"]`);
    const input = body.querySelector(`[data-r="${key}"]`);
    if (!box || !input) return false;
    box.textContent = message || "";
    box.hidden = !message;
    if (message) input.setAttribute("aria-invalid", "true");
    else input.removeAttribute("aria-invalid");
    return true;
  };
  const showError = (e, target = result) => {
    if (fieldError(e.field, e.message)) {
      const input = body.querySelector(`[data-r="${e.field}"]`);
      scrollToView(input);
      input.focus({ preventScroll: true });
    } else target.innerHTML = `<p class="pa-warn">${esc(e.message)}</p>`;
  };
  body.addEventListener("input", (e) => { if (e.target.dataset?.r) fieldError(e.target.dataset.r, ""); });
  // 2.8.1 改动即保存：标签离开输入框时、勾选框点下时写入当前预设
  const stamp = body.querySelector('[data-r="stamp"]'), stampText = stamp.textContent;
  let stampTimer = 0;
  body.addEventListener("change", (e) => {
    const key = e.target.dataset?.r;
    if (!["body", "required", "thinking", "enabled", "autofix", "semantic", "outside", "bysample"].includes(key)) return;
    let value;
    try { value = read(); } catch (err) { if (err.field) fieldError(err.field, err.message); return; }
    saveReplyConfig(name, value);
    onSaved?.();
    stamp.textContent = "已保存";
    clearTimeout(stampTimer);
    stampTimer = setTimeout(() => { stamp.textContent = stampText; }, 1600);
  });
  // 2.8.2 填了但当前对话没用到的必需标签：写在输入框下面，检查、提醒、修正都跳过
  const unusedNote = body.querySelector('[data-r="unused"]');
  const unusedText = (unused) => unused.length ? `当前对话的预设、角色卡和世界书里没有 ${unused.map((t) => `<${t}>`).join("、")}，这次不检查、不提醒、不修正。` : "";
  const showUnused = () => {
    try { const text = unusedText(replyRulesInUse(read(), name).unused); unusedNote.textContent = text; unusedNote.hidden = !text; } catch {}
  };
  Promise.resolve(refreshReplyWorld()).then(showUnused, () => {});
  body.addEventListener("change", (e) => { if (e.target.dataset?.r === "required") showUnused(); });
  // 存一次当前表单（按范本改设置、记范本、清除范本后用）
  const saveNow = () => body.querySelector('[data-r="body"]').dispatchEvent(new Event("change", { bubbles: true }));
  // 2.9.0 最近一次提醒：什么时候、因为哪条回复的哪些问题、发给 AI 的原文
  const lastBox = body.querySelector('[data-r="lastremind"]');
  const paintLast = () => {
    const r = replyLastReminder;
    if (!r || r.preset !== name) { lastBox.innerHTML = ""; return; }
    const d = new Date(r.at), two = (n) => String(n).padStart(2, "0");
    lastBox.innerHTML = `<details class="pa-card pa-rlast"><summary>最近一次提醒：${two(d.getHours())}:${two(d.getMinutes())}，因聊天第 ${r.index + 1} 条消息</summary><ul class="pa-notes">${r.reasons.map((x) => `<li>${esc(x)}</li>`).join("")}</ul><p class="pa-hint">发给 AI 的原文：</p><pre class="pa-pre">${esc(r.text)}</pre><p class="pa-hint">这条回复本身没有问题时，把它粘贴到上面，点「按范本诊断」。</p></details>`;
  };
  paintLast();
  let diag = null;
  const diagnose = () => {
    const text = body.querySelector('[data-r="sample"]').value;
    if (!text.trim()) { result.innerHTML = '<p class="pa-warn">先在上面的框里粘贴一份格式正确的回复。</p>'; return; }
    const { rules: config } = replyRulesInUse(read(), name);
    const chat = ctx().chat;
    diag = diagnoseReplySample(text, config, { layout: replyLayoutLazy(chat, Array.isArray(chat) ? chat.length : 0, config), knownTags: replyKnownTagsLazy(name, config.requiredTags) });
    const can = Object.keys(diag.patch).length > 0;
    const sk = diag.skeleton.length ? `<p class="pa-p">范本的标签顺序：${diag.skeleton.map((t) => `&lt;${esc(t)}&gt;`).join("、")}</p><div class="pa-toolbar"><button class="pa-btn" data-r="sample-save">记为范本</button></div>` : "";
    if (!diag.advice.length) {
      result.innerHTML = `<div class="pa-card"><p class="pa-p"><b>按现在的设置，这份范本没有问题。</b></p><p class="pa-hint">回复仍被提醒或修正时，原因在那条回复本身：点「检查最近回复」看具体问题。</p>${sk}</div>`;
      return;
    }
    const left = can ? diag.after.issues : [];
    result.innerHTML = `<div class="pa-card"><p class="pa-p"><b>设置与范本有 ${diag.advice.length} 处不符</b></p><ul class="pa-notes">${diag.advice.map((a) => `<li>${esc(a.text)}</li>`).join("")}</ul>
      ${can ? `<div class="pa-toolbar"><button class="pa-btn pa-btn-primary" data-r="diag-apply">按建议修改设置</button></div>${left.length ? `<p class="pa-hint">修改后仍会报：${esc(left.map((i) => i.text).join("；"))}</p>` : '<p class="pa-hint">修改后，这份范本不再报问题。</p>'}` : ""}${sk}</div>`;
  };
  const applyDiag = () => {
    if (!diag) return;
    const p = diag.patch;
    if (p.bodyTag) body.querySelector('[data-r="body"]').value = p.bodyTag;
    if (p.requiredTags) body.querySelector('[data-r="required"]').value = p.requiredTags.join("、");
    if (p.allowOutside) body.querySelector('[data-r="outside"]').checked = true;
    if (p.enabled === false) body.querySelector('[data-r="enabled"]').checked = false;
    if (p.autoFix === false) body.querySelector('[data-r="autofix"]').checked = false;
    saveNow();
    showUnused();
    diagnose();
    result.insertAdjacentHTML("afterbegin", '<p class="pa-p">已按建议修改并保存设置。</p>');
  };
  let pending = null, undo = null;
  // 世界书已读好时同步完成；没读好（刚换聊天）先读再查
  const check = (mode) => { const loading = refreshReplyWorld(); return loading ? loading.then(() => checkNow(mode)) : checkNow(mode); };
  const checkNow = (mode) => {
    const { rules: config, unused } = replyRulesInUse(read(), name);
    showUnused();
    let text = body.querySelector('[data-r="sample"]').value, source = "粘贴的文字", reasoning = "", latest = null;
    if (mode === "latest") {
      latest = latestReplyForCheck(ctx().chat);
      if (!latest) { result.innerHTML = '<p class="pa-hint">没有可检查的 AI 回复（不检查开场白、用户和系统消息）。</p>'; pending = null; return; }
      text = latest.message.mes;
      reasoning = latest.message.extra?.reasoning || "";
      source = `聊天第 ${latest.index + 1} 条消息`;
    }
    const chat = ctx().chat;
    const layout = replyLayoutLazy(chat, latest ? latest.index : Array.isArray(chat) ? chat.length : 0, config);
    const knownTags = replyKnownTagsLazy(name, config.requiredTags);
    const report = checkReplyFormat(text, config, { reasoning, layout, knownTags });
    const reminder = buildReplyReminder(report, config);
    const plan = report.issues.length ? planReplyFix(text, config, { reasoning, layout, knownTags }) : null;
    pending = plan && latest ? { index: latest.index, plan, snapshot: replyMessageSnapshot(latest.index) } : null;
    const left = plan ? plan.after.issues : [];
    const fix = plan ? `<div class="pa-card"><div class="pa-whyrow"><b>可修正的标签</b>${whyBtn("fixhow")}</div>${whyNote("fixhow", "只移动文字、补写标签，不增删文字。")}<ul class="pa-notes">${plan.steps.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
      ${left.length ? `<p class="pa-warn">修正后仍有 ${left.length} 个问题需人工处理：${esc(left.map((i) => i.text).join("；"))}</p>` : ""}
      <details><summary>修正后原文预览</summary><pre class="pa-pre">${esc(plan.text)}</pre></details>
      ${pending ? '<div class="pa-toolbar"><button class="pa-btn pa-btn-primary" data-r="fix">修正这条回复</button></div>' : '<p class="pa-hint">粘贴的文字不写回聊天，可复制上面的预览。</p>'}</div>` : "";
    const auto = latest && replyAutoFixFor(latest.index);
    const note = (auto ? `<div class="pa-card"><p class="pa-p">这条回复已自动修正：${esc(auto.steps.join("；"))}。<button class="pa-link" data-r="undo-auto">撤销</button></p></div>` : "") + (latest ? nativeReasoningNote(latest.message) : "");
    const skipped = unused.length ? `<p class="pa-hint">${esc(unusedText(unused))}</p>` : "";
    result.innerHTML = note + skipped + `<div class="pa-whyrow"><p class="pa-p">${esc(source)}：${report.issues.length ? `发现 ${report.issues.length} 个格式风险` : "未发现配置范围内的格式问题"}</p>${report.issues.length ? "" : whyBtn("clean")}</div>${report.issues.length ? `<ul class="pa-notes">${report.issues.map((i) => `<li>${esc(i.text)}${i.excerpt ? `<pre class="pa-pre">${esc(i.excerpt)}${i.excerpt.length >= 80 ? "…" : ""}</pre>` : ""}</li>`).join("")}</ul>${fix}<details class="pa-card"><summary>下一轮提醒预览</summary><pre class="pa-pre">${esc(reminder)}</pre></details>` : whyNote("clean", "这不代表正文语义、所有变量或其他输出格式已验证。")}`;
  };
  body.addEventListener("click", async (e) => {
    const button = e.target.closest('[data-r="latest"], [data-r="paste"], [data-r="fix"], [data-r="undo-fix"], [data-r="undo-auto"], [data-r="diagnose"], [data-r="diag-apply"], [data-r="sample-save"], [data-r="sample-clear"]');
    if (!button) return;
    try {
      if (button.dataset.r === "diagnose") {
        const loading = refreshReplyWorld();
        if (loading) await loading;
        return diagnose();
      }
      if (button.dataset.r === "diag-apply") return applyDiag();
      if (button.dataset.r === "sample-save") {
        if (!diag?.skeleton.length) return;
        skeleton = [...diag.skeleton];
        paintSample();
        body.querySelector('[data-r="bysample"]').checked = true;
        saveNow();
        button.replaceWith(el('<span class="pa-hint">已记为范本，「提醒时照范本的标签顺序写」已开启。</span>'));
        return;
      }
      if (button.dataset.r === "sample-clear") {
        skeleton = [];
        paintSample();
        saveNow();
        return;
      }
      if (button.dataset.r === "fix") {
        if (!pending) return;
        button.disabled = true;
        undo = await applyReplyFix(pending.index, pending.plan, pending.snapshot);
        await check("latest");
        result.insertAdjacentHTML("afterbegin", `<p class="pa-p">已修正聊天第 ${undo.index + 1} 条消息的标签。<button class="pa-link" data-r="undo-fix">撤销</button></p>`);
        return;
      }
      if (button.dataset.r === "undo-auto") {
        if (!replyAutoFixed) return;
        await undoReplyFix(replyAutoFixed.undo);
        replyAutoFixed = null;
        await check("latest");
        result.insertAdjacentHTML("afterbegin", '<p class="pa-p">已撤销自动修正。</p>');
        return;
      }
      if (button.dataset.r === "undo-fix") {
        if (!undo) return;
        await undoReplyFix(undo);
        undo = null;
        await check("latest");
        result.insertAdjacentHTML("afterbegin", '<p class="pa-p">已撤销修正。</p>');
        return;
      }
      await check(button.dataset.r);
    } catch (e) { showError(e); }
  });
  const semanticResult = body.querySelector('[data-r="semantic-result"]');
  const showSemantic = (report) => {
    semanticResult.innerHTML = `<p class="pa-p">${report.verdict === "suspected" ? "模型标记了疑似内部分析，请人工确认" : "模型未标记疑似内部分析"}（模型自报置信度 ${Math.round(report.confidence * 100)}%，不是准确率）</p>${report.findings.map((f) => `<div class="pa-card"><pre class="pa-pre">${esc(f.excerpt)}</pre><p>${esc(f.reason)}</p></div>`).join("")}<p class="pa-hint">未改写聊天；未发现问题也不保证没有语义泄露。</p>`;
  };
  body.addEventListener("click", async (e) => {
    if (e.target.closest('[data-r="ai-cancel"]')) { reviewCancel?.abort(); return; }
    if (e.target.closest('[data-r="ai-result"]')) {
      const report = semanticReviewResults.get(semanticReplyIdentity());
      if (report) showSemantic(report);
      else semanticResult.innerHTML = '<p class="pa-hint">最近回复暂无有效审查结果，可手动审查或按预设开启自动审查。</p>';
      return;
    }
    const button = e.target.closest('[data-r="ai-latest"], [data-r="ai-paste"]');
    if (!button || reviewCancel) return;
    let text = body.querySelector('[data-r="sample"]').value, identity = null;
    if (button.dataset.r === "ai-latest") {
      const latest = latestReplyForCheck(ctx().chat);
      if (!latest) { semanticResult.innerHTML = '<p class="pa-hint">没有可审查的最近 AI 回复。</p>'; return; }
      text = latest.message.mes; identity = semanticReplyIdentity(latest);
    }
    reviewCancel = new AbortController();
    const buttons = [...body.querySelectorAll('[data-r="ai-latest"], [data-r="ai-paste"]')];
    buttons.forEach((b) => b.disabled = true);
    body.querySelector('[data-r="ai-cancel"]').hidden = false;
    semanticResult.innerHTML = '<p class="pa-hint">正在请求当前模型审查…</p>';
    try { showSemantic(await reviewReplySemantics(text, { signal: reviewCancel.signal, identity, rules: read() })); }
    catch (error) { showError(error, semanticResult); }
    finally {
      reviewCancel = null; buttons.forEach((b) => b.disabled = !semanticAvailable);
      body.querySelector('[data-r="ai-cancel"]').hidden = true;
    }
  });
  // 有没有改过设置（粘贴框不算）
  const raw = () => JSON.stringify([...body.querySelectorAll("input[data-r], textarea[data-r]:not([data-r=sample])")].map((i) => i.type === "checkbox" ? i.checked : i.value));
  const initialRaw = raw();
  return { body, read, showError, dirty: () => raw() !== initialRaw, abort: () => reviewCancel?.abort() };
}
function saveReplyConfig(name, value) {
  const prev = settings().replyGuard?.[name] || {};
  settings().replyGuard = { ...settings().replyGuard, [name]: value };
  saveSettings();
  clearReplyGuard();
  // 只在「自动修正」「下一轮提醒」开关变化时提示
  if (!!prev.autoFix === !!value.autoFix && !!prev.enabled === !!value.enabled) return;
  const on = [value.autoFix && "自动修正回复问题", value.enabled && "下一轮提醒 AI"].filter(Boolean);
  toast(on.length ? `已开启：发现正文格式问题时，${on.join("，并")}` : "自动修正和提醒都已关闭", "success");
}
// 「回复」页：当前预设的正文格式检查、自动修正、语义审查
function mountReply(page, { go } = {}) {
  page.innerHTML = `<div class="pa-toolbar"><div class="pa-picker-slot"></div></div>
    <div class="pa-scroll pa-replypage"><div class="pa-replybox"></div></div>`;
  const box = page.querySelector(".pa-replybox");
  const picker = presetPicker(page.querySelector(".pa-picker-slot"), (n) => setFocusPreset(n));
  let form = null, shown = null, savedSig = "";
  const sigOf = (name) => JSON.stringify(replyGuardConfig(name) || {});
  // 同一预设、设置未在别处改动时保留表单里尚未保存的输入
  // 进入「回复」页时，设置没改过就按最新状态重建（酒馆推理前缀、预设条目可能已变）；在四个分页之间切换保留检查结果
  function render(entering = false) {
    const name = focusPreset();
    picker.set(name);
    if (form && shown === name && savedSig === sigOf(name) && !(entering && !form.dirty())) return;
    form?.abort();
    shown = name;
    if (!name) {
      form = null;
      box.innerHTML = '<p class="pa-empty">酒馆尚未选择预设。</p>';
      return;
    }
    savedSig = sigOf(name);
    form = replyForm(name, { onSaved: () => { savedSig = sigOf(name); } });
    box.replaceChildren(form.body);
  }
  const off = onDraftChange((name, kind) => {
    if (kind === "focus" && draftViewVisible(page)) render();
  });
  return { render: (key, entering) => {
    picker.refresh();
    render(entering);
  }, destroy: () => { off(); form?.abort(); } };
}
