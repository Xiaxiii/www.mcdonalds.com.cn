function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return url || "";
  }
}
// 2.5.0 按系列分类：一个密钥里 Claude、Gemini、GPT 混在一起时按名字分段。认不出的归「其他」
var MODEL_FAMILIES = [
  ["Claude", /claude|opus|sonnet|haiku/],
  ["Gemini", /gemini|gemma|imagen|veo\d|nano.?banana/],
  ["GPT", /gpt|chatgpt|dall-?e|davinci|codex|sora|(^|[^a-z0-9])o[1-9](?![0-9])/],
  ["DeepSeek", /deepseek/],
  ["Grok", /grok/],
  ["Qwen", /qwen|qwq/],
  ["Kimi", /kimi|moonshot/],
  ["GLM", /glm|zhipu/],
  ["豆包", /doubao/],
  ["MiniMax", /minimax|abab/],
  ["Llama", /llama/],
  ["Mistral", /mistral|mixtral|codestral|magistral/]
];
var FAMILY_ORDER = [...MODEL_FAMILIES.map(([n]) => n), "其他"];
function modelFamily(m) {
  const full = String(m || "").toLowerCase();
  // 中转站常在前面加「[0.07/次][出图gemini3]」这样的标签，先看去掉标签后的模型名
  const bare = full.replace(/^(\s*[\[【(（][^\]】)）]*[\]】)）])+\s*/, "");
  const find = (t) => MODEL_FAMILIES.find(([, re]) => re.test(t))?.[0];
  return find(bare) || find(full) || "其他";
}
function familyGroups(models) {
  const map = new Map();
  for (const m of models) {
    const f = modelFamily(m);
    if (!map.has(f)) map.set(f, []);
    map.get(f).push(m);
  }
  return [...map].sort((a, b) => FAMILY_ORDER.indexOf(a[0]) - FAMILY_ORDER.indexOf(b[0])).map(([name, list]) => ({ name, list }));
}
// 2.5.7 密钥框仍用密码框（键盘不记、读屏不念）。有的扩展或主题按「密码框」改样式（方角、白底），盖过麦当劳的：
// 外观写在元素自己的 style 上并加 !important，任何样式表都盖不过；颜色取配色变量，毛玻璃配色另给边框和内阴影
const KEY_INPUT_STYLE = FIELD_STYLE;
// 分段标题（按分类、按分组共用）
const secHead = (id, label, n, open, sub = "") => `<button type="button" class="pa-ksec" data-fold="${esc(id)}" aria-expanded="${open}"><span class="pa-sgcaret">${open ? "▾" : "▸"}</span><b>${esc(label)}</b>${sub ? `<small>${esc(sub)}</small>` : ""}<span class="pa-ksec-n">${n}</span></button>`;
const viewSeg = (views) => views.length > 1 ? `<div class="pa-seg pa-seg-s pa-kview" role="tablist" aria-label="模型显示方式">${views.map(([v, label]) => `<button type="button" data-v="${v}" role="tab">${label}</button>`).join("")}</div>` : "";
// 排序把手：两列三行小圆点
const ICON_GRIP = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><g fill="currentColor"><circle cx="6" cy="3.5" r="1.1"/><circle cx="10" cy="3.5" r="1.1"/><circle cx="6" cy="8" r="1.1"/><circle cx="10" cy="8" r="1.1"/><circle cx="6" cy="12.5" r="1.1"/><circle cx="10" cy="12.5" r="1.1"/></g></svg>';
const CHECK_MARK = '<span class="pa-mcheck" aria-hidden="true">✓</span>';
// 1.4.0：模型选择框。系统下拉框在平板上又宽又长，改为带搜索的列表，高度限制在屏幕内
// 2.5.0：一个选择框管单密钥和多密钥站点。
// 「按模型」平铺；「按分类」自建分类在前，没分进去的按系列（Claude、Gemini…）自动分段；「按分组」（多密钥）一个分组一段。
// 自建分类记在站点上（site.modelCats），一个模型可以同时在几个分类里。点「多选」勾选模型，新建分类或加入已有分类。
// 多密钥站点每个模型后面标出哪些分组有它，点模型名用排在上面的分组，点标签换；超过 2 个收成「+N」。
async function modelPicker({ site = null, keys = null, list = [], cur = "", curKey = null, title = "选择模型" }) {
  const multi = Array.isArray(keys) && keys.length > 1;
  const kname = (k) => keyName(site, k);
  // 2.6.1 当前模型不在这个站点的列表里时不混进列表（换站点后上一个站点的模型）；列表为空时才列出当前模型
  const all = multi ? [...new Set(keys.flatMap((k) => k.models || []))] : [...new Set((list.length ? list : [cur]).filter(Boolean))];
  const allSet = new Set(all);
  const ownersOf = new Map(all.map((m) => [m, []]));
  if (multi) for (const k of keys) for (const m of new Set(k.models || [])) ownersOf.get(m).push(k);
  const fams = () => familyGroups(all.filter((m) => !cats().some((c) => c.models.includes(m))));
  const cats = () => site?.modelCats || [];
  const canCat = !!site || familyGroups(all).length > 1;
  const views = [["model", "按模型"], ...canCat ? [["cat", "按分类"]] : [], ...multi ? [["group", "按分组"]] : []];
  const saved = (site && (multi || site.modelView) ? site.modelView : settings().modelView) || "";
  let mode = { family: "cat", cat: "cat", group: "group" }[saved] || "model";
  if (!views.some(([v]) => v === mode)) mode = "model";
  // 默认展开：多密钥的第一个分组；当前模型所在的第一个分类，没有就是它的系列
  const firstCat = cats().find((c) => c.models.includes(cur));
  // 2.6.8 段落的展开、收起记住最后一次的状态（按站点存在设置 fold.mpick 里）；没动过的段落按默认：多密钥的第一个分组、当前模型所在的分类或系列
  const secDefault = new Set([multi ? keys[0].id : "", firstCat ? `c:${firstCat.id}` : `f:${modelFamily(cur || all[0])}`]);
  const secKey = (id) => `${site?.id || "live"}\u0001${id}`;
  const secOpen = {
    has: (id) => foldGet("mpick", secKey(id), secDefault.has(id)),
    set: (id, on) => foldSet("mpick", secKey(id), on, 300)
  };
  // 2.8.0 搜索时段落默认全部展开，也可逐段收起；换了搜索词重新全部展开，不改记住的展开状态
  const qClosed = new Set();
  let qLast = "";
  const isOpen = (id) => query() ? !qClosed.has(id) : secOpen.has(id);
  const more = new Set();
  // 多选：sel 是勾选的模型；editing 是正在编辑模型的分类
  let selecting = false;
  let editing = null;
  const sel = new Set();
  const body = el(`<div class="pa-mpick" style="${LIST_STYLE}">${viewSeg(views)}
      <div class="pa-mfind" style="${BOX_STYLE}"><input class="pa-input" style="${FIELD_STYLE}" type="text" inputmode="search" enterkeyhint="search" autocorrect="off" spellcheck="false" placeholder="搜索，或输入模型名称" autocapitalize="off" autocomplete="off">${site ? '<button type="button" class="pa-swpill pa-edit-pill pa-selbtn">多选</button>' : ""}</div>
      <div class="pa-mseltools" hidden><span class="pa-selcnt"></span><button type="button" class="pa-link pa-selall"></button><button type="button" class="pa-link pa-selnone">清空</button><span class="pa-selacts"></span>
        <div class="pa-newcat" hidden><input class="pa-input" placeholder="分类名，如 Gemini 逆向、0.07/次" maxlength="60" aria-label="新分类名"><button type="button" class="pa-swpill pa-edit-pill" data-act="newcancel">取消</button><button type="button" class="pa-swpill" data-act="newok">确定</button></div></div>
      ${!multi && cur && list.length && !allSet.has(cur) ? `<p class="pa-hint pa-mcur-miss">当前模型「${esc(cur)}」不在此站点的列表中</p>` : ""}
      <div class="pa-mpick-list" style="${LIST_STYLE}" role="listbox"></div></div>`);
  const input = body.querySelector("input");
  const box = body.querySelector(".pa-mpick-list");
  let picked = null;
  const query = () => input.value.trim();
  const hit = (m) => {
    const ql = query().toLowerCase();
    return !ql || m.toLowerCase().includes(ql);
  };
  const chip = (m, k) => {
    const on = m === cur && k.id === curKey;
    return `<button type="button" class="pa-kchip${on ? " on" : ""}" data-m="${esc(m)}" data-k="${esc(k.id)}" aria-pressed="${on}">${esc(kname(k))}</button>`;
  };
  const selRow = (m) => `<button type="button" class="pa-mpick-item pa-selrow${sel.has(m) ? " picked" : ""}" style="${ROW_STYLE}" data-sel="${esc(m)}" aria-label="${esc(m)}" aria-pressed="${sel.has(m)}"><span class="pa-mrow"><span class="pa-selbox" aria-hidden="true"></span>${modelLabel(m)}</span></button>`;
  const plainRow = (m, k = null) => {
    const on = m === cur && (!multi || k?.id === curKey);
    return `<button class="pa-mpick-item${on ? " on" : ""}" style="${ROW_STYLE}" data-m="${esc(m)}"${k ? ` data-k="${esc(k.id)}"` : ""} title="${esc(m)}" aria-label="${esc(m)}"${on ? ' aria-current="true"' : ""}><span class="pa-mrow">${modelLabel(m)}${on ? CHECK_MARK : ""}</span></button>`;
  };
  const keyRow = (m) => {
    const owners = ownersOf.get(m);
    const on = m === cur;
    let tail;
    if (owners.length <= 2) tail = owners.map((k) => chip(m, k)).join("");
    else if (more.has(m)) tail = owners.map((k) => chip(m, k)).join("") + `<button type="button" class="pa-kmore" data-more="${esc(m)}" aria-expanded="true" aria-label="收起分组">收起</button>`;
    else {
      const shown = owners.find((k) => on && k.id === curKey) || owners[0];
      tail = chip(m, shown) + `<button type="button" class="pa-kmore" data-more="${esc(m)}" aria-expanded="false" aria-label="还有 ${owners.length - 1} 个分组">+${owners.length - 1}</button>`;
    }
    return `<div class="pa-krow${on ? " on" : ""}"><button type="button" class="pa-kname" data-m="${esc(m)}" data-k="${esc(owners[0].id)}" title="${esc(m)}" aria-label="${esc(m)}"${on ? ' aria-current="true"' : ""}><span class="pa-mrow">${modelLabel(m)}${on ? CHECK_MARK : ""}</span></button>${tail}</div>`;
  };
  const row = (m) => selecting ? selRow(m) : multi ? keyRow(m) : plainRow(m);
  const custom = () => {
    const q = query();
    return !selecting && q && !allSet.has(q) ? `<button class="pa-mpick-item pa-mpick-custom" style="${ROW_STYLE}" data-m="${esc(q)}"${multi ? ` data-k="${esc(keys[0].id)}"` : ""}>使用「${esc(q)}」</button>` : "";
  };
  const none = '<p class="pa-hint">没有匹配的模型，可直接输入名称</p>';
  const paint = () => {
    body.querySelectorAll(".pa-kview button").forEach((b) => {
      b.classList.toggle("on", b.dataset.v === mode);
      b.setAttribute("aria-selected", b.dataset.v === mode);
    });
    box.classList.toggle("pa-kpick", multi || mode !== "model");
    const q = query();
    if (q !== qLast) {
      qClosed.clear();
      qLast = q;
    }
    if (mode === "model") {
      box.innerHTML = custom() + all.filter(hit).map(row).join("") || none;
    } else if (mode === "cat") {
      const tagAuto = cats().length > 0;
      let html = "";
      for (const c of cats()) {
        const present = c.models.filter((m) => allSet.has(m));
        const ms = present.filter(hit);
        if (q && !ms.length) continue;
        const id = `c:${c.id}`;
        const open = isOpen(id);
        html += `<div class="pa-ksec-wrap">${secHead(id, c.name, present.length, open)}<button type="button" class="pa-icon-btn pa-cat-more" data-catmenu="${esc(c.id)}" aria-label="分类「${esc(c.name)}」的操作">⋯</button></div>${open ? ms.map(row).join("") : ""}`;
      }
      for (const f of fams()) {
        const ms = f.list.filter(hit);
        if (q && !ms.length) continue;
        const id = `f:${f.name}`;
        const open = isOpen(id);
        html += secHead(id, f.name, f.list.length, open, tagAuto ? "自动" : "") + (open ? ms.map(row).join("") : "");
      }
      box.innerHTML = custom() + html || none;
    } else {
      box.innerHTML = keys.map((k) => {
        const ms = (k.models || []).filter(hit);
        const open = isOpen(k.id);
        const kc = !selecting && q && !(k.models || []).includes(q) ? `<button class="pa-mpick-item pa-mpick-custom" style="${ROW_STYLE}" data-m="${esc(q)}" data-k="${esc(k.id)}">使用「${esc(q)}」</button>` : "";
        const items = ms.map((m) => selecting ? selRow(m) : plainRow(m, k)).join("");
        const empty = !ms.length && !kc ? `<p class="pa-hint">${(k.models || []).length ? "没有匹配的模型" : "还没有模型列表，可在搜索框输入模型名称"}</p>` : "";
        return secHead(k.id, kname(k), (k.models || []).length, open, k.keyMask || "") + (open ? kc + items + empty : "");
      }).join("");
    }
    // 多选工具条：在搜索框下面，不用滑到底
    const bar = body.querySelector(".pa-mseltools");
    bar.hidden = !selecting;
    if (!selecting) bar.querySelector(".pa-newcat").hidden = true;
    const btn = body.querySelector(".pa-selbtn");
    if (btn) {
      btn.textContent = selecting ? "取消" : "多选";
      btn.classList.toggle("pa-edit-pill", !selecting);
    }
    if (selecting) {
      const n = all.filter(hit).length;
      bar.querySelector(".pa-selall").textContent = q ? `全选搜索结果（${n}）` : `全选（${n}）`;
      bar.querySelector(".pa-selnone").hidden = !sel.size;
      bar.querySelector(".pa-selcnt").textContent = editing ? `「${editing.name}」已选 ${sel.size}` : `已选 ${sel.size}`;
      bar.querySelector(".pa-selacts").innerHTML = editing
        ? '<button type="button" class="pa-swpill pa-edit-pill" data-act="cancel">取消</button><button type="button" class="pa-swpill" data-act="save">保存</button>'
        : `${cats().length ? '<button type="button" class="pa-swpill pa-edit-pill" data-act="addto">加入…</button>' : ""}<button type="button" class="pa-swpill" data-act="newcat">新建分类</button>`;
    }
  };
  const stopSelect = () => {
    selecting = false;
    editing = null;
    sel.clear();
  };
  const saveCats = () => {
    if (!site.modelCats) site.modelCats = [];
    saveSettings();
  };
  onSearchInput(input, () => paint(), all.length > 150 ? 120 : 0);
  paint();
  // 列表长时窗口固定高度，只滚列表，搜索框和工具条一直在上面
  await sheet({ title: `${title}（${all.length}）`, body, noFocus: true, cls: `pa-sheet-picker${all.length > 10 ? " pa-sheet-tall" : ""}`, actions: [], onMount: (w) => {
    body.querySelector(".pa-kview")?.addEventListener("click", (e) => {
      const b = e.target.closest("[data-v]");
      if (!b || b.dataset.v === mode) return;
      mode = b.dataset.v;
      if (site && (multi || site.modelView || site.modelCats?.length)) site.modelView = mode;
      else settings().modelView = mode;
      saveSettings();
      paint();
    });
    body.querySelector(".pa-selbtn")?.addEventListener("click", () => {
      if (selecting) stopSelect();
      else selecting = true;
      paint();
    });
    body.querySelector(".pa-selall").addEventListener("click", () => {
      all.filter(hit).forEach((m) => sel.add(m));
      paint();
    });
    // 清空：去掉全部勾选（只在搜索时，就只去掉搜索结果里的）
    body.querySelector(".pa-selnone").addEventListener("click", () => {
      if (query()) all.filter(hit).forEach((m) => sel.delete(m));
      else sel.clear();
      paint();
    });
    const newBox = body.querySelector(".pa-newcat");
    const newInput = newBox.querySelector("input");
    // 新建分类：名字就在工具条里填
    const makeCat = () => {
      const name = newInput.value.trim();
      if (!name) return newInput.focus();
      if (!site.modelCats) site.modelCats = [];
      const c = { id: uid(), name, models: all.filter((m) => sel.has(m)) };
      site.modelCats.push(c);
      saveCats();
      secOpen.set(`c:${c.id}`, true);
      toast(`已新建「${name}」，${c.models.length} 个模型`, "success");
      newInput.value = "";
      stopSelect();
      mode = "cat";
      input.value = "";
      paint();
    };
    newInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !imeEnter(e)) { e.preventDefault(); makeCat(); }
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); newBox.hidden = true; }
    });
    body.querySelector(".pa-mseltools").addEventListener("click", async (e) => {
      const act = e.target.closest("[data-act]")?.dataset.act;
      if (!act) return;
      if (act === "newok") return makeCat();
      if (act === "newcancel") {
        newBox.hidden = true;
        newInput.value = "";
        return;
      }
      if (act === "cancel") {
        stopSelect();
        return paint();
      }
      if (act === "save") {
        editing.models = [...editing.models.filter((m) => !allSet.has(m)), ...all.filter((m) => sel.has(m))];
        saveCats();
        toast(`「${editing.name}」已保存，${sel.size} 个模型`, "success");
        stopSelect();
        return paint();
      }
      if (!sel.size) return toast("先勾选模型", "info");
      if (act === "newcat") {
        newBox.hidden = false;
        newInput.focus();
        return;
      }
      if (act === "addto") {
        const id = await pickBox("加入哪个分类", cats().map((c) => ({ label: c.name, sub: `${c.models.filter((m) => allSet.has(m)).length} 个模型`, value: c.id })));
        const c = cats().find((x) => x.id === id);
        if (!c) return;
        const before = c.models.length;
        c.models = [...new Set([...c.models, ...all.filter((m) => sel.has(m))])];
        saveCats();
        secOpen.set(`c:${c.id}`, true);
        toast(`已加入「${c.name}」，新增 ${c.models.length - before} 个`, "success");
      }
      stopSelect();
      mode = "cat";
      input.value = "";
      paint();
    });
    box.addEventListener("click", async (e) => {
      const mo = e.target.closest("[data-more]");
      if (mo) {
        more.has(mo.dataset.more) ? more.delete(mo.dataset.more) : more.add(mo.dataset.more);
        return paint();
      }
      const cm = e.target.closest("[data-catmenu]");
      if (cm) {
        const c = cats().find((x) => x.id === cm.dataset.catmenu);
        if (!c) return;
        const a = await pickBox(`分类「${c.name}」`, [{ label: "编辑模型", sub: "勾选要留下的模型", value: "edit" }, { label: "改名", value: "rename" }, { label: "删除分类", sub: "模型不受影响", value: "del" }]);
        if (a === "edit") {
          selecting = true;
          editing = c;
          sel.clear();
          c.models.forEach((m) => allSet.has(m) && sel.add(m));
        } else if (a === "rename") {
          // 就在分类标题上改名
          const wrapEl = cm.closest(".pa-ksec-wrap");
          const name = wrapEl ? await inlineEdit(wrapEl, c.name) : await promptBox("分类改名", c.name);
          if (name) {
            c.name = name;
            saveCats();
          }
        } else if (a === "del") {
          if (!await confirmBox("删除分类", `删除「${c.name}」？里面的模型不受影响。`, "删除", true)) return;
          site.modelCats = cats().filter((x) => x !== c);
          saveCats();
        }
        return paint();
      }
      const f = e.target.closest("[data-fold]");
      if (f) {
        const id = f.dataset.fold;
        if (query()) qClosed.has(id) ? qClosed.delete(id) : qClosed.add(id);
        else secOpen.set(id, !secOpen.has(id));
        return paint();
      }
      const sr = e.target.closest("[data-sel]");
      if (sr) {
        sel.has(sr.dataset.sel) ? sel.delete(sr.dataset.sel) : sel.add(sr.dataset.sel);
        return paint();
      }
      const b = e.target.closest("[data-m]");
      if (!b) return;
      if (multi) {
        let k = b.dataset.k;
        // 点的是已选中的模型名，保留现在的分组
        if (b.classList.contains("pa-kname") && b.dataset.m === cur && (ownersOf.get(cur) || []).some((x) => x.id === curKey)) k = curKey;
        picked = { model: b.dataset.m, keyId: k };
      } else picked = b.dataset.m;
      w.querySelector(".pa-sheet-x").click();
    });
    scrollToView(box.querySelector(".pa-krow.on, .pa-mpick-item.on"));
  } });
  // 2.8.8 选中后先让窗口收起（约 160 毫秒的淡出），再交给酒馆换模型：酒馆换模型要重算提示词，
  // 在手机上要占住页面一两秒，同步做时窗口停在屏幕上、点 ✕ 也没反应
  if (picked) await sleep(180);
  return picked;
}
// site：传了就能建分类（分类记在站点上）
function pickModel(list, cur, { title = "选择模型", site = null } = {}) {
  return modelPicker({ site, list, cur, title });
}
// 多密钥站点：选模型时一并选分组。cur：{ keyId, model }，返回 { model, keyId }
function pickKeyModel(site, cur, { title = "选择模型" } = {}) {
  return modelPicker({ site, keys: site.keys, cur: cur?.model || "", curKey: cur?.keyId || null, title });
}
// 2.8.8 中转站的模型名常带标签：「爱琴海」按次vt-gemini-3.1-pro[0.086]。拆成模型名和标签两行显示：
// 首尾的括号段（[] 【】 () （） 「」 『』）、紧贴在英文模型名前的中文（按次、按量）算标签；拆完没剩下模型名时整名照旧
const TAG_OPEN = "[【(（「『<《";
const TAG_CLOSE = { "[": "]", "【": "】", "(": ")", "（": "）", "「": "」", "『": "』", "<": ">", "《": "》" };
function splitModelName(m) {
  let s = String(m || "").trim();
  const head = [], tail = [];
  for (let guard = 0; guard < 6 && s && TAG_OPEN.includes(s[0]); guard++) {
    const end = s.indexOf(TAG_CLOSE[s[0]], 1);
    if (end < 0) break;
    head.push(s.slice(1, end).trim());
    s = s.slice(end + 1).trim();
  }
  const cjk = /^([㐀-鿿豈-﫿]{1,8})\s*(?=[A-Za-z])/.exec(s);
  if (cjk) {
    head.push(cjk[1]);
    s = s.slice(cjk[0].length);
  }
  for (let guard = 0; guard < 6 && s; guard++) {
    const close = s[s.length - 1];
    const open = Object.keys(TAG_CLOSE).find((k) => TAG_CLOSE[k] === close);
    const start = open ? s.lastIndexOf(open, s.length - 2) : -1;
    if (start <= 0) break;
    tail.unshift(s.slice(start + 1, -1).trim());
    s = s.slice(0, start).trim();
  }
  if (!s) return { name: String(m || "").trim(), tags: [] };
  return { name: s, tags: [...head, ...tail].filter(Boolean) };
}
// 模型名里的「/」「_」「:」后允许换行（「-」后浏览器本就会换）
const modelNameHtml = (name) => esc(name).replace(/([/_:])(?=[^\s])/g, "$1<wbr>");
function modelLabel(m) {
  const { name, tags } = splitModelName(m);
  return `<span class="pa-mlabel"><span class="pa-mn">${modelNameHtml(name)}</span>${tags.length ? `<span class="pa-mtags">${tags.map((t) => `<span>${esc(t)}</span>`).join("")}</span>` : ""}</span>`;
}
// 换模型按钮里的模型名和分组名，箭头不动
function setModelBtn(b, m, key = "") {
  b.querySelector(".pa-mlabel").outerHTML = m ? modelLabel(m) : '<span class="pa-mlabel"><span class="pa-mn">选择模型</span></span>';
  b.querySelector(".pa-model-key")?.remove();
  if (key) b.querySelector(".pa-mlabel").insertAdjacentHTML("afterend", `<em class="pa-chip pa-chip-cot pa-model-key">${esc(key)}</em>`);
}
// arrow：有模型列表可选时才显示 ▾（2.4.1 当前连接拉取到列表后才出现）
// key：多密钥站点当前分组的名称，跟在模型名后面
const modelBtn = (cur, attr, arrow = true, key = "") => `<button class="pa-model-btn" ${attr} title="${esc([cur, key].filter(Boolean).join(" · "))}">${cur ? modelLabel(cur) : '<span class="pa-mlabel"><span class="pa-mn">选择模型</span></span>'}${key ? `<em class="pa-chip pa-chip-cot pa-model-key">${esc(key)}</em>` : ""}${arrow ? "<i>▾</i>" : ""}</button>`;
// 2.3.3 推理格式记录：列表里看每个预设记住的设置，点「修改」手动改
var REASONING_FLAGS = [["auto_parse", "自动解析"], ["add_to_prompts", "添加到提示词"], ["auto_expand", "自动展开"], ["show_hidden", "显示隐藏内容"]];
const showBreaks = (s) => String(s ?? "").replace(/\r?\n/g, "↵");
function reasoningSummary(r) {
  const wrap = r.prefix || r.suffix ? `${showBreaks(r.prefix)} … ${showBreaks(r.suffix)}` : "无前后缀";
  const flags = [r.auto_parse ? "自动解析" : "不自动解析", ...REASONING_FLAGS.slice(1).filter(([k]) => r[k] === true).map(([, label]) => label)];
  return [r.name, wrap, flags.join("、")].filter(Boolean).join(" · ");
}
function reasoningTemplates() {
  try {
    const list = ctx().getPresetManager?.("reasoning")?.getPresetList?.()?.presets;
    if (Array.isArray(list) && list.length) return list.filter((t) => t?.name);
  } catch {}
  return [...document.querySelectorAll("#reasoning_select option")].map((o) => ({ name: o.value })).filter((t) => t.name);
}
// live：这是当前预设、跟随开着，保存即改酒馆现在的设置
async function editReasoning(name, init, live) {
  const base = { ...(reasoningNow() || {}), ...init };
  const has = (k) => base[k] !== undefined;
  const tpls = reasoningTemplates();
  if (has("name") && base.name && !tpls.some((t) => t.name === base.name)) tpls.unshift({ name: base.name });
  const text = (k, label) => has(k) ? `<label class="pa-field"><span>${label}<i class="pa-rws"></i></span><textarea class="pa-input pa-rtext" data-k="${k}" rows="2" spellcheck="false" autocapitalize="off" autocomplete="off"></textarea></label>` : "";
  const body = el(`<div class="pa-form">
      <p class="pa-hint">${live ? "当前预设：保存后立即改酒馆「推理内容格式化」的设置。" : "切到这个预设时套用。"}</p>
      ${has("name") ? `<label class="pa-field"><span>模板</span>${tpls.length ? `<select class="pa-select" data-k="name">${tpls.map((t) => `<option value="${esc(t.name)}"${t.name === base.name ? " selected" : ""}>${esc(t.name)}</option>`).join("")}</select>` : `<input class="pa-input" data-k="name" value="${esc(base.name)}">`}</label>` : ""}
      ${text("prefix", "前缀")}${text("suffix", "后缀")}${text("separator", "分隔符")}
      <div class="pa-rflags">${REASONING_FLAGS.filter(([k]) => has(k)).map(([k, label]) => `<label class="pa-inline-check"><input type="checkbox" data-k="${k}"${base[k] ? " checked" : ""}> ${label}</label>`).join("")}</div>
      ${has("max_additions") ? `<label class="pa-field"><span>添加到提示词的最大条数</span><input class="pa-input" type="number" min="0" max="999" step="1" inputmode="numeric" data-k="max_additions" value="${esc(base.max_additions)}"></label>` : ""}
    </div>`);
  // 只有换行或空格时框里看着是空的，在标题旁标出来
  const mark = (t) => { t.closest(".pa-field").querySelector(".pa-rws").textContent = t.value && !t.value.trim() ? `（${showBreaks(t.value).replace(/ /g, "␣")}）` : ""; };
  // 前后缀常以换行开头，写进 HTML 会被吞掉，所以直接赋值
  body.querySelectorAll("textarea[data-k]").forEach((t) => {
    t.value = String(base[t.dataset.k] ?? "");
    mark(t);
    t.addEventListener("input", () => mark(t));
  });
  // 换模板时和酒馆一样带出该模板的前缀、后缀、分隔符
  body.querySelector("select[data-k=name]")?.addEventListener("change", (e) => {
    const t = tpls.find((x) => x.name === e.target.value);
    for (const k of ["prefix", "suffix", "separator"]) {
      const box = body.querySelector(`textarea[data-k=${k}]`);
      if (box && typeof t?.[k] === "string") {
        box.value = t[k];
        mark(box);
      }
    }
  });
  return sheet({
    title: `推理格式：${name}`,
    body,
    noFocus: true,
    actions: [{ label: "取消", value: null }, { label: "保存", kind: "primary", value: (w) => {
      const out = { ...init };
      w.querySelectorAll("[data-k]").forEach((x) => {
        const k = x.dataset.k;
        if (x.type === "checkbox") out[k] = x.checked;
        else if (k === "max_additions") {
          const n = Math.round(Number(x.value));
          out[k] = x.value.trim() !== "" && Number.isFinite(n) ? Math.min(999, Math.max(0, n)) : base[k];
        } else out[k] = x.value;
      });
      return out;
    } }]
  });
}
// 测试结果前的小圆圈图标：画出来的，勾和感叹号在圆里居中（字符在不同字体里会偏）
var RES_OK = '<svg class="pa-res-ico" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7"/><path d="M4.9 8.2l2.1 2.1 4.1-4.4"/></svg>';
var RES_BAD = '<svg class="pa-res-ico" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7"/><path d="M8 4.4v4.5"/><circle class="pa-res-dot" cx="8" cy="11.4" r=".9"/></svg>';
// 2.5.0 测试消息失败时的原因：站点给的报错原文，加一句最简单的解释
function apiErrorText(data) {
  const e = data?.error;
  let m = (typeof e === "object" && e ? e.message || e.msg : typeof e === "string" ? e : "") || data?.message || "";
  // 中转站常把上游的报错整个塞进 message 里，再拆一层
  for (let i = 0; i < 2 && typeof m === "string" && /^\s*\{/.test(m); i++) {
    try {
      const inner = JSON.parse(m);
      m = inner?.error?.message || inner?.message || (typeof inner?.error === "string" ? inner.error : "") || m;
    } catch { break; }
  }
  return typeof m === "string" ? m.trim() : "";
}
// 酒馆后台自己出错时只回 500，站点真正的状态码常写在报错文字里
// 站点常只写英文说法（如「Service Unavailable」），不写数字；酒馆有时还回 200
var HTTP_PHRASES = [[/bad request/i, 400], [/unauthori[sz]ed/i, 401], [/payment required/i, 402], [/forbidden/i, 403], [/not found/i, 404], [/request time-?out/i, 408], [/payload too large|entity too large/i, 413], [/too many requests/i, 429], [/internal server error/i, 500], [/bad gateway/i, 502], [/service unavailable/i, 503], [/gateway time-?out/i, 504]];
function errStatus(status, text) {
  const t = String(text || "");
  const inText = t.match(/\b(40[0-9]|41[0-9]|42[0-9]|5[0-2][0-9])\b/);
  const vague = !status || status < 400 || status === 500;
  if (inText && vague) return Number(inText[1]);
  const phrase = HTTP_PHRASES.find(([re]) => re.test(t))?.[1];
  if (phrase && vague) return phrase;
  return status >= 400 ? status : 0;
}
var API_ERROR_WORDS = [
  [/quota|insufficient|balance|credit|余额|额度|欠费/i, "额度不足"],
  [/invalid.{0,12}(api.?key|token|令牌)|incorrect api key|api key not valid|unauthori[sz]ed|无效的令牌|令牌.{0,6}(无效|过期|不存在)/i, "密钥无效"],
  [/model.?not.?found|does not exist|no available channel|无可用渠道|not support(ed)?.{0,10}model|模型不存在|不支持.{0,4}模型/i, "该分组无此模型"],
  [/rate.?limit|too many requests|请求过于频繁|频率限制/i, "请求太频繁"],
  [/context.?length|maximum context|too long|tokens? .{0,20}exceed|超出.{0,6}长度/i, "内容超长"],
  [/safety|blocked|content.?filter|审核|违规/i, "被审核拦截"],
  [/overloaded|过载/i, "上游过载"]
];
// 笼统的说法：有状态码时用状态码的解释
var API_ERROR_VAGUE = [
  [/timed? ?out|超时|没有回复/i, "超时"],
  [/failed to fetch|networkerror|load failed/i, "连不上酒馆"]
];
var API_STATUS_WORDS = { 400: "请求参数不对", 401: "密钥无效", 402: "余额不足", 403: "无权限", 404: "模型或网址不存在", 408: "超时", 413: "内容超长", 429: "太频繁或额度用完", 500: "站点出错", 502: "上游连不上", 503: "暂无可用渠道", 504: "上游超时", 520: "站点异常", 521: "服务器未开", 522: "连接超时", 523: "连不上服务器", 524: "处理超时", 529: "上游过载" };
// 一句话的问题：「503 暂无可用渠道」；都对不上时用报错原文
function explainApiError(status, text) {
  const word = API_ERROR_WORDS.find(([re]) => re.test(text || ""))?.[1];
  const vague = API_ERROR_VAGUE.find(([re]) => re.test(text || ""))?.[1];
  // 都对不上时也只写中文，英文原文点这一行看
  const why = word || API_STATUS_WORDS[status] || vague || (status >= 500 ? "站点出错" : status >= 400 ? "请求被拒绝" : String(text || "").trim() ? "未知错误" : "没有回复");
  return [status || "", why].filter(Boolean).join(" ");
}
// 2.5.10 站点文件：导出成 JSON，导入时也认别处常见的写法（url / baseUrl / api_key …）
var SITE_FILE_FORMAT = "麦当劳-站点";
var SITE_URL_FIELDS = ["url", "baseUrl", "baseURL", "base_url", "customUrl", "customURL", "custom_url", "apiUrl", "apiURL", "api_url", "api-url", "apiBase", "api_base", "apiHost", "api_host", "endpoint", "proxyUrl", "reverseProxy", "reverse_proxy", "host", "server"];
var SITE_KEY_FIELDS = ["key", "apiKey", "api_key", "apikey", "APIKey", "API_KEY", "token", "secret", "proxy_password", "sk"];
var SITE_NAME_FIELDS = ["name", "groupName", "siteName", "configName", "title", "label", "alias"];
var SITE_MODEL_FIELDS = ["model", "defaultModel", "default_model", "modelName", "model_name"];
var SITE_MODELS_FIELDS = ["models", "modelList", "model_list"];
var SITE_NOTE_FIELDS = ["note", "notes", "remark", "description", "desc"];
function sitePick(o, names) {
  for (const n of names) {
    const v = o?.[n];
    if (v != null && v !== "") return v;
  }
  return void 0;
}
// 模型可以是字符串，也可以是对象（customModel / model / id / name；别处的 name 常带站点前缀，排在后面）
const siteModelId = (m) => (typeof m === "string" ? m : String(m?.customModel || m?.model || m?.id || m?.name || "")).trim();
function siteModelsOf(v) {
  if (typeof v === "string") return v.split(/[\r\n,]+/).map((x) => x.trim()).filter(Boolean);
  if (!Array.isArray(v)) return [];
  return [...new Set(v.filter((m) => !m?.isPlaceholder).map(siteModelId).filter(Boolean))];
}
function siteKeysIn(o) {
  const textKeys = (t) => String(t || "").split(/[\r\n]+/).map((x) => x.trim()).filter(Boolean);
  const arr = sitePick(o, ["keys", "apiKeys", "api_keys", "tokens"]);
  if (Array.isArray(arr)) {
    return arr.flatMap((k) => {
      if (typeof k === "string") return textKeys(k).map((key) => ({ name: "", key }));
      if (!k || typeof k !== "object") return [];
      const key = String(sitePick(k, SITE_KEY_FIELDS) || "").trim();
      return [{ name: String(sitePick(k, ["name", "label", "group", "title"]) || "").trim(), key, model: String(sitePick(k, SITE_MODEL_FIELDS) || "").trim(), models: siteModelsOf(sitePick(k, SITE_MODELS_FIELDS)), ...(Array.isArray(k.balance) ? { balance: k.balance } : {}) }];
    });
  }
  const one = sitePick(o, SITE_KEY_FIELDS);
  return typeof one === "string" ? textKeys(one).map((key) => ({ name: "", key })) : [];
}
// 一个对象像不像站点：自定义类型要有 http 开头的网址；其他类型（OpenAI、Claude…）认 source
// catNames：文件里的分类（编号 → 名称），模型对象带 categoryIds 时据此建分类
function siteFromObject(o, fallbackName = "", catNames = new Map()) {
  if (!o || typeof o !== "object" || Array.isArray(o)) return null;
  const source = typeof o.source === "string" && SOURCES[o.source] ? o.source : "custom";
  const url = String(sitePick(o, SITE_URL_FIELDS) || "").trim();
  if (source === "custom" && !/^https?:\/\/\S+$/i.test(url)) return null;
  let host = "";
  try { host = url ? new URL(url).host : ""; } catch {}
  const rawModels = sitePick(o, SITE_MODELS_FIELDS);
  const models = siteModelsOf(rawModels);
  const active = Array.isArray(rawModels) ? rawModels.find((m) => m && typeof m === "object" && m.isActive && !m.isPlaceholder) : null;
  const model = String(sitePick(o, SITE_MODEL_FIELDS) || (active && siteModelId(active)) || "").trim();
  // 分类：我们自己的文件是 cats: [{ name, models }]；别处是模型上的 categoryIds
  const cats = new Map();
  for (const c of Array.isArray(o.cats) ? o.cats : []) if (c?.name) cats.set(String(c.name), new Set(siteModelsOf(c.models)));
  if (Array.isArray(rawModels)) for (const m of rawModels) {
    if (!m || typeof m !== "object" || m.isPlaceholder) continue;
    const id = siteModelId(m);
    for (const cid of new Set([...(Array.isArray(m.categoryIds) ? m.categoryIds : []), m.categoryId].filter(Boolean))) {
      const name = catNames.get(String(cid));
      if (!id || !name) continue;
      if (!cats.has(name)) cats.set(name, new Set());
      cats.get(name).add(id);
    }
  }
  const keys = siteKeysIn(o);
  if (!keys.length) keys.push({ name: "", key: "" });
  for (const k of keys) {
    if (!k.model) k.model = keys.length === 1 ? model : "";
    if (!k.models?.length) k.models = models;
  }
  const name = String(sitePick(o, SITE_NAME_FIELDS) || fallbackName || host || SOURCES[source].label).trim();
  return { name, source, url: source === "custom" ? url : "", note: String(sitePick(o, SITE_NOTE_FIELDS) || "").trim(), keys, cats: [...cats].map(([n, ms]) => ({ name: n, models: [...ms] })).filter((c) => c.models.length) };
}
function parseSiteFile(text) {
  const data = JSON.parse(String(text).replace(/^\uFEFF/, ""));
  // 先找分类表：键名带 categor 的数组，元素有 id 和 name
  const catNames = new Map();
  const findCats = (v, depth) => {
    if (depth > 5 || !v || typeof v !== "object") return;
    for (const [k, x] of Object.entries(v)) {
      if (Array.isArray(x) && /categor/i.test(k)) for (const c of x) if (c?.id != null && c?.name) catNames.set(String(c.id), String(c.name));
      if (x && typeof x === "object") findCats(x, depth + 1);
    }
  };
  findCats(data, 0);
  const out = [];
  const walk = (v, depth, name = "") => {
    if (depth > 5 || !v || typeof v !== "object") return;
    if (Array.isArray(v)) return v.forEach((x) => walk(x, depth + 1));
    const me = siteFromObject(v, name, catNames);
    if (me) return out.push(me);
    for (const [k, x] of Object.entries(v)) walk(x, depth + 1, k);
  };
  walk(data, 0);
  return out;
}
// 2.11.5 站点模型跟随当前模型：在酒馆或本扩展里换了模型，使用中站点（当前分组）记的模型一起改，两处显示一致。
// 酒馆切换预设时会读入预设里存的模型，方案套用、切换连接时网址和模型先后变化，这些过程中不跟随
var modelSyncHold = 0;
function holdModelSync(ms) {
  modelSyncHold = Math.max(modelSyncHold, Date.now() + ms);
}
function followLiveModel() {
  if (Date.now() < modelSyncHold || connApplying > 0 || typeof applying !== "undefined" && applying) return false;
  const live = liveConnection();
  if (!live.model) return false;
  const s = settings();
  const active = s.sites?.find((x) => x.id === s.activeSiteId);
  const norm = (u) => String(u || "").replace(/\/+$/, "");
  if (!active || active.source !== live.source || live.source === "custom" && norm(active.url) !== norm(live.url)) return false;
  const k = siteKey(active);
  if (!k || siteMulti(active) && live.secretId && k.secretId !== live.secretId || k.model === live.model) return false;
  k.model = live.model;
  saveSettings();
  return true;
}
function keyMaskOf(text) {
  return text.length > 8 ? `${text.slice(0, 3)}…${text.slice(-4)}` : "已保存";
}
// liveBox：当前连接；sitesBox：站点列表；optsBox：两个选项（「方案」页把方案放在当前连接和选项之间）
function mountApi(liveBox, sitesBox, optsBox = sitesBox) {
  const sites = () => settings().sites;
  // 2.4.0 底部选项行、2.5.0 多密钥站点点开的：2.6.6 起记住最后一次的展开、收起（foldGet / foldSet）
  const shortLabel = (source) => (SOURCES[source]?.label || source || "—").split("（")[0];
  // 2.4.1：当前连接还没存成站点时，拉取到的模型列表先记在这里（面板打开期间）
  let liveFetched = null;
  // 2.5.0 测试结果：写在模型那一行下面；换了模型就不显示
  let liveTest = null;
  let sitesEditing = false;
  // 2.5.0 ⋯ 在卡片里原地展开详情，不再弹窗
  // 酒馆实际在用的模型（测试用的就是它）
  const usingModel = (live = liveConnection()) => {
    const c = ctx();
    return (typeof c.getChatCompletionModel === "function" ? c.getChatCompletionModel() : "") || live.model || "";
  };
  const isSame = (site, live) => !!site && site.source === live.source && (site.source !== "custom" || (site.url || "") === (live.url || ""));
  // 当前连接可选的模型：酒馆下拉框里的、站点记的、刚拉取到的
  function liveModelList(live = liveConnection()) {
    const active = sites().find((x) => x.id === settings().activeSiteId);
    const fetched = liveFetched && liveFetched.source === live.source && liveFetched.url === (live.url || "") ? liveFetched.models : [];
    return [...new Set([...liveModelOptions(), ...isSame(active, live) ? siteKey(active).models || [] : [], ...fetched])];
  }
  // 2.8.0 余额：总余额、上一轮、近 24 / 48 小时用量。只在有余额接口的连接类型显示
  const hm = (t) => {
    const d = new Date(t);
    const p2 = (n) => String(n).padStart(2, "0");
    const today = new Date().toDateString() === d.toDateString();
    return `${today ? "" : `${d.getMonth() + 1}-${d.getDate()} `}${p2(d.getHours())}:${p2(d.getMinutes())}`;
  };
  // 2.8.8 余额分三行，左边对齐、右边对齐：
  // 第一行 当前余额（手填时带「手填」）……右端查询按钮；第二行 上一轮、近 24 小时用量（灰色小字）；
  // 第三行 填余额 / 改余额……右端「每轮自动」。查询失败的原因在第二行下面
  function balCard(live) {
    const b = balanceSummary(live);
    if (!b.supported || !balShown()) return "";
    const cur = b.last?.cur || "$";
    const apiBal = b.last && !b.last.unl && b.last.bal != null ? fmtMoney(b.last.bal, cur) : "";
    const total = apiBal || (b.manual ? fmtMoney(b.manual.amount, b.manual.cur) : b.last?.unl ? "不限额度" : "");
    const used = b.last ? [`${b.round && !b.round.gen ? "距上次查询" : "上一轮"} ${b.round ? fmtMoney(b.round.v, cur) : "—"}`, `近 24 小时 ${b.d1.pairs ? fmtMoney(b.d1.sum, cur) : "—"}`] : [];
    const canSet = !apiBal && b.site;
    const when = b.busy ? "正在查询…" : b.last ? `${hm(b.last.t)} 更新` : "尚未查询";
    const manual = !apiBal && b.manual ? '<span class="pa-chip pa-chip-dim" title="手填的余额，按每次查到的用量扣减">手填</span>' : b.last?.acct && apiBal ? '<span class="pa-chip pa-chip-dim" title="站点账户的余额，用系统访问令牌查询">账户</span>' : "";
    // 2.11.4 中转站：用系统访问令牌查账户余额
    const acctBtn = live.source === "custom" && b.site ? `<button class="pa-link pa-bal-set" data-a="balacct" type="button">${b.site.acct ? "账户查询设置" : "自动查账户余额"}</button>` : "";
    const usedLine = used.length ? used.map((x) => `<span>${esc(x)}</span>`).join("") : total ? `<span>${esc(when)}</span>` : "";
    return `<div class="pa-bal" aria-label="余额">
        <div class="pa-bal-top">${total ? `<b class="pa-bal-total pa-num" title="${esc(when)}">${esc(total)}</b>${manual}` : `<span class="pa-bal-time">${esc(when)}</span>`}<button class="pa-icon-btn pa-bal-q${b.busy ? " pa-spin" : ""}" data-a="balq" type="button" aria-label="查询余额" title="查询余额（${esc(when)}）"${b.busy ? " disabled" : ""}>${ICON.refresh}</button></div>
        ${usedLine ? `<div class="pa-bal-used pa-num">${usedLine}</div>` : ""}
        ${b.err ? `<p class="pa-live-res bad">${RES_BAD}${esc(b.err)}</p>` : ""}
        <div class="pa-bal-acts">${canSet ? `<button class="pa-link pa-bal-set" data-a="balset" type="button">${b.manual ? "改余额" : "填余额"}</button>` : ""}${acctBtn}<label class="pa-bal-auto" title="每轮生成后自动查询余额"><input type="checkbox" data-o="balauto" aria-label="每轮生成后自动查询余额" ${settings().balanceAuto ? "checked" : ""}>每轮自动</label></div>
      </div>`;
  }
  function render() {
    // 2.11.6 本浏览器里还有没存进酒馆密钥库的系统访问令牌：存进去，别的设备就能用
    if (multiKeySupported() && sites().some((x) => x.acct && !x.acct.secretId && balAcctLocal(x))) balAcctUpload().then((n) => { if (n) render(); }).catch(() => {});
    const live = liveConnection();
    const s = settings();
    const active = sites().find((x) => x.id === s.activeSiteId);
    const src = SOURCES[live.source];
    const liveModels = liveModelOptions();
    // 使用中的站点只同步可选的模型列表；在酒馆里临时换的模型不悄悄写进站点，由用户决定要不要记下
    const sameSite = isSame(active, live);
    // 2.5.0 多密钥站点：在酒馆里换了密钥、正好是这个站点的另一个分组，跟着记过去
    if (sameSite && siteMulti(active) && live.secretId && siteKey(active).secretId !== live.secretId) {
      const k = active.keys.find((x) => x.secretId === live.secretId);
      if (k) {
        active.keyId = k.id;
        saveSettings();
      }
    }
    const ak = sameSite ? siteKey(active) : null;
    // 多密钥站点不从酒馆下拉框同步：刚换密钥时下拉框里可能还是上一个分组的列表，各分组的模型以「拉取」为准
    if (ak && !siteMulti(active) && liveModels.length && JSON.stringify(ak.models || []) !== JSON.stringify(liveModels)) {
      ak.models = liveModels;
      saveSettings();
    }
    followLiveModel();
    const usedBy = (id) => [...new Set(settings().schemes.filter((sc) => schemeConn(sc)?.siteId === id).map((sc) => sc.preset))];
    const dot = `<span class="pa-dot ${live.online ? "pa-dot-on" : ""}">${live.online ? "已连接" : "未连接"}</span>`;
    // 2.8.1 当前连接：名称、网址、模型、余额；测试、拉取、编辑为标题行的小图标，编辑一步打开站点窗口
    const sub = live.url || src?.label || "";
    const bal = balCard(live);
    liveBox.innerHTML = `<div class="pa-row-head"><h3 class="pa-h">酒馆当前连接</h3>${balSupported(live.source) ? `<label class="pa-balshow"><input type="checkbox" data-o="balshow" ${balShown() ? "checked" : ""}>显示余额</label>` : ""}</div>
        <article class="pa-card pa-site pa-site-on pa-live"${active ? ` data-id="${esc(active.id)}"` : ""}>
            <header>${dot}<b title="${esc(src?.label || live.source || "")}">${esc(active ? active.name : shortLabel(live.source))}</b>${active ? "" : '<button class="pa-chip pa-chip-dim pa-chip-btn" data-a="capture" title="保存为站点">保存为站点</button>'}<span class="pa-live-ic">
              ${live.source === "custom" ? `<button class="pa-icon-btn pa-live-fetch" data-a="livefetch" type="button" aria-label="拉取模型列表" title="拉取模型列表">${ICON.refresh}</button>` : ""}
              <button class="pa-icon-btn pa-live-test" data-a="testmodel" type="button" aria-label="发送测试消息" title="发送测试消息，看选中的模型能不能用">${ICON.bolt}</button>
              ${active ? `<button class="pa-icon-btn pa-live-edit" data-a="edit" type="button" aria-label="编辑站点" title="编辑站点（网址、密钥、备注、删除）">${ICON.pencil}</button>` : ""}</span></header>
            <dl class="pa-kv pa-live-kv">
              ${sub && sub !== src?.label ? `<dt>网址</dt><dd class="pa-live-url pa-mono" title="${esc(sub)}">${esc(sub)}</dd>` : ""}
              <dt>模型</dt><dd class="pa-live-model">${modelBtn(live.model, 'data-a="livemodel"', liveModelList(live).length > 0 || !!ak && siteMulti(active), ak ? keyName(active, ak) : "")}</dd>
              ${bal ? `<dt class="pa-bal-dt">余额</dt><dd>${bal}</dd>` : ""}
            </dl>
            ${liveTest && liveTest.model === usingModel(live) && liveTest.source === live.source && liveTest.url === (live.url || "") && liveTest.secretId === (live.secretId || null) ? `<p class="pa-live-res ${liveTest.ok ? "ok" : "bad"}"${liveTest.raw ? ` title="${esc(liveTest.raw)}" data-a="testraw" role="button" tabindex="0"` : ""}>${liveTest.ok ? RES_OK : RES_BAD}${esc(liveTest.text)}</p>` : ""}
        </article>`;
    // 2.8.9 编辑站点时左侧出现把手，拖动或按 ↑ ↓ 调整站点顺序
    const siteGrip = (x) => `<button type="button" class="pa-key-grip pa-site-grip" data-a="sitegrip" aria-label="「${esc(x.name)}」：拖动或按上下方向键调整顺序" title="拖动调整顺序">${ICON_GRIP}</button>`;
    // 2.4.0：站点不分组，每个站点一个独立的框（和方案下面的选项一样）
    const siteRow = (x) => {
      const used = usedBy(x.id);
      const on = x.id === s.activeSiteId;
      if (siteMulti(x)) return multiRow(x, on, used);
      const bal = balSiteText(x);
      const sub = balShown() ? bal ? `余额 ${bal}` : "余额未知" : x.model ? splitModelName(x.model).name : "未选模型";
      return `<div class="pa-sgroup pa-sitecard pa-site${on ? " pa-srow-on" : ""}" data-id="${esc(x.id)}">
            ${sitesEditing ? siteGrip(x) : ""}<div class="pa-srow-main pa-site-name" data-a="edit" role="button" tabindex="0" aria-label="编辑「${esc(x.name)}」" title="${esc([x.model || "未选模型", used.length ? `用于 ${used.join("、")}` : ""].filter(Boolean).join(" · "))}"><b>${esc(x.name)}</b><small class="pa-site-model pa-num">${esc(sub)}</small></div>
            ${sitesEditing ? `<button class="pa-icon-btn pa-site-del" data-a="del" type="button" aria-label="删除「${esc(x.name)}」" title="删除">${ICON.trash}</button>` : on ? '<span class="pa-chip pa-site-on-chip">使用中</span>' : '<button class="pa-swpill" data-a="use" type="button">切换</button>'}</div>`;
    };
    // 2.5.0 多密钥站点：左边小三角，点开每个分组一行，各有「切换」；折起时小字是当前分组和模型
    const multiRow = (x, on, used) => {
      const open = foldGet("sites", x.id);
      const k = siteKey(x);
      const bal = balSiteText(x);
      const info = [on ? keyName(x, k) : "", balShown() ? bal ? `余额 ${bal}` : "余额未知" : ""].filter(Boolean).join(" · ");
      const lines = open ? `<div class="pa-klines">${x.keys.map((y) => {
        const cur = on && y.id === k.id;
        return `<div class="pa-kline${cur ? " pa-srow-on" : ""}" data-k="${esc(y.id)}" data-a="edit"><div class="pa-srow-main"><b>${esc(keyName(x, y))}</b><small>${esc(y.model || "未选模型")}</small></div>${cur ? '<span class="pa-chip pa-site-on-chip">使用中</span>' : '<button class="pa-swpill" data-a="use" type="button">切换</button>'}</div>`;
      }).join("")}</div>` : "";
      // 和单密钥站点一样：点「切换」切换，点右边「N 组」展开、收起，点其他地方打开编辑窗口
      return `<div class="pa-sgroup pa-sitecard pa-site pa-site-multi${on ? " pa-srow-on" : ""}${open ? " open" : ""}" data-id="${esc(x.id)}">
            <div class="pa-site-mhead" data-a="edit" role="button" tabindex="0" aria-label="编辑「${esc(x.name)}」">
            ${sitesEditing ? siteGrip(x) : ""}<div class="pa-srow-main"><b>${esc(x.name)}</b>${info ? `<small class="pa-site-model">${esc(info)}</small>` : ""}</div>
            ${sitesEditing ? `<button class="pa-icon-btn pa-site-del" data-a="del" type="button" aria-label="删除「${esc(x.name)}」" title="删除">${ICON.trash}</button>` : on ? '<span class="pa-chip pa-site-on-chip">使用中</span>' : ""}<button class="pa-swpill pa-fold-pill" data-a="sitefold" type="button" aria-expanded="${open}" aria-label="${x.keys.length} 个分组，${open ? "收起" : "展开"}">${x.keys.length} 组 ${open ? "▾" : "▸"}</button></div>${lines}</div>`;
    };
    const info = (t, d) => `<div class="pa-srow"><div class="pa-srow-main"><b>${t}</b><small>${d}</small></div></div>`;
    const follow = s.reasoningFollowPreset === true;
    const rows = follow ? reasoningRows() : [];
    const kept = Object.keys(s.reasoningByPreset || {}).length;
    const reasoningBody = follow
      ? rows.map(reasoningRow).join("") + '<button class="pa-srow pa-optadd" data-a="reasoningadd" type="button">＋ 给其他预设设置</button>'
      : info("开启后", "离开预设时记下推理格式，切回时恢复") + (kept ? `<div class="pa-srow"><div class="pa-srow-main"><b>已记住 ${kept} 个预设</b></div><button class="pa-btn pa-btn-s pa-btn-danger-soft" data-a="reasoningclear">清除</button></div>` : "");
    // 2.8.5 站点标题右边：铅笔（编辑：导入、导出、删除）和 ＋；编辑时换成导入、导出、完成
    const n = sites().length;
    if (!n) sitesEditing = false;
    const fileIn = (cls, label) => `<label class="${cls} pa-file" role="button" tabindex="0" title="从 JSON 文件导入站点和密钥">${label}<input type="file" accept=".json,application/json,text/plain" data-import-sites hidden></label>`;
    const headBtns = sitesEditing
      ? `${fileIn("pa-swpill", "导入")}<button class="pa-swpill" data-a="exportsites" type="button" title="把站点和密钥存成 JSON 文件">导出</button><button class="pa-swpill pa-done-pill" data-a="sitesdone" type="button">完成</button>`
      : `${n ? `<button class="pa-head-ico" data-a="sitesedit" type="button" aria-label="编辑站点：删除、导入、导出" title="编辑：删除、导入、导出">${ICON.pencil}</button>` : ""}<button class="pa-head-ico pa-head-add" data-a="new" type="button" aria-label="添加站点" title="添加站点">${ICON.plus}</button>`;
    sitesBox.innerHTML = `
        <div class="pa-row-head"><h3 class="pa-h">站点${n ? whyBtn("sites") : ""}</h3><div class="pa-head-btns">${headBtns}</div></div>
        ${n ? `${whyNote("sites", sitesEditing ? "按住左侧把手拖动调整顺序，点垃圾桶删除站点。导出的文件可在重装、换设备后导入。" : "点站点名修改详情、填余额。点铅笔可删除站点、导入或导出站点文件。")}${sites().map(siteRow).join("")}` : `<p class="pa-empty">暂无站点。可点 ＋ 添加、${fileIn("pa-link", "从文件导入")}，或保存上方的当前连接。</p>`}`;
    optsBox.innerHTML = `
        ${optCard("chattoast", `<input type="checkbox" data-o="chattoast" aria-label="换角色或聊天时，提示当前预设和模型" ${s.chatToast !== false ? "checked" : ""}>`, "换角色或聊天时，提示当前预设和模型", 0,
          info("换角色或聊天", "弹出当前预设和模型，3 秒后消失") + info("换预设", "API 不变") + info("切换方案", "预设、条目开关、人设一起换；方案记了 API 的也换"))}
        ${optCard("reasoning", `<input type="checkbox" data-o="reasoningfollow" aria-label="切换预设时，同时切换推理格式" ${follow ? "checked" : ""}>`, "切换预设时，同时切换推理格式", rows.length, reasoningBody)}`;
  }
  // 2.4.0 选项行：只有方框管勾选，点这一行其他地方展开
  function optCard(key, check, label, count, body) {
    const on = foldGet("opts", key);
    return `<section class="pa-sgroup pa-optgroup${on ? " open" : ""}" data-w="${key}">
        <header class="pa-sghead pa-opthead" data-a="optfold" tabindex="0" aria-expanded="${on}"><label class="pa-optcheck">${check}</label><span class="pa-optlabel">${label}</span>${count ? `<span class="pa-optcount">${count}</span>` : ""}<span class="pa-sgcaret">${on ? "▾" : "▸"}</span></header>
        ${on ? `<div class="pa-sgbody">${body}</div>` : ""}</section>`;
  }
  // 跟随开着时，当前预设的记录就是酒馆现在的设置（离开时会照它记下），所以显示实时值，不给删除
  function reasoningRows() {
    const store = reasoningStore();
    const live = reasoningNow();
    const rows = Object.keys(store).filter((n) => n !== reasoningPreset).sort((a, b) => a.localeCompare(b, "zh")).map((n) => ({ name: n, r: store[n], cur: false }));
    if (reasoningPreset && live) rows.unshift({ name: reasoningPreset, r: live, cur: true });
    return rows;
  }
  // 2.4.0：前缀放进小方框，自动解析用圆点表示；完整设置在悬停提示里
  function reasoningRow(x) {
    const tag = showBreaks(x.r.prefix).trim();
    return `<div class="pa-srow pa-rrow${x.cur ? " pa-srow-on" : ""}" data-name="${esc(x.name)}">
          <div class="pa-srow-main"><b title="${esc(x.name)}">${esc(x.name)}</b>${x.cur ? '<span class="pa-chip">当前</span>' : ""}<small class="pa-rfmt" title="${esc(reasoningSummary(x.r))}"><code class="pa-rtag">${esc(tag || "无前缀")}</code><span class="pa-rauto${x.r.auto_parse ? " on" : ""}">${x.r.auto_parse ? "自动解析" : "不解析"}</span></small></div>
          <button class="pa-btn pa-btn-s" data-a="reasoningedit">修改</button>${x.cur ? "" : '<button class="pa-btn pa-btn-s pa-btn-danger-soft" data-a="reasoningdel">删除</button>'}
        </div>`;
  }
  async function getModels(site) {
    return withSiteKey(site, () => fetchModelList(site));
  }
  // 2.5.0 多密钥站点：每个分组各拉一次模型列表。返回 { ok, bad: [失败的分组名] }
  async function fetchAllKeys(site, keys = site.keys) {
    const bad = [];
    let ok = 0;
    for (const k of keys) {
      try {
        k.models = await getModels(keyView(site, k.id));
        ok++;
      } catch (e) {
        bad.push(keyName(site, k));
        console.warn("[麦当劳] 拉取模型失败", keyName(site, k), e);
      }
    }
    return { ok, bad };
  }
  const failMsg = (site, k) => `「${keyName(site, k)}」密钥请求失败（额度用完或已失效）`;
  // 编辑窗口里的一个密钥：已有的带着密钥库编号、模型；新加的只有编号
  const blankKey = () => ({ id: uid(), name: "", secretId: null, keyMask: "", localKey: false, model: "", models: [] });
  async function editSite(site) {
    const isNew = !site;
    const s = site ? structuredClone(site) : { id: uid(), name: "", source: "custom", url: "", model: "", models: [], secretId: null, keyMask: "", note: "" };
    // 单密钥站点的密钥就是站点自己；进窗口时统一成一组，保存时一个就写回站点上
    let ks = siteMulti(s) ? s.keys : [{ id: uid(), name: "", secretId: s.secretId || null, keyMask: s.keyMask || "", localKey: !!s.localKey, localId: s.localId || (s.localKey || s.legacyKey ? s.id : undefined), legacyKey: s.legacyKey, model: s.model || "", models: s.models || [] }];
    let curKey = siteMulti(s) ? siteKey(s).id : ks[0].id;
    const body = el(`<div class="pa-form">
            <label class="pa-field"><span>名称</span><input class="pa-input" data-f="name" value="${esc(s.name)}" placeholder="例如：某中转站"></label>
            <label class="pa-field"><span>类型</span><select class="pa-select" data-f="source">${Object.entries(SOURCES).map(([k, v]) => `<option value="${k}" ${k === s.source ? "selected" : ""}>${esc(v.label)}</option>`).join("")}</select></label>
            <label class="pa-field" data-show="custom"><span>网址</span><input class="pa-input" data-f="url" value="${esc(s.url)}" placeholder="https://…/v1" inputmode="url" autocapitalize="off"></label>
            <div class="pa-field"><span class="pa-keyhead">密钥<button class="pa-icon-btn pa-key-add" data-f="keyadd" type="button" aria-label="加一个密钥" title="加一个密钥（同一站点的其他分组）">＋</button></span><div class="pa-keys" data-f="keys"></div></div>
            <div class="pa-field"><span>模型</span>${modelBtn(s.model, 'data-f="modelbtn" type="button"')}<input type="hidden" data-f="model" value="${esc(s.model || "")}"></div>
            <button class="pa-btn pa-btn-soft" data-f="fetch" type="button" data-show="custom">获取模型列表</button>
            <label class="pa-field"${balShown() ? "" : " hidden"}><span>账户余额</span><input class="pa-input pa-num" data-f="bal" value="${esc(s.manualBalance ? fmtMoney(s.manualBalance.amount, s.manualBalance.cur) : "")}" placeholder="接口查不到余额时填，如 50、¥300" inputmode="decimal" autocomplete="off"><small class="pa-hint">按每次查到的用量自动扣减；充值后改成新的余额。</small></label>
            <label class="pa-field"><span>备注</span><textarea class="pa-input pa-note" data-f="note" rows="1" placeholder="例如：月卡至 11 月">${esc(s.note || "")}</textarea></label>
            <p class="pa-hint">${multiKeySupported() ? "密钥存入酒馆密钥库，本扩展只记录编号。" : "酒馆版本较旧，没有密钥库。密钥只保存在这个浏览器里，不写进酒馆设置文件；换设备、换浏览器需要重新填写。"}</p>
        </div>`);
    const keysBox = body.querySelector("[data-f=keys]");
    const hasKey = (k) => !!(k.secretId || k.localKey || k.legacyKey);
    // 框里还没存的密钥文字，按编号记下（重画密钥行时不丢）
    const typed = new Map();
    // 点了眼睛、正显示明文的密钥；已保存的密钥能看到时记在 revealed（只放在提示文字里，不当成新填的）
    const shown = new Set();
    const revealed = new Map();
    // 看不了时，在这一行下面说一句为什么
    const keyNote = new Map();
    const syncTyped = () => {
      keysBox.querySelectorAll(".pa-keyrow").forEach((row) => {
        const k = ks.find((x) => x.id === row.dataset.k);
        if (!k) return;
        // 2.5.15 框里是看到的已存密钥（没改）时，不算新填的，保存时不再存一遍
        const v = row.querySelector("[data-f=key]").value.trim();
        if (v && v === revealed.get(k.id)) typed.delete(k.id);
        else typed.set(k.id, v);
        const n = row.querySelector("[data-f=keyname]");
        if (n) k.name = n.value.trim();
      });
    };
    const paintKeys = () => {
      const many = ks.length > 1;
      keysBox.classList.toggle("pa-keys-many", many);
      keysBox.innerHTML = ks.map((k, i) => {
        const ph = hasKey(k) ? (k.keyMask ? `${k.keyMask} · 留空不改` : "不修改请留空") : many ? "粘贴密钥，可多行" : "留空则使用酒馆当前密钥，可多行粘贴";
        const cnt = (k.models || []).length ? `<span class="pa-key-cnt" title="拉取到的模型">✓ ${k.models.length}</span>` : "";
        return `<div class="pa-keyrow" data-k="${esc(k.id)}">
            ${many ? `<button type="button" class="pa-key-grip" aria-label="密钥 ${i + 1}：拖动或按上下方向键调整顺序" title="拖动调顺序，排在上面的优先">${ICON_GRIP}</button><input class="pa-input pa-key-name" data-f="keyname" value="${esc(k.name)}" placeholder="密钥 ${i + 1}" aria-label="密钥 ${i + 1} 的名称（分组名，可不填）">` : ""}
            <input class="pa-input pa-key-val" data-f="key" type="${shown.has(k.id) ? "text" : "password"}" style="${KEY_INPUT_STYLE}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="${esc(ph)}" aria-label="${many ? `密钥 ${i + 1}` : "密钥"}" value="${esc(typed.get(k.id) || shown.has(k.id) && revealed.get(k.id) || "")}">
            <button class="pa-icon-btn pa-key-eye${shown.has(k.id) ? " on" : ""}" data-f="keyeye" type="button" aria-pressed="${shown.has(k.id)}" aria-label="${shown.has(k.id) ? "隐藏密钥" : "显示密钥"}" title="${shown.has(k.id) ? "隐藏密钥" : "显示密钥"}">${ICON.eye}</button>
            ${shown.has(k.id) && (typed.get(k.id) || revealed.get(k.id)) ? `<button class="pa-icon-btn pa-key-copy" data-f="keycopy" type="button" aria-label="复制密钥" title="复制密钥">${ICON.copy}</button>` : ""}
            ${cnt}${many ? `<button class="pa-icon-btn pa-key-del" data-f="keydel" type="button" aria-label="删除这个密钥" title="删除这个密钥">✕</button>` : ""}
          </div>${keyNote.has(k.id) ? `<p class="pa-hint pa-key-note">${esc(keyNote.get(k.id))}</p>` : ""}`;
      }).join("");
    };
    paintKeys();
    const sync = (w) => {
      const custom = w.querySelector("[data-f=source]").value === "custom";
      w.querySelectorAll("[data-show=custom]").forEach((x) => {
        x.hidden = !custom;
      });
    };
    const viewSite = () => ({ ...s, keys: ks, keyId: curKey });
    const setModel = (w, m, keyId = curKey) => {
      if (keyId) curKey = keyId;
      const k = ks.find((x) => x.id === curKey) || ks[0];
      k.model = m;
      w.querySelector("[data-f=model]").value = m;
      const b = w.querySelector("[data-f=modelbtn]");
      const kn = ks.length > 1 ? keyName(viewSite(), k) : "";
      b.title = [m, kn].filter(Boolean).join(" · ");
      setModelBtn(b, m, kn);
    };
    const readModel = (w) => w.querySelector("[data-f=model]").value.trim();
    const read = (w) => {
      syncTyped();
      return {
        name: w.querySelector("[data-f=name]").value.trim(),
        source: w.querySelector("[data-f=source]").value,
        url: w.querySelector("[data-f=url]").value.trim(),
        model: readModel(w),
        note: w.querySelector("[data-f=note]").value.trim(),
        bal: w.querySelector("[data-f=bal]").value.trim()
      };
    };
    // 这个对话框里存进密钥库的新密钥。取消时删掉；同一个对话框里换过、删掉的，旧的也删掉
    const madeKeys = [];
    const madeLocal = [];
    const localIdOf = (k) => k.localId || (ks.length > 1 || ks[0] !== k ? `${s.id}.${k.id}` : s.id);
    const persistKey = async (k, v) => {
      const text = typed.get(k.id);
      if (!text) return;
      if (multiKeySupported()) {
        const label = ks.length > 1 ? `麦当劳\xB7${v.name || "站点"}\xB7${keyName(viewSite(), k)}` : `麦当劳\xB7${v.name || "站点"}`;
        const id = await storeKey(v.source, text, label);
        madeKeys.push({ source: v.source, id });
        k.secretId = id;
        delete k.legacyKey;
      } else {
        const lid = localIdOf(k);
        if (!setLocalKey(lid, text)) throw new Error("浏览器不允许保存密钥（可能是无痕模式）");
        madeLocal.push(lid);
        k.localKey = true;
        k.localId = lid;
        delete k.legacyKey;
      }
      k.keyMask = keyMaskOf(text);
      typed.delete(k.id);
    };
    // 多个密钥时，新加了却没填的行不算
    const liveKeys = () => {
      if (ks.length < 2) return ks;
      const hit = ks.filter((k) => hasKey(k) || typed.get(k.id));
      return hit.length ? hit : [ks[0]];
    };
    const r = await sheet({
      title: isNew ? "添加站点" : `编辑「${s.name}」`,
      body,
      wide: true,
      noFocus: !isNew,
      guardDirty: (w) => JSON.stringify([read(w), ks.map((k) => [k.id, k.name, typed.get(k.id) || ""])]),
      onMount: (w) => {
        sync(w);
        setModel(w, (ks.find((x) => x.id === curKey) || ks[0]).model || "");
        w.querySelector("[data-f=source]").addEventListener("change", () => sync(w));
        w.querySelector("[data-f=keyadd]").addEventListener("click", () => {
          syncTyped();
          ks.push(blankKey());
          paintKeys();
          setModel(w, readModel(w));
          keysBox.querySelector(".pa-keyrow:last-of-type [data-f=key]")?.focus();
        });
        // 眼睛：显示、隐藏密钥。刚填的直接看；已保存的，用本浏览器留的那份，没有再问酒馆
        keysBox.addEventListener("click", async (e) => {
          const eye = e.target.closest("[data-f=keyeye]");
          if (!eye) return;
          syncTyped();
          const id = eye.closest(".pa-keyrow").dataset.k;
          const k = ks.find((x) => x.id === id);
          if (shown.has(id)) shown.delete(id);
          else {
            shown.add(id);
            if (!typed.get(id) && hasKey(k) && !revealed.has(id)) {
              // 只存在这个浏览器里的（旧版酒馆）直接读；存在酒馆密钥库的去问酒馆
              const local = !k.secretId ? getLocalKey({ id: s.id, localId: k.localId, legacyKey: k.legacyKey }) : null;
              const got = local ? { value: local } : k.secretId ? await revealSecret(w.querySelector("[data-f=source]").value, k.secretId) : {};
              if (got.value) revealed.set(id, got.value);
              else {
                shown.delete(id);
                keyNote.set(id, got.blocked ? "这把密钥是更新前或在别的浏览器里存的，这里没留底。重新粘贴一次保存，以后就能看；或在酒馆的 config.yaml 里把 allowKeysExposure 改成 true，重启酒馆。" : k.secretId ? "没取到这个密钥，可能已从酒馆密钥库删除。重新粘贴一次就行。" : "这个密钥只存在这个浏览器里，看不了全文；要确认就重新粘贴一次。");
              }
            }
          }
          paintKeys();
        });
        keysBox.addEventListener("click", async (e) => {
          const b = e.target.closest("[data-f=keycopy]");
          if (!b) return;
          const input = b.closest(".pa-keyrow").querySelector("[data-f=key]");
          const text = input.value.trim();
          if (!text) return;
          const ok = await copyText(text, input);
          toast(ok ? "已复制" : "复制失败，长按框里的密钥手动复制", ok ? "success" : "warning");
        });
        keysBox.addEventListener("click", (e) => {
          if (!e.target.closest("[data-f=keydel]")) return;
          syncTyped();
          const id = e.target.closest(".pa-keyrow").dataset.k;
          ks = ks.filter((k) => k.id !== id);
          typed.delete(id);
          if (curKey === id) curKey = ks[0].id;
          paintKeys();
          setModel(w, (ks.find((x) => x.id === curKey) || ks[0]).model || "");
        });
        keysBox.addEventListener("input", (e) => {
          if (e.target.matches("[data-f=keyname]")) {
            syncTyped();
            setModel(w, readModel(w));
          }
        });
        // 一次粘贴多行：一行一个密钥，拆成多行
        keysBox.addEventListener("paste", (e) => {
          const box = e.target.closest("[data-f=key]");
          if (!box) return;
          const lines = (e.clipboardData?.getData("text") || "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
          if (lines.length < 2) return;
          e.preventDefault();
          syncTyped();
          const id = box.closest(".pa-keyrow").dataset.k;
          let i = ks.findIndex((k) => k.id === id);
          typed.set(id, lines[0]);
          for (const line of lines.slice(1)) {
            const k = blankKey();
            ks.splice(++i, 0, k);
            typed.set(k.id, line);
          }
          paintKeys();
          setModel(w, readModel(w));
          toast(`已拆成 ${lines.length} 个密钥，可在左边填分组名`, "success");
        });
        // 2.8.9 按住把手拖动调顺序（排在上面的优先），也可聚焦把手后按 ↑ ↓
        dragSort(keysBox, { grip: ".pa-key-grip", row: ".pa-keyrow", onDrop: (from, to, how) => {
          syncTyped();
          keyNote.clear();
          moveItem(ks, from, to);
          paintKeys();
          setModel(w, readModel(w));
          if (how.keyboard) keysBox.querySelectorAll(".pa-key-grip")[to]?.focus();
        } });
        // 2.9.1 备注随内容增高，长备注在手机上完整显示
        const note = w.querySelector("[data-f=note]");
        const fitNote = () => { note.style.height = "auto"; note.style.height = note.scrollHeight + 2 + "px"; };
        note.addEventListener("input", fitNote);
        requestAnimationFrame(fitNote);
        setTimeout(fitNote, 350);
        w.querySelector("[data-f=modelbtn]").addEventListener("click", async () => {
          syncTyped();
          const view = viewSite();
          if (ks.length > 1) {
            const m = await pickKeyModel(view, { keyId: curKey, model: readModel(w) });
            s.modelView = view.modelView;
            if (view.modelCats) s.modelCats = view.modelCats;
            if (m) setModel(w, m.model, m.keyId);
            return;
          }
          const m = await pickModel(ks[0].models || [], readModel(w), { site: s });
          if (m) setModel(w, m);
        });
        w.querySelector("[data-f=fetch]").addEventListener("click", async (ev) => {
          const v = read(w);
          if (!v.url) return toast("请填写网址");
          const btn = ev.target;
          btn.disabled = true;
          btn.textContent = "获取中…";
          try {
            const use = liveKeys();
            for (const k of use) await persistKey(k, v);
            Object.assign(s, { source: v.source, url: v.url, name: v.name || s.name });
            if (use.length > 1) {
              const view = { ...viewSite(), keys: use };
              const { ok, bad } = await fetchAllKeys(view, use);
              paintKeys();
              const n = new Set(use.flatMap((k) => k.models || [])).size;
              if (bad.length) toast(`${bad.map((x) => `「${x}」`).join("")}密钥请求失败（额度用完或已失效）`, "warning");
              if (ok && n) {
                toast(`已获取 ${n} 个模型`, "success");
                const m = await pickKeyModel(view, { keyId: curKey, model: v.model });
                s.modelView = view.modelView;
                if (view.modelCats) s.modelCats = view.modelCats;
                if (m) setModel(w, m.model, m.keyId);
              } else if (ok) toast("站点未返回模型，可手动输入模型名称", "warning");
            } else {
              const k = use[0];
              const models = await getModels({ ...s, secretId: k.secretId, localId: k.localId, localKey: k.localKey, legacyKey: k.legacyKey });
              k.models = models;
              paintKeys();
              if (models.length) {
                toast(`已获取 ${models.length} 个模型`, "success");
                const m = await pickModel(models, v.model, { site: s });
                if (m) setModel(w, m);
              }
              else toast("站点未返回模型，可手动输入模型名称", "warning");
            }
          } catch (err) {
            toast("获取失败：" + err.message, "error");
          }
          btn.disabled = false;
          btn.textContent = "获取模型列表";
        });
      },
      actions: [...isNew ? [] : [{ label: "删除", kind: "danger-soft", value: "del" }], { label: "取消", value: null }, {
        label: "保存",
        kind: "primary",
        validate: (w) => {
          const v = read(w);
          if (!v.name) {
            toast("请填写名称");
            return false;
          }
          if (v.source === "custom" && !v.url) {
            toast("自定义类型需填写网址");
            return false;
          }
          if (v.bal && !balParseAmount(v.bal)) {
            toast("余额格式不对，如 50、$50.5、¥300");
            return false;
          }
          return true;
        },
        value: read
      }]
    });
    if (!r || r === "del") {
      for (const k of madeKeys) await dropKey(k.source, k.id);
      if (isNew) for (const id of madeLocal) setLocalKey(id, null);
      if (r === "del") return act("del", site);
      return;
    }
    const final = liveKeys();
    try {
      for (const k of final) await persistKey(k, r);
    } catch (e) {
      for (const k of madeKeys) await dropKey(k.source, k.id);
      return toast("密钥保存失败，站点未保存：" + e.message, "error");
    }
    const keep = new Set(final.map((k) => k.secretId).filter(Boolean));
    for (const k of madeKeys) if (!keep.has(k.id)) await dropKey(k.source, k.id);
    Object.assign(s, { name: r.name, source: r.source, url: r.source === "custom" ? r.url : "", note: r.note });
    // 余额框没改（仍是当前余额）时不重设起点
    const balWas = s.manualBalance ? fmtMoney(s.manualBalance.amount, s.manualBalance.cur) : "";
    const balNew = r.bal !== balWas;
    if (balNew) balSetManual(s, r.bal);
    for (const f of ["secretId", "keyMask", "localKey", "localId", "legacyKey", "model", "models", "keys", "keyId"]) delete s[f];
    if (final.length > 1) {
      s.keys = final.map((k) => {
        const out = { id: k.id, name: k.name, secretId: k.secretId || null, keyMask: k.keyMask || "", model: k.model || "", models: k.models || [] };
        if (k.localKey) Object.assign(out, { localKey: true, localId: localIdOf(k) });
        return out;
      });
      s.keyId = final.some((k) => k.id === curKey) ? curKey : final[0].id;
    } else {
      // 一个密钥：照旧记在站点上
      const k = final[0];
      Object.assign(s, { secretId: k.secretId || null, keyMask: k.keyMask || "", model: k.model || r.model || "", models: k.models || [] });
      if (k.localKey) {
        s.localKey = true;
        if (localIdOf(k) !== s.id) s.localId = localIdOf(k);
      }
      if (k.legacyKey) s.legacyKey = k.legacyKey;
    }
    const list = sites();
    const i = list.findIndex((x) => x.id === s.id);
    if (i >= 0) list[i] = s;
    else list.push(s);
    saveSettings();
    render();
    if (balNew && s.manualBalance && settings().activeSiteId === s.id) balanceQuery({ quiet: true });
    // 2.6.7 改的是当前连接的站点、又存了新密钥：storeKey 为了不打断当前连接会切回原来的密钥，
    // 当前连接就一直用旧密钥（测试报 401，「获取模型列表」临时换新密钥所以能拉到）。这里换上新密钥并重新连接
    if (settings().activeSiteId === s.id && (madeKeys.some((m) => keep.has(m.id)) || madeLocal.length)) {
      try {
        await applyConnection(siteMulti(s) ? keyView(s, s.keyId) : s);
        const on = liveConnection().online;
        toast(on ? "已保存，已用新密钥重新连接" : "已保存，用新密钥重新连接未成功，请检查网址和密钥", on ? "success" : "warning");
      } catch (e) {
        toast("已保存，但没能换上新密钥：" + e.message, "error");
      }
      render();
    }
  }
  // 2.5.10 导出、导入站点（JSON 文件）。单密钥站点在文件里也写成只有一个的 keys
  const keysOfSite = (s) => siteMulti(s) ? s.keys : [{ id: null, name: "", secretId: s.secretId || null, keyMask: s.keyMask || "", localKey: !!s.localKey, localId: s.localId, legacyKey: s.legacyKey, model: s.model || "", models: s.models || [] }];
  const savedKey = (k) => !!(k.secretId || k.localKey || k.legacyKey);
  async function keyTextOf(site, k) {
    if (k.secretId) return (await revealSecret(site.source, k.secretId)).value || "";
    if (k.localKey || k.legacyKey) return getLocalKey({ id: site.id, localId: k.localId, legacyKey: k.legacyKey }) || "";
    return "";
  }
  // 2.11.4 账户余额查询：用户 ID + 系统访问令牌。令牌只存在本浏览器
  async function acctSheet(site) {
    const had = !!site.acct;
    const body = el(`<div class="pa-form">
      <p class="pa-hint">在「${esc(site.name || "站点")}」网页的「个人设置」中生成「系统访问令牌」，复制到下面；用户 ID 在同一页。查到的是整个账户的余额，不受密钥额度限制。</p>
      <label class="pa-field"><span>用户 ID</span><input class="pa-input pa-num" data-f="uid" value="${esc(site.acct?.uid || "")}" placeholder="例如：1024" inputmode="numeric" autocomplete="off"></label>
      <label class="pa-field"><span>系统访问令牌</span><input class="pa-input" data-f="token" type="password" value="" placeholder="${had ? "已保存；留空则不改" : "粘贴令牌"}" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
      <p class="pa-hint">${multiKeySupported() ? "令牌存入酒馆密钥库，换设备、换浏览器也能用。" : "酒馆版本较旧，没有密钥库。令牌只保存在这个浏览器里，换设备、换浏览器需要重新填写。"}</p>
    </div>`);
    const v = await sheet({
      title: "查询账户余额",
      body,
      place: "center",
      guardDirty: true,
      actions: [
        { label: "取消", value: null },
        ...had ? [{ label: "停用", value: "off" }] : [],
        { label: "保存并查询", kind: "primary", value: (w) => ({ uid: w.querySelector("[data-f=uid]").value, token: w.querySelector("[data-f=token]").value }),
          validate: (w) => {
            if (had || w.querySelector("[data-f=token]").value.trim()) return true;
            toast("请粘贴系统访问令牌", "warning");
            return false;
          } }
      ]
    });
    if (!v) return false;
    try {
      if (v === "off") { await balSetAcct(site, "", ""); toast("已停用账户余额查询"); return true; }
      // 令牌框留空：只改用户 ID
      if (!v.token.trim()) { site.acct.uid = String(v.uid || "").trim(); return true; }
      if (!await balSetAcct(site, v.uid, v.token)) { toast("浏览器不允许保存令牌（可能是无痕模式）", "error"); return false; }
      return true;
    } catch (e) {
      toast("保存令牌失败：" + e.message, "error");
      return false;
    }
  }
  async function exportSites(btn) {
    const list = sites();
    if (!list.length) return toast("还没有站点");
    const how = await pickBox("导出站点", [
      { label: "含密钥", sub: "密钥为明文", value: "keys" },
      { label: "不含密钥", sub: "仅名称、网址、模型、备注", value: "bare" }
    ], { anchor: btn });
    if (!how) return;
    let missing = 0, blocked = 0;
    const out = [];
    for (const s of list) {
      const keys = [];
      for (const k of keysOfSite(s)) {
        const item = { name: k.name || "", model: k.model || "", models: k.models || [] };
        const bal = balRecordsOf(s, k.secretId);
        if (bal.length) item.balance = bal;
        if (how === "keys" && savedKey(k)) {
          // 2.11.2 读不到时分清原因：酒馆不允许读回密钥（allowKeysExposure 为 false），还是这把密钥已不存在
          const got = k.secretId ? await revealSecret(s.source, k.secretId) : { value: await keyTextOf(s, k) };
          if (got.value) item.key = got.value;
          else { missing++; if (got.blocked) blocked++; }
        }
        keys.push(item);
      }
      out.push({ name: s.name, source: s.source, url: s.url || "", note: s.note || "", keys, ...(s.modelCats?.length ? { cats: s.modelCats.map((c) => ({ name: c.name, models: c.models || [] })) } : {}) });
    }
    // 文件名只用英文数字：有的浏览器遇到中文文件名会存成「download」
    const d = new Date(), two = (n) => String(n).padStart(2, "0");
    const stamp = `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}`;
    downloadBlob(new Blob([JSON.stringify({ format: SITE_FILE_FORMAT, version: 1, exported: d.toISOString(), sites: out }, null, 2)], { type: "application/json" }), `api-sites-${stamp}.json`);
    if (!missing) return toast(`已导出 ${out.length} 个站点${how === "keys" ? "（含密钥）" : ""}`, "success");
    toast(blocked
      ? `已导出 ${out.length} 个站点；${missing} 个密钥未写入：酒馆不允许读回已保存的密钥。在酒馆 config.yaml 中将 allowKeysExposure 改为 true，重启酒馆后再导出`
      : `已导出 ${out.length} 个站点；${missing} 个密钥读不到，未写入`, "warning");
  }
  // 同名、同网址的站点算同一个：更新它，不再新增
  const normUrl = (u) => String(u || "").trim().replace(/\/+$/, "").toLowerCase();
  const sameSite = (f) => sites().find((s) => s.source === f.source && s.name === f.name && normUrl(s.url) === normUrl(f.url));
  async function importSites(file) {
    let found;
    try {
      found = parseSiteFile(await file.text());
    } catch {
      return toast("不是 JSON 文件", "error");
    }
    if (!found.length) return toast("没找到站点（需有 http 开头的网址）", "warning");
    const plan = found.map((f) => ({ f, old: sameSite(f) }));
    const host = (u) => { try { return new URL(u).host; } catch { return u; } };
    const rows = plan.map(({ f, old }) => {
      const n = f.keys.filter((k) => k.key).length;
      const nm = new Set(f.keys.flatMap((k) => k.models || [])).size;
      const what = [old ? "更新" : "新增", f.url ? host(f.url) : SOURCES[f.source].label, n ? `${n} 个密钥` : "没有密钥", nm && `${nm} 个模型`, f.cats.length && `${f.cats.length} 个分类`].filter(Boolean);
      return `<div class="pa-imp-row"><b>${esc(f.name)}</b><small>${esc(what.join(" · "))}</small></div>`;
    }).join("");
    const updates = plan.filter((x) => x.old).length;
    const ok = await sheet({
      title: `导入 ${plan.length} 个站点`,
      place: "center",
      body: `<div class="pa-imp-list">${rows}</div>${updates ? '<p class="pa-hint">更新：同名同网址的站点，密钥和模型列表以文件为准。</p>' : ""}`,
      actions: [{ label: "取消", value: false }, { label: "导入", kind: "primary", value: true }]
    });
    if (!ok) return;
    let added = 0, updated = 0;
    const failed = [];
    for (const { f, old } of plan) {
      try {
        await saveImported(f, old);
        old ? updated++ : added++;
      } catch (e) {
        failed.push(`「${f.name}」${e.message}`);
      }
    }
    saveSettings();
    render();
    const done = [added && `新增 ${added} 个`, updated && `更新 ${updated} 个`].filter(Boolean).join("，");
    if (failed.length) toast(`${done ? done + "；" : ""}未导入：${failed.join("；")}`, "error");
    else toast(`已导入：${done}`, "success");
  }
  async function saveImported(f, old) {
    const s = old || { id: uid(), name: f.name, source: f.source, url: f.url, note: f.note };
    const before = old ? keysOfSite(old) : [];
    const made = [], madeLocal = [];
    const many = f.keys.length > 1;
    const keys = [];
    try {
      for (const [i, ik] of f.keys.entries()) {
        const prev = (ik.name && before.find((k) => k.name === ik.name)) || before[i] || null;
        const k = { id: (many && prev?.id) || uid(), name: ik.name || "", secretId: null, keyMask: "", model: ik.model || prev?.model || "", models: ik.models?.length ? ik.models : prev?.models || [] };
        const keepPrev = () => Object.assign(k, { secretId: prev.secretId || null, keyMask: prev.keyMask || "", localKey: !!prev.localKey, localId: prev.localId, legacyKey: prev.legacyKey });
        if (ik.key && prev && savedKey(prev) && await keyTextOf(s, prev) === ik.key) keepPrev();
        else if (ik.key) {
          if (multiKeySupported()) {
            k.secretId = await storeKey(f.source, ik.key, many ? `麦当劳·${f.name}·${ik.name || `密钥 ${i + 1}`}` : `麦当劳·${f.name}`);
            made.push(k.secretId);
          } else {
            const lid = many ? `${s.id}.${k.id}` : s.id;
            if (!setLocalKey(lid, ik.key)) throw new Error("浏览器不允许保存密钥（可能是无痕模式）");
            madeLocal.push(lid);
            Object.assign(k, { localKey: true, localId: lid });
          }
          k.keyMask = keyMaskOf(ik.key);
        } else if (prev && savedKey(prev)) keepPrev();
        keys.push(k);
      }
    } catch (e) {
      for (const id of made) await dropKey(f.source, id);
      for (const id of madeLocal) if (!old) setLocalKey(id, null);
      throw e;
    }
    if (f.note) s.note = f.note;
    // 分类按名称合并：同名的并进模型，没有的新建
    if (f.cats.length) {
      const mine = s.modelCats || (s.modelCats = []);
      for (const c of f.cats) {
        const hit = mine.find((x) => x.name === c.name);
        if (hit) hit.models = [...new Set([...(hit.models || []), ...c.models])];
        else mine.push({ id: uid(), name: c.name, models: [...c.models] });
      }
    }
    for (const x of ["secretId", "keyMask", "localKey", "localId", "legacyKey", "model", "models", "keys", "keyId"]) delete s[x];
    if (many) {
      s.keys = keys.map((k) => {
        const o = { id: k.id, name: k.name, secretId: k.secretId, keyMask: k.keyMask, model: k.model, models: k.models };
        if (k.localKey) Object.assign(o, { localKey: true, localId: k.localId });
        if (k.legacyKey) o.legacyKey = k.legacyKey;
        return o;
      });
      s.keyId = old?.keyId && keys.some((k) => k.id === old.keyId) ? old.keyId : keys[0].id;
    } else {
      const k = keys[0];
      Object.assign(s, { secretId: k.secretId, keyMask: k.keyMask, model: k.model, models: k.models });
      if (k.localKey) {
        s.localKey = true;
        if (k.localId && k.localId !== s.id) s.localId = k.localId;
      }
      if (k.legacyKey) s.legacyKey = k.legacyKey;
    }
    // 2.11.3 余额记录：文件里带了就用文件的；没带的，从同一浏览器里的焦香鸡翅接过来
    for (const [i, ik] of f.keys.entries()) {
      const k = keys[i];
      if (!k) continue;
      const recs = ik.balance?.length ? ik.balance : await balFromJichi(f.source, s.url, ik.key);
      balMerge(s, k.secretId, recs);
    }
    if (!old) sites().push(s);
  }
  sitesBox.addEventListener("change", (e) => {
    const input = e.target.closest("[data-import-sites]");
    if (!input) return;
    const file = input.files?.[0];
    input.value = "";
    if (file) importSites(file);
  });
  const onChange = (e) => {
    const o = e.target.dataset.o;
    if (o === "chattoast") {
      settings().chatToast = e.target.checked;
      saveSettings();
    }
    if (o === "balshow") {
      settings().balanceShow = e.target.checked;
      saveSettings();
      render();
      if (e.target.checked && settings().balanceAuto) balanceQuery({ quiet: true });
    }
    if (o === "balauto") {
      settings().balanceAuto = e.target.checked;
      saveSettings();
      if (e.target.checked && Date.now() - (balanceSummary().last?.t || 0) > 6e4) balanceQuery();
    }
    if (o === "reasoningfollow") {
      settings().reasoningFollowPreset = e.target.checked;
      // 打开时先记下当前预设现在的推理格式
      if (e.target.checked) { initReasoningFollow(); rememberReasoning(); }
      saveSettings();
      render();
    }
  };
  for (const box of new Set([liveBox, sitesBox, optsBox])) box.addEventListener("change", onChange);
  const onClick = async (e) => {
    const a = e.target.closest("[data-a]")?.dataset.a;
    if (!a) return;
    if (a === "optfold") {
      if (e.target.closest(".pa-optcheck")) return;
      const k = e.target.closest("[data-w]").dataset.w;
      foldSet("opts", k, !foldGet("opts", k));
      return render();
    }
    const site = sites().find((x) => x.id === e.target.closest(".pa-site")?.dataset.id);
    return act(a, site, e.target.closest("button"), e.target);
  };
  // 2.9.1 换站点后按新连接查一次余额（开着「每轮自动」时），余额一栏不停留在上一个站点的状态
  const balAfterSwitch = () => {
    if (!balShown() || !settings().balanceAuto || !liveConnection().online) return;
    setTimeout(() => balanceQuery({ quiet: true }), 300);
  };
  // 2.5.0 用多密钥站点的某个分组连接：换成这个分组的密钥和它上次用的模型
  async function connectKey(target, keyId, btn = null) {
    const k = siteKey(target, keyId);
    if (btn) {
      btn.disabled = true;
      if (btn.querySelector("svg")) btn.classList.add("pa-busy");
      else if (!btn.classList.contains("pa-model-btn")) btn.textContent = "连接中…";
    }
    try {
      const v = keyView(target, k.id);
      await applyConnection(v);
      keepKeyId(target, v);
      target.keyId = k.id;
      settings().activeSiteId = target.id;
      saveSettings();
      const live = liveConnection();
      toast(live.online ? `已连接「${target.name}」· ${keyName(target, k)}` : failMsg(target, k), live.online ? "success" : "warning");
      balAfterSwitch();
    } catch (err) {
      toast(`「${keyName(target, k)}」切换失败：${err.message}`, "error");
    }
    return render();
  }
  // 2.5.0 测试：和酒馆的「发送测试消息」一样，用现在的连接和选中的模型发一句「Hi」，看模型能不能回。
  // 不先重新套用站点，免得把在酒馆里临时换的模型换回去
  async function testModel(btn = null) {
    const c = ctx();
    const svc = c.ChatCompletionService;
    if (typeof svc?.presetToGeneratePayload !== "function") {
      // 旧版酒馆没有独立请求接口：交给酒馆自己的测试按钮，结果看酒馆的提示
      const stBtn = globalThis.jQuery?.("#test_api_button");
      if (stBtn?.length) {
        stBtn.trigger("click");
        return toast("已让酒馆发送测试消息，结果看酒馆弹出的提示", "info");
      }
      return toast("这个酒馆版本不能单独发送测试消息，请到酒馆的 API 设置里点「测试消息」", "warning");
    }
    const live = liveConnection();
    const model = usingModel(live);
    if (!model) return toast("还没有选模型", "warning");
    const active = sites().find((x) => x.id === settings().activeSiteId);
    const k = siteMulti(active) && isSame(active, live) ? siteKey(active) : null;
    if (btn) {
      btn.disabled = true;
      btn.classList.add("pa-busy");
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60e3);
    try {
      const payload = await svc.presetToGeneratePayload({}, {}, { model, messages: [{ role: "user", content: "Hi" }], stream: false, max_tokens: 300, n: 1 });
      // 自己发请求（和酒馆发聊天用同一个接口），才拿得到站点返回的状态码
      const res = await fetch(stUrl("api/backends/chat-completions/generate"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...c.getRequestHeaders?.() || {} },
        body: JSON.stringify(payload),
        cache: "no-cache",
        signal: controller.signal
      });
      const text = await res.text();
      let data = null;
      try { data = JSON.parse(text); } catch {}
      if (!res.ok || data?.error) throw { status: res.status, message: apiErrorText(data) || text.trim() || res.statusText };
      liveTest = { model, source: live.source, url: live.url || "", secretId: live.secretId || null, ok: true, text: k ? `${keyName(active, k)} · Successful` : "Successful" };
    } catch (err) {
      const raw = String(controller.signal.aborted ? "没有回复" : err?.message || "");
      const why = explainApiError(errStatus(err?.status, raw), raw);
      liveTest = { model, source: live.source, url: live.url || "", secretId: live.secretId || null, ok: false, text: k ? `${keyName(active, k)} · ${why}` : why, raw };
    } finally {
      clearTimeout(timer);
    }
    return render();
  }
  // btn：点的按钮（连接、获取时显示进度）；from：点的位置（找推理格式那一行）
  async function act(a, site, btn = null, from = null) {
    // 图标按钮（测试的闪电）忙时闪动，文字按钮换成提示文字
    const busy = (t) => {
      if (!btn) return;
      btn.disabled = true;
      if (btn.querySelector("svg")) btn.classList.add("pa-busy");
      else btn.textContent = t;
    };
    if (a === "reasoningclear") {
      if (!await confirmBox("清除推理格式记录", "清除所有预设记住的推理格式？当前酒馆设置不变。", "清除")) return;
      settings().reasoningByPreset = {};
      if (reasoningFollowOn()) rememberReasoning();
      saveSettings();
      return render();
    }
    if (a === "reasoningedit" || a === "reasoningadd") {
      let name = from?.closest(".pa-rrow")?.dataset.name;
      if (a === "reasoningadd") {
        const store = reasoningStore();
        const items = listPresets().filter((n) => n !== reasoningPreset && !store[n]).map((n) => ({ label: n, value: n }));
        if (!items.length) return toast("所有预设都已有记录", "info");
        name = await pickBox("给哪个预设设置推理格式", items, { hint: "先填入酒馆现在的设置，可再修改。" });
        if (!name) return;
      }
      const cur = name === reasoningPreset;
      const init = cur ? reasoningNow() : reasoningStore()[name] || reasoningNow();
      if (!init) return toast("酒馆没有「推理内容格式化」设置", "warning");
      const r = await editReasoning(name, init, cur);
      if (!r) return;
      reasoningStore()[name] = r;
      if (cur) applyReasoning(r);
      saveSettings();
      toast(cur ? "已改酒馆现在的推理格式" : `已保存「${name}」的推理格式`, "success");
      return render();
    }
    if (a === "reasoningdel") {
      const name = from?.closest(".pa-rrow")?.dataset.name;
      if (!name || !await confirmBox("删除推理格式记录", `删除「${name}」记住的推理格式？切到它时将保持当时的设置。`, "删除", true)) return;
      delete reasoningStore()[name];
      saveSettings();
      return render();
    }
    if (a === "sitefold") {
      foldSet("sites", site.id, !foldGet("sites", site.id));
      return render();
    }
    // 2.5.0 多密钥站点正在用：选模型时一并选分组，换了分组就换密钥重新连接
    if (a === "livemodel") {
      const live = liveConnection();
      const active = sites().find((x) => x.id === settings().activeSiteId);
      if (siteMulti(active) && isSame(active, live)) {
        const k0 = siteKey(active);
        const r = await pickKeyModel(active, { keyId: k0.id, model: live.model });
        if (!r) return render();
        const k = siteKey(active, r.keyId);
        k.model = r.model;
        if (k === k0) {
          setLiveModel(r.model);
          saveSettings();
          toast(`模型已切换为 ${r.model}`, "success");
          return render();
        }
        return connectKey(active, k.id, btn);
      }
    }
    if (a === "livemodel" || a === "sitemodel") {
      const live = liveConnection();
      const target = a === "sitemodel" ? site : sites().find((x) => x.id === settings().activeSiteId);
      const list = a === "livemodel" ? liveModelList(live) : target?.models || [];
      const m = await pickModel(list, a === "livemodel" ? live.model : target?.model, { site: target || null });
      if (!m) return;
      if (target) siteKey(target).model = m;
      if (a === "livemodel" || target?.id === settings().activeSiteId) setLiveModel(m);
      saveSettings();
      toast(`模型已切换为 ${m}`, "success");
      return render();
    }
    if (a === "livefetch") {
      const live = liveConnection();
      const active = sites().find((x) => x.id === settings().activeSiteId);
      const same = isSame(active, live);
      if (live.source === "custom" && !live.url) return toast("当前连接没有网址", "warning");
      if (btn) { btn.disabled = true; btn.classList.add("pa-spin"); }
      // 多密钥站点：每个分组各拉一次
      if (same && siteMulti(active)) {
        const { bad } = await fetchAllKeys(active);
        saveSettings();
        const n = new Set(active.keys.flatMap((k) => k.models || [])).size;
        if (bad.length) toast(`${bad.map((x) => `「${x}」`).join("")}密钥请求失败（额度用完或已失效）`, "warning");
        if (bad.length < active.keys.length) toast(n ? `已拉取 ${n} 个模型，点模型框的 ▾ 选择` : "站点未返回模型，可点模型框手动填写", n ? "success" : "warning");
        return render();
      }
      try {
        const models = await getModels(same ? active : { name: "当前连接", source: live.source, url: live.url || "", secretId: live.secretId });
        liveFetched = { source: live.source, url: live.url || "", models };
        if (same) {
          active.models = models;
          saveSettings();
        }
        toast(models.length ? `已拉取 ${models.length} 个模型，点模型框的 ▾ 选择` : "站点未返回模型，可点模型框手动填写", models.length ? "success" : "warning");
      } catch (err) {
        toast("拉取失败：" + err.message, "error");
      }
      return render();
    }
    if (a === "sitesedit" || a === "sitesdone") {
      sitesEditing = a === "sitesedit";
      return render();
    }
    if (a === "balset") {
      const site0 = balSiteOf();
      if (!site0) return;
      const mb = site0.manualBalance;
      const v = await promptBox(mb ? "改余额" : "填余额", mb ? fmtMoney(mb.amount, mb.cur) : "", "如 50、$50.5、¥300；清空则不再手填");
      if (v == null) return;
      if (!balSetManual(site0, v)) return toast("余额格式不对，如 50、$50.5、¥300", "warning");
      // 记下此刻的用量作为起点，之后的用量从余额里扣
      if (site0.manualBalance) balanceQuery({ quiet: true });
      return render();
    }
    if (a === "balacct") {
      const site0 = balSiteOf();
      if (!site0) return;
      if (await acctSheet(site0)) { saveSettings(); render(); balanceQuery(); }
      return;
    }
    if (a === "new") return editSite(null);
    if (a === "exportsites") return exportSites(btn);
    if (a === "edit") return editSite(site);
    if (a === "fetch") {
      busy("获取中…");
      if (siteMulti(site)) {
        const { bad } = await fetchAllKeys(site);
        saveSettings();
        if (bad.length) toast(`${bad.map((x) => `「${x}」`).join("")}密钥请求失败（额度用完或已失效）`, "warning");
        return render();
      }
      try {
        site.models = await getModels(site);
        saveSettings();
        toast(site.models.length ? `已获取 ${site.models.length} 个模型` : "站点未返回模型", site.models.length ? "success" : "warning");
      } catch (err) {
        toast("获取失败：" + err.message, "error");
      }
      return render();
    }
    if (a === "del") {
      const users = settings().schemes.filter((sc) => schemeConn(sc)?.siteId === site.id);
      if (!await confirmBox("删除站点", `删除「${site.name}」？酒馆密钥库中的密钥不会删除。${users.length ? `${users.length} 个方案使用此站点，将保留其网址、模型和密钥记录。` : ""}`, "删除", true)) return;
      users.forEach((sc) => { sc.conn = { ...schemeConn(sc), siteId: null }; delete sc.siteId; });
      settings().sites = sites().filter((x) => x.id !== site.id);
      if (settings().activeSiteId === site.id) settings().activeSiteId = null;
      saveSettings();
      return render();
    }
    if (a === "testmodel") return testModel(btn);
    if (a === "balq") return balanceQuery();
    if (a === "testraw") return liveTest?.raw && toast(`原文：${liveTest.raw.length > 300 ? liveTest.raw.slice(0, 300) + "…" : liveTest.raw}`, "info");
    if (a === "use" || a === "reconnect") {
      const target = a === "use" ? site : sites().find((x) => x.id === settings().activeSiteId);
      if (siteMulti(target)) return connectKey(target, a === "use" ? from?.closest("[data-k]")?.dataset.k : siteKey(target).id, btn);
      busy("连接中…");
      try {
        if (target) {
          await applyConnection(target);
          settings().activeSiteId = target.id;
          saveSettings();
        } else {
          globalThis.jQuery("#api_button_openai").trigger("click");
          await waitConnect(15e3);
        }
        const live = liveConnection();
        toast(live.online ? `已连接${target ? `「${target.name}」` : ""}` : "已切换，未连接成功，请检查网址和密钥", live.online ? "success" : "warning");
        balAfterSwitch();
      } catch (err) {
        toast("切换失败：" + err.message, "error");
      }
      return render();
    }
    if (a === "capture") {
      await readSecretState();
      const live = liveConnection();
      if (!SOURCES[live.source]) return toast("暂不支持保存当前连接类型", "warning");
      const s = { id: uid(), name: `${SOURCES[live.source].label.split("（")[0]}${live.url ? " " + hostOf(live.url) : ""}`, source: live.source, url: live.url || "", model: live.model || "", models: customModelOptions(), secretId: live.secretId, keyMask: live.secretMask, note: "" };
      sites().push(s);
      settings().activeSiteId = s.id;
      saveSettings();
      toast("已保存为站点", "success");
      render();
    }
  }
  const onKey = (e) => {
    if ((e.key === "Enter" || e.key === " ") && e.target.matches?.(".pa-sghead, .pa-site-mhead")) { e.preventDefault(); e.target.click(); }
  };
  bindWhy(sitesBox);
  dragSort(sitesBox, { grip: ".pa-site-grip", row: ".pa-site", onDrop: (from, to, how) => {
    moveItem(settings().sites, from, to);
    saveSettings();
    render();
    if (how.keyboard) sitesBox.querySelectorAll(".pa-site-grip")[to]?.focus();
  } });
  // 余额查询前后只换余额这一块
  onBalance(() => {
    // 查完（手填余额可能已扣减）整页重画，站点列表的余额跟着变；查询中只换余额这一块
    if (!BAL.busy && liveBox.isConnected && liveBox.querySelector(".pa-bal")) return render();
    const old = liveBox.querySelector(".pa-bal");
    if (!old) return;
    const html = balCard(liveConnection());
    if (html) old.replaceWith(el(html));
    else old.remove();
  });
  for (const box of new Set([liveBox, sitesBox, optsBox])) box.addEventListener("click", onClick);
  for (const box of new Set([sitesBox, optsBox])) box.addEventListener("keydown", onKey);
  return { render };
}
