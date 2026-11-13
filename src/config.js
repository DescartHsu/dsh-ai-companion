import { access, link, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

// Publish the complete file atomically. Concurrent starts must keep the first
// token, and subsequent starts must preserve edits to the configuration.
async function createIfMissing(path, content) {
  try { await access(path); return; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temporary = path + '.' + randomUUID() + '.tmp';
  await writeFile(temporary, content, {flag: 'wx', mode: 0o600});
  try {
    await link(temporary, path);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  } finally { await unlink(temporary); }
}

export async function desktopConfigPath() {
  const dir = join(homedir(), '.dsh', 'ai-companion');
  const path = join(dir, 'config.json');
  await mkdir(dir, {recursive: true, mode: 0o700});
  try { await access(path); return path; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const config = JSON.parse(await readFile(new URL('../config.example.json', import.meta.url), 'utf8'));
  config.tokenFile = 'api.token';
  await createIfMissing(join(dir, config.tokenFile), randomBytes(32).toString('hex') + '\n');
  await createIfMissing(path, JSON.stringify(config, null, 2) + '\n');
  return path;
}

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
  if (!c.token && c.tokenFile) c.token = (await readFile(resolve(dirname(path), c.tokenFile), 'utf8')).trim();
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
