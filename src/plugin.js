import { startRuntime } from './runtime.js';
import { desktopConfigPath } from './config.js';

export const name = 'dsh-ai-companion';
export const inject = ['tools'];
// No invented UI/model services: native lifecycle + loopback companion gateway.
export async function apply(ctx, config = {}) {
  const path = config.configPath || process.env.COMPANION_CONFIG || await desktopConfigPath();
  const runtime = await startRuntime(path);
  {
    try {
      ctx.tools.register({
        name:'companion_chat', description:'与 AI 伴侣聊天。仅在用户要求时调用；返回角色原话。',
        parameters:{type:'object',properties:{text:{type:'string',minLength:1,maxLength:8000}},required:['text'],additionalProperties:false},
        output:{schema:{type:'string'},render:(_args,value)=>[{type:'text',text:value}]},
        execute:async ({text}) => {
          const {llm, ownerId} = runtime.engine.config;
          if (llm.model === 'YOUR_MODEL' || !process.env[llm.apiKeyEnv]) {
            throw new Error(`请先在 ${path} 设置 llm.baseUrl、llm.model，并为启动 DSH 的进程设置 ${llm.apiKeyEnv}，再重启 DSH。`);
          }
          return (await runtime.engine.chat(ownerId,text)).reply;
        }
      });
      ctx.tools.register({
        name:'companion_state', description:'查看 AI 角色的模拟状态（不是生理数据）。',
        parameters:{type:'object',properties:{},additionalProperties:false},
        output:{schema:{type:'string'},render:(_args,value)=>[{type:'text',text:value}]},
        execute:async () => JSON.stringify(runtime.engine.snapshot())
      });
      ctx.logger?.info?.(`DSH AI Companion listening on 127.0.0.1:${runtime.server.port}`);
    } catch (e) { await runtime.close(); throw e; }
  }
  // Cordis 4 collects the function returned by async apply as its disposer.
  return () => runtime.close();
}
export default apply;
