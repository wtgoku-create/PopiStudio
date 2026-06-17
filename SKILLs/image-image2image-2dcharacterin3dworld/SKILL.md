---
name: image-image2image-2dcharacterin3dworld
version: 1.0.0
official: true
category: 漫剧制作
description: Standardized local PopiartCLI skill for turning a 2D anime character reference image into selected 3D-world scene images, with full scene display, bounded retries, auth and budget precheck, and a local HTML preview after the image batch completes.
name_i18n:
  zh: 2D 角色转 3D 场景
  en: 2D Character to 3D Scene
description_i18n:
  zh: 将 2D 动漫角色参考图转换为 3D 世界场景图，并生成本地预览。
  en: Turn a 2D anime character reference into 3D-world scene images with a local preview.
---

# 2D Character In 3D World Image Skill

Use this skill for an image-only local workflow:
1. Verify PopiArt auth and budget readiness before any generation work.
2. Show the full built-in scene list before asking for scene selection.
3. Generate all selected scene images in one batch with bounded retries.
4. Open the local HTML preview only after the whole image round fully finishes.
5. Stop at the image preview stage and continue follow-up only in chat.

Keep progress phase-based. This package ends at the image preview stage.

## Preconditions

Confirm PopiartCLI is installed and current:
- `popiart --help`
- `popiart update`

Before starting image generation, the operator or agent must verify both auth and usable balance:
1. `popiart auth whoami`
2. if needed: `popiart auth login --key <product-key>`
3. `popiart auth key show`
4. `popiart budget status`

Optional budget inspection:
- `popiart budget usage --group-by skill`
- `popiart budget limits`

If auth fails or available balance is insufficient, stop before generation and route the user to `https://skillhub.popi.art`.

## Entrypoint

This skill must use the local bundled script as the execution entrypoint:
- `scripts/run.py`

Do not replace this local entrypoint with a generic wrapper or a different built-in flow.

## First Turn Prompting

Tell the user:
- they may provide a local image path or a public image URL
- they may also use the default character `Alice`
- the Alice preview URL is `https://popiart-public-1313913486.cos.ap-guangzhou.myqcloud.com/media/2026/0310/54461.jpg`
- the full built-in scene list must be shown before asking for scene IDs
- scene IDs should be displayed as `[01]`, `[04]`, `[06]`
- they may choose existing scene IDs directly
- they may request a new custom scene, but that remains a confirmation-layer request rather than executable input
- they may provide a shared outfit note or per-scene outfit notes

Recommended opening pattern:

```text
Please provide a character image, or reply with "use default character Alice".

Character Input:
- local image path
- public image URL

Default Character:
Alice
Preview:
https://popiart-public-1313913486.cos.ap-guangzhou.myqcloud.com/media/2026/0310/54461.jpg

Available Scenes:
[01] Living Room
[02] Bedroom
[03] Kitchen
[04] City Park
[05] Community Street
[06] Shopping Mall
[07] Cafe
[08] Supermarket
[09] Office
[10] Library
[11] Subway Car
[12] Car Interior
[13] Hospital Waiting Room
[14] Gym
[15] Barbershop

Suggested Scene Sets:
Daily vlog: 1,3,4,6
Work diary: 9,7,11
Life record: 2,4,7,10

You can:
- reply directly with scene IDs such as 1,4,7
- reply with "show all scenes"
- reply with "new scene: night beach walk" to request later manual configuration
- add action, aspect ratio, and shared styling notes
- add per-scene outfit notes while keeping one image batch
```

## Interaction Rules

Preserve these user-facing replies:
- `show all scenes`
- `new scene: <description>`

After the image HTML preview is shown, stop the skill there and wait for the next instruction in chat.

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

Example:

```bash
python scripts/run.py --character "<local-path-or-url>" --scenes "1,4,7" --aspect-ratio 16:9
```

This local workflow calls `popiart image img2img`, `popiart jobs get`, `popiart artifacts get`, and `popiart artifacts pull` under the hood. Preserve that execution shape.

## Retry, Polling, And Preview Rules

Use bounded polling:
- image generation timeout: 120 seconds
- fixed polling interval
- timeout should stop the loop and return explicit status
- do not allow silent infinite polling

Retry policy:
- allow primary model 2 attempts, then fallback model 2 attempts, for the same image stage operation
- if all 4 attempts fail, stop and report likely provider-side failure
- do not enter unbounded retry loops

Preview timing:
- do not show the image preview HTML until all image tasks have fully finished for the current round, including configured retries for failed scenes
- after the HTML preview is shown, stop at the image stage and wait for the user in chat

## HTML Preview Handling

After the image stage completes, the script should automatically open the generated local HTML preview file when the environment supports opening local files.

After auto-opening the preview, the operator or agent must explicitly tell the user:
- that the HTML preview has been generated and opened
- the exact local file path in case auto-open is blocked
- that all follow-up choices must still be sent in the chat dialog rather than inside the HTML page

## Output Verification

This workflow writes local output files under `generation/<run_id>/`, including:
- `img_results.json`
- `preview.html`

The JSON result file is the first verification layer.

`img_results.json` should keep fields such as:
- `job_id`
- `img_artifact`
- `img_url`
- `img_path`

When CLI-level inspection is needed, use:

```bash
popiart jobs get <job_id>
popiart jobs logs <job_id>
popiart artifacts pull <artifact_id>
```

## Runtime Files Kept On Purpose

Keep these local files because they are part of the actual workflow:
- `scripts/run.py`
- `config/scenes.json`

## Delivery Notes

This package intentionally keeps `scripts/`, `config/`, and `references/` because the documented local execution path depends on them.

Do not add unrelated repository clutter such as:
- `README.md`
- `CHANGELOG.md`
- extra template folders that the workflow does not use
