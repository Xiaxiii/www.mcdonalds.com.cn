// 2.12.0 按角色卡绑定世界书、切换正则。
// 绑给角色的世界书写进酒馆自己的「角色附加世界书」（world_info.charLore，按头像文件名对应角色）：
// 只在和这个角色聊天时生效，换角色时酒馆自动换，不影响别的角色，也不依赖本扩展常驻。
// 角色卡自带的那本（data.extensions.world）酒馆总是读入；在这里关掉时，生成前从角色世界书里去掉它（WORLDINFO_ENTRIES_LOADED），角色卡不改。
// 2.12.2 开着的才挂在角色名下，关掉就回到「其他世界书」；2.12.0–2.12.1 记的「关着也列在角色下」（bookKeep）不再使用，启动时清掉。
var charFileBase = (a) => String(a || "").replace(/\.[^.]+$/, "");
function charInfo(ch, chid) {
  return ch?.avatar ? { chid, ch, avatar: ch.avatar, key: charFileBase(ch.avatar), name: String(ch.name || charFileBase(ch.avatar)) } : null;
}
// 正在聊天的角色；群聊、没打开角色时为 null
function currentChar() {
  try {
    const c = ctx();
    if (c.groupId) return null;
    const id = c.characterId;
    if (id === undefined || id === null || id === "") return null;
    const n = Number(id);
    return charInfo(c.characters?.[n], n);
  } catch {
    return null;
  }
}
function inGroupChat() {
  try { return !!ctx().groupId; } catch { return false; }
}
function listChars() {
  const list = ctx().characters || [];
  return list.map((ch, i) => charInfo(ch, i)).filter(Boolean);
}
function charByKey(key) {
  if (!key) return null;
  return listChars().find((c) => c.key === key) || null;
}
function charAvatarUrl(ci) {
  if (!ci?.avatar) return "";
  try {
    const f = ctx().getThumbnailUrl;
    if (typeof f === "function") return String(f("avatar", ci.avatar) || "");
  } catch {}
  return stUrl(`thumbnail?type=avatar&file=${encodeURIComponent(ci.avatar)}`);
}
function charPrimaryBook(ci) {
  return String(ci?.ch?.data?.extensions?.world || "");
}
function charLoreList() {
  const lore = mods.wi?.world_info?.charLore;
  return Array.isArray(lore) ? lore : [];
}
function charExtraBooks(key) {
  const e = charLoreList().find((x) => x?.name === key);
  return Array.isArray(e?.extraBooks) ? [...e.extraBooks] : [];
}
// 写回酒馆设置。世界书模块自己保存前会把 globalSelect 对齐当前全局列表，这里照做，免得写回旧的全局列表
function saveWorldSettings() {
  const wi = mods.wi;
  try { if (wi?.world_info && Array.isArray(wi.selected_world_info)) Object.assign(wi.world_info, { globalSelect: wi.selected_world_info }); } catch {}
  ctx().saveSettingsDebounced();
}
function setCharExtraBooks(key, books) {
  const wi = mods.wi?.world_info;
  if (!wi || typeof wi !== "object") throw new Error("读不到酒馆的世界书设置，酒馆版本可能过旧");
  const next = [...new Set((books || []).filter(Boolean))];
  if (!Array.isArray(wi.charLore)) wi.charLore = [];
  const lore = wi.charLore;
  const i = lore.findIndex((x) => x?.name === key);
  if (!next.length) { if (i >= 0) lore.splice(i, 1); }
  else if (i < 0) lore.push({ name: key, extraBooks: next });
  else lore[i] = { ...lore[i], extraBooks: next };
  saveWorldSettings();
}
function globalBooks() {
  const list = mods.wi?.selected_world_info;
  return Array.isArray(list) ? [...list] : [];
}
// 全局世界书：照酒馆自己的做法改「全局世界书」下拉框再触发 change，酒馆的列表和保存都由它处理；
// 没有这个下拉框时（旧版、测试）直接改列表
function setGlobalBook(name, on) {
  const names = mods.wi?.world_names || [];
  const sel = typeof $ === "function" ? $("#world_info") : null;
  if (sel?.length) {
    const opt = sel.find("option").filter(function () { return this.textContent === name; });
    const byIdx = names.indexOf(name) >= 0 ? sel.find(`option[value="${names.indexOf(name)}"]`) : null;
    const o = opt.length ? opt.first() : byIdx;
    if (o?.length) {
      o.prop("selected", !!on);
      sel.trigger("change");
      return;
    }
  }
  const arr = mods.wi?.selected_world_info;
  if (!Array.isArray(arr)) throw new Error("读不到酒馆的全局世界书列表，酒馆版本可能过旧");
  const i = arr.indexOf(name);
  if (on && i < 0) arr.push(name);
  if (!on && i >= 0) arr.splice(i, 1);
  saveWorldSettings();
  try {
    const et2 = ctx().eventTypes || ctx().event_types;
    if (et2?.WORLDINFO_SETTINGS_UPDATED) ctx().eventSource.emit(et2.WORLDINFO_SETTINGS_UPDATED);
  } catch {}
}
function chatBook() {
  try { return hasChat() ? String(chatMeta().world_info || "") : ""; } catch { return ""; }
}
async function setChatBook(name) {
  const m = chatMeta();
  if (name) m.world_info = name;
  else delete m.world_info;
  await saveChatMeta();
}
// 角色卡自带的那本能不能单独关：要酒馆在生成前发出 WORLDINFO_ENTRIES_LOADED
function ownOffSupported() {
  try { return !!(ctx().eventTypes || ctx().event_types)?.WORLDINFO_ENTRIES_LOADED; } catch { return false; }
}
function ownBookOff(key) {
  return settings().bookOwnOff?.[key] === true;
}
function setOwnBookOff(key, off) {
  const s = settings();
  if (!s.bookOwnOff || typeof s.bookOwnOff !== "object") s.bookOwnOff = {};
  if (off) s.bookOwnOff[key] = true;
  else delete s.bookOwnOff[key];
  saveSettings();
}
function dropKeptBooks() {
  try { if (settings().bookKeep !== undefined) { delete settings().bookKeep; saveSettings(); } } catch {}
}
// 没绑世界书的角色卡：按名称猜哪本是它的（导入角色卡时酒馆另存的「角色名's Lorebook」、角色卡内嵌世界书的名字、名字里带角色名的）
function guessCharBooks(ci, names = listWorldbooks()) {
  if (!ci || charPrimaryBook(ci)) return [];
  const nm = ci.name.trim();
  const emb = String(ci.ch?.data?.character_book?.name || "").trim();
  const exact = new Set([emb, `${nm}'s Lorebook`, nm].filter(Boolean));
  const out = names.filter((n) => exact.has(n));
  if (nm.length >= 2) for (const n of names) if (!out.includes(n) && n.includes(nm)) out.push(n);
  return out.slice(0, 3);
}
// 这本书对这个角色开着吗（只看角色这一层：角色卡自带且没关，或在附加世界书里）
function charBookOn(ci, name) {
  if (!ci || !name) return false;
  if (name === charPrimaryBook(ci)) return !ownBookOff(ci.key) || charExtraBooks(ci.key).includes(name);
  return charExtraBooks(ci.key).includes(name);
}
// 开关：给这个角色开或关一本书（角色卡自带的那本记在本扩展设置里，其他的写进酒馆的角色附加世界书）
function setCharBookOn(ci, name, on) {
  if (!ci) throw new Error("没有打开角色");
  if (name === charPrimaryBook(ci)) {
    if (!on && !ownOffSupported()) throw new Error("酒馆版本较旧，角色卡自带的世界书不能单独关");
    setOwnBookOff(ci.key, !on);
    return;
  }
  const extra = charExtraBooks(ci.key);
  setCharExtraBooks(ci.key, on ? [...extra, name] : extra.filter((x) => x !== name));
}
// 用在哪：none 不用、char 这个角色、all 所有角色（全局）
function bookScope(ci, name) {
  if (globalBooks().includes(name)) return "all";
  return charBookOn(ci, name) ? "char" : "none";
}
function setBookScope(ci, name, scope) {
  const wasGlobal = globalBooks().includes(name);
  if (scope === "all") {
    if (!wasGlobal) setGlobalBook(name, true);
    // 全局开着时酒馆不再从角色这一层读它；附加世界书里的那份去掉，免得改回「不用」时又从角色这层冒出来
    if (ci && name !== charPrimaryBook(ci) && charExtraBooks(ci.key).includes(name)) {
      setCharExtraBooks(ci.key, charExtraBooks(ci.key).filter((x) => x !== name));
    }
    return;
  }
  if (wasGlobal) setGlobalBook(name, false);
  if (!ci) return;
  if (scope === "char") return setCharBookOn(ci, name, true);
  if (name === charPrimaryBook(ci)) {
    if (!ownOffSupported()) throw new Error("酒馆版本较旧，角色卡自带的世界书不能单独关");
    setOwnBookOff(ci.key, true);
  }
  setCharExtraBooks(ci.key, charExtraBooks(ci.key).filter((x) => x !== name));
}
// 生成前：当前角色的角色卡世界书被关掉时，从角色世界书里去掉它
function dropOwnBookEntries(lore) {
  const ci = currentChar();
  if (!ci || !ownBookOff(ci.key)) return;
  const w = charPrimaryBook(ci);
  if (!w || charExtraBooks(ci.key).includes(w)) return;
  const list = lore?.characterLore;
  if (!Array.isArray(list)) return;
  for (let i = list.length - 1; i >= 0; i--) if (list[i]?.world === w) list.splice(i, 1);
}
function bindCharBooks(on, et2) {
  dropKeptBooks();
  if (et2?.WORLDINFO_ENTRIES_LOADED) on(et2.WORLDINFO_ENTRIES_LOADED, (lore) => { try { dropOwnBookEntries(lore); } catch (e) { console.warn("[麦当劳] 跳过角色卡世界书失败", e); } });
}

// ---- 正则：全局、角色卡、预设三处，开关写回各自的地方
function globalRegexList() {
  const list = ctx().extensionSettings?.regex;
  return Array.isArray(list) ? list : [];
}
function charRegexList(ci) {
  const list = ci?.ch?.data?.extensions?.regex_scripts;
  return Array.isArray(list) ? list : [];
}
function charRegexAllowed(ci) {
  const list = ctx().extensionSettings?.character_allowed_regex;
  return !!ci && Array.isArray(list) && list.includes(ci.avatar);
}
function allowCharRegex(ci) {
  const s = ctx().extensionSettings;
  if (!Array.isArray(s.character_allowed_regex)) s.character_allowed_regex = [];
  if (!s.character_allowed_regex.includes(ci.avatar)) s.character_allowed_regex.push(ci.avatar);
  ctx().saveSettingsDebounced();
  if (currentChar()?.avatar === ci.avatar) { try { $("#regex_scoped_toggle").prop("checked", true); } catch {} }
}
function allowPresetRegex(name) {
  const s = ctx().extensionSettings;
  if (!s.preset_allowed_regex || typeof s.preset_allowed_regex !== "object") s.preset_allowed_regex = {};
  if (!Array.isArray(s.preset_allowed_regex.openai)) s.preset_allowed_regex.openai = [];
  if (!s.preset_allowed_regex.openai.includes(name)) s.preset_allowed_regex.openai.push(name);
  ctx().saveSettingsDebounced();
  if (name === currentPresetName()) { try { $("#regex_preset_toggle").prop("checked", true); } catch {} }
}
// 酒馆正则面板里同一条的勾选框跟着改（只改显示，不触发它的保存）
function syncNativeRegexBox(box, rule) {
  if (!rule?.id) return;
  try { $(`${box} [id="${CSS.escape(rule.id)}"] .disable_regex`).prop("checked", !!rule.disabled); } catch {}
}
// 仅显示美化的正则在消息显示时才套用：改了开关要重新载入聊天才看得到。面板开着时先记下，关面板时载入一次
var pendingChatReload = false;
function noteRegexDisplay(rule) {
  if (rule?.markdownOnly && hasChat()) pendingChatReload = true;
}
async function flushChatReload() {
  if (!pendingChatReload) return;
  pendingChatReload = false;
  try { await ctx().reloadCurrentChat?.(); } catch (e) { console.warn("[麦当劳] 重新载入聊天失败", e); }
}
function setGlobalRegexOn(i, on) {
  const rule = globalRegexList()[i];
  if (!rule) throw new Error("这条正则已不存在");
  rule.disabled = !on;
  ctx().saveSettingsDebounced();
  syncNativeRegexBox("#saved_regex_scripts", rule);
  noteRegexDisplay(rule);
}
async function setCharRegexOn(ci, i, on) {
  const list = charRegexList(ci);
  const rule = list[i];
  if (!rule) throw new Error("这条正则已不存在");
  const write = ctx().writeExtensionField;
  if (typeof write !== "function") throw new Error("酒馆版本较旧，不能在这里改角色卡的正则");
  const was = rule.disabled;
  rule.disabled = !on;
  try {
    await write(ci.chid, "regex_scripts", list);
  } catch (e) {
    rule.disabled = was;
    throw e;
  }
  if (currentChar()?.avatar === ci.avatar) syncNativeRegexBox("#saved_scoped_scripts", rule);
  noteRegexDisplay(rule);
}

// 2.12.3 世界书改名。照酒馆自己的改名做：先存一份新名字的，把用到旧名字的地方都改过去，再删掉旧的。
// 用到的地方：全局列表、各角色的附加世界书、当前聊天、人设、角色卡自带。先改链接再删旧文件：
// 酒馆删世界书时，正在打开的角色卡若还指着旧名字，会把它清空并保存角色卡
var BAD_BOOK_NAME = /[\\/:*?"<>|]/;
async function renameWorldbook(oldName, newName) {
  const wi = mods.wi;
  newName = String(newName || "").trim();
  if (!newName || newName === oldName) return null;
  if (typeof wi?.saveWorldInfo !== "function" || typeof wi?.loadWorldInfo !== "function" || typeof wi?.deleteWorldInfo !== "function") throw new Error("酒馆版本较旧，不能在这里改世界书名称");
  if (BAD_BOOK_NAME.test(newName)) throw new Error('名称不能含 \\ / : * ? " < > |');
  if (listWorldbooks().some((n) => n !== oldName && n.toLowerCase() === newName.toLowerCase())) throw new Error(`已有叫「${newName}」的世界书`);
  const src = await wi.loadWorldInfo(oldName);
  if (!src?.entries) throw new Error(`读不到世界书「${oldName}」`);
  const data = structuredClone(src);
  try { await backupPut(`世界书：${oldName}`, data, `改名为「${newName}」前`); } catch {}
  const c = ctx();
  const wasGlobal = globalBooks().includes(oldName);
  const lores = charLoreList().filter((e) => Array.isArray(e?.extraBooks) && e.extraBooks.includes(oldName));
  const inChat = chatBook() === oldName;
  const primaries = (c.characters || []).map((ch, i) => [ch, i]).filter(([ch]) => ch?.data?.extensions?.world === oldName);
  let editorOn = false;
  try { editorOn = $("#world_editor_select").find(":selected").text() === oldName; } catch {}
  await wi.saveWorldInfo(newName, data, true);
  if (typeof wi.updateWorldInfoList === "function") await wi.updateWorldInfoList();
  else if (Array.isArray(wi.world_names) && !wi.world_names.includes(newName)) wi.world_names.push(newName);
  // 改链接
  for (const e of lores) e.extraBooks = [...new Set(e.extraBooks.map((x) => x === oldName ? newName : x))];
  if (lores.length) saveWorldSettings();
  if (wasGlobal) { setGlobalBook(newName, true); setGlobalBook(oldName, false); }
  if (inChat) await setChatBook(newName);
  const pu = c.powerUserSettings;
  if (pu) {
    let changed = false;
    if (pu.persona_description_lorebook === oldName) { pu.persona_description_lorebook = newName; changed = true; }
    for (const d of Object.values(pu.persona_descriptions || {})) if (d?.lorebook === oldName) { d.lorebook = newName; changed = true; }
    if (changed) c.saveSettingsDebounced();
  }
  const failed = [];
  for (const [ch, i] of primaries) {
    const active = currentChar()?.chid === i;
    if (active) { try { $("#character_world").val(newName); } catch {} }
    try {
      if (typeof c.writeExtensionField !== "function") throw new Error("no writeExtensionField");
      await c.writeExtensionField(i, "world", newName);
    } catch {
      failed.push(ch.name || ch.avatar);
    }
    if (active) { try { wi.setWorldInfoButtonClass?.(undefined, true); } catch {} }
  }
  // 删旧文件（酒馆同时把它从列表、缓存里去掉）
  await wi.deleteWorldInfo(oldName);
  if (editorOn) { try { wi.reloadEditor?.(newName, true); } catch {} }
  return { failed };
}

// 2.12.4 改、删正则。全局写回酒馆设置；角色卡写回角色卡。原对象原地更新：酒馆正则面板的每一行拿着同一个对象
function regexFromText(text) {
  // 与酒馆的 regexFromString 一致：/内容/标志 或直接写内容
  const s = String(text || "");
  const m = s.match(/(\/?)(.+)\1([a-z]*)/i);
  if (!m) throw new Error("查找内容为空");
  if (m[3] && !/^(?!.*?(.).*?\1)[gmixXsuUAJ]+$/.test(m[3])) return new RegExp(s);
  return new RegExp(m[2], m[3]);
}
function syncNativeRegexRow(box, rule, { remove = false } = {}) {
  if (!rule?.id) return;
  try {
    const row = $(`${box} [id="${CSS.escape(rule.id)}"]`);
    if (remove) return void row.remove();
    row.find(".regex_script_name").text(rule.scriptName || "").attr("title", rule.scriptName || "");
    row.find(".disable_regex").prop("checked", !!rule.disabled);
  } catch {}
}
function saveGlobalRegex(i, next) {
  const rule = globalRegexList()[i];
  if (!rule) throw new Error("这条正则已不存在");
  const was = !!rule.markdownOnly;
  Object.assign(rule, next);
  ctx().saveSettingsDebounced();
  syncNativeRegexRow("#saved_regex_scripts", rule);
  if (was || rule.markdownOnly) noteRegexDisplay({ markdownOnly: true });
}
function deleteGlobalRegex(i) {
  const list = globalRegexList();
  const rule = list[i];
  if (!rule) throw new Error("这条正则已不存在");
  list.splice(i, 1);
  ctx().saveSettingsDebounced();
  syncNativeRegexRow("#saved_regex_scripts", rule, { remove: true });
  noteRegexDisplay(rule);
  refreshNativeRegex();
}
// 2.12.20 新建、复制、删除正则后，宿主有正则列表的刷新函数或事件时顺手触发，酒馆自己的正则抽屉不用重开就看到
function refreshNativeRegex() {
  try {
    const c = ctx();
    const fn = [c.reloadRegexScripts, c.loadRegexScripts, window.loadRegexScripts].find((f) => typeof f === "function");
    if (fn) return void fn();
    const ev = c.eventTypes || c.event_types || {};
    const key = Object.keys(ev).find((k) => /^REGEX_SCRIPTS?_(UPDATED|CHANGED)$/.test(k));
    if (key) c.eventSource?.emit?.(ev[key]);
  } catch (e) { console.warn("[麦当劳] 刷新酒馆正则列表失败", e); }
}
// 2.12.17 新建、复制正则：插到 at（省略时放最后）
function insertGlobalRegex(rule, at) {
  const all = ctx().extensionSettings;
  if (!Array.isArray(all.regex)) all.regex = [];
  all.regex.splice(at ?? all.regex.length, 0, rule);
  ctx().saveSettingsDebounced();
  noteRegexDisplay(rule);
  refreshNativeRegex();
}
async function insertCharRegex(ci, rule, at) {
  const ext = ci?.ch?.data?.extensions;
  if (!ext) throw new Error("读不到这张角色卡");
  const had = Array.isArray(ext.regex_scripts);
  const list = had ? ext.regex_scripts : [];
  const i = at ?? list.length;
  list.splice(i, 0, rule);
  try {
    await writeCharRegex(ci, list);
    if (!had) ext.regex_scripts = list;
  } catch (e) {
    list.splice(i, 1);
    throw e;
  }
  noteRegexDisplay(rule);
  refreshNativeRegex();
}
async function writeCharRegex(ci, list) {
  const write = ctx().writeExtensionField;
  if (typeof write !== "function") throw new Error("酒馆版本较旧，不能在这里改角色卡的正则");
  await write(ci.chid, "regex_scripts", list);
}
async function saveCharRegex(ci, i, next) {
  const list = charRegexList(ci);
  const rule = list[i];
  if (!rule) throw new Error("这条正则已不存在");
  const before = { ...rule };
  const was = !!rule.markdownOnly;
  Object.assign(rule, next);
  try {
    await writeCharRegex(ci, list);
  } catch (e) {
    for (const k of Object.keys(rule)) if (!(k in before)) delete rule[k];
    Object.assign(rule, before);
    throw e;
  }
  if (currentChar()?.avatar === ci.avatar) syncNativeRegexRow("#saved_scoped_scripts", rule);
  if (was || rule.markdownOnly) noteRegexDisplay({ markdownOnly: true });
}
async function deleteCharRegex(ci, i) {
  const list = charRegexList(ci);
  const rule = list[i];
  if (!rule) throw new Error("这条正则已不存在");
  list.splice(i, 1);
  try {
    await writeCharRegex(ci, list);
  } catch (e) {
    list.splice(i, 0, rule);
    throw e;
  }
  if (currentChar()?.avatar === ci.avatar) syncNativeRegexRow("#saved_scoped_scripts", rule, { remove: true });
  noteRegexDisplay(rule);
  refreshNativeRegex();
}
