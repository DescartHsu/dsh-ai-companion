import { loadConfig } from './config.js';
import { Companion } from './engine.js';
import { OpenAICompatible } from './llm.js';
import { startServer } from './server.js';

export async function startRuntime(path) {
  const config = await loadConfig(path);
  const engine = await new Companion(config, new OpenAICompatible(config.llm)).start();
  try {
    const server = await startServer(config, engine);
    return {engine, server, async close() { await engine.stop(); await server.close(); }};
  } catch (e) { await engine.stop(); throw e; }
}
