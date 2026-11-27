// 2.11.23 连接 → 副 API。2.11.24 改成两段：「用途」每项一行，点了选跟随主 API 或某个渠道；
// 「渠道」列出副 API 自己的渠道，＋ 新建（只在这里用）或从主 API 的站点添加；点渠道编辑，闪电发一句 Hi 试试。
function mountAux(page) {
  page.innerHTML = '<div class="pa-scroll pa-plan pa-aux"></div>';
  const box = page.firstElementChild;
  bindWhy(box);
  // 2.12.19 测速按目标签名记（渠道的站点或网址、密钥、模型；跟随主 API 时是主 API 的模型）：
  // 上面功能卡、下面渠道卡的闪电共用一份，点哪个两处一起转圈、一起出结果；改了渠道就不再显示旧结果
  const tests = new Map();
  const busy = new Set();
  const flashOk = new Set();
  // 整理态：拖把手排序、垃圾桶删除；同源组收起，可展开删单项
  let editing = false;
  const editOpen = new Set();
  const sigOf = (ch) => JSON.stringify([ch.site || ch.url || "", ch.keyId || ch.secretId || "", ch.model || ""]);
  const followSig = () => JSON.stringify(["follow", auxLiveModel()]);
  const sigOfUse = (use) => { const t = auxTarget(use); return t.follow ? followSig() : sigOf(t.channel); };
  const hostOf = (url) => { try { return new URL(url).host; } catch { return String(url || ""); } };
  const siteOf = (id) => (settings().sites || []).find((x) => x.id === id) || null;
  const mainSites = () => (settings().sites || []).filter((x) => SOURCES[x.source]);
  const USE_SUB = { suture: "缝合页「AI 推荐」", review: "检查页语义核对" };
  const SHORT = { suture: "缝合", review: "审查" };
  const usesOf = (id) => AUX_USES.filter((u) => auxSettings().use[u.key] === id).map((u) => u.key);
  const routeLabel = (uses) => uses.length > 1 ? `${uses.length} 项在用` : uses.length ? `${SHORT[uses[0]] || "已"}在用` : "选用";
  const fromOf = (ch) => { const s = ch.site ? siteOf(ch.site) : null; return ch.site ? (s ? `主 API · ${s.name || "站点"}` : "来自的站点已删除") : hostOf(ch.url) || "未填网址"; };
  const mainName = () => { const a = (settings().sites || []).find((x) => x.id === settings().activeSiteId); return a?.name || "酒馆当前连接"; };
  const resText = (r) => r.ok ? `可用 · ${r.sec}s` : r.text;
  const resHtml = (r) => `<span class="pa-live-res ${r.ok ? "ok" : "bad"}" title="${esc(r.raw || resText(r))}">${r.ok ? RES_OK : RES_BAD}${esc(resText(r))}</span>`;
  const testBtn = (sig, attrs, label) => {
    const st = busy.has(sig) ? "busy" : flashOk.has(sig) ? "ok" : "idle";
    return `<button class="pa-icon-btn pa-aux-test has-morph" type="button" ${attrs} data-sig="${esc(sig)}" aria-label="${esc(label)}" title="发一句 Hi，看能不能用"${st === "busy" ? " disabled" : ""}>${icoMorph(ICON.bolt, st)}</button>`;
  };
  const grip = (label) => `<span class="grip-slot">${editing ? `<button type="button" class="pa-key-grip pa-aux-grip" aria-label="「${esc(label)}」：拖动或按上下方向键调整顺序" title="拖动调整顺序">${ICON_GRIP}</button>` : ""}</span>`;
  const delBtn = (ch) => `<button class="pa-icon-btn pa-site-del" data-a="delch" type="button" aria-label="删除渠道「${esc(ch.name || "渠道")}」" title="删除">${ICON.trash}</button>`;
  // 上半区：每项功能一张白卡。卡头功能名、用途、测速；下面全宽模型框（圆点：实心绿 渠道 / 空心灰 跟随主 API / 橙 渠道已失效）
  function fnCard(u) {
    const t = auxTarget(u.key);
    const sig = sigOfUse(u.key);
    const r = tests.get(sig);
    const dot = t.missing ? "miss" : t.follow ? "follow" : "ch";
    const v = t.follow
      ? `<b>跟随主 API</b>${t.model ? `<span class="pa-aux-sep"> · </span><code class="pa-mono">${esc(t.model)}</code>` : ""}`
      : `<b>${esc(t.name)}</b><span class="pa-aux-sep"> · </span><code class="pa-mono">${esc(t.model || "未选模型")}</code>`;
    return `<section class="pa-card pa-aux-fn" data-fn="${u.key}">
        <header class="pa-aux-fnhead"><span class="pa-aux-fnt"><b>${esc(u.label)}</b><small>${USE_SUB[u.key] || ""}</small></span><span class="pa-aux-resslot">${r ? resHtml(r) : ""}</span>${testBtn(sig, `data-a="fntest" data-u="${u.key}"`, `测试「${u.label}」用的 API`)}</header>
        <button class="pa-aux-row model-box" type="button" data-use="${u.key}" aria-haspopup="listbox" aria-expanded="false" aria-label="${esc(`${u.label}：${auxLabel(t)}，点按更换`)}"><i class="pa-aux-dot is-${dot}" aria-hidden="true"></i><span class="pa-aux-v">${v}${t.missing ? '<small class="pa-aux-bad">选过的渠道已失效</small>' : ""}</span><span class="pa-aux-caret" aria-hidden="true">${ICON.caret}</span></button>
      </section>`;
  }
  // 下半区：每个渠道一张圆角卡。左边点正文编辑；右边测速、四态指派胶囊（选用 / 缝合在用 / 审查在用 / 2 项在用）
  function chCard(ch, child = null) {
    const sig = sigOf(ch);
    const r = tests.get(sig);
    const uses = usesOf(ch.id);
    let name = ch.name || "渠道";
    // 同源组的子行：去掉重复的站点名前缀（「云雾 · Haiku 4.5」→「Haiku 4.5」）
    if (child) {
      const cut = name.startsWith(child.name) ? name.slice(child.name.length).replace(/^\s*[·・:：\-]\s*/, "") : name;
      name = cut && cut !== name ? cut : name === child.name ? ch.model || name : name;
    }
    const bad = ch.site && !siteOf(ch.site);
    const line2 = `${r?.ok ? `${resHtml(r)}<span class="pa-aux-sep"> · </span>` : ""}<span class="pa-aux-m">${esc(ch.model || "未选模型")}</span>${child ? "" : `<span class="pa-aux-sep"> · </span><span${bad ? ' class="pa-aux-bad"' : ""}>${esc(fromOf(ch))}</span>`}`;
    return `<div class="pa-sitecard pa-aux-ch${child ? " pa-aux-child" : " pa-aux-unit"}${uses.length ? " on-route" : ""}" data-ch="${esc(ch.id)}">
        ${child ? "" : grip(name)}<button class="site-main pa-aux-chmain" type="button" data-a="edit" aria-label="${esc(`编辑渠道「${ch.name || "渠道"}」`)}"${editing ? ' tabindex="-1"' : ""}><span class="pa-aux-k"><b>${esc(name)}</b><small>${line2}</small></span></button>
        <span class="site-actions">${editing ? delBtn(ch) : `${testBtn(sig, 'data-a="test"', `测试渠道「${ch.name || "渠道"}」`)}<button class="pa-swpill pa-aux-pill${uses.length ? " on-route" : ""}" type="button" data-a="assign" aria-haspopup="menu" aria-label="${esc(`「${ch.name || "渠道"}」：${routeLabel(uses)}，点按指派`)}">${routeLabel(uses)}</button>`}</span>
        ${r && !r.ok ? `<p class="pa-live-res bad pa-aux-chres" title="${esc(r.raw || r.text)}">${RES_BAD}${esc(r.text)}</p>` : ""}
      </div>`;
  }
  // 同一个主 API 站点来的渠道有两个以上：合成一张卡，像多密钥站点一样点「N 个」展开子行
  function grpCard(site, chs) {
    const open = editing ? editOpen.has(site.id) : foldGet("auxgrp", site.id);
    const uses = [...new Set(chs.flatMap((c) => usesOf(c.id)))];
    const models = [...new Set(chs.map((c) => c.model).filter(Boolean))];
    return `<div class="pa-sitecard pa-aux-grp pa-aux-unit${open ? " open" : ""}${uses.length ? " on-route" : ""}" data-site="${esc(site.id)}">
        <div class="pa-aux-ghead">${grip(site.name || "站点")}<button class="site-main pa-aux-gmain" type="button" data-a="grpfold" aria-expanded="${open}"><span class="pa-aux-k"><b>${esc(site.name || "站点")}</b><small>主 API 同源站点 · 含 ${esc(models.join("、") || "未选模型")}</small></span></button>
        <span class="site-actions">${uses.length && !editing ? `<span class="pa-chip pa-aux-routetag">${routeLabel(uses)}</span>` : ""}<button class="pa-swpill pa-fold-pill" data-a="grpfold" type="button" aria-expanded="${open}" aria-label="${chs.length} 个渠道，${open ? "收起" : "展开"}"><span>${chs.length} 个</span><span class="fold-caret" aria-hidden="true">${FOLD_SVG}</span></button></span></div>
        ${open ? `<div class="pa-klines pa-aux-glines">${chs.map((c) => chCard(c, site)).join("")}${editing ? "" : `<button class="pa-aux-addmore" type="button" data-a="addsite" data-site="${esc(site.id)}"><span class="pa-mi" aria-hidden="true">${ICON.plus}</span>添加「${esc(site.name || "站点")}」的其他模型…</button>`}</div>` : ""}
      </div>`;
  }
  // 渠道按设置里的顺序排；同源的两个以上合成一组，放在组里第一个渠道的位置
  function units() {
    const chs = auxChannels();
    const n = new Map();
    for (const c of chs) if (c.site && siteOf(c.site)) n.set(c.site, (n.get(c.site) || 0) + 1);
    const out = [], grp = new Map();
    for (const c of chs) {
      if (c.site && n.get(c.site) >= 2) {
        if (!grp.has(c.site)) { const u = { site: siteOf(c.site), chs: [] }; grp.set(c.site, u); out.push(u); }
        grp.get(c.site).chs.push(c);
      } else out.push({ ch: c });
    }
    return out;
  }
  const chipEnter = (n) => { if (n.matches?.(".pa-swpill, .pa-chip")) replay(n, "chip-enter", 260); };
  function render() {
    const chs = auxChannels();
    const us = units();
    const head = editing
      ? `<button class="pa-head-ico pa-head-add" data-a="add" type="button" aria-label="添加渠道" title="添加渠道">${ICON.plus}</button><button class="pa-swpill pa-done-pill" data-a="chdone" type="button">完成</button>`
      : `<button class="pa-head-ico pa-head-add" data-a="add" type="button" aria-label="添加渠道" title="添加渠道">${ICON.plus}</button>${chs.length ? `<button class="pa-head-ico pa-head-more" data-a="chmore" type="button" aria-label="排序与删除渠道" title="排序与删除">${ICON.pencil}</button>` : ""}`;
    const html = `
      <div class="pa-row-head"><h3 class="pa-h">内部 AI 分流${whyBtn("aux")}</h3></div>
      ${whyNote("aux", "<p>麦当劳自己的 AI 功能用哪个 API。用渠道时不切换酒馆的连接，聊天照常用主 API。</p><p>推荐便宜、快的模型，如 DeepSeek Flash、豆包。</p>")}
      <div class="pa-aux-fns">${AUX_USES.map(fnCard).join("")}</div>
      <div class="pa-row-head"><h3 class="pa-h">渠道${whyBtn("auxch")}</h3><div class="pa-head-btns">${head}</div></div>
      ${whyNote("auxch", editing ? "<p>按住左侧把手拖动调整顺序（也决定选渠道时的先后），点垃圾桶删除。</p>" : "<p>新建的渠道只在副 API 里用，不进主 API 的站点列表；硅基流动、火山方舟等填 OpenAI 兼容的网址。也可以从主 API 的站点添加，网址和密钥跟着站点。</p><p>点右边的胶囊把渠道指派给上面的功能。</p>")}
      ${chs.length ? `<div class="pa-aux-chs">${us.map((u) => u.ch ? chCard(u.ch) : grpCard(u.site, u.chs)).join("")}</div>` : '<p class="pa-empty">还没有渠道。点 ＋ 新建，或从主 API 的站点添加。</p>'}`;
    box.classList.toggle("is-curating", editing);
    const sig = us.map((u) => u.ch ? u.ch.id : `g:${u.site.id}`).join(",");
    if (box._sig === sig && box.firstElementChild) morphHtml(box, html, chipEnter);
    else box.innerHTML = html;
    box._sig = sig;
  }
  const pulse = (sel) => box.querySelectorAll(sel).forEach((n) => replay(n, "just-switched", 600));
  // 点功能卡的模型框：与框等宽的贴边下拉。首项跟随主 API，其下全部渠道（多于 5 个时顶部有搜索），底部「＋ 添加渠道」
  async function choose(use, anchor) {
    const u = AUX_USES.find((x) => x.key === use);
    const cur = auxSettings().use[use] || "";
    const chs = auxChannels();
    const items = [{ value: "", label: "跟随主 API", sub: `${mainName()} · ${auxLiveModel() || "未选模型"}` },
      ...chs.map((c) => ({ value: c.id, label: c.name || "渠道", sub: `${c.model || "未选模型"} · ${fromOf(c)}` }))];
    const curV = chs.some((c) => c.id === cur) ? cur : "";
    const body = el(`<div class="pa-npick pa-auxpick" style="${LIST_STYLE}">${items.length > 5 ? `<input class="pa-input pa-npick-q" style="${FIELD_STYLE}" type="text" inputmode="search" placeholder="搜索渠道或模型" autocomplete="off" autocapitalize="off" spellcheck="false">` : ""}<div class="pa-npick-list" role="listbox" style="${LIST_STYLE}"></div>
      <div class="pa-auxpick-foot"><button type="button" class="pa-npick-item pa-auxpick-add" data-v="\u0002add"><span class="pa-mi" aria-hidden="true">${ICON.plus}</span><span>添加渠道</span><small>新建，或从主站点选模型</small></button></div></div>`);
    const list = body.querySelector(".pa-npick-list");
    const q = body.querySelector(".pa-npick-q");
    const paint = () => {
      const k = (q?.value || "").trim().toLowerCase();
      list.innerHTML = items.filter((it) => !k || `${it.label} ${it.sub}`.toLowerCase().includes(k)).map((it) => {
        const on = it.value === curV;
        return `<button type="button" class="pa-npick-item${on ? " on" : ""}" style="${ROW_STYLE}" data-v="${esc(it.value)}" role="option" aria-selected="${on}"><span>${esc(it.label)}</span><small>${esc(it.sub)}</small>${on ? `<span class="pa-mi pa-mi-check" aria-hidden="true">${ICON.check}</span>` : ""}</button>`;
      }).join("") || '<p class="pa-hint">没有匹配的渠道</p>';
    };
    paint();
    let v = null;
    // 2.12.22 下拉开着时模型框的箭头朝上，关上转回
    const row = anchor?.closest?.(".pa-aux-row");
    row?.setAttribute("aria-expanded", "true");
    await sheet({ title: u.label, body, place: "pop", anchor, popWidth: true, actions: [], onMount: (w) => {
      q?.addEventListener("input", paint);
      body.addEventListener("click", (e) => {
        const b = e.target.closest("[data-v]");
        if (!b) return;
        v = b.dataset.v;
        w._close(null);
      });
    } });
    if (row?.isConnected) row.setAttribute("aria-expanded", "false");
    if (v === null) return;
    let id = v;
    if (v === "\u0002add") {
      const ch = await addChannel();
      if (!ch) return render();
      id = ch.id;
    }
    if (id) auxSettings().use[use] = id;
    else delete auxSettings().use[use];
    saveSettings();
    render();
    pulse(`.pa-aux-fn[data-fn="${use}"]`);
    if (id) pulse(`.pa-aux-ch[data-ch="${CSS.escape(id)}"]`);
  }
  // 渠道卡的指派胶囊：按现在的占用给出最直白的几项，选了立刻同步上面的功能卡
  async function assign(id, anchor) {
    const ch = auxChannel(id);
    if (!ch) return;
    const uses = usesOf(id);
    const items = [];
    if (!uses.length) {
      items.push({ value: AUX_USES.map((u) => u.key), label: "两项功能都用它" });
      for (const u of AUX_USES) items.push({ value: [u.key], label: `用于「${u.label}」` });
    } else if (uses.length < AUX_USES.length) {
      for (const u of AUX_USES) if (!uses.includes(u.key)) items.push({ value: [...uses, u.key], label: `也用于「${u.label}」` }, { value: [u.key], label: `改为只用于「${u.label}」` });
    } else for (const u of AUX_USES) items.push({ value: [u.key], label: `只用于「${u.label}」` });
    if (uses.length) items.push({ value: [], label: "改回跟随主 API", sub: uses.map((k) => AUX_USES.find((u) => u.key === k)?.label).join("、") });
    const want = await pickBox(`「${ch.name || "渠道"}」用于`, items, { anchor });
    if (!want) return;
    const a = auxSettings();
    const changed = [];
    for (const u of AUX_USES) {
      const on = want.includes(u.key);
      if (on && a.use[u.key] !== id) { a.use[u.key] = id; changed.push(u.key); }
      if (!on && a.use[u.key] === id) { delete a.use[u.key]; changed.push(u.key); }
    }
    saveSettings();
    render();
    for (const k of changed) pulse(`.pa-aux-fn[data-fn="${k}"]`);
    pulse(`.pa-aux-ch[data-ch="${CSS.escape(id)}"]`);
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
    return addFromSite(site);
  }
  // 从主 API 的站点选一个模型加成渠道（同源组底部的「添加其他模型」也走这里）
  async function addFromSite(site) {
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
      guardDirty: true,
      // 2.12.16 在关窗前问「删除渠道」：点「取消」时窗口和填写的内容都还在
      actions: [...isNew ? [] : [{ label: "删除", kind: "danger-soft", value: "del", validate: () => confirmBox("删除渠道", `删除「${d.name || "渠道"}」？用它的功能改为跟随主 API。${fromSite ? "主 API 的站点不受影响。" : ""}`, "删除", true) }], { label: "取消", value: null }, { label: "保存", kind: "primary", value: "save", validate: check }]
    });
    if (r === "del") {
      if (tempId) await dropKey("custom", tempId);
      await dropChannel(d);
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
  // 删除渠道：用它的功能改回跟随主 API；只在副 API 用的渠道连同密钥一起删
  async function dropChannel(d) {
    const a = auxSettings();
    a.channels = a.channels.filter((c) => c.id !== d.id);
    for (const [k, v] of Object.entries(a.use)) if (v === d.id) delete a.use[k];
    if (!d.site) {
      if (d.secretId) await dropKey("custom", d.secretId);
      setLocalKey(d.id, null);
    }
    saveSettings();
    toast(`已删除渠道「${d.name || "渠道"}」`, "success");
  }
  // 测速：上下两处共用 sig 的状态，图标闪电 → 转圈 → ✓ 原地叠化
  async function runTest(sig, t) {
    if (busy.has(sig)) return;
    busy.add(sig);
    render();
    const t0 = performance.now();
    try {
      await auxSend(t, [{ role: "user", content: "Hi" }], { maxTokens: 60, timeout: 6e4 });
      tests.set(sig, { ok: true, sec: ((performance.now() - t0) / 1e3).toFixed(1) });
      flashOk.add(sig);
      setTimeout(() => {
        flashOk.delete(sig);
        box.querySelectorAll(".pa-aux-test").forEach((b) => { if (b.dataset.sig === sig) setIco(b, "idle"); });
      }, 1200);
    } catch (e) {
      tests.set(sig, { ok: false, text: e.why || e.message, raw: e.raw || "" });
    } finally {
      busy.delete(sig);
      render();
    }
  }
  box.addEventListener("click", async (e) => {
    if (e.target.closest("[data-why]")) return;
    const btn = e.target.closest("[data-a]");
    const a = btn?.dataset.a;
    if (a === "add") {
      await addChannel();
      return render();
    }
    if (a === "chmore") {
      editing = true;
      editOpen.clear();
      return render();
    }
    // 退出整理态：先收回把手（190ms），再换回测速、指派
    if (a === "chdone") {
      box.classList.remove("is-curating");
      await new Promise((r) => setTimeout(r, reducedMotion() ? 0 : 190));
      editing = false;
      return render();
    }
    if (a === "fntest") {
      const t = auxTarget(btn.dataset.u);
      return runTest(sigOfUse(btn.dataset.u), t);
    }
    const use = e.target.closest("[data-use]")?.dataset.use;
    if (use) return choose(use, e.target.closest("[data-use]"));
    if (a === "addsite") {
      const site = siteOf(btn.dataset.site);
      if (site && await addFromSite(site)) render();
      return;
    }
    // 同源组：原地呼吸展开、收起
    if (a === "grpfold") {
      const card = btn.closest(".pa-aux-grp");
      const sid = card?.dataset.site;
      if (!sid) return;
      const open = card.classList.contains("open");
      if (open) {
        card.classList.remove("open");
        if (!await accOut(card.querySelector(".pa-aux-glines"))) return;
        editing ? editOpen.delete(sid) : foldSet("auxgrp", sid, false);
        return render();
      }
      editing ? editOpen.add(sid) : foldSet("auxgrp", sid, true);
      render();
      return accIn(box.querySelector(`.pa-aux-grp[data-site="${CSS.escape(sid)}"] .pa-aux-glines`));
    }
    const id = e.target.closest("[data-ch]")?.dataset.ch;
    if (!id) return;
    const ch = auxChannel(id);
    if (!ch) return;
    if (a === "test") {
      const t = auxChannelTarget(ch);
      if (!t) return toast("来自的站点已删除", "warning");
      return runTest(sigOf(ch), t);
    }
    if (a === "assign") return assign(id, btn);
    if (a === "delch") {
      if (!await confirmBox("删除渠道", `删除「${ch.name || "渠道"}」？用它的功能改为跟随主 API。${ch.site ? "主 API 的站点不受影响。" : ""}`, "删除", true)) return;
      await dropChannel(ch);
      return render();
    }
    // 整理态下点卡片不弹编辑窗
    if (a === "edit" && !editing) {
      await editChannel(ch);
      return render();
    }
  });
  // 整理态：按住把手拖动（或方向键）调整顺序；同源组整组移动
  dragSort(box, { grip: ".pa-aux-grip", row: ".pa-aux-unit", onDrop: (from, to, how) => {
    const us = units();
    moveItem(us, from, to);
    auxSettings().channels = us.flatMap((u) => u.ch ? [u.ch] : u.chs);
    saveSettings();
    render();
    if (how.keyboard) box.querySelectorAll(".pa-aux-grip")[to]?.focus();
  } });
  return { render };
}
