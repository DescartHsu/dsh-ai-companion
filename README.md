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
5. QQ 支持腾讯官方机器人 WebSocket 和已有 OneBot 11 HTTP 服务，两种通道都按白名单处理私聊文字。
6. 仅监听 127.0.0.1 的带令牌管理 API；预留 Live2D、主动聊天、语音、生图和视频的类型契约。

## 先独立运行

需要 Node.js >=22。在源码目录的 PowerShell 中安装依赖并准备配置：

```powershell
npm ci
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

从 npm 安装或升级：

```powershell
dsh plugin --profile desktop add dsh-ai-companion@0.1.2
```

从源码或 GitHub Release 安装时，可使用同版本的压缩包。源码目录中执行下方命令，已有压缩包时直接执行第二行。同一 dataDir 同时只能启动一个实例，切换到桌面前请先停止独立运行实例。完整安装流程仍需在目标 0.2.1 桌面验证。

```powershell
npm pack
dsh plugin --profile desktop add "./dsh-ai-companion-0.1.2.tgz"
```

1. 检查 `%USERPROFILE%\.dsh\profiles\desktop\package.json`，在 `dsh.profile.bundles` 数组添加 `"dsh-ai-companion"`（如已有则不重复）。本机其他原生插件也使用此机制。
2. 首次启用会在 `~/.dsh/ai-companion/` 创建 `config.json` 和随机管理令牌 `api.token`，可直接使用 `companion_state`。如需聊天，在该配置中填写 `llm.baseUrl`、`llm.model`，并为启动 DSH 的进程设置 `COMPANION_LLM_KEY`。如需调用本机管理 API，可在 PowerShell 中运行 `$env:COMPANION_API_TOKEN = (Get-Content -Raw "$HOME/.dsh/ai-companion/api.token").Trim()`。自定义配置仍按 `configPath`、`COMPANION_CONFIG` 的顺序优先使用。
3. 重新启动 DSH，使新环境和插件生效。插件依赖真实的 `tools` 服务。如果启动失败会明确报错，不伪造工具或悄悄退化。
4. 在 DSH 中请求：“调用 companion_state 查看澜的状态”，或“调用 companion_chat，把‘你好’交给澜，并展示她的原话”。是否调用仍由宿主模型决定。
5. 卸载：从 bundles 数组去掉本插件，再运行 `dsh plugin --profile desktop remove dsh-ai-companion` 并重启。数据独立保存，不随包卸载删除。

默认数据位置 `%USERPROFILE%\.dsh\ai-companion\state.json`。先备份再修改；不要并发手工编辑。异常退出可能留下 `engine.lock`，先确认没有实例使用该目录，再手工删除锁。损坏 JSON 会拒绝启动，不自动覆盖。

## QQ 官方机器人私聊

1. 在 QQ 机器人开放平台创建支持私聊的机器人，取得 AppID 和 AppSecret。使用沙箱时，将测试账号加入平台允许的测试范围。
2. 在 `config.local.json` 将 `qq.enabled` 设为 `true`、`qq.mode` 设为 `"official"`，把 AppID 作为字符串填入 `qq.appId`。在启动 Companion 或 DSH 的环境中设置 `QQBOT_APP_SECRET`。首次绑定可将 `allowedUsers` 留作空数组。
3. 启动后，在已设置同一管理令牌的 PowerShell 中执行下方命令。`connection` 显示 `connected` 时，用自己的手机 QQ 私聊该机器人，发送输出中的完整 `/pair` 命令。

```powershell
$headers = @{Authorization="Bearer $env:COMPANION_API_TOKEN"}
$status = Invoke-RestMethod http://127.0.0.1:17861/qq/status -Headers $headers
$status.connection
"/pair $($status.pairingCode)"
```

4. 再次查询 `/qq/status`，将 `pairedOpenId` 填入 `qq.allowedUsers` 数组。需要与桌面共享主人记忆时，将同一个值填入 `qq.ownerOpenId`。重启 Companion 后，此账号即可与角色对话。每位其他用户可分别配对，使用各自独立的记忆。配对码每次成功使用后都会更新，配对只确认 OpenID，授权由本地白名单控制。
5. 私聊文字触发模型并通过原消息 ID 回复。SDK 管理令牌刷新、心跳和断线重连；状态可查看 `connecting`、`connected`、`reconnecting` 或错误信息。首次凭据获取失败或网关终止连接时，检查配置和平台权限后重启。官方通道只需出站网络连接。

实现参考了 dsh-im 对腾讯 SDK 的使用方式。[dsh-im 的 QQ 通道](https://github.com/xmanrui/dsh-im/blob/fc2ceab217309f8973afa03c58cdd8ff3e900130/src/channels/qq/qq-runtime.mjs) · [腾讯 SDK](https://github.com/tencent-connect/qqbot-nodejs)

## 已有 OneBot 11 服务

已有配置省略 `qq.mode` 时继续使用 OneBot。新配置可将整个 `qq` 对象替换为以下内容，再填入自己的白名单。

```json
{"enabled": true, "mode": "onebot", "baseUrl": "http://127.0.0.1:3000", "tokenEnv": "ONEBOT_ACCESS_TOKEN", "secretEnv": "ONEBOT_WEBHOOK_SECRET", "allowedUsers": ["你的QQ号"], "ownerQQ": ""}
```

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
| GET /qq/status | QQ 通道模式，官方模式还返回网关连接状态和本机配对信息 |
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

在源码仓库运行以上命令。QQ 官方通道测试使用真实 SDK 与本机模拟网关，覆盖私聊回复、白名单和断线恢复。`test:package` 会创建真实的 npm 压缩包，在临时项目中安装并解析依赖，检查命令行入口、插件注册和卸载。GitHub Actions 在 Windows 和 Linux 上使用 Node.js 22、24 执行这些检查。发布前可用 `npm pack --dry-run` 检查文件清单。

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
