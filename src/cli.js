#!/usr/bin/env node
import { startRuntime } from './runtime.js';
const usage = 'Usage: dsh-ai-companion <config.json>\n       dsh-ai-companion (with COMPANION_CONFIG set)';
const path = process.argv[2] || process.env.COMPANION_CONFIG;
if (['-h', '--help'].includes(process.argv[2])) { console.log(usage); }
else if (!path) { console.error(usage); process.exitCode = 1; }
else {
  try {
    const runtime = await startRuntime(path);
    console.log(`DSH AI Companion: http://127.0.0.1:${runtime.server.port}`);
    let closing = false;
    const stop = async () => { if (closing) return; closing = true; await runtime.close(); };
    process.once('SIGINT',stop); process.once('SIGTERM',stop);
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
