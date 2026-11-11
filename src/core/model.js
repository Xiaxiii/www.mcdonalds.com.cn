var GLOBAL_ORDER_ID = 100001;
function clone(v) {
  return v == null ? v : JSON.parse(JSON.stringify(v));
}
function uid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c2) => {
    const r = Math.random() * 16 | 0;
    return (c2 === "x" ? r : r & 3 | 8).toString(16);
  });
}
function findOrderList(preset) {
  if (!Array.isArray(preset.prompt_order)) preset.prompt_order = [];
  const po = preset.prompt_order;
  let entry = po.find((o) => Number(o.character_id) === GLOBAL_ORDER_ID) || po.find((o) => Number(o.character_id) === 1e5) || po[po.length - 1];
  if (!entry) {
    entry = { character_id: GLOBAL_ORDER_ID, order: (preset.prompts || []).map((p) => ({ identifier: p.identifier, enabled: true })) };
    po.push(entry);
  }
  if (!Array.isArray(entry.order)) entry.order = [];
  return entry;
}
var SYSTEM_MARKERS = /* @__PURE__ */ new Set(["main", "nsfw", "jailbreak", "chatHistory", "worldInfoAfter", "worldInfoBefore", "enhanceDefinitions", "charDescription", "charPersonality", "scenario", "personaDescription", "dialogueExamples"]);
var Draft = class {
  /** @param {string} name @param {object} preset */
  constructor(name, preset) {
    this.name = name;
    this.preset = clone(preset);
    if (!Array.isArray(this.preset.prompts)) this.preset.prompts = [];
    this.history = [];
    this.dirty = false;
    this._normalize();
  }
  _normalize() {
    const p = this.preset;
    if (!p.extensions || typeof p.extensions !== "object" || Array.isArray(p.extensions)) p.extensions = {};
    const ext = p.extensions;
    const bai = ext.baibaiToolkit?.presetPromptGroups;
    this.hadBaibai = !!bai;
    this.hadEntryGrouping = Array.isArray(ext.entryGrouping);
    const groups = { version: 1, groups: [], prompts: {} };
    if (bai && Array.isArray(bai.groups)) {
      groups.groups = bai.groups.map((g) => ({ ...g }));
      for (const [k, v] of Object.entries(bai.prompts || {})) {
        if (v && v.groupId) groups.prompts[k] = { ...v };
      }
      for (const key of Object.keys(bai)) if (!(key in groups)) groups[key] = clone(bai[key]);
    } else if (this.hadEntryGrouping) {
      const ids = this.order.map((o) => o.identifier);
      ext.entryGrouping.forEach((g, i) => {
        if (g && Array.isArray(g.memberIdentifiers)) {
          // 1.1.3：成员列表式分组（旧版只认首尾范围式，这类分组会被丢掉，保存后条目全散开）
          const mem = g.memberIdentifiers.filter((x) => ids.includes(x));
          if (!mem.length) return;
          const id = g.id || uid();
          groups.groups.push({ id, name: g.name || "分组", order: i, collapsed: true, enabled: g.enabled !== false });
          for (const x of mem) groups.prompts[x] = { groupId: id };
          return;
        }
        const a = ids.indexOf(g.startIdentifier);
        const b = ids.indexOf(g.endIdentifier);
        if (a < 0 || b < 0) return;
        const id = g.id || uid();
        groups.groups.push({ id, name: g.name || "分组", order: i, collapsed: true, enabled: g.enabled !== false });
        for (let k = Math.min(a, b); k <= Math.max(a, b); k++) groups.prompts[ids[k]] = { groupId: id };
      });
    }
    const valid = new Set(groups.groups.map((g) => g.id));
    for (const [k, v] of Object.entries(groups.prompts)) if (!valid.has(v.groupId)) delete groups.prompts[k];
    this.groups = groups;
    // 读进来时就存在的分组 id：保存时用来识别 entryGrouping 里旧版本镜像出来的同名分组
    this.loadedGroupIds = new Set(valid);
  }
  get order() {
    if (this._readIndex) return this._readIndex.order;
    return findOrderList(this.preset).order;
  }
  /** 同步只读操作内共用索引；每次操作重新建立，正文、顺序等直接编辑不会留下过期缓存。 */
  withReadIndex(fn) {
    if (this._readIndex) return fn();
    const order = this.order;
    const firstBy = (list, key) => {
      const map = new Map();
      for (const value of list) if (!map.has(value[key])) map.set(value[key], value);
      return map;
    };
    this._readIndex = {
      order,
      prompts: firstBy(this.preset.prompts, "identifier"),
      entries: firstBy(order, "identifier"),
      groups: firstBy(this.groups.groups, "id")
    };
    try { return fn(); }
    finally { delete this._readIndex; }
  }
  prompt(id) {
    if (this._readIndex) return this._readIndex.prompts.get(id);
    return this.preset.prompts.find((p) => p.identifier === id);
  }
  promptMap() {
    return new Map(this.preset.prompts.map((p) => [p.identifier, p]));
  }
  isMarker(id) {
    const p = this.prompt(id);
    return !!(p && (p.marker || SYSTEM_MARKERS.has(id) && !p.content));
  }
  groupOf(id) {
    return this.groups.prompts[id]?.groupId || null;
  }
  group(gid) {
    if (this._readIndex) return this._readIndex.groups.get(gid) || null;
    return this.groups.groups.find((g) => g.id === gid) || null;
  }
  isActive(id) {
    const o = this._readIndex ? this._readIndex.entries.get(id) : this.order.find((x) => x.identifier === id);
    if (!o || o.enabled === false) return false;
    const p = this.prompt(id);
    if (!p) return false;
    // 分组上的「关闭」标记只有柏宝箱在运行时才会挡住组内条目（它在生成时过滤）；没有柏宝箱时酒馆只看条目自己的开关
    const gid = this.groupOf(id);
    if (gid && this.groupGate !== false && this.group(gid)?.enabled === false) return false;
    return true;
  }
  /** 分组自身的开关；与成员选择、宿主是否支持分组过滤无关。 */
  groupOff(gid) {
    return this.group(gid)?.enabled === false;
  }
  /** 整份换成另一个版本（恢复备份、恢复草稿）。分组格式等读入时的信息也一起换 */
  replaceWith(preset) {
    const tmp = new Draft(this.name, preset);
    this.preset = tmp.preset;
    this.groups = tmp.groups;
    this.hadBaibai = tmp.hadBaibai;
    this.hadEntryGrouping = tmp.hadEntryGrouping;
    this.loadedGroupIds = tmp.loadedGroupIds;
  }
  // ---------- 撤销 ----------
  snapshot(label) {
    // 除条目外，预设的其他设置（温度等参数、各角色的条目顺序）和分组格式也记下：恢复备份这类整份替换的操作才能完整撤销
    const { prompts: _p, extensions: _e, ...rest } = this.preset;
    const h = {
      label, prompts: clone(this.preset.prompts), groups: clone(this.groups), extensions: clone(this.preset.extensions), rest: clone(rest),
      flags: { hadBaibai: this.hadBaibai, hadEntryGrouping: this.hadEntryGrouping, loadedGroupIds: [...(this.loadedGroupIds || [])] }
    };
    this.history.push(h);
    // 每份快照都是整份预设。大预设少留几份，免得手机内存吃紧整页重载
    if (!this._snapSize) {
      try { this._snapSize = JSON.stringify(h.prompts).length; } catch { this._snapSize = 0; }
    }
    const cap = this._snapSize > 1e6 ? 15 : this._snapSize > 3e5 ? 30 : 60;
    while (this.history.length > cap) this.history.shift();
    this.dirty = true;
  }
  undo() {
    const h = this.history.pop();
    if (!h) return null;
    if (h.rest) {
      this.preset = { ...h.rest, prompts: h.prompts, extensions: h.extensions || {} };
      this.hadBaibai = h.flags.hadBaibai;
      this.hadEntryGrouping = h.flags.hadEntryGrouping;
      this.loadedGroupIds = new Set(h.flags.loadedGroupIds);
    } else {
      // 旧格式的快照（只记了全局顺序）
      findOrderList(this.preset).order = h.order;
      this.preset.prompts = h.prompts;
      if (h.extensions) this.preset.extensions = h.extensions;
    }
    this.groups = h.groups;
    this.dirty = true;
    return h.label;
  }
  // ---------- 显示用：按顺序切成"分组框 / 散条目"块 ----------
  // 空分组（anchor＝它跟在哪一条后面，""＝最前面）在它的锚点之后显示；锚点在某个组中间时，等那个组结束再显示
  blocks() {
    const out = [];
    const seen = /* @__PURE__ */ new Map();
    const empties = this.emptyGroups();
    const byAnchor = /* @__PURE__ */ new Map();
    const ids = new Set(this.order.map((o) => o.identifier));
    for (const g of empties) {
      const k = g.anchor && ids.has(g.anchor) ? g.anchor : g.anchor === "" ? "" : "\u0000end";
      if (!byAnchor.has(k)) byAnchor.set(k, []);
      byAnchor.get(k).push(g);
    }
    const pending = [...byAnchor.get("") || []];
    const flush = () => {
      for (const g of pending.splice(0)) out.push({ groupId: g.id, ids: [], part: 1, parts: 1, empty: true });
    };
    flush();
    this.order.forEach((o, i) => {
      const gid = this.groupOf(o.identifier);
      const last = out[out.length - 1];
      if (last && !last.empty && last.groupId === gid) last.ids.push(o.identifier);
      else {
        const part = gid ? (seen.get(gid) || 0) + 1 : 0;
        if (gid) seen.set(gid, part);
        out.push({ groupId: gid, ids: [o.identifier], part });
      }
      pending.push(...byAnchor.get(o.identifier) || []);
      const next = this.order[i + 1];
      if (!gid || !next || this.groupOf(next.identifier) !== gid) flush();
    });
    pending.push(...byAnchor.get("\u0000end") || []);
    flush();
    for (const b of out) if (b.groupId && !b.empty) b.parts = seen.get(b.groupId);
    return out;
  }
  /** 没有成员、但要显示出来的分组（新建的空白分组，或成员都被移走的分组） */
  emptyGroups() {
    const used = new Set(Object.values(this.groups.prompts).map((v) => v.groupId));
    return this.groups.groups.filter((g) => g.anchor !== void 0 && !used.has(g.id));
  }
  isEmptyGroup(gid) {
    const g = this.group(gid);
    return !!g && !this.order.some((o) => this.groupOf(o.identifier) === gid);
  }
  /** 空分组之后的插入点：紧跟它的锚点 */
  afterEmpty(gid) {
    const a = this.group(gid)?.anchor;
    return a && this.order.some((o) => o.identifier === a) ? { after: a } : { index: 0 };
  }
  createEmptyGroup(name, anchor) {
    const id = uid();
    this.groups.groups.push({ id, name: name || "新分组", order: this.groups.groups.length, collapsed: false, enabled: true, anchor: anchor || "" });
    return id;
  }
  // ---------- 基础移动 ----------
  _take(ids) {
    const set = new Set(ids);
    const order = this.order;
    const taken = [];
    for (let i = order.length - 1; i >= 0; i--) {
      if (set.has(order[i].identifier)) taken.unshift(order.splice(i, 1)[0]);
    }
    const byId = new Map(taken.map((o) => [o.identifier, o]));
    return ids.map((id) => byId.get(id)).filter(Boolean);
  }
  /**
   * 把条目移到某处。
   * @param {string[]} ids 按想要的先后排列
   * @param {{after?:string, before?:string, groupStart?:string, groupEnd?:string, index?:number}} where
   * @param {string|null|undefined} groupId 移动后归属的分组；undefined 表示按落点自动决定
   */
  move(ids, where, groupId) {
    ids = ids.filter((id) => this.order.some((o) => o.identifier === id));
    if (!ids.length) return;
    if (where.after && ids.includes(where.after)) {
      const idx2 = this.order.findIndex((o) => o.identifier === where.after);
      let k = idx2;
      while (k >= 0 && ids.includes(this.order[k].identifier)) k--;
      where = k >= 0 ? { after: this.order[k].identifier } : { index: 0 };
    }
    if (where.before && ids.includes(where.before)) {
      const idx2 = this.order.findIndex((o) => o.identifier === where.before);
      let k = idx2;
      while (k < this.order.length && ids.includes(this.order[k].identifier)) k++;
      where = k < this.order.length ? { before: this.order[k].identifier } : { index: this.order.length };
    }
    const autoGroup = this._groupAt(where);
    const before = this._anchorsBefore(ids);
    const taken = this._take(ids);
    const idx = this._resolveIndex(where);
    this.order.splice(idx, 0, ...taken);
    const g = groupId === void 0 ? autoGroup : groupId;
    for (const id of ids) this._setGroup(id, g);
    // 原来跟在插入点后面的空分组，改跟在新放进来的最后一条后面，这样「放在 X 后面」就紧贴着 X
    const key = where.after !== void 0 ? where.after : where.index === 0 ? "" : null;
    if (key !== null && !where.behind) {
      for (const eg of this.emptyGroups()) if (eg.anchor === key && eg.id !== g) eg.anchor = ids[ids.length - 1];
    }
    this._anchorEmptied(before);
  }
  /** 记下每个组前面那一条（不算要挪走的），组被挪空以后，空组就留在原处 */
  _anchorsBefore(movingIds) {
    const moving = new Set(movingIds);
    const m = /* @__PURE__ */ new Map();
    this.order.forEach((o, i) => {
      const gid = this.groupOf(o.identifier);
      if (!gid || m.has(gid)) return;
      let k = i - 1;
      while (k >= 0 && moving.has(this.order[k].identifier)) k--;
      m.set(gid, k >= 0 ? this.order[k].identifier : "");
    });
    return m;
  }
  _anchorEmptied(before) {
    for (const [gid, anchor] of before) {
      const g = this.group(gid);
      if (g && this.isEmptyGroup(gid)) g.anchor = anchor;
    }
  }
  /**
   * 按"选位置"的结果移动：groupId 为某组＝放进该组；为 null＝放在组外（顶层）。
   * 放在组外时，整组都被选中的分组保持成组，跟着一起挪（相当于移动整个分组）。
   * 只有一条的组不算：把那一条拖出来就是要它出组。
   */
  place(ids, where, groupId, { keep = [] } = {}) {
    if (groupId) return this.move(ids, where, groupId);
    const set = new Set(ids);
    const whole = /* @__PURE__ */ new Map();
    const was = new Map(ids.map((id) => [id, this.groupOf(id)]));
    for (const g of new Set(was.values())) {
      if (!g) continue;
      const mem = this.order.filter((o) => this.groupOf(o.identifier) === g);
      whole.set(g, mem.every((o) => set.has(o.identifier)) && (mem.length > 1 || keep.includes(g)));
    }
    this.move(ids, where, null);
    for (const id of ids) {
      const g = was.get(id);
      if (g && whole.get(g)) this._setGroup(id, g);
    }
  }
  _groupAt(where) {
    if (where.groupStart) return where.groupStart;
    if (where.groupEnd) return where.groupEnd;
    if (where.after) return this.groupOf(where.after);
    if (where.before) return this.groupOf(where.before);
    return null;
  }
  _resolveIndex(where) {
    const order = this.order;
    const pos = (id) => order.findIndex((o) => o.identifier === id);
    if (where.after) {
      const i = pos(where.after);
      return i < 0 ? order.length : i + 1;
    }
    if (where.before) {
      const i = pos(where.before);
      return i < 0 ? order.length : i;
    }
    if (where.groupStart || where.groupEnd) {
      const gid = where.groupStart || where.groupEnd;
      let first = -1, last = -1;
      order.forEach((o, i) => {
        if (this.groupOf(o.identifier) !== gid) return;
        if (first < 0) first = i;
        last = i;
      });
      if (first < 0) return this._resolveIndex(this.afterEmpty(gid));
      return where.groupStart ? first : last + 1;
    }
    if (typeof where.index === "number") return Math.max(0, Math.min(order.length, where.index));
    return order.length;
  }
  _setGroup(id, gid) {
    if (gid) this.groups.prompts[id] = { ...this.groups.prompts[id] || {}, groupId: gid };
    else delete this.groups.prompts[id];
  }
  /** 按顺序排序一组 id（保持在预设里的相对先后） */
  sortByOrder(ids) {
    const pos = new Map(this.order.map((o, i) => [o.identifier, i]));
    return [...ids].sort((a, b) => (pos.get(a) ?? 1e9) - (pos.get(b) ?? 1e9));
  }
  // ---------- 分组操作 ----------
  createGroup(name, ids, { keepClickOrder = false } = {}) {
    const id = uid();
    const list = keepClickOrder ? ids : this.sortByOrder(ids);
    const firstIdx = Math.min(...list.map((x) => this.order.findIndex((o) => o.identifier === x)).filter((i) => i >= 0));
    const rest = this.order.filter((o) => !list.includes(o.identifier));
    let anchor = this.order.slice(0, firstIdx).filter((o) => !list.includes(o.identifier)).pop();
    if (anchor) {
      const g = this.groupOf(anchor.identifier);
      const next = rest[rest.indexOf(anchor) + 1];
      if (g && next && this.groupOf(next.identifier) === g) {
        const members = rest.filter((o) => this.groupOf(o.identifier) === g);
        anchor = members[members.length - 1];
      }
    }
    this.groups.groups.push({ id, name: name || "新分组", order: this.groups.groups.length, collapsed: false, enabled: true });
    this.move(list, anchor ? { after: anchor.identifier } : { index: 0 }, id);
    return id;
  }
  moveIntoGroup(ids, gid, { keepClickOrder = false, atStart = false } = {}) {
    const list = keepClickOrder ? ids : this.sortByOrder(ids);
    const members = this.order.filter((o) => this.groupOf(o.identifier) === gid && !list.includes(o.identifier));
    if (!members.length) {
      this.move(list, this.group(gid)?.anchor !== void 0 ? this.afterEmpty(gid) : { index: this.order.length }, gid);
    } else if (atStart) {
      this.move(list, { before: members[0].identifier }, gid);
    } else {
      this.move(list, { after: members[members.length - 1].identifier }, gid);
    }
  }
  removeFromGroup(ids) {
    const list = this.sortByOrder(ids);
    const byGroup = /* @__PURE__ */ new Map();
    for (const id of list) {
      const g = this.groupOf(id);
      if (!g) continue;
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g).push(id);
    }
    for (const [g, mem] of byGroup) {
      const rest = this.order.filter((o) => this.groupOf(o.identifier) === g && !mem.includes(o.identifier));
      if (rest.length) this.move(mem, { after: rest[rest.length - 1].identifier }, null);
      else {
        // 整组都移出：条目原地不动，分组变成空分组，留在这些条目后面
        for (const id of mem) this._setGroup(id, null);
        const gg = this.group(g);
        if (gg) gg.anchor = mem[mem.length - 1];
      }
    }
  }
  renameGroup(gid, name) {
    const g = this.group(gid);
    if (g) g.name = name;
  }
  dissolveGroup(gid) {
    for (const [k, v] of Object.entries(this.groups.prompts)) if (v.groupId === gid) delete this.groups.prompts[k];
    this.groups.groups = this.groups.groups.filter((g) => g.id !== gid);
  }
  /** 只改分组标记，不覆盖内部独立选择；旧版 restoreOn 不再参与联动。 */
  setGroupEnabled(gid, on) {
    const g = this.group(gid);
    if (!g) return;
    g.enabled = !!on;
    delete g.restoreOn;
  }
  /** 把分散成几段的分组收拢到第一段的位置 */
  gatherGroup(gid) {
    const ids = this.order.filter((o) => this.groupOf(o.identifier) === gid).map((o) => o.identifier);
    if (ids.length < 2) return;
    this.move(ids.slice(1), { after: ids[0] }, gid);
  }
  /** 整组上移/下移一个"块" */
  moveGroupBlock(gid, dir) {
    const blocks = this.blocks().filter((b) => !b.empty);
    const i = blocks.findIndex((b) => b.groupId === gid);
    if (i < 0) return;
    const ids = this.order.filter((o) => this.groupOf(o.identifier) === gid).map((o) => o.identifier);
    if (dir < 0) {
      const prev = blocks[i - 1];
      if (!prev) return;
      this.move(ids, { before: prev.ids[0] }, gid);
    } else {
      let j = i + 1;
      while (blocks[j] && blocks[j].groupId === gid) j++;
      const next = blocks[j];
      if (!next) return;
      this.move(ids, { after: next.ids[next.ids.length - 1] }, gid);
    }
  }
  moveStep(ids, dir) {
    const list = [...ids];
    const order = this.order;
    const positions = list.map(id => order.findIndex(o => o.identifier === id)).filter(i => i >= 0);
    const first = Math.min(...positions); const last = Math.max(...positions);
    if (dir < 0) {
      let k = first - 1;
      while (k >= 0 && list.includes(order[k].identifier)) k--;
      if (k < 0) return;
      this.move(list, { before: order[k].identifier });
    } else {
      let k = last + 1;
      while (k < order.length && list.includes(order[k].identifier)) k++;
      if (k >= order.length) return;
      this.move(list, { after: order[k].identifier });
    }
  }
  setEnabled(ids, on) {
    const set = new Set(ids);
    for (const o of this.order) if (set.has(o.identifier)) o.enabled = !!on;
  }
  /**
   * 1.7.5 双层分组：预设里同时存了柏宝箱分组和 entryGrouping，而 entryGrouping 里的分组与柏宝箱分组同名、成员也在其中，
   * 两个插件各显示一层，看起来像分组里又套了一层同名分组。返回这些重复的 entryGrouping 分组。
   */
  dupEntryGroups() {
    const eg = this.preset.extensions?.entryGrouping;
    if (!this.hadBaibai || !Array.isArray(eg) || !eg.length) return [];
    const ids = this.order.map((o) => o.identifier);
    const has = new Set(ids);
    const byName = new Map();
    for (const g of this.groups.groups) {
      const k = String(g.name || "").trim();
      const mem = new Set(ids.filter((x) => this.groupOf(x) === g.id));
      if (k) byName.set(k, byName.has(k) ? new Set([...byName.get(k), ...mem]) : mem);
    }
    const baiIds = new Set(this.groups.groups.map((g) => g.id));
    return eg.filter((g) => {
      if (!g) return false;
      // 和柏宝箱分组同 id 的是旧版本镜像出来的副本（成员可能是旧的），保存时本来就会去掉
      if (g.id && baiIds.has(g.id)) return true;
      const set = byName.get(String(g.name || "").trim());
      if (!set) return false;
      let mem;
      if (Array.isArray(g.memberIdentifiers)) mem = g.memberIdentifiers;
      else {
        const a = ids.indexOf(g.startIdentifier), b = ids.indexOf(g.endIdentifier);
        mem = a >= 0 && b >= a ? ids.slice(a, b + 1) : [];
      }
      // 成员必须完全相同才算重复；成员只是其中一部分的，是另一个分组，不能删
      const live = new Set(mem.filter((x) => has.has(x)));
      return live.size > 0 && live.size === set.size && [...live].every((x) => set.has(x));
    });
  }
  /** 插入新条目（缝合用） */
  insertPrompts(items, where, groupId) {
    const ids = [];
    for (const it of items) {
      let id = it.prompt.identifier;
      if (!id || this.prompt(id)) id = uid();
      const prompt = { ...it.prompt, identifier: id };
      this.preset.prompts.push(prompt);
      this.order.push({ identifier: id, enabled: it.enabled !== false });
      ids.push(id);
    }
    this.move(ids, where, groupId);
    return ids;
  }
  deletePrompts(ids) {
    const before = this._anchorsBefore(ids);
    const set = new Set(ids);
    findOrderList(this.preset).order = this.order.filter((o) => !set.has(o.identifier));
    for (const po of this.preset.prompt_order) po.order = (po.order || []).filter((o) => !set.has(o.identifier));
    this.preset.prompts = this.preset.prompts.filter((p) => !set.has(p.identifier));
    for (const id of ids) delete this.groups.prompts[id];
    this._anchorEmptied(before);
  }
  // ---------- 写回 ----------
  /** 生成要保存的完整预设对象 */
  toPreset() {
    const out = clone(this.preset);
    const ext = out.extensions;
    const order = findOrderList(out).order;
    const firstIdx = /* @__PURE__ */ new Map();
    order.forEach((o, i) => {
      const g = this.groups.prompts[o.identifier]?.groupId;
      if (g && !firstIdx.has(g)) firstIdx.set(g, i);
    });
    const groups = clone(this.groups);
    const pos0 = new Map(order.map((o, i) => [o.identifier, i]));
    for (const g of groups.groups) {
      if (firstIdx.has(g.id)) delete g.anchor;
      else if (g.anchor !== void 0) firstIdx.set(g.id, g.anchor === "" ? -0.5 : (pos0.get(g.anchor) ?? 1e9) + 0.5);
    }
    groups.groups.sort((a, b) => (firstIdx.get(a.id) ?? 1e9) - (firstIdx.get(b.id) ?? 1e9));
    groups.groups.forEach((g, i) => {
      g.order = i;
    });
    const inOrder = new Set(order.map((o) => o.identifier));
    for (const k of Object.keys(groups.prompts)) if (!inOrder.has(k)) delete groups.prompts[k];
    const hasGroups = groups.groups.length > 0;
    // 1.1.3：分组按"读进来时的格式"写回，只写一种。
    // 旧版本会把柏宝箱分组再镜像一份到 entryGrouping，两个插件同时显示时，
    // 柏宝箱分组里就会再套一层同名分组；用户解除后，下次保存又被写回来。
    const useEntryGrouping = this.hadEntryGrouping && !this.hadBaibai;
    if (useEntryGrouping) {
      const pos = new Map(order.map((o, i) => [o.identifier, i]));
      const list = [];
      for (const g of groups.groups) {
        const mem = order.filter((o) => groups.prompts[o.identifier]?.groupId === g.id).map((o) => o.identifier);
        if (!mem.length) continue;
        const contiguous = pos.get(mem[mem.length - 1]) - pos.get(mem[0]) === mem.length - 1;
        list.push(contiguous
          ? { id: g.id, name: g.name, enabled: g.enabled !== false, mode: "inclusive", startIdentifier: mem[0], endIdentifier: mem[mem.length - 1] }
          : { id: g.id, name: g.name, enabled: g.enabled !== false, memberIdentifiers: mem, mode: "inclusive" });
      }
      ext.entryGrouping = list;
    } else {
      if (hasGroups || this.hadBaibai) {
        if (!ext.baibaiToolkit || typeof ext.baibaiToolkit !== "object") ext.baibaiToolkit = {};
        ext.baibaiToolkit.presetPromptGroups = groups;
      }
      if (Array.isArray(ext.entryGrouping) && !this.keepEntryGrouping) {
        // 去掉和柏宝箱分组同 id 的镜像、同名且成员相同的重复分组（1.7.5），以及成员已经不存在的旧分组；别的插件自己建的分组保留
        const dupKeys = new Set(this.dupEntryGroups().map((g) => `${g.id}|${g.name}`));
        ext.entryGrouping = ext.entryGrouping.filter((g) => !g || !dupKeys.has(`${g.id}|${g.name}`));
        const mirror = new Set([...(this.loadedGroupIds || []), ...groups.groups.map((g) => g.id)]);
        const live = new Set(order.map((o) => o.identifier));
        ext.entryGrouping = ext.entryGrouping.filter((g) => g && !mirror.has(g.id) && (Array.isArray(g.memberIdentifiers)
          ? g.memberIdentifiers.some((id) => live.has(id))
          : live.has(g.startIdentifier) && live.has(g.endIdentifier)));
        if (!ext.entryGrouping.length) delete ext.entryGrouping;
      }
    }
    return out;
  }
};

