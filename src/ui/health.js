// 1.3.4：加载体检——看看酒馆打开慢，慢在哪。1.9.0 起测量部分在 maintenance/diagnostics.js，这里只管显示。
// 页面上的每个数字都写明口径；测不到的写「未测得」，不拿别的数字顶替。

async function collectHealth() {
  const c2 = ctx();
  const m = measureLoad();
  const out = { ...m, warn: [], tips: [] };
  // ---- 每次打开要读取的数据（内存里的统计量）
  out.presets = allPresetSizes();
  out.presetTotal = out.presets.reduce((n, x) => n + x.size, 0);
  out.presetByApi = PRESET_APIS.map(([api, label]) => {
    const l = out.presets.filter((x) => x.api === api);
    return { api, label, n: l.length, size: l.reduce((n, x) => n + x.size, 0) };
  }).filter((x) => x.n);
  const es = c2.extensionSettings || {};
  out.extData = Object.keys(es).map((k) => ({ key: k, size: jsonSize(es[k]) })).sort((a, b) => b.size - a.size);
  out.extDataTotal = out.extData.reduce((n, x) => n + x.size, 0);
  const chars = c2.characters || [];
  out.charCount = chars.length;
  out.lazyChars = chars.length > 0 && chars.some((ch) => ch?.shallow);
  out.chatLen = (c2.chat || []).length;
  out.chatSize = jsonSize(c2.chat || []);
  const pu = c2.powerUserSettings || {};
  out.autoLoadChat = pu.auto_load_chat;
  out.chatTruncation = pu.chat_truncation;
  out.worldCount = (mods.wi?.world_names || []).length;
  try {
    const r = await fetch(stUrl("api/extensions/discover"), { headers: c2.getRequestHeaders?.() || {} });
    if (r.ok) {
      const list = await r.json();
      const disabled = new Set(es.disabledExtensions || []);
      out.extTotal = list.filter((x) => x.type !== "system").length;
      out.extEnabled = list.filter((x) => x.type !== "system" && !disabled.has(x.name)).length;
    }
  } catch {
  }
  // ---- 请求
  out.groups = summarizeRequests(m.reqs);
  out.byCat = Object.fromEntries(out.groups.map((g) => [g.cat, g]));
  out.slow = m.reqs.filter((r) => r.dur > 300).sort((a, b) => b.dur - a.dur).slice(0, 8);
  out.gaps = diagGaps(m);
  const TL = ["settings", "chars", "charGet", "chats", "extList", "extFiles", "media", "settingsSave"];
  out.timeline = [
    ...(out.domReady ? [{ label: "页面 DOM", start: 0, end: out.domReady }] : []),
    ...TL.map((k) => out.byCat[k]).filter(Boolean).map((g) => ({ label: g.label, start: g.start, end: g.end, n: g.n }))
  ];
  // ---- 建议（只说测得到的事实；拿不准的写「可能」，不指认是哪个扩展）
  const MB = 1024 * 1024;
  const st = out.byCat.settings;
  const prov = (g) => Object.keys(g?.providers || {});
  if (out.settingsCount > 1) out.warn.push({ h: `设置读取了 ${out.settingsCount} 次`, t: `本次记录到 ${out.settingsCount} 笔「设置及预设」读取请求${out.settingsBytes ? `，实际传输共 ${fmtSize(out.settingsBytes)}` : ""}。`, d: `正常打开只读取一次。可能是两个启动加速功能同时接管了设置读取，也可能是有扩展在启动后又读了一次；这里无法确定是哪个扩展发起的。${prov(st).length ? `本次走过的第三方接口：${prov(st).join("、")}。` : ""}可在扩展页「${appName()}」设置框里点「检查兼容性」查看已识别的加速提供者，逐个停用对比。` });
  const byApi = out.presetByApi.length > 1 ? `（${out.presetByApi.map((x) => `${x.label} ${x.n} 个 ${fmtSize(x.size)}`).join("，")}）` : `（${out.presets.length} 个）`;
  const others = out.presetByApi.filter((x) => x.api !== "openai");
  const wireNote = out.settingsOnce ? `本次「设置及预设」请求实际传输 ${fmtSize(out.settingsOnce)}${out.settingsDecoded ? `，解压后 ${fmtSize(out.settingsDecoded)}` : ""}。` : "";
  if (out.presetTotal > 5 * MB) out.warn.push({ h: `预设共 ${fmtSize(out.presetTotal)}，拖慢打开`, t: `全部预设在内存中约 ${fmtSize(out.presetTotal)}${byApi}，酒馆打开时会随设置一起读取。${wireNote}`, d: `内存中的大小是序列化后的统计量，不等于网络传输量。不常用的聊天补全预设可在「清理」中归档：移到服务器上的另一个位置，打开时不再读取，需要时可恢复。${others.length ? `${others.map((x) => x.label).join("、")}预设「清理」页不处理，可在酒馆对应的预设菜单中删除。` : ""}`, act: "clean" });
  else if (out.presetTotal > 2 * MB) out.tips.push({ h: `预设共 ${fmtSize(out.presetTotal)}，可以清理一些`, t: `全部预设在内存中约 ${fmtSize(out.presetTotal)}（${out.presets.length} 个），打开时随设置一起读取。${wireNote}`, d: "不常用的预设可在「清理」中归档。", act: "clean" });
  if (out.saveDuringLoad) out.tips.push({ h: "启动时有设置保存请求", t: "启动完成前记录到设置保存请求。", d: "保存会上传整个设置文件，可能和启动时的下载争用网络。这里无法判断是哪个扩展触发的；如果每次打开都出现，可逐个停用扩展对比。" });
  const bigExt = out.extData.filter((x) => x.size > 512 * 1024);
  if (bigExt.length) out.warn.push({ h: `${bigExt.length} 个扩展存的数据较多`, t: `以下扩展在设置文件中存有较多数据：${bigExt.slice(0, 3).map((x) => `「${x.key}」${fmtSize(x.size)}`).join("、")}。`, d: "设置文件每次打开都要读取，每次修改设置都要完整上传。可查看这些扩展是否提供清理或导出旧数据的功能，不用的扩展可停用。" });
  if (out.charCount > 150 && !out.lazyChars) out.tips.push({ h: `角色卡 ${out.charCount} 张，打开时全部读取`, t: `角色卡共 ${out.charCount} 张，打开时全部读取。`, d: "如能修改服务器上的 config.yaml，可将 performance 下的 lazyLoadCharacters 设为 true（按需加载角色卡），然后重启酒馆。" });
  if (out.autoLoadChat && out.chatLen > 300) out.tips.push({ h: `自动进入的聊天有 ${out.chatLen} 楼`, t: `打开时自动进入上次的聊天，该聊天共 ${out.chatLen} 楼（内存中约 ${fmtSize(out.chatSize)}）。`, d: "可在「用户设置」中关闭「自动加载上次聊天」；长聊天可新开存档，或总结后隐藏旧楼层。" });
  if (out.chatTruncation && out.chatTruncation > 100) out.tips.push({ h: `一次加载 ${out.chatTruncation} 条消息`, t: `「一次加载的消息数」为 ${out.chatTruncation}。`, d: "可在「用户设置」中调小（如 30～50），进入聊天时渲染的楼层更少，向上翻阅时可继续加载。" });
  if (out.extEnabled != null && out.extEnabled > 15) out.tips.push({ h: `开了 ${out.extEnabled} 个扩展`, t: `已开启 ${out.extEnabled} 个第三方扩展。`, d: "每个扩展在打开时都要加载脚本和设置。不常用的扩展可在扩展管理中停用，无需卸载。" });
  const extMax = new Map();
  for (const r of out.reqs) if (r.cat === "extFiles" && r.ext) extMax.set(r.ext, Math.max(extMax.get(r.ext) || 0, r.dur));
  const slowExt = [...extMax].filter(([, d]) => d > 1500).sort((a, b) => b[1] - a[1]);
  if (slowExt.length) out.tips.push({ h: `${slowExt.length} 个扩展的文件加载较久`, t: `文件加载较久的扩展：${slowExt.slice(0, 4).map(([x, d]) => `「${x}」（单个文件最长 ${fmtMs(d)}）`).join("、")}。`, d: "耗时包含排在其他请求后面等待的时间，不一定是扩展本身慢。可先停用，比较打开速度是否改善。" });
  const extHost = new Map();
  for (const r of out.reqs) if (r.cat === "external") extHost.set(r.host, Math.max(extHost.get(r.host) || 0, r.dur));
  const slowHost = [...extHost].filter(([, d]) => d > 1500);
  if (slowHost.length) out.tips.push({ h: "有扩展从外部网站加载资源", t: `有扩展从外部网站加载资源：${slowHost.slice(0, 3).map(([h, d]) => `${h}（最长 ${fmtMs(d)}）`).join("、")}。`, d: "这些网站在国内可能访问缓慢或无法访问，会拖慢打开过程。" });
  return out;
}

function sizeCell(g) {
  if (!g.n) return "—";
  const known = g.n - g.unknownSize;
  if (!known) return "未取得";
  return `${fmtSize(g.transfer)}${g.decoded && g.decoded !== g.transfer ? `<small>解压后 ${fmtSize(g.decoded)}</small>` : ""}${g.unknownSize ? `<small>另 ${g.unknownSize} 笔未取得</small>` : ""}`;
}
function noteCell(g) {
  const n = [];
  if (g.cacheHits) n.push(`缓存命中 ${g.cacheHits}`);
  if (g.revalidated) n.push(`缓存校验 ${g.revalidated}`);
  if (g.viaSw) n.push(`经 Service Worker ${g.viaSw}`);
  for (const [p, k] of Object.entries(g.providers || {})) n.push(`走${p}接口 ${k}`);
  return n.join("；");
}

function mountHealth(sec, { goClean } = {}) {
  sec.innerHTML = `<div class="pa-scroll pa-health"><div class="pa-health-body"><p class="pa-hint">正在检查…</p></div>
    <div class="pa-card-act pa-mini-act"><button class="pa-btn pa-btn-s" data-h="run">↻ 重新检查</button><button class="pa-btn pa-btn-s" data-h="detail">每笔明细</button><button class="pa-btn pa-btn-s" data-h="export">导出报告</button></div>
    <div class="pa-health-detail" hidden></div></div>`;
  const box = sec.querySelector(".pa-health-body");
  const detail = sec.querySelector(".pa-health-detail");
  let last = null;
  async function run() {
    box.innerHTML = '<p class="pa-hint">正在检查…</p>';
    detail.hidden = true;
    // 2.4.0：先让切页和「正在检查…」显示出来，下一帧再统计，点了不会卡住
    await nextPaint();
    let r;
    try {
      r = await collectHealth();
    } catch (e) {
      box.innerHTML = `<p class="pa-warn">检查出错：${esc(e.message)}</p>`;
      return;
    }
    last = r;
    const bar = (v, max) => `<i class="pa-bar"><b style="width:${Math.max(2, Math.round(v / (max || 1) * 100))}%"></b></i>`;
    const maxP = r.presets[0]?.size || 1;
    const maxE = r.extData[0]?.size || 1;
    const total = Math.max(r.readyAt || 0, ...r.timeline.map((t) => t.end)) || 1;
    const pct = (v) => `${Math.max(0, Math.min(100, v / total * 100)).toFixed(2)}%`;
    // 建议：只显示一句短结论；带数字的完整说明和原因都收进折叠的「详情」
    const card = (w, warn) => `<div class="pa-card pa-tipcard ${warn ? "pa-card-warn" : ""}"><div class="pa-tiprow pa-tiphead"><p class="pa-tiptitle">${warn ? `<b>${esc(w.h || w.t)}</b>` : esc(w.h || w.t)}</p>${w.act === "clean" && goClean ? '<button type="button" class="pa-golink" data-h="clean">去清理 ›</button>' : ""}${tip(`${w.h ? `<p>${esc(w.t)}</p>` : ""}<p>${esc(w.d)}</p>`, "详情")}</div></div>`;
    const bgEnd = r.background.length ? Math.max(...r.background.map((x) => x.end)) : null;
    const readyText = r.readyAt ? fmtMs(r.readyAt) : r.readySource === "late" ? "未记录（本扩展加载时酒馆已启动完成）" : "未记录";
    const n = r.warn.length + r.tips.length;
    box.innerHTML = `
      <div class="pa-sum ${r.warn.length ? "pa-bad" : "pa-good"}">
        <p class="pa-sum-main">启动 <b>${r.readyAt ? fmtMs(r.readyAt) : "未记录"}</b> · 预设 <b>${fmtSize(r.presetTotal)}</b> · 扩展数据 ${fmtSize(r.extDataTotal)} · 角色卡 ${r.charCount}${r.rate ? ` · 约 ${fmtSize(r.rate)}/秒` : ""}</p>
        ${tip(`<dl class="pa-kv">
          <dt>页面 DOM 就绪</dt><dd>${r.domReady ? fmtMs(r.domReady) : "未取得"}</dd>
          <dt>酒馆启动完成（APP_READY）</dt><dd>${esc(readyText)}</dd>
          <dt>聊天可操作</dt><dd>未测得<small>目前无法可靠判断聊天什么时候能正常操作，不用启动完成的时间代替</small></dd>
          ${r.readyAt ? `<dt>启动完成后仍在进行</dt><dd>${r.background.length ? `${r.background.length} 笔请求，最后结束于 ${fmtMs(bgEnd)}` : "没有"}</dd>` : ""}
        </dl>
        <p>每次打开要读取：全部预设（内存中约 ${fmtSize(r.presetTotal)}${r.presetByApi.length > 1 ? `：${r.presetByApi.map((x) => `${x.label} ${fmtSize(x.size)}`).join("，")}` : ""}），扩展数据 ${fmtSize(r.extDataTotal)}，角色卡 ${r.charCount} 张${r.lazyChars ? "（按需加载）" : ""}。内存中的大小是序列化后的统计量，不是网络传输量。</p>
        ${r.rate ? `<p>本次接收速率估计约 ${fmtSize(r.rate)}/秒（按${r.rateSource === "settings" ? "设置请求的接收阶段" : "所有同源请求的接收阶段"}估算，受同时进行的请求和网络波动影响，不是服务器带宽上限）。</p>` : ""}`, "这些数字怎么来的")}
      </div>
      ${jankHtml(r.extData)}
      ${n ? `<h3 class="pa-h">建议 <span class="pa-dim">${n}</span></h3>` : '<p class="pa-hint">没有发现明显拖慢打开的地方。</p>'}
      ${r.warn.map((w) => card(w, true)).join("")}
      ${r.tips.map((w) => card(w, false)).join("")}
      <details class="pa-more"><summary>详细数据</summary>
      ${r.timeline.length > 1 ? `<h3 class="pa-h">打开过程</h3>
      <div class="pa-tl">${r.timeline.map((t) => `<div><span>${esc(t.label)}${t.n > 1 ? `<i>×${t.n}</i>` : ""}</span><i class="pa-tl-track"><b style="left:${pct(t.start)};width:${pct(Math.max(t.end - t.start, total * 0.006))}"></b></i><em>${fmtMs(t.end)}</em></div>`).join("")}
        ${r.readyAt ? `<div class="pa-tl-ready"><span>启动完成</span><i class="pa-tl-track"><b style="left:${pct(r.readyAt)}"></b></i><em>${fmtMs(r.readyAt)}</em></div>` : ""}</div>
      ${tip("每一行是该类请求从第一笔开始到最后一笔结束的范围，中间可能有空档；右侧是结束于打开后第几秒。")}` : ""}
      <h3 class="pa-h">打开时的请求</h3>
      <div class="pa-rtable" role="table">
        <div class="pa-rt-head" role="row"><span>类别</span><span>笔数</span><span>结束于</span><span>忙碌时长</span><span>实际传输</span></div>
        ${r.groups.map((g) => `<div class="pa-rt-row" role="row"><span>${esc(g.label)}${noteCell(g) ? `<small>${esc(noteCell(g))}</small>` : ""}</span><span>${g.n}</span><span>${fmtMs(g.end)}</span><span>${fmtMs(g.busy)}</span><span>${sizeCell(g)}</span></div>`).join("")}
      </div>
      ${tip(`<span class="pa-narrow-only">窄屏上省略了笔数和忙碌时长，可在宽屏或导出的报告里查看。</span>「结束于」是这一类最后一笔请求在打开后第几秒结束，不是它的耗时。「忙碌时长」是这一类请求时间段的并集，同时进行的不重复计算；各类之间也有重叠，不能相加。「实际传输」是经过网络的字节，缓存命中时为 0。`)}
      <h3 class="pa-h">单笔耗时最长的请求</h3>
      ${r.slow.length ? `<div class="pa-rank">${r.slow.map((s) => `<div title="${esc(redactUrl(s.url))}"><span>${esc(CAT_LABEL[s.cat] || s.cat)}${s.provider ? `<i class="pa-dim">·${esc(s.provider)}</i>` : ""}</span>${bar(s.dur, r.slow[0].dur)}<em>${fmtMs(s.dur)}${s.transfer ? ` · ${fmtSize(s.transfer)}` : s.transfer == null ? " · 体积未取得" : ""}</em></div>`).join("")}</div>
      ${tip("单笔耗时从发出请求算到接收完毕，包含排在其他请求后面等待、等待首字节和接收数据，不全是服务器处理时间。点下方「每笔明细」可以看分段。")}` : '<p class="pa-hint">没有超过 0.3 秒的请求，或未记录到。</p>'}
      <h3 class="pa-h">最大的预设（内存中）</h3>
      <div class="pa-rank">${r.presets.slice(0, 8).map((p) => `<div><span>${p.api !== "openai" ? `<i class="pa-dim">${esc(PRESET_APIS.find(([a]) => a === p.api)?.[1] || "")}·</i>` : ""}${esc(p.name)}</span>${bar(p.size, maxP)}<em>${fmtSize(p.size)}</em></div>`).join("") || '<p class="pa-hint">未读取到</p>'}</div>
      <h3 class="pa-h">扩展在设置文件中的数据</h3>
      <div class="pa-rank">${r.extData.filter((p) => p.size >= 1024).slice(0, 8).map((p) => `<div><span>${esc(p.key)}</span>${bar(p.size, maxE)}<em>${fmtSize(p.size)}</em></div>`).join("") || '<p class="pa-hint">均小于 1 KB。</p>'}</div>
      <h3 class="pa-h">这次测量覆盖不到的</h3>
      <ul class="pa-gaps">${r.gaps.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
      <p class="pa-hint">${r.extEnabled != null ? `第三方扩展：已开启 ${r.extEnabled} 个，共安装 ${r.extTotal} 个。` : ""}世界书 ${r.worldCount} 本。检查和导出报告都只在本浏览器中进行，不上传任何数据。如仅在长时间未使用后首次打开较慢，可能是云服务器休眠后重新启动；这次测量无法区分。</p>
      </details>`;
  }
  function showDetail() {
    if (!last) return;
    if (!detail.hidden) { detail.hidden = true; return; }
    const rows = last.reqs.slice().sort((a, b) => a.start - b.start).slice(0, 400);
    const cacheText = { hit: "缓存", revalidated: "校验", unknown: "未取得", network: "" };
    detail.innerHTML = `<h3 class="pa-h">每笔请求（按开始时间，最多 400 笔）</h3>
      <div class="pa-hscroll"><div class="pa-rtable pa-rt-detail" role="table">
        <div class="pa-rt-head" role="row"><span>地址（已隐去名称）</span><span>开始</span><span>耗时</span><span>首字节／接收</span><span>传输／解压后</span></div>
        ${rows.map((x) => `<div class="pa-rt-row" role="row"><span>${esc(redactUrl(x.url))}<small>${esc(CAT_LABEL[x.cat] || x.cat)}${x.provider ? ` · ${esc(x.provider)}接口` : ""}${x.sw ? " · Service Worker" : ""}${cacheText[x.cache] ? ` · ${cacheText[x.cache]}` : ""}</small></span><span>${fmtMs(x.start)}</span><span>${fmtMs(x.dur)}</span><span>${x.ttfb == null ? "—" : fmtMs(x.ttfb)} / ${x.recv == null ? "—" : fmtMs(x.recv)}</span><span>${x.transfer == null ? "未取得" : `${fmtSize(x.transfer)} / ${fmtSize(x.decoded)}`}</span></div>`).join("")}
      </div></div>
      <p class="pa-hint">「首字节」是从发出请求到收到第一个字节，包含网络往返，不等于服务器处理时间。</p>`;
    detail.hidden = false;
    scrollToView(detail, "start", true);
  }
  function exportReport() {
    if (!last) return;
    const report = buildDiagReport({ version: VERSION, kind: BUILD_KIND, measure: last, presets: last.presets, extData: last.extData, charCount: last.charCount, lazyChars: last.lazyChars, compat: typeof lastCompatSummary === "function" ? lastCompatSummary() : null });
    const t = new Date();
    const stamp = `${t.getFullYear()}${String(t.getMonth() + 1).padStart(2, "0")}${String(t.getDate()).padStart(2, "0")}-${String(t.getHours()).padStart(2, "0")}${String(t.getMinutes()).padStart(2, "0")}`;
    downloadBlob(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }), `diagnostics-${stamp}.json`);
    toast("已交给浏览器下载诊断报告。报告不含预设正文、聊天内容和密钥，角色、聊天等文件名已隐去");
  }
  sec.querySelector("[data-h=run]").addEventListener("click", run);
  box.addEventListener("click", (e) => {
    if (!e.target.closest("[data-h=jankclear]")) return;
    jankClear();
    run();
  });
  sec.querySelector("[data-h=detail]").addEventListener("click", showDetail);
  sec.querySelector("[data-h=export]").addEventListener("click", exportReport);
  box.addEventListener("click", (e) => {
    if (e.target.closest("[data-h=clean]")) goClean?.();
  });
  // 每次切到这一页都重新检查（清理、归档之后数字会变）
  let lastRun = 0;
  return {
    render() {
      if (Date.now() - lastRun < 3000) return;
      lastRun = Date.now();
      run();
    }
  };
}

// 2.7.8 运行中的卡顿：打开酒馆以来页面卡了几次、卡顿时本扩展是否在处理
function jankHtml(extData) {
  const j = jankSummary();
  const mins = j.minutes < 1 ? "不到 1 分钟" : `${Math.round(j.minutes)} 分钟`;
  const how = j.mode === "loaf" ? "一帧画面超过 50 毫秒才画出记为一次卡顿，并记下这一帧里各来源脚本的耗时" : j.mode === "longtask" ? "单次占住页面超过 50 毫秒记为一次卡顿（本浏览器不提供按来源归类的记录）" : "按计时器晚到的时间估算（本浏览器不提供更准确的记录）";
  const top = j.scripts[0];
  const mine = extData?.find((x) => x.key === KEY);
  let verdict;
  if (j.mode === "none") verdict = "本浏览器不提供卡顿记录。";
  else if (!j.count) verdict = "记录期间没有出现卡顿。卡顿再出现时，回到这一页查看。";
  else if (top) {
    verdict = `卡顿帧里耗时最多的是${esc(top.who)}（共 ${fmtMs(top.ms)}）。`;
    if (j.layout.ms > top.ms) verdict += `浏览器重新计算样式和排版共 ${fmtMs(j.layout.ms)}，页面元素多或特效重时常见。`;
    verdict += j.overlapped ? `${esc(appName())}参与 ${j.overlapped} 次，主要是「${esc(j.blame[0][0])}」。` : `${esc(appName())}没有参与。`;
    if (!top.who.includes("（本扩展）") && top.who.startsWith("扩展")) verdict += "可停用它对比。";
  }
  else if (!j.overlapped) verdict = `卡顿发生时${esc(appName())}都没有在处理，原因在酒馆本身或其他扩展。可看下方「扩展在设置文件中的数据」，存得多的扩展每次保存设置都要整份上传；也可逐个停用扩展对比。`;
  else verdict = `有 ${j.overlapped} 次卡顿发生在${esc(appName())}处理期间，主要是「${esc(j.blame[0][0])}」。导出报告发给作者可帮助定位。`;
  const ms = (v) => v < 10 ? `${v.toFixed(1)} 毫秒` : fmtMs(v);
  const ago = (t) => { const s = Math.max(0, Math.round((performance.now() - t) / 1e3)); return s < 60 ? `${s} 秒前` : `${Math.round(s / 60)} 分钟前`; };
  const rows = (xs) => `<div class="pa-kvl">${xs.join("")}</div>`;
  const row = (k, v) => `<div><span>${k}</span><em>${v}</em></div>`;
  const any = j.count || j.own.length;
  return `<div class="pa-jank-h"><h3 class="pa-h">运行中的卡顿 <small class="pa-dim">打开酒馆后 ${mins}</small></h3>${tip(`${how}。只记时间和处理名称，不记内容，只保存在本页内存中，刷新页面后重新开始。「重叠」指卡顿期间${esc(appName())}有一项处理超过 16 毫秒。`)}${any ? '<button type="button" class="pa-link" data-h="jankclear">清空</button>' : ""}</div>
    <div class="pa-card pa-jank">
      <p class="pa-p"><b>${j.mode === "none" ? "无法记录" : j.count ? `页面卡顿 ${j.count} 次` : "没有卡顿"}</b>${j.count ? `，最长 ${fmtMs(j.longest)}${j.severe ? `，${j.severe} 次超过 0.2 秒` : ""}；与${esc(appName())}处理重叠 ${j.overlapped} 次` : ""}</p>
      <p class="pa-hint">${verdict}${mine ? `本扩展在设置文件中的数据 ${fmtSize(mine.size)}。` : ""}</p>
      ${j.scripts.length || j.layout.n ? `<details${top ? " open" : ""}><summary>卡顿时在运行的脚本</summary>${rows([...j.scripts.slice(0, 8).map((x) => row(esc(x.who), `${x.n} 次 · 共 ${fmtMs(x.ms)}${x.forced >= 5 ? ` · 强制排版 ${fmtMs(x.forced)}` : ""}`)), ...(j.layout.n ? [row("浏览器计算样式和排版", `${j.layout.n} 次 · 共 ${fmtMs(j.layout.ms)}`)] : [])])}</details>` : ""}
      ${j.recent.length ? `<details><summary>最近的卡顿</summary><ul class="pa-notes">${j.recent.map((x) => `<li>${ago(x.at)}，${fmtMs(x.ms)}${x.owners?.length ? `，脚本来源：${esc(x.owners.join("、"))}` : ""}${x.own.length ? `，${esc(appName())}在处理：${esc(x.own.join("、"))}` : ""}</li>`).join("")}</ul></details>` : ""}
      ${j.own.length ? `<details><summary>${esc(appName())}各项处理耗时</summary>${rows(j.own.slice(0, 12).map((x) => row(esc(x.label), `${x.n} 次 · 最长 ${ms(x.max)} · 平均 ${ms(x.avg)}`)))}</details>` : ""}
    </div>`;
}
