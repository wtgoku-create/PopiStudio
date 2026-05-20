---
name: seedance
description: Generate AI videos through the built-in PopiArt CLI Seedance workflow. Supports text-to-video, image-to-video, first/last-frame transitions, reference-video input, and generated audio. Use this skill when the user wants to create videos.
official: true
category: "视频制作"
version: 2.0.0
---

# Seedance 视频生成

这个 skill 现在通过内置 `popiart` CLI 的 `video seedance` 入口执行视频生成，不再直连 Ark API，也不再要求手动设置 `ARK_API_KEY`。

## 使用方式

- **文生视频 / 图生视频**：走 `popiart video seedance`
- **首尾帧视频**：使用 `--image` + `--last-frame`
- **参考视频**：使用 `--video`
- **生成音频**：使用 `--generate-audio`
- **参考音频**：使用 `--audio <path-or-url>`
- **认证来源**：使用应用 Settings / 主进程已同步好的 PopiArt 登录态

## 核心约束

- 不要运行 `popiart auth`
- 不要传递 `--key` / `--api-key`
- 推荐统一使用 `--wait --output json --quiet --non-interactive`
- 本地图片、视频、音频可以直接传路径，CLI 会自动上传

## 快速开始

### 文生视频

```bash
bash "$SKILLS_ROOT/seedance/scripts/generate-video.sh" \
  --prompt "一只小猫在草地上玩耍，阳光明媚，镜头缓缓推进" \
  --duration 5 \
  --ratio 16:9 \
  --output generated_video.mp4
```

### 图片生成视频

```bash
bash "$SKILLS_ROOT/seedance/scripts/generate-video.sh" \
  --prompt "女孩睁开眼，温柔地看向镜头，头发被风吹动" \
  --image "/Users/yourname/Pictures/girl.jpg" \
  --duration 5 \
  --ratio 9:16 \
  --output i2v_video.mp4
```

### 首尾帧过渡视频

```bash
bash "$SKILLS_ROOT/seedance/scripts/generate-video.sh" \
  --prompt "从第一帧自然过渡到最后一帧，镜头平稳推进" \
  --image "/Users/yourname/Pictures/first_frame.jpg" \
  --last-frame "/Users/yourname/Pictures/last_frame.jpg" \
  --duration 6 \
  --ratio 16:9 \
  --output transition_video.mp4
```

### 生成带音频的视频

```bash
bash "$SKILLS_ROOT/seedance/scripts/generate-video.sh" \
  --prompt "人物边唱边看向镜头，镜头缓慢推近" \
  --image "/Users/yourname/Pictures/actor.jpg" \
  --generate-audio \
  --duration 5 \
  --output audio_video.mp4
```

## 底层 CLI 对应关系

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

首尾帧示例：

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

生成音频示例：

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

## 常用参数

| 参数 | 说明 | 默认值 |
|---|---|---|
| `--prompt` | 视频描述提示词；纯参考输入时可选，但推荐提供 | 无 |
| `--image` | 参考图片路径或 URL，可多次传入 | 无 |
| `--last-frame` | 尾帧图片路径或 URL | 无 |
| `--video` | 参考视频路径或 URL | 无 |
| `--audio` | 参考音频路径或 URL；如果不带值则兼容旧用法并当作 `--generate-audio` | 无 |
| `--generate-audio` | 让 Seedance 生成音频 | 关闭 |
| `--model` | 透传给 `popiart` 的模型 ID | CLI 默认值 |
| `--duration` | 视频时长 | `5` |
| `--ratio` | 视频宽高比 | `16:9` |
| `--return-last-frame` | 在结果中请求返回尾帧 URL | 关闭 |
| `--output` | 输出文件路径 | `generated_video.mp4` |

## 输入说明

- 支持本地图片、视频、音频文件
- 支持网络 URL
- 支持 `file://` 路径
- 脚本会把这些参数直接透传给 `popiart video seedance`

## 输出说明

- 生成成功后，脚本会优先拉取视频 artifact 到本地
- 默认落到当前 skill 的 `generation/` 目录
- 若 CLI 返回 `result_url` 或 `last_frame_url`，脚本也会一并打印出来

标准结果示例：

```text
视频生成成功！
文件路径: /absolute/path/to/generated_video.mp4
artifact_id: art_xxx
result_url: https://...
last_frame_url: https://...
```

## 兼容说明

旧版 skill 中的这个写法：

```bash
--audio
```

曾被用作“生成音频”开关。当前上游 `popiartcli` 中更准确的写法是：

```bash
--generate-audio
```

当前脚本已经做了双兼容：

- `--audio <path>`：作为参考音频输入
- 单独写 `--audio`：兼容旧习惯，自动转成 `--generate-audio`

但文档和后续新调用都应优先使用 `--generate-audio`。

## 推荐工作流

1. 一般视频生成优先用 `generate-video.sh --prompt "..."`
2. 有首帧图时，加 `--image <path>`
3. 做过渡视频时，加 `--last-frame <path>`
4. 需要声音时，加 `--generate-audio`
5. 需要追查任务或单独下载产物时，直接用 `popiart jobs get` 和 `popiart artifacts pull`

## 排障

### `popiart` 命令不可用

说明应用没有正确注入 CLI 环境，或当前终端不在应用内运行环境里。

### 登录态缺失

不要手动 `popiart auth login`。应通过应用 Settings 登录，让主进程同步 PopiArt CLI 登录态。

### 没有返回视频 artifact

优先检查命令原始 JSON 结果，并使用：

```bash
popiart jobs get <job_id>
popiart artifacts pull <artifact_id> --out /path/to/video.mp4
```
