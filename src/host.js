var mods = {};
var presetRegexRefreshName = null;
function stUrl(path) {
  return new URL(path, document.baseURI).href;
}
async function load(name, path) {
  if (mods[name]) return mods[name];
  try {
    mods[name] = await import(
      /* webpackIgnore: true */
      stUrl(path)
    );
  } catch (e) {
    console.warn("[麦当劳] 无法加载", path, e);
    mods[name] = null;
  }
  return mods[name];
}
async function initHost() {
  await Promise.all([
    load("openai", "scripts/openai.js"),
    load("secrets", "scripts/secrets.js"),
    load("wi", "scripts/world-info.js"),
    load("personas", "scripts/personas.js"),
    load("user", "scripts/user.js")
  ]);
  if (!mods.openai) throw new Error("无法读取酒馆的聊天补全模块，酒馆版本可能过旧");
}
// 酒馆账号。同一浏览器切换账号时，本地草稿和备份按账号分开
function userHandle() {
  try {
    return String(mods.user?.getCurrentUserHandle?.() || "default-user");
  } catch {
    return "default-user";
  }
}
// 柏宝箱在运行时，分组的「关闭」标记会在生成时挡住组内条目（它的「分组供电」）
function groupGateActive() {
  return !!globalThis.__baiBaiToolkitExtensionInstalled;
}
function ctx() {
  return globalThis.SillyTavern.getContext();
}
var $ = (...a) => globalThis.jQuery(...a);
function pm() {
  return ctx().getPresetManager("openai");
}
function listPresets() {
  const { preset_names } = pm().getPresetList();
  const names = Array.isArray(preset_names) ? preset_names : Object.keys(preset_names);
  return names.filter((n) => n && n !== "gui").sort((a, b) => a.localeCompare(b, "zh"));
}
function currentPresetName() {
  return mods.openai?.oai_settings?.preset_settings_openai || pm().getSelectedPresetName();
}
function presetRegexActivationInfo(name) {
  const settings = ctx().extensionSettings;
  const allowed = settings?.preset_allowed_regex?.openai;
  return {
    allowed: Array.isArray(allowed) && allowed.includes(name),
    extensionDisabled: settings?.disabledExtensions?.includes("regex") === true,
    current: name === currentPresetName()
  };
}
function presetIndex(name) {
  const { preset_names } = pm().getPresetList();
  return Array.isArray(preset_names) ? preset_names.indexOf(name) : preset_names[name];
}
// 当前预设的条目以酒馆内存（oai_settings）为准，其他字段取预设列表。
// 只拼出引用、不复制；大预设每复制一次都要几十毫秒，以前读一次要整份复制三遍。
var LIVE_PRESET_KEYS = ["prompts", "prompt_order", "extensions"];
function presetView(name) {
  const { presets } = pm().getPresetList();
  const idx = presetIndex(name);
  if (idx === void 0 || idx < 0 || !presets[idx]) throw new Error(`未找到预设「${name}」`);
  const live = name === currentPresetName() ? mods.openai?.oai_settings : null;
  if (!live) return presets[idx];
  const view = { ...presets[idx] };
  for (const k of LIVE_PRESET_KEYS) if (live[k] !== void 0) view[k] = live[k];
  return view;
}
function readPreset(name) {
  return structuredClone(presetView(name));
}
function replaceInPlace(target, src) {
  for (const k of Object.keys(target)) if (!(k in src)) delete target[k];
  Object.assign(target, src);
}
// 柏宝箱的分组运行时缓存在全局状态里。只使当前预设的缓存失效，普通保存不广播导入事件。
function refreshBaibaiGroupCache(name) {
  const state = globalThis.__baiBaiToolkitExtensionInstalled;
  if (!state || typeof state !== "object" || state.presetPromptGroupRuntimePresetName !== name) return;
  delete state.presetPromptGroupRuntimePresetName;
  delete state.presetPromptGroupRuntimeState;
}
// 酒馆收到 OAI_PRESET_CHANGED_AFTER 后会把整份提示词试生成一遍（算 token）、再重画原生条目列表，
// 大预设在手机上每次要卡一两秒。面板开着时连续修改只记下来，关面板或切到后台时通知一次。
// 生成直接读 oai_settings（保存时已原地更新），不依赖这个通知。
var pendingPresetNotice = null;
async function notifyPresetChangedAfter(name) {
  if (typeof panelVisible === "function" && panelVisible()) {
    pendingPresetNotice = name;
    return;
  }
  pendingPresetNotice = null;
  const et2 = ctx().eventTypes || ctx().event_types;
  await ctx().eventSource.emit(et2.OAI_PRESET_CHANGED_AFTER);
}
async function flushPresetNotice() {
  const name = pendingPresetNotice;
  pendingPresetNotice = null;
  // 期间在酒馆里换了预设：酒馆换预设时自己会刷新，旧通知作废
  if (!name || name !== currentPresetName()) return;
  try {
    refreshBaibaiGroupCache(name);
    const et2 = ctx().eventTypes || ctx().event_types;
    await ctx().eventSource.emit(et2.OAI_PRESET_CHANGED_AFTER);
  } catch (e) {
    console.warn("[麦当劳] 通知酒馆刷新预设失败", e);
  }
}
// backup：写之前把服务器上的旧版本存一份备份（每批修改只存一次，由调用方决定）
async function writePreset(name, data, reason = "保存", { backup = true } = {}) {
  const { presets } = pm().getPresetList();
  const idx = presetIndex(name);
  // 备份失败就不写：顶栏承诺了「可以恢复到修改前」，没备份时由调用方问用户怎么办
  if (backup && idx !== void 0 && idx >= 0 && presets[idx]) {
    try {
      await backupPut(name, presets[idx], reason);
    } catch (e) {
      console.warn("[麦当劳] 备份失败", e);
      throw Object.assign(new Error(String(e?.message || e || "未知错误")), { kind: "backup" });
    }
  }
  // 条目以外的设置（温度等参数）有没有变：当前预设的这些设置在酒馆内存里，这里写文件不会同步过去
  const restOf = (p) => {
    if (!p) return "";
    const { prompts: _a, prompt_order: _b, extensions: _c, ...rest } = p;
    try { return JSON.stringify(rest); } catch { return ""; }
  };
  const restChanged = idx !== void 0 && idx >= 0 && presets[idx] && restOf(presets[idx]) !== restOf(data);
  const oldRegex = name === currentPresetName() ? mods.openai?.oai_settings?.extensions?.regex_scripts : presets[idx]?.extensions?.regex_scripts;
  const regexChanged = JSON.stringify(oldRegex) !== JSON.stringify(data.extensions?.regex_scripts);
  await pm().savePreset(name, data, { skipUpdate: true });
  if (idx !== void 0 && idx >= 0) {
    // 原地替换：别的扩展可能拿着旧对象的引用，换成新对象的话它下次保存会把旧内容写回去
    const cur = presets[idx];
    if (cur && typeof cur === "object") { replaceInPlace(cur, structuredClone(data)); forgetSize(cur); }
    else presets[idx] = structuredClone(data);
  }
  if (name === currentPresetName() && restChanged) {
    toast(`「${name}」的温度等参数已写入预设文件。正在使用的参数要在酒馆里重新选一次这个预设才会更新`, "warning");
  }
  if (name === currentPresetName()) {
    const s = mods.openai.oai_settings;
    s.prompts = structuredClone(data.prompts);
    s.prompt_order = structuredClone(data.prompt_order);
    if (s.extensions && typeof s.extensions === "object" && !Array.isArray(s.extensions)) replaceInPlace(s.extensions, structuredClone(data.extensions || {}));
    else s.extensions = structuredClone(data.extensions || {});
    ctx().saveSettingsDebounced();
    const et2 = ctx().eventTypes || ctx().event_types;
    // 不清缓存时，柏宝箱下一次保存会把旧分组写回来。以前借用导入事件清缓存，
    // 会误触发其他扩展的「导入自动迁移」；现在仅清理已核对的两个运行时字段。
    refreshBaibaiGroupCache(name);
    await notifyPresetChangedAfter(name);
    // 原生正则每次执行都读取预设数据；PRESET_CHANGED 还会刷新正则面板。
    // 仅通知已获原生许可的预设，避免在本面板下弹出酒馆的首次信任确认。
    const activation = presetRegexActivationInfo(name);
    if (regexChanged && activation.allowed && !activation.extensionDisabled && et2.PRESET_CHANGED) {
      const previousRefresh = presetRegexRefreshName;
      try {
        presetRegexRefreshName = name;
        await ctx().eventSource.emit(et2.PRESET_CHANGED, { apiId: "openai", name });
      } catch (e) {
        console.warn("[麦当劳] 正则已保存，通知酒馆刷新失败", e);
        toast("正则已保存，请重新选择预设以刷新酒馆正则列表", "warning");
      } finally {
        presetRegexRefreshName = previousRefresh;
      }
    }
  }
}
async function selectPreset(name) {
  const value = pm().findPreset(name);
  if (value === void 0) throw new Error(`未找到预设「${name}」`);
  await pm().selectPreset(value);
}
function listWorldbooks() {
  return [...mods.wi?.world_names || []].sort((a, b) => a.localeCompare(b, "zh"));
}
async function readWorldbook(name) {
  const data = await mods.wi.loadWorldInfo(name);
  return worldItems(`wi:${name}`, Object.values(data?.entries || {}));
}
// 2.6.1 世界书条目 → 缝合来源。角色卡内嵌的世界书（keys、enabled、insertion_order）先换成酒馆世界书的写法
function worldEntryOf(e, i) {
  if (!e || typeof e !== "object" || typeof e.content !== "string") return null;
  if (Array.isArray(e.key)) return structuredClone(e);
  const ext = e.extensions || {};
  const out = {
    uid: Number.isFinite(Number(e.uid ?? e.id)) ? Number(e.uid ?? e.id) : i,
    key: Array.isArray(e.keys) ? [...e.keys] : [],
    keysecondary: Array.isArray(e.secondary_keys) ? [...e.secondary_keys] : [],
    comment: String(e.comment || e.name || ""),
    content: e.content,
    constant: !!e.constant,
    selective: e.selective ?? true,
    disable: e.disable != null ? !!e.disable : e.enabled === false,
    order: Number(e.order ?? e.insertion_order ?? 100) || 100
  };
  for (const k of ["position", "depth", "role", "probability"]) {
    const v = typeof e[k] === "number" ? e[k] : ext[k];
    if (typeof v === "number") out[k] = v;
  }
  return out;
}
function worldItems(prefix, list) {
  const entries = (list || []).map(worldEntryOf).filter(Boolean);
  entries.sort((a, b) => (a.displayIndex ?? a.order ?? 0) - (b.displayIndex ?? b.order ?? 0));
  return entries.map((e) => ({
    id: `${prefix}:${e.uid}`,
    uid: e.uid,
    name: e.comment || (Array.isArray(e.key) ? e.key.join(",") : "") || `条目${e.uid}`,
    content: e.content || "",
    enabled: !e.disable,
    // 1.6.0：缝进世界书时整条复制设置；缝进预设时提醒关键词触发
    raw: e
  }));
}
// 1.6.0 世界书作为缝合目标
var WI_POS = [
  [0, "角色定义之前"], [1, "角色定义之后"], [5, "示例消息之前"], [6, "示例消息之后"],
  [2, "作者注释之前"], [3, "作者注释之后"], [4, "按深度插入"]
];
function wiSorted(data) {
  return Object.values(data?.entries || {}).sort((a, b) => (a.displayIndex ?? a.order ?? 0) - (b.displayIndex ?? b.order ?? 0) || a.uid - b.uid);
}
// 新条目：优先用酒馆自己的函数（字段齐全），旧版酒馆没有时按常用字段补齐
function newWorldEntry(name, data) {
  if (typeof mods.wi?.createWorldInfoEntry === "function") {
    const e = mods.wi.createWorldInfoEntry(name, data);
    if (e) return e;
  }
  const used = Object.values(data.entries).map((e) => Number(e.uid)).filter(Number.isFinite);
  const uid2 = used.length ? Math.max(...used) + 1 : 0;
  const e = { uid: uid2, key: [], keysecondary: [], comment: "", content: "", constant: false, vectorized: false, selective: true, selectiveLogic: 0, addMemo: true, order: 100, position: 0, disable: false, excludeRecursion: false, preventRecursion: false, delayUntilRecursion: false, probability: 100, useProbability: true, depth: 4, group: "", groupOverride: false, groupWeight: 100, scanDepth: null, caseSensitive: null, matchWholeWords: null, useGroupScoring: null, automationId: "", role: null, sticky: 0, cooldown: 0, delay: 0 };
  data.entries[uid2] = e;
  return e;
}
// 把条目写进世界书，放在 afterUid 之后（null 表示最前面）。返回新条目的 uid。
async function writeWorldEntries(name, fields, afterUid) {
  const wi = mods.wi;
  if (!wi?.loadWorldInfo || !wi?.saveWorldInfo) throw new Error("无法写入世界书，酒馆版本可能过旧");
  const data = await wi.loadWorldInfo(name);
  if (!data?.entries) throw new Error(`无法读取世界书「${name}」`);
  const list = wiSorted(data);
  const at = afterUid == null ? 0 : list.findIndex((e) => String(e.uid) === String(afterUid)) + 1;
  const made = fields.map((f) => {
    const e = newWorldEntry(name, data);
    const { uid: _u, displayIndex: _d, ...rest } = f;
    Object.assign(e, rest);
    return e;
  });
  list.splice(Math.max(0, at), 0, ...made);
  list.forEach((e, i) => { e.displayIndex = i; });
  await wi.saveWorldInfo(name, data, true);
  try {
    wi.reloadEditor?.(name);
  } catch {
  }
  return made.map((e) => e.uid);
}
// 改世界书里已有的一条（按 uid 找），只写传进来的字段
async function updateWorldEntry(name, uid, fields) {
  const wi = mods.wi;
  if (!wi?.loadWorldInfo || !wi?.saveWorldInfo) throw new Error("无法写入世界书，酒馆版本可能过旧");
  const data = await wi.loadWorldInfo(name);
  const e = Object.values(data?.entries || {}).find((x) => String(x.uid) === String(uid));
  if (!e) throw new Error("条目已不存在");
  Object.assign(e, fields);
  await wi.saveWorldInfo(name, data, true);
  try {
    wi.reloadEditor?.(name);
  } catch {
  }
}
function listPersonas() {
  const map = ctx().powerUserSettings?.personas || {};
  return Object.entries(map).map(([avatar, name]) => ({ avatar, name }));
}
function currentPersona() {
  return mods.personas?.user_avatar || null;
}
async function setPersona(avatar) {
  if (!avatar || avatar === currentPersona()) return;
  if (mods.personas?.setUserAvatar) await mods.personas.setUserAvatar(avatar, { toastPersonaNameChange: false });
}
function chatMeta() {
  return ctx().chatMetadata || {};
}
function hasChat() {
  const c2 = ctx();
  return !!(c2.chatId || c2.getCurrentChatId?.());
}
async function saveChatMeta() {
  await ctx().saveMetadata?.();
}
var SOURCES = {
  custom: { label: "自定义（OpenAI 兼容 / 中转站）", secret: "api_key_custom", model: "#custom_model_id", modelList: "#model_custom_select", url: "#custom_api_url_text" },
  openai: { label: "OpenAI", secret: "api_key_openai", model: "#model_openai_select" },
  claude: { label: "Claude", secret: "api_key_claude", model: "#model_claude_select" },
  makersuite: { label: "Google AI Studio（Gemini）", secret: "api_key_makersuite", model: "#model_google_select" },
  openrouter: { label: "OpenRouter", secret: "api_key_openrouter", model: "#model_openrouter_select" },
  deepseek: { label: "DeepSeek", secret: "api_key_deepseek", model: "#model_deepseek_select" }
};
function liveConnection() {
  const s = mods.openai?.oai_settings || {};
  const source = s.chat_completion_source;
  const modelKey = { custom: "custom_model", openai: "openai_model", claude: "claude_model", makersuite: "google_model", openrouter: "openrouter_model", deepseek: "deepseek_model" }[source];
  const secretKey = SOURCES[source]?.secret;
  const st = mods.secrets?.secret_state?.[secretKey];
  const active = Array.isArray(st) ? st.find((x) => x.active) : null;
  return {
    mainApi: ctx().mainApi || $("#main_api").val(),
    source,
    url: source === "custom" ? s.custom_url : "",
    model: modelKey ? s[modelKey] : "",
    secretId: active?.id || null,
    secretMask: active?.value || "",
    online: !!ctx().onlineStatus && ctx().onlineStatus !== "no_connection"
  };
}
// 当前连接和站点记录的是否不一致（类型、网址、模型、密钥，或者没连上）
function siteDiffers(site, live = liveConnection()) {
  return live.source !== site.source
    || site.source === "custom" && (live.url || "") !== (site.url || "")
    || !!site.model && live.model !== site.model
    || !!site.secretId && !!live.secretId && live.secretId !== site.secretId
    || !live.online;
}
// 2.5.0 一个站点可以填多个密钥（同一个站子的不同分组，如按次、按量）。
// 两个以上时记在 site.keys，每个密钥有自己的名称、密钥库编号和模型；只有一个时照旧记在站点上
function siteMulti(site) {
  return Array.isArray(site?.keys) && site.keys.length > 1;
}
// 站点的某个密钥（不传就是上次用的）；单密钥站点就是站点自己
function siteKey(site, keyId = site?.keyId) {
  if (!siteMulti(site)) return site;
  return site.keys.find((k) => k.id === keyId) || site.keys[0];
}
function keyName(site, k) {
  if (!siteMulti(site) || !k) return "";
  return k.name || `密钥 ${site.keys.indexOf(k) + 1}`;
}
// 连接、拉取模型时用的样子：密钥和模型换成这个分组的
function keyView(site, keyId) {
  if (!siteMulti(site)) return site;
  const k = siteKey(site, keyId);
  const v = { ...site, keyId: k.id, secretId: k.secretId || null, keyMask: k.keyMask || "", localKey: !!k.localKey, localId: k.localId, model: k.model || "", models: k.models || [], name: `${site.name}·${keyName(site, k)}` };
  delete v.keys;
  return v;
}
// 连接时密钥重新存进了密钥库（编号变了），记回这个分组
function keepKeyId(site, view) {
  if (view === site || !siteMulti(site)) return;
  const k = siteKey(site, view.keyId);
  if (k && view.secretId && k.secretId !== view.secretId) {
    k.secretId = view.secretId;
    ctx().saveSettingsDebounced();
  }
}
// 旧版酒馆没有密钥库编号：密钥只存在这个浏览器里，不写进会上传到服务器的设置文件
function localKeyName(siteId) {
  return `mcdonalds:key:${userHandle()}:${siteId}`;
}
function getLocalKey(site) {
  try {
    return localStorage.getItem(localKeyName(site.localId || site.id)) || site.legacyKey || null;
  } catch {
    return site.legacyKey || null;
  }
}
function setLocalKey(siteId, key) {
  try {
    if (key) localStorage.setItem(localKeyName(siteId), key);
    else localStorage.removeItem(localKeyName(siteId));
    return true;
  } catch {
    return false;
  }
}
// 2.5.0 存进酒馆密钥库的密钥，在这个浏览器里另留一份，眼睛按钮看全文时用：
// 酒馆默认不把已保存的密钥发回浏览器（config.yaml 的 allowKeysExposure）。和上面一样只存在本浏览器，不进设置文件
function keyCopyName(secretId) {
  return `mcdonalds:keycopy:${userHandle()}:${secretId}`;
}
function getKeyCopy(secretId) {
  try {
    return secretId ? localStorage.getItem(keyCopyName(secretId)) : null;
  } catch {
    return null;
  }
}
function setKeyCopy(secretId, key) {
  if (!secretId) return;
  try {
    if (key) localStorage.setItem(keyCopyName(secretId), key);
    else localStorage.removeItem(keyCopyName(secretId));
  } catch {}
}
// 以前存进设置文件的明文密钥，挪到本浏览器里并从设置文件删掉
function migrateLegacyKeys(sites) {
  let moved = 0;
  for (const site of sites || []) {
    if (!site?.legacyKey) continue;
    if (setLocalKey(site.id, site.legacyKey)) {
      delete site.legacyKey;
      site.localKey = true;
      moved++;
    }
  }
  return moved;
}
function multiKeySupported() {
  return !!(mods.secrets?.rotateSecret && Object.values(mods.secrets.secret_state || {}).some((v) => v === null || Array.isArray(v)));
}
// 把密钥存进酒馆密钥库。酒馆写入新密钥时会把它设为同类型的「使用中」，
// 这里写完再切回原来在用的那把，免得添加站点时把当前连接的密钥换掉。
async function storeKey(source, key, label) {
  const secretKey = SOURCES[source]?.secret;
  if (!secretKey) throw new Error("不支持的连接类型");
  const before = (await readSecretState())[secretKey];
  const prevActive = Array.isArray(before) ? before.find((x) => x.active)?.id || null : null;
  const id = await mods.secrets.writeSecret(secretKey, key, label);
  if (typeof id !== "string" || !id) throw new Error("酒馆没有保存这个密钥，请检查网络或酒馆后台");
  setKeyCopy(id, key);
  if (prevActive && prevActive !== id) await activateSecret(secretKey, prevActive);
  return id;
}
// 切换「使用中」的密钥，并确认真的切过去了（酒馆的 rotateSecret 出错时不会报错）
async function activateSecret(secretKey, id) {
  const cur = (await readSecretState())[secretKey];
  if (Array.isArray(cur) && cur.find((x) => x.active)?.id === id) return;
  if (!await rotateSecretQuiet(secretKey, id)) await mods.secrets.rotateSecret(secretKey, id);
  const after = (await readSecretState())[secretKey];
  if (!Array.isArray(after) || after.find((x) => x.active)?.id !== id) throw new Error("切换密钥没有成功");
}
// 2.6.3 酒馆的 rotateSecret 换完密钥会触发 #main_api 的 change，重新加载当前预设：预设带正则时，每换一次弹一条
// 「包含被启用的正则，重新加载聊天以使正则生效」。拉取模型要换过去再换回来，就弹两条。
// 这里直接调换密钥的接口，不触发重新加载；需要连接时由调用方自己连。接口不可用时返回 false，改用 rotateSecret
async function rotateSecretQuiet(secretKey, id) {
  try {
    const r = await fetch(stUrl("api/secrets/rotate"), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...ctx().getRequestHeaders?.() || {} },
      body: JSON.stringify({ key: secretKey, id }),
      cache: "no-cache"
    });
    return r.ok;
  } catch {
    return false;
  }
}
// 删掉一把密钥（添加站点时取消了，刚存进去的密钥不留在密钥库里）
async function dropKey(source, id) {
  setKeyCopy(id, null);
  const secretKey = SOURCES[source]?.secret;
  if (!secretKey || !id || typeof mods.secrets?.deleteSecret !== "function") return;
  try {
    await mods.secrets.deleteSecret(secretKey, id);
  } catch (e) {
    console.warn("[麦当劳] 删除密钥失败", e);
  }
}
// 2.5.0 取出已保存密钥的全文：先用本浏览器留的那份；没有再问酒馆，酒馆要在 config.yaml 打开 allowKeysExposure 才给。
// 返回 { value } 拿到了；{ blocked: true } 酒馆不让看；{} 其他原因没拿到
async function revealSecret(source, id) {
  const secretKey = SOURCES[source]?.secret;
  if (!secretKey || !id) return {};
  const copy = getKeyCopy(id);
  if (copy) return { value: copy };
  if (typeof mods.secrets?.findSecret === "function") {
    try {
      const v = await mods.secrets.findSecret(secretKey, id);
      if (typeof v === "string" && v) {
        setKeyCopy(id, v);
        return { value: v };
      }
    } catch {}
  }
  // 旧版没有 findSecret，或者它吞掉了原因：直接问酒馆后台，看是不是被拒绝
  try {
    const r = await fetch(stUrl("api/secrets/find"), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...ctx().getRequestHeaders?.() || {} },
      body: JSON.stringify({ key: secretKey, id }),
      cache: "no-cache"
    });
    if (r.ok) {
      const d = await r.json().catch(() => ({}));
      if (typeof d?.value === "string" && d.value) {
        setKeyCopy(id, d.value);
        return { value: d.value };
      }
      return {};
    }
    return { blocked: r.status === 403 || r.status === 401 };
  } catch {
    return {};
  }
}
async function readSecretState() {
  const fresh = typeof mods.secrets?.readSecretState === "function";
  if (fresh) await mods.secrets.readSecretState();
  const state = mods.secrets?.secret_state || {};
  // 没有重新读取的接口时 secret_state 可能是旧缓存，刚存的密钥不在里面，不能拿它来清留底
  if (fresh) pruneKeyCopies(state);
  return state;
}
// 2.5.7 酒馆密钥库里已经删掉的密钥，本浏览器的留底也删掉，明文不一直留着。
// 只在读到了密钥库（至少一类有密钥）时才清，读取失败、还没加载时不动
function pruneKeyCopies(state) {
  try {
    const lists = Object.values(state || {}).filter(Array.isArray);
    if (!lists.some((l) => l.length)) return;
    const alive = new Set(lists.flat().map((x) => x?.id).filter(Boolean));
    const prefix = `mcdonalds:keycopy:${userHandle()}:`;
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith(prefix) && !alive.has(k.slice(prefix.length))) localStorage.removeItem(k);
    }
  } catch {}
}
function setSelect(sel, value) {
  const el2 = $(sel);
  if (!el2.length || !value) return;
  // 2.8.8 已经选着这一项时不再触发 change：酒馆每次换模型都会重算提示词（手机上要几百毫秒），连上后列表已按记录选好
  if (el2.is("select") && el2.val() === value) return;
  if (el2.is("select") && !el2.find(`option[value="${CSS.escape(value)}"]`).length) {
    el2.append($("<option></option>").val(value).text(value));
  }
  el2.val(value).trigger("change");
}
async function applyConnection(site, { connect = true } = {}) {
  const src = SOURCES[site.source];
  if (!src) throw new Error("不支持的连接类型");
  if ($("#main_api").val() !== "openai") $("#main_api").val("openai").trigger("change");
  if ($("#chat_completion_source").val() !== site.source) {
    $("#chat_completion_source").val(site.source).trigger("change");
    await sleep(150);
  }
  if (site.source === "custom" && src.url) {
    $(src.url).val(site.url || "").trigger("input");
  }
  if (site.secretId && mods.secrets?.rotateSecret) {
    const state = await readSecretState();
    const list = state[src.secret];
    if (Array.isArray(list) && list.some((x) => x.id === site.secretId)) {
      await activateSecret(src.secret, site.secretId);
    } else if (getLocalKey(site)) {
      const id = await mods.secrets.writeSecret(src.secret, getLocalKey(site), site.name);
      if (typeof id !== "string" || !id) throw new Error("酒馆没有保存这个密钥");
      setKeyCopy(id, getLocalKey(site));
      // 记下新编号：不记的话，每次连接都会往密钥库里再存一把同样的密钥
      site.secretId = id;
      ctx().saveSettingsDebounced();
    } else {
      throw new Error(`「${site.name}」的密钥在酒馆密钥库中已不存在，请重新填写`);
    }
  } else if (getLocalKey(site)) {
    await mods.secrets.writeSecret(src.secret, getLocalKey(site));
  }
  if (site.model) {
    if (site.source === "custom") {
      $("#custom_model_id").val(site.model).trigger("input");
      setSelect("#model_custom_select", site.model);
    } else {
      setSelect(src.model, site.model);
    }
  } else if (site.source === "custom") {
    // 2.6.1 站点没记模型、上一个站点的模型也不在这个站点的列表里：清空，连上后酒馆从新站点的列表里选第一个
    const cur = String($("#custom_model_id").val() || "");
    if (cur && !(site.models || []).includes(cur)) $("#custom_model_id").val("").trigger("input");
  }
  if (connect) {
    $("#api_button_openai").trigger("click");
    await waitConnect(15e3);
    if (site.model && site.source === "custom") {
      $("#custom_model_id").val(site.model).trigger("input");
      setSelect("#model_custom_select", site.model);
    }
  }
  return liveConnection();
}
// 1.3.7：当前连接能选的模型（酒馆连上后自己拉到的列表）
function liveModelOptions() {
  const src = SOURCES[mods.openai?.oai_settings?.chat_completion_source];
  if (!src) return [];
  return $(`${src.modelList || src.model} option`).map((_, o) => o.value).toArray().filter(Boolean);
}
function setLiveModel(model) {
  const source = mods.openai?.oai_settings?.chat_completion_source;
  const src = SOURCES[source];
  if (!src || !model) return;
  if (source === "custom") {
    $("#custom_model_id").val(model).trigger("input");
    setSelect("#model_custom_select", model);
  } else setSelect(src.model, model);
}
function customModelOptions() {
  return $("#model_custom_select option").map((_, o) => o.value).toArray().filter(Boolean);
}
// 1.3.9：已经连着的时候点「连接」，状态一开始就是在线，只看在线会抢在新请求回来之前返回。
// 先等酒馆的连接按钮进入忙碌状态，再等它结束。
async function waitConnect(ms) {
  const busy = () => $("#api_button_openai").hasClass("disabled") || $("#api_loading_openai").is(":visible");
  const t0 = Date.now();
  while (Date.now() - t0 < 800 && !busy()) await sleep(50);
  while (Date.now() - t0 < ms && busy()) await sleep(200);
  return waitOnline(Math.max(0, ms - (Date.now() - t0)));
}
// 1.3.9：直接向酒馆后端要模型列表（酒馆自己连接时调用的也是这个接口），不等界面上的下拉框刷新
async function fetchModelList(site) {
  const s = mods.openai?.oai_settings || {};
  const body = { chat_completion_source: site.source, reverse_proxy: s.reverse_proxy, proxy_password: s.proxy_password };
  if (site.source === "custom") {
    body.custom_url = site.url;
    body.custom_include_headers = s.custom_include_headers;
  }
  const r = await fetch(stUrl("api/backends/chat-completions/status"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...ctx().getRequestHeaders?.() || {} },
    body: JSON.stringify(body),
    cache: "no-cache"
  });
  if (!r.ok) throw new Error(`酒馆返回 ${r.status}`);
  const data = await r.json().catch(() => ({}));
  const raw = Array.isArray(data?.data) ? data.data : Array.isArray(data?.data?.data) ? data.data.data : Array.isArray(data?.models) ? data.models : Array.isArray(data) ? data : [];
  const list = [...new Set(raw.map((m) => typeof m === "string" ? m : m?.id || m?.name).filter(Boolean))];
  if (data?.error && !list.length) throw new Error("站点未返回模型列表，请检查网址和密钥");
  return list;
}
// 用这个站点保存的密钥做一件事，做完换回原来在用的密钥
async function withSiteKey(site, fn) {
  const src = SOURCES[site.source];
  let restore = null;
  if (site.secretId && mods.secrets?.rotateSecret && src) {
    const list = (await readSecretState())[src.secret];
    if (Array.isArray(list)) {
      if (!list.some((x) => x.id === site.secretId)) throw new Error(`「${site.name || "站点"}」的密钥在酒馆密钥库中已不存在，请重新填写`);
      const cur = list.find((x) => x.active)?.id || null;
      if (cur !== site.secretId) {
        await activateSecret(src.secret, site.secretId);
        restore = cur;
      }
    }
  }
  try {
    return await fn();
  } finally {
    if (restore) {
      try {
        await activateSecret(src.secret, restore);
      } catch (e) {
        toast(`没能切回原来在用的密钥，请到酒馆的 API 设置里检查：${e.message}`, "error");
      }
    }
  }
}
async function waitOnline(ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const st = ctx().onlineStatus;
    if (st && st !== "no_connection") return true;
    await sleep(300);
  }
  return false;
}
function bindPresetToConnection() {
  return !!mods.openai?.oai_settings?.bind_preset_to_connection;
}
function setBindPresetToConnection(on) {
  $("#bind_preset_to_connection").prop("checked", !!on).trigger("input");
  if (mods.openai?.oai_settings) mods.openai.oai_settings.bind_preset_to_connection = !!on;
  ctx().saveSettingsDebounced();
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
var DB = "mcdonalds";
var BACKUP_MAX = 10;
// 2.4.2：自动备份可关闭，保留份数可选 1–30。世界书的备份同样适用
function backupOn() {
  return settings().autoBackup !== false;
}
function backupMax() {
  const n = Math.round(Number(settings().backupMax));
  return n >= 1 && n <= 30 ? n : BACKUP_MAX;
}
var dbp = null;
function db() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 2);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains("backups")) {
        const s = d.createObjectStore("backups", { keyPath: "id", autoIncrement: true });
        s.createIndex("preset", "preset");
      }
      // 1.3.9：自定义背景图等本地文件，只存在这个浏览器里
      if (!d.objectStoreNames.contains("assets")) d.createObjectStore("assets");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}
function tx(store, mode, fn) {
  return db().then((d) => new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const r = fn(t.objectStore(store));
    t.oncomplete = () => resolve(r?.result ?? r);
    t.onerror = () => reject(t.error);
  }));
}
// 旧版没有记账号的备份，只给默认账号看
function backupMine(b) {
  return b.user ? b.user === userHandle() : userHandle() === "default-user";
}
async function backupPut(preset, data, reason) {
  if (!backupOn()) return;
  await tx("backups", "readwrite", (s) => s.add({ preset, user: userHandle(), reason, time: Date.now(), data: structuredClone(data) }));
  const list = await backupList(preset);
  for (const old of list.slice(backupMax())) await tx("backups", "readwrite", (s) => s.delete(old.id));
}
async function backupList(preset) {
  const all = await tx("backups", "readonly", (s) => s.index("preset").getAll(preset));
  return (all || []).filter(backupMine).sort((a, b) => b.time - a.time);
}
async function backupGet(id) {
  return tx("backups", "readonly", (s) => s.get(id));
}
async function assetPut(key, blob) {
  await tx("assets", "readwrite", (s) => s.put(blob, key));
}
async function assetGet(key) {
  return tx("assets", "readonly", (s) => s.get(key));
}
async function assetDel(key) {
  await tx("assets", "readwrite", (s) => s.delete(key));
}

// ---- 1.5.0 预设归档：把预设移到服务器的「用户文件」目录（酒馆打开时不下载），需要时再移回预设文件夹
// 用的都是酒馆自带接口：/api/files/upload、/api/files/delete（数据库附件用的同一套）、/api/presets/save、/api/presets/delete。
// 云端酒馆、安卓本地酒馆（Termux）都一样可用。
async function stPost(path, body) {
  return fetch(stUrl(path), { method: "POST", headers: ctx().getRequestHeaders?.() || { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
async function gzipText(text) {
  if (typeof CompressionStream === "undefined") return null;
  try {
    return await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"))).blob();
  } catch {
    return null;
  }
}
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ""));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
// 上传一个文件到用户文件目录，返回服务器给的路径（如 user/files/xxx）
async function userFilePut(name, blob) {
  const r = await stPost("api/files/upload", { name, data: await blobToBase64(blob) });
  if (!r.ok) throw new Error(`上传失败（${r.status}${r.status === 413 ? "，文件太大" : ""}）`);
  const j = await r.json().catch(() => ({}));
  return String(j.path || `user/files/${name}`).replace(/\\/g, "/").replace(/^\/+/, "");
}
async function userFileDel(path) {
  const r = await stPost("api/files/delete", { path });
  if (!r.ok && r.status !== 404) throw new Error(`删除文件失败（${r.status}）`);
}
async function userFileGetText(path, gz) {
  const r = await fetch(stUrl(path), { cache: "no-store" });
  if (!r.ok) throw new Error(r.status === 404 ? "服务器上找不到归档文件" : `读取归档失败（${r.status}）`);
  const buf = await r.arrayBuffer();
  if (gz && typeof DecompressionStream !== "undefined") {
    try {
      return await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
    } catch {
      // 个别服务器会自动解压 .gz，拿到的已经是文本
    }
  }
  return new TextDecoder().decode(buf);
}
// 从服务器删除预设（只删预设文件夹里的那个文件），并从酒馆的预设下拉框里去掉。不能删当前预设。
async function deletePresetFile(name) {
  if (name === currentPresetName()) throw new Error("不能删除正在使用的预设");
  // 名称列表是数组时，下标和预设数据一一对应，只删名称会让后面的全部错位，这种情况不处理
  if (Array.isArray(pm().getPresetList().preset_names)) throw new Error("当前酒馆版本不支持在这里删除预设");
  let r = await stPost("api/presets/delete", { name, apiId: "openai" });
  if (r.status === 404 || r.status === 405) r = await stPost("api/presets/delete-openai", { name });
  if (!r.ok && r.status !== 404) throw new Error(`删除预设失败（${r.status}）`);
  const { preset_names } = pm().getPresetList();
  const idx = presetIndex(name);
  delete preset_names[name];
  // 预设数组本身不动：酒馆下拉框的值是数组下标，删掉中间一个会让后面的全部错位
  if (idx !== void 0 && idx >= 0) $(`#settings_preset_openai option[value="${idx}"]`).remove();
}
// 把预设写回预设文件夹，并加进下拉框。返回服务器实际使用的名称。
async function restorePresetFile(name, data) {
  const r = await stPost("api/presets/save", { apiId: "openai", name, preset: data });
  if (!r.ok) throw new Error(`恢复失败（${r.status}）`);
  const j = await r.json().catch(() => ({}));
  const real = j.name || name;
  const { presets, preset_names } = pm().getPresetList();
  const idx = presetIndex(real);
  if (idx !== void 0 && idx >= 0) {
    presets[idx] = structuredClone(data);
  } else if (!Array.isArray(preset_names)) {
    presets.push(structuredClone(data));
    preset_names[real] = presets.length - 1;
    const opt = document.createElement("option");
    opt.value = String(presets.length - 1);
    opt.textContent = real;
    document.querySelector("#settings_preset_openai")?.append(opt);
  }
  return real;
}
// 不压缩的 zip（预设文本本来就要下载到本地，打包只是为了一次下完）。文件名用 UTF-8。
var CRC_T = null;
function crc32(bytes) {
  if (!CRC_T) {
    CRC_T = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_T[i] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_T[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function makeZip(files) {
  const enc = new TextEncoder();
  const parts = [], central = [];
  let offset = 0;
  const used = new Set();
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  for (const f of files) {
    let fname = String(f.name).replace(/[\\/:*?"<>|]/g, "_");
    while (used.has(fname)) fname = fname.replace(/(\.json)?$/, "_$1");
    used.add(fname);
    const name = enc.encode(fname);
    const data = typeof f.data === "string" ? enc.encode(f.data) : f.data;
    const crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(10, dosTime, true); h.setUint16(12, dosDate, true);
    h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true);
    parts.push(h, name, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(12, dosTime, true); c.setUint16(14, dosDate, true);
    c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    central.push(c, name);
    offset += 30 + name.length + data.length;
  }
  const csize = central.reduce((n, x) => n + x.byteLength, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
  e.setUint32(12, csize, true); e.setUint32(16, offset, true);
  return new Blob([...parts, ...central, e], { type: "application/zip" });
}
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  // 立即移除链接，部分浏览器会丢掉文件名（变成「download」），稍后再移除
  setTimeout(() => a.remove(), 3000);
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
