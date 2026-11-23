// 2.12.6 token 数。用酒馆的分词器（跟着当前 API 和模型，和酒馆「总 Token 数量」同一个）数条目正文，不展开宏。
// 按「分词器 + 正文」记在本浏览器，数过的不再数，换聊天、重开也不用重数；没数过的排队，同时最多 4 个，
// 数完一批（约 0.15 秒）通知一次，页面就地改数字，不重画列表。
var TK_KEY = "mcdonalds:tk";
var TK_PER_MODEL = 4000;
var TK_MODELS = 3;
var TK_PARALLEL = 4;
var tkS = { model: null, fn: null, mem: new Map(), queue: [], queued: new Set(), failed: new Set(), running: 0, subs: new Set(), notifyT: 0, saveT: 0, disk: null };
// 分词器的标识：API 类型 + 酒馆选的分词模型（或当前模型），换模型后重新数
function tkModelKey(c) {
  let m = "";
  try { m = String(c.getTokenizerModel?.() || ""); } catch {}
  if (!m) {
    try { m = String(c.getChatCompletionModel?.() || ""); } catch {}
  }
  const oai = mods.openai?.oai_settings;
  return [c.mainApi || "", oai?.chat_completion_source || "", m, c.powerUserSettings?.tokenizer ?? ""].join("|");
}
// 每次画列表前调用一次：取分词器，模型变了就清掉内存里的数
function tkSync() {
  let c = null;
  try { c = ctx(); } catch {}
  tkS.fn = typeof c?.getTokenCountAsync === "function" ? (t) => c.getTokenCountAsync(t) : null;
  if (!tkS.fn) return false;
  const key = tkModelKey(c);
  if (key !== tkS.model) {
    tkS.model = key;
    tkS.mem = new Map();
    tkS.queue = [];
    tkS.queued.clear();
    tkS.failed.clear();
  }
  return true;
}
function tkDisk() {
  if (!tkS.disk) {
    try { tkS.disk = JSON.parse(localStorage.getItem(TK_KEY) || "{}"); } catch { tkS.disk = {}; }
    if (!tkS.disk || typeof tkS.disk !== "object" || Array.isArray(tkS.disk)) tkS.disk = {};
  }
  return tkS.disk;
}
function tkDiskPut(model, h, n) {
  const all = tkDisk();
  const box = all[model] && typeof all[model] === "object" ? all[model] : {};
  delete all[model];
  box[h] = n;
  const keys = Object.keys(box);
  for (const k of keys.slice(0, Math.max(0, keys.length - TK_PER_MODEL))) delete box[k];
  all[model] = box;
  // 最近用的模型排在最后；只留最近几个
  for (const k of Object.keys(all).slice(0, Math.max(0, Object.keys(all).length - TK_MODELS))) delete all[k];
  clearTimeout(tkS.saveT);
  tkS.saveT = setTimeout(() => {
    try { localStorage.setItem(TK_KEY, JSON.stringify(tkS.disk)); } catch {}
  }, 800);
}
/** 一段正文的 token 数：数过的直接给；没数过的排队，先返回 undefined；数失败返回 NaN。空正文是 0 */
function tkGet(text) {
  const t = String(text ?? "");
  if (!t.trim()) return 0;
  const hit = tkS.mem.get(t);
  if (hit !== void 0) return hit;
  if (tkS.failed.has(t)) return NaN;
  const n = tkDisk()[tkS.model]?.[hashStr(t)];
  if (typeof n === "number") {
    tkS.mem.set(t, n);
    return n;
  }
  if (!tkS.queued.has(t)) {
    tkS.queued.add(t);
    tkS.queue.push(t);
    queueMicrotask(tkPump);
  }
  return void 0;
}
function tkPump() {
  while (tkS.fn && tkS.running < TK_PARALLEL && tkS.queue.length) {
    const t = tkS.queue.shift(), model = tkS.model, fn = tkS.fn;
    tkS.running++;
    Promise.resolve().then(() => fn(t)).then((v) => {
      const n = Math.round(Number(v));
      if (!Number.isFinite(n) || n < 0) throw new Error("分词器返回的不是数字");
      if (model !== tkS.model) return;
      tkS.mem.set(t, n);
      tkDiskPut(model, hashStr(t), n);
    }).catch((e) => {
      if (model === tkS.model) tkS.failed.add(t);
      console.warn("[麦当劳] 数 token 失败", e);
    }).finally(() => {
      tkS.running--;
      tkS.queued.delete(t);
      tkNotify();
      tkPump();
    });
  }
}
function tkNotify() {
  if (tkS.notifyT) return;
  tkS.notifyT = setTimeout(() => {
    tkS.notifyT = 0;
    for (const f of tkS.subs) {
      try { f(); } catch (e) { console.warn("[麦当劳] 刷新 token 数失败", e); }
    }
  }, 150);
}
function tkSubscribe(f) {
  tkS.subs.add(f);
  return () => tkS.subs.delete(f);
}
/** 还在排队、正在数的条数 */
function tkPending() {
  return tkS.queued.size;
}
/** 数字的写法：千位加逗号；没数完是空，数失败是「—」 */
var TK_NF = new Intl.NumberFormat("zh-CN");
function tkFmt(n) {
  if (n === void 0) return "";
  if (Number.isNaN(n)) return "—";
  return TK_NF.format(n);
}
// 2.12.8 页签行右侧：一个按钮「● 共 N tk」。圆点和保存状态那颗一样：关时空心，开（每条显示 token 数）时实心绿点，
// 还在数时呼吸
const tkEach = () => settings().tkEach === true;
/** 画页签行右侧：label 是合计那句（undefined＝不显示），title 是说明 */
function tkPaintBar(label, title = "") {
  const bar = rootEl?.querySelector(".pa-tkbar");
  if (!bar) return;
  bar.hidden = label === void 0 || !tkS.fn;
  if (bar.hidden) return;
  const t = bar.querySelector("[data-tktotal]"), on = tkEach(), busy = /…/.test(label);
  if (t.textContent !== label) t.textContent = label;
  bar.setAttribute("aria-pressed", String(on));
  bar.setAttribute("aria-busy", String(busy));
  bar.classList.toggle("pa-tk-busy", busy);
  bar.setAttribute("aria-label", `${label}，每条显示 token 数`);
  bar.title = `${title}。点按${on ? "收起" : "显示"}每条的 token 数`;
}
/** 一条条目的 token 数（系统位置条目由酒馆填正文，不数，返回 null） */
function tkOfEntry(d, id) {
  if (d.isMarker(id)) return null;
  return tkGet(d.prompt(id)?.content);
}
/** 几条条目的合计（on 筛选算哪些）；有没数完的返回 undefined，数失败的不计 */
function tkSumOf(d, ids, on) {
  let sum = 0;
  for (const id of ids) {
    if (on && !on(id)) continue;
    const n = tkOfEntry(d, id);
    if (n === void 0) return void 0;
    if (n !== null && !Number.isNaN(n)) sum += n;
  }
  return sum;
}
/** 几段正文的合计（世界书用）；有没数完的返回 undefined */
function tkSumTexts(texts) {
  let sum = 0;
  for (const t of texts) {
    const n = tkGet(t);
    if (n === void 0) return void 0;
    if (!Number.isNaN(n)) sum += n;
  }
  return sum;
}
/** 预设里生效的条目（自己开着、所在分组没被挡住）合计；没数完时 sum 为 undefined */
function tkPresetTotal(d) {
  return d.withReadIndex(() => tkSumOf(d, d.order.map((o) => o.identifier), (id) => d.isActive(id)));
}
