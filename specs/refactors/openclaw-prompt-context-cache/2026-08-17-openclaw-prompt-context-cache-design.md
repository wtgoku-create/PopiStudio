# OpenClaw 系统上下文注入与 Prompt Cache 适配设计文档

## 1. 概述

### 1.1 问题/动机

Popi Studio 使用 OpenClaw `v2026.6.1` 作为 Agent 引擎。此前桌面 Cowork 适配层将静态系统规则、每轮动态规则和用户请求拼接到同一个用户消息中，带来以下问题：

- 系统规则被重复写入用户消息，污染对话语义和 transcript。
- 每轮变化的规则可能改变模型请求的稳定前缀，降低 provider Prompt Cache 命中率。
- 应用更新 `AGENTS.md` 后，容易误以为必须自行清理 OpenClaw 内部缓存。
- 通过客户端自维护“上一次已经注入的 system prompt”会与 OpenClaw 原生 session/context 生命周期重复，存在状态漂移风险。

### 1.2 根因

根因是 Popi 适配层没有区分三类内容的所有权和生命周期：

| 内容 | 生命周期 | 正确位置 |
|------|----------|----------|
| `AGENTS.md`、`SOUL.md` 等静态 Agent 规则 | 工作区级、跨 turn 稳定 | OpenClaw bootstrap/workspace |
| 本轮临时规则、计划模式指令、运行时约束 | 当前 turn 或当前请求 | `chat.send.extraSystemPrompt` |
| 用户实际请求 | 当前消息、需要进入 transcript | `chat.send.message` |

把后两者混入 `message`，或者把动态规则放在稳定 system prompt 前缀，会同时破坏消息语义和 Prompt Cache 稳定性。

## 2. 目标与非目标

### 2.1 目标

1. 用户请求始终作为 `chat.send.message` 发送。
2. 静态系统规则继续由 OpenClaw 从 bootstrap 文件加载。
3. 动态系统规则通过受控的 `chat.send.extraSystemPrompt` 传递。
4. 动态规则位于 OpenClaw system prompt cache boundary 之后，尽量保留稳定前缀。
5. `AGENTS.md` 更新后由 OpenClaw 原生机制在下一轮重新读取。
6. 保留 `chat.send` 的队列、停止、重连、事件和 transcript 行为。
7. 不因普通应用更新主动 reset 会话，避免丢失会话连续性。

### 2.2 非目标

- 不在 Popi 中新增独立的 Prompt Cache 实现。
- 不在每次应用启动时清理所有 OpenClaw session 或 bootstrap cache。
- 不把动态规则持久化到用户 transcript。
- 不修改 provider 自己的缓存策略、TTL 或 cache key 生成规则。
- 不在正在执行的 turn 中途替换已经提交给模型的 system prompt。

## 3. OpenClaw 原生机制

### 3.1 Bootstrap 文件刷新

OpenClaw `v2026.6.1` 已提供按 session 的 bootstrap snapshot cache。`getOrLoadBootstrapFiles()` 每个 turn 都会重新调用工作区加载器；文件内容、文件顺序或 source identity 变化时替换快照。

工作区文件加载器按文件的 `dev`、`inode`、`size` 和 `mtime` 等身份复用未变化内容。正常编辑或原子替换 `AGENTS.md` 会触发下一轮重新读取。

因此，Popi 更新 `AGENTS.md` 后不需要自行实现 hash 轮询或清理 OpenClaw bootstrap cache。

### 3.2 System prompt cache boundary

OpenClaw 原生将系统提示词划分为稳定前缀和动态后缀：

```text
稳定系统提示词
<system-prompt-cache-boundary>
日期、频道、会话和本轮动态上下文
```

稳定内容变化时，provider 重新建立缓存前缀是预期行为；动态后缀变化不应反复破坏稳定前缀。

### 3.3 Session prompt 漂移

对于支持复用的 CLI session，OpenClaw 会比较 system prompt 相关 hash。发生内容漂移时，优先尝试复用 transcript 并更新 prompt；后端不支持动态更新时再重启对应 CLI session。

`/reset` 会清理 CLI session 和 bootstrap snapshot，适合用户明确要求重新开始，不适合作为普通规则更新的默认动作。

### 3.4 生效时机

| 场景 | 处理方式 |
|------|----------|
| `AGENTS.md` 在发送下一条消息前更新 | 下一轮读取最新内容 |
| 动态 `extraSystemPrompt` 变化 | 只影响当前 turn |
| 更新发生在模型请求已经开始之后 | 不影响当前 turn |
| 需要立即丢弃当前会话上下文 | 用户主动执行 `/reset` |

## 4. 方案设计

### 4.1 消息分层

Popi 适配器构造请求时使用以下分层：

```text
chat.send.message
└── 用户实际请求

chat.send.extraSystemPrompt
├── 稳定的 Popi system prompt（未由 AGENTS.md 管理的部分）
└── 本轮动态规则

OpenClaw workspace/bootstrap
└── AGENTS.md、SOUL.md、IDENTITY.md、USER.md 等静态规则
```

用户请求不得再次包含 system prompt、turn instructions 或规则替换说明。

### 4.2 动态规则顺序

Popi 适配器内部按以下顺序组合额外 system prompt：

```text
稳定 system prompt
-> 当前 turn 的动态 instructions
```

OpenClaw 侧则保证动态 channel/session metadata 位于 cache boundary 之后。这样动态规则变化不会改变用户消息，也不会无条件改变稳定缓存前缀。

### 4.3 权限与大小限制

`chat.send.extraSystemPrompt` 由 OpenClaw schema 限制最大长度 `100_000` 字符，并要求调用方具备 `operator.admin` scope。Popi 只发送已清理 null 字符的内容，并在空内容时省略该字段。

### 4.4 工作区更新

Popi 的 bootstrap 文件写入仍使用现有 workspace 写入和配置同步链路：

1. 写入对应 Agent 的 OpenClaw workspace 文件。
2. 触发现有 OpenClaw 配置同步。
3. 下一轮 `chat.send` 由 OpenClaw 原生 bootstrap loader 检查文件变化。
4. 不主动 reset session，不主动删除 provider cache。

## 5. 实施内容

### 5.1 OpenClaw patch

新增 `chat.send.extraSystemPrompt` 适配 patch，包含：

- gateway `chat.send` schema 字段。
- `GetReplyOptions` 和 reply runner 的参数透传。
- `chat.send` admin scope 校验。
- agent runner 的额外 system prompt 注入。
- 稳定内容与动态内容的 cache boundary 顺序调整。

Patch 文件：

```text
scripts/patches/v2026.6.1/zz-openclaw-chat-send-extra-system-prompt.patch
```

### 5.2 Popi 适配器

修改 `OpenClawRuntimeAdapter`：

- `CoworkContinueOptions` 增加 `extraSystemPrompt`。
- `continueSession()` 将该字段传入 `chat.send`。
- `buildOutboundPrompt()` 返回 `{ message, extraSystemPrompt }`。
- 删除客户端按 session 维护的 `lastSystemPromptBySession` 状态。
- 不再把 turn instructions 拼入用户消息。

### 5.3 应用更新行为

应用内更新 `AGENTS.md`、skill 规则或其他 bootstrap 内容时，复用 OpenClaw 原生刷新机制。只有用户明确执行 reset 或确实需要丢弃会话上下文时，才使用 reset 流程。

## 6. 边界情况

| 场景 | 处理方式 |
|------|----------|
| 静态规则内容发生变化 | 下一轮读取新内容，provider 稳定前缀重新缓存一次 |
| 动态规则每轮变化 | 放在额外 system prompt 动态段，不进入用户消息 |
| 动态规则为空 | 省略 `extraSystemPrompt` 字段 |
| 规则超过最大长度 | OpenClaw schema 拒绝请求，Popi 不绕过限制 |
| 非管理员调用动态 system prompt | OpenClaw 返回权限错误 |
| 当前 turn 已经开始时更新文件 | 当前 turn 保持原上下文，下一轮生效 |
| 文件被删除 | OpenClaw 下一轮按 bootstrap 文件缺失状态处理 |
| CLI 后端不支持在线 prompt 更新 | OpenClaw 按原生 session 漂移策略重建后端 session |
| 应用启动但规则未变化 | 复用原生 cache，不执行额外清理 |

## 7. 涉及文件

### Popi Studio

- `src/main/libs/agentEngine/openclawRuntimeAdapter.ts`
- `src/main/libs/agentEngine/openclawRuntimeAdapter.test.ts`
- `src/main/libs/agentEngine/types.ts`
- `src/main/main.ts`
- `scripts/patches/v2026.6.1/zz-openclaw-chat-send-extra-system-prompt.patch`

### OpenClaw 原生参考

- `src/agents/bootstrap-cache.ts`
- `src/agents/workspace.ts`
- `src/agents/system-prompt.ts`
- `src/agents/cli-session.ts`
- `src/auto-reply/reply/commands-reset.ts`

## 8. 验证计划与结果

### 8.1 验证项目

- 在干净 OpenClaw `v2026.6.1` 源码上先应用 cwd patch，再检查本 patch。
- 检查 `chat.send.message` 不包含 system prompt 和 turn instructions。
- 检查 `chat.send.extraSystemPrompt` 包含静态额外规则和当前 turn 动态规则。
- 检查静态规则和动态规则的组合顺序。
- 执行 Electron TypeScript 编译。
- 执行 OpenClaw runtime adapter focused tests。

### 8.2 当前验证结果

- OpenClaw 两阶段 patch check 通过。
- Electron TypeScript 编译通过。
- Adapter focused tests：`121 passed`，另有 `1` 个既有 timer/retry 测试失败，与本次提示词注入修改无关。
- Popi 工作区 `git diff --check` 通过。

## 9. 验收标准

1. 用户请求只出现在 `chat.send.message`。
2. 动态规则只通过 `chat.send.extraSystemPrompt` 传递。
3. `AGENTS.md` 更新后无需重启 Gateway，下一轮能读取新内容。
4. 普通规则更新不清理会话历史、不主动 reset session。
5. 动态规则变化不会导致用户消息 transcript 膨胀。
6. 静态 system prompt 与动态 turn instructions 顺序稳定。
7. 管理员权限和 `100_000` 字符上限由 OpenClaw 原生 schema/handler 执行。
8. 原有 stop、queue、重连、事件和 transcript 行为保持不变。
