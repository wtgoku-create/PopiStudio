# PopiTV MCP HTTP 接入改动总结

## 背景

PopiTV 画布工具之前的执行链路较长，并且和通用的 `McpBridgeServer` `/execute` 入口耦合。现在的优化方向是：

- `McpBridgeServer` 只负责 AskUser `/askuser`。
- PopiTV 画布工具使用独立的本地 MCP HTTP 服务。
- PopiTV 以内置 HTTP MCP 的形式注册到 OpenClaw。
- 画布请求按 cowork `sessionId` 定向到对应 renderer，不再默认广播到所有窗口。
- 主进程缓存画布快照，让 `read_canvas` 默认走缓存，减少 iframe 往返。

## 当前执行流程

1. Electron main 启动 `McpBridgeServer`，只处理 AskUser。
2. Electron main 启动 `PopiTVToolBridgeServer`，监听 `http://127.0.0.1:<port>/mcp`。
3. `getResolvedMcpServers()` 将 PopiTV 注册到 OpenClaw：

```ts
{
  name: 'popitv',
  transportType: 'http',
  url: popiTvMcpUrl,
  headers: {
    'x-mcp-bridge-secret': '${LOBSTER_MCP_BRIDGE_SECRET}',
  },
}
```

4. `openclawConfigSync` 写入 OpenClaw 配置时会把 HTTP MCP 转成 `transport: 'streamable-http'`。
5. OpenClaw 通过 MCP JSON-RPC 调用 PopiTV：

- `initialize`
- `tools/list`
- `tools/call`
- `ping`

6. `tools/call` 分发到 `executePopiTVMcpTool()`。
7. 只有需要真实操作 iframe 时，才通过 `requestPopiTVCanvasFromRenderer()` 进入 renderer。

## 主要改动

### 独立 PopiTV MCP HTTP 服务

`src/main/libs/popiTVToolBridgeServer.ts` 现在是本地 MCP HTTP endpoint，不再是自定义 `/execute` bridge。

支持能力：

- `POST /mcp`
- JSON-RPC `initialize`
- JSON-RPC `tools/list`
- JSON-RPC `tools/call`
- JSON-RPC `ping`
- 通过 `x-mcp-bridge-secret` 校验本地请求

内置 PopiTV 注册不再需要 stdio wrapper，也不再依赖 `popiTVMcpStdioServer.js`。

### OpenClaw 注册改为 HTTP MCP

`src/main/main.ts` 里 PopiTV 内置 MCP 注册已改为：

- 使用 `popiTVToolBridgeServer.mcpUrl`
- `transportType: 'http'`
- 通过 headers 传 `x-mcp-bridge-secret`
- 不再构造 `popiTVMcpStdioServer.js` 路径

说明：`main.ts` 中仍然保留普通用户自定义 MCP 的 `transportType: 'stdio'` 分支，这不是 PopiTV 内置注册路径。

### AskUser 与 PopiTV 解耦

`src/main/libs/mcpBridgeServer.ts` 现在只处理 AskUser：

- `POST /askuser`
- AskUser timeout/dismiss
- 不再处理 PopiTV `/execute`
- 不再保存 local tool handler

这样 AskUser 和 PopiTV 工具链路职责分离。

### Renderer 按 session 定向路由

`src/main/libs/popiTVRendererBridge.ts` 维护 `sessionId -> webContents.id` 映射。

renderer 通过 preload 注册和注销：

- `popitv:register-session`
- `popitv:unregister-session`

带 `sessionId` 的工具请求会优先发给对应 renderer 窗口，不再广播给所有窗口。没有注册目标或没有 `sessionId` 时，保留 fallback 行为。

### 主进程画布快照缓存

主进程按 session 保存最近一次 PopiTV 画布快照。

renderer 收到以下事件时同步到 main：

- `popitv:ready`
- `popitv:snapshot`

新增 preload API：

- `window.electron.popitv.updateSnapshot(sessionId, snapshot)`
- `window.electron.popitv.clearSnapshot(sessionId)`

`read_canvas` 默认优先返回主进程缓存。只有传 `refresh: true` 时才绕过缓存，重新请求 iframe 获取实时快照。

## 工具行为

PopiTV MCP 暴露以下工具：

- `read_canvas`
- `edit_canvas`
- `run_canvas`
- `stop_canvas`

`read_canvas` 参数现在支持：

```json
{
  "sessionId": "可选 cowork session id",
  "refresh": true
}
```

默认情况下，`refresh` 为空或 false 时会优先读取缓存。

## 安全点

- MCP HTTP 服务只绑定 `127.0.0.1`。
- 请求必须带 `x-mcp-bridge-secret`。
- OpenClaw 通过 `${LOBSTER_MCP_BRIDGE_SECRET}` 获取 secret。
- PopiTV iframe CSP 已允许 `https://canvas.popi.art`。

## 验证结果

已通过：

```bash
npx tsc --project electron-tsconfig.json --noEmit
npx vitest run src/main/libs/popiTVToolBridgeServer.test.ts src/main/libs/popiTVMcpBridgeTools.test.ts src/main/libs/mcpBridgeServer.test.ts
```

测试结果：

- 3 个测试文件通过
- 16 个测试通过

## 仍需注意

- 全量 renderer `npx tsc --noEmit` 仍有 artifacts/settings 相关既有类型错误，和本次 PopiTV MCP 改动无关。
- PopiTV 内置 MCP 已不走 stdio；用户自定义 stdio MCP 能力仍保留。
