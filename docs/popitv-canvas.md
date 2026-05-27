# PopiTV 画布说明

本文档记录 PopiStudio 中 PopiTV 画布的职责边界、运行链路和关键文件位置。画布用于把视觉媒体制作流程放进 Cowork 会话，让 Agent 可以读取画布状态、编辑节点、运行工作流，并把结果回写到当前会话上下文。

## 功能边界

- 画布只在启用 `popitv` skill 的 Cowork 会话中显示。
- 画布以 session 为边界隔离状态，工具请求优先路由到对应 `sessionId` 的画布。
- Agent 不能直接假设画布状态，必须依赖 `<popitv_canvas_context>` 或结构化工具返回结果。
- 画布工具只负责读取、编辑、运行、停止工作流，不替代图像、视频、音频模型本身。

## 用户侧入口

`src/renderer/components/cowork/CoworkSessionDetail.tsx` 根据当前会话的 `activeSkillIds` 或消息 metadata 判断是否是 PopiTV 会话。命中 `popitv` 后，会在聊天区旁边渲染 `PopiTVCanvasWorkspace`。

`src/renderer/components/cowork/PopiTVCanvasWorkspace.tsx` 负责嵌入画布 iframe：

- iframe 地址固定指向 `http://localhost:3000`，并带上 `embed=popiai`、`sessionId`、`parentOrigin`。
- 通过 `window.postMessage` 和画布通信。
- 维护 bridge ready、pending request、snapshot 和错误状态。
- 把最新 snapshot 写入 renderer 内存，供下一轮 Cowork prompt 注入。

## Agent 上下文

`src/renderer/services/popitvCanvasContext.ts` 保存每个 session 的最近一次画布快照，并生成 `<popitv_canvas_context>` 块。

上下文包含：

- session id
- snapshot 是否可用
- workflow id/name
- node/edge 数量
- 当前运行节点
- unsaved 状态
- 最多 20 个节点摘要
- 最多 40 条边摘要

`src/renderer/components/cowork/CoworkView.tsx` 在提交 prompt 前调用 `appendPopiTVCanvasContext`。如果当前会话启用了 `popitv`，上下文会追加到 skill prompt 中，让 Agent 在回复前知道当前画布状态。

## 工具链路

PopiTV 工具链路分为 main process bridge 和 renderer canvas router 两层。

### Main process bridge

关键文件：

- `src/main/libs/mcpBridgeServer.ts`
- `src/main/libs/popiTVMcpBridgeTools.ts`
- `src/main/libs/popiTVRendererBridge.ts`
- `src/main/preload.ts`

`mcpBridgeServer` 暴露本地 HTTP callback：

- `/askuser` 用于 AskUserQuestion 权限弹窗。
- `/execute` 用于本地 PopiTV canvas tool 调用。

`popiTVMcpBridgeTools` 定义 `popitv` server 下的工具 manifest：

- `read_canvas`
- `edit_canvas`
- `run_canvas`
- `stop_canvas`

这些工具会转换为 renderer bridge request，再通过 IPC 发送给当前窗口。

### Renderer canvas router

关键文件：

- `src/renderer/services/popitvCanvasToolRouter.ts`
- `src/renderer/components/cowork/PopiTVCanvasWorkspace.tsx`
- `src/renderer/types/electron.d.ts`

`popitvCanvasToolRouter` 接收 main process 的 IPC 工具请求后，按 `sessionId` 寻找已经打开的画布 handler：

- 有 `sessionId` 时，优先发给对应会话画布。
- 没有 `sessionId` 时，只有当前仅存在一个打开画布才会路由。
- 如果画布未打开，会尝试通过 auto-open handler 打开对应会话画布。
- 仍不可用时，返回明确错误，避免 Agent 假装工具执行成功。

## 编辑操作规范

Agent 应优先使用结构化 `edit_canvas` 操作，而不是输出自然语言让用户手工改画布。

常用 operation：

```json
{
  "type": "addNode",
  "nodeType": "nanoBanana",
  "nodeId": "shot-1-image",
  "position": { "x": 120, "y": 160 },
  "data": {
    "customTitle": "Shot 1 Image",
    "inputPrompt": "2D cartoon Alice on a sunny Hawaii beach",
    "aspectRatio": "9:16"
  }
}
```

支持的节点类型包括：

- `prompt`
- `nanoBanana`
- `generateVideo`
- `generateAudio`
- `generate3d`
- `llmGenerate`

`popiTVMcpBridgeTools` 会规范化常见别名，例如 `image_generation`、`text2image`、`generatevideo` 等。对生成节点，如果 `data.inputPrompt` 内联存在，bridge 会自动展开为 `prompt` 节点、生成节点和连接边。

## Skill 约束

`SKILLs/popitv/SKILL.md` 是 Agent 使用画布时的行为约束：

- 先读取画布，再编辑。
- 运行后再次读取结果。
- 汇报实际节点、边、输出和错误。
- 工具不可用时，只能给计划，不能声称已修改画布。

## 验证建议

改动画布链路后，优先运行：

```bash
npm run compile:electron
npx tsc --noEmit
npm test -- popiTV
```

如果只改 main process bridge，可先跑：

```bash
npx tsc --project electron-tsconfig.json --noEmit
```

