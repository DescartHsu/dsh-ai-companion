# 接口与验证记录

日期：2026-11-13。目标 DSH 0.2.1；本机 CLI 实际返回 0.2.2-rc.1，未把它等同于 0.2.1。

## 本机证据

- `I:\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd` 指向应用内的 `@deepseek-ai/dsh-desktop-host/lib/cli.js`。
- `dsh plugin --help` 明确支持 `--profile <name>`，余下参数透传 profile 的 pnpm。
- `%USERPROFILE%\.dsh\profiles\desktop\package.json` 中的 `dsh.profile.bundles` 包含现有插件。
- `%USERPROFILE%\.dsh\plugins\dsh-vdesktop\package.json`、`cordis.patch.yml` 展示 `dsh.bundle.patch` 和 `insert` 配置格式。
- 应用 ASAR 下 `dsh/node_modules/@deepseek-ai/cordis/package.json` 版本 4.1.0。
- 该包 `lib/index.js` 的 `Fiber._execute` / `safeCollect` 收集 apply 返回的函数，拒绝非空的其他普通对象。已据此实现并实测清理；不能仅因第三方插件使用 `ctx.on('dispose')` 就认定它是有效卸载钩子。
- ASAR 中 `@deepseek-ai/dsh-tools/lib/index.js`：`ToolsService.register(definition)` 接受 JSON Schema 的 parameters、output.schema、output.render 和 execute。工具注册受 Cordis effect 生命周期管理。
- ASAR 中 `@deepseek-ai/dsh-tool-todo/lib/index.js` 验证 `inject=['tools', ...]` 和工具返回文本渲染结构。

## 验证层次

最终结果：9 项自动化测试全部通过，语法检查通过；打包后解包再次执行同样 9 项测试全部通过。真实宿主隔离烟测通过，原始结果见 `host-smoke-result.json`。

- Node 单元/集成测试：真实文件系统、真实本机 HTTP API，模型与 OneBot 发送使用可控替身；测试文件见 test/companion.test.js。
- 真实 SDK 隔离烟测：安装包内原版 Context 和 ToolsService，systemPrompt 为最小测试依赖。通过真实注册表验证两个工具，确认 dispose 后 engine.lock 消失。未加载完整桌面或真实模型。
- 没有改现有 profile、没有安装到正在运行的桌面、没有读取现有模型密钥或向 QQ 发消息。

## 待验证

1. 干净 DSH 0.2.1 的 bundle loader 与 ToolsService schema。尝试读取上游 v0.2.1 的指定源码路径失败（404），因此不对该版本作已验证承诺。
2. 本机桌面完整 bundle 安装与 UI 展示、工具实际会话调用、桌面退出时宿主层整体清理。
3. 用户模型供应商是否支持 max_tokens、Chat Completions 及所选模型；部分供应商需要改参数。
4. 用户 OneBot 实现的签名、HTTP API、消息段上报与 QQ 网络实机行为。
5. 磁盘写入失败时不能保证本次内存状态与落盘状态一致；文件替换防半截 JSON，但没有 fsync、电源故障事务保证或迁移恢复系统。

## 外部协议与功能方向

- [Constellation Engine](https://constellation-engine.com/)：只参考本地持续记忆的产品方向，没有复制代码或素材；V0.1 不是其图谱记忆引擎的复刻。
- [OneBot 11 消息事件](https://github.com/botuniverse/onebot-11/blob/master/event/message.md)
- [OneBot 11 公共 API](https://github.com/botuniverse/onebot-11/blob/master/api/public.md)
- [OpenAI Chat API](https://developers.openai.com/api/reference/resources/chat)

测试的可控替身不构成上述外部服务的真实成功记录。
