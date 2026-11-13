import { loadConfig } from './config.js';
import { Companion } from './engine.js';
import { OpenAICompatible } from './llm.js';
import { startServer } from './server.js';
import { startOfficialQQ } from './qq-official.js';

export async function startRuntime(path) {
  const config = await loadConfig(path);
  const engine = await new Companion(config, new OpenAICompatible(config.llm)).start();
  let official;
  try {
    if (config.qq?.enabled && config.qq.mode === 'official') official = startOfficialQQ(config.qq, engine);
    const server = await startServer(config, engine, official);
    return {engine, server, async close() { await Promise.all([official?.close(), engine.stop(), server.close()]); }};
  } catch (e) { await Promise.all([official?.close(), engine.stop()]); throw e; }
}
