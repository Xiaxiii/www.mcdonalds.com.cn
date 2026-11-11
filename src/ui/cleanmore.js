// 1.7.0「清理」的其他几栏：扩展数据、角色卡、世界书、本地备份。
// 只有「扩展数据」和「角色卡」会影响酒馆打开速度（设置文件、角色列表每次打开都下载）；世界书、本地备份只是整理。

// 酒馆自身的设置项，不能删
var CORE_EXT_KEYS = new Set(["disabledExtensions", "autoConnect", "notifyUpdates", "apiUrl", "apiKey", KEY]);
// 酒馆内置功能存在 extension_settings 里的键
var BUILTIN_EXT_KEYS = { note: "作者注释", caption: "图片描述", expressions: "表情", connectionManager: "连接配置", dice: "骰子", gallery: "图库", memory: "总结", quickReply: "快速回复（旧版）", quickReplyV2: "快速回复", regex: "正则", tts: "语音朗读", sd: "图片生成", chromadb: "ChromaDB", translate: "翻译", vectors: "向量存储", variables: "变量", attachments: "附件", character_attachments: "角色附件", disabledAttachments: "附件", cfg: "CFG", objective: "目标", rvc: "RVC", speech_recognition: "语音识别", hypebot: "HypeBot", idle: "空闲提醒", assets: "资源下载", tokenCounter: "Token 计数", gallery_folders: "图库", regex_presets: "正则预设", disabled_attachments: "附件", expressionOverrides: "表情", character_allowed_regex: "正则", preset_allowed_regex: "正则" };
// 名字和扩展文件夹对不上、但已经核对过归属的键（扩展名见 maintenance/compat.js 的 PROVIDERS）
var KNOWN_EXT_KEYS = { tavern_helper: "tavernHelper", baiBaiToolkit: "baibaiTools" };
var normKey = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9一-龥]/g, "");
// 键排好序再转成文字：两本世界书字段顺序不同，内容一样时也能算出同一个指纹
function stableJson(v) {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableJson(v[k])}`).join(",")}}`;
  return JSON.stringify(v ?? null);
}
// discoverExtensions 在 maintenance/compat.js
// 按名称推测这个键属于哪个已安装的扩展（推测，可能不准）
function guessOwner(key, exts) {
  if (BUILTIN_EXT_KEYS[key]) return { builtin: BUILTIN_EXT_KEYS[key] };
  const kid = KNOWN_EXT_KEYS[key];
  if (kid === "self") return { builtin: "本扩展" };
  if (kid) {
    const pv = PROVIDERS.find((x) => x.id === kid);
    const ext = exts?.find((x) => pv.match?.(x)) || null;
    return { known: pv.name, running: !!pv.running?.(), ext };
  }
  if (!exts) return null;
  const nk = normKey(key);
  if (nk.length < 2) return null;
  for (const x of exts) {
    const nf = normKey(x.base), nd = normKey(x.manifest?.display_name);
    if (nf && (nf === nk || nf.includes(nk) || nk.length >= 4 && nk.includes(nf) && nf.length >= 3)) return { ext: x };
    if (nd && (nd === nk || nd.includes(nk) || nk.length >= 4 && nk.includes(nd) && nd.length >= 3)) return { ext: x };
  }
  return null;
}
// 实际检测：下载每个扩展的脚本（顺着相对路径的 import 往下找），看里面有没有用到这个键
async function scanExtensionCode(exts, keys, onProgress) {
  const used = Object.fromEntries(keys.map((k) => [k, []]));
  const res = keys.map((k) => {
    const e = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return [k, new RegExp(`["'\`]${e}["'\`]|\\.${e}\\b`)];
  });
  // 没查完的扩展（文件太多或读取失败），它们有可能用到这些数据
  const partial = [];
  for (const [i, x] of exts.entries()) {
    onProgress?.(i + 1, exts.length, x.manifest?.display_name || x.base);
    const entry = x.manifest?.js;
    if (!entry) continue;
    const root = new URL(`scripts/extensions/${x.name}/`, document.baseURI);
    const queue = [new URL(entry, root).href];
    const seen = new Set();
    let failed = false;
    while (queue.length && seen.size < 400) {
      const u = queue.shift();
      if (seen.has(u)) continue;
      seen.add(u);
      let text = "";
      // 任何一个文件没读到，这个扩展都算没查完
      try {
        const r = await fetch(u);
        if (!r.ok) {
          failed = true;
          continue;
        }
        text = await r.text();
      } catch {
        failed = true;
        continue;
      }
      for (const [k, re] of res) if (re.test(text) && !used[k].includes(x)) used[k].push(x);
      // 只跟进扩展自己文件夹里的模块
      for (const m of text.matchAll(/(?:from\s*|import\s*\(\s*|import\s+)["'](\.{1,2}\/[^"']+)["']/g)) {
        const next = new URL(m[1], u).href;
        if (next.startsWith(root.href) && !seen.has(next)) queue.push(next);
      }
    }
    if (queue.length || failed) partial.push(x);
  }
  return { used, partial };
}
// 角色卡同名提示里点了「忽略」的组。只记在内存里：这次打开酒馆期间不再提示；
// 点「重新检测」或下次打开酒馆重新检测时清空，提示会再出现。组里的角色卡有增减时算新的一组。
var ignoredCharDups = new Set();
// 同名角色卡的完整内容：酒馆按需加载时列表里只有名字和头像（shallow），这里向服务器单独读取同名的几张来比较
var fullChars = new Map();
async function loadFullChar(avatar) {
  if (fullChars.has(avatar)) return fullChars.get(avatar);
  const p = (async () => {
    const r = await stPost("api/characters/get", { avatar_url: avatar });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  })();
  fullChars.set(avatar, p);
  try {
    const v = await p;
    fullChars.set(avatar, v);
    return v;
  } catch (e) {
    fullChars.set(avatar, e instanceof Error ? e : new Error(String(e)));
    throw e;
  }
}
async function deleteCharacterKeepChats(avatar) {
  const r = await stPost("api/characters/delete", { avatar_url: avatar, delete_chats: false });
  if (!r.ok) throw new Error(`删除失败（${r.status}）`);
}
// 2.6.3 酒馆的 deleteWorldInfo 在它的名单里找不到这本书、或后台没删掉时只返回 false，不给原因。
// 这时直接调删除接口；删完或本来就不在了都算删掉，删不掉时写明酒馆给的原因
async function deleteWorldbook(name) {
  if (typeof mods.wi?.deleteWorldInfo === "function" && await mods.wi.deleteWorldInfo(name) !== false) return;
  const r = await stPost("api/worldinfo/delete", { name });
  const text = r.ok ? "" : await r.text().catch(() => "");
  try { await mods.wi?.updateWorldInfoList?.(); } catch {}
  if (r.ok || !listWorldbooks().includes(name)) return;
  if (/exist|ENOENT|not found/i.test(text)) throw new Error("酒馆找不到这本世界书的文件，刷新页面后再试");
  throw new Error(`酒馆返回 ${r.status}${text && text.length < 80 && !/<\w/.test(text) ? `：${text.trim()}` : ""}`);
}
async function backupAll() {
  return ((await tx("backups", "readonly", (s) => s.getAll())) || []).filter(backupMine);
}
async function backupDel(id) {
  await tx("backups", "readwrite", (s) => s.delete(id));
}

function mountCleanKind(kind, box) {
  const S = { sel: new Set(), busy: false };
  const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
  const actBar = (n, size, btns) => n ? `<div class="pa-ck-act"><b>已选 ${n} 个${size ? ` · ${fmtSize(size)}` : ""}</b>${btns}</div>` : "";
  const chk = (id, on, locked) => `<input type="checkbox" data-x="pick" data-k="${esc(id)}" ${on ? "checked" : ""} ${locked ? "disabled" : ""}>`;
  const toggle = (k, on) => on ? S.sel.add(k) : S.sel.delete(k);

  // ---------- 扩展数据 ----------
  if (kind === "ext") {
    let exts = null, scan = null, err = "";
    const rows = () => {
      const es = ctx().extensionSettings || {};
      return Object.keys(es).map((k) => {
        const size = jsonSize(es[k]);
        // 酒馆内置、已核对归属的键不依赖扩展列表；扩展列表读不到时也能标出来
        const owner = guessOwner(k, exts);
        const users = scan?.used[k];
        let state, label;
        if (CORE_EXT_KEYS.has(k)) [state, label] = ["core", k === KEY ? "本扩展" : "酒馆设置"];
        else if (owner?.builtin) [state, label] = ["used", owner.builtin === "本扩展" ? "本扩展" : `酒馆内置：${owner.builtin}`];
        else if (owner?.known && (owner.running || owner.ext)) [state, label] = ["used", `${owner.known}${owner.running ? "在用" : owner.ext?.enabled === false ? "（已停用）" : "（已安装）"}`];
        else if (owner?.known && exts) [state, label] = ["maybe", `${owner.known}的数据，没有找到${owner.known}，可能已卸载`];
        else if (users?.length) [state, label] = ["used", `检测：${users.map((x) => x.manifest?.display_name || x.base).slice(0, 2).join("、")}${users.some((x) => !x.enabled) ? "（已停用）" : ""}在用`];
        else if (scan && owner?.ext) [state, label] = ["maybe", `检测：未找到使用者，但名称像「${owner.ext.manifest?.display_name || owner.ext.base}」，请确认`];
        else if (scan && scan.partial.length) [state, label] = ["maybe", `检测：未找到使用者，但「${scan.partial.map((x) => x.manifest?.display_name || x.base).slice(0, 2).join("、")}」没有查完，请确认`];
        // 没找到使用者不等于可以安全删除（扩展可能用拼出来的名字读数据），只标为「疑似残留」，删前由用户核对
        else if (scan) [state, label] = ["orphan", "检测：已安装扩展的代码里没找到它，疑似卸载残留，删除前请核对"];
        else if (owner?.ext) [state, label] = ["used", `推测属于：${owner.ext.manifest?.display_name || owner.ext.base}${owner.ext.enabled ? "" : "（已停用）"}`];
        else [state, label] = ["maybe", "可能已卸载"];
        return { k, size, state, label };
      }).sort((a, b) => b.size - a.size);
    };
    const draw = () => {
      const list = rows();
      const total = list.reduce((n, r) => n + r.size, 0);
      const max = list[0]?.size || 1;
      const pick = list.filter((r) => S.sel.has(r.k));
      const orphans = list.filter((r) => r.state === "orphan");
      box.innerHTML = `
        <div class="pa-sum"><p class="pa-sum-main">扩展数据 <b>${fmtSize(total)}</b> · ${list.length} 项${orphans.length ? ` · <span class="pa-warn">疑似残留 ${orphans.length}</span>` : ""}</p>
          <div class="pa-tiprow">${tip(`<p>设置文件每次打开酒馆都要下载，每次保存都要上传，删掉已卸载扩展的残留数据能减少这部分。</p>
            <p>「可能已卸载」只是按名称推测。「实际检测」会下载已安装扩展的脚本，查找谁在使用这些数据；扩展用拼接出来的名字读数据时查不出来，结果只能作参考。</p>
            <p>正在使用的数据不能勾选。删除时可先下载备份（JSON），需要时交给对应扩展重新导入。</p>`)}<span class="pa-golinks">${orphans.length ? `<button type="button" class="pa-golink" data-x="pickorphans">勾选 ${orphans.length} 项疑似残留</button>` : ""}<button type="button" class="pa-golink" data-x="scan" ${S.busy ? "disabled" : ""}>${S.busy ? "检测中…" : scan ? "重新检测 ›" : "实际检测 ›"}</button></span></div>
          ${S.busy ? '<p class="pa-hint pa-ck-prog"></p>' : ""}
          ${scan ? `<p class="pa-hint">${orphans.length ? "勾选后请逐项确认名称再删除。" : "没有找到疑似残留的数据。"}${scan.partial.length ? `「${scan.partial.map((x) => x.manifest?.display_name || x.base).join("、")}」没有查完，标「请确认」的需自行判断。` : ""}</p>` : ""}</div>
        ${err ? `<p class="pa-warn">${esc(err)}</p>` : ""}
        <div class="pa-clist">${list.map((r) => `<label class="pa-crow${S.sel.has(r.k) ? " on" : ""}${r.state === "core" || r.state === "used" ? " pa-locked" : ""}">
          ${chk(r.k, S.sel.has(r.k), r.state === "core" || r.state === "used")}
          <span class="pa-crow-main"><b>${esc(r.k)}</b><span class="pa-crow-tags"><span class="pa-chip ${r.state === "orphan" ? "pa-ctag-same" : r.state === "maybe" ? "pa-ctag-old" : r.state === "used" ? "pa-ctag-use" : "pa-chip-dim"}">${esc(r.label)}</span></span></span>
          <span class="pa-crow-size"><i class="pa-bar"><b style="width:${Math.max(2, Math.round(r.size / max * 100))}%"></b></i><em>${fmtSize(r.size)}</em></span></label>`).join("")}</div>
        ${actBar(pick.length, pick.reduce((n, r) => n + r.size, 0), '<button class="pa-btn pa-btn-danger-soft" data-x="del">删除</button>')}`;
    };
    box.addEventListener("change", (e) => {
      if (e.target.dataset.x !== "pick") return;
      toggle(e.target.dataset.k, e.target.checked);
      draw();
    });
    box.addEventListener("click", async (e) => {
      const x = e.target.closest("[data-x]")?.dataset.x;
      if (!x || S.busy) return;
      if (x === "scan") {
        S.busy = true;
        draw();
        try {
          exts ||= await discoverExtensions();
          const keys = Object.keys(ctx().extensionSettings || {}).filter((k) => !CORE_EXT_KEYS.has(k) && !BUILTIN_EXT_KEYS[k]);
          scan = await scanExtensionCode(exts, keys, (i, n, nm) => {
            const p = box.querySelector(".pa-ck-prog");
            if (p) p.textContent = `正在检测 ${i}/${n}：${nm}`;
          });
          for (const k of [...S.sel]) if (scan.used[k]?.length) S.sel.delete(k);
        } catch (er) {
          err = er.message;
        }
        S.busy = false;
        return draw();
      }
      if (x === "pickorphans") {
        for (const r of rows()) if (r.state === "orphan") S.sel.add(r.k);
        return draw();
      }
      if (x === "del") {
        const keys = [...S.sel];
        if (!keys.length) return;
        const es = ctx().extensionSettings;
        const go = await confirmDeleteOfferBackup("删除扩展数据", `<p class="pa-p">将从设置文件中删除 ${keys.length} 项数据：${esc(keys.slice(0, 5).join("、"))}${keys.length > 5 ? " 等" : ""}。删除后不能恢复，需要的话先下载备份（JSON），可交给对应扩展重新导入。如果对应的扩展其实还在使用，它会恢复成默认设置。</p>`, async () => {
          const fname = `extension-data-backup-${stamp()}.json`;
          downloadBlob(new Blob([JSON.stringify(Object.fromEntries(keys.map((k) => [k, es[k]])), null, 2)], { type: "application/json" }), fname);
          return `已让浏览器下载「${esc(fname)}」，可在下载记录里确认。`;
        });
        if (!go) return;
        for (const k of keys) {
          delete es[k];
          S.sel.delete(k);
        }
        ctx().saveSettingsDebounced();
        toast(`已删除 ${keys.length} 项扩展数据`, "success");
        return draw();
      }
    });
    draw();
    discoverExtensions().then((x) => { exts = x; draw(); }).catch((er) => { err = er.message; draw(); });
    return;
  }

  // ---------- 角色卡 ----------
  if (kind === "char") {
    const draw = () => {
      const c = ctx();
      const chars = c.characters || [];
      const cur = chars[Number(c.characterId)]?.avatar;
      const groups = new Map();
      for (const ch of chars) {
        const k = String(ch?.name || "").trim().toLowerCase();
        if (!k) continue;
        (groups.get(k) || groups.set(k, []).get(k)).push(ch);
      }
      const dupKey = (g) => `${String(g[0].name || "").trim().toLowerCase()}\n${g.map((ch) => ch.avatar).sort().join("\n")}`;
      const allDups = [...groups.values()].filter((g) => g.length > 1);
      const dups = allDups.filter((g) => !ignoredCharDups.has(dupKey(g)));
      const nIgnored = allDups.length - dups.length;
      // 忽略的组里不留勾选
      for (const g of allDups) if (ignoredCharDups.has(dupKey(g))) for (const ch of g) S.sel.delete(ch.avatar);
      // 指纹覆盖角色卡的全部内容字段；按需加载（shallow）的角色卡没有完整数据，不判断相同
      const FIELDS = [["description", "描述"], ["personality", "性格"], ["scenario", "场景"], ["first_mes", "开场白"], ["mes_example", "示例对话"], ["alternate_greetings", "备选开场白"], ["system_prompt", "系统提示"], ["post_history_instructions", "历史后指令"], ["creator_notes", "作者备注"], ["character_book", "角色书"], ["tags", "标签"], ["extensions", "扩展数据"]];
      // 完整内容：列表里不是按需加载的直接用；按需加载的用向服务器读到的
      const fullOf = (ch) => {
        if (!ch.shallow) return ch;
        const v = fullChars.get(ch.avatar);
        return v && !(v instanceof Promise) && !(v instanceof Error) ? v : null;
      };
      const fieldVals = (ch) => {
        const f = fullOf(ch);
        if (!f) return null;
        const src = f.data && typeof f.data === "object" ? f.data : f;
        return FIELDS.map(([k]) => hashStr(stableJson(src[k] ?? f[k] ?? null)));
      };
      // 需要读取完整内容的：同名组里按需加载、还没读过的
      const need = allDups.flat().filter((ch) => ch.shallow && !fullChars.has(ch.avatar));
      if (need.length && !S.loadingFull) {
        S.loadingFull = true;
        Promise.allSettled(need.map((ch) => loadFullChar(ch.avatar))).then(() => { S.loadingFull = false; if (box.isConnected) draw(); });
      }
      const pickList = chars.filter((ch) => S.sel.has(ch.avatar));
      box.innerHTML = `
        <div class="pa-sum"><p class="pa-sum-main">角色卡 <b>${chars.length}</b> 张 · ${dups.length ? `<span class="pa-warn">同名 ${dups.length} 组</span>` : allDups.length ? "同名的都已忽略" : "没有同名"}${nIgnored && dups.length ? ` · 已忽略 ${nIgnored} 组` : ""}</p>
          <div class="pa-tiprow">${tip(`<p>角色列表每次打开酒馆都要下载，删除重复的角色卡能减少一些。</p>
            <p>同名角色卡逐项比较描述、性格、场景、开场白、示例对话、角色书、标签等文字内容，列出不同之处。不比较头像图片。</p>
            <p>删除时保留聊天记录。正在聊天的角色卡不能勾选。</p>
            <p>「忽略」：本次打开酒馆期间不再提示该组。「重新检测」：重新读取角色卡内容并比较。</p>`)}<span class="pa-golinks">${dups.length > 1 ? '<button type="button" class="pa-golink" data-x="ignoreall">全部忽略</button>' : ""}${allDups.length || nIgnored ? `<button type="button" class="pa-golink" data-x="recheck" ${S.busy ? "disabled" : ""}>重新检测 ›</button>` : ""}</span></div></div>
        ${dups.map((g) => {
          const vals = g.map(fieldVals);
          const failed = g.some((ch) => fullChars.get(ch.avatar) instanceof Error);
          const unknown = vals.some((x) => x == null);
          const diff = unknown ? [] : FIELDS.filter((_, i) => new Set(vals.map((v) => v[i])).size > 1).map(([, l]) => l);
          const same = !unknown && !diff.length;
          const keep = g.reduce((a, b) => (Number(b.date_last_chat) || 0) > (Number(a.date_last_chat) || 0) ? b : a);
          const label = same ? "文字设定相同（未比较头像图片）" : unknown ? (failed ? "读取失败，无法比较" : "正在读取内容…") : `不同之处：${diff.join("、")}`;
          return `<h3 class="pa-h pa-dup-h">${esc(g[0].name)}<span class="pa-chip ${same ? "pa-ctag-same" : "pa-chip-dim"}">${esc(label)}</span><button type="button" class="pa-golink pa-dup-ign" data-x="ignore" data-g="${esc(dupKey(g))}" title="这次打开酒馆期间不再提示这一组">忽略</button></h3>
          <div class="pa-clist">${g.map((ch) => `<label class="pa-crow${S.sel.has(ch.avatar) ? " on" : ""}${ch.avatar === cur ? " pa-locked" : ""}">${chk(ch.avatar, S.sel.has(ch.avatar), ch.avatar === cur)}
            <span class="pa-crow-main"><b>${esc(ch.avatar)}</b><span class="pa-crow-tags">${ch.avatar === cur ? '<span class="pa-chip pa-chip-cot">正在聊天</span>' : ""}${ch === keep && ch.date_last_chat ? '<span class="pa-chip pa-ctag-use">最近聊过</span>' : ""}${ch.date_last_chat ? `<span class="pa-chip pa-chip-dim">${relDay(Number(ch.date_last_chat)).replace("用过", "聊过")}</span>` : '<span class="pa-chip pa-chip-dim">没有聊过</span>'}${ch.chat_size ? `<span class="pa-chip pa-chip-dim">聊天 ${fmtSize(ch.chat_size)}</span>` : ""}</span></span>
            <span class="pa-crow-size"><em>${ch.data_size ? fmtSize(ch.data_size) : ""}</em></span></label>`).join("")}</div>`;
        }).join("")}
        ${actBar(pickList.length, 0, '<button class="pa-btn pa-btn-danger-soft" data-x="del">删除（保留聊天记录）</button>')}`;
    };
    box.addEventListener("change", (e) => {
      if (e.target.dataset.x !== "pick") return;
      toggle(e.target.dataset.k, e.target.checked);
      draw();
    });
    box.addEventListener("click", async (e) => {
      const xb = e.target.closest("[data-x]");
      const x = xb?.dataset.x;
      if (S.busy) return;
      if (x === "ignore") {
        e.preventDefault();
        ignoredCharDups.add(xb.dataset.g);
        return draw();
      }
      if (x === "ignoreall") {
        for (const b of box.querySelectorAll('[data-x="ignore"]')) ignoredCharDups.add(b.dataset.g);
        return draw();
      }
      if (x === "recheck") {
        ignoredCharDups.clear();
        fullChars.clear();
        S.busy = true;
        draw();
        try {
          await ctx().getCharacters?.();
        } catch {
        }
        S.busy = false;
        return draw();
      }
      if (x !== "del") return;
      const list = [...S.sel];
      if (!await confirmBox("删除角色卡", `将删除 ${list.length} 张角色卡（${list.slice(0, 3).join("、")}${list.length > 3 ? " 等" : ""}），聊天记录保留在服务器上。角色卡删除后无法在酒馆中恢复。`, "删除", true)) return;
      S.busy = true;
      let n = 0;
      const fail = [];
      for (const a of list) {
        try {
          await deleteCharacterKeepChats(a);
          S.sel.delete(a);
          n++;
        } catch (er) {
          fail.push(`${a}：${er.message}`);
        }
      }
      try {
        await ctx().getCharacters?.();
      } catch {
      }
      S.busy = false;
      if (n) toast(`已删除 ${n} 张角色卡`, "success");
      if (fail.length) toast(fail.slice(0, 2).join("；"), "error");
      draw();
    });
    draw();
    return;
  }

  // ---------- 世界书 ----------
  if (kind === "world") {
    let res = null;
    const chars = () => ctx().characters || [];
    const fileBase = (a) => String(a || "").replace(/\.[^.]+$/, "");
    // 角色的附加世界书记在 world_info.charLore 里，按头像文件名（不带扩展名）对应角色
    const charLore = () => {
      const lore = mods.wi?.world_info?.charLore;
      return Array.isArray(lore) ? lore : [];
    };
    const usage = () => {
      const out = {};
      const add = (n, w) => n && (out[n] ||= []).push(w);
      for (const n of mods.wi?.selected_world_info || []) add(n, "全局启用");
      for (const ch of chars()) add(ch?.data?.extensions?.world, `角色「${ch.name}」绑定`);
      const byFile = new Map(chars().map((ch) => [fileBase(ch.avatar), ch]));
      for (const l of charLore()) {
        const ch = byFile.get(l?.name);
        if (ch) for (const n of l.extraBooks || []) add(n, `角色「${ch.name}」附加`);
      }
      add(ctx().chatMetadata?.world_info, "当前聊天绑定");
      return out;
    };
    // 2.5.0 已删除角色卡留下的世界书。导入带世界书的角色卡时，酒馆另存一本世界书（默认名「角色名's Lorebook」，
    // 文件里留有 originalData）；删角色卡不会删它。没人在用、且满足下面任一条的算残留：
    // 1) 名字是「X's Lorebook」，X 不是现有角色；2) 带 originalData，名字对不上任何现有角色；3) 是已删角色的附加世界书
    const leftoverOf = (name, data, use) => {
      if (use[name]?.length) return null;
      const names = new Set(chars().map((ch) => ch.name));
      const files = new Set(chars().map((ch) => fileBase(ch.avatar)));
      const lore = charLore().find((l) => !files.has(l?.name) && (l.extraBooks || []).includes(name));
      if (lore) return { from: lore.name, why: "已删角色的附加世界书" };
      const m = /^(.+)'s Lorebook(?: \(\d+\))?$/.exec(name);
      if (m) return names.has(m[1]) ? null : { from: m[1], why: "角色卡已不在" };
      if (data?.originalData && typeof data.originalData === "object") {
        const own = [name, data.originalData.name].filter(Boolean);
        if (own.some((x) => names.has(x)) || chars().some((ch) => own.includes(ch?.data?.character_book?.name))) return null;
        return { from: null, why: "来自角色卡，角色已不在" };
      }
      return null;
    };
    const draw = () => {
      const names = listWorldbooks();
      const use = usage();
      const pickN = [...S.sel].length;
      let html = `<div class="pa-sum"><p class="pa-sum-main">世界书 <b>${names.length}</b> 本</p>
        ${tip(`<p>世界书只在用到时才下载，删除不会让酒馆打开变快，只是更整齐。</p>
          <p>检查要把全部世界书下载一遍，世界书多、网速慢时要等一会儿。找出三类：条目完全相同的、没有条目的、已删除角色卡留下的。删除时可先下载备份（zip）。</p>
          <p>条目相同：比较每个条目的正文和全部设置（关键词、启用、概率、位置、深度等），只忽略条目编号和排列下标。</p>
          <p>角色卡留下的：导入带世界书的角色卡时，酒馆会另存一本世界书，删除角色卡时不会一起删。列出没被任何现有角色、全局或当前聊天使用，且名为「某某's Lorebook」、或文件里有角色卡导入记录、或是已删角色附加的世界书。改过名的角色会被当成已删除；其他聊天绑定的世界书查不到，请看一眼名字再删。</p>
          <p>标有「绑定」「附加」「全局启用」的世界书删除后，对应的角色或聊天将失去它。</p>`)}
        <div class="pa-card-act"><button class="pa-btn pa-btn-soft pa-btn-s" data-x="scan" ${S.busy ? "disabled" : ""}>${res ? "重新检查" : "检查全部世界书"}</button><span class="pa-hint pa-ck-prog"></span></div></div>`;
      if (res) {
        const groups = [...res.byHash.values()].filter((g) => g.length > 1);
        const row = (w, extra = "") => `<label class="pa-crow${S.sel.has(w.name) ? " on" : ""}">${chk(w.name, S.sel.has(w.name), false)}
          <span class="pa-crow-main"><b>${esc(w.name)}</b><span class="pa-crow-tags"><span class="pa-chip pa-chip-dim">${w.n} 条</span>${extra}${(use[w.name] || []).slice(0, 2).map((u) => `<span class="pa-chip pa-ctag-use">${esc(u)}</span>`).join("")}</span></span>
          <span class="pa-crow-size"><em>${fmtSize(w.size)}</em></span></label>`;
        // 扫描后又绑定上的，不再算残留
        const left = res.left.filter((w) => !use[w.name]?.length);
        const leftTag = (w) => `<span class="pa-chip pa-ctag-old">${esc(w.from ? `原角色「${w.from}」· ${w.why}` : w.why)}</span>`;
        if (res.failed.length) html += `<p class="pa-warn">${res.failed.length} 本读取失败，没有参与比对：${esc(res.failed.slice(0, 4).join("、"))}${res.failed.length > 4 ? " 等" : ""}</p>`;
        html += groups.length ? `<h3 class="pa-h">条目完全相同（${groups.length} 组）</h3>${groups.map((g) => `<div class="pa-clist pa-ck-group">${g.map((w) => row(w)).join("")}</div>`).join("")}` : '<p class="pa-empty">没有条目完全相同的世界书。</p>';
        if (res.empty.length) html += `<h3 class="pa-h">没有条目的世界书（${res.empty.length}）</h3><div class="pa-clist">${res.empty.map((w) => row(w)).join("")}</div>`;
        const leftOff = left.filter((w) => !S.sel.has(w.name));
        html += left.length ? `<div class="pa-hrow"><h3 class="pa-h">已删除角色卡留下的（${left.length}）</h3>${leftOff.length ? `<button type="button" class="pa-golink" data-x="pickleft">勾选 ${leftOff.length} 本</button>` : ""}</div><div class="pa-clist pa-ck-left">${left.map((w) => row(w, leftTag(w))).join("")}</div>` : '<p class="pa-empty">没有已删除角色卡留下的世界书。</p>';
      }
      html += actBar(pickN, 0, '<button class="pa-btn pa-btn-danger-soft" data-x="del">删除</button>');
      box.innerHTML = html;
    };
    box.addEventListener("change", (e) => {
      if (e.target.dataset.x !== "pick") return;
      toggle(e.target.dataset.k, e.target.checked);
      draw();
    });
    box.addEventListener("click", async (e) => {
      const x = e.target.closest("[data-x]")?.dataset.x;
      if (!x || S.busy) return;
      if (x === "scan") {
        S.busy = true;
        draw();
        const names = listWorldbooks();
        const byHash = new Map(), empty = [], failed = [], left = [];
        const use = usage();
        res = null;
        for (const [i, n] of names.entries()) {
          const p = box.querySelector(".pa-ck-prog");
          if (p) p.textContent = `正在读取 ${i + 1}/${names.length}：${n}`;
          try {
            const data = await mods.wi.loadWorldInfo(n);
            const list = wiSorted(data);
            const w = { name: n, n: list.length, size: jsonSize(data) };
            const lo = leftoverOf(n, data, use);
            if (lo) left.push({ ...w, ...lo });
            if (!list.length) { empty.push(w); continue; }
            // 比较条目的全部设置（启用、概率、位置、深度……），只忽略编号和排列下标
            const h = hashStr(JSON.stringify(list.map((e2) => {
              const { uid: _u, displayIndex: _d, ...rest } = e2;
              return stableJson(rest);
            })));
            (byHash.get(h) || byHash.set(h, []).get(h)).push(w);
          } catch {
            failed.push(n);
          }
        }
        res = { byHash, empty, failed, left };
        S.busy = false;
        return draw();
      }
      if (x === "pickleft") {
        const use = usage();
        for (const w of res?.left || []) if (!use[w.name]?.length) S.sel.add(w.name);
        return draw();
      }
      if (x === "del") {
        const list = [...S.sel];
        const use = usage();
        const bound = list.filter((n) => use[n]?.length);
        // 2.6.1 备份不强制：弹窗提醒，可先下载备份，也可直接删
        const names = `${list.slice(0, 4).join("、")}${list.length > 4 ? " 等" : ""}`;
        const usedNote = bound.length ? `其中 ${bound.join("、")} 正被使用，删除后对应的角色或聊天将失去它。` : "";
        const go = await confirmDeleteOfferBackup("删除世界书", `<p class="pa-p">将删除 ${list.length} 本世界书：${esc(names)}。删除后不能恢复，需要的话先下载备份。${esc(usedNote)}</p>`, async () => {
          const files = [], unread = [];
          for (const n of list) {
            try {
              const data = await mods.wi.loadWorldInfo(n);
              if (!data || typeof data !== "object") throw new Error("读取结果为空");
              files.push({ name: `${n}.json`, data: JSON.stringify(data, null, 2) });
            } catch {
              unread.push(n);
            }
          }
          const fname = `worldbooks-backup-${stamp()}.zip`;
          if (files.length) downloadBlob(makeZip(files), fname);
          return `${files.length ? `已让浏览器下载「${esc(fname)}」，可在下载记录里确认。` : ""}${unread.length ? `${esc(unread.join("、"))} 读取失败，没有备份进去。` : ""}`;
        });
        if (!go) return;
        S.busy = true;
        let ok = 0;
        const fail = [];
        for (const n of list) {
          try {
            await deleteWorldbook(n);
            S.sel.delete(n);
            ok++;
          } catch (er) {
            fail.push(`「${n}」${er.message}`);
          }
        }
        // 2.6.3 失败的合成一条提示
        if (fail.length) toast(`${fail.length} 本没有删除：${fail.slice(0, 3).join("；")}${fail.length > 3 ? " 等" : ""}`, "error");
        if (res) {
          for (const g of res.byHash.values()) for (let i = g.length - 1; i >= 0; i--) if (!listWorldbooks().includes(g[i].name)) g.splice(i, 1);
          res.empty = res.empty.filter((w) => listWorldbooks().includes(w.name));
          res.left = res.left.filter((w) => listWorldbooks().includes(w.name));
          res.failed = res.failed.filter((n) => listWorldbooks().includes(n));
        }
        S.busy = false;
        if (ok) toast(`已删除 ${ok} 本世界书`, "success");
        return draw();
      }
    });
    draw();
    return;
  }

  // ---------- 本地备份（本扩展在这个浏览器里存的东西） ----------
  if (kind === "local") {
    let info = null;
    // 2.5.0 自动备份的设置默认折起，标题行显示开关和保留几份。2.6.8 记住最后一次的展开、收起
    const bkIsOpen = () => foldGet("clean", "backup", false);
    const load = async () => {
      const all = await backupAll().catch(() => []);
      const by = new Map();
      for (const b of all) {
        const g = by.get(b.preset) || by.set(b.preset, { name: b.preset, list: [], size: 0 }).get(b.preset);
        g.list.push(b);
        g.size += jsonSize(b.data);
      }
      for (const g of by.values()) g.list.sort((a, b) => b.time - a.time);
      let drafts = 0, draftN = 0;
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k?.startsWith("mcdonalds:recovery:")) { draftN++; drafts += (localStorage.getItem(k) || "").length * 2; }
        }
      } catch {
      }
      const est = await navigator.storage?.estimate?.().catch(() => null);
      info = { groups: [...by.values()].sort((a, b) => b.size - a.size), total: [...by.values()].reduce((n, g) => n + g.size, 0), count: all.length, drafts, draftN, est };
    };
    // 2.4.2：自动备份开关和保留份数（1–30）
    const setCard = () => {
      const on = backupOn(), n = backupMax();
      return `<div class="pa-bk-set${on ? "" : " pa-off"}${bkIsOpen() ? " open" : ""}">
          <div class="pa-bk-row pa-bk-head" data-bk="fold" role="button" tabindex="0" aria-expanded="${bkIsOpen()}"><span class="pa-sgcaret" aria-hidden="true">${bkIsOpen() ? "▾" : "▸"}</span><b>自动备份</b><small class="pa-bk-sum">${on ? `每个预设保留 ${n} 份` : ""}</small><label class="pa-switch"><input type="checkbox" data-bk="on" aria-label="自动备份" ${on ? "checked" : ""}><i></i></label></div>
          ${on ? "" : '<p class="pa-bk-warn">已关闭。此后的修改无法从备份恢复。</p>'}
          ${!bkIsOpen() ? "</div>" : `${on ? '<p class="pa-hint">修改预设前自动备份，可从右上角 ⟲ 恢复。</p>' : ""}
          <div class="pa-bk-row pa-bk-cnt"><span>每个预设保留</span><span class="pa-bk-num"><span class="pa-bk-step"><button type="button" data-bk="dec" aria-label="减少" ${on && n > 1 ? "" : "disabled"}>−</button><input data-bk="n" inputmode="numeric" aria-label="保留份数" value="${n}" ${on ? "" : "disabled"}><button type="button" data-bk="inc" aria-label="增加" ${on && n < 30 ? "" : "disabled"}>＋</button></span>份</span></div>
          <p class="pa-hint pa-bk-note">注：世界书缝合、编辑前的备份同样适用。</p></div>`}`;
    };
    const extra = () => {
      const n = backupMax();
      const over = (info?.groups || []).filter((g) => g.list.length > n);
      const list = over.flatMap((g) => g.list.slice(n));
      return { n, groups: over.length, list, size: list.reduce((t, b) => t + jsonSize(b.data), 0) };
    };
    const draw = () => {
      if (!info) { box.innerHTML = setCard() + '<p class="pa-hint">正在统计…</p>'; return; }
      const max = info.groups[0]?.size || 1;
      box.innerHTML = setCard() + `
        <div class="pa-sum"><p class="pa-sum-main">备份 <b>${info.count}</b> 份 · <b>${fmtSize(info.total)}</b>${info.draftN ? ` · 草稿 ${info.draftN} 份` : ""}</p>
          ${tip(`<p>这些备份只存在这个浏览器里，不影响酒馆打开速度；占用过多时，iPad、手机可能清除网站数据或重新加载页面。</p>
            ${info.draftN ? `<p>未保存的草稿约 ${fmtSize(info.drafts)}。</p>` : ""}
            ${info.est?.usage ? `<p>这个网站在本浏览器中共占用约 ${fmtSize(info.est.usage)}（含酒馆和其他扩展）。</p>` : ""}`)}
          <div class="pa-card-act"><button class="pa-btn pa-btn-s" data-x="trim" ${extra().list.length ? "" : "disabled"}>立即精简</button><button class="pa-btn pa-btn-s pa-btn-danger-soft" data-x="clear" ${info.count ? "" : "disabled"}>删除全部备份</button></div></div>
        <div class="pa-rank">${info.groups.map((g) => `<div><span>${esc(g.name)}（${g.list.length} 份）</span><i class="pa-bar"><b style="width:${Math.max(2, Math.round(g.size / max * 100))}%"></b></i><em>${fmtSize(g.size)}</em></div>`).join("") || '<p class="pa-hint">没有备份。</p>'}</div>`;
    };
    const setMax = (v) => {
      const n = Math.min(30, Math.max(1, Math.round(Number(v)) || backupMax()));
      settings().backupMax = n;
      saveSettings();
      draw();
    };
    box.addEventListener("change", (e) => {
      const k = e.target.dataset?.bk;
      if (k === "on") {
        settings().autoBackup = e.target.checked;
        saveSettings();
        draw();
      } else if (k === "n") setMax(e.target.value);
    });
    box.addEventListener("keydown", (e) => {
      if ((e.key === "Enter" || e.key === " ") && e.target.matches?.('[data-bk="fold"]')) { e.preventDefault(); e.target.click(); }
    });
    box.addEventListener("click", async (e) => {
      const bk = e.target.closest("[data-bk]")?.dataset.bk;
      if (bk === "dec" || bk === "inc") return setMax(backupMax() + (bk === "inc" ? 1 : -1));
      if (bk === "fold") {
        if (e.target.closest(".pa-switch")) return;
        foldSet("clean", "backup", !bkIsOpen());
        return draw();
      }
      const x = e.target.closest("[data-x]")?.dataset.x;
      if (!x || S.busy || !info) return;
      let del;
      if (x === "clear") {
        if (!await confirmBox("删除全部备份", `删除本浏览器中的全部 ${info.count} 份备份。`, "删除", true)) return;
        del = info.groups.flatMap((g) => g.list);
      } else {
        const ex = extra();
        if (!ex.list.length) return;
        const ok = await sheet({
          place: "center",
          title: `精简至每个预设 ${ex.n} 份`,
          body: `<p class="pa-p">${ex.groups} 个预设超出，共 ${ex.list.length} 份，${fmtSize(ex.size)}。</p><p class="pa-hint">暂不删除的，将在下次修改时清理。</p>`,
          actions: [{ label: "暂不删除", value: false }, { label: `删除 ${ex.list.length} 份`, kind: "danger", value: true }]
        });
        if (!ok) return;
        del = ex.list;
      }
      S.busy = true;
      for (const b of del) await backupDel(b.id).catch(() => {});
      S.busy = false;
      toast(`已删除 ${del.length} 份备份`, "success");
      info = null;
      draw();
      await load();
      draw();
    });
    draw();
    load().then(draw);
  }
}
