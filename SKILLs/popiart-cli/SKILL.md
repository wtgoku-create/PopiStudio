---
name: popiart-cli
description: Use PopiArt to discover and run creator skills for image, video, animation, audio, jobs, artifacts, budgets, model routing, and per-project context. Use when the user mentions popiart, popiskill-*, skillhub.popi.art, or asks to generate or transform multimodal content such as text-to-image, img2img, image-to-video, TTS, music, upscaling, or job/artifact management.
official: true
version: 1.0.0
app: popistudio
---

# PopiArt CLI

使用 `popiart` 作为 PopiArt 创作工作流的 Agent 运行时入口。CLI 处理认证、技能发现、任务编排、产物传输、预算、路由和 MCP 可发现性。

## 配置

- **API Key**: 从环境变量 `POPIART_KEY` 读取
- **认证方式**: `popiart --endpoint https://server.popi.art/v1 auth login --key $POPIART_KEY`

### 如何配置 API Key

**方式一：通过环境变量配置（推荐）**

```powershell
# Windows PowerShell
$env:POPIART_KEY="你的Product Key"

# 或者设置系统环境变量以永久生效
[System.Environment]::SetEnvironmentVariable('POPIART_KEY', '你的Product Key', 'User')
```

```bash
# macOS/Linux
export POPIART_KEY="你的Product Key"
```

**方式二：通过 PopiStudio 启动时注入**

PopiStudio 会自动从系统环境变量读取 `POPIART_KEY`。

**如何获取 Product Key：**
1. 访问 skillhub.popi.art
2. 登录并获取 Product Key
3. 设置为环境变量 POPIART_KEY

## 安装

首先安装 CLI：

```powershell
# Windows (PowerShell)
irm https://raw.githubusercontent.com/wtgoku-create/popiartcli/main/install.ps1 | iex
```

```bash
# macOS / Linux
brew tap wtgoku-create/popi
brew install wtgoku-create/popi/popiart
# 或者
curl -fsSL https://raw.githubusercontent.com/wtgoku-create/popiartcli/main/install.sh | sh
```

然后初始化本地 Agent 集成：

```bash
popiart setup --agent openclaw --completion bash
```

## 前置检查

使用此 skill 前，Agent 必须验证认证状态：

```bash
popiart auth whoami
```

如果认证失败，需要先登录：

```bash
popiart --endpoint https://server.popi.art/v1 auth login --key $POPIART_KEY
```

再次验证：

```bash
popiart auth whoami
popiart auth key show
```

## 输出约定

默认 stdout 是 JSON：

```json
{ "ok": true, "data": {} }
```

失败时使用：

```json
{ "ok": false, "error": { "code": "VALIDATION_ERROR", "message": "..." } }
```

在 Agent 或 CI 上下文中，推荐使用：

```bash
--output json --quiet --non-interactive
```

常用全局标志：

| 标志 | 用途 |
|---|---|
| `--output json` | 稳定的机器可读输出 |
| `--output plain` | 人类可读输出 |
| `--quiet` | 抑制非结果输出 |
| `--non-interactive` | 失败而不是提示 |
| `--dry-run` | 预览规范化请求而不执行网络写入 |
| `--async` | 立即返回 job |
| `--wait` | 阻塞直到 job 达到终态 |

## 意图命令

### 文生图

```bash
popiart image generate \
 --prompt "a sunset over Tokyo, cinematic, 35mm" \
 --aspect-ratio 16:9 \
 --wait \
 --output json \
 --quiet \
 --non-interactive
```

### 图生图

```bash
popiart image img2img \
 --image ./source.png \
 --prompt "Keep the subject, recolor to dusk cinematic" \
 --strength 0.6 \
 --wait \
 --output json \
 --quiet \
 --non-interactive
```

### 图生视频

```bash
popiart video generate \
 --image ./source.png \
 --prompt "Hair and fabric drift in a soft breeze; slow camera push-in" \
 --duration 5 \
 --wait \
 --output json \
 --quiet \
 --non-interactive
```

### 动作迁移

```bash
popiart video action-transfer \
 --image ./face.jpg \
 --video https://example.com/source-action.mp4 \
 --cut-result-first-second-switch \
 --wait \
 --output json \
 --quiet \
 --non-interactive
```

### 语音合成

```bash
popiart speech synthesize \
 --text "今天我们要构建一个 CLI 工具" \
 --voice narrator_female \
 --format mp3 \
 --output json \
 --quiet \
 --non-interactive
```

### 音乐生成

```bash
popiart music generate \
 --prompt "Upbeat pop" \
 --lyrics "La la la" \
 --output-format url \
 --format mp3 \
 --output json \
 --quiet \
 --non-interactive
```

## 平台命令

当 Agent 需要精确控制时使用：

```bash
popiart skills list --search "image upscale" --output json --quiet --non-interactive
popiart skills get <skill-id> --output json --quiet --non-interactive
popiart run <skill-id> --input @params.json --wait --output json --quiet --non-interactive
popiart jobs wait <job-id> --output json --quiet --non-interactive
popiart artifacts pull-all <job-id> --dir ./results --output json --quiet --non-interactive
```

## 预算和项目

```bash
popiart budget status --output json --quiet --non-interactive
popiart budget usage --group-by skill --output json --quiet --non-interactive
popiart project current --output json --quiet --non-interactive
popiart models list --output json --quiet --non-interactive
```

## 错误处理

常见 `error.code` 值：

| 代码 | Agent 响应 |
|---|---|
| `UNAUTHENTICATED` | 停止并要求用户运行 `popiart --endpoint https://server.popi.art/v1 auth login` |
| `FORBIDDEN` | 停止；显示权限或项目问题 |
| `NOT_FOUND` | 重新检查 ids |
| `VALIDATION_ERROR` | 修复无效字段后重试 |
| `RATE_LIMITED` | 退避后重试 |
| `JOB_FAILED` | 显示提供商详情；不要盲目重试 |
| `POLL_TIMEOUT` | 继续等待同一个 job id |
| `NETWORK_ERROR` | 退避重试 |
| `SERVER_ERROR` | 重试一次；如果持续存在则显示问题 |

## 反模式

- 不要在存在 PopiArt skill 或命令时直接调用上游提供商
- 不要在低级别 `run --input` 中内联本地文件路径；先上传
- 不要循环 `sleep + jobs get`；使用 `jobs wait`
- 不要在 `POLL_TIMEOUT` 后重新运行 job；在同一个 job id 上等待
- 不要假设预算、价格、路由或可用模型；查询它们
- 不要回显或提交 `pk-...` 密钥
