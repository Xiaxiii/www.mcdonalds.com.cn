// 2.8.0 余额记录：查询当前连接的余额，每次结果记在本浏览器（localStorage），据此算上一轮、近 24 / 48 小时用量。
// 支持：中转站（OneAPI / NewAPI 的 /dashboard/billing 接口）、OpenRouter、DeepSeek。
// 用量按相邻两次记录相减：有累计用量的用累计用量，只有余额的取余额下降部分，充值不计入。
var BAL = { busy: false, err: "", listeners: new Set() };
const BAL_KEEP = 7 * 864e5;
const BAL_MAX = 400;
// 2.9.1 余额显示可关：关掉后连接页不显示余额、不自动查询
function balShown() {
  return settings().balanceShow !== false;
}
function balSupported(source) {
  return source === "custom" || source === "openrouter" || source === "deepseek";
}
// 一条连接一份记录：类型 + 网址 + 密钥编号
function balIdent(live = liveConnection()) {
  return [live.source, (live.url || "").replace(/\/+$/, ""), live.secretId || ""].join("\u0001");
}
function balStoreKey(id) {
  return `presetAtelier:balance:${userHandle()}:${id}`;
}
function balRecords(live = liveConnection()) {
  try {
    const v = JSON.parse(localStorage.getItem(balStoreKey(balIdent(live))) || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function balSave(live, list) {
  const cut = Date.now() - BAL_KEEP;
  const keep = list.filter((r) => r.t >= cut).slice(-BAL_MAX);
  try {
    localStorage.setItem(balStoreKey(balIdent(live)), JSON.stringify(keep));
  } catch {}
}
function onBalance(fn) {
  BAL.listeners.add(fn);
  return () => BAL.listeners.delete(fn);
}
function balEmit() {
  for (const fn of BAL.listeners) {
    try { fn(); } catch {}
  }
}
// 当前连接的密钥全文：使用中的站点记在本浏览器的优先，其次酒馆密钥库
async function balKey(live) {
  const active = settings().sites.find((x) => x.id === settings().activeSiteId);
  if (active && active.source === live.source && (live.source !== "custom" || (active.url || "") === (live.url || ""))) {
    const k = siteKey(active);
    if (k.localKey || k.legacyKey) {
      const v = getLocalKey({ id: active.id, localId: k.localId, legacyKey: k.legacyKey });
      if (v) return { value: v };
    }
  }
  if (!live.secretId) return {};
  return revealSecret(live.source, live.secretId);
}
// 2.8.8 浏览器拦下（跨域）时，中转站经酒馆后台查询：借用酒馆拉取模型列表的接口（/status），
// 网址末尾加「#」，酒馆拼上的「/models」落在 # 之后不发出，请求的就是余额接口本身；secret_id 指定用当前连接的密钥。
// 酒馆收到站点的非 2xx 时只回 { error: true }，看不到状态码，按「站点返回错误」处理。返回 null 表示这条路走不通
async function balViaST(url, live) {
  let r;
  try {
    const s = mods.openai?.oai_settings || {};
    r = await fetch(stUrl("api/backends/chat-completions/status"), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...ctx().getRequestHeaders?.() || {} },
      body: JSON.stringify({ chat_completion_source: "custom", custom_url: `${url}#`, custom_include_headers: s.custom_include_headers, ...live.secretId ? { secret_id: live.secretId } : {} }),
      cache: "no-store"
    });
  } catch {
    return null;
  }
  if (!r.ok) return null;
  const d = await r.json().catch(() => null);
  if (!d || d.error === true) return { failed: true };
  return { data: d };
}
// 先直接请求；浏览器拦下（跨域）时，中转站经酒馆后台查询，其他再试酒馆的转发（config.yaml 打开 enableCorsProxy 才有）
async function balFetch(url, key, live = null) {
  // 读不到密钥全文（allowKeysExposure 为 false）时，中转站只走酒馆后台，密钥不出酒馆
  if (!key) {
    const via = live?.source === "custom" ? await balViaST(url, live) : null;
    if (via?.data) return via.data;
    throw new Error(via?.failed ? "站点返回错误（经酒馆转发）" : "取不到当前连接的密钥");
  }
  const opt = { headers: { Authorization: `Bearer ${key}`, Accept: "application/json" }, cache: "no-store" };
  let r;
  try {
    r = await fetch(url, opt);
  } catch {
    if (live?.source === "custom") {
      const via = await balViaST(url, live);
      if (via?.data) return via.data;
      if (via?.failed) throw new Error("站点返回错误（经酒馆转发）");
    }
    try {
      r = await fetch(stUrl("proxy/" + url), opt);
    } catch {
      throw new Error("请求被浏览器拦截（站点不允许跨域）");
    }
    if (r.status === 404) throw new Error("请求被浏览器拦截（站点不允许跨域）；可在酒馆 config.yaml 打开 enableCorsProxy 后重试");
  }
  if (r.status === 401 || r.status === 403) throw new Error("密钥无效或无权查询余额");
  if (!r.ok) throw new Error(`站点返回 ${r.status}`);
  const d = await r.json().catch(() => null);
  if (!d) throw new Error("站点返回的不是余额数据");
  return d;
}
const balNum = (v) => typeof v === "number" && isFinite(v) ? v : typeof v === "string" && v.trim() && isFinite(+v) ? +v : null;
// 中转站：/v1/dashboard/billing/subscription 给额度上限，/v1/dashboard/billing/usage 给累计用量（单位：美分）
async function balRelay(base, key, live = null) {
  const u = new URL(base);
  const path = u.pathname.replace(/\/+$/, "");
  const roots = [...new Set([u.origin + path, u.origin + "/v1", u.origin])];
  let lastErr = null;
  for (const root of roots) {
    try {
      const sub = await balFetch(`${root}/dashboard/billing/subscription`, key, live);
      const hard = balNum(sub.hard_limit_usd ?? sub.system_hard_limit_usd);
      if (hard == null) throw new Error("站点没有余额接口");
      const end = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
      const start = new Date(Date.now() - 99 * 864e5).toISOString().slice(0, 10);
      let used = null;
      try {
        const us = await balFetch(`${root}/dashboard/billing/usage?start_date=${start}&end_date=${end}`, key, live);
        const cents = balNum(us.total_usage);
        if (cents != null) used = cents / 100;
      } catch {}
      // 不限额度的令牌，上限是一个极大的数
      if (hard >= 1e7) return { bal: null, used, cur: "$", unlimited: true };
      return { bal: used != null ? hard - used : hard, used, cur: "$" };
    } catch (e) {
      lastErr = e;
      // 一个地址被拦截（如该路径 404 时不带跨域头），其余地址照样试
      if (/无效/.test(e.message)) break;
    }
  }
  // 2.9.3 没有 /dashboard/billing 的 NewAPI 站点：再试令牌用量接口 /api/usage/token（额度单位按站点的 quota_per_unit 折算，默认 500000 = $1）
  try {
    const d = (await balFetch(`${u.origin}/api/usage/token`, key, live))?.data;
    const left = balNum(d?.total_available), spent = balNum(d?.total_used);
    if (left != null || d?.unlimited_quota) {
      let per = 5e5;
      try { per = balNum((await balFetch(`${u.origin}/api/status`, key, live))?.data?.quota_per_unit) || per; } catch {}
      const used = spent != null ? spent / per : null;
      if (d.unlimited_quota) return { bal: null, used, cur: "$", unlimited: true };
      return { bal: left / per, used, cur: "$" };
    }
  } catch {}
  if (/经酒馆转发/.test(lastErr?.message || "")) throw new Error(key ? "浏览器拦截了直接请求（站点不允许跨域），经酒馆转发也未查到余额" : "经酒馆转发查询，站点未返回余额");
  throw lastErr && !/站点返回 404/.test(lastErr.message) ? lastErr : new Error("站点没有余额接口（仅支持 OneAPI / NewAPI 类中转站）");
}
async function balQueryRaw(live, key) {
  if (live.source === "openrouter") {
    const d = (await balFetch("https://openrouter.ai/api/v1/credits", key)).data || {};
    const total = balNum(d.total_credits);
    const used = balNum(d.total_usage);
    if (total == null) throw new Error("OpenRouter 没有返回余额");
    return { bal: total - (used || 0), used, cur: "$" };
  }
  if (live.source === "deepseek") {
    const d = await balFetch("https://api.deepseek.com/user/balance", key);
    const info = (d.balance_infos || []).find((x) => x.currency === "CNY") || (d.balance_infos || [])[0];
    const bal = balNum(info?.total_balance);
    if (bal == null) throw new Error("DeepSeek 没有返回余额");
    return { bal, used: null, cur: info.currency === "USD" ? "$" : "¥" };
  }
  if (live.source === "custom") {
    if (!live.url) throw new Error("当前连接没有网址");
    return balRelay(live.url, key, live);
  }
  throw new Error("此连接类型没有余额接口");
}
// 查一次并记下。gen：生成结束后自动查的（用于「上一轮」）
async function balanceQuery({ gen = false, quiet = false } = {}) {
  const live = liveConnection();
  if (!balSupported(live.source) || BAL.busy) return null;
  BAL.busy = true;
  // 2.9.1 报错记在查询的那条连接上：换站点后不再显示上一个站点的报错
  BAL.err = "";
  BAL.errFor = balIdent(live);
  balEmit();
  try {
    const k = await balKey(live);
    // 中转站读不到密钥时改由酒馆后台查询；其他类型仍需密钥全文
    if (live.source !== "custom") {
      if (k.blocked) throw new Error("酒馆不允许读取密钥（config.yaml 中 allowKeysExposure 为 false）");
      if (!k.value) throw new Error("取不到当前连接的密钥");
    }
    const r = await balQueryRaw(live, k.value || null);
    const list = balRecords(live);
    const rec = { t: Date.now(), bal: r.bal, used: r.used, cur: r.cur, gen: gen || undefined, unl: r.unlimited || undefined };
    list.push(rec);
    balSave(live, list);
    balDeductManual(live, list[list.length - 2], rec);
    return r;
  } catch (e) {
    BAL.err = e.message || String(e);
    if (!quiet) console.warn("[焦香鸡翅] 查询余额失败", e);
    return null;
  } finally {
    BAL.busy = false;
    balEmit();
  }
}
// 2.8.5 手填余额：接口查不到账户余额（如不限额度的令牌）时，在站点上记下余额；
// 之后每次查询到的用量从中扣除（同一站点的各个密钥共用这份余额）。只扣填写之后的用量
function balSiteOf(live = liveConnection()) {
  const url = (live.url || "").replace(/\/+$/, "");
  return settings().sites.find((x) => x.source === live.source && (live.source !== "custom" || (x.url || "").replace(/\/+$/, "") === url)) || null;
}
function balDeductManual(live, prev, rec) {
  const mb = balSiteOf(live)?.manualBalance;
  if (!mb || !prev || prev.t < mb.at) return;
  const spent = balSpent(prev, rec);
  if (!(spent > 0)) return;
  mb.amount = Math.round((mb.amount - spent) * 1e4) / 1e4;
  saveSettings();
}
// 「50」「$50.5」「¥1,200」「30 元」「-1.2」→ { amount, cur }；格式不对返回 null
function balParseAmount(text) {
  const t = String(text || "").trim().replace(/[,，\s]/g, "").replace(/^[−–]/, "-");
  const m = /^(-)?([$¥￥]|US\$)?(-)?(\d+(?:\.\d+)?)(元|块|CNY|RMB|USD|美元|刀)?$/i.exec(t);
  if (!m) return null;
  const yuan = /[¥￥]/.test(m[2] || "") || /元|块|CNY|RMB/i.test(m[5] || "");
  return { amount: (m[1] || m[3] ? -1 : 1) * Number(m[4]), cur: yuan ? "¥" : "$" };
}
function balSetManual(site, text) {
  if (!String(text || "").trim()) { delete site.manualBalance; saveSettings(); balEmit(); return true; }
  const p = balParseAmount(text);
  if (!p) return false;
  site.manualBalance = { amount: p.amount, cur: p.cur, at: Date.now() };
  saveSettings();
  balEmit();
  return true;
}
// 站点列表里显示的余额：手填的优先，其次这个站点（当前密钥）最近一次查到的余额
function balSiteText(site) {
  const mb = site.manualBalance;
  if (mb) return fmtMoney(mb.amount, mb.cur);
  const k = siteKey(site);
  const rec = balRecords({ source: site.source, url: site.url, secretId: k?.secretId || null }).at(-1);
  if (!rec) return "";
  return rec.unl ? "不限额度" : rec.bal != null ? fmtMoney(rec.bal, rec.cur) : "";
}
// 两次记录之间的用量
function balSpent(a, b) {
  if (a.used != null && b.used != null) return Math.max(0, b.used - a.used);
  if (a.bal != null && b.bal != null) return Math.max(0, a.bal - b.bal);
  return 0;
}
function balWindow(list, ms, now = Date.now()) {
  const from = now - ms;
  let sum = 0;
  let pairs = 0;
  for (let i = 1; i < list.length; i++) {
    if (list[i].t < from) continue;
    // 窗口起点之前的最后一条也参与，算跨过起点的那一段
    sum += balSpent(list[i - 1], list[i]);
    pairs++;
  }
  const since = list.find((r) => r.t >= from) || null;
  const covered = list.some((r) => r.t <= from);
  return { sum, pairs, since: covered ? null : since?.t || null };
}
function balanceSummary(live = liveConnection()) {
  const list = balRecords(live);
  const now = Date.now();
  const lastRec = list[list.length - 1] || null;
  const prev = list[list.length - 2] || null;
  const mb = balSiteOf(live)?.manualBalance || null;
  return {
    manual: mb ? { amount: mb.amount, cur: mb.cur } : null,
    site: balSiteOf(live),
    supported: balSupported(live.source),
    busy: BAL.busy,
    err: BAL.errFor === balIdent(live) ? BAL.err : "",
    last: lastRec,
    round: lastRec && prev ? { v: balSpent(prev, lastRec), gen: !!lastRec.gen } : null,
    d1: balWindow(list, 864e5, now),
    d2: balWindow(list, 2 * 864e5, now),
    count: list.length
  };
}
function balClear(live = liveConnection()) {
  try { localStorage.removeItem(balStoreKey(balIdent(live))); } catch {}
  BAL.err = "";
  balEmit();
}
function fmtMoney(v, cur = "$") {
  if (v == null || !isFinite(v)) return "—";
  const a = Math.abs(v);
  const digits = a === 0 ? 2 : a < 0.01 ? 4 : a < 1 ? 3 : 2;
  return `${v < 0 ? "−" : ""}${cur}${a.toFixed(digits)}`;
}
// 生成结束后自动查（设置里打开时）；10 秒内不重复
function bindBalanceWatch(on, et2) {
  on(et2.GENERATION_ENDED, () => {
    if (!settings().balanceAuto || !balShown()) return;
    if (Date.now() - (balRecords().at(-1)?.t || 0) < 1e4) return;
    setTimeout(() => balanceQuery({ gen: true, quiet: true }), 1500);
  });
}
