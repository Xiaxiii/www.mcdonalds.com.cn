// 2.10.0 合并新版：基底（旧版，保留自己的改动）← 新版。逐条比对提示词、预设内置正则、酒馆助手脚本，
// 每条选保留旧版、采用新版、加入或删除，再按选择写回基底。比对只读两份草稿，写回在 applyMerge 里一次完成。
var MERGE_PROMPT_FIELDS = ["role", "injection_position", "injection_depth", "injection_order", "system_prompt", "marker"];
var MERGE_REGEX_KEYS = ["scriptName", "findRegex", "replaceString", "trimStrings", "placement", "disabled", "runOnEdit", "substituteRegex", "minDepth", "maxDepth", "markdownOnly", "promptOnly"];
var mergeNorm = (s) => String(s ?? "").replace(/\s/g, "");
// 逐行比对。先去掉相同的开头和结尾，中间一段再求最长公共子序列；中间太长时整段按删除、新增列出
function mergeLineDiff(oldT, newT) {
  const o = String(oldT ?? "").split("\n"), n = String(newT ?? "").split("\n");
  let s = 0;
  while (s < o.length && s < n.length && o[s] === n[s]) s++;
  let e = 0;
  while (e < o.length - s && e < n.length - s && o[o.length - 1 - e] === n[n.length - 1 - e]) e++;
  const out = [];
  for (let i = 0; i < s; i++) out.push(["ctx", o[i]]);
  const om = o.slice(s, o.length - e), nm = n.slice(s, n.length - e);
  const m = om.length, k = nm.length;
  if (m && k && m * k <= 4e6) {
    const dp = Array.from({ length: m + 1 }, () => new Int32Array(k + 1));
    for (let i = m - 1; i >= 0; i--) for (let j = k - 1; j >= 0; j--) dp[i][j] = om[i] === nm[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    let i = 0, j = 0;
    while (i < m && j < k) {
      if (om[i] === nm[j]) { out.push(["ctx", om[i]]); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) out.push(["del", om[i++]]);
      else out.push(["add", nm[j++]]);
    }
    while (i < m) out.push(["del", om[i++]]);
    while (j < k) out.push(["add", nm[j++]]);
  } else {
    for (const l of om) out.push(["del", l]);
    for (const l of nm) out.push(["add", l]);
  }
  for (let i = o.length - e; i < o.length; i++) out.push(["ctx", o[i]]);
  return out;
}
function mergeLineSet(t) {
  const s = new Set();
  for (const l of String(t ?? "").split("\n")) {
    const k = l.trim().replace(/\s+/g, " ");
    if (k) s.add(k);
  }
  return s;
}
function mergeJaccard(sa, sb) {
  if (!sa.size && !sb.size) return 1;
  if (!sa.size || !sb.size) return 0;
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  return inter / (sa.size + sb.size - inter);
}
// 正则比对用的文本：不看 id，只看会影响效果的字段
function mergeRegexBlob(s) {
  return MERGE_REGEX_KEYS.map((k) => `${k}: ${JSON.stringify(s?.[k])}`).join("\n");
}
// 酒馆助手脚本：extensions.tavern_helper.scripts 里可以直接放脚本，也可以放文件夹（带 scripts 数组）。摊平成一列，记下所在文件夹
function mergeTavernScripts(preset) {
  const top = preset?.extensions?.tavern_helper?.scripts;
  const out = [];
  if (!Array.isArray(top)) return out;
  top.forEach((x, fi) => {
    if (!x || typeof x !== "object") return;
    if (Array.isArray(x.scripts)) x.scripts.forEach((s, si) => { if (s && typeof s === "object") out.push({ s, key: `${fi}:${si}`, folder: x.name ?? "" }); });
    else out.push({ s: x, key: String(fi), folder: null });
  });
  return out;
}
function mergeScriptSame(a, b) {
  const strip = (s) => { const { id: _id, ...rest } = s || {}; return JSON.stringify(rest); };
  return strip(a) === strip(b);
}
// 剩下的「只在旧版」「只在新版」按内容相似度再配一次：改了名字、内容大体相同的算同一条
function mergeContentFallback(items, getText, threshold = 0.4) {
  const rem = [], add = [];
  items.forEach((it, i) => { if (it.type === "removed") rem.push(i); else if (it.type === "added") add.push(i); });
  if (!rem.length || !add.length) return items;
  const remSets = rem.map((i) => mergeLineSet(getText(items[i].a))), addSets = add.map((i) => mergeLineSet(getText(items[i].b)));
  const pairs = [];
  for (let r = 0; r < rem.length; r++) for (let a = 0; a < add.length; a++) {
    const score = mergeJaccard(remSets[r], addSets[a]);
    if (score >= threshold) pairs.push([score, r, a]);
  }
  pairs.sort((x, y) => y[0] - x[0]);
  const usedR = new Set(), usedA = new Set(), drop = new Set();
  for (const [, r, a] of pairs) {
    if (usedR.has(r) || usedA.has(a)) continue;
    usedR.add(r); usedA.add(a);
    const A = items[rem[r]], B = items[add[a]];
    const renamed = mergeNorm(A.name) !== mergeNorm(B.name);
    items[rem[r]] = { ...A, type: "changed", name: renamed ? `${A.name} → ${B.name}` : A.name, b: B.b, bi: B.bi, bRef: B.bRef, choice: "keep", renamed };
    drop.add(add[a]);
  }
  return items.filter((_, i) => !drop.has(i));
}
function mergePromptItems(base, next) {
  const live = (d) => {
    const seen = new Set(), out = [];
    for (const o of d.order) {
      const p = d.prompt(o.identifier);
      if (p && !seen.has(p.identifier)) { seen.add(p.identifier); out.push(p); }
    }
    return out;
  };
  const aList = live(base), bList = live(next);
  const sets = new Map(bList.map((p) => [p.identifier, mergeLineSet(p.content)]));
  const bucket = (list) => {
    const m = new Map();
    for (const p of list) {
      const k = mergeNorm(p.name);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(p);
    }
    return m;
  };
  const aByName = bucket(aList), bByName = bucket(bList);
  // 第一轮：同名的配对。同名有多条时按内容相似度从高到低配，几乎没有相同内容的不硬配
  const paired = new Map();
  for (const [name, as] of aByName) {
    const bs = bByName.get(name);
    if (!bs) continue;
    const scored = [];
    for (const pa of as) {
      const sa = mergeLineSet(pa.content);
      for (const pb of bs) scored.push([mergeJaccard(sa, sets.get(pb.identifier)), pa, pb]);
    }
    scored.sort((x, y) => y[0] - x[0]);
    const tA = new Set(), tB = new Set();
    for (const [score, pa, pb] of scored) {
      if (tA.has(pa.identifier) || tB.has(pb.identifier)) continue;
      if (score < 0.1 && (pa.content || pb.content)) continue;
      paired.set(pa.identifier, pb);
      tA.add(pa.identifier); tB.add(pb.identifier);
    }
  }
  const usedB = new Set();
  let items = aList.map((pa) => {
    const pb = paired.get(pa.identifier);
    if (!pb) return { type: "removed", name: pa.name, a: pa, b: null, choice: "keep" };
    usedB.add(pb.identifier);
    return { type: (pa.content || "") === (pb.content || "") ? "same" : "changed", name: pa.name, a: pa, b: pb, choice: "keep" };
  });
  for (const pb of bList) if (!usedB.has(pb.identifier)) items.push({ type: "added", name: pb.name, a: null, b: pb, choice: "new" });
  items = mergeContentFallback(items, (p) => p?.content || "");
  // 新增条目的编号和基底里已有的条目撞了，就换一个新编号，免得写回时覆盖旧条目
  const taken = new Set(base.preset.prompts.map((p) => p.identifier));
  for (const it of items) {
    if (it.a) { it.key = it.a.identifier; continue; }
    let id = it.b.identifier;
    if (!id || taken.has(id)) id = uid();
    taken.add(id);
    it.key = id;
  }
  return items;
}
function mergeRegexItems(base, next) {
  const ra = presetRegexList(base), rb = presetRegexList(next);
  const usedB = new Set();
  let items = ra.map((sa, ai) => {
    // 先按编号配（改了名字编号不变），编号对不上再按名字
    let bi = rb.findIndex((x, i) => x && sa?.id != null && x.id === sa.id && !usedB.has(i));
    const byId = bi >= 0;
    if (bi < 0) bi = rb.findIndex((x, i) => x && !usedB.has(i) && mergeNorm(x.scriptName) === mergeNorm(sa?.scriptName));
    const gone = { type: "removed", name: sa?.scriptName, a: sa, b: null, ai, choice: "keep" };
    if (bi < 0) return gone;
    const sb = rb[bi], ba = mergeRegexBlob(sa), bb = mergeRegexBlob(sb);
    if (ba === bb) { usedB.add(bi); return { type: "same", name: sb.scriptName || sa.scriptName, a: sa, b: sb, ai, bi, choice: "keep" }; }
    // 同名但没有一行相同的，当成两条无关的规则
    if (!byId && !mergeLineDiff(ba, bb).some(([t, l]) => t === "ctx" && l.trim())) return gone;
    usedB.add(bi);
    const renamed = sa.scriptName !== sb.scriptName;
    return { type: "changed", name: renamed ? `${sa.scriptName} → ${sb.scriptName}` : sa.scriptName, a: sa, b: sb, ai, bi, choice: "keep", renamed };
  });
  rb.forEach((sb, bi) => { if (sb && !usedB.has(bi)) items.push({ type: "added", name: sb.scriptName, a: null, b: sb, bi, choice: "new" }); });
  items = mergeContentFallback(items, (s) => s ? `${s.findRegex || ""}\n${s.replaceString || ""}` : "");
  for (const it of items) it.key = it.a ? `a:${it.ai}` : `b:${it.bi}`;
  return items;
}
function mergeScriptItems(base, next) {
  const aa = mergeTavernScripts(base.preset), bb = mergeTavernScripts(next.preset);
  const usedB = new Set();
  const items = aa.map((ra) => {
    const sa = ra.s;
    let rb = bb.find((x) => !usedB.has(x) && sa.id != null && x.s.id === sa.id);
    if (!rb) rb = bb.find((x) => !usedB.has(x) && mergeNorm(x.s.name) === mergeNorm(sa.name));
    if (!rb) {
      // 编号和名字都换了：按代码相似度找
      const la = mergeLineSet(sa.content);
      let best = null, score = 0;
      for (const x of bb) {
        if (usedB.has(x)) continue;
        const v = mergeJaccard(la, mergeLineSet(x.s.content));
        if (v > score) { score = v; best = x; }
      }
      if (best && score >= 0.25) rb = best;
    }
    if (!rb) return { type: "removed", name: sa.name, a: sa, b: null, aRef: ra, key: `a:${ra.key}`, choice: "keep" };
    usedB.add(rb);
    return { type: mergeScriptSame(sa, rb.s) ? "same" : "changed", name: sa.name || rb.s.name, a: sa, b: rb.s, aRef: ra, bRef: rb, key: `a:${ra.key}`, choice: "keep" };
  });
  for (const rb of bb) if (!usedB.has(rb)) items.push({ type: "added", name: rb.s.name, a: null, b: rb.s, bRef: rb, key: `b:${rb.key}`, choice: "new" });
  return items;
}
// 分组配对：同名的算同一组；剩下的看成员重合度（组改了名字）。新版独有的组记下排在哪个旧组后面
function mergeGroupPairs(base, next, prompts) {
  const aG = base.groups.groups, bG = next.groups.groups;
  const keptA = new Map(), keptB = new Map();
  const bByName = new Map();
  for (const g of bG) if (!bByName.has(mergeNorm(g.name))) bByName.set(mergeNorm(g.name), g);
  for (const ag of aG) {
    const bg = bByName.get(mergeNorm(ag.name));
    if (bg && !keptB.has(bg.id)) { keptA.set(ag.id, { a: ag, b: bg }); keptB.set(bg.id, ag.id); }
  }
  const aToB = new Map();
  for (const it of prompts) if (it.a && it.b) aToB.set(it.a.identifier, it.b.identifier);
  const members = (d) => {
    const m = new Map();
    for (const [id, v] of Object.entries(d.groups.prompts)) {
      if (!v?.groupId) continue;
      if (!m.has(v.groupId)) m.set(v.groupId, new Set());
      m.get(v.groupId).add(id);
    }
    return m;
  };
  const aMem = members(base), bMem = members(next);
  const cands = [];
  for (const ag of aG) {
    if (keptA.has(ag.id)) continue;
    const mapped = new Set();
    for (const id of aMem.get(ag.id) || []) if (aToB.has(id)) mapped.add(aToB.get(id));
    if (!mapped.size) continue;
    for (const bg of bG) {
      if (keptB.has(bg.id)) continue;
      const bs = bMem.get(bg.id);
      if (!bs?.size) continue;
      let hit = 0;
      for (const id of mapped) if (bs.has(id)) hit++;
      const f = hit / mapped.size, w = hit / bs.size, score = f + w ? 2 * f * w / (f + w) : 0;
      if (score >= 0.4) cands.push([score, ag, bg]);
    }
  }
  cands.sort((x, y) => y[0] - x[0]);
  for (const [, ag, bg] of cands) {
    if (keptA.has(ag.id) || keptB.has(bg.id)) continue;
    keptA.set(ag.id, { a: ag, b: bg, renamed: true });
    keptB.set(bg.id, ag.id);
  }
  // 新版独有的组：编号和基底的组撞了就换新编号
  const taken = new Set(aG.map((g) => g.id));
  const addedB = new Map();
  for (const bg of bG) {
    if (keptB.has(bg.id)) continue;
    let id = bg.id;
    if (!id || taken.has(id)) id = uid();
    taken.add(id);
    addedB.set(bg.id, { id, b: bg });
  }
  return { keptA, keptB, addedB };
}
/** 生成合并方案。base：基底（旧版）草稿；next：新版草稿。两份草稿都不改 */
function mergePlan(base, next) {
  const prompts = mergePromptItems(base, next);
  const plan = {
    base, next, prompts,
    regex: mergeRegexItems(base, next),
    scripts: mergeScriptItems(base, next),
    groups: mergeGroupPairs(base, next, prompts),
    order: { prompts: [], regex: [] },
    // 用户拖动后指定的分组：条目 key -> 分组编号，null 表示不在任何组里
    groupOverrides: new Map()
  };
  // 新版条目编号 -> 这一条在合并结果里的 key
  plan.bKey = new Map();
  for (const it of prompts) if (it.b) plan.bKey.set(it.b.identifier, it.key);
  plan.bOrder = next.order.map((o) => plan.bKey.get(o.identifier)).filter(Boolean);
  plan.bRegexOrder = plan.regex.filter((it) => it.b).sort((x, y) => x.bi - y.bi).map((it) => it.key);
  mergeSyncOrder(plan, "prompts");
  mergeSyncOrder(plan, "regex");
  return plan;
}
function mergeItems(plan, tab) {
  return tab === "prompts" ? plan.prompts : tab === "regex" ? plan.regex : plan.scripts;
}
/** 分组信息（列表里的组头用）：编号 -> { name, status: kept | removed | added, newName } */
function mergeGroupInfo(plan) {
  const out = new Map();
  for (const g of plan.base.groups.groups) {
    const k = plan.groups.keptA.get(g.id);
    out.set(g.id, { name: g.name, status: k ? "kept" : "removed", newName: k?.renamed ? k.b.name : void 0 });
  }
  for (const { id, b } of plan.groups.addedB.values()) out.set(id, { name: b.name, status: "added" });
  return out;
}
// 新版分组编号 -> 合并结果里的分组编号
function mergeOutGroup(plan, bGid) {
  if (!bGid) return null;
  return plan.groups.keptB.get(bGid) || plan.groups.addedB.get(bGid)?.id || null;
}
/** 每条归哪个组（按当前的选择）：key -> 分组编号 */
function mergeGroupMap(plan) {
  const { base, next, prompts, bOrder } = plan;
  const map = {};
  for (const it of prompts) {
    const g = it.a && base.groupOf(it.a.identifier);
    if (g) map[it.key] = g;
  }
  const addedKeys = new Set(prompts.filter((it) => it.type === "added").map((it) => it.key));
  // 新版里没写分组的：看它在新版里前后最近的、已经有组的条目
  const nearby = (key, skip) => {
    const i = bOrder.indexOf(key);
    if (i < 0) return null;
    for (let k = i - 1; k >= 0; k--) if (!skip?.has(bOrder[k]) && map[bOrder[k]]) return map[bOrder[k]];
    for (let k = i + 1; k < bOrder.length; k++) if (!skip?.has(bOrder[k]) && map[bOrder[k]]) return map[bOrder[k]];
    return null;
  };
  for (const it of prompts) {
    if (it.type !== "added") continue;
    const g = mergeOutGroup(plan, next.groupOf(it.b.identifier)) || nearby(it.key, addedKeys);
    if (g) map[it.key] = g;
  }
  // 改动的条目选了新版：分组跟新版走
  for (const it of prompts) {
    if (it.type !== "changed" || it.choice !== "new") continue;
    const g = mergeOutGroup(plan, next.groupOf(it.b.identifier)) || nearby(it.key);
    if (g) map[it.key] = g;
  }
  for (const [key, gid] of plan.groupOverrides) {
    if (gid) map[key] = gid;
    else delete map[key];
  }
  return map;
}
// 把一条放进已排好的 seq：优先挨着同组的条目，其次挨着它在新版里的前一条、后一条
// home：这一条在旧版里的位置（改动的条目才有）。新版里找不到可参照的邻居时，同组的留在原位
function mergeInsertIndex(seq, key, bOrder, groupMap, home) {
  const g = groupMap[key] || null, bi = bOrder.indexOf(key);
  if (g) {
    if (bi >= 0) {
      for (let k = bi - 1; k >= 0; k--) if (groupMap[bOrder[k]] === g) { const p = seq.indexOf(bOrder[k]); if (p >= 0) return p + 1; }
      for (let k = bi + 1; k < bOrder.length; k++) if (groupMap[bOrder[k]] === g) { const p = seq.indexOf(bOrder[k]); if (p >= 0) return p; }
    }
    if (home && home.gid === g) return home.at(seq);
    let last = -1;
    for (let i = 0; i < seq.length; i++) if (groupMap[seq[i]] === g) last = i;
    if (last >= 0) return last + 1;
  }
  if (bi >= 0) {
    for (let k = bi - 1; k >= 0; k--) { const p = seq.indexOf(bOrder[k]); if (p >= 0) return p + 1; }
    for (let k = bi + 1; k < bOrder.length; k++) { const p = seq.indexOf(bOrder[k]); if (p >= 0) return p; }
  }
  return home ? home.at(seq) : seq.length;
}
// 默认顺序：旧版的条目保持原位；新增的、选了新版的改动条目按新版里的位置插进去
function mergeNaturalOrder(plan, tab) {
  const items = mergeItems(plan, tab), prompts = tab === "prompts";
  const movable = new Set(items.filter((it) => it.type === "added" || prompts && it.type === "changed" && it.choice === "new").map((it) => it.key));
  const seq = items.filter((it) => !movable.has(it.key)).map((it) => it.key);
  const bOrder = prompts ? plan.bOrder : plan.bRegexOrder;
  const groupMap = prompts ? mergeGroupMap(plan) : {};
  const rank = new Map(bOrder.map((k, i) => [k, i]));
  const moving = items.filter((it) => movable.has(it.key)).sort((x, y) => (rank.get(x.key) ?? 1e9) - (rank.get(y.key) ?? 1e9));
  const aOrder = items.filter((it) => it.a).map((it) => it.key);
  const home = (it) => it.a && {
    gid: plan.base.groupOf(it.a.identifier),
    at(list) {
      for (let k = aOrder.indexOf(it.key) - 1; k >= 0; k--) { const p = list.indexOf(aOrder[k]); if (p >= 0) return p + 1; }
      return 0;
    }
  };
  for (const it of moving) seq.splice(mergeInsertIndex(seq, it.key, bOrder, groupMap, home(it) || void 0), 0, it.key);
  return seq;
}
/** 让排序和当前的条目、选择对上：已经排好的不动，新出现的插到默认顺序里相邻条目的旁边 */
function mergeSyncOrder(plan, tab) {
  if (tab === "scripts") return [];
  const natural = mergeNaturalOrder(plan, tab);
  const has = new Set(natural);
  const kept = plan.order[tab].filter((k) => has.has(k));
  const placed = new Set(kept);
  natural.forEach((k, i) => {
    if (placed.has(k)) return;
    let at = kept.length;
    for (let p = i - 1; p >= 0; p--) {
      const pos = kept.indexOf(natural[p]);
      if (pos >= 0) { at = pos + 1; break; }
    }
    if (at === kept.length && i === 0) at = 0;
    kept.splice(at, 0, k);
    placed.add(k);
  });
  plan.order[tab] = kept;
  return kept;
}
/** 改一条的选择。改动的提示词条目换版本后，位置和分组按新选择重新算 */
function mergeChoose(plan, tab, key, choice) {
  const it = mergeItems(plan, tab).find((x) => x.key === key);
  if (!it || it.choice === choice) return false;
  it.choice = choice;
  if (tab === "prompts" && it.type === "changed") {
    plan.order.prompts = plan.order.prompts.filter((k) => k !== key);
    plan.groupOverrides.delete(key);
  }
  mergeSyncOrder(plan, tab);
  return true;
}
/** 拖动：把 key 挪到 ref 的前面或后面。gid 传了就同时改它的分组（null＝不在任何组里） */
function mergeMove(plan, tab, key, ref, after, gid) {
  const arr = mergeSyncOrder(plan, tab);
  if (key === ref || !arr.includes(key) || !arr.includes(ref)) return false;
  arr.splice(arr.indexOf(key), 1);
  arr.splice(arr.indexOf(ref) + (after ? 1 : 0), 0, key);
  if (tab === "prompts" && gid !== void 0) plan.groupOverrides.set(key, gid || null);
  return true;
}
function mergeStats(plan, tab) {
  const items = mergeItems(plan, tab);
  const n = (t, c) => items.filter((x) => x.type === t && (!c || x.choice === c)).length;
  return {
    all: items.length, same: n("same"), changed: n("changed"), added: n("added"), removed: n("removed"),
    useNew: n("changed", "new"), addIn: n("added", "new"), dropOut: n("removed", "skip")
  };
}
/** 按当前的选择，合并后会不会改动基底 */
function mergeTouches(plan) {
  const s = ["prompts", "regex", "scripts"].map((t) => mergeStats(plan, t));
  if (s.some((x) => x.useNew || x.addIn || x.dropOut)) return true;
  if (plan.groupOverrides.size) return true;
  // 旧版条目之间的先后有没有变
  const moved = (tab) => {
    const old = mergeItems(plan, tab).filter((it) => it.a).map((it) => it.key), has = new Set(old);
    const cur = mergeSyncOrder(plan, tab).filter((k) => has.has(k));
    return cur.some((k, i) => k !== old[i]);
  };
  return moved("prompts") || moved("regex");
}
/** 一条的差异（展开时才算）：[[ctx | add | del, 一行文字], ...] */
function mergeItemDiff(tab, it) {
  if (it._diff) return it._diff;
  const text = (x) => tab === "prompts" ? x?.content || "" : tab === "regex" ? mergeRegexBlob(x) : x?.content || "";
  const lines = (x, t) => text(x).split("\n").map((l) => [t, l]);
  it._diff = it.type === "changed" ? mergeLineDiff(text(it.a), text(it.b)) : it.type === "added" ? lines(it.b, "add") : it.type === "removed" ? lines(it.a, "del") : lines(it.a, "ctx");
  return it._diff;
}
/** 脚本里有哪些字段变了（不算 id） */
function mergeScriptFields(a, b) {
  return [...new Set([...Object.keys(a || {}), ...Object.keys(b || {})])].filter((k) => k !== "id" && JSON.stringify(a?.[k]) !== JSON.stringify(b?.[k]));
}
/**
 * 把方案写进草稿 d（默认写进基底）。d 的内容必须和生成方案时的基底一致。
 * 先把要写的内容全部算好，再动草稿：中途出错时草稿不变。
 */
function applyMerge(plan, d = plan.base) {
  const { next } = plan;
  const rules = presetRegexList(d);
  const R = plan.regex;
  if (R.some((it) => it.a && rules[it.ai] === void 0)) throw new Error("目标预设的正则已变化，请重新比对");
  const P = plan.prompts;
  if (P.some((it) => it.a && !d.prompt(it.a.identifier))) throw new Error("目标预设的条目已变化，请重新比对");
  const order = mergeSyncOrder(plan, "prompts"), regexOrder = mergeSyncOrder(plan, "regex");
  const groupMap = mergeGroupMap(plan);
  const stats = { prompts: mergeStats(plan, "prompts"), regex: mergeStats(plan, "regex"), scripts: mergeStats(plan, "scripts") };
  // ---- 正则
  const used = new Set(rules.map((r) => r?.id).filter((x) => typeof x === "string"));
  const byKey = new Map(), dropped = [];
  for (const it of R) {
    if (it.type === "removed" && it.choice === "skip") { if (typeof it.a?.id === "string") dropped.push(it.a.id); continue; }
    if (it.type === "added") {
      if (it.choice !== "new") continue;
      const r = clone(it.b);
      if (typeof r.id !== "string" || !r.id || used.has(r.id)) r.id = presetRegexNewId(used);
      used.add(r.id);
      byKey.set(it.key, r);
    } else byKey.set(it.key, it.type === "changed" && it.choice === "new" ? { ...clone(it.b), id: it.a.id } : rules[it.ai]);
  }
  const newRules = regexOrder.map((k) => byKey.get(k)).filter(Boolean);
  // ---- 酒馆助手脚本
  const S = plan.scripts, sByKey = new Map(S.map((it) => [it.key, it]));
  const sTouched = S.some((it) => it.type === "changed" && it.choice === "new" || it.type === "added" && it.choice === "new" || it.type === "removed" && it.choice === "skip");
  let newTree = null;
  if (sTouched) {
    const pick = (s, key) => {
      const it = sByKey.get(`a:${key}`);
      if (!it) return s;
      if (it.type === "removed" && it.choice === "skip") return null;
      return it.type === "changed" && it.choice === "new" ? clone(it.b) : s;
    };
    const top = Array.isArray(d.preset.extensions?.tavern_helper?.scripts) ? d.preset.extensions.tavern_helper.scripts : [];
    newTree = top.map((x, fi) => !x || typeof x !== "object" ? x
      : Array.isArray(x.scripts) ? { ...x, scripts: x.scripts.map((s, si) => s && typeof s === "object" ? pick(s, `${fi}:${si}`) : s).filter((s) => s != null) }
        : pick(x, String(fi))).filter((x) => x != null);
    const bTop = next.preset.extensions?.tavern_helper?.scripts || [];
    for (const it of S) {
      if (it.type !== "added" || it.choice !== "new") continue;
      if (it.bRef.folder === null) { newTree.push(clone(it.b)); continue; }
      let f = newTree.find((x) => x && Array.isArray(x.scripts) && (x.name ?? "") === it.bRef.folder);
      if (!f) {
        // 基底里没有这个文件夹：照新版的文件夹建一个空的
        f = { ...clone(bTop[Number(it.bRef.key.split(":")[0])]), scripts: [] };
        newTree.push(f);
      }
      f.scripts.push(clone(it.b));
    }
  }
  // ---- 以下开始改草稿
  const ext = d.preset.extensions;
  // 提示词：采用新版
  for (const it of P) {
    if (it.type !== "changed" || it.choice !== "new") continue;
    const t = d.prompt(it.a.identifier);
    t.content = it.b.content;
    t.name = it.b.name;
    for (const f of MERGE_PROMPT_FIELDS) if (it.b[f] !== void 0) t[f] = clone(it.b[f]);
  }
  // 提示词：删除旧版独有的
  const gone = P.filter((it) => it.type === "removed" && it.choice === "skip").map((it) => it.a.identifier);
  if (gone.length) d.deletePrompts(gone);
  // 提示词：加入新版新增的，开关照新版
  const main = findOrderList(d.preset);
  const bEnabled = new Map(next.order.map((o) => [o.identifier, o.enabled !== false]));
  const addedKeys = new Set();
  for (const it of P) {
    if (it.type !== "added" || it.choice !== "new") continue;
    d.preset.prompts.push({ ...clone(it.b), identifier: it.key });
    main.order.push({ identifier: it.key, enabled: bEnabled.get(it.b.identifier) ?? false });
    addedKeys.add(it.key);
  }
  // 顺序
  const entry = new Map(main.order.map((o) => [o.identifier, o]));
  const final = order.filter((k) => entry.has(k));
  const inFinal = new Set(final);
  main.order = [...final.map((k) => entry.get(k)), ...main.order.filter((o) => !inFinal.has(o.identifier))];
  // 各角色单独的顺序表：新增的条目放在它前一条的后面
  for (const po of d.preset.prompt_order) {
    if (po === main || !Array.isArray(po.order)) continue;
    const has = new Set(po.order.map((o) => o.identifier));
    final.forEach((k, i) => {
      if (!addedKeys.has(k) || has.has(k)) return;
      let at = po.order.length;
      for (let p = i - 1; p >= 0; p--) {
        const pos = po.order.findIndex((o) => o.identifier === final[p]);
        if (pos >= 0) { at = pos + 1; break; }
      }
      po.order.splice(at, 0, { identifier: k, enabled: entry.get(k).enabled });
      has.add(k);
    });
  }
  // 分组：改了名字的组跟新版；新版独有的组有成员时才建
  for (const [aId, k] of plan.groups.keptA) if (k.renamed && d.group(aId)) d.group(aId).name = k.b.name;
  const addedGroup = new Map([...plan.groups.addedB.values()].map((g) => [g.id, g.b]));
  for (const k of final) {
    const gid = groupMap[k] || null;
    if (gid && !d.group(gid) && addedGroup.has(gid)) {
      const { anchor: _a, ...g } = clone(addedGroup.get(gid));
      d.groups.groups.push({ ...g, id: gid });
    }
    d._setGroup(k, gid && d.group(gid) ? gid : null);
  }
  // 正则
  if (JSON.stringify(newRules) !== JSON.stringify(rules)) {
    ext.regex_scripts = newRules;
    const map = ext.baibaiToolkit?.regexGroups?.scripts;
    if (map && typeof map === "object" && !Array.isArray(map)) for (const id of dropped) delete map[id];
  }
  // 酒馆助手脚本；新版里新出现的变量补进来，已有的变量不动
  if (newTree) {
    if (!ext.tavern_helper || typeof ext.tavern_helper !== "object") ext.tavern_helper = { scripts: [], variables: {} };
    ext.tavern_helper.scripts = newTree;
    const bv = next.preset.extensions?.tavern_helper?.variables;
    if (bv && typeof bv === "object" && !Array.isArray(bv)) {
      const av = ext.tavern_helper.variables && typeof ext.tavern_helper.variables === "object" ? ext.tavern_helper.variables : ext.tavern_helper.variables = {};
      for (const k of Object.keys(bv)) if (!(k in av)) av[k] = clone(bv[k]);
    }
  }
  return stats;
}
/** 不改基底，算出合并后的完整预设（导出文件用） */
function mergedPreset(plan) {
  const copy = new Draft(plan.base.name, plan.base.toPreset());
  applyMerge(plan, copy);
  return copy.toPreset();
}
