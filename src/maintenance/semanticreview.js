var semanticReviewJob = null;
var semanticReviewResults = new Map();
var semanticReviewSeen = new Set();
var semanticMainGenerating = false;
var semanticAutoPending = false;
function semanticReviewAvailable(c = ctx()) {
  return (!c.mainApi || c.mainApi === "openai") && typeof c.getChatCompletionModel === "function" && typeof c.ChatCompletionService?.presetToGeneratePayload === "function" && typeof c.ChatCompletionService?.sendRequest === "function";
}
function semanticReplyIdentity(latest = latestReplyForCheck(ctx().chat)) {
  if (!latest) return null;
  return JSON.stringify([variableContextKey(), latest.index, latest.message.swipe_id ?? null, hashStr(latest.message.mes)]);
}
function cancelSemanticReview() { semanticReviewJob?.controller.abort(); }
function prepareSemanticPayload(work, signal) {
  // 生成参数可能等待分词/偏置等异步工作；取消也必须能退出准备阶段。
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener("abort", abort); reject(new Error("aborted")); };
    if (signal.aborted) { abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(() => { signal.throwIfAborted(); return work(); }).then(
      (value) => { signal.removeEventListener("abort", abort); resolve(value); },
      (error) => { signal.removeEventListener("abort", abort); reject(error); }
    );
  });
}
async function reviewReplySemantics(text, { signal, identity = null, rules = replyGuardConfig() } = {}) {
  const c = ctx();
  if (!semanticReviewAvailable(c)) throw new Error("语义审查需要支持独立聊天补全请求的酒馆版本，并使用聊天补全连接");
  if (c.onlineStatus === "no_connection") throw new Error("请先连接酒馆的聊天补全模型");
  if (semanticMainGenerating) throw new Error("酒馆正在生成，请结束后再审查");
  if (semanticReviewJob) throw new Error("已有语义审查进行中，请等待或取消");
  const model = c.getChatCompletionModel();
  if (typeof model !== "string" || !model.trim()) throw new Error("当前连接没有选择模型，请先在酒馆选择模型");
  const messages = semanticReviewMessages(text, rules), key = variableContextKey(c);
  const controller = new AbortController(), job = { controller };
  const abort = () => controller.abort();
  if (signal?.aborted) throw new Error("审查已取消");
  signal?.addEventListener("abort", abort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 45000);
  semanticReviewJob = job;
  try {
    // 复用酒馆当前连接和服务端密钥；不通过 generateRaw，避免执行回复里的变量宏。
    const service = c.ChatCompletionService;
    const payload = await prepareSemanticPayload(() => service.presetToGeneratePayload({}, {}, { model, messages, stream: false, max_tokens: 800, n: 1, temperature: 0.1 }), controller.signal);
    controller.signal.throwIfAborted();
    const response = await service.sendRequest(payload, true, controller.signal);
    controller.signal.throwIfAborted();
    if (key !== variableContextKey() || identity && identity !== semanticReplyIdentity()) throw new Error("聊天、预设或回复已变化，本次审查结果已忽略");
    const report = parseSemanticReview(response?.content, text);
    if (identity) {
      semanticReviewResults.set(identity, report);
      while (semanticReviewResults.size > 20) semanticReviewResults.delete(semanticReviewResults.keys().next().value);
    }
    return report;
  } catch (error) {
    if (controller.signal.aborted) throw new Error(timedOut ? "语义审查超时，已取消请求" : "语义审查已取消");
    throw error;
  } finally {
    clearTimeout(timer); signal?.removeEventListener("abort", abort);
    if (semanticReviewJob === job) semanticReviewJob = null;
  }
}
function scheduleSemanticReview() {
  if (!semanticAutoPending) return;
  semanticAutoPending = false;
  const c = ctx(), config = replyGuardConfig(), latest = latestReplyForCheck(c.chat);
  if (!config?.semanticAfterReply || !latest || !semanticReviewAvailable(c)) return;
  const identity = semanticReplyIdentity(latest), text = latest.message.mes;
  if (semanticReviewSeen.has(identity) || text.length > SEMANTIC_REVIEW_LIMIT || !text.trim()) return;
  semanticReviewSeen.add(identity);
  while (semanticReviewSeen.size > 40) semanticReviewSeen.delete(semanticReviewSeen.values().next().value);
  setTimeout(async () => {
    if (identity !== semanticReplyIdentity() || semanticMainGenerating || !replyGuardConfig()?.semanticAfterReply) return;
    try {
      const report = await reviewReplySemantics(text, { identity });
      if (report.verdict === "suspected") toast("语义审查发现疑似内部分析，可在「检查 → 回复」的 AI 语义审查中查看；请人工确认", "warning");
    } catch (error) { if (!/已取消/.test(error.message)) toast(`语义审查未完成：${error.message}`, "warning"); }
  }, 0);
}
function bindSemanticReview(on, events) {
  on(events.GENERATION_STARTED, (type, options, dryRun) => { if (!dryRun) { semanticMainGenerating = false; semanticAutoPending = false; cancelSemanticReview(); } });
  on(events.GENERATION_AFTER_COMMANDS, (type, options, dryRun) => {
    if (dryRun) return;
    semanticMainGenerating = ctx().onlineStatus !== "no_connection";
    semanticAutoPending = semanticMainGenerating && !["quiet", "impersonate", "first_message", "continue"].includes(type);
  });
  on(events.GENERATION_ENDED, () => { semanticMainGenerating = false; scheduleSemanticReview(); });
  on(events.GENERATION_STOPPED, () => { semanticMainGenerating = false; semanticAutoPending = false; cancelSemanticReview(); });
  for (const event of [events.CHAT_CHANGED, events.PRESET_CHANGED]) on(event, () => { semanticMainGenerating = false; semanticAutoPending = false; cancelSemanticReview(); });
  cleanups.push(() => { cancelSemanticReview(); semanticReviewResults.clear(); semanticReviewSeen.clear(); });
}
