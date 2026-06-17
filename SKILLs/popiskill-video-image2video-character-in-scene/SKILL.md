---
name: popiskill-video-image2video-character-in-scene
version: 2.0.1
official: true
category: 视频制作
description: Standardized local PopiartCLI skill for a staged character-in-scene workflow that preserves the original image preview, confirmation loop, batch video generation, and final concatenation path.
name_i18n:
  zh: 角色场景视频生成
  en: Character-in-Scene Video Generation
description_i18n:
  zh: 基于角色图和场景流程批量生成视频，并输出最终拼接路径。
  en: Generate character-in-scene videos in batches and output the final concatenation path.
---

# Character In Scene Local Run

Use this skill for a script-driven staged workflow:
1. Generate all selected scene images in one batch.
2. Preview and confirm the generated images.
3. Upload the confirmed local images with PopiArt media upload and construct the public media URL.
4. Generate all selected scene videos in one batch through this skill's bundled video stage.
5. Concatenate the final video after all selected clips succeed.

Keep progress phase-based. Do not expand it into per-scene top-level steps.

## Preconditions

Confirm PopiartCLI is installed and current:
- `popiart --help`
- `popiart update`

Confirm `ffmpeg` is available on the local machine:
- `ffmpeg -version`

Before starting any image or video work, the operator or agent must verify authentication immediately:
- `popiart auth whoami`
- if needed: `popiart auth login --key <product-key>`
- if auth check fails, stop before any generation step instead of discovering the problem after waiting for image or video work

Authenticate with the official flow:
1. `popiart auth whoami`
2. if needed: `popiart auth login --key <product-key>`
3. verify with `popiart auth whoami` and `popiart auth key show`

Budget checks may use:
- `popiart budget status`
- `popiart budget usage --group-by skill`
- `popiart budget limits`

If budget checks fail or balance is insufficient, route to `https://skillhub.popi.art`.

## Entrypoints

This skill must use the local bundled scripts as the execution entrypoints:
- Step 1 image stage: `scripts/run.py`
- Step 2 confirmed-image media upload plus video stage: `scripts/video.py`

Do not replace these local entrypoints with generic wrapper skills or another built-in generation flow just because the task looks similar.

If an agent cannot find `scripts/run.py` or `scripts/video.py`, it should first verify the current skill root and directory structure before trying any alternative workflow.

## First Turn Prompting

Tell the user:
- they may upload a local image path or provide a public image URL
- they may also use the default character `爱丽丝 / Alice`
- the Alice preview URL is `https://popiart-public-1313913486.cos.ap-guangzhou.myqcloud.com/media/2026/0310/54461.jpg`
- the full built-in scene list must be shown before asking for scene IDs
- scene IDs should be displayed as `[01]`, `[04]`, `[06]`
- the user may choose existing scene IDs or request a new custom scene for later confirmation and manual configuration
- the user may provide a shared outfit note or per-scene outfit notes

Recommended opening pattern:

```text
请先提供角色图，或者回复“使用默认角色爱丽丝”。
角色输入 / Character Input:
- 本地图片路径 / local image path
- 公网图片 URL / public image URL

默认角色 / Default Character:
爱丽丝 / Alice
预览 / Preview:
https://popiart-public-1313913486.cos.ap-guangzhou.myqcloud.com/media/2026/0310/54461.jpg

可选场景 / Available Scenes:
[01] 客厅 / Living Room
[02] 卧室 / Bedroom
[03] 厨房 / Kitchen
[04] 城市公园 / City Park
[05] 社区街道 / Community Street
[06] 购物中心 / Shopping Mall
[07] 咖啡馆 / Cafe
[08] 超市 / Supermarket
[09] 办公室 / Office
[10] 图书馆 / Library
[11] 地铁车厢 / Subway Car
[12] 车内视角 / Car Interior
[13] 医院候诊室 / Hospital Waiting Room
[14] 健身房 / Gym
[15] 理发店 / Barbershop

推荐组合 / Suggested Scene Sets:
Vlog日常：1,3,4,6（客厅、厨房、公园、商场）
工作日记：9,7,11（办公室、咖啡馆、地铁）
生活记录：2,4,7,10（卧室、公园、咖啡馆、图书馆）

你可以：
- 直接回复场景 ID，例如 1,4,7
- 回复“查看全部场景”
- 回复“新增场景：夜晚海边散步 / night beach walk”提出后续人工配置需求
- 补充动作、画面比例、统一装扮描述
- 为每个场景单独补充装扮，但仍作为同一批图片一起生成
```

## Interaction Rules

Preserve these user-facing replies:
- `确认`
- `重新生成 1,4`
- `替换 7`
- `查看全部场景`
- `新增场景：<描述>`

Do not remove the preview-and-confirm loop.

## Character Guidance

`character_prompt` is only for outfit, accessories, handheld props, or small styling notes.

Do not use it to redefine the character identity, face, hairstyle, body shape, or core design.

Keep the character as a clearly 2D anime-style subject, not a realistic human and not a fully 3D-rendered figure.

The environment may look realistic or cinematic, but the character should stay recognizably 2D and be placed naturally into a 3D scene with matching depth, perspective, and lighting.

When different scenes need different outfits, keep them in one batch and pass per-scene outfit prompts instead of splitting the run into separate scene-only executions.

If the user provides outfit wording, add this default instruction in the generation prompt:
- any appearance details not explicitly described should stay consistent with the reference image
- especially keep the character in the original 2D anime art style

## Execution Shape

Image stage example:

```bash
python scripts/run.py --character "<local-path-or-url>" --scenes "1,4,7" --aspect-ratio 16:9
```

After the user confirms the Step 1 preview, continue directly with this skill's bundled video stage:

```bash
python scripts/video.py --run-id <run_id> --scenes "1,4,7" --aspect-ratio 16:9
```

Video duration rule:
- default img2video duration is 3 seconds
- if the user explicitly specifies a duration, pass it through with `--duration <seconds>` instead of using the default

The continuation path must be:
1. keep using this skill's own bundled `scripts/video.py`
2. upload each confirmed local image with `popiart media upload <path> --visibility public`
3. read the returned `media_id`
4. construct the public media URL as `https://server.popi.art/v1/media/<media_id>/content`
5. use that public URL as the input to the built-in video generation stage
6. continue with the existing `popiart video img2video` flow, polling, artifact pulling, and final concatenation

Example confirmed-image upload command:

```bash
popiart media upload generation/<run_id>/img_scene01.jpg --visibility public
```

Then manually construct:

```text
https://server.popi.art/v1/media/<media_id>/content
```

This local workflow calls `popiart image img2img`, `popiart media upload`, `popiart video img2video`, `popiart jobs get`, and `popiart artifacts pull` under the hood. Preserve that execution shape.

## Retry, Polling, And Preview Rules

Use bounded polling:
- image generation timeout: 120 seconds
- video generation timeout: 300 seconds
- fixed polling interval
- timeout should stop the loop and return explicit status
- do not allow silent infinite polling

Retry policy:
- allow primary model 2 attempts, then fallback model 2 attempts, for the same stage operation
- if all 4 attempts fail, stop and report failure
- do not enter retry loops
- do not fallback across additional command patterns beyond the documented primary and fallback models

Preview timing:
- do not show the image preview HTML until all image tasks have fully finished for the current round, including any configured retries for failed scenes
- after the user confirms Step 1, upload the confirmed local images, build public media URLs, and use those URLs before starting the batch video stage
- do not show the video preview HTML until all confirmed-image uploads, all video tasks, any configured retries for failed scenes, and the final concatenation step have fully finished

## HTML Preview Handling

After each stage completes, the scripts should automatically open the generated local HTML preview file when the environment supports opening local files.

After auto-opening the preview, the operator or agent must explicitly tell the user:
- that the HTML preview has been generated and opened
- the exact local file path in case the auto-open window is blocked
- that all follow-up choices must still be sent in the chat dialog rather than inside the HTML page

## Output Verification

This workflow writes local output files under `generation/<run_id>/`, including:
- `img_results.json`
- `preview.html`
- `video_results.json`
- `video_preview.html`
- `clips/`
- `final_video_<n>scenes.mp4` when all selected clips succeed

The JSON result files should be used as the first verification layer.

More specifically:
- `img_results.json` records fields such as `job_id`, `img_artifact`, `img_url`, `img_path`, and after confirmation `confirmed_media_id` and `confirmed_media_url`
- `video_results.json` records fields such as `job_id`, `artifact_id`, and `clip_path`

When CLI-level inspection is needed, use:

```bash
popiart jobs get <job_id>
popiart jobs logs <job_id>
popiart artifacts pull <artifact_id>
```

The local scripts already download successful artifacts into the run directory, so `popiart artifacts pull-all` is optional rather than required in this workflow.

If all selected clips succeed but final concatenation fails, report the `ffmpeg` failure clearly and keep the generated clip files for manual inspection or re-concatenation.

## Video Continuation Rule

If the user confirms the generated images, do not stop after Step 1 and do not ask an open-ended question about how to continue.

The next action is to continue with this same skill's local video stage, which first uploads the confirmed local images through `popiart media upload`, constructs `https://server.popi.art/v1/media/<media_id>/content`, and then runs the built-in batch video workflow with that public URL.

## Custom Scene Requests

The user may ask for a new custom scene in conversation, but that is a confirmation-layer request rather than an immediately executable scene input.

Do not treat a custom scene description as runnable until it has been confirmed and added into the maintained scene configuration.

## Runtime Files Kept On Purpose

Keep these local files because they are part of the actual workflow, not redundant references:
- `scripts/run.py`
- `scripts/video.py`
- `config/scenes.json`

## Delivery Notes

This package intentionally keeps `scripts/` and `config/` because the documented local execution path depends on them.

Do not add unrelated repository clutter such as:
- `README.md`
- `CHANGELOG.md`
- extra template folders that the workflow does not use
