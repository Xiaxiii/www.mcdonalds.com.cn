// 变量修复与按变量名排序的判断逻辑（不碰界面）。
// 「修复变量问题」：写进变量却没人读的内容，补一个读取条目；缝合留下的多余外层包裹，整理掉。

// 值里只有简单宏（{{char}}、{{random}}、{{getvar}} 这类），没有嵌套和条件
function simpleValueMacros(text) {
  const input = String(text || "");
  const tops = scanTopMacros(input);
  const allowed = ["char", "user", "random", "pick", "newline", "trim", "noop", "getvar", "getglobalvar", "//"];
  for (const t of tops) {
    const head = t.inner.split("::")[0].trim().toLowerCase();
    if (t.inner.includes("{{") || !allowed.includes(head)) return false;
  }
  let rest = input;
  for (const t of [...tops].reverse()) rest = rest.slice(0, t.start) + rest.slice(t.end);
  return !rest.includes("{{") && !rest.includes("}}");
}

// 正文里的宏都是变量宏，且值只含简单宏
function safeInterpolatedVariableText(text) {
  return scanTopMacros(text).every((t) => {
    const v = parseVarMacro(t.inner);
    return v && !/[{}]/.test(v.name) && (!v.value || simpleValueMacros(v.value));
  });
}

// 整条正文只是 {{setvar::外层::{{setvar|addvar::内层::…}}}} 这种两层包裹
function redundantVariableWrapper(content) {
  const text = String(content || "");
  const tops = scanTopMacros(text);
  if (tops.length !== 1 || text.slice(0, tops[0].start).trim() || text.slice(tops[0].end).trim()) return null;
  const outer = parseVarMacro(tops[0].inner);
  if (!outer || outer.op !== "set" || !outer.value || /[{}]/.test(outer.name)) return null;
  const inside = scanTopMacros(outer.value);
  if (inside.length !== 1 || outer.value.slice(0, inside[0].start).trim() || outer.value.slice(inside[0].end).trim()) return null;
  const inner = parseVarMacro(inside[0].inner);
  if (!inner || !["set", "add"].includes(inner.op) || !inner.value || /[{}]/.test(inner.name) || !simpleValueMacros(inner.value)) return null;
  return { outer, inner, content: outer.value.trim() };
}

// 只整理缝合进来、外层变量没人读取、没有特殊触发的条目
function wrapperPlan(d, id) {
  const p = d.prompt(id);
  const wrap = redundantVariableWrapper(p?.content);
  if (!wrap) return null;
  if (!d.preset.extensions.wi_preset_suture_origins?.[id] && !/\[来自.+\]/.test(p.name || "")) return null;
  if (p.injection_position === 1 || p.injection_trigger?.length) return null;
  const referenced = d.preset.prompts.some((other) => listVarMacros(other.content).some((m) => m.op === "get" && m.name === wrap.outer.name && m.scope === wrap.outer.scope));
  if (referenced) return null;
  return { id, ...wrap };
}

function applyWrapperNormalization(d) {
  const plans = d.order.filter((o) => d.isActive(o.identifier)).map((o) => wrapperPlan(d, o.identifier)).filter(Boolean);
  for (const plan of plans) {
    const p = d.prompt(plan.id);
    if (!d.preset.extensions.presetAtelierEntryLabels) d.preset.extensions.presetAtelierEntryLabels = {};
    d.preset.extensions.presetAtelierEntryLabels[plan.id] = plan.outer.name;
    p.content = plan.content;
  }
  return plans;
}

// 给一个「写了没人读」的变量出修复方案：在最后一个写入它的开启条目后面加一条读取。
// 有任何需要人判断的情况（按深度插入、条件、脚本、复杂嵌套、计数）都不自动改，抛出原因。
function variableRepairPlan(d, key, manual = d.cotManual || {}) {
  const scope = key.startsWith("全局:") ? "global" : "local";
  const name = scope === "global" ? key.slice(3) : key;
  if (!name.trim() || /[{}]/.test(name)) throw new Error("变量名为空或包含动态宏，需人工核对，未添加通用读取");
  const same = (m) => m.name === name && m.scope === scope;
  const WRITE = ["set", "add", "inc", "dec"];
  const touches = d.order
    .filter((o) => d.isActive(o.identifier))
    .filter((o) => listVarMacros(d.prompt(o.identifier)?.content).some((m) => same(m) && WRITE.includes(m.op)));
  if (!touches.length) throw new Error("没有开启的条目写入该变量");
  if (/cot$/i.test(name)) throw new Error("该变量保存的是思维链片段，要由思维链读取，不能当普通内容输出。请在「可能未被读取的内容」里点这一条的「加入思维链读取」");
  const checker = d.order.find((o) => d.isActive(o.identifier) && listVarMacros(d.prompt(o.identifier)?.content).some((m) => same(m) && m.op === "has"));
  if (checker) throw new Error(`「${d.prompt(checker.identifier)?.name || checker.identifier}」用 hasvar 判断该变量是否存在，它更像内部开关，不需要把值输出给模型，未添加通用读取`);
  for (const o of touches) {
    const p = d.prompt(o.identifier);
    const nm = p.name || o.identifier;
    if (isCotEntry(d, o.identifier, manual)) throw new Error(`「${nm}」被识别为思维链条目，它写的变量要由思维链读取。请在「可能未被读取的内容」里点这一条的「加入思维链读取」`);
    if (listVarMacros(p.content).some((m) => same(m) && (m.op === "inc" || m.op === "dec"))) {
      throw new Error(`「${nm}」对该变量执行计数，需人工核对，未添加通用读取`);
    }
    if (p.injection_position === 1) throw new Error(`「${nm}」按深度插入聊天记录，执行顺序需人工核对`);
    if (p.injection_trigger?.length) throw new Error(`「${nm}」设有触发条件，触发时机需人工核对`);
    if (/\{\{(?:if|else|while|run|eval)|<%/i.test(p.content || "")) throw new Error(`「${nm}」含条件或脚本，需人工核对`);
    if (/\{\{[^{}]*\{\{/i.test(p.content || "") && !safeInterpolatedVariableText(p.content)) {
      if (wrapperPlan(d, o.identifier)) throw new Error("存在未被读取的外层变量包裹。请先点顶部「修复」整理包裹");
      throw new Error(`「${nm}」嵌套复杂，或外层变量被其他条目读取，未自动修改`);
    }
  }
  const last = touches[touches.length - 1].identifier;
  const finalWrites = listVarMacros(d.prompt(last)?.content).filter((m) => same(m) && WRITE.includes(m.op));
  const lastWrite = finalWrites.at(-1);
  if (lastWrite?.op === "set" && isBlankValue(lastWrite.value)) {
    throw new Error("最后一次写入是清空，需先核对写入顺序");
  }
  const readers = d.order.filter((o) => d.isActive(o.identifier) && listVarMacros(d.prompt(o.identifier)?.content).some((m) => same(m) && m.op === "get"));
  if (readers.length) throw new Error("已有开启的条目读取该变量，请核对其位置和条件");
  return { last, macro: `{{${macroName("get", scope)}::${name}}}`, name, key };
}

// ---- 思维链片段：在思维链条目里加一句 {{getvar::片段}}
// 默认放进读取其他片段变量最多的思维链，紧跟最后一个片段读取；没有片段读取时放在 </thinking> 之前，再不行放到末尾。
function cotReadChoices(d, manual = d.cotManual || {}) {
  const a = analyze(d, manual);
  // 与思维链开头（<ECoT>、<thinking> 那一条）同组的条目才是思维链主体；名字带 CoT 的格式条目不算
  const openerGroups = new Set(a.openers.map((id) => d.groupOf(id) || id));
  return a.cotIds.map((id, index) => {
    const p = d.prompt(id), content = String(p?.content || "");
    const main = openerGroups.has(d.groupOf(id) || id);
    const frag = listVarMacros(content).filter((m) => m.op === "get" && /cot$/i.test(m.name)).length;
    // 有分步标题、够长、不是 assistant 预填的，才像思维链正文；「卡CoT」这类几行的预填排后面
    const body = p?.role !== "assistant" && content.trim().length >= 80 && /^[ \t]*#{1,4}\s*\S/m.test(content);
    return { id, index, frag, main, body, closes: /^[ \t]*<\/\s*(?:thinking|think|[\w-]*cot[\w-]*)\s*>[ \t]*$/im.test(content) };
  }).sort((x, y) => y.frag - x.frag || Number(y.main) - Number(x.main) || Number(y.body) - Number(x.body) || Number(y.closes) - Number(x.closes) || y.index - x.index);
}
function cotReadLine(content) {
  const lines = String(content || "").split("\n");
  let after = -1;
  lines.forEach((line, i) => { if (/\{\{\s*get(?:global)?var(?:::|\s)[^{}]*cot\s*\}\}/i.test(line)) after = i; });
  if (after >= 0) return after + 1;
  const close = lines.findIndex((line) => /^[ \t]*<\/\s*(?:thinking|think|[\w-]*cot[\w-]*)\s*>[ \t]*$/i.test(line));
  if (close >= 0) return close;
  // 没有结束标签时放在最后一个分步标题（通常是「输出格式」）之前
  let heading = -1;
  lines.forEach((line, i) => { if (/^[ \t]*#{1,2}\s*\S/.test(line)) heading = i; });
  return heading >= 0 ? heading : lines.length;
}
function cotReadPlan(d, key, cotId, line, manual = d.cotManual || {}) {
  const scope = key.startsWith("全局:") ? "global" : "local";
  const name = scope === "global" ? key.slice(3) : key;
  if (!name.trim() || /[{}]/.test(name)) throw new Error("变量名为空或包含动态宏，需人工核对");
  const choices = cotReadChoices(d, manual);
  if (!choices.length) throw new Error("没有识别到开启的思维链。请先在下方「手动指定思维链」");
  const id = cotId && choices.some((c) => c.id === cotId) ? cotId : choices[0].id;
  const content = String(d.prompt(id)?.content || "");
  const lines = content.split("\n");
  const at = Number.isInteger(line) && line >= 0 && line <= lines.length ? line : cotReadLine(content);
  const macro = `{{${macroName("get", scope)}::${name}}}`;
  if (listVarMacros(content).some((m) => m.op === "get" && m.name === name && m.scope === scope)) throw new Error("这条思维链已经读取该变量");
  lines.splice(at, 0, macro);
  return { cotId: id, line: at, macro, name, key, content: lines.join("\n"), choices: choices.map((c) => c.id) };
}
// 写入方改用读取方的变量名（只差大小写或空格时）
function renameWritesPlan(d, from, to) {
  const scope = from.startsWith("全局:") ? "global" : "local";
  const a = scope === "global" ? from.slice(3) : from, b = to.startsWith("全局:") ? to.slice(3) : to;
  const pat = a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(\\{\\{\\s*(?:set|add|inc|dec)${scope === "global" ? "global" : ""}var\\s*::\\s*)${pat}(\\s*(?:::|\\}\\}))`, "g");
  const edits = [];
  for (const o of d.order) {
    const p = d.prompt(o.identifier);
    const text = String(p?.content || "");
    const next = text.replace(re, `$1${b}$2`);
    if (next !== text) edits.push({ id: o.identifier, content: next, count: (text.match(re) || []).length });
  }
  if (!edits.length) throw new Error("没有找到可改名的写入宏");
  return { from, to, edits };
}

// ---- 按变量名排序：文风1、文风2… 拆成「类别 + 编号」
function tagKey(d, id) {
  const shape = detectShape(d.prompt(id)?.content);
  const label = d.preset.extensions.presetAtelierEntryLabels?.[id] || shape.varName || (d.isMarker(id) ? "酒馆位置" : "无变量名");
  const m = /^(.*?)(\d+)$/.exec(label.trim());
  return { label, category: m ? m[1] : label, number: m ? Number(m[2]) : -1 };
}
function sortTagIds(d, ids, categories) {
  const rank = new Map(categories.map((x, i) => [x, i]));
  return ids
    .map((id, i) => ({ id, i, t: tagKey(d, id) }))
    .sort((a, b) => (rank.get(a.t.category) ?? 1e9) - (rank.get(b.t.category) ?? 1e9) || a.t.number - b.t.number || a.i - b.i)
    .map((x) => x.id);
}
