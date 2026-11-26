// 2.12.8 直接导入预设、世界书、正则文件，不用去酒馆原来的位置导入。入口在条目页右上角「⋯」，世界书页、正则页的「＋」。
var IMPORT_LABEL = { preset: "预设", world: "世界书", regex: "正则" };
// 2.12.17 按文件内容认是哪种：有提示词条目的是预设，有 entries（含角色卡内嵌的 character_book）的是世界书，有 findRegex 的是正则。
// 只有正则、没有提示词条目的预设文件按正则处理（和缝合页读文件一致）
function importKindOf(data) {
  if (Array.isArray(data?.prompts) && (data.prompts.length || !data.extensions?.regex_scripts?.length)) return "preset";
  const book = data?.entries ?? data?.character_book?.entries ?? data?.data?.character_book?.entries;
  if (book && typeof book === "object") return "world";
  try { regexScriptsOf(data); return "regex"; } catch {}
  return null;
}
// 读一个导入的文件：kind 省略时按内容认
async function importFile(file, kind = null) {
  const name = file.name.replace(/\.(json|txt)$/i, "").trim();
  let data;
  try { data = JSON.parse((await file.text()).replace(/^\uFEFF/, "")); } catch { return toast("导入失败：文件不是 JSON", "error"); }
  const k = kind || importKindOf(data);
  if (!k) return toast("导入失败：认不出是哪种文件。支持聊天补全预设、世界书（含角色卡）、正则", "error");
  try {
    if (k === "preset") await importPreset(name || "预设", data);
    else if (k === "world") await importWorldFile(name || "世界书", data);
    else await importRegexFile(name || "正则", data);
  } catch (err) {
    toast(`导入${IMPORT_LABEL[k]}失败：${err.message}`, "error");
  }
}
// 弹窗里一个选文件的按钮（label 包着 file input）：iPad、iPhone 的浏览器只认手指直接点到的选文件
async function importSheet() {
  const body = el(`<div class="pa-pick pa-import"><label class="pa-pick-item pa-file" role="button" tabindex="0"><span class="pa-pick-label">选择文件</span><small>预设、世界书（含角色卡）、正则，自动识别</small><input type="file" accept=".json,application/json,text/plain" data-imp="auto" hidden></label></div>`);
  let got = null;
  await sheet({ title: "导入", body, place: "center", actions: [{ label: "取消", value: null }], onMount: (w) => {
    body.addEventListener("change", (e) => {
      const inp = e.target.closest("input[type=file]");
      if (!inp?.files?.[0]) return;
      got = inp.files[0];
      w._close(null);
    });
  } });
  if (got) await importFile(got);
}
// 2.12.17 页面上的「＋」：几个选项，最后一项「导入…文件」本身是选文件的按钮。返回 { value } 或 { file }，取消返回 null
async function addMenu(title, items, fileLabel, anchor = null) {
  const body = el(`<div class="pa-pick pa-import">${items.map((it, i) => { const L = menuIcon(it.label); return `<button type="button" class="pa-pick-item${L.icon ? " pa-has-mi" : ""}" data-v="${i}"><span class="pa-pick-label">${esc(L.text)}</span>${it.sub ? `<small>${esc(it.sub)}</small>` : ""}${L.icon}</button>`; }).join("")}<label class="pa-pick-item pa-file" role="button" tabindex="0"><span class="pa-pick-label">${esc(fileLabel)}</span><input type="file" accept=".json,application/json,text/plain" hidden></label></div>`);
  let got = null;
  await sheet({ title, body, place: anchor ? "pop" : "center", anchor, actions: anchor ? [] : [{ label: "取消", value: null }], onMount: (w) => {
    body.addEventListener("click", (e) => {
      const b = e.target.closest("[data-v]");
      if (!b) return;
      got = { value: items[Number(b.dataset.v)].value };
      w._close(null);
    });
    body.addEventListener("change", (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      got = { file: f };
      w._close(null);
    });
  } });
  return got;
}
// 同名时：覆盖、另存为新名字、取消
function freeName(name, taken) {
  const low = new Set(taken.map((n) => n.toLowerCase()));
  for (let i = 2; ; i++) if (!low.has(`${name} (${i})`.toLowerCase())) return `${name} (${i})`;
}
async function askSameName(kind, name, taken) {
  if (!taken.some((n) => n.toLowerCase() === name.toLowerCase())) return { name, overwrite: false };
  const other = freeName(name, taken);
  const v = await pickBox(`已有叫「${name}」的${kind}`, [
    { label: `另存为「${other}」`, value: "new" },
    { label: `覆盖「${name}」`, sub: "先备份", value: "over", danger: true }
  ], { anchor: null });
  if (v === "new") return { name: other, overwrite: false };
  if (v === "over") return { name: taken.find((n) => n.toLowerCase() === name.toLowerCase()), overwrite: true };
  return null;
}
async function importPreset(name, data) {
  if (!data || typeof data !== "object" || !Array.isArray(data.prompts)) throw new Error("不是聊天补全预设（文件里没有 prompts）");
  const pick = await askSameName("预设", name, listPresets());
  if (!pick) return;
  if (pick.overwrite) {
    // 当作一次修改：先备份、自动保存，页头可撤销
    const d = getDraft(pick.name);
    mutate(d, "导入覆盖", (x) => x.replaceWith(structuredClone(data)));
    setFocusPreset(pick.name);
    return toast(`已覆盖预设「${pick.name}」，可撤销`, "success");
  }
  const real = await restorePresetFile(pick.name, structuredClone(data));
  if (listPresets().includes(real)) setFocusPreset(real);
  toast(`已导入预设「${real}」，${data.prompts.length} 个条目`, "success");
}
// 世界书：酒馆导出的照原样存；角色卡里的（keys、enabled、insertion_order）先换成酒馆的写法，没有的字段用默认值
var WI_ENTRY_DEFAULTS = { key: [], keysecondary: [], comment: "", content: "", constant: false, vectorized: false, selective: true, selectiveLogic: 0, addMemo: true, order: 100, position: 0, disable: false, excludeRecursion: false, preventRecursion: false, delayUntilRecursion: false, probability: 100, useProbability: true, depth: 4, group: "", groupOverride: false, groupWeight: 100, scanDepth: null, caseSensitive: null, matchWholeWords: null, useGroupScoring: null, automationId: "", role: null, sticky: 0, cooldown: 0, delay: 0 };
function worldBookFromFile(data) {
  const raw = data?.entries ?? data?.character_book?.entries ?? data?.data?.character_book?.entries;
  if (!raw || typeof raw !== "object") throw new Error("不是世界书（文件里没有 entries）");
  const list = Object.values(raw);
  if (list.length && list.every((e) => e && typeof e === "object" && Array.isArray(e.key)) && !Array.isArray(raw)) return { entries: structuredClone(raw) };
  const entries = {};
  list.map(worldEntryOf).filter(Boolean).forEach((e, i) => {
    const uid = Number.isFinite(Number(e.uid)) && !(e.uid in entries) ? Number(e.uid) : i;
    entries[uid] = { ...WI_ENTRY_DEFAULTS, ...e, uid, displayIndex: i };
  });
  if (!Object.keys(entries).length) throw new Error("文件里没有能用的世界书条目");
  return { entries };
}
async function importWorldFile(name, data) {
  const wi = mods.wi;
  if (typeof wi?.saveWorldInfo !== "function") throw new Error("酒馆版本较旧，不能在这里导入世界书");
  const book = worldBookFromFile(data);
  const pick = await askSameName("世界书", name.replace(/[\\/:*?"<>|]/g, "_"), listWorldbooks());
  if (!pick) return;
  if (pick.overwrite) {
    try {
      const old = await wi.loadWorldInfo(pick.name);
      if (old) await backupPut(`世界书：${pick.name}`, structuredClone(old), "导入覆盖前");
    } catch (e) {
      throw new Error("覆盖前备份失败，没有覆盖：" + (e?.message || e));
    }
  }
  await wi.saveWorldInfo(pick.name, book, true);
  if (typeof wi.updateWorldInfoList === "function") await wi.updateWorldInfoList();
  else if (Array.isArray(wi.world_names) && !wi.world_names.includes(pick.name)) wi.world_names.push(pick.name);
  toast(`已导入世界书「${pick.name}」，${Object.keys(book.entries).length} 条`, "success");
  pages.books?.afterImport?.(pick.name);
  return pick.name;
}
// 正则：导到全局，或导进当前预设（走「缝合正则」的窗口，重名、重复、分组都在那里处理）
function regexScriptsOf(data) {
  const ok = (x) => !!x && typeof x === "object" && typeof x.findRegex === "string";
  const list = ok(data) ? [data] : Array.isArray(data) ? data : Array.isArray(data?.regex_scripts) ? data.regex_scripts : Array.isArray(data?.extensions?.regex_scripts) ? data.extensions.regex_scripts : [];
  const scripts = list.filter(ok);
  if (!scripts.length) throw new Error("文件里没有正则");
  return scripts;
}
async function importRegexFile(name, data) {
  const scripts = regexScriptsOf(data);
  const target = focusPreset();
  const where = await pickBox(`${scripts.length} 条正则导入到哪里`, [
    { label: "全局", sub: "所有角色、预设", value: "global" },
    ...target ? [{ label: `预设「${target}」`, sub: "只随这个预设", value: "preset" }] : []
  ], { anchor: null });
  if (!where) return;
  if (where === "preset") {
    const src = new Draft(name, { prompts: [], extensions: { regex_scripts: structuredClone(scripts) } });
    return presetRegexDialog(src, getDraft(target), { preselect: scripts.map((_, i) => i) });
  }
  const all = ctx().extensionSettings;
  if (!Array.isArray(all.regex)) all.regex = [];
  const have = new Set(all.regex.map(presetRegexIdentity));
  const ids = new Set(all.regex.map((r) => r?.id).filter(Boolean));
  let added = 0, same = 0;
  for (const s of scripts) {
    const rule = { scriptName: name, replaceString: "", trimStrings: [], placement: [2], disabled: false, markdownOnly: false, promptOnly: false, runOnEdit: true, substituteRegex: 0, minDepth: null, maxDepth: null, ...structuredClone(s) };
    if (have.has(presetRegexIdentity(rule))) { same++; continue; }
    if (!rule.id || ids.has(rule.id)) rule.id = presetRegexNewId(ids);
    ids.add(rule.id);
    have.add(presetRegexIdentity(rule));
    all.regex.push(rule);
    noteRegexDisplay(rule);
    added++;
  }
  ctx().saveSettingsDebounced();
  toast(added ? `已导入 ${added} 条正则到全局${same ? `，跳过 ${same} 条重复` : ""}` : "全局已有这些正则", added ? "success" : "info");
}
