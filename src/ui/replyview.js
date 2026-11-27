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
  // 2.12.20 两栏：左「单次检查卡」（最近回复 | 粘贴，检查、AI 审查、结果和修正），右「守卫规则表」（匹配标签、发现问题时、更多规则）；窄于 900px 时上下排
  const aiOff = semanticAvailable ? "" : "disabled";
  const moreId = accId("rmore");
  const sw = (key, on, dis = false, label = "") => `<label class="pa-switch"><input type="checkbox" data-r="${key}" aria-label="${esc(label)}" ${on ? "checked" : ""} ${dis ? "disabled" : ""}><i></i></label>`;
  const srow = (key, title, sub, on, dis = false, extra = "") => `<div class="pa-rt-row"><span class="pa-rt-t"><b>${title}</b>${sub ? `<small>${sub}</small>` : ""}</span>${extra}${sw(key, on, dis, title)}</div>`;
  const body = el(`<div class="pa-form pa-replyform pa-replygrid">
  <section class="pa-rcol pa-rcol-check">
    <div class="pa-card pa-rcard">
      <header class="pa-rcard-head"><b class="pa-rcard-t" data-r="target"></b><div class="pa-seg pa-seg-s pa-rmode" role="tablist" aria-label="检查哪段文字"><button type="button" role="tab" data-r="mode" data-m="latest" class="on" aria-selected="true">最近回复</button><button type="button" role="tab" data-r="mode" data-m="paste" aria-selected="false">粘贴</button></div></header>
      <div class="pa-rcheck pa-racts" data-rm="latest"><button class="pa-btn pa-btn-primary" data-r="latest">检查格式</button><button class="pa-btn" data-r="ai-latest" ${aiOff}>AI 语义审查</button><button class="pa-link pa-raux" data-r="aux" type="button" title="语义审查用的 API，点这里更改"><span data-r="auxname">${esc(auxLabel(auxTarget("review")))}</span> ›</button></div>
      <div class="pa-rpaste" data-rm="paste" hidden>
        <textarea class="pa-input" data-r="sample" rows="3" aria-label="粘贴一条 AI 回复" placeholder="粘贴一条 AI 回复检查格式；粘贴格式正确的回复，点「按范本校准」（只在本页检测，不保存）"></textarea>
        <div class="pa-rcheck pa-racts"><button class="pa-btn pa-btn-primary" data-r="paste">检查格式</button><button class="pa-btn" data-r="diagnose">按范本校准</button><button class="pa-btn" data-r="ai-paste" ${aiOff}>AI 审查</button></div>
      </div>
      <button class="pa-btn pa-btn-s" data-r="ai-cancel" hidden>取消审查</button>
      <div class="pa-rout" data-r="semantic-result" aria-live="polite"></div>
      <div class="pa-rout" data-r="result" aria-live="polite"></div>
    </div>
    ${semanticAvailable ? "" : '<p class="pa-warn">当前酒馆或连接不支持独立聊天补全请求，请升级酒馆并选择聊天补全连接。格式检查仍可使用。</p>'}
    <div data-r="lastremind"></div>
  </section>
  <section class="pa-rcol pa-rcol-rules">
    <div class="pa-rt-head"><h3 class="pa-h">匹配标签</h3><small class="pa-dim" data-r="stamp">按预设自动保存</small></div>
    <div class="pa-card pa-rtable pa-rtags">
    <div class="pa-rt-row pa-rt-in"><label class="pa-rt-t" for="pa-r-body"><b>正文标签</b></label>${fresh && guess?.bodyTag ? whyBtn("body") : ""}<input class="pa-input pa-rt-v" id="pa-r-body" data-r="body" value="${esc(bodyDefault)}" placeholder="content" maxlength="40" aria-describedby="pa-err-body"><small class="pa-field-err" id="pa-err-body" data-err="body" hidden></small></div>
    <div class="pa-rt-row pa-rt-in"><label class="pa-rt-t" for="pa-r-thinking"><b>自定义思考标签</b></label>${!saved.thinkingTag && thinkingDefault ? whyBtn("thinking") : ""}<input class="pa-input pa-rt-v" id="pa-r-thinking" data-r="thinking" value="${esc(thinkingDefault)}" placeholder="think、thinking" maxlength="40" aria-describedby="pa-err-thinking"><small class="pa-field-err" id="pa-err-thinking" data-err="thinking" hidden></small></div>
    <div class="pa-rt-row pa-rt-in pa-rtag-req"><label class="pa-rt-t" for="pa-r-required"><b>必需标签</b></label>${guess?.suggest.length ? whyBtn("required") : ""}<input class="pa-input pa-rt-v" id="pa-r-required" data-r="required" value="${esc((saved.requiredTags || []).join("、"))}" placeholder="可选，卡里的原标签名" aria-describedby="pa-err-required"><small class="pa-field-err" id="pa-err-required" data-err="required" hidden></small><small class="pa-hint" data-r="unused" hidden></small></div>
    </div>
    ${fresh && guess ? guess.bodyTag ? whyNote("body", `已按预设填入 &lt;${esc(guess.bodyTag)}&gt;（条目中出现 ${guess.count} 处），有误可改。`) : '<p class="pa-warn">预设开启的条目中没有正文标签。预设不要求标签包裹正文时，不要开启提醒，否则会让 AI 输出多余标签。</p>' : ""}
    ${guess?.suggest.length ? whyNote("required", `显示正则依赖 ${guess.suggest.map((t) => `&lt;${esc(t)}&gt;`).join("、")} 美化。如需检查是否掉落，可填入这里。`) : ""}
    ${!saved.thinkingTag && thinkingDefault ? whyNote("thinking", `已按酒馆推理前缀填入 &lt;${esc(thinkingDefault)}&gt;。`) : ""}
    <div class="pa-rt-head"><h3 class="pa-h">发现格式问题时</h3></div>
    <div class="pa-card pa-rtable pa-rautoset">
    ${srow("autofix", "自动修正回复标签", "只移动文字、补写标签，不增删文字", saved.autoFix)}
    ${srow("enabled", "下一轮临时提醒 AI", available ? "只在该预设使用中、上一条有问题时提醒" : "当前酒馆缺少生成前事件或临时提示接口，手动检测可用，自动提醒不可用", saved.enabled, !available)}
    ${srow("semantic", "生成后自动语义审查", "每次多一次请求", saved.semanticAfterReply, !semanticAvailable)}
    </div>
    <div class="pa-card pa-rtable pa-rmore">
    <button type="button" class="pa-rt-row pa-rmore-head" data-r="more" aria-expanded="false" aria-controls="${moreId}"><span class="pa-rt-t"><b>更多规则与检测范围</b></span>${CARET_SVG}</button>
    ${accBox(`
      ${srow("outside", "正文标签外允许有文字", "", saved.allowOutside)}
      <div class="pa-rt-row pa-whyrow-check">${`<span class="pa-rt-t"><b>提醒时照范本的标签顺序写</b><small class="pa-rsample" data-r="sampleinfo" hidden></small></span>`}${whyBtn("bysample")}${sw("bysample", saved.skeleton?.length && saved.remindBySample !== false, !saved.skeleton?.length, "提醒时照范本的标签顺序写")}</div>
      ${whyNote("bysample", "先粘贴一份格式正确的回复，点「按范本校准」，再点「记为范本」。只保存标签名和顺序。")}
      <div class="pa-rt-row pa-rai"><span class="pa-rt-t"><b>AI 语义审查</b><small>把这一条回复发给模型，检查是否夹带任务规划、自我指令等内部分析。每次增加一次请求和费用，不改动正文。</small></span><button class="pa-btn pa-btn-s" data-r="ai-result" type="button">最近结果</button></div>
      <div class="pa-rt-row pa-rscope"><ul class="pa-notes">
      <li>检查掉标签、重复或未闭合、正文裹进思考区、状态栏等留在思考区、正文夹入思考标签、正文外大段文字（爆思维链）、思考标签前多了文字没被酒馆解析、疑似推理标题。</li>
      <li>开启提醒后，仅在该预设使用中且上一条回复有问题时，向下一轮加入临时提醒。续写不提醒。提醒只点名正文标签和上面填的必需标签（思考没被解析时还点名推理前缀），不提其他标签。</li>
      <li>代码块和注释中的标签示例不计。可见回复没有正文标签时，在本地查看思考区的标签位置，不展示、不发送。</li>
      <li>一键修正只改名、补齐或移动标签，正文前露出的思考原样移进思考区，不增删文字。提醒不保证模型遵守。</li>
      <li>酒馆只解析开头就是推理前缀（如 &lt;think&gt;）的回复。前缀前面多一句话，整段思考就留在正文里；修正把这句话和前缀标签里的内容一起移进思考区，提醒要求回复以前缀开头。酒馆未开自动解析或思考区已有内容时不检查。</li>
      <li>必需标签只对用到它的对话生效：当前预设开着的条目、角色卡或当前对话生效的世界书里写着这个标签时，才检查、提醒、修正。几张卡的状态栏标签可以一起填，每张卡只按自己的标签检查。</li>
      <li>必需标签整个没出现、回复里却多了预设和角色卡都没用到的块（如把 &lt;status&gt; 写成 &lt;状态&gt;）时，当作写错了名字：提醒只写正确的标签名，不写出错误的名字；只多一个这样的块时，修正会把它改名；自动修正只在块里的子标签和预设里写的对得上时才改。</li>
      <li>必需标签外面多套了一层预设、角色卡、世界书和正则都没用到的标签（如 &lt;状态&gt;&lt;status&gt;…&lt;/status&gt;&lt;/状态&gt;），且外层里没有别的文字时，提醒直接输出必需标签，修正去掉外层标签。</li>
      <li>正文被吞进思考区时，紧挨着的状态栏、小剧场等完整标签块一起搬出来；正文前的块照前几条回复判断。</li>
      <li>按范本校准：粘贴一份格式正确的回复，凡是被判出的问题都算设置与范本不符，逐条给出改法，可一键写回设置。范本只在本页使用；点「记为范本」只保存标签名和顺序，不保存正文。</li></ul></div>`, false, moreId)}
    </div>
  </section>
  </div>`);
  // 当前检测对象：最近回复写楼层，粘贴写「粘贴样本检测」
  const targetEl = body.querySelector('[data-r="target"]');
  const paintTarget = () => {
    if (body.querySelector('[data-r="mode"][data-m="paste"]').classList.contains("on")) { targetEl.textContent = "粘贴样本检测"; return; }
    let latest = null;
    try { latest = latestReplyForCheck(ctx().chat); } catch {}
    targetEl.textContent = latest ? `聊天第 ${latest.index + 1} 楼回复` : "最近回复";
  };
  paintTarget();
  body.querySelector('[data-r="more"]').addEventListener("click", (e) => {
    const acc = body.querySelector(`#${moreId}`);
    accSet(acc, !acc.classList.contains("open"), e.currentTarget);
  });
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
    lastBox.innerHTML = `<details class="pa-card pa-rlast"><summary>最近一次提醒：${two(d.getHours())}:${two(d.getMinutes())}，因聊天第 ${r.index + 1} 条消息</summary><ul class="pa-notes">${r.reasons.map((x) => `<li>${esc(x)}</li>`).join("")}</ul><p class="pa-hint">发给 AI 的原文：</p><pre class="pa-pre">${esc(r.text)}</pre><p class="pa-hint">这条回复本身没有问题时，把它粘贴到上面，点「按范本校准」。</p></details>`;
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
      result.innerHTML = `<div class="pa-card"><p class="pa-p"><b>按现在的设置，这份范本没有问题。</b></p><p class="pa-hint">回复仍被提醒或修正时，原因在那条回复本身：切到「最近回复」点「检查格式」看具体问题。</p>${sk}</div>`;
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
    paintTarget();
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
    const parseTag = replyParseTag();
    const report = checkReplyFormat(text, config, { reasoning, layout, knownTags, parseTag });
    const reminder = buildReplyReminder(report, config);
    const plan = report.issues.length ? planReplyFix(text, config, { reasoning, layout, knownTags, parseTag }) : null;
    pending = plan && latest ? { index: latest.index, plan, snapshot: replyMessageSnapshot(latest.index) } : null;
    const left = plan ? plan.after.issues : [];
    const fixId = accId("rfix");
    const fixDetail = plan ? `<b class="pa-sub">可修正的标签</b><ul class="pa-notes">${plan.steps.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
      ${left.length ? `<p class="pa-warn">修正后仍有 ${left.length} 个问题需人工处理：${esc(left.map((i) => i.text).join("；"))}</p>` : ""}
      <b class="pa-sub">修正后原文预览</b><pre class="pa-pre">${esc(plan.text)}</pre>
      ${pending ? "" : '<p class="pa-hint">粘贴的文字不写回聊天，可复制上面的预览。</p>'}` : "";
    const auto = latest && replyAutoFixFor(latest.index);
    const note = (auto ? `<div class="pa-card"><p class="pa-p">这条回复已自动修正：${esc(auto.steps.join("；"))}。<button class="pa-link" data-r="undo-auto">撤销</button></p></div>` : "") + (latest ? nativeReasoningNote(latest.message) : "");
    const skipped = unused.length ? `<p class="pa-hint">${esc(unusedText(unused))}</p>` : "";
    const n = report.issues.length;
    const detail = n ? `${fixDetail}<b class="pa-sub">下一轮提醒预览</b><pre class="pa-pre">${esc(reminder)}</pre>` : "";
    result.innerHTML = note + skipped + `<div class="pa-rres">
      <div class="pa-rres-head"><i class="pa-rdot${n ? " is-warn" : ""}" aria-hidden="true"></i><div class="pa-rres-t"><p class="pa-p"><b>${esc(source)}：${n ? `发现 ${n} 个格式风险` : "未发现配置范围内的格式问题"}</b></p>${n ? `<ul class="pa-notes">${report.issues.map((i) => `<li>${esc(i.text)}${i.excerpt ? `<pre class="pa-pre">${esc(i.excerpt)}${i.excerpt.length >= 80 ? "…" : ""}</pre>` : ""}</li>`).join("")}</ul>` : ""}</div></div>
      ${n ? `<div class="pa-rres-acts"><button type="button" class="pa-link pa-rres-more" data-r="fixinfo" aria-expanded="false" aria-controls="${fixId}">查看修正说明${CARET_SVG}</button>${pending ? '<button class="pa-btn pa-btn-primary pa-btn-s" data-r="fix">修正这楼</button>' : ""}</div>${accBox(`<div class="pa-rres-det">${detail}</div>`, false, fixId)}` : ""}</div>`;
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
    semanticResult.innerHTML = `<p class="pa-p">${report.verdict === "suspected" ? "模型标记了疑似内部分析，请人工确认" : "模型未标记疑似内部分析"}（模型自报置信度 ${Math.round(report.confidence * 100)}%）</p>${report.findings.map((f) => `<div class="pa-card"><pre class="pa-pre">${esc(f.excerpt)}</pre><p>${esc(f.reason)}</p></div>`).join("")}<p class="pa-hint">未改写聊天。</p>`;
  };
  body.addEventListener("click", (e) => {
    const info = e.target.closest('[data-r="fixinfo"]');
    if (info) { const acc = body.querySelector(`#${info.getAttribute("aria-controls")}`); accSet(acc, !acc.classList.contains("open"), info); return; }
    const m = e.target.closest('[data-r="mode"]')?.dataset.m;
    if (!m) return;
    body.querySelectorAll('[data-r="mode"]').forEach((b) => { const on = b.dataset.m === m; b.classList.toggle("on", on); b.setAttribute("aria-selected", String(on)); });
    body.querySelectorAll("[data-rm]").forEach((x) => { x.hidden = x.dataset.rm !== m; });
    paintTarget();
    if (m === "paste") body.querySelector('[data-r="sample"]').focus({ preventScroll: true });
  });
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
    semanticResult.innerHTML = '<p class="pa-hint">正在审查…</p>';
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
  const picker = presetPicker(page.querySelector(".pa-picker-slot"), (n) => setFocusPreset(n), { use: true });
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
  // 2.11.23 语义审查用哪个 API：点「更改」到「连接 → 副 API」；每次进来按最新的选择写
  page.addEventListener("click", (e) => { if (e.target.closest('[data-r="aux"]')) go?.("aux"); });
  return { render: (key, entering) => {
    picker.refresh();
    render(entering);
    const an = box.querySelector('[data-r="auxname"]');
    if (an) an.textContent = auxLabel(auxTarget("review"));
  }, destroy: () => { off(); form?.abort(); } };
}
