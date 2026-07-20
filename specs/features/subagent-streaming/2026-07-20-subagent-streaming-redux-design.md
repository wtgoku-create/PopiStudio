# Subagent Streaming Redux 同步设计文档

## 1. 概述

### 1.1 背景

OpenClaw 主 agent 创建 subagent 后，PopiStudio 过去主要通过轮询或历史查询获取子任务状态和消息。
这导致几个问题：

- 子任务执行过程中，右侧子任务面板看不到实时工具执行和 assistant 输出。
- 每次打开子任务详情都可能重新拉历史，UI 状态分散在组件本地。
- 主会话可以通过 main process 推流更新 Redux，但 subagent 走的是另一套局部监听逻辑。
- 点击停止或会话恢复时，主会话状态和 gateway 子任务状态容易出现不同步。

本次改动把 subagent 消息同步改为与主会话一致的架构：

```text
OpenClaw gateway -> main runtime adapter -> IPC event -> coworkService -> coworkSlice -> UI selector
```

### 1.2 目标

1. 子任务 assistant/tool 流可以实时显示。
2. renderer 组件不直接监听 subagent IPC，不直接承担业务同步。
3. 子任务列表和消息进入 Redux，UI 只通过 selector 渲染。
4. 首次进入或缓存缺失时允许补拉历史，但流式更新不再靠轮询。
5. 避免高频 chunk 造成 IPC、Redux 和 React 重渲染压力。
6. IPC channel 和事件负载类型集中定义，避免裸字符串和重复类型。

### 1.3 非目标

- 不改变 OpenClaw gateway 的 subagent 执行协议。
- 不重做子任务面板 UI。
- 不把子任务消息写入主会话正文消息流。
- 不取消历史补拉能力；补拉仍作为初始化和异常恢复兜底。

## 2. 问题与根因

### 2.1 子任务消息来源分散

旧实现中，`SubagentPanelContent` 和 `SubagentSessionDetail` 会直接调用 preload API：

- `getSubTaskHistory`
- `listSubagentSessions`
- `onSubagentMessagesChanged`

这让 UI 组件同时负责展示、监听、补拉和状态合并，和主会话的 `coworkService -> Redux`
路径不一致。

### 2.2 子任务工具结果缺失

部分 `session.tool` 事件来自子会话自己的 `sessionKey`，不是父会话 runId。若 adapter 只按主会话
active turn 路由，这些子任务工具事件会成为 unmapped event，最终 UI 只看到 summary，看不到工具
执行过程。

### 2.3 订阅失败后无法重试

tracker 会先把 `childSessionKey` 加入 `subscribedChildSessionKeys`，再 fire-and-forget 请求 gateway
订阅。同步 throw 可以回滚，但异步 request 失败时之前只打印 warn，不会删除 key，导致后续不再重试。

### 2.4 高频流式更新导致卡顿

子任务 assistant stream 的每个 chunk 都携带完整 `messages` 快照发到 renderer，并整数组写 Redux。
如果同时 run 尚未进入 Redux，还会触发多次 `listSubagentSessions(force)`。这会造成：

- IPC 事件过密；
- Redux 大对象更新过密；
- `ConversationTurnsView` 高频重建 turns；
- 子任务列表请求并发堆积。

## 3. 功能需求

### FR-1: main 进程订阅子会话消息

当 `sessions_spawn` 返回 `childSessionKey` 后，main 进程应订阅该子会话消息流。
订阅使用从 `childSessionKey` 解析出的真实 agentId，避免用 taskName 导致 `Unknown agent id`。

### FR-2: main 进程聚合子任务 assistant/tool 事件

main runtime adapter 应把以下事件交给 `SubagentTracker`：

- 子会话 assistant stream；
- 子会话 `session.tool`；
- 子会话 terminal lifecycle/chat 事件。

tracker 维护按 runId 缓存的 `subagentMessages`，消息类型包括：

- `assistant`
- `tool_use`
- `tool_result`
- `system`

### FR-3: 通过专用 IPC 推送子任务变化

新增 IPC channel：

```typescript
CoworkIpcChannel.SubagentMessagesChanged
```

负载类型集中定义为：

```typescript
CoworkSubagentMessagesChangedEvent
```

preload 和 `electron.d.ts` 复用该类型，避免重复声明。

### FR-4: renderer 统一由 coworkService 写 Redux

`coworkService` 是 renderer 侧唯一的 subagent IPC 监听者。
收到 `SubagentMessagesChanged` 后：

1. 有 `messages` 时写入 `subagentMessagesByRunId`。
2. 有 `status` 时更新 `subagentRunsByParentSessionId` 中对应 run。
3. run 缺失或进入终态时，补拉一次子任务列表。

UI 组件只从 Redux 读取：

- `subagentRunsByParentSessionId`
- `subagentMessagesByRunId`
- loading 状态。

### FR-5: 初始化和兜底补拉

以下场景允许调用 service 补拉：

- 切换会话后首次加载子任务列表；
- 打开子任务面板；
- 选择某个子任务详情但 Redux 尚无消息；
- 子任务终态后刷新列表以获取最终 `endedAt/status`。

普通流式 chunk 不应触发历史轮询。

### FR-6: 性能保护

子任务消息流需要限流：

- main 侧对子任务消息快照进行 200ms 合并发送；
- `done/error` 终态立即 flush；
- renderer 侧 `loadSubagents` 和 `loadSubagentHistory` 做 in-flight 去重；
- 会话详情不再以主会话 `messagesLength` 作为子任务列表刷新依赖。

## 4. 实现方案

### 4.1 main: 子会话订阅

`SubagentTracker.commitSpawnResult()` 在拿到 `childSessionKey` 后调用订阅回调。
adapter 通过 `subscribeToGatewaySessionMessages()` 请求 gateway：

```text
sessions.messages.subscribe
```

订阅失败处理：

- 同步异常：tracker 立即删除 `subscribedChildSessionKeys`。
- 异步 request 失败或未确认：adapter 回调
  `subagentTracker.releaseChildSessionSubscription(sessionKey)`，允许后续重试。

### 4.2 main: 子任务事件缓存与推送

`SubagentTracker` 根据 `sessionKey -> runId` 反向映射，把子会话事件写入 runId 缓存。

assistant stream：

- 如果上一条是 assistant，则更新最后一条 assistant 内容。
- 否则创建新的 assistant message。

tool event：

- start 阶段创建或更新 `tool_use`。
- result 阶段创建或更新 `tool_result`。

terminal：

- 更新 run status 为 `done` 或 `error`。
- 持久化缓存消息。
- 推送终态事件。

### 4.3 main: IPC 限流

`OpenClawRuntimeAdapter.notifySubagentMessagesChanged()` 不再对每个非终态事件立即发送 IPC。
它按 `parentSessionId:runId` 保存最新事件，并在 200ms 后发送最后一次快照。

终态事件会取消 pending timer 并立即发送，保证 UI 及时结束 loading/streaming 状态。

### 4.4 renderer: Redux 状态

`coworkSlice` 增加：

```typescript
subagentRunsByParentSessionId: Record<string, SubagentSessionSummary[]>;
subagentRunsLoadingByParentSessionId: Record<string, boolean>;
subagentMessagesByRunId: Record<string, CoworkMessage[]>;
subagentMessagesLoadingByRunId: Record<string, boolean>;
```

对应 reducer：

- `setSubagentRunsLoading`
- `setSubagentRuns`
- `updateSubagentRunStatus`
- `setSubagentMessagesLoading`
- `setSubagentMessages`

删除未使用的 `upsertSubagentRun`，避免死 reducer。

### 4.5 renderer: service 收口

`coworkService.setupStreamListeners()` 注册 `onSubagentMessagesChanged`。
组件不再直接挂该 IPC listener。

新增 service 方法：

- `loadSubagents(parentSessionId, options)`
- `loadSubagentHistory(parentSessionId, runId, sessionKey, options)`

两个方法都维护 in-flight request map，同一个 key 有请求进行中时直接复用 Promise。

### 4.6 renderer: UI 改造

`CoworkSessionDetail`：

- 从 Redux 读取当前 session 的 subagents。
- 打开/激活子任务面板时调用 `coworkService.loadSubagents()`。
- 不再按 `messagesLength` 变化刷新子任务列表。

`SubagentPanelContent`：

- 子任务详情从 Redux 读取 messages/loading。
- 首次无消息时通过 service 补拉历史。
- 不再直接监听 IPC。

`SubagentSessionDetail`：

- 从 Redux 读取 run status 和 messages。
- 首次无消息时通过 service 补拉历史。
- 不再直接监听 IPC 或轮询状态。

## 5. 数据流

### 5.1 实时流

```text
OpenClaw child session event
  -> OpenClawRuntimeAdapter
  -> SubagentTracker.appendAssistantStreamFromSessionKey / appendToolEventFromSessionKey
  -> notifySubagentMessagesChanged
  -> 200ms throttle
  -> IPC CoworkIpcChannel.SubagentMessagesChanged
  -> coworkService
  -> coworkSlice
  -> React selector render
```

### 5.2 首次打开详情

```text
User opens subagent detail
  -> UI sees Redux has no messages
  -> coworkService.loadSubagentHistory
  -> preload getSubTaskHistory
  -> main SubagentTracker.getSubTaskHistory
  -> local live cache / persisted cache / gateway history
  -> coworkSlice.setSubagentMessages
```

### 5.3 终态

```text
OpenClaw terminal event
  -> SubagentTracker marks run done/error
  -> persist cached messages
  -> immediate IPC flush
  -> coworkService updates run status
  -> coworkService force refreshes subagent list once
```

## 6. 边界情况

| 场景 | 处理方式 |
| --- | --- |
| gateway 订阅同步 throw | tracker 删除 subscribed key |
| gateway 订阅异步失败 | adapter 回调 tracker 释放 subscribed key |
| 子任务 run 尚未在 Redux 中 | service 补拉列表，且同一 parent 去重 |
| 子任务详情晚打开 | 通过 live cache / persisted cache / gateway history 补拉 |
| assistant 高频 chunk | main 侧 200ms 合并发送 |
| terminal 到达时仍有 pending chunk | 取消 pending timer 并立即发送终态 |
| 主会话新增消息但无子任务 | 不再因 `messagesLength` 变化刷新子任务列表 |
| 子任务列表请求慢 | in-flight Promise 复用，避免请求堆积 |

## 7. 涉及文件

| 文件 | 职责 |
| --- | --- |
| `src/shared/cowork/constants.ts` | IPC channel 常量和 subagent event 共享类型 |
| `src/main/preload.ts` | 暴露 `onSubagentMessagesChanged`，复用共享类型 |
| `src/renderer/types/electron.d.ts` | renderer 全局 Electron API 类型 |
| `src/main/libs/agentEngine/openclawRuntimeAdapter.ts` | 子会话订阅、事件路由、IPC 限流和 session changed 通知 |
| `src/main/libs/agentEngine/subagentTracker.ts` | 子任务 run/sessionKey 映射、消息缓存、终态处理和订阅失败回滚 |
| `src/main/libs/agentEngine/subagent/sessionMaterializer.ts` | 子任务 materialize 后复用 session changed 通知 |
| `src/main/subagentRunStore.ts` | 子任务 run 持久化与状态更新 |
| `src/renderer/services/cowork.ts` | subagent IPC 收口、Redux 分发、列表/历史补拉去重 |
| `src/renderer/store/slices/coworkSlice.ts` | subagent runs/messages Redux 状态 |
| `src/renderer/components/cowork/CoworkSessionDetail.tsx` | 子任务面板入口和列表 selector |
| `src/renderer/components/artifacts/SubagentPanelContent.tsx` | 右侧子任务详情 selector 渲染 |
| `src/renderer/components/cowork/SubagentSessionDetail.tsx` | 独立子任务详情 selector 渲染 |
| `src/main/libs/agentEngine/openclawRuntimeAdapter.test.ts` | subagent/session.tool 运行时回归测试 |

## 8. 验证

已执行：

```bash
npx tsc --noEmit --project tsconfig.json
npx tsc --noEmit --project electron-tsconfig.json
npx vitest run src/main/libs/agentEngine/openclawRuntimeAdapter.test.ts -t subagent
npx vitest run src/main/libs/agentEngine/openclawRuntimeAdapter.test.ts -t session.tool
```

覆盖点：

- 子会话消息订阅。
- 子任务 assistant/tool 事件路由。
- 订阅失败后可回滚并允许重试。
- renderer 类型与 preload 事件负载一致。
- 高频子任务消息不会每个 chunk 都触发 IPC 和 Redux 写入。

## 9. 后续观察

如果仍出现页面卡顿，下一步应检查：

1. `ConversationTurnsView.buildConversationTurns` 在长消息下的重建成本。
2. `AssistantTurnBlock` 对大型 tool result 或 markdown 的渲染成本。
3. 子任务面板不可见时是否需要延迟订阅 Redux 消息渲染。
4. 是否需要把 subagent IPC 从完整消息快照改为增量 patch。
