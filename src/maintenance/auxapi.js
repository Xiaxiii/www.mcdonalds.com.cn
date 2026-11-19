// 2.11.23 副 API：麦当劳自己的 AI 功能用哪个 API。2.11.24 起改成「渠道」：
// settings().aux = { channels: [渠道], use: { 用途: 渠道 id } }，用途没选渠道就跟随主 API（酒馆当前连接）。
// 渠道两种：从主 API 的站点添加的 { id, name, site, keyId, model }，网址和密钥跟着站点；
// 只在副 API 里用的 { id, name, url, secretId, model, models }（OpenAI 兼容），密钥存进酒馆密钥库，不进主 API 的站点列表。
// 发请求时不切换酒馆的连接：请求里写明渠道的类型、网址和模型；密钥库里「使用中」的密钥临时换成渠道的，
// 收到回复开头就换回（流式请求，酒馆后台此时已读过密钥）。换着的这段时间酒馆开始生成，先把密钥换回去再让它发请求。
var AUX_USES = [
  { key: "suture", label: "推荐缝合位置" },
  { key: "review", label: "回复语义审查" }
];
var auxSwap = null;
var auxBusy = false;
function auxId() {
  return `ch${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
function auxSettings() {
  const s = settings();
  if (!s.aux || typeof s.aux !== "object" || Array.isArray(s.aux)) s.aux = {};
  const a = s.aux;
  if (!Array.isArray(a.channels)) a.channels = [];
  if (!a.use || typeof a.use !== "object" || Array.isArray(a.use)) a.use = {};
  // 2.11.23 记的是 aux[用途] = { siteId, keyId, model }：换成从站点添加的渠道
  let moved = false;
  for (const u of AUX_USES) {
    const old = a[u.key];
    if (!old || typeof old !== "object") continue;
    delete a[u.key];
    moved = true;
    if (!old.siteId) continue;
    let ch = a.channels.find((c) => c.site === old.siteId && (c.keyId || "") === (old.keyId || "") && c.model === (old.model || ""));
    if (!ch) {
      const site = (s.sites || []).find((x) => x.id === old.siteId);
      ch = { id: auxId(), name: site?.name || "站点", site: old.siteId, ...old.keyId ? { keyId: old.keyId } : {}, model: old.model || "" };
      a.channels.push(ch);
    }
    a.use[u.key] = ch.id;
  }
  if (moved) saveSettings();
  return a;
}
function auxChannels() {
  return auxSettings().channels;
}
function auxChannel(id) {
  return id ? auxChannels().find((c) => c.id === id) || null : null;
}
// 这个用途选的渠道（没选、渠道没了都是 null）
function auxChoice(use) {
  return auxChannel(auxSettings().use[use]);
}
// 渠道发请求时的样子（站点格式）；来自站点的跟着站点，站点删了返回 null
function auxView(ch) {
  if (ch.site) {
    const site = (settings().sites || []).find((x) => x.id === ch.site);
    return site && SOURCES[site.source] ? keyView(site, ch.keyId) : null;
  }
  return { id: ch.id, name: ch.name || "渠道", source: "custom", url: ch.url || "", secretId: ch.secretId || null, model: ch.model || "", models: ch.models || [] };
}
function auxChannelTarget(ch) {
  const view = ch && auxView(ch);
  return view ? { follow: false, channel: ch, view, model: ch.model || view.model || "", name: ch.name || view.name || "渠道" } : null;
}
function auxLiveModel() {
  try {
    const m = ctx().getChatCompletionModel?.();
    if (typeof m === "string" && m.trim()) return m.trim();
  } catch {}
  return liveConnection().model || "";
}
// 这次发给谁：跟随主 API → { follow, model, name }；渠道 → { channel, view, model, name }。
// 选过的渠道删了、或来自的站点删了：退回跟随主 API，missing 为 true
function auxTarget(use) {
  const id = auxSettings().use[use];
  return auxChannelTarget(auxChannel(id)) || { follow: true, model: auxLiveModel(), name: "主 API", missing: !!id };
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
// 请求改发到渠道：类型、网址、模型换成渠道的；主 API 的反向代理和自定义请求头、请求体不带过去
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
// 渠道的密钥换成使用中；返回 true 表示换过，用完要换回
async function auxUseSiteKey(view) {
  const src = SOURCES[view.source];
  if (!view.secretId || !src || typeof mods.secrets?.rotateSecret !== "function") return false;
  const list = (await readSecretState())[src.secret];
  if (!Array.isArray(list)) return false;
  if (!list.some((x) => x.id === view.secretId)) throw new Error(`「${view.name}」的密钥在酒馆密钥库中已不存在，请重新填写`);
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
// 按用途发一次请求，返回 { text, label }。messages：聊天补全格式；maxTokens：回复上限；timeout：毫秒
function auxRequest(use, messages, opts) {
  return auxSend(auxTarget(use), messages, opts);
}
async function auxSend(t, messages, { signal = null, maxTokens = 1200, timeout = 12e4, temperature = null } = {}) {
  const c = ctx();
  const svc = c.ChatCompletionService;
  if (typeof svc?.presetToGeneratePayload !== "function" || typeof svc?.sendRequest !== "function") throw new Error("这个酒馆版本不能单独发请求，请更新酒馆");
  if (semanticMainGenerating) throw new Error("酒馆正在生成，请结束后再试");
  if (auxBusy) throw new Error("副 API 还有一个请求没结束，请稍候");
  const label = auxLabel(t);
  if (t.follow) {
    if (c.mainApi && c.mainApi !== "openai") throw new Error("主 API 不是聊天补全连接，请在「连接 → 副 API」改用渠道");
    if (c.onlineStatus === "no_connection") throw new Error("主 API 没有连接，请先连接，或在「连接 → 副 API」改用渠道");
    if (!t.model) throw new Error("主 API 没有选择模型");
  } else if (!t.model) throw new Error(`「${t.name}」没有选择模型，请到「连接 → 副 API」的渠道里选择`);
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
