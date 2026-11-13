// Explicit opt-in: uses installed Electron/ASAR SDK, not the running desktop.
// Run with ELECTRON_RUN_AS_NODE=1 and DSH_SDK_ROOT set, see README.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
async function main() {
  const root = process.env.DSH_SDK_ROOT;
  if (!root) { console.log('Host smoke skipped: DSH_SDK_ROOT not set'); return; }
  const {Context} = require(path.join(root,'cordis'));
  const {ToolsService} = require(path.join(root,'dsh-tools'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'companion-host-'));
  const configPath = path.join(dir,'config.json');
  const config = JSON.parse(fs.readFileSync(path.join(__dirname,'../config.example.json')));
  config.dataDir = dir; config.port = 0;
  process.env.COMPANION_API_TOKEN = 'host-smoke-only-01234567890123456789';
  fs.writeFileSync(configPath,JSON.stringify(config));
  const ctx = new Context();
  try {
    // Minimal system-prompt dependency; no live desktop or model session.
    ctx.provide('systemPrompt',{tools:()=>()=>{}});
    await ctx.plugin(ToolsService).await();
    const plugin = require('../src/plugin.js');
    const fiber = ctx.plugin(plugin,{configPath});
    await fiber.await();
    assert.equal([...ctx.tools.definitions()].length,2);
    assert.ok(fs.existsSync(path.join(dir,'engine.lock')));
    fiber.dispose();
    await fiber.await();
    assert.equal(fs.existsSync(path.join(dir,'engine.lock')),false);
    return {ok:true, sdk:root, checks:['Cordis activation','real ToolsService registration','dispose releases lock']};
  } finally { ctx.fiber.dispose(); await ctx.fiber.await(); await fs.promises.rm(dir,{recursive:true,force:true,maxRetries:3}).catch(()=>{}); }
}
main().then(result=>{
  if (process.env.COMPANION_SMOKE_OUTPUT) fs.writeFileSync(process.env.COMPANION_SMOKE_OUTPUT,JSON.stringify(result ?? {skipped:true},null,2));
}).catch(error=>{
  const result={ok:false,error:error.stack};
  if (process.env.COMPANION_SMOKE_OUTPUT) fs.writeFileSync(process.env.COMPANION_SMOKE_OUTPUT,JSON.stringify(result,null,2));
  else console.error(error);
  process.exitCode=1;
});
