var META_KEY = "mcdonaldsScheme";
var LIKELY = /文风|风格|人设|人物|角色|情感|基调|性格|题材|狗|daddy|年上|年下|nsfw|涩|色|play|玩法|关系|buff/i;
function schemeStates(d, scheme) {
  const ids = scheme.scope === "all" ? d.order.map((o) => o.identifier) : d.order.filter((o) => scheme.scope.includes(d.groupOf(o.identifier))).map((o) => o.identifier);
  const states = {};
  for (const id of ids) states[id] = d.order.find((o) => o.identifier === id)?.enabled !== false;
  const groupStates = {};
  for (const g of d.groups.groups) if (scheme.scope === "all" || scheme.scope.includes(g.id)) groupStates[g.id] = g.enabled !== false;
  return { states, groupStates };
}
function schemeMatches(d, scheme) {
  for (const [id, on] of Object.entries(scheme.states || {})) {
    const o = d.order.find((x) => x.identifier === id);
    if (o && o.enabled !== false !== on) return false;
  }
  for (const [gid, on] of Object.entries(scheme.groupStates || {})) {
    const g = d.group(gid);
    if (g && g.enabled !== false !== on) return false;
  }
  return true;
}
// 1.9.8 方案记下保存时的 API 连接（不要求先存成站点）。旧方案只记了站点编号的，按站点算
function schemeConn(s) {
  if (s.conn && s.conn.source) return s.conn;
  const site = s.siteId ? settings().sites.find((x) => x.id === s.siteId) : null;
  if (!site) return null;
  const v = keyView(site);
  return { source: site.source, url: site.url || "", model: v.model || "", secretId: v.secretId || null, siteId: site.id, keyId: siteMulti(site) ? v.keyId : null };
}
// 用来连接的「站点」：有对应站点就用站点（带着它的密钥、名称），模型用方案记的
function connSite(conn) {
  if (!conn) return null;
  const site = conn.siteId ? settings().sites.find((x) => x.id === conn.siteId) : null;
  if (site) {
    // 2.5.0 多密钥站点用方案记的那个分组（分组删了就用站点上次用的）
    const v = keyView(site, conn.keyId);
    return { ...v, model: conn.model || v.model };
  }
  return { name: connLabel(conn, { model: false }), source: conn.source, url: conn.url || "", model: conn.model || "", secretId: conn.secretId || null };
}
function connLabel(conn, { model = true } = {}) {
  if (!conn) return "";
  const site = conn.siteId ? settings().sites.find((x) => x.id === conn.siteId) : null;
  let where = site?.name || "";
  if (site && siteMulti(site) && conn.keyId) where += ` · ${keyName(site, siteKey(site, conn.keyId))}`;
  if (!where) {
    try { where = conn.source === "custom" && conn.url ? new URL(conn.url).host : SOURCES[conn.source]?.label || conn.source; } catch { where = conn.url || conn.source; }
  }
  return model && conn.model ? `${where} · ${conn.model}` : where;
}
// 现在酒馆的连接 → 方案里记的样子；能对上已存的站点就顺带记站点编号（显示名称用）
function liveConn() {
  const live = liveConnection();
  if (live.mainApi && live.mainApi !== "openai") return null;
  if (!live.source) return null;
  // 多密钥站点逐个分组比；密钥编号对得上的优先
  const hits = [];
  for (const x of settings().sites) {
    for (const v of siteMulti(x) ? x.keys.map((k) => keyView(x, k.id)) : [x]) {
      if (!siteDiffers({ ...v, model: "" }, { ...live, online: true })) hits.push({ site: x, v });
    }
  }
  const hit = hits.find((h) => h.v.secretId && h.v.secretId === live.secretId) || hits[0];
  return { source: live.source, url: live.url || "", model: live.model || "", secretId: live.secretId || null, siteId: hit?.site.id || null, keyId: hit && siteMulti(hit.site) ? hit.v.keyId : null };
}
function connDiffers(conn) {
  const s = connSite(conn);
  return !!s && siteDiffers(s);
}
// 2.3.6 人设可选：不记录（切换方案时人设不变），或记某个人设。name：方案原来记的人设名（人设已删时显示用）
function personaPicker(init, name = "") {
  const cur = currentPersona();
  const list = listPersonas();
  if (init && init !== "__none" && !list.some((p) => p.avatar === init)) list.unshift({ avatar: init, name: name || init });
  const opts = [["__none", "不记录（切换方案时人设不变）"], ...list.map((p) => [p.avatar, `${p.name}${p.avatar === cur ? "（当前）" : ""}`])];
  if (!opts.some(([v]) => v === init)) init = "__none";
  const box = el(`<label class="pa-field"><span>人设</span><select class="pa-select" data-f="persona">${opts.map(([v, l]) => `<option value="${esc(v)}"${v === init ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></label>`);
  const sel = box.querySelector("select");
  const read = () => sel.value === "__none" ? { persona: null, personaName: "" } : { persona: sel.value, personaName: list.find((p) => p.avatar === sel.value)?.name || "" };
  return { el: box, read };
}
// 2.3.5 方案的 API 可选：不记录、当前连接、已存站点，模型可另选。
// init："__none" | "__live" | "__keep"（原记录，对不上已存站点时）| 站点编号；keep：方案原来记的 API
function connPicker(init, keep = null) {
  const nowConn = liveConn();
  const sites = settings().sites;
  const keepSite = keep?.siteId && sites.some((x) => x.id === keep.siteId);
  const opts = [
    ["__none", "不记录（切换方案时 API 不变）"],
    ...(nowConn ? [["__live", `当前连接：${connLabel(nowConn, { model: false })}`]] : []),
    ...(keep && !keepSite ? [["__keep", `原来记的：${connLabel(keep, { model: false })}`]] : []),
    ...sites.map((x) => [x.id, `站点：${x.name}`])
  ];
  if (!opts.some(([v]) => v === init)) init = "__none";
  const box = el(`<div class="pa-conn-pick">
      <label class="pa-field"><span>API</span><select class="pa-select" data-f="api">${opts.map(([v, l]) => `<option value="${esc(v)}"${v === init ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></label>
      <div class="pa-field" data-f="apimodel"><span>模型</span>${modelBtn("", 'data-f="apimodelbtn" type="button"')}</div>
    </div>`);
  const sel = box.querySelector("[data-f=api]");
  const btn = box.querySelector("[data-f=apimodelbtn]");
  let model = "";
  // 2.5.0 多密钥站点：选模型时一并选分组
  let keyId = null;
  const choice = () => sel.value;
  const site = () => sites.find((x) => x.id === choice());
  const models = () => choice() === "__live" ? liveModelOptions() : site()?.models || [];
  const setModel = (m, k = null) => {
    model = m || "";
    const x = site();
    keyId = x && siteMulti(x) ? siteKey(x, k).id : null;
    const kn = keyId ? keyName(x, siteKey(x, keyId)) : "";
    btn.title = [model || "选择模型", kn].filter(Boolean).join(" · ");
    setModelBtn(btn, model, kn);
  };
  // 换了来源就带出它记的模型；原来就是这个站点时用方案记的模型
  const reset = () => {
    const v = choice();
    box.querySelector("[data-f=apimodel]").hidden = v === "__none";
    if (v === "__live") setModel(nowConn.model);
    else if (v === "__keep") setModel(keep.model);
    else if (site()) {
      const same = keep?.siteId === v;
      const k = siteKey(site(), same ? keep.keyId : undefined);
      setModel(same && keep.model ? keep.model : k.model, k.id);
    }
  };
  sel.addEventListener("change", reset);
  btn.addEventListener("click", async () => {
    const x = site();
    if (x && siteMulti(x)) {
      const r = await pickKeyModel(x, { keyId, model });
      if (r) setModel(r.model, r.keyId);
      return;
    }
    const m = await pickModel(models(), model, { site: x || null });
    if (m) setModel(m);
  });
  reset();
  const read = () => {
    const v = choice();
    if (v === "__none") return null;
    if (v === "__live") return { ...nowConn, model };
    if (v === "__keep") return { ...keep, model };
    const x = site();
    const kv = keyView(x, keyId);
    return { source: x.source, url: x.url || "", model, secretId: kv.secretId || null, siteId: x.id, keyId };
  };
  return { el: box, read, choice };
}
async function applyScheme(scheme, { quiet = false, why = "", silent = false } = {}) {
  // 1.5.0：预设已归档的，先从归档恢复
  if (!listPresets().includes(scheme.preset) && archiveList().some((x) => x.name === scheme.preset)) {
    try {
      await restoreArchivedByName(scheme.preset);
    } catch (e) {
      toast(`从归档恢复「${scheme.preset}」失败：${e.message}`, "error");
      return false;
    }
  }
  if (!listPresets().includes(scheme.preset)) {
    toast(`方案「${scheme.name}」对应的预设「${scheme.preset}」已不存在`, "error");
    return false;
  }
  // 1.9.8：切方案恢复它记下的 API；不改「使用中」站点，方案之间互不影响。没记 API 的方案不动 API
  const conn = schemeConn(scheme);
  const site = connSite(conn);
  // 先处理这个预设上没存完的修改，再切换（切换后会丢掉旧草稿重新读）
  const old = drafts.get(scheme.preset);
  if (old?.dirty) {
    if (!quiet && !await confirmBox("有未保存的修改", `「${scheme.preset}」有未保存的修改，套用方案前会先保存。是否继续？`, "继续")) return false;
    try {
      await saveDraft(scheme.preset, "套用方案前保存");
    } catch (e) {
      handleSaveError(scheme.preset, e);
      toast(`「${scheme.preset}」的修改没有保存成功，未套用方案`, "error");
      return false;
    }
  }
  // 整个套用过程中由这里负责连接，避免「切换预设后恢复站点」同时再连一次
  if (site) applying = true;
  try {
    if (currentPresetName() !== scheme.preset) {
      await selectPreset(scheme.preset);
      dropDraft(scheme.preset);
    }
    const d = getDraft(scheme.preset);
    if (!schemeMatches(d, scheme)) {
      d.snapshot("套用方案");
      // 分组标记与单条选择分别恢复，分组开关不覆盖内部条目。
      for (const [gid, on] of Object.entries(scheme.groupStates || {})) d.setGroupEnabled(gid, on);
      for (const [id, on] of Object.entries(scheme.states || {})) d.setEnabled([id], on);
      try {
        await saveDraft(scheme.preset, `套用方案 ${scheme.name}`);
      } catch (e) {
        handleSaveError(scheme.preset, e);
        return false;
      }
    }
    if (scheme.persona) await setPersona(scheme.persona);
    if (site && siteDiffers(site)) {
      try {
        const live = await applyConnection(site);
        if (!live.online) toast(`已切换到「${connLabel(conn)}」，但未连接成功。请检查网址和密钥`, "warning");
      } catch (e) {
        toast(`API「${connLabel(conn)}」连接失败：${e.message}`, "error");
      }
    }
  } finally {
    if (site) applying = false;
  }
  scheme.usedAt = Date.now();
  saveSettings();
  if (!silent) toast(`${why ? `自动套用（${why}）：` : "已切换到"}「${scheme.name}」${scheme.persona ? `，人设：${scheme.personaName || ""}` : ""}${conn ? `，API：${connLabel(conn)}` : ""}`, "success");
  return true;
}
// 自动套用的绑定：聊天绑定存在聊天文件里；角色绑定存在本扩展设置里（这个角色的任何聊天都算）。聊天绑定优先
function currentCharKey() {
  const c = ctx();
  if (c.groupId) return "group:" + c.groupId;
  return c.characters?.[Number(c.characterId)]?.avatar || null;
}
function currentCharName() {
  const c = ctx();
  if (c.groupId) return c.groups?.find((g) => g.id === c.groupId)?.name || "本群聊";
  return c.characters?.[Number(c.characterId)]?.name || "";
}
function bindingNow() {
  if (!hasChat()) return null;
  const chatId = chatMeta()[META_KEY];
  if (chatId) return { scope: "chat", id: chatId };
  const k = currentCharKey();
  const charId = k ? settings().schemeCharBind?.[k] : null;
  return charId ? { scope: "char", id: charId } : null;
}
function boundSchemeId() {
  return bindingNow()?.id || null;
}
var BIND_LABEL = { chat: "本聊天", char: "本角色" };
// 方案按角色卡归类（也可切到按预设、按人设看）。每条方案记：角色卡、预设、人设、API 站点、时间。
// 归属角色卡：保存时在聊天里就记当前角色卡；旧方案没有记录的，看有没有绑定在某个角色上，否则归「未分角色」
function schemeCharKey(s) {
  if (s.charKey) return s.charKey;
  const cb = settings().schemeCharBind || {};
  return Object.keys(cb).find((k) => cb[k] === s.id) || "";
}
function charNameOf(key) {
  if (!key) return "未分角色";
  const c = ctx();
  if (key.startsWith("group:")) return c.groups?.find((g) => "group:" + g.id === key)?.name || "群聊";
  return c.characters?.find((x) => x.avatar === key)?.name || key.replace(/\.png$/i, "");
}
function shortTime(t) {
  if (!t) return "";
  const d = new Date(t), now = new Date();
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (d.toDateString() === now.toDateString()) return `今天 ${hm}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}
function mountSchemes(page, { after } = {}) {
  const VIEWS = [["char", "角色卡"], ["preset", "预设"], ["persona", "人设"]];
  page.innerHTML = `
        <div class="pa-scheme-now" aria-live="polite"></div>
        <div class="pa-scheme-bar"><div class="pa-seg pa-seg-s pa-sview" role="tablist" aria-label="方案按什么分组">${VIEWS.map(([k, l]) => `<button type="button" role="tab" data-s="view" data-v="${k}">${l}</button>`).join("")}</div>${tip("方案保存预设和条目开关，可选记下人设、API 和模型。<br>「切换」：恢复方案保存时的全部状态。<br>「自动套用」：绑定聊天或角色后，进入该聊天时切换一次。之后手动修改的内容保持不变。<br>换预设时 API 不变；切换方案时，方案记了 API 的才换 API。", "")}<span class="pa-scheme-pick"></span><button class="pa-btn pa-btn-primary pa-btn-s pa-head-btn" data-s="new">＋ 保存方案</button></div>
        <div class="pa-scheme-nudge"></div>
        <div class="pa-schemes"></div>`;
  const box = page.querySelector(".pa-schemes");
  const nudge = page.querySelector(".pa-scheme-nudge");
  // 2.12.17 勾选删除：底部操作栏（全选、取消、删除），和预设、世界书、正则的多选删除一样；Esc、返回键退出
  const delBar = el(`<div class="pa-selbar pa-delbar pa-scheme-delbar" hidden>
      <b class="pa-selcount"></b>
      <button class="pa-link" data-s="pickall">全选</button>
      <div class="pa-delbar-acts">
        <button class="pa-btn pa-btn-s" data-s="pickoff" data-esc-del>取消</button>
        <button class="pa-btn pa-btn-s pa-btn-danger" data-s="delpicked" disabled>删除</button>
      </div>
    </div>`);
  (page.closest(".pa-page") || page).append(delBar);
  const all = () => settings().schemes;
  // 2.6.6 方案分组的展开、收起记住最后一次的状态；没动过的组，当前角色（预设、人设）那组默认展开
  // 🗑️ 勾选删除
  let picking = false;
  const picked = new Set();
  const view = () => VIEWS.some(([k]) => k === settings().schemeView) ? settings().schemeView : "char";
  const groupKey = (s) => view() === "preset" ? s.preset : view() === "persona" ? s.persona ? s.personaName || s.persona : "" : schemeCharKey(s);
  const groupName = (k) => view() === "char" ? charNameOf(k) : k || (view() === "persona" ? "没记人设" : "");
  // 「使用中」要和酒馆实际生效的一致：预设正在用、开关一致、人设和 API 站点也对得上
  function schemeState(s, d) {
    const switchesOk = !!d && s.preset === d.name && schemeMatches(d, s);
    const cs = connSite(schemeConn(s));
    const on = switchesOk && currentPresetName() === s.preset && (!s.persona || currentPersona() === s.persona) && (!cs || !siteDiffers(cs, { ...liveConnection(), online: true }));
    return { switchesOk, on };
  }
  // 2.7.3 页顶「当前状态」：酒馆现在的预设、人设、连接，以及和哪个方案一致、本聊天自动套用哪个
  function renderNow(d) {
    const cur = currentPresetName();
    const persona = listPersonas().find((p) => p.avatar === currentPersona())?.name || "";
    const conn = liveConn();
    const match = all().find((x) => schemeState(x, d).on);
    const bind = bindingNow();
    const bound = bind ? all().find((x) => x.id === bind.id) : null;
    const kv = [["预设", cur || "未选择"], ["人设", persona || "未设置"], ["连接", conn ? connLabel(conn) : "非聊天补全接口"]];
    page.querySelector(".pa-scheme-now").innerHTML = `<div class="pa-card pa-nowcard">
        <div class="pa-nowhead"><b>当前状态</b>${match ? `<span class="pa-badge pa-badge-ok">与「${esc(match.name)}」一致</span>` : all().length ? '<span class="pa-badge">没有一致的方案</span>' : ""}</div>
        <dl class="pa-kv">${kv.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
        ${bound ? `<p class="pa-hint">${bind.scope === "chat" ? "本聊天" : "本角色的聊天"}进入时自动套用「${esc(bound.name)}」${bind.scope === "chat" ? "，聊天绑定优先于角色绑定" : ""}。</p>` : ""}</div>`;
  }
  function row(s, d) {
    const bind = bindingNow();
    const bound = bind?.id === s.id ? bind.scope : null;
    const { switchesOk, on } = schemeState(s, d);
    const conn = schemeConn(s);
    const archived = !listPresets().includes(s.preset) && archiveList().some((x) => x.name === s.preset);
    const meta = [
      view() !== "preset" ? esc(s.preset) + (archived ? "（已归档）" : "") : "",
      view() !== "persona" ? s.persona ? esc(s.personaName || s.persona) : "" : "",
      view() !== "char" && schemeCharKey(s) ? esc(charNameOf(schemeCharKey(s))) : "",
      shortTime(Math.max(s.usedAt || 0, s.at || 0))
    ].filter(Boolean).join(" · ");
    const apiLine = conn ? `<small class="pa-srow-api">API：${esc(connLabel(conn))}</small>` : '<small class="pa-srow-api pa-srow-noapi">API：不切换</small>';
    if (picking) return `<label class="pa-srow pa-srow-pick" data-id="${esc(s.id)}"><input type="checkbox" data-a="pick" ${picked.has(s.id) ? "checked" : ""}>
        <div class="pa-srow-main"><b>${esc(s.name)}</b>${bound ? `<span class="pa-chip pa-chip-cot pa-chip-ico">${ICON.link}${BIND_LABEL[bound]}</span>` : ""}<small>${meta}</small>${apiLine}</div></label>`;
    // 2.12.19 使用中的方案铺一层极淡的绿底，右边写「使用中」代替「切换」
    return `<div class="pa-srow${on ? " pa-srow-on pa-row-wash" : ""}" data-id="${esc(s.id)}">
        <div class="pa-srow-main"><b>${esc(s.name)}</b>${!on && switchesOk ? '<span class="pa-chip pa-chip-dim" title="条目开关和方案一致，但预设、人设或 API 站点不是方案记录的">开关一致</span>' : ""}${bound ? `<span class="pa-chip pa-chip-cot pa-chip-ico" title="进入${bound === "chat" ? "这个聊天" : "这个角色的聊天"}时自动切换到它">${ICON.link}${BIND_LABEL[bound]}</span>` : ""}
        <small>${meta}</small>${apiLine}</div>
        ${on ? '<button class="pa-chip pa-scheme-onchip" type="button" data-a="apply" title="再切换一次：把预设、开关、人设、API 换回方案记的样子">使用中</button>' : '<button class="pa-swpill" type="button" data-a="apply" title="把预设、开关、人设、API 一次换成方案记的样子">切换</button>'}
        <button class="pa-icon-btn" data-a="edit" aria-label="编辑方案" title="编辑">${ICON.pencil}</button></div>`;
  }
  function render() {
    let d = null;
    try {
      d = getDraft(currentPresetName());
    } catch {
    }
    // 2.12.19 分组方式：就地三段滑动槽（角色卡 | 预设 | 人设），不再弹窗选
    page.querySelectorAll('[data-s="view"]').forEach((b) => {
      const on = b.dataset.v === view();
      b.classList.toggle("on", on);
      b.setAttribute("aria-selected", String(on));
    });
    page.querySelectorAll(".pa-sview").forEach((x) => { x.hidden = !all().length; });
    renderNow(d);
    for (const id of [...picked]) if (!all().some((x) => x.id === id)) picked.delete(id);
    if (picking && !all().length) picking = false;
    page.querySelector(".pa-scheme-pick").innerHTML = all().length ? `<button class="pa-icon-btn pa-del${picking ? " on" : ""}" data-s="${picking ? "pickoff" : "pickon"}" aria-pressed="${picking}" aria-label="勾选删除方案" title="勾选删除方案">${ICON.trash}</button>` : "";
    delBar.hidden = !picking;
    if (picking) {
      delBar.querySelector(".pa-selcount").textContent = `已选 ${picked.size} 个`;
      delBar.querySelector("[data-s=pickall]").textContent = all().length && all().every((x) => picked.has(x.id)) ? "取消全选" : "全选";
      const del = delBar.querySelector("[data-s=delpicked]");
      del.disabled = !picked.size;
      del.textContent = picked.size ? `删除 ${picked.size} 个` : "删除";
    }
    page.classList.toggle("pa-schemes-picking", picking);
    // 当前角色在用的预设还没有方案：提示一句
    const ck = hasChat() ? currentCharKey() : null;
    const cur = currentPresetName();
    nudge.innerHTML = ck && cur && !all().some((s) => schemeCharKey(s) === ck && s.preset === cur)
      ? `<div class="pa-nudge">「${esc(currentCharName())}」还没有「${esc(cur)}」的方案<button class="pa-link" data-s="new">保存一个</button></div>` : "";
    if (!all().length) {
      box.innerHTML = '<p class="pa-empty">还没有方案。开启需要的条目后，点「保存方案」。</p>';
      return after?.();
    }
    const groups = new Map();
    for (const s of all()) {
      const k = groupKey(s);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(s);
    }
    const t = (s) => Math.max(s.usedAt || 0, s.at || 0);
    // 当前角色（或当前预设、当前人设）那一组排最前，其余按最近用过排；「未分角色」放最后
    const mineKey = view() === "char" ? ck || "" : view() === "preset" ? cur : listPersonas().find((p) => p.avatar === currentPersona())?.name || "";
    const keys = [...groups.keys()].sort((a, b) => (b === mineKey) - (a === mineKey) || (!a) - (!b) || Math.max(...groups.get(b).map(t)) - Math.max(...groups.get(a).map(t)));
    const defOpen = groups.has(mineKey) ? mineKey : keys[0];
    const isOpenK = (k) => foldGet("schemes", view() + "|" + k, k === defOpen);
    box.innerHTML = keys.map((k) => {
      const list = groups.get(k).sort((a, b) => t(b) - t(a));
      const isOpen = isOpenK(k);
      return `<section class="pa-sgroup${isOpen ? " open" : ""}" data-k="${esc(k)}">
          <header class="pa-sghead" data-a="fold" tabindex="0" role="button" aria-expanded="${isOpen}"><span class="pa-sgcaret pa-acc-caret" aria-hidden="true">▸</span>${picking ? `<input type="checkbox" data-a="pickgroup" aria-label="选中这一组" ${list.every((s) => picked.has(s.id)) ? "checked" : ""}>` : ""}<span class="pa-sgtitle"><b>${esc(groupName(k))}</b>${k === mineKey && k ? '<span class="pa-chip pa-chip-dim">当前</span>' : ""}<small>${list.length} 个方案</small></span></header>
          ${isOpen ? `<div class="pa-sgbody">${list.map((s) => row(s, d)).join("")}</div>` : ""}</section>`;
    }).join("");
    after?.();
  }
  async function saveNew() {
    let d;
    try { d = getDraft(currentPresetName()); } catch (e) { return toast(e.message, "error"); }
    const groups = d.groups.groups;
    const ck = hasChat() ? currentCharKey() : null;
    const cname = ck ? currentCharName() : "";
    const prevBound = hasChat() ? all().find((x) => x.id === chatMeta()[META_KEY]) : null;
    // 1.9.8：保存时记下预设、开关、人设；2.3.5 起 API 默认不记，可选当前连接或某个站点，下次沿用这次的选择
    const picker = connPicker(settings().schemeApiPick || "__none");
    // 2.3.6 人设默认记当前人设；上次选了不记录就沿用
    const pp = personaPicker(settings().schemePersonaPick === "__none" ? "__none" : currentPersona() || "__none");
    picker.el.prepend(pp.el);
    const body = el(`<div class="pa-form">
            <label class="pa-field"><span>方案名称</span><input class="pa-input" data-f="name" value="${esc(d.name)}" placeholder="例如：纯爱、年上"></label>
            <div class="pa-card pa-save-list"><p class="pa-hint">将保存：</p>
              <div class="pa-kv"><span>预设</span><b>${esc(d.name)}</b>
              <span>条目开关</span><b class="pa-save-scope">${groups.length ? "勾选的分组" : "全部条目"}</b></div>
              <div class="pa-conn-slot"></div></div>
            ${ck ? `<label class="pa-inline-check"><input type="checkbox" data-f="char" checked> 归到角色「${esc(cname)}」</label>
            <label class="pa-inline-check"><input type="checkbox" data-f="bind"> 进入这个聊天时自动切换到它${prevBound ? `（替换「${esc(prevBound.name)}」）` : ""}</label>` : '<p class="pa-hint">当前不在聊天中，方案归入「未分角色」。</p>'}
            <details class="pa-tip pa-tip-fold"><summary>条目开关的保存范围</summary><div class="pa-tip-body">
                <label class="pa-inline-check"><input type="radio" name="pa-scope" value="groups" ${groups.length ? "checked" : "disabled"}> 只保存勾选的分组（其他条目不受影响）</label>
                <div class="pa-groups-pick">${groups.map((g) => `<label class="pa-inline-check"><input type="checkbox" data-g="${esc(g.id)}" ${LIKELY.test(g.name) ? "checked" : ""}> ${esc(g.name)}</label>`).join("") || '<p class="pa-hint">此预设没有分组</p>'}</div>
                <label class="pa-inline-check"><input type="radio" name="pa-scope" value="all" ${groups.length ? "" : "checked"}> 保存全部条目（整个预设每条的开关都按方案恢复）</label></div></details>
        </div>`);
    body.querySelector(".pa-conn-slot").replaceWith(picker.el);
    body.addEventListener("change", () => {
      const all2 = body.querySelector("input[name=pa-scope]:checked")?.value === "all";
      body.querySelector(".pa-save-scope").textContent = all2 ? "全部条目" : "勾选的分组";
    });
    const r = await sheet({
      title: "保存为方案", body, guardDirty: true,
      actions: [{ label: "取消", value: null }, {
        label: "保存", kind: "primary",
        validate: (w) => {
          if (!w.querySelector("[data-f=name]").value.trim()) { toast("请填写方案名称"); return false; }
          return true;
        },
        value: (w) => ({
          name: w.querySelector("[data-f=name]").value.trim(),
          scope: w.querySelector("input[name=pa-scope]:checked")?.value === "all" ? "all" : [...w.querySelectorAll("[data-g]:checked")].map((x) => x.dataset.g),
          char: !!w.querySelector("[data-f=char]")?.checked,
          bind: !!w.querySelector("[data-f=bind]")?.checked,
          conn: picker.read(),
          ...pp.read()
        })
      }]
    });
    if (!r) return;
    if (Array.isArray(r.scope) && !r.scope.length) return toast("请至少勾选一个分组，或选择保存全部条目", "warning");
    settings().schemeApiPick = picker.choice();
    settings().schemePersonaPick = r.persona ? "current" : "__none";
    const conn = r.conn;
    const s = { id: uid(), name: r.name, preset: d.name, scope: r.scope, persona: r.persona, personaName: r.personaName, conn, siteId: conn?.siteId || null, charKey: r.char && ck ? ck : "", at: Date.now(), usedAt: Date.now() };
    Object.assign(s, schemeStates(d, s));
    all().push(s);
    if (r.bind && hasChat()) {
      chatMeta()[META_KEY] = s.id;
      await saveChatMeta();
      markChatHandled();
    }
    saveSettings();
    foldSet("schemes", view() + "|" + groupKey(s), true);
    toast(`已保存方案「${s.name}」${r.bind ? "。进入这个聊天时将自动切换到它" : ""}`, "success");
    render();
  }
  // 2.12.17 ✏️ 编辑方案：一个窗口里改名称、归属角色、人设、API 和模型、自动套用、条目开关的范围，可用现在的状态刷新；保存一次就关。
  // 左下角「删除方案」在关窗前确认
  async function editMenu(s) {
    let d = null;
    try { d = getDraft(s.preset); } catch {}
    const gs = d ? d.groups.groups : [];
    const pp = personaPicker(s.persona || "__none", s.personaName);
    const cur = schemeConn(s);
    const cp = connPicker(!cur ? "__none" : cur.siteId && settings().sites.some((x) => x.id === cur.siteId) ? cur.siteId : "__keep", cur);
    const chars = (ctx().characters || []).filter((x) => x?.avatar);
    const ck0 = schemeCharKey(s);
    const chat = hasChat();
    const ckNow = chat ? currentCharKey() : null;
    const bindNow = chat && chatMeta()[META_KEY] === s.id ? "chat" : ckNow && settings().schemeCharBind?.[ckNow] === s.id ? "char" : "none";
    const body = el(`<div class="pa-form pa-scheme-edit">
        <label class="pa-field"><span>名称</span><input class="pa-input" data-f="name" value="${esc(s.name)}" autocomplete="off"></label>
        <label class="pa-field"><span>归属角色</span><select class="pa-select" data-f="char"><option value="">未分角色</option>${chars.map((x) => `<option value="${esc(x.avatar)}"${x.avatar === ck0 ? " selected" : ""}>${esc(x.name)}</option>`).join("")}${ck0 && !chars.some((x) => x.avatar === ck0) ? `<option value="${esc(ck0)}" selected>${esc(charNameOf(ck0))}</option>` : ""}</select></label>
        <div class="pa-pp-slot"></div><div class="pa-cp-slot"></div>
        ${chat ? `<label class="pa-field"><span>自动套用</span><select class="pa-select" data-f="bind"><option value="none"${bindNow === "none" ? " selected" : ""}>不自动套用（点「切换」时才换）</option><option value="chat"${bindNow === "chat" ? " selected" : ""}>进入这个聊天时</option>${ckNow ? `<option value="char"${bindNow === "char" ? " selected" : ""}>进入「${esc(currentCharName())}」的任何聊天时</option>` : ""}</select></label>` : '<p class="pa-hint">打开聊天后可设置自动套用。</p>'}
        <fieldset class="pa-scope-set"><legend>条目开关的范围</legend>
          <label class="pa-inline-check"><input type="radio" name="pa-scope3" value="groups" ${s.scope !== "all" ? "checked" : ""} ${gs.length ? "" : "disabled"}> 只保存勾选的分组</label>
          <div class="pa-groups-pick">${gs.map((g) => `<label class="pa-inline-check"><input type="checkbox" data-g="${esc(g.id)}" ${s.scope !== "all" && s.scope.includes(g.id) ? "checked" : ""}> ${esc(g.name)}</label>`).join("")}</div>
          <label class="pa-inline-check"><input type="radio" name="pa-scope3" value="all" ${s.scope === "all" ? "checked" : ""}> 全部条目</label>
        </fieldset>
        <label class="pa-inline-check"><input type="checkbox" data-f="refresh"> 用「${esc(s.preset)}」现在的条目开关刷新方案</label>
        ${d ? "" : `<p class="pa-warn">读不到预设「${esc(s.preset)}」，范围和开关不能改。</p>`}
      </div>`);
    body.querySelector(".pa-pp-slot").replaceWith(pp.el);
    body.querySelector(".pa-cp-slot").replaceWith(cp.el);
    if (!d) body.querySelectorAll(".pa-scope-set input, [data-f=refresh]").forEach((x) => { x.disabled = true; });
    const readScope = (w) => w.querySelector("input[name=pa-scope3]:checked")?.value === "all" ? "all" : [...w.querySelectorAll("[data-g]:checked")].map((x) => x.dataset.g);
    const r = await sheet({
      title: "编辑方案", body, noFocus: true, guardDirty: true,
      actions: [
        { label: "删除方案", kind: "danger-soft", value: "del", validate: () => confirmBox("删除方案", `删除「${s.name}」？预设不受影响。`, "删除", true) },
        { label: "取消", value: null },
        { label: "保存", kind: "primary", validate: (w) => {
          if (!w.querySelector("[data-f=name]").value.trim()) { toast("请填写方案名称"); return false; }
          const sc = readScope(w);
          if (d && Array.isArray(sc) && !sc.length) { toast("请至少勾选一个分组，或选择全部条目", "warning"); return false; }
          return true;
        }, value: (w) => ({
          name: w.querySelector("[data-f=name]").value.trim(),
          char: w.querySelector("[data-f=char]").value,
          bind: w.querySelector("[data-f=bind]")?.value || null,
          scope: readScope(w),
          refresh: w.querySelector("[data-f=refresh]").checked,
          conn: cp.read(),
          ...pp.read()
        }) }
      ]
    });
    if (r === "del") {
      await removeSchemes([s.id]);
      toast(`已删除方案「${s.name}」`, "success");
      return render();
    }
    if (!r || !all().includes(s)) return render();
    s.name = r.name;
    s.charKey = r.char;
    s.persona = r.persona;
    s.personaName = r.personaName;
    s.conn = r.conn;
    s.siteId = r.conn?.siteId || null;
    if (d) {
      const scopeChanged = JSON.stringify(r.scope) !== JSON.stringify(s.scope);
      if (scopeChanged || r.refresh) {
        s.scope = r.scope;
        Object.assign(s, schemeStates(d, s));
        s.at = Date.now();
      }
    }
    if (r.bind && r.bind !== bindNow) await setBind(s, r.bind);
    saveSettings();
    toast("方案已保存", "success");
    render();
  }
  async function removeSchemes(ids) {
    const gone = new Set(ids);
    settings().schemes = all().filter((x) => !gone.has(x.id));
    const cb = settings().schemeCharBind || {};
    for (const k of Object.keys(cb)) if (gone.has(cb[k])) delete cb[k];
    if (hasChat() && gone.has(chatMeta()[META_KEY])) { delete chatMeta()[META_KEY]; await saveChatMeta(); }
    saveSettings();
  }
  async function setBind(s, v) {
    const meta = chatMeta();
    const ck = currentCharKey();
    const cname = currentCharName();
    if (!settings().schemeCharBind || typeof settings().schemeCharBind !== "object") settings().schemeCharBind = {};
    const cb = settings().schemeCharBind;
    if (meta[META_KEY] === s.id) delete meta[META_KEY];
    if (ck && cb[ck] === s.id) delete cb[ck];
    if (v === "chat") meta[META_KEY] = s.id;
    if (v === "char" && ck) cb[ck] = s.id;
    await saveChatMeta();
    saveSettings();
    markChatHandled();
    toast(v === "none" ? "已取消自动套用" : `已设置：进入${v === "chat" ? "这个聊天" : `「${cname}」的聊天`}时自动切换到「${s.name}」`, "success");
  }
  const onClick = async (e) => {
    const sv = e.target.closest("[data-s]")?.dataset.s;
    if (sv === "new") return saveNew();
    if (sv === "pickall") {
      const allOn = all().every((x) => picked.has(x.id));
      for (const x of all()) allOn ? picked.delete(x.id) : picked.add(x.id);
      if (!allOn) for (const x of all()) foldSet("schemes", view() + "|" + groupKey(x), true);
      return render();
    }
    if (sv === "pickon" || sv === "pickoff") {
      picking = sv === "pickon";
      picked.clear();
      return render();
    }
    if (sv === "delpicked") {
      const names = all().filter((x) => picked.has(x.id)).map((x) => `「${x.name}」`);
      if (!names.length) return;
      if (!await confirmBox("删除方案", `删除 ${names.length} 个方案：${names.slice(0, 6).join("、")}${names.length > 6 ? " 等" : ""}？预设不受影响。`, "删除", true)) return;
      await removeSchemes([...picked]);
      picking = false;
      picked.clear();
      toast(`已删除 ${names.length} 个方案`, "success");
      return render();
    }
    if (sv === "view") {
      const v = e.target.closest("[data-s]").dataset.v;
      if (!v) return;
      settings().schemeView = v;
      saveSettings();
      return render();
    }
    const a = e.target.closest("[data-a]")?.dataset.a;
    if (a === "pickgroup") {
      const k = e.target.closest(".pa-sgroup").dataset.k;
      const ids = all().filter((x) => String(groupKey(x)) === k).map((x) => x.id);
      for (const id of ids) e.target.checked ? picked.add(id) : picked.delete(id);
      if (e.target.checked) foldSet("schemes", view() + "|" + k, true);
      return render();
    }
    if (a === "pick") {
      const id = e.target.closest(".pa-srow").dataset.id;
      e.target.checked ? picked.add(id) : picked.delete(id);
      return render();
    }
    if (picking && e.target.closest(".pa-srow")) return;
    // 2.12.19 分组呼吸展开、收起，箭头跟着转
    if (a === "fold") {
      const sec = e.target.closest(".pa-sgroup");
      const k = sec.dataset.k;
      if (sec.classList.contains("open")) {
        sec.classList.remove("open");
        foldSet("schemes", view() + "|" + k, false);
        if (await accOut(sec.querySelector(".pa-sgbody"))) render();
        return;
      }
      foldSet("schemes", view() + "|" + k, true);
      render();
      return accIn([...box.querySelectorAll(".pa-sgroup")].find((x) => x.dataset.k === k)?.querySelector(".pa-sgbody"));
    }
    const rowEl = e.target.closest(".pa-srow");
    const s = rowEl && all().find((x) => x.id === rowEl.dataset.id);
    if (!s) return;
    if (a === "apply") {
      await applyScheme(s);
      setFocusPreset(s.preset);
      render();
    }
    if (a === "edit") return editMenu(s);
  };
  page.addEventListener("click", onClick);
  delBar.addEventListener("click", onClick);
  page.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && e.target.matches?.(".pa-sghead")) { e.preventDefault(); e.target.click(); }
  });
  const off = onDraftChange((name, kind) => {
    if (kind !== "status" && draftViewVisible(page)) render();
  });
  return { render, destroy: off };
}
