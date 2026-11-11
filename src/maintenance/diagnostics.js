// 维护模块 · 加载体检的测量部分（不碰界面，「加载体检」页和诊断报告共用）。
// 口径（1.9.0）：
// - 时间点分开记：页面 DOM 就绪、酒馆启动完成（APP_READY）、聊天可操作（目前测不到，显示「未测得」）、启动完成后仍在进行的后台加载。
// - 每笔请求记开始、结束、总耗时；能拿到时再记等待首字节、接收阶段，以及实际传输、编码后、解码后三种体积。
// - 多笔请求时间重叠，同类请求的耗时按时间段的并集算，不把各笔耗时相加。
// - 拿不到的数据（跨域限制、缓存命中、记录满了）单独标出，不拿别的数字顶替。
// - 只用浏览器已有的请求记录（Performance API），不为体检重新下载任何东西，不读请求正文。
var PA_T = globalThis.__paTiming || (globalThis.__paTiming = { evalAt: performance.now(), readyAt: null });
// 浏览器默认只记 250 条请求，记满后的会丢掉。先看扩展加载前是不是已经记满，再把上限调大
try {
  if (PA_T.bufFullBefore === void 0) PA_T.bufFullBefore = performance.getEntriesByType("resource").length >= 250;
  performance.setResourceTimingBufferSize?.(4000);
  performance.addEventListener?.("resourcetimingbufferfull", () => { PA_T.bufFullLater = true; });
} catch {
}
// 记下酒馆启动完成（APP_READY）的时间。新版酒馆对晚注册的监听会立刻补发一次，那时的时间不是真正的启动完成时间，不记
try {
  const c0 = globalThis.SillyTavern?.getContext?.();
  const et0 = c0?.eventTypes || c0?.event_types;
  if (c0?.eventSource && et0?.APP_READY && PA_T.readySource === void 0) {
    let registering = true;
    PA_T.readySource = "pending";
    c0.eventSource.on(et0.APP_READY, () => {
      if (PA_T.readySource !== "pending") return;
      if (registering) {
        PA_T.readySource = "late";
        return;
      }
      PA_T.readyAt = performance.now();
      PA_T.readySource = "event";
    });
    registering = false;
  }
} catch {
}

function fmtSize(n) {
  if (!n) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
function fmtMs(ms) {
  if (ms == null) return "—";
  return ms < 1e3 ? `${Math.round(ms)} 毫秒` : `${(ms / 1e3).toFixed(1)} 秒`;
}
function jsonSize(v) {
  try {
    return utf8Len(JSON.stringify(v ?? null));
  } catch {
    return 0;
  }
}
// 按字符算 UTF-8 字节数，不必为了取长度再建一个 Blob
function utf8Len(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) { n += 4; i++; }
    else n += 3;
  }
  return n;
}
// 2.3.6 预设大小按对象缓存：体检、清理页每次打开都要把所有预设整份序列化，预设多时切页明显卡。
// 本扩展原地改写预设时调 forgetSize；酒馆保存预设会换成新对象，自然重算。别处原地改的，最多一分钟后重算
var sizeCache = new WeakMap();
function presetSize(obj) {
  if (!obj || typeof obj !== "object") return jsonSize(obj);
  const hit = sizeCache.get(obj);
  if (hit && Date.now() - hit.at < 6e4) return hit.n;
  const n = jsonSize(obj);
  sizeCache.set(obj, { n, at: Date.now() });
  return n;
}
function forgetSize(obj) {
  if (obj && typeof obj === "object") { sizeCache.delete(obj); scanCache.delete(obj); }
}
// 2.4.0 清理页：预设对象 → 大小、指纹、条目指纹。和 sizeCache 一样 1 分钟内有效，本扩展原地改写预设时清掉
var scanCache = new WeakMap();
function scanCached(obj) {
  const hit = obj && typeof obj === "object" ? scanCache.get(obj) : null;
  return hit && Date.now() - hit.at < 6e4 ? hit : null;
}

// ---- 请求分类
var REQ_CATS = [
  ["settings", "设置及预设"],
  ["chars", "全部角色列表"],
  ["charGet", "单张角色详情"],
  ["chats", "聊天记录"],
  ["extList", "扩展清单"],
  ["extFiles", "扩展脚本与样式"],
  ["wi", "世界书"],
  ["media", "头像与背景"],
  ["settingsSave", "设置保存"],
  ["fast", "第三方快速接口（其他）"],
  ["core", "酒馆程序文件"],
  ["api", "其他接口"],
  ["external", "外部网站"],
  ["other", "其他"]
];
var CAT_LABEL = Object.fromEntries(REQ_CATS);
// 已识别的第三方快速接口：替代酒馆原接口读写同一份数据，归到原接口的类别，并记下是谁的接口。
// 依据各项目源码中的路径（柏宝库 0.6.4、鸡尾酒+ 0.1.24、柏宝箱 1.0.0）。只说明「这笔请求走的是谁的接口」，不推断是哪个扩展发起的。
var FAST_ROUTES = [
  [/\/api\/plugins\/baibaoku\/v1\/settings\/fast-(get|bootstrap)$/, "settings", "柏宝库"],
  [/\/api\/plugins\/baibaoku\/v1\/settings\/fast-save$/, "settingsSave", "柏宝库"],
  [/\/api\/plugins\/baibaoku\/v1\/characters\/fast-all$/, "chars", "柏宝库"],
  [/\/api\/plugins\/baibaoku\/v1\/chats\/fast-(get|recent|search)$/, "chats", "柏宝库"],
  [/\/api\/plugins\/baibaoku\/v1\/extensions\/manifest-bundle$/, "extList", "柏宝库"],
  [/\/api\/plugins\/baibaoku\//, "fast", "柏宝库"],
  [/\/api\/plugins\/cocktail-plus\/fast\/settings-get$/, "settings", "鸡尾酒+"],
  [/\/api\/plugins\/cocktail-plus\/fast\/settings-save$/, "settingsSave", "鸡尾酒+"],
  [/\/api\/plugins\/cocktail-plus\/fast\/characters-all$/, "chars", "鸡尾酒+"],
  [/\/api\/plugins\/cocktail-plus\/fast\/characters-get$/, "charGet", "鸡尾酒+"],
  [/\/api\/plugins\/cocktail-plus\/fast\/chats-(group-)?save$/, "chats", "鸡尾酒+"],
  [/\/api\/plugins\/cocktail-plus\//, "fast", "鸡尾酒+"]
];
function classifyRequest(url, origin = globalThis.location?.origin) {
  let u;
  try {
    u = new URL(url, origin);
  } catch {
    return { cat: "other" };
  }
  if (u.origin !== origin) return { cat: "external", host: u.host };
  let p = u.pathname;
  try { p = decodeURIComponent(p); } catch {}
  for (const [re, cat, provider] of FAST_ROUTES) if (re.test(p)) return { cat, provider };
  const tp = /\/scripts\/extensions\/third-party\/([^/]+)\/(.*)$/.exec(p);
  if (tp) return /(^|\/)manifest\.json$/.test(tp[2]) ? { cat: "extList", ext: tp[1] } : { cat: "extFiles", ext: tp[1] };
  if (/\/scripts\/extensions\/[^/]+\/manifest\.json$/.test(p)) return { cat: "extList" };
  if (/\/api\/settings\/get$/.test(p)) return { cat: "settings" };
  if (/\/api\/settings\/save$/.test(p)) return { cat: "settingsSave" };
  if (/\/api\/characters\/all$/.test(p)) return { cat: "chars" };
  if (/\/api\/characters\/get$/.test(p)) return { cat: "charGet" };
  if (/\/api\/chats\//.test(p)) return { cat: "chats" };
  if (/\/api\/extensions\/discover$/.test(p)) return { cat: "extList" };
  if (/\/api\/worldinfo\//.test(p)) return { cat: "wi" };
  if (/\/thumbnail$/.test(p) || /\/(characters|User Avatars|backgrounds)\//.test(p) || /\/api\/(backgrounds|avatars)\//.test(p)) return { cat: "media" };
  if (/\/api\//.test(p)) return { cat: "api", path: p.replace(/^.*\/api\//, "") };
  return { cat: "core" };
}

// ---- 单笔请求
// 体积：transferSize＝实际经过网络的字节（含响应头）；encodedBodySize＝压缩后的正文；decodedBodySize＝解压后的正文。
// 三者都为 0 而请求确实发生了：多半是跨域且对方没开放计时信息，拿不到，不当成 0 字节。
function describeRequest(r, origin = globalThis.location?.origin) {
  const c = classifyRequest(r.name, origin);
  const start = r.startTime;
  const end = r.responseEnd > 0 ? r.responseEnd : r.startTime + r.duration;
  const hasDetail = r.responseStart > 0 && r.requestStart > 0;
  const limited = !(r.responseStart > 0) && !r.transferSize && !r.encodedBodySize && !r.decodedBodySize;
  let cache = "network";
  if (limited) cache = "unknown";
  else if (!r.transferSize && (r.decodedBodySize || r.encodedBodySize)) cache = "hit";
  else if (r.transferSize && r.encodedBodySize && r.transferSize < r.encodedBodySize) cache = "revalidated";
  return {
    url: r.name,
    ...c,
    initiator: r.initiatorType || "",
    start,
    end,
    dur: end - start,
    ttfb: hasDetail ? r.responseStart - r.requestStart : null,
    recv: r.responseStart > 0 && r.responseEnd >= r.responseStart ? r.responseEnd - r.responseStart : null,
    transfer: limited ? null : r.transferSize || 0,
    encoded: limited ? null : r.encodedBodySize || 0,
    decoded: limited ? null : r.decodedBodySize || 0,
    cache,
    sw: r.workerStart > 0,
    status: typeof r.responseStatus === "number" && r.responseStatus > 0 ? r.responseStatus : null
  };
}
// 时间段的并集长度：多笔请求同时进行时，不把各自的耗时相加
function unionMs(spans) {
  const s = spans.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  let total = 0, cs = -1, ce = -1;
  for (const [a, b] of s) {
    if (a > ce) {
      if (ce > cs) total += ce - cs;
      cs = a;
      ce = b;
    } else ce = Math.max(ce, b);
  }
  if (ce > cs) total += ce - cs;
  return total;
}
function summarizeRequests(reqs) {
  const out = new Map();
  for (const [k, label] of REQ_CATS) out.set(k, { cat: k, label, n: 0, start: null, end: null, busy: 0, transfer: 0, encoded: 0, decoded: 0, unknownSize: 0, cacheHits: 0, revalidated: 0, viaSw: 0, providers: {}, maxDur: 0 });
  for (const r of reqs) {
    const g = out.get(r.cat) || out.get("other");
    g.n++;
    g.start = g.start == null ? r.start : Math.min(g.start, r.start);
    g.end = g.end == null ? r.end : Math.max(g.end, r.end);
    g.maxDur = Math.max(g.maxDur, r.dur);
    if (r.transfer == null) g.unknownSize++;
    else {
      g.transfer += r.transfer;
      g.encoded += r.encoded;
      g.decoded += r.decoded;
    }
    if (r.cache === "hit") g.cacheHits++;
    if (r.cache === "revalidated") g.revalidated++;
    if (r.sw) g.viaSw++;
    if (r.provider) g.providers[r.provider] = (g.providers[r.provider] || 0) + 1;
  }
  for (const g of out.values()) g.busy = unionMs(reqs.filter((r) => (out.has(r.cat) ? r.cat : "other") === g.cat).map((r) => [r.start, r.end]));
  return [...out.values()].filter((g) => g.n);
}
// 接收速率估计：所有同源请求「正在接收数据」的时间段合并，实际传输字节 ÷ 忙碌时长。
// 只是本次的估计，受同时进行的请求、手机网络、服务器处理影响，不是服务器带宽上限。
function receiveRate(reqs) {
  const spans = reqs.filter((r) => r.cat !== "external" && r.transfer > 0 && r.recv > 0).map((r) => [r.end - r.recv, r.end]);
  const bytes = reqs.filter((r) => r.cat !== "external" && r.transfer > 0 && r.recv > 0).reduce((n, r) => n + r.transfer, 0);
  const busy = unionMs(spans);
  return bytes > 2 * 1024 * 1024 && busy > 2000 ? bytes / (busy / 1000) : null;
}

// ---- 这一次打开的测量结果
function loadWindow() {
  const nav = performance.getEntriesByType("navigation")[0];
  const readyAt = PA_T.readyAt;
  const all = performance.getEntriesByType("resource");
  // 「打开过程」：启动完成后 1.5 秒内开始的请求也算（启动完成前发出、稍后才开始的扩展请求）；之后自己点出来的不算
  const cutoff = readyAt ? readyAt + 1500 : Infinity;
  const reqs = all.filter((r) => r.startTime <= cutoff).map((r) => describeRequest(r));
  return {
    domReady: nav ? nav.domContentLoadedEventEnd || null : null,
    loadEvent: nav ? nav.loadEventEnd || null : null,
    readyAt,
    readySource: PA_T.readySource || "unknown",
    evalAt: PA_T.evalAt,
    reqs,
    bufferFull: !!(PA_T.bufFullBefore || PA_T.bufFullLater),
    navType: nav?.type || null
  };
}
function measureLoad() {
  const w = loadWindow();
  const settings = w.reqs.filter((r) => r.cat === "settings");
  const known = settings.filter((r) => r.transfer != null);
  // 设置下载自己的接收速度（只算它接收数据的那段时间），比整体平均更贴近预设的下载时间
  const big = known.slice().sort((a, b) => b.transfer - a.transfer)[0];
  const settingsRate = big && big.recv > 500 && big.transfer > 512 * 1024 ? big.transfer / (big.recv / 1000) : null;
  const rate = receiveRate(w.reqs);
  return {
    ...w,
    settingsCount: settings.length,
    settingsBytes: known.reduce((n, r) => n + r.transfer, 0),
    settingsOnce: known.length ? Math.max(...known.map((r) => r.transfer)) : 0,
    settingsDecoded: known.length ? Math.max(...known.map((r) => r.decoded)) : 0,
    rate: settingsRate || rate,
    rateSource: settingsRate ? "settings" : rate ? "all" : null,
    saveDuringLoad: w.readyAt ? w.reqs.some((r) => r.cat === "settingsSave" && r.start < w.readyAt) : false,
    // 启动完成之后才结束的请求：后台剩余加载
    background: w.readyAt ? w.reqs.filter((r) => r.end > w.readyAt) : []
  };
}

// ---- 全部预设在内存里的大小（序列化后的统计量，不是网络传输量）
var PRESET_APIS = [["openai", "聊天补全"], ["textgenerationwebui", "文本补全"], ["kobold", "KoboldAI"], ["novel", "NovelAI"]];
function allPresetSizes() {
  const out = [];
  for (const [api] of PRESET_APIS) {
    try {
      const list = ctx().getPresetManager(api)?.getPresetList?.();
      if (!list) continue;
      const names = Array.isArray(list.preset_names) ? list.preset_names : Object.keys(list.preset_names || {});
      const idxOf = (n) => Array.isArray(list.preset_names) ? list.preset_names.indexOf(n) : list.preset_names[n];
      for (const n of names) {
        if (api === "openai" && n === "gui") continue;
        const data = api === "openai" && n === currentPresetName() ? (() => { try { return readPreset(n); } catch { return null; } })() : list.presets?.[idxOf(n)];
        if (data) out.push({ api, name: n, size: presetSize(data) });
      }
    } catch {
    }
  }
  return out.sort((a, b) => b.size - a.size);
}
// 估算：这么多字节（内存中序列化大小）的预设，大约占设置下载里多少实际传输。
// 按「本次设置请求的实际传输 ÷ 内存中设置和预设的总大小」等比例折算，假设压缩率均匀。拿不到实际传输时不估算。
// 清理页勾选时会连着估算很多次，总大小 2 秒内复用
var rawSizeMemo = null;
function wireEstimate(bytes) {
  const m = measureLoad();
  if (!rawSizeMemo || Date.now() - rawSizeMemo.at > 2e3) rawSizeMemo = { at: Date.now(), n: allPresetSizes().reduce((n, x) => n + x.size, 0) + jsonSize(ctx().extensionSettings || {}) };
  const raw = rawSizeMemo.n;
  if (!m.settingsOnce || !raw) return null;
  const wire = bytes * Math.min(1, m.settingsOnce / raw);
  return { wire, secs: m.rate ? wire / m.rate : null, times: m.settingsCount };
}

// ---- 诊断报告（脱敏）：不含请求正文、密钥、聊天内容；路径里的角色、头像、聊天、文件名换成「…」，去掉查询参数
function redactUrl(url, origin = globalThis.location?.origin) {
  let u;
  try {
    u = new URL(url, origin);
  } catch {
    return "（无法解析）";
  }
  if (u.origin !== origin) return `外部：${u.host}`;
  let p = u.pathname;
  try { p = decodeURIComponent(p); } catch {}
  p = p.replace(/\/(characters|User Avatars|backgrounds|user\/files|user\/images|chats|group chats|worlds)\/.+$/i, "/$1/…");
  return p;
}
function buildDiagReport({ version, kind, measure, presets, extData, charCount, lazyChars, compat }) {
  const ua = String(globalThis.navigator?.userAgent || "");
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /CriOS|Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "其他";
  const os = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && globalThis.navigator?.maxTouchPoints > 1) ? "iOS/iPadOS" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "其他";
  const round = (x) => x == null ? null : Math.round(x);
  return {
    format: "burnt-chicken-wings-diagnostics/1",
    createdAt: new Date().toISOString(),
    extension: { version, kind },
    environment: { browser, os, secureContext: !!globalThis.isSecureContext, serviceWorkerControlled: !!globalThis.navigator?.serviceWorker?.controller, navigationType: measure.navType },
    definitions: {
      domReady: "页面 DOMContentLoaded 结束的时间（从打开页面算起，毫秒）",
      appReady: "酒馆发出 APP_READY 事件的时间；本扩展加载晚于它时记为 null",
      chatInteractive: "目标聊天可以正常操作的时间。目前无法可靠测量，固定为 null",
      transfer: "transferSize：实际经过网络的字节（含响应头）；缓存命中时为 0",
      encoded: "encodedBodySize：压缩后的正文字节",
      decoded: "decodedBodySize：解压后的正文字节",
      ttfb: "requestStart 到 responseStart：等待首字节，包含网络往返，不等于服务器处理时间",
      busy: "同类请求时间段的并集长度，不是各笔耗时之和",
      presetsInMemory: "内存中预设序列化后的大小，不是网络传输量"
    },
    timing: { domReady: round(measure.domReady), appReady: round(measure.readyAt), appReadySource: measure.readySource, chatInteractive: null, extensionEvaluatedAt: round(measure.evalAt), backgroundAfterReady: measure.background.length },
    categories: summarizeRequests(measure.reqs).map((g) => ({ cat: g.cat, label: g.label, n: g.n, start: round(g.start), end: round(g.end), busy: round(g.busy), maxDur: round(g.maxDur), transfer: g.transfer, encoded: g.encoded, decoded: g.decoded, unknownSize: g.unknownSize, cacheHits: g.cacheHits, revalidated: g.revalidated, viaServiceWorker: g.viaSw, providers: g.providers })),
    requests: measure.reqs.map((r) => ({ path: redactUrl(r.url), cat: r.cat, provider: r.provider || null, initiatorType: r.initiator || null, start: round(r.start), end: round(r.end), dur: round(r.dur), ttfb: round(r.ttfb), recv: round(r.recv), transfer: r.transfer, encoded: r.encoded, decoded: r.decoded, cache: r.cache, viaServiceWorker: r.sw, status: r.status })),
    data: {
      presetsInMemory: (presets || []).reduce((acc, p) => { acc[p.api] = acc[p.api] || { n: 0, bytes: 0 }; acc[p.api].n++; acc[p.api].bytes += p.size; return acc; }, {}),
      extensionSettings: (extData || []).filter((x) => x.size >= 1024).map((x) => ({ key: x.key, bytes: x.size })),
      characters: { count: charCount, lazy: !!lazyChars }
    },
    compatibility: compat || null,
    gaps: diagGaps(measure)
  };
}
// 这次测量覆盖不到的部分，报告和页面都要写出来
function diagGaps(m) {
  const g = [];
  if (m.bufferFull) g.push("浏览器的请求记录满过，有一部分请求没有记下来，统计不完整。");
  if (!m.readyAt) g.push(m.readySource === "late" ? "本扩展加载时酒馆已经启动完成，没有记到启动完成（APP_READY）的时间。" : "没有记到酒馆启动完成（APP_READY）的时间。");
  g.push("「聊天可操作」的时间目前无法可靠测量，没有记录。");
  if (m.reqs.some((r) => r.cache === "unknown")) g.push("部分请求受跨域限制，拿不到体积和分段耗时。");
  if (m.reqs.some((r) => r.sw)) g.push("部分请求经过 Service Worker 处理；页面上看到的是原地址，无法确认实际由哪个提供者处理。");
  g.push("请求是哪个扩展发起的无法可靠判断，报告中不标注发起者。");
  return g;
}
