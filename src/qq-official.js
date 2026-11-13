import { createHash, randomBytes } from 'node:crypto';
import { QQBot } from '@tencent-connect/qqbot-nodejs';

export function startOfficialQQ(config, engine, createBot = options => new QQBot(options)) {
  const bot = createBot({
    appId: config.appId,
    appSecret: process.env[config.appSecretEnv],
    transport: 'websocket',
    intents: 1 << 25, // QQ groups and C2C share one gateway intent.
    markdownSupport: false
  });
  const controller = new AbortController();
  const seen = new Map();
  const tasks = new Set();
  let connection = 'connecting';
  const newPairingCode = () => randomBytes(8).toString('hex');
  let pairingCode = newPairingCode();
  let pairedOpenId = null;
  let lastError = null;
  function connected() { connection = 'connected'; lastError = null; }
  bot.on('ready', connected);
  bot.on('resumed', connected);
  bot.on('disconnected', ({willReconnect}) => { connection = willReconnect ? 'reconnecting' : 'disconnected'; });
  bot.on('error', () => { lastError = 'QQ gateway error'; });

  function receive(_ctx, message) {
    if (controller.signal.aborted || message.kind !== 'c2c' || message.senderIsBot) return;
    const {senderId, messageId, content} = message;
    if (typeof senderId !== 'string' || !/^[\w-]{1,128}$/.test(senderId)) return;
    if (typeof content === 'string' && /^\/pair(?:\s|$)/.test(content)) {
      if (content.trim() === '/pair ' + pairingCode) {
        pairedOpenId = senderId;
        pairingCode = newPairingCode();
      }
      return;
    }
    if (!config.allowedUsers.includes(senderId)) return;
    if (typeof content !== 'string' || !content.trim() || content.length > 8000 || message.attachments?.length) return;
    if (typeof messageId !== 'string' || !messageId || tasks.size >= 32) return;
    const now = Date.now();
    const key = senderId + ':' + messageId;
    if (seen.get(key) > now) return;
    seen.delete(key);
    seen.set(key, now + 600000);
    if (seen.size > 2000) seen.delete(seen.keys().next().value);

    // OpenIDs are scoped to a QQ app. Keep identities distinct if the app changes.
    const identity = senderId === config.ownerOpenId ? engine.config.ownerId
      : 'qqbot:' + createHash('sha256').update(config.appId + ':' + senderId).digest('hex');
    async function respond() {
      const {reply} = await engine.chat(identity, content);
      if (!controller.signal.aborted) await bot.sendText({scope: 'c2c', targetId: senderId, msgId: messageId}, reply);
    }
    const task = respond().catch(() => { lastError = 'QQ message handling failed'; });
    tasks.add(task);
    return task.finally(() => tasks.delete(task));
  }
  bot.on('message', receive);

  const run = bot.start(controller.signal).catch(() => {
    if (!controller.signal.aborted) {
      connection = 'failed';
      lastError = 'QQ connection failed; check credentials and gateway access';
    }
  });
  return {
    status: () => ({mode: 'official', connection, lastError, pairingCode, pairedOpenId}),
    async close() {
      controller.abort();
      bot.stop();
      await run;
      await Promise.all(tasks);
    }
  };
}
