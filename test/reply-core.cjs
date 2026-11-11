const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeReplyRules, checkReplyFormat, buildReplyReminder, replyCheckMask, planReplyFix, learnReplyLayout, diagnoseReplySample, replySampleSkeleton } = new Function(
  fs.readFileSync(path.join(__dirname, '../src/core/replycheck.js'), 'utf8') +
  '\nreturn { normalizeReplyRules, checkReplyFormat, buildReplyReminder, replyCheckMask, planReplyFix, learnReplyLayout, diagnoseReplySample, replySampleSkeleton };'
)();
let passed = 0;
function test(name, run) {
  try { run(); passed++; console.log(`ok - ${name}`); }
  catch (error) { console.error(`not ok - ${name}`); throw error; }
}
const kinds = (text, rules) => checkReplyFormat(text, rules).issues.map((issue) => issue.kind);
const clean = (text, rules) => assert.deepEqual(checkReplyFormat(text, rules).issues, []);
test('defaults and normalized rules round trip', () => {
  assert.deepEqual(normalizeReplyRules(), { bodyTag: 'content', thinkingTags: ['think', 'thinking'], requiredTags: [] });
  const rules = normalizeReplyRules({ bodyTag: '正文', thinkingTag: '内部分析', requiredTags: '摘要， 状态\n时间、摘要' });
  assert.deepEqual(rules.requiredTags, ['摘要', '状态', '时间']);
  assert.deepEqual(normalizeReplyRules(rules), rules);
});
test('normal body and optional serial thought blocks', () => {
  clean('<content>故事正文。</content>');
  clean('<think>内部文字。</think>\n<thinking>更多文字。</thinking>\n<content>故事正文。</content>');
  clean('<CONTENT>故事正文。</CONTENT>');
});
test('Chinese and custom tags with required tags', () => {
  clean('<内部分析>隐藏区</内部分析><正文>故事。<状态>晴</状态></正文><摘要>结束。</摘要>', { bodyTag: '正文', thinkingTag: '内部分析', requiredTags: ['状态', '摘要'] });
});
test('missing body, opening and closing', () => {
  assert(kinds('只有正文。').includes('missing'));
  assert(kinds('正文。</content>').includes('missing'));
  assert(kinds('<content>正文。').includes('missing'));
});
test('missing required tag', () => assert(kinds('<content>正文。</content>', { requiredTags: '摘要' }).includes('missing')));
test('duplicate body and required tags', () => {
  assert(kinds('<content>一</content><content>二</content>').includes('duplicate'));
  assert(kinds('<content>正文。</content><摘要>一</摘要><摘要>二</摘要>', { requiredTags: ['摘要'] }).includes('duplicate'));
});
test('empty body including markup and comments', () => {
  assert(kinds('<content> \n </content>').includes('empty'));
  assert(kinds('<content><p></p><!-- 示例 --></content>').includes('empty'));
});
test('closing before opening is invalid', () => assert(kinds('</content><content>正文。').includes('order')));
test('crossed body and required tags are invalid', () => assert(kinds('<content><摘要>文字</content></摘要>', { requiredTags: ['摘要'] }).includes('order')));
test('self-closing tags cannot replace complete pairs', () => {
  assert(kinds('<content/>').includes('order'));
  assert(kinds('<think/><content>正文</content>').includes('order'));
});
test('unclosed and unmatched thought tags', () => {
  assert(kinds('<think>思考<content>故事</content>').includes('order'));
  assert(kinds('</thinking><content>故事</content>').includes('order'));
});
test('nested thought tags are invalid even if balanced', () => assert(kinds('<think><thinking>内容</thinking></think><content>正文</content>').includes('order')));
test('body swallowed in thought', () => assert(kinds('<think><content>正文</content></think>').includes('swallowed')));
test('required tag swallowed in custom thought', () => assert(kinds('<分析区><摘要>摘要</摘要></分析区><content>正文</content>', { thinkingTag: '分析区', requiredTags: ['摘要'] }).includes('swallowed')));
test('thought leaks into body', () => assert(kinds('<content>正文<think>内部分析</think></content>').includes('leak')));
test('crossed thought and body detects structural problem', () => {
  const found = kinds('<think><content>正文</think></content>');
  assert(found.includes('swallowed'));
  assert(found.includes('order'));
});
test('fenced tag examples outside body are ignored', () => {
  clean('```xml\n<think><content>示例</content></think>\n```\n<content>正文</content>');
  clean('~~~~xml\n<content>示例</content>\n~~~\n</think>\n~~~~\n<content>正文</content>');
});
test('code-only body counts as content without inspecting example tags', () => clean('<content>\n```xml\n<think>示例</think>\n```\n</content>'));
test('inline code examples do not become real thought tags or comments', () => {
  clean('<content>纸条写着 `<think>`。</content>');
  clean('<content>示例是 `` `<think>` ``。</content>');
  clean('<content>注释示例 `<!-- 未闭合`。</content>');
  clean('`<content>示例</content>`\n<content>正常正文。</content>');
  assert(kinds('<content>未成对的反引号 `<think>内部分析</think></content>').includes('leak'));
});
test('HTML comment examples and headings are ignored', () => clean('<!--\n<content>示例</content>\n### 分析\n-->\n<content>正文</content>'));
test('unclosed HTML comment inside a code fence does not swallow outside body', () => {
  clean('```html\n<!--\n```\n<content>正常正文。</content>');
  clean('~~~html\n<!-- 注释示例\n~~~\n<content>正常正文。</content>');
});
test('code-only body preserves an unclosed HTML comment example', () => {
  const source = '<content>\n```html\n<!-- 示例未闭合\n```\n</content>';
  clean(source);
  assert(replyCheckMask(source, true).includes('<!-- 示例未闭合'));
});
test('code fences inside an HTML comment do not swallow outside body', () => {
  clean('<!--\n```html\n<content>注释中的示例</content>\n-->\n<content>正常正文。</content>');
  clean('<!--\n~~~html\n### 分析\n-->\n<content>正常正文。</content>');
});
test('real unclosed HTML comments remain masked until end', () => {
  assert(kinds('<!--\n```html\n<content>注释中的正文</content>').includes('missing'));
  clean('<content>正常正文。</content>\n<!--\n```html\n### 分析\n<content>注释中的正文</content>');
});
test('mask preserves length and all newline positions through mixed regions', () => {
  const source = '<!--\r\n```\r\n-->\r\n```html\r\n<!-- 未闭合\r\n```\r\n<content>正常<!-- 隐藏 -->正文。</content>';
  for (const preserveCode of [false, true]) {
    const masked = replyCheckMask(source, preserveCode);
    assert.equal(masked.length, source.length);
    assert.deepEqual([...masked.matchAll(/[\r\n]/g)].map((match) => match.index), [...source.matchAll(/[\r\n]/g)].map((match) => match.index));
  }
  clean(source);
});
test('unclosed fence ignores tag examples until end', () => clean('<content>正文</content>\n```xml\n<think><content>示例</content>'));
test('obvious reasoning headers outside body are only suspected', () => {
  for (const header of ['### 思考', '分析：先做这一步', '### 推理过程', 'Step 1: 检查要求', '### Phase 1']) {
    assert(kinds(`${header}\n<content>正文</content>`).includes('suspected'), header);
  }
});
test('narration and headings inside body or thought are not suspected', () => {
  clean('思考这件事让他停下脚步。\n<content>正文</content>');
  clean('<content>\n### 分析\n角色分析了案情。\n</content>');
  clean('<think>\n### 分析\n内容。\n</think><content>正文</content>');
  clean('<content>第一步，他走出房门。</content>');
});
test('empty optional thought tag is omitted', () => assert.deepEqual(normalizeReplyRules({ thinkingTag: '' }).thinkingTags, ['think', 'thinking']));
test('illegal explicit rules throw', () => {
  for (const rule of [{ bodyTag: '' }, { bodyTag: '<1body>' }, { bodyTag: '1body' }, { bodyTag: 'x'.repeat(41) }, { bodyTag: 'think' }, { bodyTag: '正文', thinkingTag: '正文' }, { requiredTags: ['thinking'] }, { requiredTags: ['a/b'] }, { requiredTags: [null] }, { requiredTags: 3 }, { thinkingTags: 'think' }]) {
    assert.throws(() => normalizeReplyRules(rule), JSON.stringify(rule));
  }
});
test('tag names are cleaned before checking', () => {
  const r = normalizeReplyRules({ bodyTag: '<content>', requiredTags: 'card\u200b_status、ｍｅｍｏ；mood——bar、</状态>', thinkingTag: '＜分析＞' });
  assert.equal(r.bodyTag, 'content');
  assert.deepEqual(r.requiredTags, ['card_status', 'memo', 'mood_bar', '状态']);
  assert.ok(r.thinkingTags.includes('分析'));
  assert.throws(() => normalizeReplyRules({ requiredTags: '状态、1摘要' }), (e) => e.field === 'required' && /「1摘要」/.test(e.message));
  assert.throws(() => normalizeReplyRules({ bodyTag: 'think' }), (e) => e.field === 'body');
});
test('a required tag written under another name is named in the check, reminder and fix', () => {
  const rules = { requiredTags: ['card_status'] };
  const knownTags = new Set(['content', 'author_note', 'card_status', 'quote', '时']);
  knownTags.children = new Map([['card_status', new Set(['时', '地'])]]);
  const reply = '<content>正文。</content>\n<author_note>\n<quote>一句</quote>\n</author_note>\n\n<状态栏>\n  <时>未时</时>\n</状态栏>';
  // 前几条回复已经写成了 <状态栏>：照常点名的话会越提醒越错
  const layout = learnReplyLayout([reply, reply], rules);
  assert.ok(layout.tail.includes('状态栏'));
  const report = checkReplyFormat(reply, rules, { layout, knownTags });
  assert.match(report.issues.find((i) => i.kind === 'missing').text, /<状态栏> 预设没有用到，多半是写错了名字的 <card_status>/);
  const reminder = buildReplyReminder(report, rules);
  assert.match(reminder, /上一轮 <card_status> 的标签名写错了/);
  assert.doesNotMatch(reminder, /状态栏/, '提醒不写出错误的标签名');
  assert.doesNotMatch(reminder, /正文后的[^。]*<状态栏>[^。]*照常输出/, '不再点名让 <状态栏> 照常输出');
  assert.doesNotMatch(reminder, /author_note/, '只点名正文和必需标签');
  // 用到时才扫预设：没缺必需标签时不调用
  let calls = 0;
  checkReplyFormat('<content>正文</content><card_status>x</card_status>', rules, { knownTags: () => { calls++; return knownTags; } });
  assert.equal(calls, 0);
  // 修正：把 <状态栏> 改名为 <card_status>，内容不动
  const plan = planReplyFix(reply, rules, { layout, knownTags });
  assert.ok(plan.steps.includes('把 <状态栏>…</状态栏> 改名为 <card_status>…</card_status>'));
  assert.equal(plan.text, reply.replace('<状态栏>', '<card_status>').replace('</状态栏>', '</card_status>'));
  assert.deepEqual(plan.after.issues, []);
});
test('a stranger whose inner tags do not match is not renamed automatically', () => {
  const rules = { requiredTags: ['card_status'] };
  const knownTags = new Set(['content', 'card_status', '时']);
  knownTags.children = new Map([['card_status', new Set(['时'])]]);
  // 世界书里定义的小剧场，预设查不到；这一轮恰好漏了 <card_status>
  const reply = '<content>正文。</content>\n<小剧场>\n<角色>甲</角色>\n</小剧场>';
  const report = checkReplyFormat(reply, rules, { knownTags });
  assert.match(report.issues[0].text, /可能是写错了名字/);
  const reminder = buildReplyReminder(report, rules);
  assert.doesNotMatch(reminder, /写错了/, '不确定时不点名说写错了');
  assert.match(reminder, /上一轮没有 <card_status>：必需标签的名字一字不改/);
  assert.equal(planReplyFix(reply, rules, { knownTags, strict: true }), null, '自动修正不改名');
  assert.ok(planReplyFix(reply, rules, { knownTags }).steps[0].includes('改名为 <card_status>'), '手动修正有预览，仍可改');
});
test('among several strangers the one whose inner tags match is picked', () => {
  const rules = { requiredTags: ['card_status'] };
  const knownTags = new Set(['content', 'card_status', '时']);
  knownTags.children = new Map([['card_status', new Set(['时'])]]);
  // <author_note> 写在世界书里，预设查不到；<状态栏> 里有 <时>，和预设里 <card_status> 的结构对得上
  const reply = '<content>正文。</content>\n<author_note>注</author_note>\n<状态栏>\n<时>未时</时>\n</状态栏>';
  const report = checkReplyFormat(reply, rules, { knownTags });
  assert.deepEqual(report.misnamed.pairs.map((p) => [p.block.name, p.sure]), [['状态栏', true]]);
  assert.match(buildReplyReminder(report, rules), /上一轮 <card_status> 的标签名写错了/);
  assert.doesNotMatch(buildReplyReminder(report, rules), /状态栏/);
  const plan = planReplyFix(reply, rules, { knownTags, strict: true });
  assert.ok(plan.text.includes('<card_status>\n<时>未时</时>\n</card_status>') && plan.text.includes('<author_note>注</author_note>'), '只改结构对得上的那块');
});
test('misnamed tags are not guessed without preset tags or with several strangers', () => {
  const rules = { requiredTags: ['card_status'] };
  const reply = '<content>正文。</content>\n<状态栏>x</状态栏>\n<小剧场>y</小剧场>';
  assert.equal(checkReplyFormat(reply, rules).misnamed, null, '读不到预设时不判断');
  assert.equal(planReplyFix(reply, rules), null);
  const report = checkReplyFormat(reply, rules, { knownTags: new Set(['content', 'card_status']) });
  assert.equal(report.misnamed.pairs.length, 0, '多出两个陌生块时不认定是哪个');
  assert.match(buildReplyReminder(report, rules), /上一轮没有 <card_status>：必需标签的名字一字不改/);
  assert.equal(planReplyFix(reply, rules, { knownTags: new Set(['content', 'card_status']) }), null, '不确定时不改名');
});
test('required tags deduplicate case insensitively', () => {
  assert.deepEqual(normalizeReplyRules({ requiredTags: ['summary', 'SUMMARY', '状态'] }).requiredTags, ['summary', '状态']);
  clean('<content>正文</content>', { requiredTags: ['content'] });
});
test('reminder is empty for a valid report', () => assert.equal(buildReplyReminder(checkReplyFormat('<content>正文</content>')), ''));
test('reminder uses configured complete tags and never asks to reveal thoughts', () => {
  const rules = normalizeReplyRules({ bodyTag: '正文', requiredTags: ['摘要'] });
  const reminder = buildReplyReminder(checkReplyFormat('丢标签了', rules), rules);
  assert(reminder.includes('<正文>…</正文>'));
  assert(reminder.includes('<摘要>…</摘要>'));
  assert(reminder.includes('思考标签之外'));
  assert(reminder.includes('剧情照常接着写'));
  // 不和预设的思维链、转述打架：不说「无需展示思考」「不要复述」，也不叫正文写完就结束
  assert(!/展示思考|复述|写完即结束/.test(reminder));
});
test('reminder names only the body tag and the required tags, not blocks learned from earlier replies', () => {
  const layout = learnReplyLayout(['<状态栏>夜</状态栏>\n<content>上一条</content>\n<theater>小剧场</theater>']);
  const swallowed = buildReplyReminder(checkReplyFormat('', undefined, { reasoning: '想。\n<content>正文</content>', layout }));
  assert.match(swallowed, /思考标签必须在第一个输出块（正文或正文前的块）开始之前闭合/, '正文前有块时不点名，只说第一个输出块');
  assert.doesNotMatch(swallowed, /状态栏|theater|照常输出/);
  const tail = buildReplyReminder(checkReplyFormat('<content>正文</content>\n后面还有一大段没有被标签包住的零散说明文字，字数超过二十个。', undefined, { layout }));
  assert.match(tail, /正文结束后不追加说明或总结/);
  assert.doesNotMatch(tail, /状态栏|theater/);
  const rules = normalizeReplyRules({ requiredTags: ['状态栏'] });
  const withTag = buildReplyReminder(checkReplyFormat('<content>正文</content>', rules, { layout }), rules);
  assert.match(withTag, /<状态栏>…<\/状态栏>/, '用户填了才提醒');
});

test('analysis written before the body tag is reported with an excerpt', () => {
  const report = checkReplyFormat('我需要先检查用户要求，再安排剧情，然后写出符合人设的对话内容。\n<content>故事正文。</content>');
  const issue = report.issues.find((i) => i.kind === 'outside');
  assert(issue && issue.text.startsWith('正文标签前'));
  assert(issue.excerpt.startsWith('我需要先检查用户要求'));
  assert.match(buildReplyReminder(report), /正文标签外不要写任何分析/);
});
test('loose text after the body is reported, tag blocks, code and short endings are not', () => {
  assert(kinds('<content>正文。</content>\n以上是本轮正文。接下来我会继续推进剧情，并在下一轮安排角色登场。').includes('outside'));
  clean('<content>正文。</content>\n<状态栏>积分：3，等级：D，位格：凡人，道具：无</状态栏>');
  clean('<content>正文。</content>\n```\n状态栏代码块里的说明文字很长很长很长很长很长很长\n```');
  clean('<content>正文。</content>\n<!-- 这里是很长很长很长很长很长很长很长很长的注释 -->');
  clean('<content>正文。</content>\n（本轮完）');
  clean('<think>分析写在思考标签里，不论多长都不算正文外的文字。</think>\n<content>正文。</content>');
});
test('body swallowed into the reasoning field is detected only when the visible reply lacks the body tag', () => {
  assert(kinds('', undefined).includes('missing'));
  const report = checkReplyFormat('', undefined, { reasoning: '我先想一想。\n<content>故事正文</content>' });
  assert(report.issues.some((i) => i.kind === 'reasoning'));
  assert.match(buildReplyReminder(report), /思考标签必须在 <content> 开始之前闭合/);
  assert(!checkReplyFormat('<content>正文</content>', undefined, { reasoning: '计划：写 <content> 标签' }).issues.length);
  assert(checkReplyFormat('', undefined, { reasoning: '很长的推理'.repeat(50) }).issues.some((i) => i.kind === 'reasoning'));
  assert(!checkReplyFormat('掉标签的正文', undefined, { reasoning: '短推理' }).issues.some((i) => i.kind === 'reasoning'));
});
const letters = (s) => [...s.replace(/<[^<>]*>|【\/?[^】]*】|\[\/?[^\]]*\]/g, '').replace(/\s/g, '')].sort().join('');
const fixed = (text, rules, extra) => {
  const plan = planReplyFix(text, rules, extra);
  assert(plan, text);
  assert.equal(letters(plan.text + (plan.reasoning || '')), letters(text + (extra?.reasoning || '')), '修正不增删文字');
  return plan;
};
test('fix renames misnamed or bracketed body tags', () => {
  assert.equal(fixed('<正文>故事。</正文>').text, '<content>故事。</content>');
  assert.equal(fixed('【content】故事。【/content】').text, '<content>故事。</content>');
  assert.equal(fixed('[Story]故事。[/Story]').text, '<content>故事。</content>');
  assert.equal(fixed('<content>故事。</content>'.replace(/content/g, '正文'), { bodyTag: 'story' }).text, '<story>故事。</story>');
});
test('fix closes an unclosed thought before the body and moves a swallowed body out', () => {
  const a = fixed('<think>分析\n<content>故事。</content>');
  assert.equal(a.text, '<think>分析\n</think>\n<content>故事。</content>');
  assert.deepEqual(a.after.issues, []);
  const b = fixed('<think>分析A<content>故事。</content>分析B</think>');
  assert.equal(b.text, '<think>分析A\n分析B\n</think>\n<content>故事。</content>');
  assert.deepEqual(b.after.issues, []);
});
test('fix adds a missing closing or opening body tag', () => {
  const a = fixed('<content>故事很长。\n\n<状态栏>积分：3</状态栏>\n');
  assert.equal(a.text, '<content>故事很长。\n</content>\n<状态栏>积分：3</状态栏>\n');
  assert.equal(fixed('<content>故事').text, '<content>故事\n</content>');
  assert.equal(fixed('<think>想</think>\n故事。</content>').text, '<think>想</think>\n<content>\n故事。</content>');
  assert.equal(fixed('<content>故事', { requiredTags: ['摘要'] }).text, '<content>故事\n</content>');
  assert.equal(fixed('<content>故事\n<摘要>概要</摘要>', { requiredTags: ['摘要'] }).text, '<content>故事\n</content>\n<摘要>概要</摘要>');
});
test('fix moves the body back from the reasoning field', () => {
  const plan = fixed('', undefined, { reasoning: '我在想。\n<content>故事正文</content>' });
  assert.equal(plan.text, '<content>故事正文</content>');
  assert.equal(plan.reasoning, '我在想。');
  assert(plan.reasoningChanged);
  const open = fixed('<状态栏>x</状态栏>', undefined, { reasoning: '我在想。\n<content>故事正文' });
  assert.equal(open.text, '<content>故事正文\n</content>\n<状态栏>x</状态栏>');
});
test('fix declines when only text or duplicates are wrong', () => {
  assert.equal(planReplyFix('<content>好</content>'), null);
  assert.equal(planReplyFix('只有正文没有标签'), null);
  assert.equal(planReplyFix('<content>一</content><content>二</content>'), null);
});
test('leaked leading thought moves into the reasoning area (2.4.1)', () => {
  const same = planReplyFix('我先分析一下用户的要求和人设，然后安排剧情发展。<content>正文</content>');
  assert.equal(same.text, '<content>正文</content>');
  assert.equal(same.reasoning, '我先分析一下用户的要求和人设，然后安排剧情发展。');
  assert(same.reasoningChanged);
  // 开头的注释、后面的锚定注释和标题都留在原处，只移走没被包住的那一段
  const text = '<!-- Start -->\n[按步骤详细思考下面所有要求，不要跳过任何一步]\n第一步：确认身份和任务。\n第二步：梳理前文和人物。\n<!-- 锚定: 视角 -->\n<novel_header>\n[CHAP] 07\n</novel_header>\n<content>\n正文\n</content>';
  const plan = planReplyFix(text, undefined, { reasoning: '模型自带的思考' });
  assert.equal(plan.text, '<!-- Start -->\n<!-- 锚定: 视角 -->\n<novel_header>\n[CHAP] 07\n</novel_header>\n<content>\n正文\n</content>');
  assert.equal(plan.reasoning, '模型自带的思考\n\n[按步骤详细思考下面所有要求，不要跳过任何一步]\n第一步：确认身份和任务。\n第二步：梳理前文和人物。');
  assert.deepEqual(plan.after.issues, []);
  // 开头是没闭合的思考标签：仍按原来的方式在正文前补结束标签，不整段搬走
  const open = planReplyFix('<thinking>\n第一步：确认身份和任务，梳理前文。\n<content>正文</content>');
  assert.equal(open.text, '<thinking>\n第一步：确认身份和任务，梳理前文。\n</thinking>\n<content>正文</content>');
  assert.equal(open.reasoningChanged, false);
  // 字数太少不算
  assert.equal(planReplyFix('好的。<content>正文</content>'), null);
});
test('auto fix does not close a possibly truncated body at the end', () => {
  assert.equal(planReplyFix('<content>故事写到一半', undefined, { noTailClose: true }), null);
  assert.equal(planReplyFix('<content>故事写到一半').text, '<content>故事写到一半\n</content>');
  // 后面还有别的标签时，补在那个标签前面仍然安全
  assert.equal(planReplyFix('<content>故事\n<状态栏>晴</状态栏>', { requiredTags: ['状态栏'] }, { noTailClose: true }).text, '<content>故事\n</content>\n<状态栏>晴</状态栏>');
});
test('status bars and side stories leave the reasoning together with the body', () => {
  const prev = ['<status>\n时间：夜\n</status>\n<content>\n上一条正文\n</content>\n<theater>\n上一条小剧场\n</theater>', '开场白'];
  const layout = learnReplyLayout(prev);
  assert.deepEqual(layout, { head: ['status'], tail: ['theater'], names: { status: 'status', theater: 'theater' } });
  // 前几条回复的正文前后都有块：思考里的草稿块不搬，正文前的状态栏、注释和后面的小剧场一起搬
  const reasoning = '我先想想剧情。\n<plan>草稿</plan>\n<status>\n时间：晨\n</status>\n<!-- 锚定 -->\n<content>\n这条正文\n</content>\n<theater>\n这条小剧场\n</theater>\n';
  const plan = fixed('', undefined, { reasoning, layout });
  assert.equal(plan.text, '<status>\n时间：晨\n</status>\n<!-- 锚定 -->\n<content>\n这条正文\n</content>\n<theater>\n这条小剧场\n</theater>');
  assert.equal(plan.reasoning, '我先想想剧情。\n<plan>草稿</plan>');
  assert.match(plan.steps[0], /连同前面的 <status>、后面的 <theater> 一起移回/);
  assert.deepEqual(plan.after.issues, []);
  // 学不到时，正文后面紧挨着的完整块照搬，正文前的块不动；必需标签也算
  assert.equal(fixed('', undefined, { reasoning }).reasoning, '我先想想剧情。\n<plan>草稿</plan>\n<status>\n时间：晨\n</status>\n<!-- 锚定 -->');
  assert.equal(fixed('', { requiredTags: ['status'] }, { reasoning }).reasoning, '我先想想剧情。\n<plan>草稿</plan>');
  // 代码块写的状态栏也算
  const fenced = fixed('', undefined, { reasoning: '想。\n```\n时间：晨\n```\n<content>正文</content>', layout: learnReplyLayout(['```\n时间：夜\n```\n<content>上一条</content>']) });
  assert.equal(fenced.text, '```\n时间：晨\n```\n<content>正文</content>');
});
test('blocks left at the end of the reasoning go back to where earlier replies had them', () => {
  const layout = learnReplyLayout(['<status>夜</status>\n<content>上一条</content>\n<theater>小剧场</theater>']);
  const reasoning = '我先想想剧情。\n<status>\n时间：晨\n</status>\n<theater>\n这条小剧场\n</theater>';
  const report = checkReplyFormat('<content>\n这条正文\n</content>', undefined, { reasoning, layout });
  assert.deepEqual(report.issues.map((i) => i.kind), ['stranded']);
  assert.match(buildReplyReminder(report), /思考标签必须在第一个输出块（正文或正文前的块）开始之前闭合/);
  assert.doesNotMatch(buildReplyReminder(report), /status|theater/, '不点名没填的标签');
  const plan = fixed('<content>\n这条正文\n</content>', undefined, { reasoning, layout });
  assert.equal(plan.text, '<status>\n时间：晨\n</status>\n<content>\n这条正文\n</content>\n<theater>\n这条小剧场\n</theater>');
  assert.equal(plan.reasoning, '我先想想剧情。');
  assert.deepEqual(plan.after.issues, []);
  // 可见回复里已经有的、思考中间提到的、没学到的都不动
  assert.deepEqual(checkReplyFormat('<status>晨</status>\n<content>正文</content>', undefined, { reasoning: '想。\n<status>草稿</status>', layout }).issues, []);
  assert.deepEqual(checkReplyFormat('<content>正文</content>', undefined, { reasoning: '想。\n<status>草稿</status>\n接着想。', layout }).issues, []);
  assert.deepEqual(checkReplyFormat('<content>正文</content>', undefined, { reasoning: '想。\n<plan>草稿</plan>', layout }).issues, []);
  assert.deepEqual(checkReplyFormat('<content>正文</content>', undefined, { reasoning: '想。\n<status>草稿</status>' }).issues, []);
});
test('earlier replies are only read when the check needs them', () => {
  let calls = 0;
  const layout = () => { calls++; return learnReplyLayout(['<status>夜</status>\n<content>上一条</content>']); };
  assert.deepEqual(checkReplyFormat('<content>正文</content>', undefined, { reasoning: '想了很久。\n<status>草稿</status>\n接着想。', layout }).issues, []);
  assert.equal(calls, 0, '思考区末尾不是标签时不去学');
  assert.equal(checkReplyFormat('<content>正文</content>', undefined, { reasoning: '想。\n<status>晨</status>', layout }).issues[0].kind, 'stranded');
  assert.equal(calls, 1);
});
test('blocks next to a body inside a visible thinking tag move out with it', () => {
  const layout = learnReplyLayout(['<status>夜</status>\n<content>上一条</content>\n<theater>小剧场</theater>']);
  assert.equal(fixed('<thinking>想\n<status>s</status>\n<content>正文</content>\n<theater>t</theater>\n</thinking>', undefined, { layout }).text, '<thinking>想\n</thinking>\n<status>s</status>\n<content>正文</content>\n<theater>t</theater>');
  assert.equal(fixed('<thinking>想\n<status>s</status>\n<content>正文</content>', undefined, { layout }).text, '<thinking>想\n</thinking>\n<status>s</status>\n<content>正文</content>');
});
test('an unused wrapper around a required tag is reported, reminded without its name and removed (2.8.3)', () => {
  const rules = { requiredTags: ['card_status'] };
  const knownTags = new Set(['content', 'card_status', '时']);
  knownTags.children = new Map([['card_status', new Set(['时'])]]);
  const inner = '<card_status>\n  <时>酉时</时>\n</card_status>';
  const reply = `<content>正文。</content>\n<状态栏>\n${inner}\n</状态栏>`;
  const report = checkReplyFormat(reply, rules, { knownTags });
  assert.deepEqual(report.issues.map((i) => i.kind), ['wrapped']);
  assert.match(report.issues[0].text, /<card_status> 外面多套了一层 <状态栏>/);
  const reminder = buildReplyReminder(report, rules);
  assert.match(reminder, /上一轮在 <card_status> 外面多套了一层标签/);
  assert.doesNotMatch(reminder, /状态栏/, '提醒不写出外层的错误标签名');
  const plan = planReplyFix(reply, rules, { knownTags, strict: true });
  assert.deepEqual(plan.steps, ['去掉 <card_status> 外面多套的 <状态栏>…</状态栏>']);
  assert.equal(plan.text, `<content>正文。</content>\n${inner}`);
  assert.deepEqual(plan.after.issues, []);
  // 外层是预设用到的容器、外层里还有别的文字、读不到预设时都不算
  const container = new Set([...knownTags, '状态栏']); container.children = knownTags.children;
  assert.deepEqual(checkReplyFormat(reply, rules, { knownTags: container }).issues, []);
  assert.deepEqual(checkReplyFormat(`<content>正文。</content>\n<状态栏>\n${inner}\n附注</状态栏>`, rules, { knownTags }).issues, []);
  assert.deepEqual(checkReplyFormat(reply, rules).issues, []);
});
// 2.9.0 按范本诊断、范本提醒、正文外允许有文字
const SAMPLE = '<think>想一想</think>\n<正文>她推开窗，夜风带着海盐味涌进屋里。</正文>\n<card_status>心情：好</card_status>';
test('sample diagnosis: body tag differs from settings', () => {
  const d = diagnoseReplySample(SAMPLE, { bodyTag: 'content', requiredTags: ['card_status'] });
  assert.equal(d.patch.bodyTag, '正文');
  assert.equal(d.after.issues.length, 0);
  assert.deepEqual(d.skeleton, ['正文', 'card_status']);
});
test('sample diagnosis: required tag absent or renamed in the sample', () => {
  const gone = diagnoseReplySample(SAMPLE, { bodyTag: '正文', requiredTags: ['card_status', 'memo'] });
  assert.deepEqual(gone.patch.requiredTags, ['card_status']);
  assert.equal(gone.after.issues.length, 0);
  const known = new Set(['正文', 'mood']);
  const renamed = diagnoseReplySample(SAMPLE, { bodyTag: '正文', requiredTags: ['mood'] }, { knownTags: known });
  assert.deepEqual(renamed.patch.requiredTags, ['card_status']);
  assert.match(renamed.advice[0].text, /mood 改为 card_status/);
});
test('sample diagnosis: no body wrapper, text outside body, clean sample', () => {
  const bare = diagnoseReplySample('她推开窗，夜风涌进屋里。', { bodyTag: 'content' });
  assert.equal(bare.patch.enabled, false);
  assert.equal(bare.patch.autoFix, false);
  const out = diagnoseReplySample('<content>她推开窗。</content>\n这里是一段写在正文标签外面的作者的话，长度超过二十个字才会被检查到。', { bodyTag: 'content' });
  assert.equal(out.patch.allowOutside, true);
  assert.equal(out.after.issues.length, 0);
  const ok = diagnoseReplySample(SAMPLE, { bodyTag: '正文', requiredTags: ['card_status'] });
  assert.equal(ok.advice.length, 0);
  assert.deepEqual(ok.patch, {});
});
test('reminder follows the sample order only when switched on', () => {
  const rules = { bodyTag: 'content', requiredTags: ['card_status'], skeleton: ['card_status', 'content', 'memo'] };
  const report = checkReplyFormat('<content>正文</content>', rules);
  assert.match(buildReplyReminder(report, rules), /按这个顺序输出.*<card_status>…<\/card_status>、<content>…<\/content>、<memo>…<\/memo>/);
  const off = { ...rules, remindBySample: false };
  assert.equal(normalizeReplyRules(off).skeleton, undefined);
  assert.doesNotMatch(buildReplyReminder(checkReplyFormat('<content>正文</content>', off), off), /按这个顺序/);
  assert.deepEqual(replySampleSkeleton(SAMPLE, { bodyTag: '正文' }), ['正文', 'card_status']);
});
console.log(`${passed} reply-format tests passed`);
