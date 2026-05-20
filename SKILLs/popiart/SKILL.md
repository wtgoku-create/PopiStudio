---
name: popiart
description: "Use the built-in PopiArt CLI for image, video, speech, music, jobs, artifacts, and media workflows. Use this when the user wants to generate or transform visual/audio media."
official: true
version: 2.1.0
---

# PopiArt CLI

使用内置的 PopiArt CLI 处理图片、视频、语音、音乐、任务查询和产物下载。

## 核心约束

- **始终使用 `popiart` CLI**：优先使用 `popiart image generate`、`popiart image img2img`、`popiart video generate`、`popiart video seedance`、`popiart speech synthesize`、`popiart music generate`。
- **不要运行 `popiart auth`**：登录由 Settings 页面和主进程自动同步。
- **不要传递 `--key` 或 `--api-key`**：不要把密钥写进命令、prompt 或 tool 输入。
- **优先使用 agent/CI 友好参数**：推荐统一带上 `--output json --quiet --non-interactive`；需要等待完成时再加 `--wait`。
- **本地文件可以直接传**：传本地 `--image`、`--video`、`--audio` 时，CLI 会自动处理上传和稳定媒体 URL。

## 推荐入口

- 文生图：`popiart image generate`
- 图生图：`popiart image img2img`
- 文生/图生视频：`popiart video generate`
- Seedance / 豆包视频：`popiart video seedance`
- 语音合成：`popiart speech synthesize`
- 音乐生成：`popiart music generate`
- 作业查询：`popiart jobs get` / `popiart jobs wait`
- 产物下载：`popiart artifacts pull`
- 媒体上传：`popiart media upload`

## 常用命令

### 文生图

```bash
popiart image generate \
  --prompt "A cinematic portrait of a creator at sunset" \
  --aspect-ratio 9:16 \
  --wait \
  --output json \
  --quiet \
  --non-interactive
```

### 图生图

```bash
popiart image img2img \
  --image ./source.png \
  --prompt "Turn this into a poster-style portrait" \
  --aspect-ratio 3:4 \
  --wait \
  --output json \
  --quiet \
  --non-interactive
```

### 通用视频生成

```bash
popiart video generate \
  --image ./source.png \
  --prompt "Slow push-in and soft wind movement" \
  --wait \
  --output json \
  --quiet \
  --non-interactive
```

### 首尾帧视频

```bash
popiart video generate \
  --image ./first-frame.png \
  --last-frame ./last-frame.png \
  --prompt "从第一帧自然过渡到最后一帧，镜头平稳推进" \
  --duration 6 \
  --wait \
  --output json \
  --quiet \
  --non-interactive
```

### Seedance / 豆包视频

```bash
popiart video seedance \
  --image ./first-frame.png \
  --prompt "女孩睁开眼，头发被风轻轻吹动，镜头慢慢推进" \
  --ratio 16:9 \
  --wait \
  --output json \
  --quiet \
  --non-interactive
```

### Seedance 首尾帧

```bash
popiart video seedance \
  --image ./first-frame.png \
  --last-frame ./last-frame.png \
  --prompt "从第一帧自然过渡到最后一帧" \
  --ratio 16:9 \
  --wait \
  --output json \
  --quiet \
  --non-interactive
```

### Seedance 生成音频

```bash
popiart video seedance \
  --image ./actor.png \
  --prompt "人物边唱边看向镜头，镜头缓慢推近" \
  --generate-audio \
  --wait \
  --output json \
  --quiet \
  --non-interactive
```

### 语音合成

```bash
popiart speech synthesize \
  --text "Hello world" \
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

## 标准工作流

### 图片 / 视频生成

1. 使用 `popiart image generate`、`popiart image img2img`、`popiart video generate` 或 `popiart video seedance` 提交任务。
2. 如果带了 `--wait`，直接从 JSON 结果中提取 `artifact_ids`、`outputs`、`result_url` 或 `last_frame_url`。
3. 如果没有带 `--wait`，先取回 `job_id` 或 `task_id`，再用 `popiart jobs get <job_id>` 或 `popiart jobs wait <job_id>`。
4. 下载最终产物时，优先用 `popiart artifacts pull <artifact_id>`。

### 本地文件作为输入

对于图生图、图生视频、首尾帧视频、参考视频、参考音频：

1. 确认文件路径存在。
2. 直接用 `--image`、`--video`、`--audio` 传本地路径。
3. 让 CLI 自动上传和转换，不要手写上传逻辑，除非你明确需要稳定媒体 URL。

### 需要稳定媒体 URL 时

```bash
popiart media upload ./source.png --visibility public
```

成功后可使用：

```text
https://server.popi.art/v1/media/<media_id>/content
```

这个 URL 适合跨步骤、跨会话复用。

## 输出与检索

- 产物优先看 `artifact_id`。
- 任务级轮询优先用 `popiart jobs get <job_id>` 或 `popiart jobs wait <job_id>`。
- 下载单个产物：

```bash
popiart artifacts pull <artifact_id> --out /path/to/save
```

## 超时与重试

- 长任务优先继续查询同一个 `job_id` / `task_id`，不要重复提交同一请求。
- 如果命令已经支持 `--wait`，优先使用 `--wait` 简化流程。
- 如果需要脚本里自己轮询，优先轮询 `jobs get` / `jobs wait`，不要自己拼底层 HTTP 请求。

## 默认技能路由

- 文本生成图片：`popiart image generate --prompt "..."`
- 图片生成图片：`popiart image img2img --image <path> --prompt "..."`
- 通用图片生成视频：`popiart video generate --image <path> --prompt "..."`
- Seedance / 豆包视频：`popiart video seedance --image <path> --prompt "..."`
- 语音合成：`popiart speech synthesize --text "..."`
- 音乐生成：`popiart music generate --prompt "..."`
