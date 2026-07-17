---
name: popiart
description: Use the built-in PopiArt CLI for image, video, speech, music, jobs, artifacts, and media workflows. Use this when the user wants to generate or transform visual/audio media.
official: true
category: 图像制作
version: 2.2.0
name_i18n:
  zh: PopiArt 媒体生成
  en: PopiArt Media Generation
description_i18n:
  zh: 使用内置 PopiArt CLI 处理图像、视频、语音、音乐、任务和媒体工作流。
  en: Use the built-in PopiArt CLI for image, video, speech, music, jobs, and media workflows.
---

# PopiArt CLI

使用内置 `popiart` CLI 处理图片、视频、语音、音乐、任务查询、媒体上传和产物下载。

## 核心约束

- 始终使用 `popiart` CLI，不要改用裸 API。
- 不要运行 `popiart auth`；登录由 Settings 和主进程同步。
- 不要传 `--key` / `--api-key`，也不要把密钥写入 prompt 或 tool 输入。
- Agent/CI 默认追加：`--output json --quiet --non-interactive`。需要等结果时加 `--wait`；只提交任务时用 `--async`。
- 本地 `--image` / `--video` / `--audio` 可直接传，CLI 会处理上传和稳定媒体 URL。
- 图片、视频、语音、音乐生成成功后，默认继续下载到本地目录；不要只返回远端 URL、`job_id`、`task_id` 或 `artifact_id`。
- 主站模式下不要优先用 `popiart artifacts pull <artifact_id>`，它可能返回 `UNSUPPORTED_IN_POPI_ART_MODE`；优先 `artifacts list` / `artifacts get` / `artifacts pull-all`。

## 默认参数

```bash
--output json --quiet --non-interactive
```

可选：`--wait` 等待完成；`--async` 只提交任务；`--dry-run` 预览请求。

## 推荐入口

| 任务 | 命令 |
| --- | --- |
| 文生图 | `popiart image generate` |
| 图生图 | `popiart image img2img` |
| 显式图生图 | `popiart image transform` |
| 图片理解 / prompt 生成 | `popiart image describe` |
| 通用视频 | `popiart video generate` |
| 显式图生视频 | `popiart video img2video` |
| from-image 视频 | `popiart video from-image` |
| 动作迁移 | `popiart video action-transfer` |
| Seedance / 豆包视频 | `popiart video seedance` |
| 语音合成 | `popiart speech synthesize` |
| 音乐生成 | `popiart music generate` |
| 作业查询 | `popiart jobs get` / `popiart jobs wait` |
| 产物查看 | `popiart artifacts list` / `popiart artifacts get` |
| 产物下载 | `popiart artifacts pull-all` |
| artifact 上传 | `popiart artifacts upload` |
| 媒体上传 / 查询 | `popiart media upload` / `popiart media get` |

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

### 图片理解 / prompt 生成

```bash
popiart image describe \
  --image ./source.png \
  --prompt "Write a reusable text-to-image prompt" \
  --output json \
  --quiet \
  --non-interactive
```

### 图生图 / 显式图生图

```bash
popiart image img2img \
  --image ./source.png \
  --prompt "Turn this into a poster-style portrait" \
  --wait \
  --output json \
  --quiet \
  --non-interactive
```

```bash
popiart image transform \
  --image ./source.png \
  --prompt "Turn this into a cyberpunk poster" \
  --wait \
  --output json \
  --quiet \
  --non-interactive
```

### 视频

```bash
popiart video generate \
  --image ./source.png \
  --prompt "Slow push-in and soft wind movement" \
  --wait \
  --output json \
  --quiet \
  --non-interactive
```

```bash
popiart video from-image \
  --image ./source.png \
  --prompt "Slowly push toward the subject's face" \
  --wait \
  --output json \
  --quiet \
  --non-interactive
```

### 首尾帧 / 动作迁移

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

```bash
popiart video action-transfer \
  --image ./face.jpg \
  --video ./motion.mp4 \
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

### 语音 / 音乐

```bash
popiart speech synthesize \
  --text "Hello world" \
  --output json \
  --quiet \
  --non-interactive
```

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

## 模型与默认路由

CLI 有默认模型。用户指定模型，或命令返回 `MODEL_NOT_FOUND` / `MODEL_SUBTYPE_UNSUPPORTED` 时，先查询可用模型/路由，再指定 `--model` 或 `--route`。

- `--model <model_id>` 只影响本次请求，优先使用。
- `--route <route>` 会覆盖项目默认路由，一般不推荐。

```bash
popiart models list --output json --quiet --non-interactive
popiart models list --capability text2image --output json --quiet --non-interactive
popiart models routes --output json --quiet --non-interactive
popiart models routes --route image.text2image --output json --quiet --non-interactive
```

常用 route：

- `image.text2image`
- `image.img2img`
- `video.image2video`
- `video.seedance`
- `video.action-transfer`
- `audio.tts`
- `speech.synthesize`
- `music.generate`

### 单次指定模型

只影响本次请求时，在支持的 intent 命令上直接传 `--model`(model_id是models list中的ID)：

```bash
popiart image generate \
  --model <model-id> \
  --prompt "A clean editorial product photo" \
  --aspect-ratio 1:1 \
  --wait \
  --output json \
  --quiet \
  --non-interactive
```

```bash
popiart video generate \
  --model <model-id> \
  --image ./source.png \
  --prompt "Subtle camera push-in and natural motion" \
  --duration 5 \
  --wait \
  --output json \
  --quiet \
  --non-interactive
```

`image describe` 通常需要显式 `--model`，例如:

```bash
popiart image describe \
  --image ./source.png \
  --model <model-id> \
  --prompt "Write a reusable text-to-image prompt" \
  --output json \
  --quiet \
  --non-interactive
```

### 项目级模型覆盖

只有用户明确要求“这个项目以后都用某模型”时，才使用 route override：

```bash
popiart models route-override set \
  --project <project-id> \
  --route image.img2img \
  --model <model-id> \
  --output json \
  --quiet \
  --non-interactive
```

## 标准工作流

### 图片 / 视频生成

1. 使用 `popiart image generate`、`popiart image img2img`、`popiart video generate` 或 `popiart video seedance` 提交任务。
2. 如果带了 `--wait`，直接从 JSON 结果中提取 `task_id`、`job_id`、`artifact_ids`、`outputs`、`result_url` 或 `last_frame_url`。
3. 如果没有带 `--wait`，先取回 `job_id` 或 `task_id`，再用 `popiart jobs get <job_id>` 或 `popiart jobs wait <job_id>`。
4. 任务完成后，优先使用 `task_id` 立即下载全部结果到本地目录。先确认当前工作目录，不要在已经位于 `output/popiart/<task-id>` 或其子目录时再次拼接 `./output/popiart/<task-id>`。
5. 下载命令优先使用项目根目录下的绝对路径：`popiart artifacts pull-all <task-id> --dir "<project-root>/output/popiart/<task-id>"`。如果无法确认项目根目录，则使用当前目录下的 `./artifacts`，不要再次拼接 `output/popiart/<task-id>`。
6. 只有在确认拿不到 `task_id` 时，才退回到 `popiart artifacts list <task-id>`、`popiart artifacts get <artifact-id>` 等查询步骤补齐信息。

### 语音 / 音乐生成

1. 使用 `popiart speech synthesize` 或 `popiart music generate` 提交任务，优先带 `--wait`。
2. 从结果中提取 `task_id`、`artifact_ids`、输出 URL 或其他产物元数据。
3. 生成成功后同样立即下载到本地，优先使用项目根目录下的绝对路径：`popiart artifacts pull-all <task-id> --dir "<project-root>/output/popiart/<task-id>"`。如果当前目录已经在该输出目录内，则改用 `./artifacts`。
4. 如果接口只返回 URL 而没有可用的 `task_id`，至少要把最终媒体文件保存到本地，并在回复中明确本地路径。

### 本地文件作为输入

对于图生图、图生视频、首尾帧视频、参考视频、参考音频：

1. 确认文件路径存在。
2. 直接用 `--image`、`--video`、`--audio` 传本地路径。
3. 让 CLI 自动上传和转换，不要手写上传逻辑，除非你明确需要稳定媒体 URL。

### 需要稳定媒体 URL 时

```bash
popiart media upload ./source.png --visibility public
```

成功后优先复用 CLI 返回结果中的稳定媒体 URL、`media_id` 或元数据。
如果后续只需要查媒体信息，使用：

```bash
popiart media get <media-id>
```

不要手写或拼接旧的 `server.popi.art` 媒体 URL。

## 输出与检索

- 产物优先看 `artifact_id`。
- 任务级轮询优先用 `popiart jobs get <job_id>` 或 `popiart jobs wait <job_id>`。
- 默认把生成结果下载到项目根目录下的 `output/popiart/<task-id>/`；如果暂时拿不到 `task_id`，使用能稳定标识任务的目录名。
- 下载前必须确认输出目录是绝对路径或相对于项目根目录的路径。不要从 `output/popiart/<task-id>` 内部再执行 `--dir ./output/popiart/<task-id>`，这会生成嵌套目录。
- 回复用户时只写实际存在的下载路径；不要手写推测路径。必要时用 `ls` 或等价方式确认文件存在。
- 查看任务结果列表：

```bash
popiart artifacts list <task-id>
```

- 查看单个 artifact 元数据：

```bash
popiart artifacts get <artifact-id>
```

- 下载任务全部产物：

```bash
popiart artifacts pull-all <task-id> --dir "<project-root>/output/popiart/<task-id>"
```

- `popiart artifacts pull <artifact_id>` 在主站模式下可能不可用，只有确认环境支持时再使用。
- 回复用户时，除了说明任务状态，也要明确告知本地下载目录和关键文件路径。

## 错误处理

优先读取 JSON envelope 里的 `error.code`，不要只匹配自然语言报错。

| 错误码 | 处理方式 |
| --- | --- |
| `UNAUTHENTICATED` | 停止并提示用户在 Settings 里重新登录；不要运行 `popiart auth`。 |
| `FORBIDDEN` | 停止并说明权限或项目问题。 |
| `NOT_FOUND` | 重新用 `skills list`、`jobs list`、`artifacts list` 或对应 get 命令确认 ID。 |
| `MODEL_NOT_FOUND` | 先查 `models list` / `models routes`，再选择可用模型或让默认路由处理。 |
| `MODEL_SUBTYPE_UNSUPPORTED` | 查模型 capability / route，换支持当前任务子类型的模型。 |
| `VALIDATION_ERROR` | 修正参数，不要原样重试。 |
| `POLL_TIMEOUT` | 继续 wait 同一个 `job_id` / `task_id`，不要重复提交生成。 |
| `JOB_FAILED` | 展示 provider/task 失败信息，不要盲目重试。 |
| `NETWORK_ERROR` / `SERVER_ERROR` | 可退避重试一次；持续失败则反馈问题。 |

## 超时与重试

- 长任务优先继续查询同一个 `job_id` / `task_id`，不要重复提交同一请求。
- 如果命令已经支持 `--wait`，优先使用 `--wait` 简化流程。
- 如果需要脚本里自己轮询，优先轮询 `jobs get` / `jobs wait`，不要自己拼底层 HTTP 请求。
- `jobs cancel` 和 `jobs logs` 在主站模式下可能返回 `UNSUPPORTED_IN_POPI_ART_MODE`。

## 默认技能路由

- 文本生成图片：`popiart image generate --prompt "..."`
- 图片生成图片：`popiart image img2img --image <path> --prompt "..."`
- 显式图生图：`popiart image transform --image <path> --prompt "..."`
- 图片理解 / prompt 生成：`popiart image describe --image <path> --prompt "..."`
- 通用图片生成视频：`popiart video generate --image <path> --prompt "..."`
- 显式图生视频：`popiart video img2video --image <path> --prompt "..."`
- `from-image` 视频入口：`popiart video from-image --image <path> --prompt "..."`
- 动作迁移：`popiart video action-transfer --image <path> --video <path>`
- Seedance / 豆包视频：`popiart video seedance --image <path> --prompt "..."`
- 语音合成：`popiart speech synthesize --text "..."`
- 音乐生成：`popiart music generate --prompt "..."`
