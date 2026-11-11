var VAR_MACRO = /^(set|get|add|inc|dec|has|flush|delete)(global)?var$|^(global)?varexists$/i;
function scanTopMacros(text) {
  const out = [];
  const s = String(text ?? "");
  let i = 0;
  while (i < s.length) {
    const open2 = s.indexOf("{{", i);
    if (open2 < 0) break;
    let depth = 0;
    let j = open2;
    let end = -1;
    while (j < s.length - 1) {
      if (s[j] === "{" && s[j + 1] === "{") {
        depth++;
        j += 2;
        continue;
      }
      if (s[j] === "}" && s[j + 1] === "}") {
        depth--;
        j += 2;
        if (depth === 0) {
          end = j;
          break;
        }
        continue;
      }
      j++;
    }
    if (end < 0) {
      // 少了一个 } 的笔误（比如 {{user}：…），跳过这个 {{ 接着往后找，后面的 {{getvar}} 照样算
      i = open2 + 2;
      continue;
    }
    out.push({ start: open2, end, inner: s.slice(open2 + 2, end - 2) });
    i = end;
  }
  return out;
}
// 与「变量顺序」检查共用的写法：{{getvar::x}}，也接受单参数的空格写法 {{getvar x}}。
// hasvar / varexists 记为 has（存在判断），deletevar / flushvar 记为 flush。
function parseVarMacro(inner) {
  const head = /^\s*([a-z]+)(?=::|\s|$)/i.exec(inner);
  if (!head) return null;
  const m = VAR_MACRO.exec(head[1]);
  if (!m) return null;
  const op = m[1] ? m[1].toLowerCase() === "delete" ? "flush" : m[1].toLowerCase() : "has";
  const after = inner.slice(head[0].length);
  if (after && !/^(::|\s)/.test(after)) return null;
  const rest = after.trimStart().replace(/^::/, "");
  const second = rest.indexOf("::");
  const name = (second < 0 ? rest : rest.slice(0, second)).trim();
  const value = second < 0 ? null : rest.slice(second + 2);
  return {
    op,
    // set | get | add | inc | dec | has | flush
    scope: m[2] || m[3] ? "global" : "local",
    name,
    value
  };
}
function listVarMacros(text, depth = 0) {
  const res = [];
  if (depth > 6) return res;
  for (const mac of scanTopMacros(text)) {
    // 注释中的示例不参与变量读写或修复判断。
    if (/^\s*\/\//.test(mac.inner)) continue;
    const v = parseVarMacro(mac.inner);
    if (v) {
      res.push({ ...v, start: mac.start, end: mac.end, depth });
      if (v.value) res.push(...listVarMacros(v.value, depth + 1));
    } else {
      res.push(...listVarMacros(mac.inner, depth + 1));
    }
  }
  return res;
}
function isBlankValue(v) {
  return v == null || String(v).trim() === "";
}
function detectShape(content) {
  const text = String(content ?? "");
  if (!text.trim()) return { shape: "empty", body: "" };
  const tops = scanTopMacros(text);
  const parsed = tops.map((t) => ({ ...t, v: parseVarMacro(t.inner) }));
  let outside = "";
  let last = 0;
  for (const t of tops) {
    outside += text.slice(last, t.start);
    last = t.end;
  }
  outside += text.slice(last);
  const outsideTrim = outside.replace(/\{\{\/\/[\s\S]*?\}\}/g, "").trim();
  const writers = parsed.filter((t) => t.v && (t.v.op === "set" || t.v.op === "add"));
  if (!outsideTrim && writers.length && writers.every((w) => isBlankValue(w.v.value))) {
    return { shape: "init", body: "", vars: writers.map((w) => w.v.name) };
  }
  if (!outsideTrim && writers.length) {
    const main = writers.reduce((a, b) => (b.v.value || "").length > (a.v.value || "").length ? b : a);
    if (!isBlankValue(main.v.value)) {
      const extras = parsed.filter((t) => t !== main).map((t) => text.slice(t.start, t.end));
      const raw = main.v.value;
      const lead = /^\s*/.exec(raw)[0];
      const trail = /\s*$/.exec(raw)[0];
      return {
        shape: "wrap",
        op: main.v.op,
        scope: main.v.scope,
        varName: main.v.name,
        body: raw.trim(),
        pad: { lead, trail },
        extras
      };
    }
  }
  const lastTop = parsed[parsed.length - 1];
  if (lastTop && lastTop.v && (lastTop.v.op === "add" || lastTop.v.op === "set") && !isBlankValue(lastTop.v.value) && lastTop.v.value.length <= 200 && !/\n/.test(lastTop.v.value.trim()) && text.slice(lastTop.end).trim() === "" && text.slice(0, lastTop.start).trim().length > 0) {
    const bodyRaw = text.slice(0, lastTop.start);
    if (bodyRaw.trim().length > Math.min(lastTop.v.value.length * 3, 300)) {
      return {
        shape: "tagname",
        op: lastTop.v.op,
        scope: lastTop.v.scope,
        varName: lastTop.v.name,
        label: lastTop.v.value.trim(),
        body: bodyRaw.replace(/\s+$/, ""),
        extras: []
      };
    }
  }
  return { shape: "plain", body: text };
}
var SHAPE_LABEL = {
  wrap: "整段写入变量",
  tagname: "正文直写并登记名称",
  plain: "正文直写",
  init: "变量初始化",
  empty: "空条目"
};
function macroName(op, scope) {
  return `${op}${scope === "global" ? "global" : ""}var`;
}
function buildContent(body, target, opts = {}) {
  const b = String(body ?? "").trim();
  const extras = (opts.extras || []).filter(Boolean);
  const tail = extras.length ? "\n" + extras.join("\n") : "";
  if (target.shape === "wrap" && target.varName) {
    const lead = target.pad?.lead ?? "\n";
    const trail = target.pad?.trail ?? "\n";
    return `{{${macroName(target.op || "add", target.scope)}::${target.varName}::${lead}${b}${trail}}}${tail}`;
  }
  if (target.shape === "tagname" && target.varName) {
    const label = (opts.label || "").trim() || "未命名";
    return `${b}
{{${macroName(target.op || "add", target.scope)}::${target.varName}::${label}}}${tail}`;
  }
  return b + tail;
}
function shortLabel(name) {
  let s = String(name ?? "").trim();
  s = s.replace(/@[^@|｜]*$/, "").trim();
  if (/[|｜]/.test(s)) s = s.split(/[|｜]/).pop().trim();
  s = s.replace(/^[^\p{L}\p{N}]+/u, "").trim();
  s = s.replace(/[（(][^）)]*[）)]\s*$/, "").trim() || s;
  return s || String(name ?? "").trim();
}
function outerTag(body) {
  const m = /^\s*<([A-Za-z_一-鿿][\w一-鿿-]*)(?:([：:])\s*([^>\n]{0,60}))?>/.exec(String(body ?? ""));
  if (!m) return null;
  const tag = m[1];
  const close2 = new RegExp(`</${tag}(?:[：:][^>\\n]{0,60})?>\\s*$`);
  if (!close2.test(body)) return null;
  return { tag, sep: m[2] || "", name: (m[3] || "").trim() };
}
function applyOuterTag(body, tpl, name) {
  let b = String(body ?? "").trim();
  const cur = outerTag(b);
  if (cur) {
    b = b.replace(/^\s*<[^>\n]+>\s*\n?/, "").replace(/\n?\s*<\/[^>\n]+>\s*$/, "");
  }
  const label = tpl.sep ? `${tpl.tag}${tpl.sep}${name}` : tpl.tag;
  return `<${label}>
${b.trim()}
</${label}>`;
}

