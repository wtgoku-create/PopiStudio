# 定时任务 IM 投递目标大小写丢失修复设计文档

## 1. 概述

### 1.1 问题

用户将定时任务绑定到微信 IM 会话后，任务执行完成且 OpenClaw 记录 `delivery_status=delivered`，但微信实际没有收到消息。

本次复现任务：

- 任务 ID：`27fbe8af-07c3-4032-8cfd-933354208bd2`
- 任务名：`科技早报`
- 失败 run/session：`3b9c3251-08e3-4453-94c4-e2b47cbd6148`
- 失败时间：`2026-07-14 17:49:55 +0800`
- 投递渠道：`openclaw-weixin`

OpenClaw run log 显示：

```text
status=ok
delivery_status=delivered
delivered=1
```

但微信插件真实发送返回：

```text
sendWeixinOutbound: contextToken missing for to=o9cq805k_oys203dhhd67pncfwqm@im.wechat, sending without context
sendMessage status=200 raw={"ret":-3}
```

也就是说，任务状态显示成功，但微信接口返回了失败语义。

### 1.2 根因

根因有两个层面。

第一，Popiai / OpenClaw 的 channel session key 会把 IM peer id 规范化成小写，用于稳定索引 session 和本地映射。例如：

```text
agent:main:openclaw-weixin:95f2a6854e7a-im-bot:direct:o9cq805k_oys203dhhd67pncfwqm@im.wechat
```

但是微信真实 user id 是大小写敏感的：

```text
o9cq805k_Oys203DHhD67pncfwqM@im.wechat
```

历史定时任务从 `im_session_mappings` 或 session key 派生 `delivery.to` 时，把原始大小写丢掉，最终保存成：

```text
o9cq805k_oys203dhhd67pncfwqm@im.wechat
```

微信插件的 context token store 以原始大小写作为 key：

```text
95f2a6854e7a-im-bot:o9cq805k_Oys203DHhD67pncfwqM@im.wechat
```

所以小写 target 找不到 context token，微信 API 返回 `{"ret":-3}`，消息没有抵达。

第二，OpenClaw / 微信插件把 HTTP `status=200` 当作投递成功，没有检查业务返回体里的 `ret`。因此 `ret=-3` 仍被 cron 记录成 `delivered`，造成 UI 和日志误报成功。

### 1.3 同类风险

这个问题不是微信独有。凡是 IM 平台使用 opaque peer id、open id、union id、群 id 或 channel id，都不能假设大小写不敏感。

已知风险分类：

- 微信 direct：已确认大小写敏感，本次复现。
- 钉钉 / 企微 group：已有历史保护逻辑，用 gateway origin 恢复 native group id。
- 其他 IM 平台：如果 peer id 是 opaque token，也可能受影响。即使当前平台 ID 通常为数字或小写，也不应依赖 lowercased session key 作为投递目标。

结论：session key 可以 canonicalize，但 IM 投递目标必须使用 channel-native 原值。

## 2. 用户场景

### 场景 A: 历史微信定时任务手动运行

**Given** 历史任务的 `delivery.to` 已保存为小写微信 user id  
**When** 用户手动运行该定时任务  
**Then** Popiai 应在运行前从 gateway session 恢复原始大小写 target，再调用 OpenClaw run。

### 场景 B: 其他 IM 平台存在大小写敏感 target

**Given** 某 IM 平台 session key 中的 peer id 被小写化，但 gateway session 中仍保留 `lastTo` 或 `deliveryContext.to` 原值  
**When** 历史定时任务运行前迁移  
**Then** Popiai 应按 channel 和 peer id 大小写无关匹配 session，并只恢复 `delivery.to` 的原始大小写。

### 场景 C: gateway session 不可用

**Given** OpenClaw gateway 未运行或 `sessions.list` 中没有匹配记录  
**When** 定时任务运行前迁移  
**Then** Popiai 不应凭空修改 `delivery.to`，任务保持原值执行。

### 场景 D: 发送接口业务失败

**Given** 微信 API 返回 HTTP 200，但业务返回体为 `{"ret":-3}`  
**When** OpenClaw 记录 cron delivery 状态  
**Then** 不应标记为 `delivered`，而应记录失败原因，避免 UI 误报成功。

## 3. 功能需求

### FR-1: 新建 / 更新任务时恢复 channel-native delivery target

创建或更新 announce-mode IM 定时任务时，如果用户选择的是本地会话映射中的 conversation id，Popiai 应：

- 去掉 account / peer kind 前缀，只把 channel-native target 写入 `delivery.to`。
- 调用 gateway `sessions.list`。
- 从 `lastTo` 或 `deliveryContext.to` 恢复原始大小写。
- 在非历史修复路径中，可以补全 `delivery.accountId`。

### FR-2: 历史任务运行前做通用 target 大小写修复

历史任务运行前，如果 normalized `delivery.to` 是全小写值，Popiai 应尝试从 gateway session 恢复原始大小写。

该历史修复必须满足：

- 匹配时使用 peer id 的大小写无关比较。
- 返回值使用 gateway session 中的 channel-native 原值。
- `casingOnly=true` 时只修复 `delivery.to`，不新增或修改 `accountId`。
- 找不到匹配 session 时不改任务。

### FR-3: session key 与 delivery target 语义分离

OpenClaw session key / Popiai `im_session_mappings` 可以继续使用 canonicalized peer id，保证索引稳定。

但下游投递必须使用：

- gateway `lastTo`
- gateway `deliveryContext.to`
- channel plugin 提供的原始 target

不能直接把 lowercased session key peer 当作最终投递目标。

### FR-4: OpenClaw 插件必须检查业务返回码

微信插件发送消息后不能只判断 HTTP status。

对于返回体：

```json
{"ret": -3}
```

应视为投递失败，并向 cron delivery 层返回失败状态和错误信息。

## 4. 实现方案

### 4.1 Popiai 侧：恢复 IM delivery hints

`src/main/ipcHandlers/scheduledTask/helpers.ts` 中的 `resolveImDeliveryHintsFromSessions()` 负责从 gateway session rows 恢复投递信息。

恢复规则：

1. 用 `PlatformRegistry.platformOfChannel()` 确认 row channel 与目标 channel 属于同一平台。
2. 从 `lastTo` 或 `deliveryContext.to` 读取 channel-native target。
3. 用 `parseImConversationId()` 解析 peer id，并以小写形式比较。
4. 匹配成功后返回原始 `to` 和可选 `accountId`。
5. 多个候选时优先选指定账号，其次选最新 `updatedAt`。

### 4.2 Popiai 侧：历史任务运行前迁移

`src/main/ipcHandlers/scheduledTask/handlers.ts` 中的 `buildAnnounceNormalizationPatch()` 在手动运行前构造 patch。

修复策略：

- 先执行本地 announce delivery normalization。
- 如果 normalized `delivery.to` 是全小写值，调用 `restoreAnnounceDeliveryHintsFromGateway(..., { casingOnly: true })`。
- 如果恢复后的 `delivery` 与原任务不同，则调用 `cron.update` patch OpenClaw job。
- 然后再调用 `cron.run`。

这样既能修复微信，也能覆盖其他潜在大小写敏感 IM 平台。

### 4.3 Popiai 侧：避免历史迁移改路由账号

历史修复只处理大小写，不应该改变任务绑定的账号。

因此 `restoreAnnounceDeliveryHintsFromGateway()` 在 `casingOnly=true` 时：

- 可以使用 session hints 恢复 `delivery.to`。
- 不补充 `delivery.accountId`。

这样可以避免历史任务从“无账号路由”或“指定账号路由”被迁移成另一个账号。

### 4.4 OpenClaw / 插件侧：投递结果语义修复

微信插件发送完成后应解析 JSON body：

- `ret` 不存在或明确成功：可视为成功。
- `ret !== 0`：视为失败。
- 失败时应把 `ret` 和原始 body 写入 delivery error。

cron delivery 层收到失败后应记录：

```text
delivery_status=failed
delivered=0
delivery_error=<ret/body>
```

不能继续记录为 `delivered=1`。

## 5. 边界情况

| 场景 | 处理方式 |
|------|---------|
| gateway 未运行 | 跳过大小写恢复，保持原值 |
| `sessions.list` 无匹配 row | 跳过大小写恢复，保持原值 |
| 多个账号有同一 peer | 新建 / 更新路径优先 selected account；历史 casing-only 不改 account routing |
| gateway row 中 `lastTo` 是小写污染值 | 按 `updatedAt` 优先最新会话；找不到更好候选时不一定能修复 |
| 平台 target 本身就是小写 | 恢复逻辑匹配后得到相同值，不产生 patch |
| 群聊 native id 只存在 origin metadata | 继续保留 `resolveGroupDeliveryTargetFromSessions()` 的群聊恢复逻辑 |
| HTTP 200 但 body 失败 | 插件侧必须按业务码记录 delivery failed |

## 6. 涉及文件

Popiai 已涉及：

- `src/main/ipcHandlers/scheduledTask/helpers.ts`
- `src/main/ipcHandlers/scheduledTask/handlers.ts`
- `src/main/ipcHandlers/scheduledTask/helpers.test.ts`
- `src/main/ipcHandlers/scheduledTask/handlers.test.ts`

OpenClaw / 插件侧待修：

- `openclaw-weixin` send message result handling
- cron delivery status recording path

## 7. 验收标准

### 7.1 自动化测试

运行：

```bash
npx vitest run src/main/ipcHandlers/scheduledTask/helpers.test.ts src/main/ipcHandlers/scheduledTask/handlers.test.ts
```

期望：

- helpers 测试通过。
- handlers 测试通过。
- 覆盖微信历史任务大小写恢复。
- 覆盖泛 IM channel 历史任务大小写恢复。
- `casingOnly=true` 不新增 `accountId`。

### 7.2 手动验证

1. 准备一个历史微信定时任务，其 `delivery.to` 为小写 user id。
2. 手动运行任务。
3. 观察 gateway 日志出现 `cron.update`。
4. 查询 OpenClaw SQLite：

```sql
select job_id, delivery_channel, delivery_to, delivery_account_id
from cron_jobs
where job_id = '<job-id>';
```

期望 `delivery_to` 恢复为原始大小写。

5. 查看微信插件日志：

```text
sendMessage status=200 raw={}
```

不应再出现本次 run 的：

```text
contextToken missing
sendMessage status=200 raw={"ret":-3}
```

6. 查询 run log：

```sql
select status, delivery_status, delivered, delivery_error
from cron_run_logs
where session_id = '<run-session-id>';
```

期望：

```text
status=ok
delivery_status=delivered
delivered=1
delivery_error is empty
```

### 7.3 回归验证

- 新建微信定时任务时，`delivery.to` 直接保存为原始大小写。
- 已有微信定时任务运行前会自动修复小写 target。
- 钉钉 / 企微群聊 target 恢复逻辑不回退。
- 其他 IM 平台如果 gateway session 中存在原始大小写 target，也会被恢复。
