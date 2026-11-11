// 对独立、可丢弃的真实 SillyTavern 实例运行；会创建合成角色/预设。
// 模型端为 test/fixtures/review-api.cjs 协议桩，不评估真实模型的判断准确率。
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const base = 'http://127.0.0.1:8877';
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || '/usr/bin/chromium' });
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
try {
  await page.goto(base);
  await page.waitForFunction(() => window.SillyTavern?.getContext, null, { timeout: 30000 });
  for (let i=0; i<5; i++) {
    await page.waitForTimeout(300);
    const input=page.locator('dialog[open] .popup-input:visible');
    if (await input.count()) await input.fill('开发验证用户');
    const ok=page.locator('dialog[open] .popup-button-ok:visible').last();
    if (await ok.count()) await ok.click(); else break;
  }
  await page.waitForFunction(() => window.__mcdonalds?.open, null, { timeout:30000 });
  await page.evaluate(() => window.jQuery('#main_api').val('openai').trigger('change'));
  await page.waitForFunction(() => window.SillyTavern.getContext().mainApi === 'openai');
  const setup = await page.evaluate(async () => {
    const c = window.SillyTavern.getContext();
    const response = await fetch('/api/characters/create', {method:'POST',headers:c.getRequestHeaders(),body:JSON.stringify({ch_name:'BCW验证-'+Date.now(),description:'合成测试角色',first_mes:'测试开场白',personality:'',scenario:'',mes_example:''})});
    if (!response.ok) throw Error('create character '+response.status);
    const avatar=await response.text(); await c.getCharacters();
    const id=window.SillyTavern.getContext().characters.findIndex(x=>x.avatar===avatar); await c.selectCharacterById(id);
    const openai=await import('/scripts/openai.js');
    const contents=['{{getvar::bcw_flow}}','{{setvar::bcw_flow::内容}}','{{setvar::bcw_flow::}}','{{getvar::bcw_flow}}'];
    const prompts=contents.map((content,i)=>({identifier:'bcw-'+i,name:'检查条目'+i,role:'system',content,system_prompt:false,injection_position:0}));
    const preset={...openai.getChatCompletionPreset(),prompts,prompt_order:[{character_id:100001,order:prompts.map(p=>({identifier:p.identifier,enabled:true}))}]};
    const pm=c.getPresetManager('openai'); await pm.savePreset('BCW变量验证',preset);
    const list=pm.getPresetList();const names=list.preset_names;
    const index=Array.isArray(names)?names.indexOf('BCW变量验证'):names['BCW变量验证'];await pm.selectPreset(index);
    window.jQuery('#chat_completion_source').val('custom').trigger('change');
    openai.oai_settings.chat_completion_source='custom';openai.oai_settings.custom_url='http://127.0.0.1:8888/v1';openai.oai_settings.custom_model='review-fixture';
    openai.oai_settings.stream_openai=false;
    window.jQuery('#custom_api_url_text').val('http://127.0.0.1:8888/v1').trigger('input');
    window.jQuery('#custom_model_id').val('review-fixture').trigger('input');
    window.jQuery('#api_button_openai').trigger('click');
    return { avatar, version:window.__mcdonalds.version };
  });
  await page.waitForFunction(()=>window.SillyTavern.getContext().onlineStatus !== 'no_connection',null,{timeout:15000});
  const macroCheck=await page.evaluate(()=>{
    const c=window.SillyTavern.getContext();c.variables.local.set('bcw_macro','上一轮');
    const output=c.substituteParams('{{getvar::bcw_macro}}{{setvar::bcw_macro::新值}}{{setvar::bcw_macro::}}{{getvar::bcw_macro}}');
    const final=c.variables.local.get('bcw_macro');c.variables.local.del('bcw_macro');return {output,final};
  });
  assert.deepEqual(macroCheck,{output:'上一轮',final:''});
  // 新账号的欢迎/更新说明可能晚于扩展加载出现；只关闭本测试实例的原生提示。
  for (let i=0;i<6;i++) {
    await page.waitForTimeout(250);
    const ok=page.locator('dialog[open] .popup-button-ok:visible').last();
    if (await ok.count()) await ok.click();
  }
  await page.evaluate(async()=>{
    window.jQuery('#send_textarea').val('验证生成流程').trigger('input');
    const c=window.SillyTavern.getContext();await c.generate('normal');
  });
  assert.equal(await page.evaluate(()=>window.SillyTavern.getContext().chat.at(-1).is_user),false);
  const generationCalls=(await (await fetch('http://127.0.0.1:8888/__test/requests')).json()).length;
  await page.evaluate(async()=>{const c=window.SillyTavern.getContext();await c.generate('swipe');await c.generate('continue');});
  const afterCalls=(await (await fetch('http://127.0.0.1:8888/__test/requests')).json()).length;
  assert.equal(afterCalls,generationCalls+2,'滑动与续写各调用一次后端');
  console.log('✓ 真实酒馆原生生成、滑动与续写流程通过本地模型协议桩');
  await page.evaluate(()=>window.__mcdonalds.open('cot'));
  await page.evaluate(() => window.__mcdonalds.open('vars'));
  const flow=await page.locator('[data-vf=result]').innerText();
  assert.match(flow,/可见写入之前读取/);assert.match(flow,/清空或删除/);
  await page.evaluate(()=>{
    const c=window.SillyTavern.getContext();c.variables.local.set('bcw_private','变量正文不得送入审查');c.variables.local.set('bcw_zero',0);c.variables.global.set('bcw_global','全局数据');
  });
  await page.click('[data-vf=snapshot]');
  assert.match(await page.locator('[data-vf=result]').innerText(),/bcw_private/);
  assert(!(await page.locator('[data-vf=result]').innerText()).includes('变量正文不得送入审查'));
  await page.check('[data-vf=watch]');
  await page.locator('.pa-sheet-actions .pa-btn').filter({hasText:'关闭'}).click();
  await page.waitForTimeout(200);
  await page.evaluate(async()=>{
    const c=window.SillyTavern.getContext(); await c.eventSource.emit(c.eventTypes.GENERATION_AFTER_COMMANDS,'normal',{},false);
    c.variables.local.set('bcw_zero',1);await c.eventSource.emit(c.eventTypes.GENERATION_ENDED,c.chat.length);
  });
  await page.evaluate(() => window.__mcdonalds.open('vars'));
  await page.click('[data-vf=refresh]');
  await page.locator('[data-vf=result] details').filter({hasText:'最近一次生成前后变化'}).locator('summary').click();
  assert.match(await page.locator('[data-vf=result]').innerText(),/bcw_zero.*变化/);
  await page.locator('.pa-sheet-actions .pa-btn').filter({hasText:'关闭'}).click();await page.waitForTimeout(200);
  console.log('✓ 真实酒馆变量接口、顺序风险、状态读取与生成前后对比');

  const text='我需要先检查用户给我的写作要求。{{setvar::bcw_attack::不应执行}} 正文开始。';
  await page.evaluate(text=>{
    const c=window.SillyTavern.getContext();c.chat.push({is_user:true,mes:'测试输入'},{is_user:false,mes:text});c.variables.local.del('bcw_attack');
  },text);
  const chatBefore=await page.evaluate(()=>JSON.stringify(window.SillyTavern.getContext().chat));
  await page.evaluate(() => window.__mcdonalds.open('reply-ai'));
  await page.locator('.pa-sheet details').filter({hasText:'AI 语义审查（可选）'}).locator('summary').click();
  await page.click('[data-r=ai-latest]');
  await page.waitForFunction(()=>document.querySelector('[data-r=semantic-result]')?.textContent.includes('模型标记了疑似内部分析'),null,{timeout:15000});
  assert.match(await page.locator('[data-r=semantic-result]').innerText(),/我需要先检查用户给我的写作要求/);
  assert.equal(await page.evaluate(()=>window.SillyTavern.getContext().variables.local.has('bcw_attack')),false);
  assert.equal(await page.evaluate(()=>JSON.stringify(window.SillyTavern.getContext().chat)),chatBefore);
  const requests=await (await fetch('http://127.0.0.1:8888/__test/requests')).json();
  const request=requests.at(-1);
  assert.equal(request.model,'review-fixture');assert.equal(request.stream,false);
  assert.equal(request.messages.length,2);assert.equal(JSON.parse(request.messages.find(m=>m.role==='user').content).reply_text,text);
  assert(!JSON.stringify(request.messages).includes('变量正文不得送入审查'));
  console.log('✓ 真实酒馆当前连接 → 本地后端 → 协议桩 → 语义结果展示；不执行回复宏、不改聊天、不发送变量值');
  assert.deepEqual(errors,[]);
  console.log('Real SillyTavern integration passed',setup.version);
} catch(error) {
  await page.screenshot({path:'/tmp/bcw-real-st-failure.png',fullPage:true});
  console.error('Open host dialogs:',await page.locator('dialog[open]').allTextContents());
  throw error;
} finally { await browser.close(); }
