---
name: seedream
description: Generate AI images through the built-in PopiArt CLI Seedream-facing workflow. Supports text-to-image and image-to-image generation. Use this skill when the user wants to create or edit images.
official: true
category: 图像制作
version: 2.0.0
name_i18n:
  zh: Seedream 图像生成
  en: Seedream Image Generation
description_i18n:
  zh: 通过内置 PopiArt CLI 使用 Seedream 生成或编辑 AI 图像。
  en: Generate or edit AI images through the built-in PopiArt CLI Seedream workflow.
---

# Seedream 图片生成

这个 skill 现在通过内置 `popiart` CLI 执行图片生成，不再直连 Ark API，也不再要求手动设置 `ARK_API_KEY`。

## 使用方式

- **文生图**：走 `popiart image generate`
- **图生图**：走 `popiart image img2img`
- **认证来源**：使用应用 Settings / 主进程已同步好的 PopiArt 登录态
- **输出形式**：脚本会把最终图片拉到本地 `generation/` 目录，方便 popiai 预览

## 核心约束

- 不要运行 `popiart auth`
- 不要传递 `--key` / `--api-key`
- 推荐统一使用 `--wait --output json --quiet --non-interactive`
- 有本地参考图时，直接传 `--image <path>`

## 快速开始

### 文生图

```bash
bash "$SKILLS_ROOT/seedream/scripts/generate-image.sh" \
  --prompt "充满活力的特写编辑肖像，模特眼神犀利，头戴雕塑感帽子，色彩拼接丰富，景深较浅，Vogue杂志封面美学风格" \
  --aspect-ratio 9:16 \
  --output portrait.png
```

### 图生图

```bash
bash "$SKILLS_ROOT/seedream/scripts/generate-image.sh" \
  --prompt "保持人物姿势不变，将服装改成未来感银色材质" \
  --image "/Users/yourname/Pictures/model.jpg" \
  --aspect-ratio 3:4 \
  --output edited_model.png
```

## 底层 CLI 对应关系

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

## 常用参数

| 参数 | 说明 | 默认值 |
|---|---|---|
| `--prompt` | 图片描述提示词，必填 | 无 |
| `--image` | 参考图片路径或 URL，可多次传入 | 无 |
| `--model` | 透传给 `popiart` 的模型 ID | CLI 默认值 |
| `--aspect-ratio` | 图片宽高比 | `16:9` |
| `--size` | 图片尺寸 | CLI 默认值 |
| `--output` | 输出文件路径 | `generated_image.png` |

## 输入说明

- 支持本地文件：`/path/to/image.jpg`
- 支持网络 URL：`https://example.com/image.jpg`
- 支持 `file://` 路径
- 脚本会把 `--image` 直接传给 `popiart` CLI，由 CLI 负责上传和转换

## 输出说明

- 生成成功后，脚本会自动把首个图片 artifact 拉取到本地
- 默认落到当前 skill 的 `generation/` 目录
- 若传了 `--output`，则保存到指定路径

标准结果示例：

```text
图片生成成功！
文件路径: /absolute/path/to/portrait.png
artifact_id: art_xxx
```

## 不再作为主路径支持的旧参数

以下旧版 Seedream 直连参数不再是本 skill 的主路径能力：

- `--search`
- `--sequential`
- `--max-images`
- `--no-watermark`

原因：

- 这些参数来自旧的 Ark 直连实现
- 当前 skill 已切到 `popiart` façade
- 上游 `popiartcli` README 没有把这些开关作为 Seedream façade 的稳定契约公开保证

脚本当前会对这些旧参数做兼容提示，但不会再承诺与旧版行为完全一致。

## 推荐工作流

1. 没有参考图时，用文生图：`generate-image.sh --prompt "..."`
2. 有参考图时，用图生图：`generate-image.sh --image <path> --prompt "..."`
3. 需要下载或追查更底层结果时，直接用 `popiart artifacts pull` 或 `popiart jobs get`

## 排障

### `popiart` 命令不可用

说明应用没有正确注入 CLI 环境，或当前终端不在应用内运行环境里。

### 登录态缺失

不要手动 `popiart auth login`。应通过应用 Settings 登录，让主进程同步 PopiArt CLI 登录态。

### 结果里没有 artifact_id

这通常表示 CLI 返回结构变化或任务未真正成功完成。优先检查原始命令返回，并用：

```bash
popiart jobs get <job_id>
popiart artifacts pull <artifact_id> --out /path/to/file
```
