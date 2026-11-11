// 核心逻辑回归测试：node test/run-core.cjs
const A = require("./core.cjs");
const fs = require("fs"), path = require("path");
const assert = require("assert");
const load = (f) => new A.Draft("t", f === "zsx-like.json" ? require("./fixtures/make-zsx-like.cjs")() : JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", f), "utf8")));
const by = (d, n) => d.preset.prompts.find((p) => p.name === n);
const mk = (list, extra = {}) => new A.Draft("p", { prompts: list.map(([id, name, content, x]) => ({ identifier: id, name, content, ...(x || {}) })), prompt_order: [{ character_id: 100001, order: list.map(([id]) => ({ identifier: id, enabled: true })) }], ...extra });
let n = 0, skipped = 0;
// Ako 预设作者声明禁止二传，不放进仓库；本地有 fixtures/ako-stitched.json 时才跑相关测试
const hasAko = fs.existsSync(path.join(__dirname, "fixtures", "ako-stitched.json"));
const test = (name, fn) => {
  if (!hasAko && /Ako|嬷u|分组：|自带问句/.test(name)) { skipped++; console.log("-", name, "（缺少本地 Ako 预设，跳过）"); return; }
  fn(); n++; console.log("✓", name);
};

test("分组：有百宝箱时保存不再镜像 entryGrouping，二次保存也干净", () => {
  const d = load("ako-stitched.json");
  const out = d.toPreset();
  assert.ok(!out.extensions.entryGrouping);
  assert.equal(out.extensions.baibaiToolkit.presetPromptGroups.groups.length, 22);
  assert.ok(!new A.Draft("x", out).toPreset().extensions.entryGrouping);
});
test("分组：只有 entryGrouping 时读得出成员列表式分组、只写回 entryGrouping", () => {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/ako-stitched.json"), "utf8"));
  delete raw.extensions.baibaiToolkit.presetPromptGroups;
  const d = new A.Draft("x", raw);
  assert.equal(d.groups.groups.length, 20);
  const out = d.toPreset();
  assert.ok(!out.extensions.baibaiToolkit.presetPromptGroups);
  assert.equal(out.extensions.entryGrouping.length, 20);
});
test("Ako 每个分组推断出的写法都不会去占用邻居的问句变量", () => {
  const d = load("ako-stitched.json");
  for (const g of d.groups.groups) assert.equal(A.inferTarget(d, { groupEnd: g.id }, g.id).shape, "plain", g.name);
});
test("挂进思维链（问句变量）：嬷u·把玩挂到 COT-头部分析，紧跟 嬷嬷你，并补初始化", () => {
  const d = load("ako-stitched.json");
  const src = JSON.parse(JSON.stringify(by(d, "嬤u·把玩")));
  d.deletePrompts([src.identifier]);
  const anchor = by(d, "🔔建议常驻选一·我是U嬷王").identifier, gid = d.groupOf(anchor);
  const t = A.inferTarget(d, { after: anchor }, gid);
  const plan = A.planItem({ name: src.name, content: src.content }, t, {});
  const h = A.planHook(d, { after: anchor }, gid, { content: plan.content, name: src.name, label: plan.label });
  assert.equal(h.mode, "own"); assert.equal(h.on, true); assert.equal(h.anchorVar, "嬷嬷你");
  const ids = d.insertPrompts([{ prompt: { ...src, identifier: undefined, content: A.contentWithHook(plan.content, h) }, enabled: true }], { after: anchor }, gid);
  const r = A.applyHook(d, h);
  assert.ok(r.inited);
  assert.ok(d.prompt(h.cotId).content.includes(`{{getvar::嬷嬷你}}\n{{getvar::${h.varName}}}`));
  assert.equal(A.analyze(d).coverage.get(ids[0]).level, "var");
});
test("挂进思维链（文字点名）：众生相式思维链在提到邻居那一行后面加点名", () => {
  const d = load("zsx-like.json");
  const g = d.groups.groups.find((x) => x.name === "文风设定");
  const content = "<哥特浪漫>\n华丽、阴郁的意象，月光、废墟、蔷薇；情感浓烈但克制。\n</哥特浪漫>";
  const h = A.planHook(d, { groupEnd: g.id }, g.id, { content, name: "✒️哥特浪漫" });
  assert.equal(h.mode, "text"); assert.equal(h.on, true);
  const ids = d.insertPrompts([{ prompt: { name: "✒️哥特浪漫", content }, enabled: true }], { groupEnd: g.id }, g.id);
  A.applyHook(d, h);
  const cot = by(d, "✨思维链：推演").content;
  assert.ok(/<意识流>.*\n- <哥特浪漫>：/.test(cot), cot);
  assert.equal(A.analyze(d).coverage.get(ids[0]).level, "mention");
});
test("邻居各用各的标签时，不把邻居的标签套给新条目", () => {
  const d = load("zsx-like.json");
  const g = d.groups.groups.find((x) => x.name === "写作指导");
  const t = A.inferTarget(d, { groupEnd: g.id }, g.id);
  assert.ok(!t.tagTpl); assert.ok(t.ownTag);
  const plain = A.planItem({ name: "✒️节奏控制", content: "长短句交替，紧张时用短句。" }, t, {});
  assert.ok(plain.content.startsWith("<节奏控制>"), plain.content);
  const tagged = A.planItem({ name: "x", content: "<自带标签>\n内容内容\n</自带标签>" }, t, {});
  assert.ok(tagged.content.startsWith("<自带标签>"));
});
test("汇总变量：附近都 addvar 追加思维链片段时照样追加，不另开变量", () => {
  const d = mk([["i", "初始化", "{{setvar::cot片段::}}{{setvar::x::}}"], ["a", "A", "规则A正文规则A正文规则A正文规则A\n{{addvar::cot片段::\n- A？}}"], ["b", "B", "规则B正文规则B正文规则B正文规则B\n{{addvar::cot片段::\n- B？}}"], ["c", "思维链", "<thinking>\n{{getvar::cot片段}}\n</thinking>"]]);
  const h = A.planHook(d, { after: "b" }, null, { content: "新规则：角色说话前会停顿一下，再说出真正想说的话。", name: "新规则" });
  assert.equal(h.mode, "append"); assert.equal(h.varName, "cot片段");
  assert.ok(A.contentWithHook("正文", h).includes("{{addvar::cot片段::\n"));
});
test("全局变量：跟着用 setglobalvar / getglobalvar", () => {
  const d = mk([["i", "初始化", "{{setglobalvar::q1::}}{{setglobalvar::q2::}}"], ["a", "功能A", "功能A正文功能A正文功能A正文功能A正文\n{{setglobalvar::q1::### A怎么做？}}"], ["c", "COT", "<thinking>\n{{getglobalvar::q1}}\n</thinking>"]]);
  const h = A.planHook(d, { after: "a" }, null, { content: "新功能：角色在雨天会变得沉默，反复擦拭随身物品。", name: "新功能" });
  assert.equal(h.scope, "global");
  assert.ok(A.contentWithHook("x", h).includes("{{setglobalvar::"));
});
test("来源自带问句：沿用，不重复；撞名自动换名", () => {
  const d = load("ako-stitched.json");
  const anchor = by(d, "🔔建议常驻选一·我是U嬷王").identifier, gid = d.groupOf(anchor);
  const own = A.planHook(d, { after: anchor }, gid, { content: "<撒娇>\n角色会先嘴硬然后让步，让步要具体落在动作上。\n</撒娇>\n{{setvar::撒娇::### 根据<撒娇>，角色会在哪个动作上让步？}}", name: "撒娇" });
  assert.equal(own.varName, "撒娇");
  assert.equal((A.contentWithHook("<撒娇>\n角色会先嘴硬然后让步，让步要具体落在动作上。\n</撒娇>\n{{setvar::撒娇::### 根据<撒娇>，角色会在哪个动作上让步？}}", own).match(/setvar::撒娇/g) || []).length, 1);
  const clash = A.planHook(d, { after: anchor }, gid, { content: "一些正文一些正文一些正文一些正文一些正文\n{{setvar::content::### 问？}}", name: "撞名测试" });
  assert.notEqual(clash.varName, "content");
});
test("写法分析：Ako 认出初始化条目、问句变量写法；众生相式认出靠文字点名", () => {
  const ako = A.profilePreset(load("ako-stitched.json"));
  assert.ok(ako.initId); assert.ok(ako.perEntry.length >= 5);
  const zs = A.profilePreset(load("zsx-like.json"));
  assert.equal(zs.cotStyle, "text");
});

// ---------- 1.3.1：Ariadne / 众生相 这类写法（合成数据） ----------
const L = (t) => (t + "\n").repeat(6).trim();
const ariLike = () => mk([
  ["init", "│注入变量│", "{{setvar::笔法:: }}{{setvar::创作模式:: }}{{setvar::x:: }}"],
  ["s0", "├─文字笔法─┤", "<Writing_Style>"],
  ["w1", "│📝笔法·来点生活", "[Writing Style: 来点生活]\n" + L("轻描淡写地写生活里的重事，语气松弛，细节具体。") + "\n{{setvar::笔法::- 以[Writing Style: 来点生活]为核心文风，如何落实到当前场景？}}"],
  ["w2", "│📝笔法·诗意流淌", "[Writing Style: 诗意流淌]\n" + L("句子绵长，意象连缀，情绪像水一样流过去。") + "\n{{setvar::笔法::- 以[Writing Style: 诗意流淌]为核心文风，如何落实到当前场景？}}"],
  ["w3", "│📝笔法·毫末凝视", "[Writing Style: 毫末凝视]\n" + L("盯住极小的细节，放大，再放大，让情绪藏在物件里。") + "\n{{setvar::笔法::- 以[Writing Style: 毫末凝视]为核心文风，如何落实到当前场景？}}"],
  ["s1", "├─情感氛围─┤", "</Writing_Style>"],
  ["m1", "│🐚抢话·积极", "允许替 user 写动作和对白，但重大选择留给 user。\n{{setvar::创作模式::根据抢话规则处理 user 输入}}"],
  ["c0", "┌─思维链始·线─┐", "思考要求：严格按步骤思考"],
  ["c1", "│🧩叙事风格", "# Phase1\n{{getvar::笔法}}"],
  ["c2", "│🧩核心推演", "基于{{getvar::创作模式}}处理输入\n检查 narrative 是否连贯"],
  ["c3", "└─思维链终─┘", "</thinking>"],
], {}) ;
test("思维链区段：名字不带\"思维链\"的步骤也算（思维链始 … 思维链终）", () => {
  const d = ariLike();
  const a = A.analyze(d);
  for (const id of ["c0", "c1", "c2", "c3"]) assert.ok(a.cotIds.includes(id), id);
  assert.equal(a.coverage.get("w1").level, "var");
});
test("单选槽位：夹在同类中间就照样登记问句、换成目标的标题", () => {
  const d = ariLike();
  const t = A.inferTarget(d, { after: "w1" }, null);
  assert.equal(t.shape, "tagname"); assert.equal(t.varName, "笔法"); assert.ok(t.slot.between); assert.ok(t.labelTpl);
  const plan = A.planItem({ name: "🔸墟里春生", content: "# writing_style: 墟里春生\n魔幻现实主义，生死与时序的边界消融。" }, t, {});
  assert.ok(plan.content.startsWith("[Writing Style: 墟里春生]\n魔幻"), plan.content);
  assert.ok(plan.content.endsWith("{{setvar::笔法::- 以[Writing Style: 墟里春生]为核心文风，如何落实到当前场景？}}"), plan.content);
});
test("单选槽位：不是同一类的不加入，免得顶掉选好的那项", () => {
  const d = ariLike();
  const t = A.inferTarget(d, { after: "w3" }, null);
  assert.ok(!t.slot.between);
  const plan = A.planItem({ name: "嬷u·把玩", content: "<把玩>\n角色会无意识地捏 user 身上柔软的地方。\n</把玩>", sections: ["user_image_corrections"] }, t, {});
  assert.equal(plan.want.shape, "plain");
  assert.ok(!plan.content.includes("setvar::笔法"));
  const same = A.planItem({ name: "🔸墟里春生", content: "魔幻现实主义，生死与时序的边界消融，文字克制。", sections: ["WRITING_STYLE"] }, t, {});
  assert.ok(same.content.includes("setvar::笔法"));
});
test("普通英文单词碰巧出现在思维链里不算提到；<标签> 才算", () => {
  const d = ariLike();
  const h = A.planHook(d, { after: "m1" }, null, { content: "<narrative>\n叙事要连贯，场景切换要交代清楚，不要跳。\n</narrative>", name: "叙事连贯" });
  assert.notEqual(h.status, "mention");
});
test("注释分区：<!-- START: STORY_TONE --> 里的条目；思维链没提到时，加一步点名整个分区", () => {
  const d = mk([
    ["t0", "🔖故事基调", "<!-- START: STORY_TONE -->\n[STORY · TONE]"],
    ["t1", "🔹高浓活力", "情绪浓烈，角色主动推动局面，不等 user 开口。"],
    ["t2", "🔖故事基调", "<!-- END: STORY_TONE -->"],
    ["w0", "🔖文风设定", "<!-- START: WRITING_STYLE -->"],
    ["w1", "🍂英伦锦叙", "# writing_style: 英伦锦叙\n英式幽默与克制的白描。"],
    ["w2", "🔖文风设定", "<!-- END: WRITING_STYLE -->"],
    ["c0", "🌙思考开始", "<thinking>"],
    ["c1", "✨思维链：溯源", "## Phase 1.看清情绪\n## Phase 2.如何遵循writing_style？"],
    ["c2", "🌙思考结束", "</thinking>"],
  ]);
  assert.equal(A.analyze(d).coverage.get("w1").level, "mention");
  assert.equal(A.analyze(d).coverage.get("t1").level, "none");
  const h = A.planHook(d, { after: "t1" }, null, { content: "轻松日常，误会靠性格产生，不靠恶意，大家都挺可爱。", name: "🎼喜笑人间" }, { srcCot: true });
  assert.equal(h.mode, "text"); assert.equal(h.section, "STORY_TONE"); assert.ok(h.on);
  assert.ok(h.line.startsWith("## Phase 3."), h.line);
});

test("编号变量 + 多个思维链版本（V2.61 式）：新变量接着编号，每个版本都加读取", () => {
  const body = (n) => `[模式：${n}]\n` + L(`${n}时的写法要点，写进动作和细节里。`);
  const d = mk([
    ["init", "📜获取变量（别关）", "{{setvar::修复模式1::}}{{setvar::修复模式2::}}{{setvar::x::}}"],
    ["m1", "☪︎ 粘合-温情修复", body("温情修复") + "\n{{setvar::修复模式1::温情修复}}"],
    ["m2", "☪︎ 金缮-做恨模式", body("做恨模式") + "\n{{setvar::修复模式2::做恨模式}}"],
    ["c0", "📜修复开始", "<thinking>"],
    ["c1", "✵ （选一）通用COT", "当前模式：{{getvar::修复模式1}}{{getvar::修复模式2}}"],
    ["c2", "✵ （选一）酸涩氧化", "当前模式：{{getvar::修复模式1}}{{getvar::修复模式2}}"],
    ["c3", "📜修复完成", "</thinking>"],
  ]);
  d.setEnabled(["c1"], false);
  const t = A.inferTarget(d, { after: "m2" }, null);
  const plan = A.planItem({ name: "💞氛围·酸涩拉扯", content: "---\n\n[酸涩拉扯]\n" + L("别扭又放不下，说一半留一半。") }, t, {});
  assert.ok(plan.content.startsWith("[模式：酸涩拉扯]\n别扭"), plan.content.slice(0, 40));
  const h = A.planHook(d, { after: "m2" }, null, { content: plan.content, name: "💞氛围·酸涩拉扯", label: plan.label });
  assert.equal(h.mode, "own"); assert.equal(h.varName, "修复模式3"); assert.equal(h.question, "酸涩拉扯"); assert.equal(h.cotIds.length, 2);
  d.insertPrompts([{ prompt: { name: "x", content: A.contentWithHook(plan.content, h) }, enabled: true }], { after: "m2" }, null);
  A.applyHook(d, h);
  for (const id of ["c1", "c2"]) assert.ok(d.prompt(id).content.includes("{{getvar::修复模式3}}"), id);
  assert.ok(d.prompt("init").content.includes("{{setvar::修复模式3::}}"));
});

test("宏里少一个 } 的笔误不影响后面的 {{getvar}}", () => {
  const vars = A.listVarMacros ? null : null;
  const d = mk([["a", "文风指导", "<文风指导>\n{{user}：以下是文风。\n{{getvar::文风}}\n</文风指导>"], ["b", "某文风", L("文风正文文风正文") + "\n{{addvar::文风::某文风}}"]]);
  assert.ok(A.analyze(d).vars.get("文风").readers.includes("a"));
});
test("包进变量的单选（setvar 同一个变量）也要守卫；读它的条目全关着时提醒", () => {
  const W = (n) => `{{setvar::顶栏规范::\n[顶栏规范]\n${L(n + "：每次正文前先输出顶栏，格式固定。")}\n}}`;
  const d = mk([
    ["t1", "🧸顶栏|一号", W("一号")], ["t2", "🧸顶栏|二号", W("二号")], ["t3", "🧸顶栏|三号", W("三号")],
    ["s1", "🧸单人状态栏", "{{setvar::单人状态栏规范::\n" + L("状态栏规范") + "\n}}"],
    ["k", "🧸附加属性一键开关", "{{getvar::顶栏规范 }}\n{{getvar::单人状态栏规范 }}"],
  ]);
  d.setEnabled(["k"], false);
  const tIn = A.inferTarget(d, { after: "t1" }, null);
  assert.equal(tIn.shape, "wrap"); assert.ok(tIn.slot.between); assert.ok(tIn.readersOff);
  const p1 = A.planItem({ name: "状态栏（轻盈）", content: L("生成前置状态栏，三段式。") }, tIn, {});
  assert.ok(p1.content.startsWith("{{setvar::顶栏规范::"));
  assert.ok(p1.changes.some((c) => c.includes("加入多选一「顶栏规范」")));
  assert.ok(p1.warnings.some((w) => w.includes("未开启")));
  const tEnd = A.inferTarget(d, { after: "t3" }, null);
  const p2 = A.planItem({ name: "无关条目", content: L("这条和顶栏无关，是别的规则。") }, tEnd, {});
  assert.equal(p2.want.shape, "plain");
});
test("登记名字：来源登记的是一整句问句时，用条目名登记（小冰块 文风）", () => {
  const S = (n) => `<writing_style：${n}>\n${L(n + "的文风要点。")}\n</writing_style：${n}>\n{{addvar::文风::${n}}}`;
  const d = mk([["a", "🍧木心|小散文", S("小散文")], ["b", "🍧BL|蓝淋", S("蓝淋")], ["c", "🍧太宰治|小卑劣", S("小卑劣")]]);
  const t = A.inferTarget(d, { after: "b" }, null);
  const src = "[Writing Style: 来点生活]\n" + L("轻描淡写地写生活。") + "\n{{setvar::叙事风格1::- 以[Writing Style: 来点生活]为核心文风，如何落实到当前场景的创作中？}}";
  const p = A.planItem({ name: "│📝笔法·来点生活", content: src }, t, {});
  assert.ok(p.content.startsWith("<writing_style：来点生活>"), p.content.slice(0, 40));
  assert.ok(p.content.endsWith("{{addvar::文风::来点生活}}"), p.content.slice(-40));
});

test("共用标签 <small_theater: 名字> 时用后面的名字称呼；由一键开关统一发出去的默认不挂思维链", () => {
  const hs = A.entryHandles({ name: "💌日记小剧场", content: "<small_theater: 日记小剧场>\n写一段日记\n</small_theater: 日记小剧场>" });
  assert.equal(hs[0].ref, "「日记小剧场」");
  const d = mk([["a", "规则", "规则正文规则正文规则正文规则正文"], ["c0", "思考开始", "<thinking>"], ["c1", "格式确认", "- 小剧场字数是否达标？"], ["c2", "思考结束", "</thinking>"], ["b", "🧩小剧场字数", L("小剧场要写够字数")]]);
  const h = A.planHook(d, { after: "b" }, null, { content: "{{addvar::小剧场::\n" + L("日记内容") + "\n}}", name: "日记小剧场" }, { collector: "小剧场一键开关" });
  if (h.status === "hook") assert.equal(h.on, false);
});

test("选位置：放在组外时整组保持成组、部分条目出组、只有一条的组拖出来就出组", () => {
  const G = (gs) => ({ extensions: { baibaiToolkit: { presetPromptGroups: { version: 1, groups: Object.keys(gs).map((id) => ({ id, name: id, enabled: true })), prompts: Object.fromEntries(Object.entries(gs).flatMap(([g, ids]) => ids.map((i) => [i, { groupId: g }]))) } } } });
  const make = () => mk([["a1", "a1", "x"], ["a2", "a2", "x"], ["b1", "b1", "x"], ["b2", "b2", "x"], ["c1", "c1", "x"], ["l", "l", "x"]], G({ A: ["a1", "a2"], B: ["b1", "b2"], C: ["c1"] }));
  const shape = (d) => d.order.map((o) => `${o.identifier}${d.groupOf(o.identifier) ? ":" + d.groupOf(o.identifier) : ""}`).join(" ");
  let d = make();
  d.place(["a1", "a2"], { after: "b2" }, null);
  assert.equal(shape(d), "b1:B b2:B a1:A a2:A c1:C l");
  d = make();
  d.place(["a2"], { after: "b2" }, null);
  assert.equal(shape(d), "a1:A b1:B b2:B a2 c1:C l");
  d = make();
  d.place(["l"], { after: "b1" }, "B");
  assert.equal(shape(d), "a1:A a2:A b1:B l:B b2:B c1:C");
  d = make();
  d.place(["c1"], { before: "a1" }, null);
  assert.equal(shape(d), "c1 a1:A a2:A b1:B b2:B l");
});

test("空白分组——建在两个组之间、放条目进去、移空后留在原处、保存再读回来还在", () => {
  const G = (gs) => ({ extensions: { baibaiToolkit: { presetPromptGroups: { version: 1, groups: Object.keys(gs).map((id) => ({ id, name: id, enabled: true })), prompts: Object.fromEntries(Object.entries(gs).flatMap(([g, ids]) => ids.map((i) => [i, { groupId: g }]))) } } } });
  const d = mk([["a1", "a1", "x"], ["a2", "a2", "x"], ["b1", "b1", "x"], ["b2", "b2", "x"], ["l", "l", "x"]], G({ A: ["a1", "a2"], B: ["b1", "b2"] }));
  const view = (x) => x.blocks().map((b) => b.groupId ? `[${x.group(b.groupId).name}:${b.ids.join(",")}]` : b.ids.join(",")).join(" ");
  const e = d.createEmptyGroup("新组", "a2");
  assert.equal(view(d), "[A:a1,a2] [新组:] [B:b1,b2] l");
  const top = d.createEmptyGroup("顶上", "");
  assert.equal(view(d), "[顶上:] [A:a1,a2] [新组:] [B:b1,b2] l");
  // 放进空分组
  d.place(["l"], d.afterEmpty(e), e);
  assert.equal(view(d), "[顶上:] [A:a1,a2] [新组:l] [B:b1,b2]");
  // 放在 A 后面（组外）：空分组之前的位置要紧贴 A
  d.place(["b2"], { after: "a2" }, null);
  assert.equal(view(d), "[顶上:] [A:a1,a2] b2 [新组:l] [B:b1]");
  // A 整组挪走（keep）：A 还是组；把 B 唯一的一条挪走：B 变空分组留在原处
  d.place(["b1"], { after: "l" }, e);
  assert.equal(view(d), "[顶上:] [A:a1,a2] b2 [新组:l,b1] [B:]");
  // 存一遍再读回来
  const back = new A.Draft("p", d.toPreset());
  assert.equal(view(back), view(d));
  // 最前面：放进来的条目排在原来最前面的空分组前面
  back.place(["b2"], { index: 0 }, null);
  assert.equal(view(back), "b2 [顶上:] [A:a1,a2] [新组:l,b1] [B:]");
});

test("预设清理：拆出系列名和版本号", () => {
  assert.deepEqual(A.splitPresetName("【留光】Aria-Gemini-v3.6.8"), { base: "【留光】aria gemini", ver: [3, 6, 8] });
  assert.deepEqual(A.splitPresetName("【留光】Aria-Gemini-v3.6.1").base, "【留光】aria gemini");
  assert.equal(A.splitPresetName("Ariadne-V1_3Beta-3_1Pro改版_json").base, A.splitPresetName("Ariadne-V1_3Beta-3_1Pro改版").base);
  assert.equal(A.splitPresetName("双人成行 V6.0 —OOC警告").base, "双人成行 ooc警告");
  assert.equal(A.splitPresetName("小冰块(1)").base, "小冰块");
  // 版本号紧跟在】或汉字后面
  assert.deepEqual(A.splitPresetName("【小冰块】v3.83"), { base: "【小冰块】", ver: [3, 83] });
  assert.equal(A.splitPresetName("【小冰块】V3.82").base, "【小冰块】");
  assert.deepEqual(A.splitPresetName("【爱蘑神】众生相3.0二改条目"), { base: "【爱蘑神】众生相 二改条目", ver: [3, 0] });
  assert.equal(A.splitPresetName("【爱蘑神】众生相4.0二改条目 (1)").base, "【爱蘑神】众生相 二改条目");
  // 字母中间的 v 不算版本号
  assert.equal(A.splitPresetName("Aria-Gemini-dev2").ver, null);
});
test("预设清理：完全相同、旧版本、同系列、内容相近都能认出，当前预设不建议清理", () => {
  const P = (contents) => ({ prompts: contents.map((c, i) => ({ identifier: "p" + i, content: c.padEnd(30, "。") })) });
  const base = ["写作风格", "人物塑造", "世界规则", "输出格式", "思维链", "禁词表"];
  const list = [
    { name: "留光 v3.6.8", data: P(base), size: 10 },
    { name: "留光 v3.6.1", data: P(base.slice(0, 5)), size: 9 },
    { name: "双人成行 V6.0", data: P(["甲", "乙", "丙"]), size: 8 },
    { name: "双人成行 V6.0(1)", data: P(["甲", "乙", "丙"]), size: 8 },
    { name: "Ariadne改版", data: P(["a1", "a2", "a3", "a4", "a5"]), size: 7 },
    { name: "Ariadne改版_json", data: P(["a1", "a2", "a3", "a4", "x"]), size: 7 },
    { name: "ariad", data: P(["a1", "a2", "a3", "a4", "a5", "a6"]), size: 7 },
    { name: "独立预设", data: P(["z1", "z2", "z3"]), size: 5 }
  ];
  const r = Object.fromEntries(A.scanPresets(list, { current: "ariad" }).map((x) => [x.name, x]));
  assert.equal(r["留光 v3.6.1"].tags[0].k, "old");
  assert.equal(r["留光 v3.6.8"].tags.length, 0);
  assert.equal(r["双人成行 V6.0(1)"].tags[0].k, "same");
  assert.equal(r["双人成行 V6.0"].tags.length, 0);
  assert.equal(r["Ariadne改版_json"].tags[0].k, "series");
  assert.equal(r["Ariadne改版"].tags[0].k, "near");
  assert.equal(r["Ariadne改版"].tags[0].ref, "ariad");
  assert.equal(r["ariad"].suggest, false);
  assert.equal(r["独立预设"].suggest, false);
  // 当前用的是旧版本时，新版本不提示清理
  const r2 = Object.fromEntries(A.scanPresets(list, { current: "留光 v3.6.1" }).map((x) => [x.name, x]));
  assert.equal(r2["留光 v3.6.8"].tags.length, 0);
  assert.equal(r2["留光 v3.6.1"].suggest, false);
});

test("双层分组 entryGrouping 里与百宝箱同名同成员的分组算重复，保存时去掉；别的分组保留", () => {
  const d = mk([["a", "甲", "x"], ["b", "乙", "y"], ["c", "丙", "z"], ["e", "戊", "w"]], { extensions: {
    baibaiToolkit: { presetPromptGroups: { version: 1, groups: [{ id: "g1", name: "文风选择" }], prompts: { a: { groupId: "g1" }, b: { groupId: "g1" } } } },
    entryGrouping: [{ id: "x1", name: "文风选择", startIdentifier: "a", endIdentifier: "b", mode: "inclusive" }, { id: "x2", name: "别的组", memberIdentifiers: ["c", "e"] }, { id: "x3", name: "文风选择", memberIdentifiers: ["a", "c"] }]
  } });
  assert.deepEqual(d.dupEntryGroups().map((g) => g.id), ["x1"]);
  const out = d.toPreset();
  assert.deepEqual(out.extensions.entryGrouping.map((g) => g.id), ["x2", "x3"]);
  assert.equal(new A.Draft("p", out).dupEntryGroups().length, 0);
});

test("双层分组——成员只是同名分组的一部分时不算重复（1.8.0）", () => {
  const d = mk([["a", "甲", "x"], ["b", "乙", "y"]], { extensions: {
    baibaiToolkit: { presetPromptGroups: { version: 1, groups: [{ id: "g1", name: "文风" }], prompts: { a: { groupId: "g1" }, b: { groupId: "g1" } } } },
    entryGrouping: [{ id: "x1", name: "文风", memberIdentifiers: ["a"] }]
  } });
  assert.equal(d.dupEntryGroups().length, 0);
  assert.deepEqual(d.toPreset().extensions.entryGrouping.map((g) => g.id), ["x1"]);
});

test("分组开关独立于内部条目，保存后两种状态分别保留（2.2.3）", () => {
  const d = mk([["a", "甲", "x"], ["b", "乙", "y"], ["c", "丙", "z"]]);
  const gid = d.createGroup("组", ["a", "b", "c"]);
  d.setEnabled(["c"], false);
  d.setGroupEnabled(gid, false);
  assert.deepEqual(d.order.map((o) => o.enabled), [true, true, false]);
  assert.equal(d.groupOff(gid), true);
  d.setGroupEnabled(gid, true);
  assert.deepEqual(d.order.map((o) => o.enabled), [true, true, false]);
  // entryGrouping 的分组标记也独立保存，不能借改写条目来模拟。
  const eg = mk([["a", "甲", "x"], ["b", "乙", "y"]], { extensions: { entryGrouping: [{ id: "x1", name: "组", startIdentifier: "a", endIdentifier: "b" }] } });
  eg.setGroupEnabled("x1", false);
  const back = new A.Draft("p", eg.toPreset());
  assert.deepEqual(back.order.map((o) => o.enabled), [true, true]);
  assert.equal(back.groupOff("x1"), true);
  // 全部关着时打开分组，也不修改内部选择。
  back.setEnabled(["a", "b"], false);
  back.setGroupEnabled("x1", true);
  assert.deepEqual(back.order.map((o) => o.enabled), [false, false]);
  assert.equal(back.groupOff("x1"), false);
});

test("replaceWith 整份换掉内容和分组格式（1.8.0）", () => {
  const d = mk([["a", "甲", "x"]]);
  d.replaceWith({ prompts: [{ identifier: "z", name: "新", content: "n" }], prompt_order: [{ character_id: 100001, order: [{ identifier: "z", enabled: true }] }], extensions: { entryGrouping: [{ id: "g", name: "组", memberIdentifiers: ["z"] }] } });
  assert.deepEqual(d.order.map((o) => o.identifier), ["z"]);
  assert.equal(d.hadEntryGrouping, true);
  assert.equal(d.groupOf("z"), "g");
});

test("接入思维链：条目排在读变量的思维链之后时给出提醒，默认不接入（1.8.0）", () => {
  const d = mk([
    ["cot", "思维链", "<thinking>\n{{getvar::文风问}}\n</thinking>"],
    ["w1", "文风·甲", "写得细腻一些，多用比喻和感官描写，节奏放慢。\n{{setvar::文风问::甲怎么落实？}}"]
  ]);
  const h = A.planHook(d, { after: "w1" }, null, { content: "这是一段足够长的新文风正文，用来测试接入思维链的提醒。", name: "文风·乙" });
  assert.equal(h.status, "hook");
  assert.ok((h.warns || []).some((w) => /之后/.test(w)), "排在思维链之后要提醒");
  assert.equal(h.on, false, "排在后面时默认不接入");
});

test("恢复备份后撤销，温度等参数也一起回来（1.8.0）", () => {
  const d = mk([["a", "甲", "x"]], { temperature: 0.8 });
  d.snapshot("恢复备份");
  d.replaceWith({ temperature: 0.2, prompts: [{ identifier: "a", name: "甲", content: "旧" }], prompt_order: [{ character_id: 100001, order: [{ identifier: "a", enabled: true }] }] });
  assert.equal(d.toPreset().temperature, 0.2);
  d.undo();
  const out = d.toPreset();
  assert.equal(out.temperature, 0.8);
  assert.equal(out.prompts[0].content, "x");
});

test("手动指定的思维链，缝合时的接入检查也认（1.8.0）", () => {
  const d = mk([
    ["w1", "文风·甲", "写得细腻一些，多用比喻和感官描写，节奏放慢。\n{{setvar::文风问::甲怎么落实？}}"],
    ["step", "最后检查", "回复前逐条确认：\n{{getvar::文风问}}"]
  ]);
  const item = { content: "这是一段足够长的新文风正文，用来测试手动指定的思维链。", name: "文风·乙" };
  assert.equal(A.planHook(d, { after: "w1" }, null, item).status, "nocot");
  d.cotManual = { step: true };
  assert.notEqual(A.planHook(d, { after: "w1" }, null, item).status, "nocot");
});

test("改了正文以后，思维链区段重新计算（1.8.0）", () => {
  const d = mk([["a", "开头", "<thinking>"], ["b", "中间", "想一想"], ["c", "结尾", "</thinking>"]]);
  assert.ok(A.analyze(d).cotIds.includes("b"));
  d.prompt("a").content = "普通条目";
  assert.ok(!A.analyze(d).cotIds.includes("b"));
});

test("思维链识别：英文整词匹配，正文里顺口提到 <thinking> 不算（1.8.0）", () => {
  const d = mk([["a", "Scott的人设", "一段人设。"], ["b", "输出规则", "不要输出<thinking>标签里的内容。"], ["c", "CoT", "思考步骤"], ["d", "步骤", "<thinking>\n1. 先想\n</thinking>"]]);
  const cot = A.analyze(d).cotIds;
  assert.ok(!cot.includes("a") && !cot.includes("b"));
  assert.ok(cot.includes("c") && cot.includes("d"));
});


// ---- 1.8.0：用合成的「问句变量式」预设覆盖原来依赖 Ako 真实预设的场景，干净环境也能跑
// 结构：初始化条目每轮清空问句变量；每条各自登记一个问句变量；思维链逐个 getvar 读取
const mkQ = ({ baibai = true, eg = false } = {}) => {
  const long = (s) => `${s}。写作时注意节奏和细节，人物的言行要符合设定，场景描写要具体可感，避免空泛的形容。`;
  const list = [
    ["init", "♻️初始化", "{{setvar::问甲::}}{{setvar::问乙::}}{{setvar::问丙::}}"],
    ["e1", "风格·甲", long("甲风格") + "\n{{setvar::问甲::甲风格怎么落实？}}"],
    ["e2", "风格·乙", long("乙风格") + "\n{{setvar::问乙::乙风格怎么落实？}}"],
    ["e3", "风格·丙", long("丙风格") + "\n{{setvar::问丙::丙风格怎么落实？}}"],
    ["cot", "✨思维链：推演", "<thinking>\n{{getvar::问甲}}\n{{getvar::问乙}}\n{{getvar::问丙}}\n</thinking>"]
  ];
  const ext = {};
  if (baibai) ext.baibaiToolkit = { presetPromptGroups: { version: 1, groups: [{ id: "g1", name: "风格" }], prompts: { e1: { groupId: "g1" }, e2: { groupId: "g1" }, e3: { groupId: "g1" } } } };
  if (eg) ext.entryGrouping = [{ id: baibai ? "g1" : "x1", name: "风格", memberIdentifiers: ["e1", "e2", "e3"] }];
  return mk(list, { extensions: ext });
};
test("分组（合成）：有百宝箱时保存去掉同 id 的 entryGrouping 镜像，二次保存也干净", () => {
  const out = mkQ({ eg: true }).toPreset();
  assert.ok(!out.extensions.entryGrouping);
  assert.equal(out.extensions.baibaiToolkit.presetPromptGroups.groups.length, 1);
  assert.ok(!new A.Draft("x", out).toPreset().extensions.entryGrouping);
});
test("分组（合成）：只有 entryGrouping 时读得出成员列表式分组、只写回 entryGrouping", () => {
  const d = mkQ({ baibai: false, eg: true });
  assert.equal(d.groups.groups.length, 1);
  assert.equal(d.groupOf("e2"), "x1");
  const out = d.toPreset();
  assert.ok(!out.extensions.baibaiToolkit);
  assert.equal(out.extensions.entryGrouping.length, 1);
});
test("问句变量式（合成）：每条各登记各的问句时，推断写法不去占用邻居的变量", () => {
  const d = mkQ();
  assert.equal(A.inferTarget(d, { groupEnd: "g1" }, "g1").shape, "plain");
});
test("问句变量式（合成）：新条目接入思维链，紧跟邻居的读取，并补初始化", () => {
  const d = mkQ();
  const src = { name: "风格·丁", content: "丁风格。写作时注意节奏和细节，人物的言行要符合设定，场景描写要具体可感。" };
  const t = A.inferTarget(d, { after: "e3" }, "g1");
  const plan = A.planItem(src, t, {});
  const h = A.planHook(d, { after: "e3" }, "g1", { content: plan.content, name: src.name, label: plan.label });
  assert.equal(h.mode, "own"); assert.equal(h.on, true); assert.equal(h.anchorVar, "问丙");
  const ids = d.insertPrompts([{ prompt: { identifier: undefined, name: src.name, content: A.contentWithHook(plan.content, h) }, enabled: true }], { after: "e3" }, "g1");
  const r = A.applyHook(d, h);
  assert.ok(r.inited);
  assert.ok(d.prompt("cot").content.includes(`{{getvar::问丙}}\n{{getvar::${h.varName}}}`));
  assert.ok(d.prompt("init").content.includes(`{{setvar::${h.varName}::}}`));
  assert.equal(A.analyze(d).coverage.get(ids[0]).level, "var");
});
test("写法分析（合成）：认出初始化条目和问句变量写法", () => {
  const p = A.profilePreset(mkQ());
  assert.equal(p.initId, "init");
  assert.ok(p.perEntry.length >= 3);
  assert.equal(p.cotStyle, "vars");
});
test("变量修复：写了没人读的变量，补在最后一个写入它的条目后面；有读取时不改（1.8.0）", () => {
  const d = mk([["a", "甲", "{{setvar::文风::细腻}}"], ["b", "乙", "{{addvar::文风::，克制}}"], ["c", "丙", "正文"]]);
  const plan = A.variableRepairPlan(d, "文风");
  assert.equal(plan.last, "b");
  assert.equal(plan.macro, "{{getvar::文风}}");
  const d2 = mk([["a", "甲", "{{setvar::文风::细腻}}"], ["c", "丙", "{{getvar::文风}}"]]);
  assert.throws(() => A.variableRepairPlan(d2, "文风"), /已有开启的条目读取/);
});
test("按变量名排序：类别按给定先后，类别内按编号（1.8.0）", () => {
  const d = mk([["a", "甲", "{{setvar::风格2::\n内容\n}}"], ["b", "乙", "{{setvar::人设1::\n内容\n}}"], ["c", "丙", "{{setvar::风格1::\n内容\n}}"]]);
  assert.deepEqual(A.sortTagIds(d, ["a", "b", "c"], ["风格", "人设"]), ["c", "a", "b"]);
});

test("分组关闭标记：有柏宝箱时挡住组内条目，没有时只看条目开关（1.9.0）", () => {
  const d = mk([["a", "甲", "正文甲"], ["b", "乙", "正文乙"]]);
  d.groups.groups.push({ id: "g", name: "组", enabled: false });
  d.groups.prompts.a = { groupId: "g" };
  d.groups.prompts.b = { groupId: "g" };
  // 旧数据：分组标记是关的，条目自己还开着
  assert.equal(d.isActive("a"), false, "默认（有柏宝箱）按分组标记");
  assert.equal(d.groupOff("g"), true);
  d.groupGate = false;
  assert.equal(d.isActive("a"), true, "没有柏宝箱时酒馆照样发送");
  assert.equal(d.groupOff("g"), true, "显示分组自身标记，不随宿主过滤能力改变");
  d.order.find((o) => o.identifier === "b").enabled = false;
  d.setGroupEnabled("g", false);
  assert.equal(d.isActive("a"), true, "无宿主过滤时，关闭分组不改写条目来模拟过滤");
  assert.equal(d.groupOff("g"), true);
  d.setGroupEnabled("g", true);
  assert.deepEqual(d.order.map((o) => o.enabled), [true, false], "开关分组均保留内部选择");
});
// ---- 1.9.0 加载体检的统计口径
const D = require("./diag.cjs");
const O = "https://st.example";
const E = (p, o) => ({ name: O + p, startTime: 0, duration: 100, requestStart: 10, responseStart: 60, responseEnd: 100, transferSize: 1000, encodedBodySize: 700, decodedBodySize: 4000, initiatorType: "fetch", workerStart: 0, ...o });
test("体检分类：角色列表和单张角色详情分开，第三方快速接口归到原类别并记下提供者（1.9.0）", () => {
  const c = (p) => D.classifyRequest(O + p, O);
  assert.equal(c("/api/characters/all").cat, "chars");
  assert.equal(c("/api/characters/get").cat, "charGet");
  assert.deepEqual(c("/api/plugins/baibaoku/v1/settings/fast-get"), { cat: "settings", provider: "柏宝库" });
  assert.deepEqual(c("/api/plugins/cocktail-plus/fast/characters-all"), { cat: "chars", provider: "鸡尾酒+" });
  assert.deepEqual(c("/api/plugins/baibaoku/v1/status"), { cat: "fast", provider: "柏宝库" });
  assert.equal(c("/api/settings/save").cat, "settingsSave");
  assert.equal(c("/scripts/extensions/third-party/foo/index.js").cat, "extFiles");
  assert.equal(c("/scripts/extensions/third-party/foo/manifest.json").cat, "extList");
  assert.equal(c("/api/extensions/discover").cat, "extList");
  assert.equal(c("/thumbnail?type=avatar&file=a.png").cat, "media");
  assert.equal(c("/api/worldinfo/get").cat, "wi");
  assert.equal(D.classifyRequest("https://cdn.other.com/x.js", O).cat, "external");
});
test("体检口径：实际传输、压缩后、解压后分开；拿不到的标未取得，不当成 0（1.9.0）", () => {
  const r = D.describeRequest(E("/api/settings/get"), O);
  assert.deepEqual([r.transfer, r.encoded, r.decoded, r.ttfb, r.recv, r.cache], [1000, 700, 4000, 50, 40, "network"]);
  const hit = D.describeRequest(E("/script.js", { transferSize: 0 }), O);
  assert.equal(hit.cache, "hit"); assert.equal(hit.transfer, 0);
  const x = D.describeRequest(E("/x.js", { name: "https://cdn.other.com/x.js", requestStart: 0, responseStart: 0, transferSize: 0, encodedBodySize: 0, decodedBodySize: 0 }), O);
  assert.equal(x.cache, "unknown"); assert.equal(x.transfer, null); assert.equal(x.ttfb, null);
  assert.equal(D.describeRequest(E("/api/settings/get", { workerStart: 5 }), O).sw, true);
});
test("体检口径：同类请求重叠的时间按并集算，不相加（1.9.0）", () => {
  assert.equal(D.unionMs([[0, 100], [50, 150], [300, 400]]), 250);
  const reqs = [E("/api/characters/get", { startTime: 0, responseEnd: 1000, duration: 1000 }), E("/api/characters/get", { startTime: 500, responseEnd: 1500, duration: 1000 })].map((r) => D.describeRequest(r, O));
  const g = D.summarizeRequests(reqs).find((x) => x.cat === "charGet");
  assert.equal(g.n, 2); assert.equal(g.busy, 1500); assert.equal(g.transfer, 2000);
  assert.ok(!D.summarizeRequests(reqs).some((x) => x.cat === "chars"), "单张详情不算进全部角色列表");
});
test("诊断报告：去掉查询参数，角色、头像、聊天文件名换成…，外部网站只留域名（1.9.0）", () => {
  assert.equal(D.redactUrl(O + "/thumbnail?type=avatar&file=我的角色.png", O), "/thumbnail");
  assert.equal(D.redactUrl(O + "/characters/我的角色.png", O), "/characters/…");
  assert.equal(D.redactUrl(O + "/user/files/pa-preset-私密-1.json.gz", O), "/user/files/…");
  assert.equal(D.redactUrl("https://cdn.other.com/a/b.js?k=1", O), "外部：cdn.other.com");
  assert.equal(D.redactUrl(O + "/scripts/extensions/third-party/JS-Slash-Runner/dist/index.js", O), "/scripts/extensions/third-party/JS-Slash-Runner/dist/index.js");
  const m = { reqs: [D.describeRequest(E("/characters/秘密.png?x=1"), O)], readyAt: null, readySource: "late", domReady: 100, evalAt: 50, background: [], bufferFull: false };
  const rep = D.buildDiagReport({ version: "t", kind: "extension", measure: m, presets: [{ api: "openai", name: "我的预设", size: 10 }], extData: [], charCount: 1 });
  const text = JSON.stringify(rep);
  assert.ok(!text.includes("秘密") && !text.includes("我的预设"), "报告里没有角色名、预设名");
  assert.equal(rep.timing.chatInteractive, null);
  assert.ok(rep.gaps.some((x) => x.includes("聊天可操作")));
});
console.log(`\n${n} 项通过${skipped ? `，${skipped} 项跳过` : ""}`);
require("./reply-core.cjs");
require("./reply-runtime.cjs");
require("./variable-safety.cjs");
require("./variable-flow.cjs");
require("./semantic-review.cjs");
require("./group-repair.cjs");
require("./host-save.cjs");
require("./group-classify.cjs");
require("./group-toggle.cjs");
require("./performance-core.cjs");
require("./performance-list.cjs");

require("./regex-core.cjs");
require("./regex-host.cjs");
require("./merge-core.cjs");
require("./compat-floor.cjs");
