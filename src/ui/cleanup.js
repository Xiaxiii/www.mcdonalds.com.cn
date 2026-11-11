// 1.5.0「清理」页：看清每个预设占多少、哪些可以清理；归档到服务器（打开时不再下载）、随时恢复。
// 归档文件放在酒馆的「用户文件」目录，清单记在本扩展的设置里，换设备、换浏览器都能看到和恢复。

// 记录每个预设最近一次被选用的时间（酒馆本身不记）。只记名称和时间。
function notePresetUse(name, { save = true } = {}) {
  if (!name) return;
  const s = settings();
  if (!s.presetUse || typeof s.presetUse !== "object") s.presetUse = {};
  if (!s.presetUseSince) s.presetUseSince = Date.now();
  s.presetUse[name] = Date.now();
  if (save) saveSettings();
}
function archiveList() {
  const s = settings();
  if (!Array.isArray(s.archive)) s.archive = [];
  return s.archive;
}
function relDay(t) {
  if (!t) return "";
  const d = Math.floor((Date.now() - t) / 864e5);
  return d <= 0 ? "今天用过" : d === 1 ? "昨天用过" : `${d} 天前用过`;
}
function dateStr(t) {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
// 哪些预设被方案或酒馆的「连接配置」用着
function presetUsers() {
  const out = {};
  const add = (n, why) => (out[n] ||= []).push(why);
  for (const s of settings().schemes || []) if (s.preset) add(s.preset, `方案「${s.name}」`);
  for (const p of ctx().extensionSettings?.connectionManager?.profiles || []) if (p?.preset) add(p.preset, `连接配置「${p.name}」`);
  return out;
}
function presetText(name) {
  const { presets } = pm().getPresetList();
  const idx = presetIndex(name);
  const data = name === currentPresetName() ? readPreset(name) : presets[idx];
  return JSON.stringify(data ?? null);
}
// 从归档恢复一个预设。被方案套用时也会调用（方案对应的预设已归档 → 自动恢复后再切换）。
async function restoreArchived(entry, { ask = true } = {}) {
  const text = await userFileGetText(entry.path, entry.gz);
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("归档文件已损坏，无法读取");
  }
  if (listPresets().includes(entry.name)) {
    if (ask && !await confirmBox("已有同名预设", `预设文件夹中已有「${entry.name}」。恢复会用归档的版本覆盖它，是否继续？`, "覆盖")) return false;
  }
  await restorePresetFile(entry.name, data);
  const list = archiveList();
  const i = list.indexOf(entry);
  if (i >= 0) list.splice(i, 1);
  saveSettings();
  await userFileDel(entry.path).catch((e) => console.warn("[焦香鸡翅] 归档文件删除失败", e));
  dropDraft(entry.name);
  return true;
}
async function restoreArchivedByName(name) {
  const e = archiveList().find((x) => x.name === name);
  if (!e) return false;
  toast(`正在从归档恢复「${name}」…`);
  return restoreArchived(e, { ask: false });
}
function mountCleanup(sec) {
  // 1.7.0：分栏——预设 / 扩展数据 / 角色卡 / 世界书 / 本地备份
  const KINDS = [["preset", "预设"], ["ext", "扩展数据"], ["char", "角色卡"], ["world", "世界书"], ["local", "本地备份"]];
  sec.innerHTML = `<div class="pa-scroll pa-clean"><div class="pa-ckinds"><div class="pa-seg pa-seg-s" role="tablist">${KINDS.map(([k, l]) => `<button data-kind="${k}" class="${k === "preset" ? "on" : ""}">${l}</button>`).join("")}</div></div>
    <div class="pa-clean-body"><p class="pa-hint">正在分析预设…</p></div><div class="pa-clean-other" hidden></div></div>
    <div class="pa-movebar pa-clean-act" hidden></div>`;
  const body = sec.querySelector(".pa-clean-body");
  const act = sec.querySelector(".pa-clean-act");
  const st = { filter: null, sort: "size", sel: new Set(), rows: [], busy: false, open: new Set(), kind: "preset", pairOpen: new Set(), pairMore: false };
  sec.querySelector(".pa-ckinds").addEventListener("click", (e) => {
    const b = e.target.closest("[data-kind]");
    if (!b || st.busy) return;
    st.kind = b.dataset.kind;
    sec.querySelectorAll("[data-kind]").forEach((x) => x.classList.toggle("on", x === b));
    const other = sec.querySelector(".pa-clean-other");
    body.hidden = st.kind !== "preset";
    other.hidden = st.kind === "preset";
    if (st.kind === "preset") return render();
    act.hidden = true;
    // 每次换栏都换一个新容器，事件不会叠加
    const fresh = document.createElement("div");
    fresh.className = "pa-clean-other";
    other.replaceWith(fresh);
    mountCleanKind(st.kind, fresh);
  });
  const MB = 1024 * 1024;
  // 估算：勾选的预设大约占设置下载里多少实际传输（按本次设置请求的传输量等比例折算，只是估计）
  function estimate(bytes) {
    try {
      return wireEstimate(bytes);
    } catch {
      return null;
    }
  }
  async function scan() {
    const names = listPresets();
    const { presets } = pm().getPresetList();
    const cur = currentPresetName();
    const list = [];
    // 2.4.0：先让切页显示出来再开始算
    await nextPaint();
    let slice = performance.now();
    for (const n of names) {
      const obj = n === cur ? null : presets[presetIndex(n)];
      // 2.4.0：1 分钟内算过的预设直接用结果，来回切页不再重算（见 scanCached）
      const known = scanCached(obj);
      if (known) {
        list.push({ name: n, data: obj, full: known.full, size: known.size, prints: known.prints });
        continue;
      }
      let text;
      try {
        text = n === cur ? presetText(n) : JSON.stringify(obj ?? null);
      } catch {
        continue;
      }
      // 不再 JSON.parse 一份副本：77 个预设会多占几十 MB 内存，iOS 内存紧张时会直接刷新页面
      // 文本只用来算大小和指纹，算完就丢
      const data = n === cur ? JSON.parse(text) : obj;
      // 条目指纹（找相似预设用）也在这里分段算好，一起记住
      const sum = { full: hashStr(text), size: new Blob([text]).size, prints: promptPrints(data) };
      if (obj && typeof obj === "object") scanCache.set(obj, { ...sum, at: Date.now() });
      list.push({ name: n, data, ...sum });
      // 2.4.0：按时间让出（每 30ms 一次），大预设多时界面不卡
      if (performance.now() - slice > 30) {
        await new Promise((r) => setTimeout(r, 0));
        slice = performance.now();
      }
    }
    st.rows = scanPresets(list, { current: cur, inUse: presetUsers(), lastUse: settings().presetUse || {} });
    for (const n of [...st.sel]) if (!st.rows.some((r) => r.name === n && !r.current)) st.sel.delete(n);
    if (!st.filter) st.filter = st.rows.some((r) => r.suggest) ? "suggest" : "all";
  }
  function view() {
    let rows = st.filter === "suggest" ? st.rows.filter((r) => r.suggest) : st.rows;
    const by = {
      size: (a, b) => b.size - a.size,
      name: (a, b) => a.name.localeCompare(b.name, "zh"),
      used: (a, b) => (a.lastUse || 0) - (b.lastUse || 0) || b.size - a.size
    }[st.sort];
    return [...rows].sort(by);
  }
  function draw() {
    const all = st.rows;
    const total = all.reduce((n, r) => n + r.size, 0);
    const sugg = all.filter((r) => r.suggest);
    const suggSize = sugg.reduce((n, r) => n + r.size, 0);
    const arch = archiveList();
    const archSize = arch.reduce((n, a) => n + (a.size || 0), 0);
    const est = estimate(total);
    const others = (() => {
      try {
        const l = allPresetSizes().filter((x) => x.api !== "openai");
        return { n: l.length, size: l.reduce((n, x) => n + x.size, 0) };
      } catch {
        return { n: 0, size: 0 };
      }
    })();
    const max = all[0] ? Math.max(...all.map((r) => r.size)) : 1;
    const since = settings().presetUseSince;
    const tagChip = (t) => `<span class="pa-chip pa-ctag-${t.k}" title="${esc(t.t)}">${esc(t.t)}</span>`;
    const row = (r, role = "") => `<label class="pa-crow${r.current ? " pa-locked" : ""}${st.sel.has(r.name) ? " on" : ""}">
        <input type="checkbox" data-c="pick" data-n="${esc(r.name)}" ${r.current ? "disabled" : ""} ${st.sel.has(r.name) ? "checked" : ""}>
        <span class="pa-crow-main"><b>${esc(r.name)}</b><span class="pa-crow-tags">${role}${r.current ? '<span class="pa-chip pa-chip-cot">当前使用</span>' : ""}${role ? "" : r.tags.map(tagChip).join("")}${r.inUse.map((w) => `<span class="pa-chip pa-ctag-use" title="${esc(w)}在用">${esc(w)}在用</span>`).join("")}${r.lastUse ? `<span class="pa-chip pa-chip-dim">${relDay(r.lastUse)}</span>` : since && Date.now() - since > 7 * 864e5 ? '<span class="pa-chip pa-chip-dim">开始记录后未用过</span>' : ""}</span></span>
        <span class="pa-crow-size"><i class="pa-bar"><b style="width:${Math.max(2, Math.round(r.size / max * 100))}%"></b></i><em>${fmtSize(r.size)}</em></span>
      </label>`;
    const archRow = (a, i) => `<div class="pa-crow pa-crow-arch">
        <span class="pa-crow-main"><b>${esc(a.name)}</b><span class="pa-crow-tags"><span class="pa-chip pa-chip-dim">${dateStr(a.at)} 归档</span></span></span>
        <span class="pa-crow-size"><em>${fmtSize(a.size || 0)}</em></span>
        <span class="pa-crow-btns"><button class="pa-btn pa-btn-s pa-btn-soft" data-c="restore" data-i="${i}">恢复</button><button class="pa-btn pa-btn-s" data-c="adl" data-i="${i}">下载</button><button class="pa-btn pa-btn-s pa-btn-danger-soft" data-c="adel" data-i="${i}">删除</button></span>
      </div>`;
    const list = view();
    // 「可清理」按相近的两份（或一份与它的几个旧版）折叠成组，两边都列出来，由玩家决定清理哪一份
    const byName = new Map(all.map((r) => [r.name, r]));
    const groups = [];
    if (st.filter === "suggest") {
      const at = new Map();
      for (const r of list) {
        const ref = r.tags[0]?.ref;
        const keep = byName.get(ref);
        if (!keep) { groups.push({ keep: null, items: [r] }); continue; }
        if (!at.has(ref)) { at.set(ref, { keep, items: [] }); groups.push(at.get(ref)); }
        at.get(ref).items.push(r);
      }
    }
    const keepWhy = (k, o) => k.current ? "当前使用" : k.inUse.length ? `${k.inUse[0]}在用` : (k.lastUse || 0) > (o.lastUse || 0) ? "最近用过" : o.tags[0]?.k === "old" ? "版本更新" : "";
    const PAIR_MAX = 8;
    const pair = (g) => {
      const first = g.items[0], key = g.keep?.name || first.name;
      const picked = [g.keep, ...g.items].filter((r) => r && st.sel.has(r.name)).length;
      const why = g.keep ? keepWhy(g.keep, first) : "";
      const head = g.keep ? (g.items.length === 1 ? `<b>${esc(first.name)}</b><span class="pa-dim"> ↔ </span><b>${esc(g.keep.name)}</b>` : `<b>${esc(g.keep.name)}</b><span class="pa-dim"> 与 ${g.items.length} 份相近</span>`) : `<b>${esc(first.name)}</b>`;
      return `<details class="pa-cpair" data-pair="${esc(key)}" ${st.pairOpen.has(key) ? "open" : ""}>
        <summary><span class="pa-cpair-t">${head}</span><span class="pa-crow-tags">${g.items.length === 1 ? tagChip({ k: first.tags[0].k, t: first.tags[0].t.replace(/^与「[^」]*」\s*/, "") }) : ""}${picked ? `<span class="pa-chip pa-chip-warn">已选 ${picked}</span>` : ""}</span></summary>
        <p class="pa-hint">勾选要清理的一份，两份均可选。${why ? `建议保留「${esc(g.keep.name)}」（${why}）。` : ""}</p>
        <div class="pa-clist">${g.keep ? row(g.keep, '<span class="pa-chip pa-chip-cot">建议保留</span>') : ""}${g.items.map((r) => row(r, `<span class="pa-chip pa-ctag-${r.tags[0].k}">${esc(r.tags[0].t.replace(/^与「[^」]*」\s*/, "") || "可清理")}</span>`)).join("")}</div>
      </details>`;
    };
    const pairsHtml = () => `${groups.slice(0, st.pairMore ? groups.length : PAIR_MAX).map(pair).join("")}${groups.length > PAIR_MAX && !st.pairMore ? `<button class="pa-link" data-c="pairmore">再显示 ${groups.length - PAIR_MAX} 组</button>` : ""}`;
    body.innerHTML = `
      <div class="pa-sum">
        <p class="pa-sum-main"><b>${all.length}</b> 个预设 · <b>${fmtSize(total)}</b>${arch.length ? ` · 已归档 ${arch.length}` : ""}${sugg.length ? ` · <span class="pa-warn">可清理 ${sugg.length}（${fmtSize(suggSize)}）</span>` : ""}</p>
        <div class="pa-stack" aria-hidden="true">${[...all].sort((a, b) => (b.suggest - a.suggest) || (b.size - a.size)).map((r) => `<i class="${st.sel.has(r.name) ? "sel" : r.suggest ? "sug" : ""}" style="flex-grow:${r.size}" title="${esc(r.name)} ${fmtSize(r.size)}"></i>`).join("")}</div>
        ${tip(`<p>酒馆每次打开都读取全部聊天补全预设${est ? `，约占设置下载 ${fmtSize(est.wire)}（估计）` : ""}。</p>
          ${others.n ? `<p>其他类型预设 ${others.n} 个（${fmtSize(others.size)}）同样随设置读取，本页不处理。</p>` : ""}
          ${arch.length ? `<p>已归档 ${arch.length} 个（${fmtSize(archSize)}），打开时不再读取。</p>` : ""}
          <p>条形图：<span class="pa-key"><i class="sug"></i>可考虑清理</span> <span class="pa-key"><i></i>其余</span> <span class="pa-key"><i class="sel"></i>已勾选</span></p>
          <ul class="pa-legend">
            <li><span class="pa-chip pa-ctag-same">完全相同</span><span>与另一个预设一字不差，保留一个即可。</span></li>
            <li><span class="pa-chip pa-ctag-old">有新版</span><span>名称相同、版本号更低。</span></li>
            <li><span class="pa-chip pa-ctag-series">同系列</span><span>名称只差「_json」「(1)」「副本」等后缀。</span></li>
            <li><span class="pa-chip pa-ctag-near">条目相同</span><span>与另一个预设的大部分条目相同。</span></li>
            <li><span class="pa-chip pa-ctag-use">在用</span><span>被方案或连接配置使用。</span></li>
          </ul>
          <p>归档：移出预设文件夹、存入服务器，打开酒馆时不再读取，可随时恢复。标签仅作提示；正在使用的预设不能勾选。</p>`)}
      </div>
      <div class="pa-clean-bar">
        <div class="pa-seg pa-seg-s" role="tablist">
          <button data-f="suggest" class="${st.filter === "suggest" ? "on" : ""}">可清理 ${sugg.length}</button>
          <button data-f="all" class="${st.filter === "all" ? "on" : ""}">全部 ${all.length}</button>
          <button data-f="arch" class="${st.filter === "arch" ? "on" : ""}">已归档 ${arch.length}</button>
        </div>
        ${st.filter !== "arch" ? `<button type="button" class="pa-sortbtn" data-c="sort" aria-label="排序方式">↕ ${{ size: "大小", used: "最近使用", name: "名称" }[st.sort] || "大小"}</button>` : ""}
      </div>
      ${st.filter === "arch" ? arch.length ? `<div class="pa-clist">${arch.map(archRow).join("")}</div>` : '<p class="pa-empty">还没有归档的预设。</p>'
        : `${list.length ? `${list.some((r) => !r.current) ? `<div class="pa-clist-head"><button class="pa-link" data-c="all">${list.filter((r) => !r.current).every((r) => st.sel.has(r.name)) ? "取消全选" : st.filter === "suggest" ? "全选可清理" : "全选本页"}</button></div>` : ""}${st.filter === "suggest" ? `<div class="pa-clist">${pairsHtml()}</div>` : `<div class="pa-clist">${list.map((r) => row(r)).join("")}</div>`}` : '<p class="pa-empty">没有可清理的预设。</p>'}
`}`;
    drawBar();
  }
  function drawBar() {
    const pick = st.rows.filter((r) => st.sel.has(r.name));
    act.hidden = !pick.length || st.filter === "arch";
    if (act.hidden) return;
    const size = pick.reduce((n, r) => n + r.size, 0);
    const est = estimate(size);
    act.innerHTML = `<b>已选 ${pick.length} 个 · ${fmtSize(size)}${est?.wire ? ` · 设置下载约少 ${fmtSize(est.wire)}（估计）` : ""}</b>
      <button class="pa-btn" data-c="none">取消</button>
      <button class="pa-btn" data-c="dl">下载</button>
      <button class="pa-btn pa-btn-danger-soft" data-c="del">删除</button>
      <button class="pa-btn pa-btn-primary" data-c="arch" title="移出预设文件夹，打开酒馆时不再读取，可随时恢复">归档</button>`;
  }
  async function render() {
    if (st.busy || st.kind !== "preset") return;
    try {
      await scan();
    } catch (e) {
      body.innerHTML = `<p class="pa-warn">分析出错：${esc(e.message)}</p>`;
      return;
    }
    draw();
  }
  const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
  function zipOf(names) {
    return makeZip(names.map((n) => ({ name: `${n}.json`, data: JSON.stringify(JSON.parse(presetText(n)), null, 4) })));
  }
  function busy(on, text) {
    st.busy = on;
    act.querySelectorAll("button").forEach((b) => { b.disabled = on; });
    if (text) act.querySelector("b").textContent = text;
  }
  const usersOf = (names) => names.flatMap((n) => (presetUsers()[n] || []).map((w) => `${w}（${n}）`));
  async function doArchive(names) {
    const users = usersOf(names);
    const size = st.rows.filter((r) => names.includes(r.name)).reduce((n, r) => n + r.size, 0);
    const ok = await sheet({
      place: "center",
      title: `归档 ${names.length} 个预设`,
      body: `<p class="pa-p">共 ${fmtSize(size)}。归档后这些预设不再出现在酒馆的预设列表中，打开酒馆时也不再下载；在「清理 → 已归档」中可随时恢复。</p>
        ${users.length ? `<p class="pa-p pa-dim">${esc(users.slice(0, 4).join("、"))}${users.length > 4 ? ` 等 ${users.length} 处` : ""}使用了这些预设。${users.some((w) => w.startsWith("方案")) ? "套用相应方案时会自动从归档恢复。" : ""}${users.some((w) => w.startsWith("连接配置")) ? "酒馆的连接配置不会自动恢复，使用前需先在这里恢复。" : ""}</p>` : ""}
        <label class="pa-cbox"><input type="checkbox" data-zip checked> 同时下载一份到本地（zip）</label>`,
      actions: [{ label: "取消", value: null }, { label: "归档", kind: "primary", value: (w) => ({ zip: w.querySelector("[data-zip]").checked }) }]
    });
    if (!ok) return;
    if (ok.zip) downloadBlob(zipOf(names), `preset-archive-${stamp()}.zip`);
    const done = [], fail = [];
    for (const [i, n] of names.entries()) {
      busy(true, `正在归档 ${i + 1}/${names.length}：${n}`);
      let path = null;
      try {
        // 没存完的修改先存上；正在发出的保存也等它结束，读到的才是最终版本
        await saveDraft(n, "归档前保存");
        const text = presetText(n);
        const gz = await gzipText(text);
        // 文件名带上预设名：万一设置文件里的归档清单丢了，也认得出是哪个预设
        const safe = String(n).replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 40);
        const fname = `pa-preset-${safe}-${hashStr(n + text).slice(0, 8)}-${Date.now().toString(36)}.json${gz ? ".gz" : ""}`;
        path = await userFilePut(fname, gz || new Blob([text], { type: "application/json" }));
        // 读回来逐字核对，核对不上（包括读不到）就不删原预设
        let back = null;
        try { back = await userFileGetText(path, !!gz); } catch (e) { throw new Error(`上传后无法读回核对（${e.message}）`); }
        if (back !== text) throw new Error("上传后读回的内容和原预设不一致");
        await quiesceDraft(n);
        if (presetText(n) !== text) throw new Error("归档过程中预设又被修改了，请重新归档");
        await deletePresetFile(n);
        const list = archiveList();
        const old = list.filter((x) => x.name === n);
        list.push({ id: Date.now().toString(36) + i, name: n, path, gz: !!gz, size: new Blob([text]).size, at: Date.now() });
        for (const o of old) {
          list.splice(list.indexOf(o), 1);
          userFileDel(o.path).catch(() => {});
        }
        saveSettings();
        dropDraft(n);
        st.sel.delete(n);
        done.push(n);
      } catch (e) {
        console.warn("[焦香鸡翅] 归档失败", n, e);
        // 已上传但没删掉预设：把上传的文件删掉，保持原样
        if (path && listPresets().includes(n)) userFileDel(path).catch(() => {});
        fail.push(`${n}：${e.message}`);
      }
    }
    busy(false);
    if (done.length) toast(`已归档 ${done.length} 个预设`, "success");
    if (fail.length) toast(`${fail.length} 个归档失败（预设保持原样）：${fail.slice(0, 2).join("；")}`, "error");
    emitChange(currentPresetName());
    render();
  }
  async function doDelete(names) {
    const users = usersOf(names);
    // 2.6.1 备份不强制：弹窗提醒，可先下载备份，也可直接删
    const go = await confirmDeleteOfferBackup(`删除 ${names.length} 个预设`, `<p class="pa-p">将从服务器上删除这些预设，<b>删除后无法在酒馆中恢复</b>，需要的话先下载备份。如果以后可能还会用到，建议改用「归档」。</p>
        ${users.length ? `<p class="pa-p pa-warn">${esc(users.slice(0, 4).join("、"))}${users.length > 4 ? ` 等 ${users.length} 处` : ""}正在使用这些预设，删除后它们将无法套用。</p>` : ""}`, async () => {
      const fname = `preset-backup-${stamp()}.zip`;
      downloadBlob(zipOf(names), fname);
      return `已让浏览器下载「${esc(fname)}」，可在下载记录里确认。`;
    });
    if (!go) return;
    let n = 0;
    const fail = [];
    for (const [i, name] of names.entries()) {
      busy(true, `正在删除 ${i + 1}/${names.length}：${name}`);
      try {
        // 等这个预设正在进行的保存结束，删掉之后不会再被写回来
        await quiesceDraft(name);
        await deletePresetFile(name);
        st.sel.delete(name);
        n++;
      } catch (e) {
        fail.push(`${name}：${e.message}`);
      }
    }
    busy(false);
    if (n) toast(`已删除 ${n} 个预设`, "success");
    if (fail.length) toast(`${fail.length} 个删除失败：${fail.slice(0, 2).join("；")}`, "error");
    emitChange(currentPresetName());
    render();
  }
  // 折叠组的展开状态在重画后保留
  sec.addEventListener("toggle", (e) => {
    const g = e.target.closest?.("[data-pair]");
    if (g) g.open ? st.pairOpen.add(g.dataset.pair) : st.pairOpen.delete(g.dataset.pair);
  }, true);
  sec.addEventListener("change", (e) => {
    const t = e.target;
    if (t.matches("[data-c=pick]")) {
      if (t.checked) st.sel.add(t.dataset.n);
      else st.sel.delete(t.dataset.n);
      t.closest(".pa-crow")?.classList.toggle("on", t.checked);
      draw();
    }
  });
  sec.addEventListener("click", async (e) => {
    if (e.target.closest("[data-c=sort]")) {
      const v = await pickName({ title: "排序", current: st.sort, search: false, items: [{ value: "size", label: "按大小" }, { value: "used", label: "按最近使用" }, { value: "name", label: "按名称" }] });
      if (v && v !== st.sort) {
        st.sort = v;
        draw();
      }
      return;
    }
    const f = e.target.closest("[data-f]");
    if (f) {
      st.filter = f.dataset.f;
      return draw();
    }
    const b = e.target.closest("button[data-c]");
    if (!b || st.busy) return;
    const c = b.dataset.c;
    if (c === "pairmore") { st.pairMore = true; return draw(); }
    const names = st.rows.filter((r) => st.sel.has(r.name)).map((r) => r.name);
    if (c === "all") {
      const vis = view().filter((r) => !r.current);
      const allOn = vis.every((r) => st.sel.has(r.name));
      for (const r of vis) allOn ? st.sel.delete(r.name) : st.sel.add(r.name);
      return draw();
    }
    if (c === "none") {
      st.sel.clear();
      return draw();
    }
    if (c === "dl") return downloadBlob(zipOf(names), `presets-${stamp()}.zip`);
    if (c === "arch") return doArchive(names);
    if (c === "del") return doDelete(names);
    const a = archiveList()[Number(b.dataset.i)];
    if (!a) return;
    b.disabled = true;
    try {
      if (c === "restore") {
        if (await restoreArchived(a)) toast(`已恢复「${a.name}」`, "success");
        emitChange(currentPresetName());
        await render();
      } else if (c === "adl") {
        const text = await userFileGetText(a.path, a.gz);
        downloadBlob(new Blob([JSON.stringify(JSON.parse(text), null, 4)], { type: "application/json" }), `${a.name}.json`);
      } else if (c === "adel") {
        if (!await confirmBox("删除归档", `将从服务器上删除「${a.name}」的归档文件，删除后无法恢复。`, "删除", true)) return;
        await userFileDel(a.path);
        const list = archiveList();
        list.splice(list.indexOf(a), 1);
        saveSettings();
        draw();
      }
    } catch (err) {
      toast(err.message, "error");
    } finally {
      b.disabled = false;
    }
  });
  return { render };
}
