# PopiStudio

<p align="center">
  <img src="public/logo.png" alt="Popiai" width="120">
</p>

<p align="center">
  <strong>Popiai 的跨平台桌面工作台，基于 OpenClaw 驱动 AI Cowork Agent。</strong>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="MIT License"></a>
  <br>
  <img src="https://img.shields.io/badge/Platform-macOS%20%7C%20Windows%20%7C%20Linux-brightgreen?style=for-the-badge" alt="Platform">
  <br>
  <img src="https://img.shields.io/badge/Electron-40-47848F?style=for-the-badge&logo=electron&logoColor=white" alt="Electron">
  <img src="https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react&logoColor=black" alt="React">
</p>

<p align="center">
  <a href="README.md">English</a> · 中文
</p>

---

**PopiStudio** 是 **Popiai** 的桌面应用。它为 Popiai 提供一个本地、可监督的
AI 工作台：可以对话、运行工具、操作文件、执行命令、预览生成结果、管理技能，
也可以处理定时任务和 IM 触发的任务。

项目基于 Electron、React、TypeScript、Tailwind CSS、SQLite 和 OpenClaw 构建，
目标是同时支持 macOS、Windows、Linux 三端桌面分发。

## 核心能力

- **Cowork Agent 会话**：启动 AI 工作会话，流式展示进度，持久化保存会话历史。
- **本地工作区执行**：Agent 可在用户选择的目录中工作；敏感文件、终端、网络动作
  通过权限弹窗确认。
- **Artifacts 预览**：在独立面板中预览 HTML、SVG、Mermaid、React 和代码输出。
- **技能系统**：内置 Web 搜索、Office 文档生成、PDF 处理、Playwright 自动化、
  多媒体工具等可复用工作流。
- **定时任务**：支持创建周期任务，并绑定 Cowork 会话或 IM 投递路径。
- **IM 集成**：支持微信、企业微信、钉钉、飞书、QQ、Telegram、Discord、
  网易云信、网易灵犀办公、POPO 等外部通道。
- **本地持久化**：应用配置、认证 token、Cowork 会话和任务元数据保存在本地 SQLite。
- **全平台打包**：同一套代码支持 macOS、Windows、Linux 安装包构建。

## 平台产物

| 平台 | 构建命令 | 产物 |
| --- | --- | --- |
| macOS | `npm run dist:mac` | `.dmg` |
| macOS Intel | `npm run dist:mac:x64` | x64 `.dmg` |
| macOS Apple Silicon | `npm run dist:mac:arm64` | arm64 `.dmg` |
| macOS Universal | `npm run dist:mac:universal` | universal `.dmg` |
| Windows | `npm run dist:win` | NSIS `.exe` 安装包 |
| Linux | `npm run dist:linux` | AppImage 和 Debian 包 |

打包使用 `public/icons` 和 `build/icons` 中的 Popiai 图标资源。

## 快速开始

### 环境要求

- Node.js `>=24 <25`
- npm

### 安装与运行

```bash
git clone https://github.com/wtgoku-create/PopiStudio.git
cd PopiStudio

npm install
npm run electron:dev
```

Vite 开发服务器默认运行在 `http://localhost:5175`。

`npm run electron:dev` 会同时启动 Vite Renderer 和 Electron Main Process，
并支持开发热重载。

### OpenClaw Runtime

OpenClaw 是主要 Agent 运行时，锁定版本写在 `package.json` 的
`openclaw.version` 字段中。

```bash
# 构建或复用锁定版本的 OpenClaw runtime，然后启动开发应用
npm run electron:dev:openclaw

# 后续运行：如果锁定版本未变，自动跳过构建
npm run electron:dev:openclaw
```

常用环境变量：

```bash
# 使用本地 OpenClaw 源码目录
OPENCLAW_SRC=/path/to/openclaw npm run electron:dev:openclaw

# 强制重新构建 runtime
OPENCLAW_FORCE_BUILD=1 npm run electron:dev:openclaw

# 跳过自动 checkout/版本切换
OPENCLAW_SKIP_ENSURE=1 npm run electron:dev:openclaw
```

## 开发命令

```bash
# 仅启动 Renderer
npm run dev

# 启动 Electron 开发应用
npm run electron:dev

# TypeScript + 生产构建
npm run build

# 仅编译 Electron 主进程
npm run compile:electron

# 运行 Vitest
npm test

# 运行 ESLint
npm run lint
```

## 打包分发

完整分发流程会构建 Renderer、Electron 主进程、技能、平台 runtime 资源和安装包。

```bash
# 当前平台目录包
npm run pack

# 当前平台安装包
npm run dist

# 指定平台安装包
npm run dist:mac
npm run dist:win
npm run dist:linux

# 渠道包
# macOS - 仅 Intel
KEYFROM=xxx npm run dist:mac:x64

# macOS - 仅 Apple Silicon
KEYFROM=xxx npm run dist:mac:arm64

# Windows (.exe NSIS 安装包)
npx cross-env KEYFROM=xxx npm run dist:win
```

```bash
# 渠道包
# macOS - 仅 Intel
KEYFROM=baidu npm run dist:mac:x64

# macOS - 仅 Apple Silicon
KEYFROM=baidu npm run dist:mac:arm64

# Windows (.exe NSIS 安装包)
npx cross-env KEYFROM=baidu npm run dist:win
```


桌面安装包会将准备好的 OpenClaw runtime 内置到 `Resources/cfmind`。
Windows 安装包还可以内置便携 Python runtime 到 `resources/python-win`。

离线或私有构建环境可通过以下变量覆盖 Python runtime 来源：

- `POPIAI_PORTABLE_PYTHON_ARCHIVE`
- `POPIAI_PORTABLE_PYTHON_URL`
- `POPIAI_WINDOWS_EMBED_PYTHON_VERSION`
- `POPIAI_WINDOWS_EMBED_PYTHON_URL`
- `POPIAI_WINDOWS_GET_PIP_URL`

## 架构说明

PopiStudio 使用 Electron 严格进程隔离。Renderer 不直接访问 Node.js；
所有高权限操作都通过 Preload 暴露的 IPC API 完成。

### Main Process

`src/main/main.ts`

- 窗口生命周期管理
- SQLite 持久化
- 认证与 API 代理
- OpenClaw runtime 生命周期
- Cowork 引擎路由
- IM 网关管理
- 技能管理
- 定时任务集成

### Preload

`src/main/preload.ts`

- 通过 `contextBridge` 暴露安全的 `window.electron` API
- 提供 Cowork 流式事件监听和 IPC 封装

### Renderer

`src/renderer/`

- React UI
- Redux 状态切片
- Settings、Cowork、Artifacts、Skills、IM、定时任务等视图
- i18n 和 API service 封装

## 目录结构

```text
src/main/                  Electron 主进程和高权限服务
src/renderer/              React Renderer 应用
src/shared/                共享常量与类型
src/scheduledTask/         定时任务领域逻辑
SKILLs/                    内置 Popiai 技能
openclaw-extensions/       本地 OpenClaw 扩展插件
scripts/                   构建、runtime、打包和 patch 脚本
build/icons/               平台打包图标
public/icons/              Popiai 图标资源包
resources/                 打包资源
tests/                     Node 集成和回归测试
specs/                     设计说明与实现规格
```

补充实现文档：

- PopiTV 画布架构与工具路由说明：[`docs/popitv-canvas.md`](docs/popitv-canvas.md)

## 品牌信息

- 产品名：**Popiai**
- 仓库/桌面工作台：**PopiStudio**
- App ID：`popiai`
- 桌面 URL Scheme：`popiai://`
- 本地数据库：`popiai.sqlite`

OpenClaw provider 层中保留的 `lobster` 等 fallback ID 是兼容性标识，
不是产品品牌名。

## License

MIT。详见 [LICENSE](LICENSE)。
