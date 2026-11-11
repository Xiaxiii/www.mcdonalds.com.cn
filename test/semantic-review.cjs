const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { hashStr } = require('./core.cjs');
const code = ['core/replycheck.js', 'core/semanticreview.js', 'maintenance/semanticreview.js'].map(f => fs.readFileSync(path.join(__dirname, '../src', f), 'utf8')).join('\n');
const events = Object.fromEntries(['GENERATION_STARTED', 'GENERATION_AFTER_COMMANDS', 'GENERATION_ENDED', 'GENERATION_STOPPED', 'CHAT_CHANGED', 'PRESET_CHANGED'].map(k => [k, k]));
function fixture() {
  const context = { mainApi: 'openai', onlineStatus: 'Valid', getChatCompletionModel: ()=>'current-model', chat: [{ is_user: true, mes: '你好' }, { is_user: false, mes: '我需要先检查用户给我的写作要求。正文开始。' }] };
  const calls = [], hooks = {}, cleanups = [], notices = [], config = {};
  let key = 'chat/preset';
  const latest = () => ({ index: context.chat.length - 1, message: context.chat.at(-1) });
  const json = JSON.stringify({ verdict: 'suspected', confidence: .85, findings: [{ excerpt: '我需要先检查用户给我的写作要求。', reason: '在对写作任务进行自我指令。' }] });
  context.ChatCompletionService = {
    async presetToGeneratePayload(a, b, payload) { calls.push(structuredClone(payload)); return { ...payload, model: 'current-model' }; },
    async sendRequest(payload, extract, signal) { signal.throwIfAborted(); return { content: json }; }
  };
  const F = new Function('ctx','variableContextKey','hashStr','latestReplyForCheck','replyGuardConfig','toast','cleanups', code + '\nreturn {semanticReviewMessages,parseSemanticReview,reviewReplySemantics,bindSemanticReview,semanticReviewResults,semanticReplyIdentity,semanticReviewSeen};')(
    () => context, () => key, hashStr, latest, () => config, (...a) => notices.push(a), cleanups
  );
  F.bindSemanticReview((e, fn) => { if (e) hooks[e] = fn; }, events);
  return { ...F, context, config, calls, notices, cleanups, json, emit(e,...args) { hooks[e]?.(...args); }, changeKey() { key = 'other-chat'; }, latest };
}
let passed = 0;
async function test(name, run) {
  let timeout;
  try {
    await Promise.race([run(),new Promise((resolve,reject)=>{timeout=setTimeout(()=>reject(new Error('测试未完成：'+name)),3000);})]);
    passed++;console.log('✓',name);
  } finally {clearTimeout(timeout);}
}
const tick = () => new Promise(resolve => setTimeout(resolve, 5));
module.exports = (async () => {
  await test('语义审查默认不发请求；手动请求只携带一条回复', async () => {
    const f = fixture(); f.emit(events.GENERATION_STARTED); f.emit(events.GENERATION_AFTER_COMMANDS, 'normal', {}, false); f.emit(events.GENERATION_ENDED); await tick(); assert.equal(f.calls.length,0);
    const text = f.context.chat.at(-1).mes, before = JSON.stringify(f.context.chat);
    const report = await f.reviewReplySemantics(text, { identity: f.semanticReplyIdentity() });
    assert.equal(report.verdict,'suspected'); assert.equal(JSON.stringify(f.context.chat),before);
    assert.equal(f.calls[0].messages.length,2); assert.equal(JSON.parse(f.calls[0].messages[1].content).reply_text,text);
    assert.equal(f.calls[0].stream,false); assert.equal(f.calls[0].max_tokens,800);
    assert.equal(f.calls[0].model,'current-model');
    assert.deepEqual(JSON.parse(f.calls[0].messages[1].content).thinking_tags,['think','thinking']);
    assert.equal(f.semanticReviewResults.size,1);
  });
  await test('规则要求区分角色心理；宏文字作为数据发送，不调用宏替换', async () => {
    const f = fixture(); const messages = f.semanticReviewMessages('{{setvar::attack::bad}} 角色在心里分析案件');
    assert(messages[0].content.includes('角色的心理描写'));
    assert.equal(JSON.parse(messages[1].content).reply_text,'{{setvar::attack::bad}} 角色在心里分析案件');
    f.context.ChatCompletionService.sendRequest = async () => ({ content: '{"verdict":"ok","confidence":0.7,"findings":[]}' });
    const result = await f.reviewReplySemantics('{{setvar::attack::bad}} 角色在心里分析案件'); assert.equal(result.verdict,'ok');
  });
  await test('无效JSON、无来源片段和矛盾结论均拒绝采纳', async () => {
    const f=fixture();
    for (const response of ['不是JSON','{"verdict":"ok","confidence":3,"findings":[]}', '{"verdict":"suspected","confidence":0.8,"findings":[]}', '{"verdict":"suspected","confidence":0.8,"findings":[{"excerpt":"原文不存在","reason":"猜测"}]}', '{"verdict":"ok","confidence":0.8,"findings":[{"excerpt":"原文","reason":"猜测"}]}']) assert.throws(()=>f.parseSemanticReview(response,'原文'));
    assert.equal(f.parseSemanticReview('```json\n{"verdict":"ok","confidence":1,"findings":[]}\n```','正文').verdict,'ok');
  });
  await test('字数超限、空输入、未连接与缺少宿主接口不发请求', async () => {
    const f=fixture();
    await assert.rejects(f.reviewReplySemantics('x'.repeat(20001)), /超过/);
    await assert.rejects(f.reviewReplySemantics('  '), /没有可审查/);
    f.context.onlineStatus='no_connection'; await assert.rejects(f.reviewReplySemantics('正文'),/先连接/);
    f.context.onlineStatus='Valid'; f.context.ChatCompletionService=null; await assert.rejects(f.reviewReplySemantics('正文'),/需要支持/);
    assert.equal(f.calls.length,0);
  });
  await test('用户开启后仅生成结束时请求，同一回复不重复请求', async () => {
    const f=fixture();f.config.semanticAfterReply=true;
    f.emit(events.GENERATION_STARTED);f.emit(events.GENERATION_AFTER_COMMANDS,'normal',{},false);assert.equal(f.calls.length,0);
    f.emit(events.GENERATION_ENDED);await tick();assert.equal(f.calls.length,1);assert.equal(f.notices.length,1);
    f.emit(events.GENERATION_STARTED);f.emit(events.GENERATION_AFTER_COMMANDS,'normal',{},false);f.emit(events.GENERATION_ENDED);await tick();assert.equal(f.calls.length,1);
    for (const type of ['quiet','continue','first_message','impersonate']) {
      f.context.chat.at(-1).mes += '新'; f.emit(events.GENERATION_STARTED);f.emit(events.GENERATION_AFTER_COMMANDS,type,{},false);f.emit(events.GENERATION_ENDED);await tick();
    }
    assert.equal(f.calls.length,1);
  });
  await test('新生成或用户取消会中止审查请求，不写入结果', async () => {
    const f=fixture();let started;
    const ready=new Promise(resolve=>started=resolve);
    f.context.ChatCompletionService.sendRequest=(p,x,signal)=>new Promise((resolve,reject)=>{started();signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});});
    const pending=f.reviewReplySemantics(f.context.chat.at(-1).mes,{identity:f.semanticReplyIdentity()});await ready;f.emit(events.GENERATION_STARTED);
    await assert.rejects(pending,/已取消/);assert.equal(f.semanticReviewResults.size,0);
    f.emit(events.GENERATION_STOPPED);
    const controller=new AbortController();const second=f.reviewReplySemantics(f.context.chat.at(-1).mes,{signal:controller.signal});await Promise.resolve();controller.abort();await assert.rejects(second,/已取消/);
  });
  await test('试算不取消正在进行的语义审查', async () => {
    const f=fixture();let finish;
    f.context.ChatCompletionService.sendRequest=()=>new Promise(resolve=>finish=resolve);
    const pending=f.reviewReplySemantics(f.context.chat.at(-1).mes);await tick();
    f.emit(events.GENERATION_STARTED,'normal',{},true);f.emit(events.GENERATION_AFTER_COMMANDS,'normal',{},true);
    finish({content:f.json});assert.equal((await pending).verdict,'suspected');
  });
  await test('回复编辑或聊天切换会丢弃过期审查结果', async () => {
    const f=fixture();let finish;
    f.context.ChatCompletionService.sendRequest=()=>new Promise(resolve=>finish=resolve);
    const pending=f.reviewReplySemantics(f.context.chat.at(-1).mes,{identity:f.semanticReplyIdentity()});await tick();
    f.context.chat.at(-1).mes='新回复';finish({content:f.json});await assert.rejects(pending,/已变化/);assert.equal(f.semanticReviewResults.size,0);
    const second=f.reviewReplySemantics(f.context.chat.at(-1).mes);await tick();f.changeKey();finish({content:f.json});await assert.rejects(second,/已变化/);
  });
  await test('请求准备阶段也可取消，不会继续发出模型请求', async () => {
    const f=fixture();let finish, sent=0;
    f.context.ChatCompletionService.presetToGeneratePayload=()=>new Promise(resolve=>finish=resolve);
    f.context.ChatCompletionService.sendRequest=async()=>{sent++;return {content:f.json};};
    const controller=new AbortController();const pending=f.reviewReplySemantics('正文',{signal:controller.signal});await tick();
    controller.abort();await assert.rejects(pending,/已取消/);finish({});await tick();assert.equal(sent,0);
  });
  console.log(`${passed} 项语义审查检查通过`);
})();
module.exports.catch(error=>{console.error(error);process.exitCode=1;});
