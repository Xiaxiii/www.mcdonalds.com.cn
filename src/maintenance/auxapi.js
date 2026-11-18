// 2.11.23 副 API：麦当劳自己的 AI 功能用哪个 API。每种用途单独选：跟随主 API（酒馆当前连接），
// 或某个站点（多密钥站点连同分组）加模型，记在 settings().aux[用途] = { siteId, keyId, model }。
// 用站点时不切换酒馆的连接：请求里写明站点的类型、网址和模型；密钥库里「使用中」的密钥临时换成这个站点的，
// 收到回复开头就换回（流式请求，酒馆后台此时已读过密钥）。换着的这段时间酒馆开始生成，先把密钥换回去再让它发请求。
var AUX_USES = [
  { key: "suture", label: "推荐缝合位置", where: "缝合页底栏「AI 推荐」" },
  { key: "review", label: "回复语义审查", where: "检查 → 回复，页尾" }
];
var auxSwap = null;
var auxBusy = false;
function auxSettings() {
  const s = settings();
  if (!s.aux || typeof s.aux !== "object" || Array.isArray(s.aux)) s.aux = {};
  return s.aux;
}
function auxChoice(use) {
  const c = auxSettings()[use];
  return c && typeof c === "object" && c.siteId ? c : null;
}
function auxLiveModel() {
  try {
    const m = ctx().getChatCompletionModel?.();
    if (typeof m === "string" && m.trim()) return m.trim();
  } catch {}
  return liveConnection().model || "";
}
// 这次发给谁：跟随主 API → { follow, model, name }；站点 → { site, view, model, name }。
// 选过的站点被删了：退回跟随主 API，missing 为 true
function auxTarget(use) {
  const c = auxChoice(use);
  if (c) {
    const site = (settings().sites || []).find((x) => x.id === c.siteId);
    if (site && SOURCES[site.source]) {
      const view = keyView(site, c.keyId);
      const model = c.model || view.model || site.model || "";
      return { follow: false, site, view, model, name: view.name || site.name || "站点" };
    }
  }
  return { follow: true, model: auxLiveModel(), name: "主 API", missing: !!c };
}
function auxLabel(t) {
  return `${t.follow ? "跟随主 API" : t.name}${t.model ? ` · ${t.model}` : ""}`;
}
// 收到回复开头、请求结束或酒馆开始生成时，把使用中的密钥换回原来那把
async function auxRestoreKey() {
  const s = auxSwap;
  if (!s) return;
  auxSwap = null;
  if (!s.restore) return;
  try {
    await activateSecret(s.secretKey, s.restore);
  } catch (e) {
    toast(`没能切回原来在用的密钥，请到酒馆的 API 设置里检查：${e.message}`, "error");
  }
}
// 请求改发到站点：类型、网址、模型换成站点的；主 API 的反向代理和自定义请求头、请求体不带过去
function auxPointAt(payload, t) {
  payload.chat_completion_source = t.view.source;
  payload.model = t.model;
  delete payload.reverse_proxy;
  delete payload.proxy_password;
  delete payload.custom_include_headers;
  delete payload.custom_include_body;
  delete payload.custom_exclude_body;
  if (t.view.source === "custom") payload.custom_url = t.view.url || "";
  else delete payload.custom_url;
  // 旧版酒馆没有密钥库：密钥只存在本浏览器，自定义站点放进请求头
  if (!t.view.secretId && t.view.source === "custom") {
    const k = getLocalKey(t.view);
    if (k) payload.custom_include_headers = `Authorization: Bearer ${k}`;
  }
}
// 站点的密钥换成使用中；返回 true 表示换过，用完要换回
async function auxUseSiteKey(view) {
  const src = SOURCES[view.source];
  if (!view.secretId || !src || typeof mods.secrets?.rotateSecret !== "function") return false;
  const list = (await readSecretState())[src.secret];
  if (!Array.isArray(list)) return false;
  if (!list.some((x) => x.id === view.secretId)) throw new Error(`「${view.name}」的密钥在酒馆密钥库中已不存在，请到「连接 → 主 API」重新填写`);
  const cur = list.find((x) => x.active)?.id || null;
  if (cur === view.secretId) return false;
  await activateSecret(src.secret, view.secretId);
  auxSwap = { secretKey: src.secret, restore: cur };
  return true;
}
function auxErrorText(e) {
  if (typeof e === "string") return e;
  return e?.message || apiErrorText(e) || (e?.error && JSON.stringify(e.error)) || String(e || "");
}
// 发一次请求，返回 { text, label }。messages：聊天补全格式；maxTokens：回复上限；timeout：毫秒
async function auxRequest(use, messages, { signal = null, maxTokens = 1200, timeout = 12e4, temperature = null } = {}) {
  const c = ctx();
  const svc = c.ChatCompletionService;
  if (typeof svc?.presetToGeneratePayload !== "function" || typeof svc?.sendRequest !== "function") throw new Error("这个酒馆版本不能单独发请求，请更新酒馆");
  if (semanticMainGenerating) throw new Error("酒馆正在生成，请结束后再试");
  if (auxBusy) throw new Error("副 API 还有一个请求没结束，请稍候");
  const t = auxTarget(use);
  const label = auxLabel(t);
  if (t.follow) {
    if (c.mainApi && c.mainApi !== "openai") throw new Error("主 API 不是聊天补全连接，请在「连接 → 副 API」改用站点");
    if (c.onlineStatus === "no_connection") throw new Error("主 API 没有连接，请先连接，或在「连接 → 副 API」改用站点");
    if (!t.model) throw new Error("主 API 没有选择模型");
  } else if (!t.model) throw new Error(`「${t.name}」没有选择模型，请到「连接 → 副 API」选择`);
  if (signal?.aborted) throw new Error("已取消");
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeout);
  auxBusy = true;
  try {
    const params = { model: t.model, messages, stream: false, max_tokens: maxTokens, n: 1, ...temperature == null ? {} : { temperature } };
    const payload = await prepareSemanticPayload(() => svc.presetToGeneratePayload({}, {}, params), controller.signal);
    controller.signal.throwIfAborted();
    if (!t.follow) auxPointAt(payload, t);
    const swapped = !t.follow && await auxUseSiteKey(t.view);
    // 换了密钥就用流式：收到回复开头时酒馆后台已读过密钥，立刻换回，换着的时间只有等第一个字的那一会儿
    payload.stream = swapped;
    let res = await svc.sendRequest(payload, true, controller.signal);
    let text = "";
    if (typeof res === "function") {
      await auxRestoreKey();
      for await (const part of res()) if (typeof part?.text === "string") text = part.text;
    } else text = typeof res === "string" ? res : res?.content;
    controller.signal.throwIfAborted();
    if (typeof text !== "string" || !text.trim()) throw new Error("模型没有返回内容");
    return { text, label };
  } catch (e) {
    if (controller.signal.aborted) throw new Error(timedOut ? `${Math.round(timeout / 1e3)} 秒没有回复，已取消` : "已取消");
    const raw = auxErrorText(e);
    const why = explainApiError(errStatus(e?.status, raw), raw);
    const err = new Error(`${why}（${label}）`);
    err.why = why;
    err.raw = raw;
    throw err;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    auxBusy = false;
    await auxRestoreKey();
  }
}
function bindAuxApi(on, events) {
  // 处理函数返回 Promise，酒馆等它换回密钥后才发生成请求
  on(events.GENERATION_STARTED, () => auxRestoreKey());
  cleanups.push(() => { auxRestoreKey(); });
}
