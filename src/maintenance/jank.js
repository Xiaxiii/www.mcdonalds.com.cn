// 2.7.8 运行中的卡顿记录：页面卡顿（浏览器长任务）和本扩展自身处理的耗时，
// 供「体检 → 运行中的卡顿」判断卡顿是不是本扩展造成的。只记时间和名称，不记内容，只在内存里。
// 优先用「长动画帧」（新版 Chrome、Edge、安卓，可归到具体扩展），其次用长任务；Safari 都不提供，改用计时器延迟估算。
var JANK = { since: performance.now(), mode: "none", stalls: [], own: new Map(), ownSlow: [], scripts: new Map(), layout: { n: 0, ms: 0 }, started: false };
var JANK_KEEP = 300;
function jankStart() {
  if (JANK.started) return;
  JANK.started = true;
  try {
    // 2.7.9 新版 Chrome、Edge、安卓浏览器提供「长动画帧」记录：能看到卡住的这一帧里是哪个文件的脚本在跑，
    // 据此把卡顿归到具体扩展（只取文件地址里的扩展目录名，不读脚本内容）
    if (globalThis.PerformanceObserver?.supportedEntryTypes?.includes("long-animation-frame")) {
      const po = new PerformanceObserver((list) => { for (const e of list.getEntries()) jankFrame(e); });
      po.observe({ type: "long-animation-frame", buffered: true });
      JANK.mode = "loaf";
      cleanups.push(() => po.disconnect());
      return;
    }
    if (globalThis.PerformanceObserver?.supportedEntryTypes?.includes("longtask")) {
      const po = new PerformanceObserver((list) => { for (const e of list.getEntries()) jankStall(e.startTime, e.duration); });
      po.observe({ type: "longtask", buffered: true });
      JANK.mode = "longtask";
      cleanups.push(() => po.disconnect());
      return;
    }
  } catch {
  }
  // 每秒一次的计时器，晚到超过 120 毫秒记为一次卡顿；页面在后台时浏览器会放慢计时器，不计
  let expect = 0, timer = 0;
  const arm = () => { expect = performance.now() + 1e3; timer = setTimeout(tick, 1e3); };
  const tick = () => {
    const late = performance.now() - expect;
    if (late > 120 && !document.hidden) jankStall(expect, late);
    arm();
  };
  const onVis = () => { clearTimeout(timer); arm(); };
  document.addEventListener("visibilitychange", onVis);
  arm();
  JANK.mode = "timer";
  cleanups.push(() => { clearTimeout(timer); document.removeEventListener("visibilitychange", onVis); });
}
function jankStall(at, ms, owners = []) {
  const end = at + ms;
  const own = JANK.ownSlow.filter((x) => x.at < end && x.at + x.ms > at).map((x) => x.label);
  JANK.stalls.push({ at, ms, own: [...new Set(own)], owners });
  if (JANK.stalls.length > JANK_KEEP) JANK.stalls.shift();
}
// 脚本地址 → 来源：第三方扩展按目录名，酒馆内置扩展、酒馆本身分开
function jankOwner(url) {
  const u = String(url || "");
  if (!u) return "页面内联脚本或浏览器";
  let m = /\/scripts\/extensions\/third-party\/([^/?#]+)\//.exec(u);
  if (m) {
    const dir = decodeURIComponent(m[1]);
    return typeof EXT_DIR !== "undefined" && dir === EXT_DIR ? `${appName()}（本扩展）` : `扩展「${dir}」`;
  }
  m = /\/scripts\/extensions\/([^/?#]+)\//.exec(u);
  if (m) return `酒馆内置扩展「${decodeURIComponent(m[1])}」`;
  try {
    const x = new URL(u, location.href);
    if (x.origin === location.origin) return "酒馆本身";
    return x.host;
  } catch {
    return "其他";
  }
}
function jankFrame(e) {
  const ms = e.duration;
  const at = e.startTime;
  const owners = new Set();
  for (const sc of e.scripts || []) {
    if (!(sc.duration >= 5)) continue;
    const who = jankOwner(sc.sourceURL);
    owners.add(who);
    let r = JANK.scripts.get(who);
    if (!r) JANK.scripts.set(who, r = { n: 0, ms: 0, forced: 0 });
    r.n++;
    r.ms += sc.duration;
    r.forced += sc.forcedStyleAndLayoutDuration || 0;
  }
  // 这一帧里脚本之外、浏览器重新计算样式和排版的时间
  if (e.styleAndLayoutStart > 0) {
    const layout = at + ms - e.styleAndLayoutStart;
    if (layout >= 5) { JANK.layout.n++; JANK.layout.ms += layout; }
  }
  jankStall(at, ms, [...owners]);
}
function jankOwn(label, at, ms) {
  let s = JANK.own.get(label);
  if (!s) JANK.own.set(label, s = { n: 0, total: 0, max: 0 });
  s.n++;
  s.total += ms;
  if (ms > s.max) s.max = ms;
  if (ms >= 16) {
    JANK.ownSlow.push({ label, at, ms });
    if (JANK.ownSlow.length > JANK_KEEP) JANK.ownSlow.shift();
  }
}
// 包一层计时：只计同步部分（异步处理里真正占住页面的也是同步部分）
function jankWrap(label, fn) {
  return function(...args) {
    const t0 = performance.now();
    try {
      return fn.apply(this, args);
    } finally {
      jankOwn(label, t0, performance.now() - t0);
    }
  };
}
function jankTime(label, fn) {
  return jankWrap(label, fn)();
}
function jankClear() {
  JANK.since = performance.now();
  JANK.stalls.length = 0;
  JANK.ownSlow.length = 0;
  JANK.own.clear();
  JANK.scripts.clear();
  JANK.layout = { n: 0, ms: 0 };
}
// 汇总给体检页：卡顿次数、最长、与本扩展重叠的次数，本扩展各项处理的次数和最长耗时
function jankSummary() {
  const stalls = JANK.stalls;
  const overlapped = stalls.filter((s) => s.own.length);
  const own = [...JANK.own].map(([label, s]) => ({ label, n: s.n, max: s.max, avg: s.total / s.n })).sort((a, b) => b.max - a.max);
  const blame = new Map();
  for (const s of overlapped) for (const l of s.own) blame.set(l, (blame.get(l) || 0) + 1);
  return {
    mode: JANK.mode,
    minutes: (performance.now() - JANK.since) / 6e4,
    count: stalls.length,
    severe: stalls.filter((s) => s.ms >= 200).length,
    longest: stalls.reduce((m, s) => Math.max(m, s.ms), 0),
    overlapped: overlapped.length,
    blame: [...blame].sort((a, b) => b[1] - a[1]),
    own,
    scripts: [...JANK.scripts].map(([who, r]) => ({ who, ...r })).sort((a, b) => b.ms - a.ms),
    layout: JANK.layout,
    recent: stalls.slice(-12).reverse()
  };
}
