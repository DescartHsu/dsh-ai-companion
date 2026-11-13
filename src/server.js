import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { OneBot, verifySignature } from './qq.js';

async function body(req) {
  const chunks = []; let n = 0;
  for await (const chunk of req) { n += chunk.length; if (n > 65536) { const e = new Error('Body too large'); e.status = 413; throw e; } chunks.push(chunk); }
  return Buffer.concat(chunks);
}
function same(a, b) { return typeof a === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b)); }
export async function startServer(config, engine, official) {
  const qq = config.qq?.enabled && config.qq.mode !== 'official' ? new OneBot(config.qq, engine) : null;
  let active = 0;
  const server = createServer(async (req, res) => {
    const send = (code, value) => { res.writeHead(code, {'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store'}); res.end(JSON.stringify(value)); };
    if (active >= 32) return send(429, {error:'Busy'});
    active++;
    try {
      const route = req.url;
      // No CORS and no browser-origin requests, including localhost websites.
      if (req.headers.origin) return send(403, {error:'Browser origin forbidden'});
      if (route === '/onebot' && req.method === 'POST' && qq) {
        const raw = await body(req);
        if (!verifySignature(raw, req.headers['x-signature'], process.env[config.qq.secretEnv])) return send(401,{error:'Invalid signature'});
        return send(200, await qq.receive(JSON.parse(raw)));
      }
      if (!same(req.headers.authorization, `Bearer ${config.token}`)) return send(401,{error:'Unauthorized'});
      const id = config.ownerId;
      if (route === '/qq/status' && req.method === 'GET') {
        return send(200, official?.status() ?? {mode: qq ? 'onebot' : 'disabled'});
      }
      if (route === '/state' && req.method === 'GET') return send(200, engine.snapshot());
      if (route === '/memories' && req.method === 'GET') return send(200, await engine.run(() => structuredClone(engine.user(id).memories)));
      if (req.method !== 'POST') return send(404,{error:'Not found'});
      const input = JSON.parse(await body(req));
      if (route === '/chat') return send(200, await engine.chat(id,input.text));
      if (route === '/memories') return send(200, await engine.remember(id,input.text));
      if (route === '/forget') { await engine.forget(id,input.id); return send(200,{ok:true}); }
      if (route === '/clear') { await engine.clear(id); return send(200,{ok:true}); }
      send(404,{error:'Not found'});
    } catch (e) {
      // Never forward provider response bodies, secrets or transcripts into logs/errors.
      engine.emit('fault', 'Request failed');
      send(e.status ?? (e instanceof SyntaxError ? 400 : 502), {error:'Request failed; check configuration or input'});
    } finally { active--; }
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  await new Promise((resolve,reject) => { server.once('error',reject); server.listen(config.port,'127.0.0.1',resolve); });
  return {port:server.address().port, async close() { server.closeAllConnections(); await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve())); }};
}
