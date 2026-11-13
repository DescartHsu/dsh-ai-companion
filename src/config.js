import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

export async function loadConfig(path) {
  const c = JSON.parse(await readFile(path, 'utf8'));
  c.dataDir = resolve(c.dataDir.replace(/^~(?=[/\\])/, homedir()));
  if (!Number.isInteger(c.port) || c.port < 0 || c.port > 65535) throw new Error('Invalid port');
  if (!Number.isFinite(c.heartbeatMs) || c.heartbeatMs < 1000) throw new Error('heartbeatMs must be >= 1000');
  if (!c.character?.name || !c.character?.persona || !c.ownerId) throw new Error('Character and ownerId required');
  const u = new URL(c.llm.baseUrl);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(u.hostname))) throw new Error('LLM requires HTTPS or loopback HTTP');
  if (!c.llm.model || !Number.isFinite(c.llm.timeoutMs) || c.llm.timeoutMs < 1 || !Number.isInteger(c.llm.maxTokens) || c.llm.maxTokens < 1) throw new Error('Invalid LLM config');
  c.token = process.env[c.tokenEnv];
  if (!c.token || c.token.length < 24) throw new Error('Set a local API token of at least 24 characters');
  if (c.qq?.enabled && c.qq.mode === 'official') {
    const q = c.qq;
    if (typeof q.appId !== 'string' || !/^\d+$/.test(q.appId) || !process.env[q.appSecretEnv]) {
      throw new Error('Official QQ requires a numeric appId string and the configured AppSecret environment variable');
    }
    if (!Array.isArray(q.allowedUsers) || !q.allowedUsers.every(id => typeof id === 'string' && /^[\w-]{1,128}$/.test(id))) {
      throw new Error('Official QQ allowedUsers must be a list of user openids');
    }
    if (q.ownerOpenId && !q.allowedUsers.includes(q.ownerOpenId)) throw new Error('ownerOpenId must be in allowedUsers');
    if (String(c.ownerId).startsWith('qqbot:')) throw new Error('ownerId must be outside the qqbot: identity namespace');
  } else if (c.qq?.enabled) {
    if (c.qq.mode !== undefined && c.qq.mode !== 'onebot') throw new Error('Unknown QQ mode');
    const q = new URL(c.qq.baseUrl);
    if (!['http:','https:'].includes(q.protocol) || !['localhost','127.0.0.1','[::1]'].includes(q.hostname)) throw new Error('OneBot must use loopback HTTP(S)');
    if (!process.env[c.qq.secretEnv] || !process.env[c.qq.tokenEnv] || !c.qq.allowedUsers?.length) throw new Error('QQ requires webhook secret, access token and allowedUsers');
  }
  return c;
}
