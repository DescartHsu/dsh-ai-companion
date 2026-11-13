import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { WebSocketServer } from 'ws';
import { QQBot } from '@tencent-connect/qqbot-nodejs';
import { startOfficialQQ } from '../src/qq-official.js';
import { startServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';

test('QQ configuration accepts pairing without an allowlist entry and validates channel credentials', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'qq-config-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const example = JSON.parse(await readFile(new URL('../config.example.json', import.meta.url), 'utf8'));
  const path = join(dir, 'config.json');
  const envKey = 'COMPANION_TEST_QQ_CONFIG_' + process.pid;
  process.env[envKey] = 'isolated-test-token-0123456789';
  t.after(() => { delete process.env[envKey]; });
  const config = {...example, tokenEnv: envKey};
  async function check(qq) {
    await writeFile(path, JSON.stringify({...config, qq}));
    return loadConfig(path);
  }
  const official = {...example.qq, enabled: true, appId: '123', appSecretEnv: envKey};
  assert.equal((await check(official)).qq.mode, 'official');
  await assert.rejects(check({...official, appSecretEnv: ''}), /AppSecret/);
  await assert.rejects(check({...official, ownerOpenId: 'unlisted'}), /ownerOpenId/);
  await assert.rejects(check({...official, allowedUsers: ['*']}), /allowedUsers/);
  await assert.rejects(check({...official, mode: 'invalid'}), /Unknown QQ/);
  const legacy = {enabled: true, baseUrl: 'http://localhost:3000', allowedUsers: ['123'], tokenEnv: envKey, secretEnv: envKey};
  assert.deepEqual((await check(legacy)).qq, legacy);
});

async function until(predicate) {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for local gateway');
    await delay(10);
  }
}

test('official SDK connects, replies only to allowed C2C text and resumes after disconnection', async t => {
  const requests = [];
  const replies = [];
  const http = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    requests.push({path: req.url, authorization: req.headers.authorization});
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/app/getAppAccessToken') return res.end(JSON.stringify({access_token: 'local-token', expires_in: 3600}));
    if (req.url === '/gateway') return res.end(JSON.stringify({url: 'ws://127.0.0.1:' + http.address().port}));
    replies.push({path: req.url, body: JSON.parse(raw)});
    res.end(JSON.stringify({id: 'response-id'}));
  });
  const gateway = new WebSocketServer({server: http});
  const opcodes = [];
  let socket;
  gateway.on('connection', client => {
    socket = client;
    client.on('message', raw => {
      const packet = JSON.parse(raw);
      opcodes.push(packet.op);
      if (packet.op === 2) client.send(JSON.stringify({op: 0, t: 'READY', s: 1, d: {session_id: 'local-session', user: {id: 'bot'}}}));
      if (packet.op === 6) client.send(JSON.stringify({op: 0, t: 'RESUMED', s: 10, d: {}}));
      if (packet.op === 1) client.send(JSON.stringify({op: 11}));
    });
    client.send(JSON.stringify({op: 10, d: {heartbeat_interval: 30000}}));
  });
  http.listen(0, '127.0.0.1');
  await once(http, 'listening');
  const base = 'http://127.0.0.1:' + http.address().port;
  const qq = {enabled: true, mode: 'official', appId: '1234', appSecretEnv: 'COMPANION_QQ_TEST_SECRET',
    ownerOpenId: 'owner-openid', allowedUsers: ['owner-openid', 'friend']};
  const turns = [];
  const engine = {config: {ownerId: 'owner'}, async chat(id, text) { turns.push({id, text}); return {reply: '回信'}; }};
  const official = startOfficialQQ(qq, engine, options => new QQBot({...options, appSecret: 'local-secret',
    baseUrl: base, tokenBaseUrl: base, reconnect: {delays: [20]}}));
  const local = await startServer({qq, port: 0, token: 'local-api-token'}, engine, official);
  t.after(async () => {
    await official.close();
    await local.close();
    gateway.close();
    http.closeAllConnections();
    await new Promise(resolve => http.close(resolve));
  });
  const statusUrl = 'http://127.0.0.1:' + local.port + '/qq/status';
  assert.equal((await fetch(statusUrl)).status, 401);
  await until(() => official.status().connection === 'connected');
  let seq = 1;
  function dispatch(user, id, extra = {}, type = 'C2C_MESSAGE_CREATE') {
    socket.send(JSON.stringify({op: 0, t: type, s: ++seq, d: {author: {user_openid: user, member_openid: user},
      id, content: '你好', timestamp: new Date().toISOString(), ...extra}}));
  }
  const pairingCode = official.status().pairingCode;
  dispatch('visitor', 'p', {content: '/pair ' + pairingCode});
  dispatch('outsider', '1', {content: '/pair ' + pairingCode});
  dispatch('owner-openid', '2', {attachments: [{url: 'ignored'}]});
  dispatch('owner-openid', '3', {group_openid: 'group'}, 'GROUP_AT_MESSAGE_CREATE');
  dispatch('owner-openid', '4');
  dispatch('owner-openid', '4');
  await until(() => replies.length === 1);
  assert.deepEqual(turns, [{id: 'owner', text: '你好'}]);
  assert.equal(replies[0].path, '/v2/users/owner-openid/messages');
  assert.equal(replies[0].body.msg_id, '4');
  assert.equal(replies[0].body.content, '回信');
  assert.equal(replies[0].body.msg_type, 0);
  const status = await (await fetch(statusUrl, {headers: {Authorization: 'Bearer local-api-token'}})).json();
  assert.equal(status.pairedOpenId, 'visitor');
  assert.notEqual(status.pairingCode, pairingCode);
  socket.terminate();
  await until(() => opcodes.includes(6) && official.status().connection === 'connected');
  dispatch('owner-openid', '4');
  dispatch('friend', '5');
  await until(() => replies.length === 2);
  assert.equal(turns.length, 2);
  assert.match(turns[1].id, /^qqbot:[a-f0-9]{64}$/);
  assert.equal(replies[1].path, '/v2/users/friend/messages');
  assert.ok(requests.some(req => req.path === '/gateway' && req.authorization === 'QQBot local-token'));
});
