# Control UI `client.request` 命令清单

本文档整理 Control UI 中通过 `GatewayBrowserClient.request(method, params)` 发起的 gateway RPC 调用。

分析范围：`src/ui/**/*.ts`。已排除生成的 locale 文件，重点关注运行时 UI 调用；测试中单独出现的调用会在末尾说明。

## 说明

- `GatewayBrowserClient.request<T>(method, params)` 接收任意字符串形式的 `method`，并将其序列化为 gateway 请求。
- 少量调用使用动态方法名，这类调用已在对应章节和“动态/用户输入调用”章节列出。
- 参数中带 `?` 的字段表示可选字段，通常只有 UI 当前有对应值时才会发送。
- 同一个命令可能在多个 UI 入口调用。表格按命令合并整理，不按调用点重复展开。

## Sessions

| 命令 | 参数 | 用途 | 主要文件 |
| --- | --- | --- | --- |
| `sessions.subscribe` | `{}` | 订阅 session 变更事件。 | `src/ui/controllers/sessions.ts` |
| `sessions.list` | `{ includeGlobal?, includeUnknown?, configuredAgentsOnly?, agentId?, activeMinutes?, limit?, offset?, search? }` | 加载 session 列表和聊天 session 选择器分页。 | `src/ui/controllers/sessions.ts`, `src/ui/chat/session-controls.ts`, `src/ui/chat/slash-command-executor.ts` |
| `sessions.create` | `CreateSessionParams` | 创建新 session，然后刷新 session 列表。 | `src/ui/controllers/sessions.ts` |
| `sessions.patch` | `{ key, label?, thinkingLevel?, fastMode?, verboseLevel?, reasoningLevel?, model? }` | 重命名或更新 session 设置，包括模型、思考级别、快速模式、详细模式等。 | `src/ui/controllers/sessions.ts`, `src/ui/chat/session-controls.ts`, `src/ui/chat/slash-command-executor.ts` |
| `sessions.delete` | `{ key, deleteTranscript: true }` | 删除 session 条目并归档 transcript。 | `src/ui/controllers/sessions.ts` |
| `sessions.reset` | `{ key }` | 重置当前 chat/session 状态。 | `src/ui/app-chat.ts`, `src/ui/app-render.ts` |
| `sessions.compact` | `{ key }` | 通过 slash command 压缩当前 session 上下文。 | `src/ui/chat/slash-command-executor.ts` |
| `sessions.compaction.branch` | `{ key, checkpointId }` | 从 compaction checkpoint 创建分支。 | `src/ui/controllers/sessions.ts` |
| `sessions.compaction.restore` | `{ key, checkpointId }` | 恢复 compaction checkpoint。 | `src/ui/controllers/sessions.ts` |
| `sessions.steer` | `{ key, message }` | 硬重定向：中止并用新消息重启 session。 | `src/ui/chat/slash-command-executor.ts` |
| `sessions.usage` | `{ startDate?, endDate?, mode?, utcOffset?, groupBy?, includeHistorical?, limit: 1000, includeContextWeight: true }` | 按 session/date 加载用量概览。 | `src/ui/controllers/usage.ts` |
| `sessions.usage.timeseries` | `{ key }` | 加载可选的单 session 用量时间序列。 | `src/ui/controllers/usage.ts` |
| `sessions.usage.logs` | `{ key, limit: 1000 }` | 加载可选的单 session 用量日志。 | `src/ui/controllers/usage.ts` |

## Chat

| 命令 | 参数 | 用途 | 主要文件 |
| --- | --- | --- | --- |
| `chat.history` | `{ sessionKey, limit, maxChars }` | 加载可见聊天历史。 | `src/ui/controllers/chat.ts` |
| `chat.send` | `{ sessionKey, sessionId?, message, deliver: false, idempotencyKey, attachments? }` | 发送或 steer 用户消息。附件会编码为 image/file block，包含 `mimeType`、`fileName` 和 base64 `content`。 | `src/ui/controllers/chat.ts`, `src/ui/chat/slash-command-executor.ts` |
| `chat.abort` | `{ sessionKey, runId? }` | 中止活跃 run。也用于 realtime talk consult 中止和 `/kill`。 | `src/ui/controllers/chat.ts`, `src/ui/chat/realtime-talk-shared.ts`, `src/ui/chat/slash-command-executor.ts` |

## Agents 和 Tools

| 命令 | 参数 | 用途 | 主要文件 |
| --- | --- | --- | --- |
| `agents.list` | `{}` | 加载已配置 agents。 | `src/ui/controllers/agents.ts`, `src/ui/chat/slash-command-executor.ts` |
| `agent.identity.get` | `{ sessionKey }` 或 `{ agentId }` | 解析 assistant/agent 展示身份。 | `src/ui/controllers/assistant-identity.ts`, `src/ui/controllers/agent-identity.ts` |
| `agents.files.list` | `{ agentId }` | 列出 agent 文件。 | `src/ui/controllers/agent-files.ts` |
| `agents.files.get` | `{ agentId, name }` | 加载单个 agent 文件。 | `src/ui/controllers/agent-files.ts` |
| `agents.files.set` | `{ agentId, name, content }` | 保存单个 agent 文件。 | `src/ui/controllers/agent-files.ts` |
| `tools.catalog` | `{ agentId, includePlugins: true }` | 展示某个 agent 可用的工具目录。 | `src/ui/controllers/agents.ts` |
| `tools.effective` | `{ agentId, sessionKey }` | 展示某个 agent/session/model 下实际生效的工具。 | `src/ui/controllers/agents.ts` |
| `commands.list` | `{ agentId?, includeArgs: true, scope: "text" }` | 加载远端 slash command 目录。 | `src/ui/chat/slash-commands.ts` |

## Skills

| 命令 | 参数 | 用途 | 主要文件 |
| --- | --- | --- | --- |
| `skills.status` | `{}` 或 `{ agentId }` | 加载全局或 agent 级 skill 状态。 | `src/ui/controllers/skills.ts`, `src/ui/controllers/agent-skills.ts` |
| `skills.update` | `{ skillKey, enabled }` 或 `{ skillKey, apiKey }` | 启用/禁用 skill，或保存 skill API key。 | `src/ui/controllers/skills.ts` |
| `skills.install` | `{ name, installId, dangerouslyForceUnsafeInstall, timeoutMs: 120000 }` 或 `{ source: "clawhub", slug }` | 安装打包 skill 或 ClawHub skill。 | `src/ui/controllers/skills.ts` |
| `skills.search` | `{ query, limit: 20 }` | 搜索 ClawHub skills。 | `src/ui/controllers/skills.ts` |
| `skills.detail` | `{ slug }` | 加载 ClawHub skill 详情。 | `src/ui/controllers/skills.ts` |

## Config 和 Update

| 命令 | 参数 | 用途 | 主要文件 |
| --- | --- | --- | --- |
| `config.get` | `{}` | 加载 config 快照。 | `src/ui/controllers/config.ts` |
| `config.schema` | `{}` | 加载 config schema 和 UI hints。 | `src/ui/controllers/config.ts` |
| `config.set` | `{ raw, baseHash }` | 保存 config，但不应用运行时变更。 | `src/ui/controllers/config.ts` |
| `config.apply` | `{ raw, baseHash, sessionKey }` | 应用 config 变更，可关联到某个 session。 | `src/ui/controllers/config.ts` |
| `config.patch` | `{ raw, baseHash, sessionKey?, note? }` | 从 Dreaming 控件写入 config patch。 | `src/ui/controllers/dreaming.ts` |
| `config.schema.lookup` | `{ path }` | 检查某个嵌套 config path 是否被 schema 支持。 | `src/ui/controllers/dreaming.ts` |
| `config.openFile` | `{}` | 请求 gateway 打开 config 文件。 | `src/ui/controllers/config.ts` |
| `update.run` | `{ sessionKey }` | 从 UI 发起 update 流程。 | `src/ui/controllers/config.ts` |
| `update.status` | `{}` | gateway 重连期间轮询 update/restart 状态。 | `src/ui/app-gateway.ts` |

`config.set` 和 `config.apply` 通过名为 `method` 的局部变量动态调用，但类型限制只允许这两个命令。

## Cron

| 命令 | 参数 | 用途 | 主要文件 |
| --- | --- | --- | --- |
| `cron.status` | `{}` | 加载 cron 子系统状态。 | `src/ui/controllers/cron.ts` |
| `cron.list` | `{ includeDisabled, limit, offset, query?, enabled, sortBy, sortDir }` | 分页/筛选加载 cron jobs。 | `src/ui/controllers/cron.ts` |
| `cron.add` | Cron job payload | 创建 cron job。 | `src/ui/controllers/cron.ts` |
| `cron.update` | `{ id, patch }` | 更新 job 字段或切换启用状态。 | `src/ui/controllers/cron.ts` |
| `cron.run` | `{ id, mode }` | 手动运行 job。`mode` 为 `"force"` 或 `"due"`。 | `src/ui/controllers/cron.ts` |
| `cron.remove` | `{ id }` | 删除 job。 | `src/ui/controllers/cron.ts` |
| `cron.runs` | `{ scope, id?, limit, offset, statuses?, status, deliveryStatuses?, query?, sortDir }` | 加载 cron run 历史。 | `src/ui/controllers/cron.ts` |

UI 组装的 cron job payload 主要包含：

- `name`, `description?`, `agentId?`, `sessionKey?`, `enabled`, `deleteAfterRun?`
- `schedule`: `{ kind: "at", at }`、`{ kind: "every", everyMs }` 或 `{ kind: "cron", expr, tz?, staggerMs? }`
- `sessionTarget`, `wakeMode`
- `payload`: `{ kind: "systemEvent", text }` 或 `{ kind: "agentTurn", message, model?, thinking?, timeoutSeconds?, lightContext? }`
- `delivery?`: mode/channel/to/account/best-effort 相关设置
- `failureAlert?`: `false` 或自定义告警设置

## Models、Usage、Health、Debug

| 命令 | 参数 | 用途 | 主要文件 |
| --- | --- | --- | --- |
| `models.list` | `{}` 或 `{ view: "configured" }` | Debug 模型列表、cron 模型建议、slash model 命令。 | `src/ui/controllers/debug.ts`, `src/ui/controllers/models.ts`, `src/ui/controllers/cron.ts` |
| `models.authStatus` | `{ refresh?: true }` | Provider 认证/配额状态。 | `src/ui/controllers/model-auth-status.ts` |
| `usage.cost` | `{ startDate?, endDate?, mode?, utcOffset? }` | Usage 页面成本汇总。 | `src/ui/controllers/usage.ts` |
| `health` | `{}` | Gateway health 汇总。 | `src/ui/controllers/health.ts`, `src/ui/controllers/debug.ts` |
| `status` | `{}` | Debug 状态快照。 | `src/ui/controllers/debug.ts` |
| `last-heartbeat` | `{}` | Debug heartbeat 快照。 | `src/ui/controllers/debug.ts` |
| dynamic debug call | 用户输入的 method 和 JSON params | Debug 面板的临时 RPC 调用器。 | `src/ui/controllers/debug.ts` |

## Logs、Presence、Nodes

| 命令 | 参数 | 用途 | 主要文件 |
| --- | --- | --- | --- |
| `logs.tail` | `{ cursor?, limit, maxBytes }` | tail gateway 日志。 | `src/ui/controllers/logs.ts`, `src/ui/app-settings.ts` |
| `system-presence` | `{}` | 加载已连接实例 presence。 | `src/ui/controllers/presence.ts` |
| `node.list` | `{}` | 加载远端 nodes。 | `src/ui/controllers/nodes.ts` |

## Channels

| 命令 | 参数 | 用途 | 主要文件 |
| --- | --- | --- | --- |
| `channels.status` | `{ probe, timeoutMs: 8000 }` | 加载 channel 状态快照。 | `src/ui/controllers/channels.ts` |
| `web.login.start` | `{ force, timeoutMs: 30000 }` | 启动 WhatsApp web 登录和二维码流程。 | `src/ui/controllers/channels.ts` |
| `web.login.wait` | `{ timeoutMs: 120000, currentQrDataUrl? }` | 等待 WhatsApp 登录完成或刷新二维码。 | `src/ui/controllers/channels.ts` |
| `channels.logout` | `{ channel: "whatsapp" }` | 登出 WhatsApp channel。 | `src/ui/controllers/channels.ts` |

## Devices

| 命令 | 参数 | 用途 | 主要文件 |
| --- | --- | --- | --- |
| `device.pair.list` | `{}` | 列出待配对/已配对设备。 | `src/ui/controllers/devices.ts` |
| `device.pair.approve` | `{ requestId }` | 批准待处理设备配对。 | `src/ui/controllers/devices.ts` |
| `device.pair.reject` | `{ requestId }` | 拒绝待处理设备配对。 | `src/ui/controllers/devices.ts` |
| `device.token.rotate` | `{ deviceId, role, scopes? }` | 轮换设备 token。 | `src/ui/controllers/devices.ts` |
| `device.token.revoke` | `{ deviceId, role }` | 撤销设备 token。 | `src/ui/controllers/devices.ts` |

## Exec 和 Plugin Approvals

| 命令 | 参数 | 用途 | 主要文件 |
| --- | --- | --- | --- |
| `exec.approvals.get` | `{}` | 加载 gateway exec approval 配置。 | `src/ui/controllers/exec-approvals.ts` |
| `exec.approvals.set` | `{ file, baseHash }` | 保存 gateway exec approval 配置。 | `src/ui/controllers/exec-approvals.ts` |
| `exec.approvals.node.get` | `{ nodeId }` | 加载 node exec approval 配置。 | `src/ui/controllers/exec-approvals.ts` |
| `exec.approvals.node.set` | `{ nodeId, file, baseHash }` | 保存 node exec approval 配置。 | `src/ui/controllers/exec-approvals.ts` |
| `exec.approval.resolve` | `{ id, decision }` | 处理待审批 exec 请求。`decision`: `"allow-once"`, `"allow-always"`, `"deny"`。 | `src/ui/app.ts` |
| `plugin.approval.resolve` | `{ id, decision }` | 处理待审批 plugin 请求。`decision` 取值同上。 | `src/ui/app.ts` |

approval config 的 get/set 命令会根据目标类型动态选择，但可能的方法名就是上表中的四个。

## Dreaming 和 Wiki

| 命令 | 参数 | 用途 | 主要文件 |
| --- | --- | --- | --- |
| `doctor.memory.status` | `{}` | 加载 memory/dreaming 状态。 | `src/ui/controllers/dreaming.ts` |
| `doctor.memory.dreamDiary` | `{}` | 加载 dream diary 文件和内容。 | `src/ui/controllers/dreaming.ts` |
| `doctor.memory.backfillDreamDiary` | `{}` | 回填 dream diary。 | `src/ui/controllers/dreaming.ts` |
| `doctor.memory.resetDreamDiary` | `{}` | 重置 dream diary。 | `src/ui/controllers/dreaming.ts` |
| `doctor.memory.resetGroundedShortTerm` | `{}` | 重置 grounded short-term memory。 | `src/ui/controllers/dreaming.ts` |
| `doctor.memory.repairDreamingArtifacts` | `{}` | 归档/重建派生的 dreaming artifacts。 | `src/ui/controllers/dreaming.ts` |
| `doctor.memory.dedupeDreamDiary` | `{}` | 对 dream diary 去重。 | `src/ui/controllers/dreaming.ts` |
| `wiki.importInsights` | `{}` | 加载 wiki import insights。 | `src/ui/controllers/dreaming.ts` |
| `wiki.palace` | `{}` | 加载 wiki memory palace。 | `src/ui/controllers/dreaming.ts` |
| `wiki.get` | `{ lookup, fromLine: 1, lineCount: 5000 }` | 在 UI 中打开 wiki 页面内容。 | `src/ui/app-render.ts` |

doctor memory action 的 method 由 `runDreamDiaryAction` 动态选择，但只会是上面列出的五个 action 命令。

## Realtime Talk

| 命令 | 参数 | 用途 | 主要文件 |
| --- | --- | --- | --- |
| `talk.client.create` | `{ sessionKey, provider?, model?, voice?, transport?, vadThreshold?, silenceDurationMs?, prefixPaddingMs?, reasoningEffort? }` | 首选的 realtime Talk session 创建方式。 | `src/ui/chat/realtime-talk.ts` |
| `talk.session.create` | 与 launch params 相同，并额外带 `{ mode: "realtime", transport, brain: "agent-consult" }` | fallback realtime Talk session 创建方式。 | `src/ui/chat/realtime-talk.ts` |
| `talk.session.close` | `{ sessionId }` | 关闭 gateway relay Talk session。 | `src/ui/chat/realtime-talk-gateway-relay.ts` |
| `talk.session.appendAudio` | `{ sessionId, audioBase64, timestamp }` | 将麦克风 PCM 音频流发送到 relay。 | `src/ui/chat/realtime-talk-gateway-relay.ts` |
| `talk.session.submitToolResult` | `{ sessionId, callId, result, options? }` | 向 relay 返回 tool call 结果。 | `src/ui/chat/realtime-talk-gateway-relay.ts` |
| `talk.session.cancelOutput` | `{ sessionId, reason: "barge-in" }` | 检测到 barge-in speech 时取消 relay 输出。 | `src/ui/chat/realtime-talk-gateway-relay.ts` |
| `talk.client.toolCall` | `{ sessionKey, callId, name, args, relaySessionId? }` | 从实时语音中发起 agent consult tool call。 | `src/ui/chat/realtime-talk-shared.ts` |

## Web Push

| 命令 | 参数 | 用途 | 主要文件 |
| --- | --- | --- | --- |
| `push.web.vapidPublicKey` | `{}` | 浏览器订阅前获取 VAPID public key。 | `src/ui/push-subscription.ts` |
| `push.web.subscribe` | `{ endpoint, keys: { p256dh, auth } }` | 注册或 reconcile 浏览器 push subscription。 | `src/ui/push-subscription.ts`, `src/ui/app.ts` |
| `push.web.unsubscribe` | `{ endpoint }` | 注销浏览器 push subscription。 | `src/ui/push-subscription.ts` |
| `push.web.test` | `{ title?, body? }` | 发送测试通知。 | `src/ui/push-subscription.ts` |

## 动态或用户输入调用

这些调用点没有硬编码单一 method 字符串：

| 位置 | method 来源 | 参数 |
| --- | --- | --- |
| `src/ui/controllers/config.ts` | `"config.set"` 或 `"config.apply"` | `{ raw, baseHash, ...extraParams }` |
| `src/ui/controllers/sessions.ts` | `"sessions.compaction.branch"` 或 `"sessions.compaction.restore"` | `{ key, checkpointId }` |
| `src/ui/controllers/dreaming.ts` | doctor memory action 命令之一 | `{}` |
| `src/ui/controllers/exec-approvals.ts` | gateway/node approval get/set method | `{}`, `{ nodeId }`, `{ file, baseHash }` 或 `{ nodeId, file, baseHash }` |
| `src/ui/app.ts` | `"plugin.approval.resolve"` 或 `"exec.approval.resolve"` | `{ id, decision }` |
| `src/ui/controllers/debug.ts` | 用户输入的 method | 用户输入的 JSON params 或 `{}` |

## 仅测试中出现的调用

测试中也直接引用了一些命令，用于验证 gateway 行为或 UI 集成，包括：

- `sessions.list`
- `config.get`
- `tools.effective`

这些命令上文已经覆盖；测试调用点不算额外的运行时 UI 命令。

