// 1.5.0 预设清理：找出完全相同、同系列旧版本、内容相近的预设。只做判断，不改任何东西。
// 不用 crypto.subtle：云酒馆多是 http 地址，浏览器在 http 下不提供它。
function hashStr(s) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
}
// 名称拆成「系列名」和「版本号」。例：【留光】Aria-Gemini-v3.6.8 → 系列「【留光】aria-gemini」，版本 [3,6,8]
// 副本后缀（_json、(1)、副本、copy、备份）去掉后算同一系列。
function splitPresetName(name) {
  let s = String(name || "").trim().toLowerCase();
  s = s.replace(/[\s_\-]*(?:\(\d+\)|（\d+）|副本\d*|copy\d*|备份\d*|_?json|旧版|old)$/g, "");
  let ver = null;
  // 版本号前面可以是任何非字母（空格、括号、【】、汉字……），如「【小冰块】v3.83」「众生相3.0二改」
  const m = /(^|[^a-z])v\.?(\d+(?:[._]\d+)*)(?!\d)/i.exec(s) || /(^|[^\d.a-z])(\d+(?:\.\d+)+)(?![\d.])/.exec(s);
  if (m) {
    ver = m[2].split(/[._]/).map(Number);
    const at = m.index + m[1].length;
    s = (s.slice(0, at) + " " + s.slice(m.index + m[0].length)).trim();
  }
  const base = s.replace(/[\s_\-—–·.]+/g, " ").trim();
  return { base, ver };
}
function cmpVer(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d) return d;
  }
  return 0;
}
// 条目内容的指纹集合：用来算两个预设有多少条目相同
function promptPrints(data) {
  const out = new Set();
  for (const p of data?.prompts || []) {
    const c = String(p?.content || "").trim();
    if (c.length >= 20) out.add(hashStr(c));
  }
  return out;
}
function overlap(a, b) {
  if (!a.size || !b.size) return 0;
  let n = 0;
  const [small, big] = a.size < b.size ? [a, b] : [b, a];
  for (const x of small) if (big.has(x)) n++;
  return n / (a.size + b.size - n);
}
// list: [{ name, data, size }]；opts: { current, inUse: { name: [原因] }, lastUse: { name: 时间 } }
// 返回每个预设的标签：
//   same   与另一个预设内容完全相同（保留一个即可）
//   old    同系列有更新的版本
//   series 同系列的另一份（名称只差副本后缀）
//   near   与另一个预设大部分条目相同
// 「保留哪一个」：当前使用 > 方案在用 > 最近用过 > 更新的版本 > 名称在前的
function scanPresets(list, opts = {}) {
  const { current = null, inUse = {}, lastUse = {} } = opts;
  const rows = list.map((x) => ({ name: x.name, size: x.size, full: x.full ?? hashStr(JSON.stringify(x.data ?? null)), ...splitPresetName(x.name), prints: x.prints ?? promptPrints(x.data), tags: [] }));
  const rank = (r) => [r.name === current ? 1 : 0, inUse[r.name]?.length ? 1 : 0, lastUse[r.name] || 0];
  const better = (a, b) => {
    const ra = rank(a), rb = rank(b);
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] > rb[i];
    if (a.ver && b.ver && cmpVer(a.ver, b.ver)) return cmpVer(a.ver, b.ver) > 0;
    return a.name.localeCompare(b.name, "zh") < 0;
  };
  const pick = (group) => group.reduce((k, r) => better(r, k) ? r : k);
  const tagged = new Set();
  // 完全相同
  const byFull = new Map();
  for (const r of rows) (byFull.get(r.full) || byFull.set(r.full, []).get(r.full)).push(r);
  for (const g of byFull.values()) {
    if (g.length < 2) continue;
    const keep = pick(g);
    for (const r of g) if (r !== keep) { r.tags.push({ k: "same", t: `与「${keep.name}」完全相同`, ref: keep.name }); tagged.add(r); }
  }
  // 同系列
  const byBase = new Map();
  for (const r of rows) if (r.base) (byBase.get(r.base) || byBase.set(r.base, []).get(r.base)).push(r);
  for (const g of byBase.values()) {
    const live = g.filter((r) => !tagged.has(r));
    if (live.length < 2) continue;
    const vers = live.filter((r) => r.ver);
    const newest = vers.length ? vers.reduce((k, r) => cmpVer(r.ver, k.ver) > 0 ? r : k) : null;
    const keep = pick(live);
    for (const r of live) {
      if (r === keep) continue;
      // 最新版本不提示清理（即使当前用的是旧版本）
      if (r === newest) continue;
      if (newest && r.ver && cmpVer(r.ver, newest.ver) < 0) r.tags.push({ k: "old", t: `有新版「${newest.name}」`, ref: newest.name });
      else r.tags.push({ k: "series", t: `与「${keep.name}」同系列`, ref: keep.name });
      tagged.add(r);
    }
  }
  // 内容相近（条目有六成以上相同）
  for (const r of rows) {
    if (tagged.has(r) || r.prints.size < 3) continue;
    let best = null, bestV = 0;
    for (const o of rows) {
      if (o === r || o.prints.size < 3) continue;
      const v = overlap(r.prints, o.prints);
      if (v > bestV) { bestV = v; best = o; }
    }
    // 同系列里更新的版本，不因为和旧版本相近而被提示清理
    const newer = best && best.base === r.base && r.ver && best.ver && cmpVer(r.ver, best.ver) > 0;
    if (best && bestV >= 0.6 && !newer && better(best, r)) r.tags.push({ k: "near", t: `与「${best.name}」${Math.round(bestV * 100)}% 条目相同`, ref: best.name, v: bestV });
  }
  return rows.map((r) => ({
    name: r.name,
    size: r.size,
    tags: r.tags,
    hash: r.full,
    current: r.name === current,
    inUse: inUse[r.name] || [],
    lastUse: lastUse[r.name] || 0,
    suggest: r.tags.length > 0 && r.name !== current
  }));
}
