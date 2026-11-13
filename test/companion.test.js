import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { Companion } from '../src/engine.js';
import { OpenAICompatible } from '../src/llm.js';
import { OneBot, verifySignature } from '../src/qq.js';
import { startServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { apply } from '../src/plugin.js';

async function fixture(t, llm = {complete:async ()=>'你好'}) {
  const dir = await mkdtemp(join(tmpdir(),'companion-'));
  const config = {dataDir:dir,port:0,token:'a'.repeat(32),tokenEnv:'COMPANION_TEST_TOKEN',heartbeatMs:60000,ownerId:'owner',character:{name:'澜',persona:'友善'},llm:{baseUrl:'http://127.0.0.1:1/v1',model:'mock',apiKeyEnv:'COMPANION_TEST_KEY',timeoutMs:100,maxTokens:20},qq:{enabled:false}};
  const engine = await new Companion(config,llm).start();
  t.after(async()=>{await engine.stop();await rm(dir,{recursive:true,force:true});});
  return {config,engine};
}
test('memory survives restart; identities stay isolated; deletion persists', async t=>{
  const {config,engine} = await fixture(t); const m = await engine.remember('owner','喜欢茶');
  await engine.chat('owner','谢谢'); assert.equal(engine.user('qq:2').memories.length,0);
  await engine.stop(); const next = await new Companion(config,{complete:async()=> 'ok'}).start();
  try { assert.equal(next.user('owner').memories[0].text,'喜欢茶'); assert.equal(next.user('owner').history.length,2); await next.forget('owner',m.id); await next.clear('owner'); assert.equal(JSON.parse(await readFile(next.path)).users.owner,undefined); } finally {await next.stop();}
});
test('failed model turn does not append history; serial turns see prior response',async t=>{
  let n=0; const lengths=[];
  const {engine}=await fixture(t,{complete:async messages=>{lengths.push(messages.length); if (++n===1) throw new Error('offline');return 'ok';}});
  await assert.rejects(engine.chat('owner','first')); assert.equal(engine.user('owner').history.length,0);
  await Promise.all([engine.chat('owner','second'),engine.chat('owner','third')]); assert.deepEqual(lengths,[2,2,4]);
});
test('exclusive data lock and malformed state fail safely',async t=>{
  const {config,engine}=await fixture(t); await assert.rejects(new Companion(config,{}).start(),{code:'EEXIST'});
  await engine.stop();await writeFile(join(config.dataDir,'state.json'),'broken'); await assert.rejects(new Companion(config,{}).start());
  assert.equal(await readFile(join(config.dataDir,'state.json'),'utf8'),'broken');
});
test('heartbeat recovers and clamps after idle time; input validation',async t=>{
  const {engine}=await fixture(t); engine.data.state.mood=-1; engine.data.state.energy=0;
  await engine.tick(Date.now()+86400000); assert.ok(engine.snapshot().mood > -.01); assert.equal(engine.snapshot().energy,100);
  await assert.rejects(engine.chat('__proto__','hi')); await assert.rejects(engine.chat('owner','')); await assert.rejects(engine.remember('owner','x'.repeat(1001)));
});
test('OpenAI HTTP request shape, status handling, response validation',async()=>{
  process.env.COMPANION_TEST_KEY='fake'; const abort=new AbortController();
  const c={baseUrl:'http://localhost/v1/',apiKeyEnv:'COMPANION_TEST_KEY',model:'mock',timeoutMs:100,maxTokens:20};
  const llm=new OpenAICompatible(c,async (url,opts)=>{assert.equal(url,'http://localhost/v1/chat/completions'); assert.equal(opts.headers.Authorization,'Bearer fake');assert.equal(JSON.parse(opts.body).stream,false);return Response.json({choices:[{message:{content:'hello'}}]});});
  assert.equal(await llm.complete([],abort.signal),'hello');
  await assert.rejects(new OpenAICompatible(c,async()=>new Response('secret',{status:401})).complete([],abort.signal),/LLM HTTP 401/);
  await assert.rejects(new OpenAICompatible(c,async()=>Response.json({})).complete([],abort.signal),/Invalid LLM/);
});
test('real HTTP model transport and timeout cancellation',async t=>{
  process.env.COMPANION_TEST_KEY='fake';
  const server=createServer((req,res)=>{
    if(req.url==='/slow/chat/completions') return;
    assert.equal(req.url,'/v1/chat/completions');
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:'wire reply'}}]}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const base=`http://127.0.0.1:${server.address().port}`;
  const config={baseUrl:base+'/v1',model:'mock',apiKeyEnv:'COMPANION_TEST_KEY',maxTokens:20,timeoutMs:1000};
  assert.equal(await new OpenAICompatible(config).complete([],new AbortController().signal),'wire reply');
  await assert.rejects(new OpenAICompatible({...config,baseUrl:base+'/slow',timeoutMs:20}).complete([],new AbortController().signal),{name:'TimeoutError'});
});
test('OneBot signature, allowlist, shared owner identity, literal text and dedupe',async t=>{
  const {engine}=await fixture(t); const raw=Buffer.from('{}'); const sig='sha1='+createHmac('sha1','secret').update(raw).digest('hex');
  assert.equal(verifySignature(raw,sig,'secret'),true); assert.equal(verifySignature(raw,'bad','secret'),false);
  let sends=0;const q=new OneBot({baseUrl:'http://localhost:3000',allowedUsers:['123'],ownerQQ:'123',tokenEnv:'QQ_TEST'},engine,async (_url,opts)=>{sends++; assert.equal(JSON.parse(opts.body).message[0].type,'text');return Response.json({status:'ok',retcode:0});});
  const event={post_type:'message',message_type:'private',self_id:999,user_id:123,message_id:1,time:Date.now()/1000,message:[{type:'text',data:{text:'hello'}}]};
  assert.deepEqual(await q.receive({...event,user_id:456}),{ignored:true});
  assert.deepEqual(await q.receive({...event,message_type:'group'}),{ignored:true});
  assert.deepEqual(await q.receive(event),{sent:true});assert.deepEqual(await q.receive(event),{duplicate:true}); assert.equal(sends,1);assert.equal(engine.user('owner').history.length,2);
});
test('authenticated local API, no browser origin, memory CRUD and QQ HMAC',async t=>{
  const {config,engine}=await fixture(t);process.env.COMPANION_QQ_SECRET='secret';config.qq={enabled:true,allowedUsers:['123'],secretEnv:'COMPANION_QQ_SECRET'};
  const server=await startServer(config,engine);t.after(()=>server.close());const url=`http://127.0.0.1:${server.port}`;
  const headers={Authorization:`Bearer ${config.token}`,'Content-Type':'application/json'};
  assert.equal((await fetch(url+'/state')).status,401);
  assert.equal((await fetch(url+'/state',{headers:{...headers,Origin:'http://evil'}})).status,403);
  assert.equal((await fetch(url+'/state',{headers})).status,200);
  assert.equal((await fetch(url+'/onebot',{method:'POST',body:'{}'})).status,401);
  const signature='sha1='+createHmac('sha1','secret').update('{}').digest('hex');
  assert.equal((await fetch(url+'/onebot',{method:'POST',headers:{'X-Signature':signature},body:'{}'})).status,200);
  const m=await (await fetch(url+'/memories',{method:'POST',headers,body:JSON.stringify({text:'tea'})})).json();assert.ok(m.id);
  assert.equal((await (await fetch(url+'/memories',{headers})).json()).length,1);
  await fetch(url+'/forget',{method:'POST',headers,body:JSON.stringify({id:m.id})});
  assert.equal((await (await fetch(url+'/memories',{headers})).json()).length,0);
  assert.equal((await fetch(url+'/chat',{method:'POST',headers,body:JSON.stringify({text:'hi'})})).status,200);
});
test('config validation and plugin tools/disposal on a host-shaped context',async t=>{
  const {config,engine}=await fixture(t);await engine.stop();process.env.COMPANION_TEST_TOKEN=config.token;
  const path=join(config.dataDir,'config.json');await writeFile(path,JSON.stringify(config));await loadConfig(path);
  const tools=[];
  const dispose=await apply({tools:{register:tool=>tools.push(tool)}},{configPath:path});
  assert.deepEqual(tools.map(x=>x.name),['companion_chat','companion_state']);assert.ok(JSON.parse(await tools[1].execute()).bpm);
  await dispose();await assert.rejects(readFile(join(config.dataDir,'engine.lock')),{code:'ENOENT'});
  await writeFile(path,JSON.stringify({...config,llm:{...config.llm,baseUrl:'http://remote.invalid'}}));await assert.rejects(loadConfig(path),/HTTPS/);
});
