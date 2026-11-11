// 只检查可见回复的标签与明显格式问题，也不索取思考过程。改写只在用户确认「修正标签」或开了自动修正后进行，且只改名、移动或补写标签。
// 2.5.1 先清理再校验：全角转半角，去掉看不见的零宽字符和误填的尖括号；中文输入法打出的「——」当作下划线。
// 出错时 error.field 指明是哪个输入框（body / thinking / required），界面把报错写在那个框下面
function replyRuleError(message, field) {
  const e = new Error(message);
  e.field = field;
  return e;
}
function replyRuleTag(value, label, field) {
  const raw = typeof value === "string" ? value : "";
  const tag = raw.normalize("NFKC").replace(/[\u200B-\u200D\u2060\uFEFF]/gu, "").replace(/——/gu, "_").trim().replace(/^<\/?\s*|\s*\/?>$/gu, "");
  if (!/^[A-Za-z_\u3400-\u9fff][A-Za-z0-9_\u3400-\u9fff-]{0,39}$/u.test(tag)) {
    throw replyRuleError(`${label}「${raw.trim()}」不是有效的标签名：以字母、中文或下划线开头，只用字母、数字、中文、下划线、短横线，最多 40 个字`, field);
  }
  return tag;
}

function normalizeReplyRules(input) {
  if (input == null) input = {};
  if (typeof input !== "object" || Array.isArray(input)) throw new Error("回复格式规则须为对象");
  const bodyTag = replyRuleTag(input.bodyTag === undefined ? "content" : input.bodyTag, "正文标签", "body");
  const thinkingTags = ["think", "thinking"];
  const addThinking = (tag) => {
    const name = replyRuleTag(tag, "思考标签", "thinking");
    if (!thinkingTags.some((x) => x.toLowerCase() === name.toLowerCase())) thinkingTags.push(name);
  };
  // 同时接受本函数已经规范化的结果，便于检查器与提醒器共用规则。
  if (input.thinkingTags !== undefined) {
    if (!Array.isArray(input.thinkingTags)) throw new Error("思考标签列表须为数组");
    input.thinkingTags.forEach(addThinking);
  }
  if (input.thinkingTag !== undefined && input.thinkingTag !== "") addThinking(input.thinkingTag);
  const thinkingKeys = new Set(thinkingTags.map((tag) => tag.toLowerCase()));
  if (thinkingKeys.has(bodyTag.toLowerCase())) throw replyRuleError("正文标签不可与思考标签重复", "body");
  let required = input.requiredTags === undefined ? [] : input.requiredTags;
  if (typeof required === "string") required = required.split(/[,，、;；\s]+/u).filter(Boolean);
  if (!Array.isArray(required)) throw new Error("必需标签须为数组或用逗号、空白分隔的字符串");
  const requiredTags = [];
  for (const value of required) {
    const tag = replyRuleTag(value, "必需标签", "required");
    if (thinkingKeys.has(tag.toLowerCase())) throw replyRuleError(`必需标签「${tag}」不可是思考标签`, "required");
    if (!requiredTags.some((x) => x.toLowerCase() === tag.toLowerCase())) requiredTags.push(tag);
  }
  const out = { bodyTag, thinkingTags, requiredTags };
  // 2.9.0 可选项：正文标签外允许有文字；提醒时照范本的标签顺序写（remindBySample 关掉时不带）
  if (input.allowOutside) out.allowOutside = true;
  if (Array.isArray(input.skeleton) && input.skeleton.length && input.remindBySample !== false) {
    const skeleton = [];
    for (const value of input.skeleton) {
      let tag;
      try { tag = replyRuleTag(value, "范本标签", "required"); } catch { continue; }
      if (!thinkingKeys.has(tag.toLowerCase()) && !skeleton.some((x) => x.toLowerCase() === tag.toLowerCase())) skeleton.push(tag);
    }
    if (skeleton.length) out.skeleton = skeleton;
  }
  return out;
}

// 2.5.7 按行切开、每行保留结尾的换行。不用后行断言 /(?<=\n)/：iOS 16.4 以前的 Safari 不认，整个扩展会加载失败
function replyLines(text) {
  return text.match(/[^\n]*\n|[^\n]+$/g) || [""];
}

// 按出现顺序进入代码或注释，代码里的注释符、注释里的围栏不改变外层状态。
// 同时屏蔽常见的单行 Markdown 反引号代码示例。
// 保留字符位置与换行；preserveCode 用于检查可见正文，保留代码内容。
function replyCheckMask(text, preserveCode = false) {
  const blank = (part) => part.replace(/[^\r\n]/g, " ");
  let fence = null;
  let inComment = false;
  return replyLines(text).map((line) => {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*?)(?:\r?\n)?$/.exec(line);
    if (fence) {
      if (marker && marker[1][0] === fence.char && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
      return preserveCode ? line : blank(line);
    }
    if (!inComment && marker && !(marker[1][0] === "`" && marker[2].includes("`"))) {
      fence = { char: marker[1][0], length: marker[1].length };
      return preserveCode ? line : blank(line);
    }
    let cursor = 0;
    let result = "";
    while (cursor < line.length) {
      if (inComment) {
        const close = line.indexOf("-->", cursor);
        const end = close < 0 ? line.length : close + 3;
        result += blank(line.slice(cursor, end));
        cursor = end;
        inComment = close < 0;
      } else {
        const start = line.indexOf("<!--", cursor);
        const tick = line.indexOf("`", cursor);
        if (tick >= 0 && (start < 0 || tick < start)) {
          result += line.slice(cursor, tick);
          let runEnd = tick + 1;
          while (line[runEnd] === "`") runEnd++;
          const ticks = /`+/g;
          ticks.lastIndex = runEnd;
          let close;
          while ((close = ticks.exec(line)) && close[0].length !== runEnd - tick) {}
          if (close) {
            const end = close.index + close[0].length;
            const code = line.slice(tick, end);
            result += preserveCode ? code : blank(code);
            cursor = end;
          } else {
            // 没有成对结束的反引号只是普通字符，不吞掉后面的真实标签。
            result += line.slice(tick, runEnd);
            cursor = runEnd;
          }
          continue;
        }
        const end = start < 0 ? line.length : start;
        result += line.slice(cursor, end);
        cursor = end;
        inComment = start >= 0;
      }
    }
    return result;
  }).join("");
}

// 正文标签外、未被任何成对标签包住的文字。代码块与注释已被遮住，单个 HTML 标签本身不算字。
function replyPairRanges(masked) {
  const ranges = [];
  const stack = [];
  const any = /<\s*(\/?)\s*([A-Za-z_\u3400-\u9fff][A-Za-z0-9_\u3400-\u9fff-]*)(?:\s+[^<>]*?)?\s*(\/?)>/gu;
  let match;
  while ((match = any.exec(masked))) {
    if (match[3]) continue;
    const key = match[2].toLowerCase();
    if (!match[1]) { stack.push({ key, start: match.index }); continue; }
    const index = stack.map((open) => open.key).lastIndexOf(key);
    if (index < 0) continue;
    ranges.push({ key, start: stack[index].start, end: any.lastIndex });
    stack.splice(index);
  }
  return ranges;
}
function replyLooseText(source, masked, covered) {
  const ranges = [...covered, ...replyPairRanges(masked)].sort((a, b) => a.start - b.start);
  const parts = [];
  let cursor = 0;
  const take = (end) => {
    if (end <= cursor) return;
    const visible = masked.slice(cursor, end).replace(/<[^<>]*>/g, (tag) => " ".repeat(tag.length));
    const letters = (visible.match(/[\p{L}\p{N}]/gu) || []).length;
    if (letters) parts.push({ start: cursor, end, letters, excerpt: source.slice(cursor, end).replace(/<[^<>]*>/g, "").replace(/\s+/g, " ").trim().slice(0, 80) });
  };
  for (const range of ranges) {
    take(range.start);
    cursor = Math.max(cursor, range.end);
  }
  take(masked.length);
  return parts;
}

// 推理字段只在本地查标签位置，不展示、不发送。正文标签已在可见回复里时不看推理，避免把模型自述的计划误判。
function replyReasoningHasBody(reasoning, bodyTag) {
  const text = replyCheckMask(String(reasoning || ""));
  const name = bodyTag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`<\\s*${name}(?:\\s+[^<>]*?)?\\s*>`, "iu").test(text);
}

// 2.5.6 必需标签整个没出现、回复里却多了预设没用到的块：可能是模型把标签名写错了（如把 <card_status> 写成 <状态栏>）。
// knownTags 是预设开着的条目和正则里出现过的标签名（小写）；没有就不判断。也可以是函数（用到时才去扫预设），只在确实缺了必需标签时才调用。
// 2.5.7 看结构：knownTags.children 记着预设里这个必需标签内部的子标签，陌生块里也有其中的子标签才算确定（sure）。
// 确定时提醒点名、自动修正改名；只有一个陌生块但结构看不出来时配成一对但不确定，只做一般提醒，手动修正可看预览后改
function replyMisnamed(source, rules, knownTags, masked = replyCheckMask(source)) {
  if (!knownTags || !rules.requiredTags.length) return null;
  const present = new Set(replyTagTokens(masked).map((t) => t.key));
  const missing = rules.requiredTags.filter((tag) => !present.has(tag.toLowerCase()));
  if (!missing.length) return null;
  if (typeof knownTags === "function") knownTags = knownTags();
  if (!(knownTags instanceof Set)) return null;
  const skip = new Set([rules.bodyTag, ...rules.thinkingTags, ...rules.requiredTags].map((tag) => tag.toLowerCase()));
  const strangers = replyTopBlocks(source).filter((b) => b.key !== REPLY_FENCE_KEY && !skip.has(b.key) && !knownTags.has(b.key));
  // 只缺一个必需标签时：陌生块里只有一个结构对得上的，认定是它；只有一个陌生块时也配对，但不算确定
  let pairs = [];
  if (missing.length === 1) {
    const expected = knownTags.children?.get(missing[0].toLowerCase());
    const fits = (b) => !!expected && replyTagTokens(masked.slice(b.start, b.end)).some((t) => t.key !== b.key && expected.has(t.key));
    const sure = strangers.filter(fits);
    if (sure.length === 1) pairs = [{ tag: missing[0], block: sure[0], sure: true }];
    else if (strangers.length === 1) pairs = [{ tag: missing[0], block: strangers[0], sure: false }];
  }
  return { missing, suspects: strangers, pairs, knownTags };
}

// 2.8.3 必需标签外面多套了一层预设没用到的标签（如 <状态栏><card_status>…</card_status></状态栏>）：
// 外层块里除了必需标签没有别的文字时才算。外层标签在预设、角色卡、世界书或正则里出现过的不算（可能是预设要求的容器）；读不到这些时不判断
function replyWrapped(source, rules, knownTags, masked = replyCheckMask(source)) {
  if (!knownTags || !rules.requiredTags.length) return [];
  const required = new Set(rules.requiredTags.map((tag) => tag.toLowerCase()));
  const skip = new Set([rules.bodyTag, ...rules.thinkingTags].map((tag) => tag.toLowerCase()));
  const found = [];
  for (const b of replyTopBlocks(source)) {
    if (b.key === REPLY_FENCE_KEY || required.has(b.key) || skip.has(b.key)) continue;
    const openEnd = masked.indexOf(">", b.start) + 1, closeStart = masked.lastIndexOf("<", b.end - 1);
    if (openEnd <= 0 || closeStart < openEnd) continue;
    const inner = masked.slice(openEnd, closeStart);
    const lead = inner.search(/\S/);
    if (lead < 0) continue;
    const head = /^<\s*([A-Za-z_\u3400-\u9fff][A-Za-z0-9_\u3400-\u9fff-]*)/u.exec(inner.slice(lead));
    const tag = head && rules.requiredTags.find((t) => t.toLowerCase() === head[1].toLowerCase());
    if (!tag) continue;
    const pair = replyPairRanges(inner).find((r) => r.start === lead && r.key === tag.toLowerCase());
    if (!pair || inner.slice(pair.end).trim()) continue;
    if (typeof knownTags === "function") knownTags = knownTags();
    if (!(knownTags instanceof Set)) return [];
    if (knownTags.has(b.key)) continue;
    found.push({ tag, block: b, openEnd, closeStart });
  }
  return found;
}
function checkReplyFormat(text, inputRules, extra = {}) {
  const rules = normalizeReplyRules(inputRules);
  const source = String(text == null ? "" : text);
  const masked = replyCheckMask(source);
  const bodyKey = rules.bodyTag.toLowerCase();
  const thinking = new Set(rules.thinkingTags.map((tag) => tag.toLowerCase()));
  const required = new Map([rules.bodyTag, ...rules.requiredTags].map((tag) => [tag.toLowerCase(), tag]));
  const watched = new Set([...required.keys(), ...thinking]);
  const stats = new Map([...watched].map((key) => [key, { opens: 0, closes: 0, selfClosing: 0, ranges: [] }]));
  const issues = [];
  const seen = new Set();
  const add = (kind, text, tag, excerpt) => {
    const key = `${kind}\n${tag || ""}\n${text}`;
    if (!seen.has(key)) {
      seen.add(key);
      issues.push({ kind, text, ...(tag ? { tag } : {}), ...(excerpt ? { excerpt } : {}) });
    }
  };
  const stack = [];
  const scopeRanges = [];
  const tags = /<\s*(\/?)\s*([A-Za-z_\u3400-\u9fff][A-Za-z0-9_\u3400-\u9fff-]*)(?:\s+[^<>]*?)?\s*(\/?)>/gu;
  let match;
  while ((match = tags.exec(masked))) {
    const key = match[2].toLowerCase();
    if (!watched.has(key)) continue;
    const stat = stats.get(key);
    const closing = !!match[1];
    const selfClosing = !!match[3];
    const tag = required.get(key) || rules.thinkingTags.find((name) => name.toLowerCase() === key);
    const inThinking = stack.some((open) => thinking.has(open.key));
    const inBody = stack.some((open) => open.key === bodyKey);
    if (required.has(key) && inThinking) add("swallowed", `「${tag}」标签落在思考标签内部，正文或必需内容可能被吞入思考区`, tag);
    if (thinking.has(key) && inBody) add("leak", `正文内部出现「${tag}」思考标签，可能夹入了思考内容`, tag);
    if (selfClosing) {
      stat.selfClosing++;
      add("order", `「${tag}」须使用完整的开始、结束标签，不能自闭合`, tag);
      continue;
    }
    if (!closing) {
      stat.opens++;
      if (thinking.has(key) && inThinking) add("order", "思考标签互相嵌套，闭合结构不正确", tag);
      stack.push({ key, tag, start: match.index, contentStart: tags.lastIndex });
      continue;
    }
    stat.closes++;
    const index = stack.map((open) => open.key).lastIndexOf(key);
    if (index < 0) {
      add("order", `「${tag}」结束标签前没有对应的开始标签`, tag);
      continue;
    }
    if (index !== stack.length - 1) add("order", `「${tag}」与其他标签交叉，闭合顺序不正确`, tag);
    const open = stack.splice(index, 1)[0];
    const range = { start: open.start, contentStart: open.contentStart, contentEnd: match.index, end: tags.lastIndex, key };
    stat.ranges.push(range);
    if (key === bodyKey || thinking.has(key)) scopeRanges.push(range);
  }
  for (const open of stack) {
    add("order", `「${open.tag}」开始标签没有闭合`, open.tag);
    if (open.key === bodyKey || thinking.has(open.key)) scopeRanges.push({ start: open.start, end: source.length, key: open.key });
  }
  const misnamed = replyMisnamed(source, rules, extra.knownTags, masked);
  const wrapped = replyWrapped(source, rules, extra.knownTags, masked);
  for (const w of wrapped) add("wrapped", `<${w.tag}> 外面多套了一层 <${w.block.name}>，预设、角色卡和世界书都没有用到 <${w.block.name}>`, w.tag);
  for (const [key, tag] of required) {
    const stat = stats.get(key);
    const pair = misnamed?.pairs.find((p) => p.tag === tag);
    const as = pair && `；回复里的 <${pair.block.name}> 预设没有用到，${pair.sure ? "多半" : "可能"}是写错了名字的 <${tag}>`;
    if (!stat.opens && !stat.closes) add("missing", `缺少完整的 <${tag}>…</${tag}> 标签${as || ""}`, tag);
    else if (!stat.opens) add("missing", `缺少 <${tag}> 开始标签`, tag);
    else if (!stat.closes) add("missing", `缺少 </${tag}> 结束标签`, tag);
    if (stat.opens + stat.selfClosing > 1 || stat.closes > 1) add("duplicate", `「${tag}」应完整成对出现一次，当前重复出现`, tag);
  }
  const body = stats.get(bodyKey);
  const reasoning = typeof extra.reasoning === "string" ? extra.reasoning : "";
  if (!body.opens && !body.closes && reasoning.trim()) {
    if (replyReasoningHasBody(reasoning, rules.bodyTag)) add("reasoning", `酒馆把带 <${rules.bodyTag}> 的部分解析进了思考区，聊天里看到的正文可能缺失或不全`, rules.bodyTag);
    else if (!source.replace(/<[^<>]*>/g, "").trim() && reasoning.trim().length >= 200) add("reasoning", "可见回复为空，但思考区有大段内容；正文可能被整段解析进思考区", rules.bodyTag);
  }
  // 正文已在可见回复里，思考区末尾却还留着本该在正文外的块（照前几条回复和必需标签判断）
  let learned;
  const layoutOf = () => learned === undefined ? (learned = replyLayoutValue(extra.layout)) : learned;
  if (body.opens && replyEndsWithBlock(reasoning)) {
    const stuck = replyStrandedBlocks(source, reasoning, rules, layoutOf());
    if (stuck.length) add("stranded", `思考区末尾留着 ${replyBlockLabel(stuck)}，本该在正文外（照前几条回复或必需标签判断），可能是和正文一起被吞进了思考区`);
  }
  if (body.opens && !rules.allowOutside) {
    const covered = [...scopeRanges];
    for (const [key] of required) for (const range of stats.get(key).ranges) covered.push(range);
    const firstBody = Math.min(...body.ranges.map((range) => range.start), ...scopeRanges.filter((range) => range.key === bodyKey).map((range) => range.start));
    for (const part of replyLooseText(replyCheckMask(source, true), masked, covered)) {
      if (part.letters < 20) continue;
      if (part.end <= firstBody) add("outside", `正文标签前有约 ${part.letters} 字没有被任何标签包住，可能是外泄的思考或分析（爆思维链）`, rules.bodyTag, part.excerpt);
      else add("outside", `正文结束后还有约 ${part.letters} 字没有被标签包住，可能是外泄的分析、总结或掉出正文的段落`, rules.bodyTag, part.excerpt);
    }
  }
  const visibleSource = replyCheckMask(source, true);
  for (const range of stats.get(bodyKey).ranges) {
    const content = visibleSource.slice(range.contentStart, range.contentEnd).replace(/<[^<>]*>/g, "").trim();
    if (!content) add("empty", "正文标签内没有可见正文", rules.bodyTag);
  }
  // 这里只标记正文与已知思考区之外的明确步骤标题；语义泄露仍须人工判断。
  const heading = /^ {0,3}(?:#{1,6}\s*)?(?:(?:思考|分析|推理)(?:过程|步骤|阶段)?|Analysis|Reasoning|Thinking)(?:\s*[：:]\s*.*|\s*)$|^ {0,3}(?:#{1,6}\s*)?(?:Step|Phase)\s+\d+(?:\s*[.:：)\-–—]\s*.*|\s+.*|\s*)$/i;
  let offset = 0;
  for (const line of replyLines(masked)) {
    const first = offset + line.search(/\S|$/);
    if (heading.test(line.trimEnd()) && !scopeRanges.some((range) => first >= range.start && first < range.end)) {
      add("suspected", "正文标签外出现疑似思考或推理步骤标题，请人工确认是否泄露了内部分析");
    }
    offset += line.length;
  }
  return { issues, rules, layout: issues.length ? layoutOf() : null, misnamed: issues.length ? misnamed : null, wrapped: issues.length ? wrapped : [] };
}

function buildReplyReminder(report, inputRules) {
  if (!report?.issues?.length) return "";
  const rules = normalizeReplyRules(inputRules || report.rules);
  const tags = [rules.bodyTag, ...rules.requiredTags].filter((tag, index, list) => list.findIndex((item) => item.toLowerCase() === tag.toLowerCase()) === index);
  const kinds = new Set(report.issues.map((issue) => issue.kind));
  const body = `<${rules.bodyTag}>`;
  // 2.6.1 只点名正文标签和用户填的必需标签。以前会照前几条回复点名正文外的块（状态栏、小剧场等）让它们照常输出，
  // 结果预设本来不要求的 <状态栏> 被越提醒越多；写错名的必需标签另有一句改回来
  const mis = report.misnamed;
  // 按上一轮的具体问题加一句针对性要求，只说格式。不写「无需展示思考」之类的话：预设要求写思考时会互相打架，
  // 预填了思考开头的模型可能干脆不写思考、直接在思考区里写正文
  const extra = [];
  if (kinds.has("swallowed") || kinds.has("reasoning") || kinds.has("stranded")) extra.push(`上一轮的输出被写进了思考区：思考标签必须在${report.layout?.head?.length ? "第一个输出块（正文或正文前的块）" : ` ${body} `}开始之前闭合。`);
  if (report.issues.some((issue) => issue.kind === "outside" && issue.text.startsWith("正文标签前"))) extra.push(`上一轮在 ${body} 之前直接输出了分析文字：正文标签外不要写任何分析、计划或说明。`);
  else if (kinds.has("outside")) extra.push(`上一轮在 </${rules.bodyTag}> 之后还有零散文字：正文结束后不追加说明或总结。`);
  if (kinds.has("leak")) extra.push(`正文内不得出现思考标签。`);
  const sure = mis?.pairs.filter((p) => p.sure) || [];
  // 2.8.1 不写出错误的标签名：提醒在最后一条消息的位置，写出「不要输出 <状态栏>」反而让模型照抄，自动修正后每轮都提醒，错名一直延续
  if (sure.length) for (const { tag } of sure) extra.push(`上一轮 <${tag}> 的标签名写错了：外层标签必须写作 <${tag}>…</${tag}>，一字不改。`);
  else if (mis?.suspects.length) extra.push(`上一轮没有 ${mis.missing.map((t) => `<${t}>`).join("、")}：必需标签的名字一字不改，不要换成别的标签名。`);
  // 同样不写出外层的错误标签名
  for (const tag of new Set((report.wrapped || []).map((w) => w.tag))) extra.push(`上一轮在 <${tag}> 外面多套了一层标签：<${tag}>…</${tag}> 直接输出，外面不套其他标签。`);
  if (kinds.has("missing")) extra.push(`上一轮掉了标签：开头和结尾的标签名一字不改。`);
  // 2.9.0 有范本时照范本的标签顺序写；范本里没有的必需标签补在后面
  if (rules.skeleton) {
    const has = (list, tag) => list.some((x) => x.toLowerCase() === tag.toLowerCase());
    const ordered = [...rules.skeleton, ...tags.filter((tag) => !has(rules.skeleton, tag))];
    return `【回复格式提醒】请按这个顺序输出，标签名一字不改，各完整成对出现一次：${ordered.map((tag) => `<${tag}>…</${tag}>`).join("、")}。全部置于思考标签之外。${extra.join("")}正文不夹入思考步骤或内部分析。这条提醒只管格式，剧情照常接着写。`;
  }
  return `【回复格式提醒】请让 ${tags.map((tag) => `<${tag}>…</${tag}>`).join("、")} 各完整成对出现一次，准确闭合，并置于思考标签之外。${extra.join("")}正文不夹入思考步骤或内部分析。这条提醒只管格式，剧情照常接着写。`;
}

// 2.9.0 范本：一份格式正确的回复里，思考标签之外最外层的标签名，按出现顺序（不存正文）
function replySampleSkeleton(text, inputRules) {
  const rules = normalizeReplyRules(inputRules);
  const thinking = new Set(rules.thinkingTags.map((tag) => tag.toLowerCase()));
  const names = [];
  for (const b of replyTopBlocks(String(text == null ? "" : text))) {
    if (b.key === REPLY_FENCE_KEY || thinking.has(b.key) || names.some((x) => x.toLowerCase() === b.key)) continue;
    try { names.push(replyRuleTag(b.name, "范本标签", "required")); } catch {}
    if (names.length >= 12) break;
  }
  return names;
}
// 2.9.0 按范本诊断：把一份格式正确的回复交给检查器，凡是报出的问题都算设置与范本不符，逐条给出改法。
// patch 是可以直接写回设置的改动（bodyTag / requiredTags / allowOutside / enabled / autoFix）；改设置消除不了的只说明原因。
// after 是按 patch 改完后再查一遍的结果
function diagnoseReplySample(text, inputRules, extra = {}) {
  const rules = normalizeReplyRules(inputRules);
  const source = String(text == null ? "" : text);
  const report = checkReplyFormat(source, rules, extra);
  const low = (tag) => tag.toLowerCase();
  const thinking = new Set(rules.thinkingTags.map(low));
  const blocks = replyTopBlocks(source).filter((b) => b.key !== REPLY_FENCE_KEY && !thinking.has(b.key));
  let required = [...rules.requiredTags];
  const advice = [], patch = {}, done = new Set();
  const once = (key) => done.has(key) ? false : (done.add(key), true);
  const drop = (tag) => { required = required.filter((t) => low(t) !== low(tag)); };
  for (const issue of report.issues) {
    const isBody = issue.tag && low(issue.tag) === low(rules.bodyTag);
    if (issue.kind === "missing" && isBody) {
      if (!once("body")) continue;
      const cands = blocks.filter((b) => !required.some((t) => low(t) === b.key));
      const pick = cands.find((b) => REPLY_BODY_ALIASES.includes(b.key)) || cands.slice().sort((a, b) => (b.end - b.start) - (a.end - a.start))[0];
      if (pick) {
        patch.bodyTag = pick.name;
        advice.push({ text: `范本用 <${pick.name}> 包正文，设置里填的是 <${rules.bodyTag}>：正文标签改为 ${pick.name}。` });
      } else {
        patch.enabled = false;
        patch.autoFix = false;
        advice.push({ text: `范本没有用标签包正文，设置却要求 <${rules.bodyTag}>：关闭「下一轮提醒 AI」和「自动修正回复问题」。` });
      }
    } else if (issue.kind === "missing" && issue.tag) {
      if (!once(`req:${low(issue.tag)}`)) continue;
      const pair = report.misnamed?.pairs.find((p) => low(p.tag) === low(issue.tag));
      drop(issue.tag);
      if (pair) {
        required.push(pair.block.name);
        advice.push({ text: `范本里没有 <${issue.tag}>，同一位置是 <${pair.block.name}>：必需标签 ${issue.tag} 改为 ${pair.block.name}。` });
      } else advice.push({ text: `范本里没有 <${issue.tag}>：从必需标签中去掉 ${issue.tag}。` });
    } else if (issue.kind === "wrapped") {
      const w = (report.wrapped || []).find((x) => low(x.tag) === low(issue.tag));
      if (!w || !once(`wrap:${w.block.key}`)) continue;
      required.push(w.block.name);
      advice.push({ text: `范本里 <${w.tag}> 外面有一层 <${w.block.name}>：把 ${w.block.name} 也填进必需标签，这一层即按正常处理。` });
    } else if (issue.kind === "duplicate" && issue.tag && !isBody) {
      if (!once(`dup:${low(issue.tag)}`)) continue;
      drop(issue.tag);
      advice.push({ text: `范本里 <${issue.tag}> 出现多次，必需标签按各出现一次检查：从必需标签中去掉 ${issue.tag}。` });
    } else if (issue.kind === "outside") {
      if (!once("outside")) continue;
      patch.allowOutside = true;
      advice.push({ text: "范本在正文标签外有成段文字：勾选「正文标签外允许有文字」。" });
    } else advice.push({ text: `改设置消除不了：${issue.text}。请确认这份范本本身完整、未被截断。`, manual: true });
  }
  const same = required.length === rules.requiredTags.length && required.every((t, i) => t === rules.requiredTags[i]);
  if (!same) patch.requiredTags = required.filter((t, i) => required.findIndex((x) => low(x) === low(t)) === i);
  let next = rules;
  try { next = normalizeReplyRules({ ...rules, ...patch, skeleton: undefined }); } catch {}
  const changed = Object.keys(patch).length > 0;
  // 改了正文标签后才查得到的问题（如正文外的文字）：按改后的设置再诊断，合并成一次给出
  const depth = extra.depth || 0;
  if (changed && depth < 3) {
    const more = diagnoseReplySample(source, next, { ...extra, depth: depth + 1 });
    const fresh = more.advice.filter((a) => !a.manual || !advice.some((x) => x.text === a.text));
    return { report, advice: [...advice, ...fresh.filter((a) => !advice.some((x) => x.text === a.text))], patch: { ...patch, ...more.patch }, after: more.after, skeleton: more.skeleton };
  }
  return { report, advice, patch, after: changed ? checkReplyFormat(source, next, extra) : report, skeleton: replySampleSkeleton(source, next) };
}

// ---- 修正标签：只改名、补齐或移动标签，不增删正文文字。修不了的返回 null，交给人工。
var REPLY_BODY_ALIASES = ["正文", "正文内容", "内容", "故事", "回复", "content", "contents", "body", "main", "maintext", "main_text", "story", "text", "reply", "response", "output"];
function replyTagTokens(masked, keys) {
  const out = [];
  const tags = /<\s*(\/?)\s*([A-Za-z_\u3400-\u9fff][A-Za-z0-9_\u3400-\u9fff-]*)(?:\s+[^<>]*?)?\s*(\/?)>/gu;
  let match;
  while ((match = tags.exec(masked))) {
    const key = match[2].toLowerCase();
    if (keys && !keys.has(key)) continue;
    out.push({ key, name: match[2], closing: !!match[1], selfClosing: !!match[3], start: match.index, end: tags.lastIndex });
  }
  return out;
}
function replyBodyAlias(source, masked, rules) {
  const thinking = new Set(rules.thinkingTags.map((tag) => tag.toLowerCase()));
  const taken = new Set(rules.requiredTags.map((tag) => tag.toLowerCase()));
  const names = REPLY_BODY_ALIASES.filter((name) => !thinking.has(name.toLowerCase()) && !taken.has(name.toLowerCase()));
  if (!names.some((name) => name.toLowerCase() === rules.bodyTag.toLowerCase())) names.push(rules.bodyTag);
  const escaped = names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const forms = [
    [new RegExp(`<\\s*(${escaped})\\s*>`, "giu"), (name) => new RegExp(`<\\s*/\\s*${name}\\s*>`, "iu")],
    [new RegExp(`【\\s*(${escaped})\\s*】`, "giu"), (name) => new RegExp(`【\\s*/\\s*${name}\\s*】`, "iu")],
    [new RegExp(`\\[\\s*(${escaped})\\s*\\]`, "giu"), (name) => new RegExp(`\\[\\s*/\\s*${name}\\s*\\]`, "iu")]
  ];
  for (const [openRe, closeOf] of forms) {
    let open;
    while ((open = openRe.exec(masked))) {
      const isBody = open[1].toLowerCase() === rules.bodyTag.toLowerCase();
      // 尖括号写法的正确标签名已由检查器处理；这里只接手方括号写法或别名
      if (isBody && open[0].startsWith("<")) continue;
      const rest = masked.slice(openRe.lastIndex);
      const close = closeOf(open[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).exec(rest);
      return {
        open: { start: open.index, end: openRe.lastIndex, raw: source.slice(open.index, openRe.lastIndex) },
        close: close ? { start: openRe.lastIndex + close.index, end: openRe.lastIndex + close.index + close[0].length, raw: close[0] } : null
      };
    }
  }
  return null;
}
// ---- 正文外的完整块（状态栏、小剧场等）：正文被吞进思考区时一起搬出来，位置照前几条回复学。代码块记作 ```
var REPLY_FENCE_KEY = "```";
// 完整的代码块（围栏）；注释里的、没结束的不算
function replyFenceRanges(text, kept = replyCheckMask(text, true)) {
  const out = [];
  let open = null, offset = 0;
  for (const line of replyLines(kept)) {
    const m = /^ {0,3}(`{3,}|~{3,})(.*?)(?:\r?\n)?$/.exec(line);
    if (open) {
      if (m && m[1][0] === open.char && m[1].length >= open.length && !m[2].trim()) {
        out.push({ key: REPLY_FENCE_KEY, name: REPLY_FENCE_KEY, start: open.start, end: offset + line.replace(/\r?\n$/, "").length });
        open = null;
      }
    } else if (m && !(m[1][0] === "`" && m[2].includes("`"))) open = { char: m[1][0], length: m[1].length, start: offset + line.search(/\S/) };
    offset += line.length;
  }
  return out;
}
// [from, to) 里最外层的完整块：成对标签和代码块，按位置排序
// 成对标签只会嵌套或分开，不会交叉：按开头排序扫一遍，被前一个外层块包住的跳过（重 HTML 状态栏也是线性）
function replyTopBlocks(text, from = 0, to = text.length, kept) {
  const all = [...replyPairRanges(replyCheckMask(text)), ...replyFenceRanges(text, kept)].filter((r) => r.start >= from && r.end <= to).sort((a, b) => a.start - b.start || b.end - a.end);
  const top = [];
  let reach = -1;
  for (const r of all) {
    if (r.end <= reach) continue;
    reach = r.end;
    top.push(r.name ? r : { ...r, name: /^<\s*([^\s<>\/]+)/.exec(text.slice(r.start, r.start + 60))?.[1] || r.key });
  }
  return top;
}
// 从 [start, end) 往前后走，收下紧挨着的完整块（中间只能是空白或注释），accept(块, "head"|"tail") 决定收不收
function replyBlockChain(text, start, end, from, to, accept) {
  const kept = replyCheckMask(text, true);
  const blocks = replyTopBlocks(text, from, to, kept);
  const heads = [], tails = [];
  let head = start, tail = end;
  for (let b; (b = blocks.filter((x) => x.end <= head).at(-1)) && !kept.slice(b.end, head).trim() && accept(b, "head");) { heads.unshift(b); head = b.start; }
  for (let b; (b = blocks.find((x) => x.start >= tail)) && !kept.slice(tail, b.start).trim() && accept(b, "tail");) { tails.push(b); tail = b.end; }
  return { start: head, end: tail, heads, tails };
}
// 前几条回复（最近的在前）里正文前、后各有哪些完整块；只看最近 3 条有正文标签的
function learnReplyLayout(texts, inputRules) {
  const rules = normalizeReplyRules(inputRules);
  const bodyKey = rules.bodyTag.toLowerCase();
  const thinking = new Set(rules.thinkingTags.map((tag) => tag.toLowerCase()));
  const layout = { head: [], tail: [], names: {} };
  let used = 0;
  for (const text of texts || []) {
    if (used >= 3) break;
    const source = String(text == null ? "" : text);
    const blocks = replyTopBlocks(source);
    const main = blocks.find((b) => b.key === bodyKey);
    if (!main) continue;
    used++;
    for (const b of blocks) {
      if (b.key === bodyKey || thinking.has(b.key)) continue;
      const side = b.end <= main.start ? layout.head : layout.tail;
      if (!side.includes(b.key)) side.push(b.key);
      layout.names[b.key] ||= b.name;
    }
  }
  return layout;
}
// 本该在正文外的块：前几条回复里出现在正文外的，加上必需标签
// layout 可以是函数（用到时才去学前几条回复），这里统一取值
function replyLayoutValue(layout) {
  return typeof layout === "function" ? layout() : layout || null;
}
function replyKnownBlocks(rules, layout) {
  const keys = new Set([...(layout?.head || []), ...(layout?.tail || []), ...rules.requiredTags.map((tag) => tag.toLowerCase())]);
  keys.delete(rules.bodyTag.toLowerCase());
  for (const tag of rules.thinkingTags) keys.delete(tag.toLowerCase());
  return keys;
}
// 可见回复已有正文时，思考区末尾还留着、可见回复里却没有的已知块（同名只认最后一个）
// 末尾（去掉空白）是标签或代码块围栏才可能留着块；先用这个便宜的判断挡掉绝大多数回复
function replyEndsWithBlock(text) {
  const tail = String(text || "").slice(-400).trimEnd();
  return tail.endsWith(">") || /(?:^|\n) {0,3}(?:`{3,}|~{3,})$/.test(tail);
}
function replyStrandedBlocks(text, reasoning, inputRules, layout) {
  const rules = normalizeReplyRules(inputRules);
  const known = replyKnownBlocks(rules, layout);
  const source = String(reasoning || "");
  if (!known.size || !replyEndsWithBlock(source)) return [];
  const mes = String(text == null ? "" : text);
  const have = new Set(replyTagTokens(replyCheckMask(mes)).map((t) => t.key));
  if (/^ {0,3}(`{3,}|~{3,})/m.test(replyCheckMask(mes, true))) have.add(REPLY_FENCE_KEY);
  const seen = new Set();
  return replyBlockChain(source, source.length, source.length, 0, source.length, (b) => known.has(b.key) && !have.has(b.key) && !seen.has(b.key) && !!seen.add(b.key)).heads;
}
function replyBlockLabel(blocks) {
  return blocks.map((b) => b.key === REPLY_FENCE_KEY ? "代码块" : `<${b.name}>`).join("、");
}
function planReplyFix(text, inputRules, extra = {}) {
  const rules = normalizeReplyRules(inputRules);
  const body = rules.bodyTag, bodyKey = body.toLowerCase();
  const thinking = new Set(rules.thinkingTags.map((tag) => tag.toLowerCase()));
  const requiredKeys = new Set(rules.requiredTags.map((tag) => tag.toLowerCase()));
  let mes = String(text == null ? "" : text);
  let reasoning = typeof extra.reasoning === "string" ? extra.reasoning : null;
  const steps = [];
  const layout = replyLayoutValue(extra.layout);
  const known = replyKnownBlocks(rules, layout);
  // 紧挨着正文的块：后面的完整块都算正文外的输出；前面的只认前几条回复里出现在正文外的，免得把思考里的步骤块搬出来
  const nearBody = (b, side) => b.key !== bodyKey && !thinking.has(b.key) && (side === "tail" || known.has(b.key));
  const bodyTokens = () => replyTagTokens(replyCheckMask(mes), new Set([bodyKey])).filter((t) => !t.selfClosing);
  // 0. 思考外泄（爆思维链，2.4.1）：回复开头一段没被任何标签包住的文字，原样移进思考区。
  //    开头若是标签（如没闭合的 <thinking>）交给后面的步骤；只移到下一行开头的标签或注释为止，后面的锚定注释、标题等不动
  {
    const masked = replyCheckMask(mes);
    const firstBody = bodyTokens().find((t) => !t.closing);
    const lead = firstBody && replyLooseText(replyCheckMask(mes, true), masked, replyPairRanges(masked))[0];
    const from = masked.search(/\S/);
    if (lead && lead.letters >= 20 && lead.end <= firstBody.start && from >= lead.start && mes[from] !== "<") {
      const next = /\n[ \t]*</g;
      next.lastIndex = from;
      const hit = next.exec(mes);
      const to = hit && hit.index < lead.end ? hit.index : lead.end;
      const block = mes.slice(from, to).trim();
      const letters = (replyCheckMask(block).match(/[\p{L}\p{N}]/gu) || []).length;
      if (letters >= 20) {
        reasoning = (reasoning && reasoning.trim() ? reasoning.trimEnd() + "\n\n" : "") + block;
        const head = mes.slice(0, from).trimEnd();
        mes = head + (head ? "\n" : "") + mes.slice(to).trimStart();
        steps.push(`把正文前约 ${letters} 字没被标签包住的思考（爆思维链）移进思考区`);
      }
    }
  }
  // 1. 正文被酒馆解析进思考区：把思考区里的正文块移回可见回复开头，紧挨着的状态栏、小剧场等一起搬
  if (reasoning && !bodyTokens().length && replyReasoningHasBody(reasoning, body)) {
    const masked = replyCheckMask(reasoning);
    const tokens = replyTagTokens(masked, new Set([bodyKey])).filter((t) => !t.selfClosing);
    const open = tokens.find((t) => !t.closing);
    const close = open && tokens.find((t) => t.closing && t.start > open.start);
    const chain = replyBlockChain(reasoning, open.start, close ? close.end : reasoning.length, 0, reasoning.length, nearBody);
    let block = reasoning.slice(chain.start, chain.end).trim();
    if (!close) block += `\n</${body}>`;
    reasoning = (reasoning.slice(0, chain.start).trimEnd() + "\n" + reasoning.slice(chain.end).trimStart()).trim();
    mes = block + (mes.trim() ? "\n" + mes.trimStart() : "");
    const withs = [chain.heads.length && `前面的 ${replyBlockLabel(chain.heads)}`, chain.tails.length && `后面的 ${replyBlockLabel(chain.tails)}`].filter(Boolean);
    steps.push(`把思考区里的 <${body}>…</${body}>${withs.length ? ` 连同${withs.join("、")} 一起` : ""}移回可见回复开头${close ? "" : "，并补上结束标签"}`);
  }
  // 2. 正文标签写错名或用了方括号：改成配置的正文标签
  if (!bodyTokens().length) {
    const alias = replyBodyAlias(mes, replyCheckMask(mes), rules);
    if (alias) {
      const { open, close } = alias;
      mes = mes.slice(0, open.start) + `<${body}>` + (close ? mes.slice(open.end, close.start) + `</${body}>` + mes.slice(close.end) : mes.slice(open.end));
      steps.push(close ? `把 ${open.raw}…${close.raw} 改成 <${body}>…</${body}>` : `把 ${open.raw} 改成 <${body}>`);
    }
  }
  // 2b.（2.5.6）必需标签写错了名字：只缺一个必需标签、回复里只多一个预设没用到的块时，把那个块改名，内容不动
  {
    // extra.strict（自动修正用）：只改结构对得上的；手动修正有预览，配成一对就改
    const mis = replyMisnamed(mes, rules, extra.knownTags);
    for (const { tag, block, sure } of mis?.pairs || []) {
      if (extra.strict && !sure) continue;
      const masked = replyCheckMask(mes);
      const openEnd = masked.indexOf(">", block.start) + 1;
      const closeStart = masked.lastIndexOf("<", block.end - 1);
      if (openEnd <= 0 || closeStart < openEnd) continue;
      mes = mes.slice(0, block.start) + `<${tag}>` + mes.slice(openEnd, closeStart) + `</${tag}>` + mes.slice(block.end);
      steps.push(`把 <${block.name}>…</${block.name}> 改名为 <${tag}>…</${tag}>`);
    }
  }
  // 2c.（2.8.3）必需标签外面多套的一层预设没用到的标签：去掉外层的开始、结束标签，里面不动
  for (const w of replyWrapped(mes, rules, extra.knownTags).reverse()) {
    mes = mes.slice(0, w.block.start) + mes.slice(w.openEnd, w.closeStart).trim() + mes.slice(w.block.end);
    steps.push(`去掉 <${w.tag}> 外面多套的 <${w.block.name}>…</${w.block.name}>`);
  }
  // 3. 正文落在思考标签里
  {
    const masked = replyCheckMask(mes);
    const tokens = replyTagTokens(masked, new Set([bodyKey, ...thinking])).filter((t) => !t.selfClosing);
    const bodyOpen = tokens.find((t) => t.key === bodyKey && !t.closing);
    const thinkOpen = bodyOpen && [...tokens].reverse().find((t) => thinking.has(t.key) && !t.closing && t.start < bodyOpen.start);
    if (thinkOpen) {
      const thinkClose = tokens.find((t) => t.key === thinkOpen.key && t.closing && t.start > thinkOpen.start);
      const closedBefore = thinkClose && thinkClose.start < bodyOpen.start;
      const bodyClose = tokens.find((t) => t.key === bodyKey && t.closing && t.start > bodyOpen.start);
      // 正文前后紧挨着的状态栏、小剧场等跟正文一起算
      const chain = replyBlockChain(mes, bodyOpen.start, bodyClose ? bodyClose.end : bodyOpen.end, thinkOpen.end, thinkClose ? thinkClose.start : mes.length, nearBody);
      const ahead = chain.heads.length ? `${replyBlockLabel(chain.heads.slice(0, 1))}` : `<${body}>`;
      if (!thinkClose) {
        // 思考标签没有结束：在正文（及正文前的块）开始前补上
        mes = mes.slice(0, chain.start).trimEnd() + `\n</${thinkOpen.name}>\n` + mes.slice(chain.start);
        steps.push(`在 ${ahead} 前补上 </${thinkOpen.name}>，让思考区在正文开始前结束`);
      } else if (!closedBefore && bodyClose && bodyClose.end <= thinkClose.start) {
        // 整段正文在思考区内：连同紧挨着的块移到思考区结束之后
        const block = mes.slice(chain.start, chain.end);
        const inner = mes.slice(0, chain.start).trimEnd() + "\n" + mes.slice(chain.end, thinkClose.start).trimStart();
        mes = inner.trimEnd() + "\n" + mes.slice(thinkClose.start, thinkClose.end) + "\n" + block + mes.slice(thinkClose.end);
        const withs = [...chain.heads, ...chain.tails];
        steps.push(`把 <${body}>…</${body}>${withs.length ? ` 连同 ${replyBlockLabel(withs)} 一起` : ""}从 <${thinkOpen.name}> 里移到 </${thinkOpen.name}> 之后`);
      }
    }
  }
  // 4. 只有开头或只有结尾：补齐另一半
  {
    const masked = replyCheckMask(mes);
    const tokens = bodyTokens();
    const opens = tokens.filter((t) => !t.closing), closes = tokens.filter((t) => t.closing);
    // extra.noTailClose（自动修正用）：不在回复末尾补结束标签——可能只是被截断，补上后再「继续」会续到标签外面
    const tailOnly = opens.length === 1 && !closes.length && extra.noTailClose && !replyTagTokens(masked).some((t) => !t.closing && !t.selfClosing && t.start > opens[0].end && (requiredKeys.has(t.key) || thinking.has(t.key))) && !replyPairRanges(masked).some((r) => r.start > opens[0].end && r.key !== bodyKey);
    if (opens.length === 1 && !closes.length && !tailOnly) {
      const after = replyTagTokens(masked).find((t) => !t.closing && !t.selfClosing && t.start > opens[0].end && (requiredKeys.has(t.key) || thinking.has(t.key)));
      let end = after ? after.start : mes.length;
      const trim = () => { while (end > opens[0].end && /\s/.test(mes[end - 1])) end--; };
      trim();
      // 末尾单独成行的完整标签块（如状态栏）留在正文之外
      let tail = null;
      if (!after) {
        const pairs = replyPairRanges(masked).filter((r) => r.start > opens[0].end && r.key !== bodyKey);
        for (let r; (r = pairs.find((x) => x.end === end && /(^|\n)[ \t]*$/.test(mes.slice(0, x.start))));) { end = r.start; tail = r; trim(); }
      }
      const stop = after || tail;
      mes = mes.slice(0, end) + `\n</${body}>` + (stop ? "\n" + mes.slice(end).replace(/^\s*/, "") : mes.slice(end));
      steps.push(stop ? `在 ${masked.slice(stop.start, masked.indexOf(">", stop.start) + 1)} 前补上 </${body}>` : `在回复末尾补上 </${body}>`);
    } else if (closes.length === 1 && !opens.length) {
      const thinkClose = replyTagTokens(masked, thinking).filter((t) => t.closing && t.end <= closes[0].start).at(-1);
      let start = thinkClose ? thinkClose.end : 0;
      while (start < closes[0].start && /\s/.test(mes[start])) start++;
      mes = mes.slice(0, start) + `<${body}>\n` + mes.slice(start);
      steps.push(thinkClose ? `在 </${thinkClose.name}> 之后补上 <${body}>` : `在回复开头补上 <${body}>`);
    }
  }
  // 5. 可见回复已有完整正文，思考区末尾还留着本该在正文外的块（如上次修正只搬出了正文）：
  //    前几条回复里在正文前的放回正文前，其余放到正文后；只移动，不改文字
  {
    const tokens = bodyTokens();
    const open = tokens.find((t) => !t.closing);
    const close = open && tokens.find((t) => t.closing && t.start > open.start);
    const stuck = close && reasoning ? replyStrandedBlocks(mes, reasoning, rules, layout) : [];
    if (stuck.length) {
      const heads = stuck.filter((b) => layout?.head?.includes(b.key) && !layout.tail?.includes(b.key));
      const tails = stuck.filter((b) => !heads.includes(b));
      const pick = (list) => list.map((b) => reasoning.slice(b.start, b.end)).join("\n");
      if (tails.length) mes = mes.slice(0, close.end) + "\n" + pick(tails) + mes.slice(close.end);
      if (heads.length) {
        const before = mes.slice(0, open.start);
        mes = before + (before && !/\n[ \t]*$/.test(before) ? "\n" : "") + pick(heads) + "\n" + mes.slice(open.start);
      }
      for (const b of [...stuck].reverse()) reasoning = reasoning.slice(0, b.start).trimEnd() + "\n" + reasoning.slice(b.end).trimStart();
      reasoning = reasoning.trim();
      steps.push(`把思考区末尾的 ${[heads.length && `${replyBlockLabel(heads)} 放回 <${body}> 前`, tails.length && `${replyBlockLabel(tails)} 放到 </${body}> 后`].filter(Boolean).join("、")}`);
    }
  }
  if (!steps.length) return null;
  return { text: mes, reasoning, reasoningChanged: reasoning !== (typeof extra.reasoning === "string" ? extra.reasoning : null), steps, after: checkReplyFormat(mes, rules, { reasoning: reasoning || "", layout, knownTags: extra.knownTags }) };
}

// 从预设开着的条目里猜正文标签：数各候选标签被写成 <标签> 的次数，取最多的。
// 显示正则用到、条目里也要求输出的其他标签（状态栏之类）作为必需标签建议。
function guessReplyTags(texts, regexTags = []) {
  const all = texts.map((t) => replyCheckMask(String(t || ""))).join("\n");
  const count = (tag) => (all.match(new RegExp(`<\\s*/?\\s*${tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*>`, "giu")) || []).length;
  let bodyTag = null, best = 0;
  for (const tag of REPLY_BODY_ALIASES) {
    const n = count(tag);
    if (n > best) { best = n; bodyTag = tag; }
  }
  const skip = new Set(["think", "thinking", (bodyTag || "").toLowerCase()]);
  const suggest = [...new Map(regexTags.map((t) => [String(t).toLowerCase(), String(t)])).values()].filter((t) => !skip.has(t.toLowerCase()) && /^[A-Za-z_\u3400-\u9fff][A-Za-z0-9_\u3400-\u9fff-]{0,39}$/u.test(t) && count(t) > 0);
  return { bodyTag, count: best, suggest };
}
