---
name: popiart
description: "Use the built-in PopiArt CLI for text-to-image, image-to-image, image-to-video, speech, music, jobs, and artifacts. Use this when the user asks to generate or transform visual/audio media."
official: true
version: 2.0.0
---

# PopiArt CLI

使用内置的 PopiArt CLI 处理所有 PopiArt 相关任务。

## 核心约束

- **使用 `popiart` CLI 命令**：直接执行 `popiart image`、`popiart video`、`popiart jobs`、`popiart artifacts` 等命令。
- **不要运行 `popiart auth`**：登录由 Settings 页面处理，应用启动时自动同步登录态。
- **不要传递 `--key` 或 `--api-key`**：不要在命令中传入 key，key 不出现在 prompt、Bash 命令或 tool 输入中。
- **不要运行 `popiart --version` 或 `popiart help`**：这些是调试命令，生成任务不需要。

## 常用命令

### 文生图

```bash
popiart image "a serene landscape with mountains at sunset" --aspect 16:9 --count 1
```

### 图生图

```bash
popiart image "a cyberpunk city at night" --input /path/to/reference.png --strength 0.7
```

### 图生视频

```bash
popiart video "a cat running through a field of flowers" --input /path/to/first-frame.png --duration 5
```

### 查询任务状态

```bash
间隔1.5秒轮询一次状态查询
popiart jobs get <job_id>
```

### 列出并拉取产物

```bash
popiart artifacts list
popiart artifacts pull <artifact_id> --output /path/to/save
```

### 上传本地文件

```bash
popiart artifacts upload /path/to/file.png
```

## 工作流

### 标准生成流程

1. 用 `popiart image` 或 `popiart video` 提交生成任务
2. 从输出中提取 `job_id`
3. 用 `popiart jobs get <job_id>` 查询状态，直到完成
4. 用 `popiart artifacts list` 查看产物列表
5. 用 `popiart artifacts pull <artifact_id>` 下载到本地
6. 将本地文件路径返回给用户，LobsterAI 自动预览

### 本地文件作为输入

对于需要参考图的图生图或图生视频：

1. 确认本地文件路径（如 `/path/to/reference.png`）
2. 直接在命令中通过 `--input` 传入本地路径
3. popiart CLI 会自动处理上传

## 产物输出目录

默认输出到应用数据目录下的 `popiart/outputs/` 子目录。生成的图片、视频、音频文件路径会直接显示给用户，右侧面板自动识别并预览。

## 超时处理

如果任务长时间处于 `running` 状态：

- **不要重新提交同一任务**
- 继续用同一个 `job_id` 查询状态
- 可用 `popiart jobs get <job_id>` 查看详细状态

## 默认技能路由

- 文本生成图片：`popiart image "..."`
- 图片生成图片：`popiart image "..." --input <path>`
- 图片生成视频：`popiart video "..." --input <path>`
- 语音合成：使用 `popiart speech "..."` 或查看 `popiart --help` 中的音频命令和其他命令