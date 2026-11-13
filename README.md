# DSH AI Companion V0.1

原生 Cordis 插件 + 共用角色引擎。原创实现，仅参考 Constellation 的本地持久记忆、连续角色状态方向，没有复制其代码、提示词或素材。角色心跳与情绪都是数值模拟。

## 验证状态（2026-11-13）

- 本机 `dsh --version` 实际为 **0.2.2-rc.1**，不是目标 0.2.1。应用内置 `@deepseek-ai/cordis` 为 4.1.0。
- 使用应用实际内置 Cordis、ToolsService 做隔离宿主测试：加载、两个工具注册、卸载释放文件锁通过。systemPrompt 依赖使用最小桩，不启动正在运行的桌面。
- Node 自动化测试覆盖模型协议、HTTP 服务、QQ 鉴权及去重、用户隔离、持久化恢复、并发和生命周期。
- **尚未验证**：干净的 DSH 0.2.1 安装、运行中桌面插件管理界面、真实模型网络请求、真实 QQ Bot 收发。未修改或重启现有 DSH 桌面。
- 不接管 DSH 默认对话，不假设内部模型/界面 API。DSH 通过 `companion_chat`、`companion_state` 调用角色。

## 已实现

1. `package.json` 的 `dsh.bundle.patch`、`cordis.patch.yml`、`apply` 和返回式生命周期清理。
2. OpenAI 兼容 `/chat/completions`：自定义 URL、模型、环境变量密钥、超时、响应校验、停止时取消请求。
3. 人格、边界、共享角色状态（心情、精力、信任、模拟 bpm）、定时恢复。状态规则在 `src/engine.js`，是透明启发式，不是情感识别模型。
4. 每个身份独立保存最近 40 条对话、最多 500 条显式记忆；提示中使用最近 20 条对话和最近 20 条记忆。明确添加/删除记忆，不自动提取长期事实。原子文件替换、单进程数据锁。
5. OneBot 11 HTTP 私聊适配：HMAC-SHA1 上报验证、QQ 白名单、结构化纯文本、HTTP 发回消息、时间检查、进程内消息去重。
6. 仅监听 127.0.0.1 的带令牌管理 API；预留 Live2D、主动聊天、语音、生图和视频的类型契约。

## 先独立运行

需要 Node.js >=22，无第三方运行依赖。打开本目录的 PowerShell：

```powershell
Copy-Item config.example.json config.local.json
$env:COMPANION_API_TOKEN = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
$env:COMPANION_LLM_KEY = '你的模型服务密钥'
# 修改 config.local.json：llm.baseUrl、llm.model；baseUrl 通常以 /v1 结尾。
npm test
npm start -- "$PWD\config.local.json"
```

从源码运行时使用 `npm start`。在已安装此 npm 包的项目中，可以运行 `npm exec -- dsh-ai-companion "配置文件的绝对路径"`，或用 `npm exec -- dsh-ai-companion --help` 查看用法。示例配置随包提供，位于 `node_modules/dsh-ai-companion/config.example.json`。

这个 PowerShell 环境只对它启动的进程生效；不要把真实密钥写进项目或提交记录。关闭进程后临时令牌会丢失，需要重新配置客户端。

另开 PowerShell，设置同一 API 令牌：

```powershell
$headers = @{Authorization="Bearer $env:COMPANION_API_TOKEN"}
Invoke-RestMethod http://127.0.0.1:17861/state -Headers $headers
$body = @{text='你好，澜'} | ConvertTo-Json
Invoke-RestMethod http://127.0.0.1:17861/chat -Method Post -Headers $headers -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body))
```

## 安装为 DSH 原生插件

先完成配置，然后停止独立运行实例，同一 dataDir 不可启动两份。以下是本机 CLI 已核实支持的包安装命令；完整安装流程仍需在目标 0.2.1 桌面验证：

```powershell
npm pack
dsh plugin --profile desktop add "./dsh-ai-companion-0.1.0.tgz"
```

1. 检查 `%USERPROFILE%\.dsh\profiles\desktop\package.json`，在 `dsh.profile.bundles` 数组添加 `"dsh-ai-companion"`（如已有则不重复）。本机其他原生插件也使用此机制。
2. 将 `COMPANION_CONFIG` 设为配置文件的绝对路径，并将 `COMPANION_API_TOKEN`、`COMPANION_LLM_KEY` 设置到**启动 DSH 的进程环境**。或者在本包 `cordis.patch.yml` 中把 `configPath` 改成配置文件绝对路径后重新打包；密钥仍使用环境变量。
3. 重新启动 DSH，使新环境和插件生效。插件依赖真实的 `tools` 服务。如果启动失败会明确报错，不伪造工具或悄悄退化。
4. 在 DSH 中请求：“调用 companion_state 查看澜的状态”，或“调用 companion_chat，把‘你好’交给澜，并展示她的原话”。是否调用仍由宿主模型决定。
5. 卸载：从 bundles 数组去掉本插件，再运行 `dsh plugin --profile desktop remove dsh-ai-companion` 并重启。数据独立保存，不随包卸载删除。

默认数据位置 `%USERPROFILE%\.dsh\ai-companion\state.json`。先备份再修改；不要并发手工编辑。异常退出可能留下 `engine.lock`，先确认没有实例使用该目录，再手工删除锁。损坏 JSON 会拒绝启动，不自动覆盖。

## QQ 接入（OneBot 11，不是腾讯官方机器人 SDK）

需要你已有的 OneBot 11 实现提供 HTTP API 和 HTTP 事件上报。V0.1 不负责 QQ 登录，不含协议客户端，不支持 WebSocket、群聊、图片或语音。

1. 配置 `qq.enabled=true`、`baseUrl`（仅允许本机 HTTP(S)）、`allowedUsers`（QQ 号字符串数组）。
2. 如需 DSH 与自己 QQ 共享记忆，设置 `qq.ownerQQ` 为自己的 QQ 号。其他白名单账号使用独立的 `qq:<QQ号>` 身份。
3. 在启动环境设置 `ONEBOT_ACCESS_TOKEN` 与 `ONEBOT_WEBHOOK_SECRET`，与 Bot 配置一致。Bot HTTP 上报地址为 `http://127.0.0.1:17861/onebot`，启用 secret 签名。
4. Bot 必须以消息段数组上报纯文本消息。没有有效签名或不在白名单的私聊不会触发模型调用。
5. 只在收到合法私聊后调用 `send_private_msg`。默认无主动发送、重试或广播。

去重只保存在进程内 10 分钟；重启后可能重复处理。发送失败不会自动重发，避免重复消息；模型回复可能已经保存但未送达 QQ。此版本不保证跨进程 exactly-once。

## 本机管理 API

除 `/onebot` 使用事件签名外，所有接口要求 `Authorization: Bearer <COMPANION_API_TOKEN>`，拒绝浏览器 Origin 请求。接口只操作配置的 ownerId，不能通过传入身份读取其他用户记忆。

| 方法/路径 | 请求体 / 结果 |
|---|---|
| GET /state | 模拟状态 |
| POST /chat | `{ "text": "你好" }` → `{reply,state}` |
| GET /memories | 显式记忆列表 |
| POST /memories | `{ "text": "我喜欢茶" }` → 带 id 的记忆 |
| POST /forget | `{ "id": "记忆ID" }` |
| POST /clear | `{}`，清除主人对话及记忆；共享角色数值不重置 |

历史对话仍会影响回答：删除单条记忆不会擦除包含同一内容的历史，要彻底清除该身份信息请使用 `/clear`。存储为本机明文 JSON；不要让不可信用户访问数据目录。聊天内容与选入的记忆会发给配置的模型服务。单角色所有聊天串行执行，等待队列最多 32 项。

## 测试与下一步

```powershell
npm test
npm run check
npm run test:package
```

在源码仓库运行以上命令。`test:package` 会创建真实的 npm 压缩包，在临时项目中离线安装，检查命令行入口、插件注册和卸载。GitHub Actions 在 Windows 和 Linux 上使用 Node.js 22、24 执行这些检查。发布前可用 `npm pack --dry-run` 检查文件清单。

真实宿主隔离测试（本机路径，其他安装自行调整）：

```powershell
$env:ELECTRON_RUN_AS_NODE='1'
$env:DSH_SDK_ROOT='I:\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai'
$env:COMPANION_SMOKE_OUTPUT="$PWD\host-smoke.json"
& 'I:\DeepSeek Harness\DeepSeek Harness.exe' "$PWD\test\host-smoke.cjs"
Get-Content host-smoke.json
Remove-Item Env:ELECTRON_RUN_AS_NODE
```

`src/extensions.d.ts` 只定义扩展契约，不声称这些功能已可用。下一阶段可实现：图谱/语义记忆检索与遗忘策略、主动消息授权和静默时段、Live2D 视图、语音和媒体任务队列。V0.1 没有控制台页面、模型记忆抽取、图谱扩散或媒体生成功能。

接口证据、边界和原始 0.1.0 测试报告见源码仓库中的 `docs/verification.md`。
