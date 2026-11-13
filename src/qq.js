import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifySignature(raw, signature, secret) {
  const expected = 'sha1=' + createHmac('sha1', secret).update(raw).digest('hex');
  return typeof signature === 'string' && Buffer.byteLength(signature) === expected.length && timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
export class OneBot {
  constructor(config, engine, request = fetch) { this.config = config; this.engine = engine; this.request = request; this.seen = new Map(); }
  async receive(event) {
    const c = this.config;
    if (event.post_type !== 'message' || event.message_type !== 'private' || event.user_id === event.self_id || !c.allowedUsers.map(String).includes(String(event.user_id))) return {ignored:true};
    if (!Number.isSafeInteger(event.user_id) || !Number.isSafeInteger(event.message_id) || !Number.isFinite(event.time) || Math.abs(Date.now()/1000-event.time) > 300) return {ignored:true};
    // Structured text only: do not accidentally interpret image, voice or CQ control codes.
    if (!Array.isArray(event.message) || event.message.some(s => s.type !== 'text')) return {ignored:true};
    const text = event.message.map(s => s.data?.text ?? '').join('');
    if (!text.trim() || text.length > 8000) return {ignored:true};
    const key = `${event.self_id}:${event.user_id}:${event.message_id}`;
    if (this.seen.has(key)) return {duplicate:true};
    this.seen.set(key, Date.now());
    for (const [k, t] of this.seen) if (Date.now()-t > 600000) this.seen.delete(k);
    if (this.seen.size > 2000) this.seen.delete(this.seen.keys().next().value);
    const id = String(event.user_id) === String(c.ownerQQ) ? this.engine.config.ownerId : `qq:${event.user_id}`;
    const {reply} = await this.engine.chat(id, text);
    const r = await this.request(`${c.baseUrl.replace(/\/$/,'')}/send_private_msg`, {
      method:'POST', headers:{Authorization:`Bearer ${process.env[c.tokenEnv]}`, 'Content-Type':'application/json'},
      body:JSON.stringify({user_id:event.user_id, message:[{type:'text',data:{text:reply}}]}),
      signal:AbortSignal.any([this.engine.abort.signal, AbortSignal.timeout(15000)])
    });
    if (!r.ok) throw new Error(`OneBot HTTP ${r.status}`);
    const result = await r.json(); if (result.status !== 'ok' || result.retcode !== 0) throw new Error('OneBot send rejected');
    return {sent:true};
  }
}
