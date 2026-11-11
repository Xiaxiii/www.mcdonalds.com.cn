// 真实酒馆端到端测试使用的本地协议桩；不是语言模型，不用于评估语义准确率。
const http = require('node:http');
const requests = [];
const server = http.createServer(async (req, res) => {
  const send = (status, value) => { res.writeHead(status, { 'Content-Type':'application/json' }); res.end(JSON.stringify(value)); };
  if (req.url === '/v1/models') return send(200, { data:[{ id:'review-fixture', object:'model' }] });
  if (req.url === '/__test/requests') return send(200, requests);
  if (req.url !== '/v1/chat/completions') return send(404, { error:'not found' });
  let raw=''; for await (const chunk of req) raw+=chunk;
  let body; try { body=JSON.parse(raw); } catch { return send(400,{error:'invalid JSON'}); }
  if(body.model!=='review-fixture')return send(400,{error:{message:'model is required'}});
  requests.push({ model:body.model, messages:body.messages, stream:body.stream });
  let source=''; try { source=JSON.parse(body.messages.find(m=>m.role==='user').content).reply_text; } catch {}
  const excerpt='我需要先检查用户给我的写作要求。';
  const report=source.includes(excerpt) ? {verdict:'suspected',confidence:.85,findings:[{excerpt,reason:'在对写作任务进行自我指令。'}]} : {verdict:'ok',confidence:.8,findings:[]};
  send(200,{id:'fixture',object:'chat.completion',choices:[{index:0,message:{role:'assistant',content:JSON.stringify(report)},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}});
});
server.listen(Number(process.env.PA_REVIEW_FIXTURE_PORT || 8888),'127.0.0.1',()=>console.log('Review protocol fixture ready'));
