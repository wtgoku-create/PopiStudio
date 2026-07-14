# IM Channel 会话运行状态同步修复设计文档

## 1. 概述

### 1.1 问题

IM 入口触发 OpenClaw 运行后，消息可以同步到 Popiai，但本地 cowork session 的 `status` 没有稳定更新为 `running` / `completed` / `error`，导致 UI 侧出现以下现象：

- 会话列表或当前会话没有显示运行中状态。
- 输入区可能提前恢复可发送状态。
- 后续消息已经在更新，但 session 仍停留在旧状态。
- 用户再次发送时可能触发 `Session ... is still running.` 这类并发保护错误。

该问题主要发生在 IM/channel session 链路，因为它不是由 renderer 直接调用 `startSession` / `continueSession` 发起，而是由 OpenClaw gateway channel 事件驱动。

### 1.2 根因

本地 session 状态原先主要依赖 Popiai runtime 内部 active turn 和 stream final 事件。

但 IM channel session 的运行状态来自 OpenClaw gateway 的 `sessions.list` row：

- `row.status`
- `row.hasActiveRun`

排查时发现，某些 IM session row 会出现：

```text
status="running"
hasActiveRun=false
```

如果 Popiai 只信任 `hasActiveRun`，或者只在 user message 到达时把 session 置为 `running`，就会漏掉 gateway 已明确报告的运行中状态。

此外，如果 main 进程只更新 SQLite，而没有向 renderer 发出明确的 session status event，前端 Redux 和 `isStreaming` 状态也不会及时收敛。

### 1.3 影响范围

受影响链路：

- 微信 / 企微 / 钉钉 / 飞书等 OpenClaw channel session。
- IM 侧触发的新消息、新 turn、历史同步后继续运行。
- channel polling 发现已有 session 后的状态恢复。

不属于本问题范围：

- 普通 Cowork 页面内手动发起的本地会话。
- 定时任务最终消息是否成功投递到 IM。该问题已单独记录在 `scheduled-task-im-delivery-target` spec。

## 2. 用户场景

### 场景 A: IM 新消息触发运行

**Given** 用户从微信向绑定的 agent 发送消息  
**When** OpenClaw gateway session row 报告 `status="running"`  
**Then** Popiai 本地 cowork session 应立即变为 `running`，并同步到 renderer。

### 场景 B: active run flag 滞后

**Given** gateway row 中 `hasActiveRun=false`，但 `status="running"` 或 `status="processing"`  
**When** Popiai 轮询 channel sessions  
**Then** 应以 raw `status` 作为强信号，把本地 session 更新为 `running`。

### 场景 C: 运行结束

**Given** 本地 session 当前为 `running`  
**When** gateway row 显示没有 active run，或 raw status 进入 `done` / `completed`  
**Then** 本地 session 应更新为 `completed`，并结束当前 UI streaming 状态。

### 场景 D: 运行失败

**Given** gateway row raw status 为 `failed` / `killed` / `timeout` / `error`  
**When** Popiai 同步 channel session 状态  
**Then** 本地 session 应更新为 `error`，并结束当前 UI streaming 状态。

## 3. 功能需求

### FR-1: gateway raw status 是 IM session 的强运行信号

对于 channel session，同步状态时应综合：

- `hasActiveRun`
- raw `row.status`
- 当前本地 `session.status`

其中：

- `hasActiveRun=true` 永远表示 `running`。
- raw `status=running` / `processing` 也必须表示 `running`，即使 `hasActiveRun=false`。
- raw terminal status 应映射到 `completed` 或 `error`。

### FR-2: 状态变化必须持久化并广播

当 channel session 状态发生变化时，main 进程必须：

1. 更新 SQLite 中 `cowork_sessions.status`。
2. 通过 runtime `sessionStatus` event 通知 renderer。
3. renderer 收到后更新 Redux session summary 和当前会话 `isStreaming`。

只更新数据库是不够的，因为当前页面不会自动知道状态变化。

### FR-3: 不覆盖仍有本地 active turn 的终态

如果本地 active turn 仍存在，而 gateway row 临时报告非 running 终态，Popiai 不应立刻把 session 置为 `completed` / `error`。

该保护用于避免 gateway 状态短暂滞后或中间态覆盖本地仍在流式输出的 turn。

### FR-4: renderer 侧对消息流做状态自愈

renderer 收到 IM session 的 `message`、`messageUpdate` 或 `sessionStatus` 时，应保守恢复运行状态：

- 非 final 的 assistant / tool / user message 可以把 session 标记为 `running`。
- 明确 `sessionStatus=running` 时，应更新 session summary 并设置当前会话 streaming。
- 明确 `completed` / `error` 时，应结束当前会话 activity 和 queued follow-up 状态。

## 4. 实现方案

### 4.1 main: 独立状态决策函数

新增或保留独立 helper：

```text
src/main/libs/agentEngine/channelSessionRunStatus.ts
```

核心函数：

```typescript
resolveChannelSessionNextStatus({
  hasActiveRun,
  rawStatus,
  currentStatus,
})
```

映射规则：

| 输入 | 输出 |
|------|------|
| `hasActiveRun=true` | `running` |
| `rawStatus=running` | `running` |
| `rawStatus=processing` | `running` |
| `rawStatus=failed/killed/timeout/error` | `error` |
| `rawStatus=done/completed` | `completed` |
| `hasActiveRun=false` 且当前为 `running` | `completed` |
| 无有效信号 | `null` |

### 4.2 main: channel polling 同步 session status

在 OpenClaw runtime adapter 的 channel polling 链路中，对每个已映射的 channel session row 调用状态同步逻辑。

同步流程：

1. 读取本地 cowork session。
2. 标准化 raw `row.status`。
3. 调用 `resolveChannelSessionNextStatus()`。
4. 如果结果为空或与当前状态一致，跳过。
5. 如果结果不是 `running` 且本地仍有 active turn，跳过。
6. 更新 store。
7. emit `sessionStatus(sessionId, nextStatus)`。

### 4.3 renderer: 消费 session status event

renderer `coworkService` 应监听 `onStreamSessionStatus`：

1. 如果 session summary 不存在，先按 session id 加载 summary。
2. dispatch `updateSessionStatus({ sessionId, status })`。
3. 如果是当前会话，同步 `isStreaming`。
4. 根据状态通知 queued follow-up coordinator。

### 4.4 renderer: 流式消息兜底

对于 IM 触发的消息流，可能先收到 message 后收到 status event。

因此 renderer 收到以下消息时，也应把 session 标记为 `running`：

- `user`
- `assistant`
- `tool_use`
- `tool_result`

对于 `messageUpdate`，如果 `metadata.isFinal !== true` 且 session 尚未 `completed`，也应保持 `running`。

## 5. 边界情况

| 场景 | 处理方式 |
|------|---------|
| `row.status` 为空，`hasActiveRun=null` | 不改变本地状态 |
| `row.status=running`，`hasActiveRun=false` | 仍更新为 `running` |
| `row.status=done`，本地仍有 active turn | 不覆盖，等待本地 turn 完成 |
| session summary 还不在 Redux | 先加载该 session summary 再更新状态 |
| 当前会话不是该 IM session | 只更新列表状态，不改当前 `isStreaming` |
| 收到 `Session ... is still running.` | 保持或恢复 `running`，不当作终态错误 |

## 6. 涉及文件

Popiai 侧：

- `src/main/libs/agentEngine/channelSessionRunStatus.ts`
- `src/main/libs/agentEngine/channelSessionRunStatus.test.ts`
- `src/main/libs/agentEngine/openclawRuntimeAdapter.ts`
- `src/renderer/services/cowork.ts`
- `src/renderer/store/slices/coworkSlice.ts`

## 7. 验收标准

### 7.1 自动化测试

运行：

```bash
npx vitest run src/main/libs/agentEngine/channelSessionRunStatus.test.ts
```

期望覆盖：

- `hasActiveRun=true` 优先返回 `running`。
- raw `running` / `processing` 即使 active flag 为 false 也返回 `running`。
- terminal raw status 映射到 `completed` / `error`。
- active flag 缺失时仍能使用 raw status。

### 7.2 手动验证

1. 启动应用和 OpenClaw gateway。
2. 从微信或其他 IM 向绑定 agent 发送消息。
3. 观察 Popiai 会话列表对应 session 立即进入运行中状态。
4. 等待回复完成。
5. 观察 session 状态变为完成，输入区恢复可发送。
6. 再次发送 IM 消息，确认状态可以再次从完成变为运行中。

### 7.3 日志验证

main 日志应出现状态同步记录：

```text
[ChannelSync] synced channel session run status.
```

并能看到：

- Popiai session id
- OpenClaw session key
- status old -> new
- active run flag

不应出现消息仍在流式更新但本地 session 长时间停留在 `completed` / `idle` 的情况。
