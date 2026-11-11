// 维护模块 · 兼容识别：哪些扩展已经提供了启动加速，本扩展哪些地方要避让。
// 状态拆开记：安装存在、用户开启、后端可用、本次打开的请求由谁接管、这个版本有没有验证过。
// - 快速状态只看页面里已有的标记（扩展自己挂在 window 上的对象、本次的请求记录），不发请求，扩展设置框打开时用。
// - 完整检查（读取扩展列表、探测后端）只在用户点「检查兼容性」时做。
// - 不改其他扩展的设置，不卸载其他扩展。
// 识别依据（只读源码核对过，没有在真实酒馆里组合测试）：柏宝箱 1.0.0、柏宝库 0.6.4、鸡尾酒 0.1.17、鸡尾酒+ 0.1.24。
var PROVIDERS = [
  {
    id: "baibaiTools", name: "柏宝箱", repo: "baibai-git/ST-BaiBai-Tools", reviewed: ["1.0.0"],
    match: (x) => x.manifest?.display_name === "柏宝箱" || /baibai[-_]?tools/i.test(x.base),
    running: () => !!globalThis.__baiBaiToolkitExtensionInstalled
  },
  {
    id: "baibaoku", name: "柏宝库（后端）", repo: "baibai-git/baibaoku", reviewed: ["0.6.4"], backendOnly: true,
    probe: async () => {
      const r = await fetchWithTimeout(stUrl("api/plugins/baibaoku/v1/status"), { headers: ctx().getRequestHeaders?.() || {} });
      if (!r.ok) return { ok: false, status: r.status };
      const j = await r.json().catch(() => null);
      return { ok: !!j?.data?.installed, version: j?.data?.version || null };
    }
  },
  {
    id: "cocktail", name: "鸡尾酒", repo: "Lianues/cocktail", reviewed: ["0.1.17"],
    match: (x) => x.manifest?.display_name === "鸡尾酒" || /^cocktail$/i.test(x.base),
    running: () => !!globalThis.__cocktailPanelLoaded || !!globalThis.__stStartupOptimizer
  },
  {
    id: "cocktailPlus", name: "鸡尾酒+", repo: "Lianues/cocktail-plus", reviewed: ["0.1.24"],
    match: (x) => x.manifest?.display_name === "鸡尾酒+" || /^cocktail-plus$/i.test(x.base),
    running: () => !!globalThis.__cocktailPlusLoaded,
    probe: async () => {
      const r = await fetchWithTimeout(stUrl("api/plugins/cocktail-plus/probe"), { method: "POST", headers: { "Content-Type": "application/json", ...ctx().getRequestHeaders?.() || {} }, body: "{}" });
      if (!r.ok) return { ok: false, status: r.status };
      const j = await r.json().catch(() => null);
      return { ok: !!j?.ok, version: j?.version || null, earlyBridge: j?.earlyBridge ?? null };
    }
  },
  {
    id: "tavernHelper", name: "酒馆助手", repo: "N0VI028/JS-Slash-Runner", reviewed: [],
    match: (x) => /JS-Slash-Runner|tavern[-_ ]?helper/i.test(x.base) || /酒馆助手|Tavern Helper/i.test(x.manifest?.display_name || ""),
    running: () => !!globalThis.TavernHelper
  }
];
// 加速涉及的方面，以及本扩展在每一方面的规则（需求 6.3）。本扩展目前在这些方面都没有自己的加速。
var ACCEL_AREAS = [
  { id: "settingsRead", label: "设置／预设读取", rule: "同一请求只允许一个读取加速接管", single: true },
  { id: "charList", label: "角色列表", rule: "同一请求只允许一个接管", single: true },
  { id: "extPreload", label: "扩展清单与预加载", rule: "已有实现时避让，防止重复预取", single: true },
  { id: "writes", label: "设置、聊天写入", rule: "本扩展不接管，沿用现有流程" },
  { id: "generate", label: "聊天生成、后台任务", rule: "本扩展不接管" },
  { id: "render", label: "正则和聊天渲染", rule: "本扩展不重新实现" }
];
// 各提供者在各方面的能力（依据源码），以及能从页面上读到的开关状态：true 开、false 关、null 读不到
function providerAreas() {
  const bb = globalThis.__baibaokuEarlyBridge;
  const bbOn = bb?.installed ? (k) => typeof bb[k] === "boolean" ? bb[k] : null : () => null;
  const so = globalThis.__stStartupOptimizer?.settings;
  return {
    baibaoku: { settingsRead: bbOn("settingsAccelerationEnabled"), charList: bbOn("characterListAccelerationEnabled"), extPreload: bbOn("extensionManifestBundleEnabled"), writes: null, generate: null },
    cocktail: { charList: so ? !!(so.enabled && so.prefetchEnabled) : null, render: null, writes: null },
    cocktailPlus: { settingsRead: null, charList: null, extPreload: null, writes: null }
  };
}
async function fetchWithTimeout(url, init = {}, ms = 3000) {
  const ac = typeof AbortController === "function" ? new AbortController() : null;
  const t = ac ? setTimeout(() => ac.abort(), ms) : null;
  try {
    return await fetch(url, { cache: "no-store", ...init, signal: ac?.signal });
  } finally {
    if (t) clearTimeout(t);
  }
}
async function discoverExtensions() {
  const r = await fetch(stUrl("api/extensions/discover"), { headers: ctx().getRequestHeaders?.() || {} });
  if (!r.ok) throw new Error(`读取扩展列表失败（${r.status}）`);
  const list = await r.json();
  const disabled = new Set(ctx().extensionSettings?.disabledExtensions || []);
  const out = list.map((x) => ({ name: x.name, type: x.type, base: String(x.name).split("/").pop(), enabled: !disabled.has(x.name), manifest: null }));
  await Promise.all(out.map(async (x) => {
    try {
      const m = await fetch(stUrl(`scripts/extensions/${x.name}/manifest.json`));
      if (m.ok) x.manifest = await m.json();
    } catch {
    }
  }));
  return out;
}
// Service Worker：页面现在由谁的 Service Worker 控制（只读，不注册、不注销）
function swController() {
  const c = globalThis.navigator?.serviceWorker?.controller;
  if (!c) return null;
  const url = String(c.scriptURL || "");
  return { url: redactUrl(url), owner: /\/api\/plugins\/cocktail-plus\//.test(url) ? "鸡尾酒+" : null };
}
// 本次打开里，设置读取、角色列表实际走了谁的接口
function takeoverThisLoad() {
  let m;
  try { m = measureLoad(); } catch { return {}; }
  const pick = (cat) => {
    const list = m.reqs.filter((r) => r.cat === cat);
    if (!list.length) return { seen: false };
    const providers = [...new Set(list.map((r) => r.provider).filter(Boolean))];
    return { seen: true, providers, viaSw: list.some((r) => r.sw), plain: list.some((r) => !r.provider && !r.sw) };
  };
  return { settingsRead: pick("settings"), charList: pick("chars"), extPreload: pick("extList") };
}
// 快速状态：不发请求
function compatQuick() {
  return {
    running: Object.fromEntries(PROVIDERS.filter((p) => p.running).map((p) => [p.id, p.running()])),
    bridges: { baibaoku: !!globalThis.__baibaokuEarlyBridge?.installed, cocktailPlus: !!globalThis.__cocktailPlusEarlyBridge },
    sw: swController(),
    secure: !!globalThis.isSecureContext,
    takeover: takeoverThisLoad(),
    areas: providerAreas()
  };
}
var lastCompat = null;
// 完整检查：读取扩展列表（含各扩展的 manifest）、探测后端。只在用户点按钮时运行
async function compatFull() {
  const quick = compatQuick();
  let exts = null, extErr = "";
  try { exts = await discoverExtensions(); } catch (e) { extErr = e.message; }
  const rows = [];
  for (const p of PROVIDERS) {
    const row = { id: p.id, name: p.name, repo: p.repo };
    if (p.match) {
      const hit = exts ? exts.find((x) => p.match(x)) : null;
      row.installed = exts ? !!hit : null;
      row.enabled = hit ? hit.enabled : exts ? void 0 : null;
      row.version = hit?.manifest?.version || null;
    }
    row.running = p.running ? p.running() : null;
    if (p.probe) {
      try {
        const r = await p.probe();
        row.backend = r.ok ? "ok" : "no";
        if (r.version) row.backendVersion = r.version;
        if (p.backendOnly) row.installed = r.ok;
      } catch {
        row.backend = "no";
        if (p.backendOnly) row.installed = false;
      }
    }
    const v = row.backendVersion || row.version;
    // 兼容等级：已验证＝在真实酒馆里组合测试过（目前没有）；已识别但未验证＝核对过这个版本的源码；未知＝其他版本
    row.level = !v || !p.reviewed.length ? "未知" : p.reviewed.includes(v) ? "已识别但未验证" : "未知";
    rows.push(row);
  }
  lastCompat = { at: Date.now(), quick, rows, extErr };
  return lastCompat;
}
function lastCompatSummary() {
  if (!lastCompat) return { checked: false, quick: compatQuick() };
  return { checked: true, at: new Date(lastCompat.at).toISOString(), rows: lastCompat.rows, quick: lastCompat.quick, extListError: lastCompat.extErr || null };
}
// 每个方面：谁在负责、是否可能重叠、本扩展怎么做
function areaStatus(c = lastCompat || { quick: compatQuick(), rows: [] }) {
  const q = c.quick;
  const row = (id) => c.rows.find((r) => r.id === id);
  const on = (id) => row(id) ? !!(row(id).running || row(id).backend === "ok" || row(id).enabled) : !!q.running[id];
  return ACCEL_AREAS.map((a) => {
    const who = [];
    const bbFlag = q.areas.baibaoku[a.id];
    if (a.id in q.areas.baibaoku && (q.bridges.baibaoku || row("baibaoku")?.backend === "ok")) who.push({ name: "柏宝库", state: bbFlag === true ? "开启" : bbFlag === false ? "关闭" : "状态未知" });
    if (a.id in q.areas.cocktail && on("cocktail")) {
      const f = q.areas.cocktail[a.id];
      who.push({ name: "鸡尾酒", state: f === true ? "开启" : f === false ? "关闭" : "状态未知" });
    }
    if (a.id in q.areas.cocktailPlus && (q.bridges.cocktailPlus || row("cocktailPlus")?.backend === "ok" || on("cocktailPlus"))) who.push({ name: "鸡尾酒+", state: "状态未知" });
    const t = q.takeover[a.id];
    const seen = t?.seen ? [...(t.providers || []), ...(t.viaSw ? [q.sw?.owner ? `Service Worker（${q.sw.owner}）` : "Service Worker（提供者未知）"] : [])] : [];
    // 只对「同一请求只允许一个接管」的方面判断重叠：两个以上明确开启＝重叠；有两个以上提供者但开关读不到＝可能重叠。
    // 写入、生成、渲染各家做的不是同一件事，不据此判断重叠
    if (!a.single) return { ...a, who, seen, overlap: "no" };
    const activeCount = who.filter((w) => w.state === "开启").length;
    return { ...a, who, seen, overlap: activeCount > 1 ? "yes" : who.filter((w) => w.state !== "关闭").length > 1 ? "maybe" : "no" };
  });
}
