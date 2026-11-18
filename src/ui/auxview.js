// 2.11.23 连接 → 副 API。2.11.24 改成两段：「用途」每项一行，点了选跟随主 API 或某个渠道；
// 「渠道」列出副 API 自己的渠道，＋ 新建（只在这里用）或从主 API 的站点添加；点渠道编辑，闪电发一句 Hi 试试。
function mountAux(page) {
  page.innerHTML = '<div class="pa-scroll pa-plan pa-aux"></div>';
  const box = page.firstElementChild;
  bindWhy(box);
  // 测试结果：渠道 id → { sig, ok, text, raw }；改了渠道（网址、密钥、模型）就不再显示旧结果
  const tests = new Map();
  const busy = new Set();
  const sigOf = (ch) => JSON.stringify([ch.site || ch.url || "", ch.keyId || ch.secretId || "", ch.model || ""]);
  const hostOf = (url) => { try { return new URL(url).host; } catch { return String(url || ""); } };
  const siteOf = (id) => (settings().sites || []).find((x) => x.id === id) || null;
  const mainSites = () => (settings().sites || []).filter((x) => SOURCES[x.source]);
  function useRow(u) {
    const t = auxTarget(u.key);
    const v = t.follow
      ? `<b>跟随主 API</b>${t.missing ? '<small class="pa-aux-bad">选过的渠道已删除</small>' : ""}`
      : `<b>${esc(t.name)}</b><small>${esc(t.model || "未选模型")}</small>`;
    return `<button class="pa-aux-row" type="button" data-use="${u.key}" aria-label="${esc(`${u.label}：${auxLabel(t)}，点按更换`)}">
        <b class="pa-aux-k">${esc(u.label)}</b><span class="pa-aux-v">${v}</span><span class="pa-aux-caret" aria-hidden="true">${ICON.caret}</span></button>`;
  }
  function chRow(ch) {
    const site = ch.site ? siteOf(ch.site) : null;
    const from = ch.site ? (site ? `主 API · ${site.name || "站点"}` : "来自的站点已删除") : hostOf(ch.url) || "未填网址";
    const res = tests.get(ch.id);
    const on = busy.has(ch.id);
    return `<div class="pa-aux-ch" data-ch="${esc(ch.id)}">
        <button class="pa-aux-chmain" type="button" data-a="edit" aria-label="${esc(`编辑渠道「${ch.name || "渠道"}」`)}">
          <span class="pa-aux-k"><b>${esc(ch.name || "渠道")}</b><small${ch.site && !site ? ' class="pa-aux-bad"' : ""}>${esc(from)}</small></span>
          <span class="pa-aux-m">${esc(ch.model || "未选模型")}</span>
        </button>
        <button class="pa-icon-btn pa-aux-test${on ? " pa-busy" : ""}" type="button" data-a="test" aria-label="${esc(`测试渠道「${ch.name || "渠道"}」`)}" title="发一句 Hi，看能不能用"${on ? " disabled" : ""}>${ICON.bolt}</button>
        ${res && res.sig === sigOf(ch) ? `<p class="pa-live-res ${res.ok ? "ok" : "bad"}"${res.raw ? ` title="${esc(res.raw)}"` : ""}>${res.ok ? RES_OK : RES_BAD}${esc(res.text)}</p>` : ""}
      </div>`;
  }
  function render() {
    const chs = auxChannels();
    box.innerHTML = `
      <div class="pa-row-head"><h3 class="pa-h">用途${whyBtn("aux")}</h3></div>
      ${whyNote("aux", "<p>麦当劳自己的 AI 功能用哪个 API。用渠道时不切换酒馆的连接，聊天照常用主 API。</p><p>推荐便宜、快的模型，如 DeepSeek Flash、豆包。</p>")}
      <div class="pa-card pa-aux-list">${AUX_USES.map(useRow).join("")}</div>
      <div class="pa-row-head"><h3 class="pa-h">渠道${whyBtn("auxch")}</h3><div class="pa-head-btns"><button class="pa-head-ico pa-head-add" data-a="add" type="button" aria-label="添加渠道" title="添加渠道">${ICON.plus}</button></div></div>
      ${whyNote("auxch", "<p>新建的渠道只在副 API 里用，不进主 API 的站点列表；硅基流动、火山方舟等填 OpenAI 兼容的网址。也可以从主 API 的站点添加，网址和密钥跟着站点。</p>")}
      ${chs.length ? `<div class="pa-card pa-aux-list">${chs.map(chRow).join("")}</div>` : '<p class="pa-empty">还没有渠道。点 ＋ 新建，或从主 API 的站点添加。</p>'}`;
  }
  // 点用途：选跟随主 API、某个渠道，或当场添加一个
  async function choose(use) {
    const u = AUX_USES.find((x) => x.key === use);
    const cur = auxSettings().use[use] || "";
    const chs = auxChannels();
    const live = auxLiveModel();
    const items = [{ value: "", label: "跟随主 API", sub: live || "酒馆当前连接" },
      ...chs.map((c) => ({ value: c.id, label: c.name || "渠道", sub: c.model || "未选模型" })),
      { value: "\u0002add", label: "＋ 添加渠道" }];
    const v = await pickName({ title: u.label, items, current: chs.some((c) => c.id === cur) ? cur : "", search: items.length > 9 });
    if (v === null) return;
    let id = v;
    if (v === "\u0002add") {
      const ch = await addChannel();
      if (!ch) return;
      id = ch.id;
    }
    if (id) auxSettings().use[use] = id;
    else delete auxSettings().use[use];
    saveSettings();
  }
  async function addChannel() {
    const list = mainSites();
    let how = "new";
    if (list.length) {
      how = await pickBox("添加渠道", [{ label: "新建", sub: "填网址和密钥，只在副 API 里用", value: "new" }, { label: "从主 API 的站点添加", sub: "网址和密钥跟着站点", value: "site" }]);
      if (!how) return null;
    }
    if (how === "new") return editChannel(null);
    const v = await pickName({ title: "从主 API 的站点添加", items: list.map((s) => ({ value: s.id, label: s.name || "站点", sub: siteMulti(s) ? `${s.keys.length} 个分组` : s.model || s.url || "" })), search: list.length > 9 });
    const site = list.find((s) => s.id === v);
    if (!site) return null;
    const pick = await pickSiteModel(site, null);
    if (!pick) return null;
    const ch = { id: auxId(), name: pick.keyId ? `${site.name}·${keyName(site, siteKey(site, pick.keyId))}` : site.name || "站点", site: site.id, ...pick };
    auxChannels().push(ch);
    saveSettings();
    toast(`已添加渠道「${ch.name}」`, "success");
    return ch;
  }
  // 站点的模型（多密钥站点连同分组）：{ model, keyId? }，取消返回 null
  async function pickSiteModel(site, cur) {
    if (siteMulti(site)) {
      const r = await pickKeyModel(site, { keyId: cur?.keyId || site.keyId, model: cur?.model || siteKey(site).model }, { title: `选择模型 · ${site.name}` });
      return r ? { keyId: r.keyId, model: r.model } : null;
    }
    const models = [...new Set([...site.models || [], site.model].filter(Boolean))];
    const was = cur?.model || site.model || "";
    const m = models.length > 1 ? await pickModel(models, was, { title: `选择模型 · ${site.name}`, site }) : models[0] || await promptBox(`「${site.name}」的模型名`, was, "如 deepseek-v4-flash");
    return m ? { model: String(m).trim() } : null;
  }
  // 编辑渠道；ch 为 null 时新建（只在副 API 里用的渠道）。返回保存后的渠道，取消、删除返回 null
  async function editChannel(ch) {
    const isNew = !ch;
    const site = ch?.site ? siteOf(ch.site) : null;
    const fromSite = !!ch?.site;
    const d = ch ? structuredClone(ch) : { id: auxId(), name: "", url: "", secretId: null, model: "", models: [] };
    const hasKey = !fromSite && !!(d.secretId || getLocalKey({ id: d.id }));
    let tempId = null, tempKey = "", fetched = null, pickedKey = d.keyId;
    const body = el(`<div class="pa-form">
        <label class="pa-field"><span>名称</span><input class="pa-input" data-f="name" placeholder="${esc(fromSite ? site?.name || "" : "如 硅基流动")}" autocomplete="off"></label>
        ${fromSite ? `<p class="pa-hint">网址和密钥跟着主 API 的站点「${esc(site?.name || "已删除")}」。</p>` : `
        <label class="pa-field"><span>网址</span><input class="pa-input" data-f="url" placeholder="https://api.siliconflow.cn/v1" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
        <label class="pa-field"><span>密钥</span><input class="pa-input" data-f="key" type="password" style="${KEY_INPUT_STYLE}" placeholder="${hasKey ? "已保存，留空不改" : "粘贴密钥"}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"></label>`}
        <div class="pa-field"><span>模型</span><div class="pa-aux-mrow"><input class="pa-input" data-f="model" placeholder="如 deepseek-ai/DeepSeek-V3" autocomplete="off" autocapitalize="off" spellcheck="false"><button class="pa-btn pa-btn-s" data-f="fetch" type="button">${fromSite ? "选择" : "获取列表"}</button></div></div>
      </div>`);
    const f = (k) => body.querySelector(`[data-f="${k}"]`);
    f("name").value = d.name || "";
    f("model").value = d.model || "";
    if (!fromSite) f("url").value = d.url || "";
    const label = () => `麦当劳副 API · ${f("name").value.trim() || hostOf(f("url")?.value) || "渠道"}`;
    f("fetch").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      if (fromSite) {
        if (!site) return toast("来自的站点已删除", "warning");
        const pick = await pickSiteModel(site, { keyId: pickedKey, model: f("model").value.trim() });
        if (pick) { f("model").value = pick.model; pickedKey = pick.keyId; }
        return;
      }
      const url = f("url").value.trim();
      if (!/^https?:\/\//i.test(url)) return toast("先填网址（http:// 或 https:// 开头）", "warning");
      const key = f("key").value.trim();
      let secretId = d.secretId;
      btn.disabled = true;
      const was = btn.textContent;
      btn.textContent = "获取中…";
      try {
        if (key) {
          if (!multiKeySupported()) throw new Error("这个酒馆版本不能用这里的密钥获取列表，请直接填模型名");
          if (!tempId || tempKey !== key) {
            if (tempId) await dropKey("custom", tempId);
            tempId = await storeKey("custom", key, label());
            tempKey = key;
          }
          secretId = tempId;
        }
        if (!secretId) throw new Error("先填密钥");
        const list = await withSiteKey({ source: "custom", secretId, name: f("name").value.trim() || "渠道" }, () => fetchModelList({ source: "custom", url }));
        if (!list.length) throw new Error("站点没有返回模型");
        fetched = list;
        const m = await pickModel(list, f("model").value.trim(), { title: `选择模型（${list.length}）` });
        if (m) f("model").value = m;
      } catch (err) {
        toast(`获取模型列表失败：${err.message}`, "warning");
      } finally {
        btn.disabled = false;
        btn.textContent = was;
      }
    });
    const check = () => {
      if (!fromSite && !/^https?:\/\//i.test(f("url").value.trim())) { toast("网址要以 http:// 或 https:// 开头", "warning"); return false; }
      if (!f("model").value.trim()) { toast("填写模型", "warning"); return false; }
      return true;
    };
    const r = await sheet({
      title: isNew ? "新建渠道" : `编辑「${d.name || "渠道"}」`,
      body,
      noFocus: !isNew,
      actions: [...isNew ? [] : [{ label: "删除", kind: "danger-soft", value: "del" }], { label: "取消", value: null }, { label: "保存", kind: "primary", value: "save", validate: check }]
    });
    if (r === "del") {
      if (tempId) await dropKey("custom", tempId);
      const ok = await confirmBox("删除渠道", `删除「${d.name || "渠道"}」？用它的功能改为跟随主 API。${fromSite ? "主 API 的站点不受影响。" : ""}`, "删除", true);
      if (!ok) return null;
      const a = auxSettings();
      a.channels = a.channels.filter((c) => c.id !== d.id);
      for (const [k, v] of Object.entries(a.use)) if (v === d.id) delete a.use[k];
      if (!fromSite) {
        if (d.secretId) await dropKey("custom", d.secretId);
        setLocalKey(d.id, null);
      }
      saveSettings();
      toast(`已删除渠道「${d.name || "渠道"}」`, "success");
      return null;
    }
    if (r !== "save") {
      if (tempId) await dropKey("custom", tempId);
      return null;
    }
    d.model = f("model").value.trim();
    if (fromSite) {
      d.name = f("name").value.trim() || site?.name || "站点";
      if (pickedKey) d.keyId = pickedKey;
    } else {
      d.url = f("url").value.trim();
      d.name = f("name").value.trim() || hostOf(d.url);
      if (fetched) d.models = fetched;
      const key = f("key").value.trim();
      if (key) {
        try {
          let id = tempId && tempKey === key ? tempId : null;
          if (!id && tempId) await dropKey("custom", tempId);
          if (!id && multiKeySupported()) id = await storeKey("custom", key, `麦当劳副 API · ${d.name}`);
          if (id) {
            if (d.secretId && d.secretId !== id) await dropKey("custom", d.secretId);
            d.secretId = id;
          } else setLocalKey(d.id, key);
        } catch (err) {
          toast(`密钥没存上：${err.message}`, "error");
          return null;
        }
      } else if (tempId) await dropKey("custom", tempId);
    }
    if (isNew) auxChannels().push(d);
    else Object.assign(auxChannel(d.id) || {}, d);
    saveSettings();
    toast(isNew ? `已添加渠道「${d.name}」` : `已保存「${d.name}」`, "success");
    return auxChannel(d.id);
  }
  async function test(id) {
    const ch = auxChannel(id);
    if (!ch || busy.has(id)) return;
    const t = auxChannelTarget(ch);
    if (!t) return toast("来自的站点已删除", "warning");
    busy.add(id);
    render();
    const t0 = performance.now();
    try {
      await auxSend(t, [{ role: "user", content: "Hi" }], { maxTokens: 60, timeout: 6e4 });
      tests.set(id, { sig: sigOf(ch), ok: true, text: `可用 · ${((performance.now() - t0) / 1e3).toFixed(1)} 秒` });
    } catch (e) {
      tests.set(id, { sig: sigOf(ch), ok: false, text: e.why || e.message, raw: e.raw || "" });
    } finally {
      busy.delete(id);
      render();
    }
  }
  box.addEventListener("click", async (e) => {
    if (e.target.closest("[data-why]")) return;
    const a = e.target.closest("[data-a]")?.dataset.a;
    if (a === "add") {
      await addChannel();
      return render();
    }
    const use = e.target.closest("[data-use]")?.dataset.use;
    if (use) {
      await choose(use);
      return render();
    }
    const id = e.target.closest("[data-ch]")?.dataset.ch;
    if (!id) return;
    if (a === "test") return test(id);
    if (a === "edit") {
      await editChannel(auxChannel(id));
      return render();
    }
  });
  return { render };
}
