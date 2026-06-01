---
name: popitv
description: 'Provides production-grade PopiTV canvas support for Popiai sessions, enabling visual node-based orchestration of image, video, audio, 3D, prompt engineering, batch creation, review, and final media delivery workflows.'
official: true
category: '图像制作'
version: 1.0.0
---

# PopiTV Canvas

Use this skill when the user wants to create, inspect, modify, run, debug, or explain a PopiTV visual workflow canvas. PopiTV is a node canvas for media production pipelines: text/image/video/audio/3D inputs, prompt construction, AI generation, media processing, review nodes, and final output nodes.

The goal is not only to place nodes. The goal is to build a runnable, understandable, non-overlapping workflow that matches the user's creative intent and produces visible output assets.

## Activation

Use PopiTV when the request involves any of these:

- Building a visual workflow, node graph, canvas, pipeline, storyboard, shot workflow, or media automation.
- Creating or editing images, videos, audio, narration, music, 3D models, or mixed-media assets inside a canvas.
- Converting a brief into multiple scenes, shots, prompts, branches, or deliverables.
- Running, stopping, inspecting, debugging, or optimizing an existing PopiTV canvas.
- Explaining what the current canvas does or how to improve it.

Do not use PopiTV for ordinary text-only writing unless the user asks to turn the text into a media workflow.

## Required Context

Before editing a canvas:

1. Read the current canvas if PopiTV tools are available.
2. Use the `<popitv_canvas_context>` block from the system context as the latest known canvas snapshot when it is present.
3. Identify the current session id from the canvas context or tool result. Do not invent a session id.
4. Preserve useful existing nodes and outputs unless the user explicitly asks for a reset.
5. If the user's request is underspecified, make a conservative creative assumption and state it briefly. Ask a question only when the missing information would make the graph risky or unusable.

If PopiTV tools are unavailable, produce a concrete workflow plan with node types, node ids, edges, positions, and run steps. Do not claim that live canvas edits or runs were performed.

## Available Tools

Prefer structured PopiTV tools when available:

- `popitv__read_canvas`: inspect canvas nodes, edges, status, errors, and generated assets.
- `popitv__edit_canvas`: add, update, remove, or connect nodes.
- `popitv__measure_nodes`: get exact rendered node rectangles as `{ id, x, y, width, height }[]`.
- `popitv__run_canvas`: run the full workflow or selected nodes.
- `popitv__stop_canvas`: stop a running workflow.

Never pretend a tool ran. If a tool call fails, report the failure and either retry with a corrected operation or provide the next actionable fix.

## Production Workflow

Follow this sequence for canvas work:

1. Inspect: call `popitv__read_canvas`.
2. Plan: decide the workflow shape, node ids, data fields, edge handles, and layout columns.
3. Place incrementally: use `popitv__edit_canvas` for one logical group at a time.
4. Measure: after every edit that adds or moves nodes, call `popitv__measure_nodes` for all current node ids.
5. Validate layout: compare every measured rectangle against every other rectangle.
6. Repair: if any node overlaps or violates spacing, move it and measure again.
7. Validate graph: confirm required inputs, compatible handles, output endpoints, and runnable generation nodes.
8. Run: call `popitv__run_canvas` only after layout and graph checks pass, unless the user only asked for editing.
9. Read result: call `popitv__read_canvas` after a run to inspect status, errors, and output assets.
10. Report: summarize the actual graph changes, run status, assets, and any remaining manual inputs needed.

For large workflows, repeat steps 3-6 per stage or per shot row. Do not create a large unmeasured batch.

## Canvas Editing Rules

- Every `addNode` operation must include an explicit top-left `position`.
- Never place two nodes at the same position.
- Never reuse an existing node id for a different purpose.
- Use stable, descriptive ids such as `shot-01-prompt`, `shot-01-image`, `shot-01-video`, `final-stitch`, and `final-output`.
- Keep changes explicit and scoped to the user's request.
- Prefer updating existing nodes when the user asks to refine a workflow. Prefer adding new branches when the user asks for alternatives.
- Remove nodes only when the user requests removal or when they are clearly obsolete and disconnected because of the current edit.
- When adding edges, ensure both endpoint nodes exist and handles are compatible.
- For user-visible generated assets, connect final media to `output` or `outputGallery`.
- For image generation, prefer `nanoBanana`.
- For video generation, add `generateVideo` nodes. Do not tell the user to switch an image node into video mode.
- For prompt expansion, analysis, classification, or rewrite stages, use `llmGenerate`.
- For multi-shot production, use one row per shot and left-to-right stages.

## Layout Requirements

Node layout is a hard requirement. Do not leave overlapping nodes on the canvas.

Use exact measurements from `popitv__measure_nodes` whenever possible. Fall back to the size table only before the first measurement or when measurement is unavailable.

Default node sizes:

```json
{
  "imageInput": { "width": 300, "height": 280 },
  "audioInput": { "width": 300, "height": 200 },
  "videoInput": { "width": 300, "height": 280 },
  "annotation": { "width": 300, "height": 280 },
  "prompt": { "width": 320, "height": 220 },
  "array": { "width": 340, "height": 260 },
  "promptConstructor": { "width": 340, "height": 280 },
  "nanoBanana": { "width": 300, "height": 300 },
  "generateVideo": { "width": 300, "height": 300 },
  "generate3d": { "width": 300, "height": 300 },
  "generateAudio": { "width": 300, "height": 280 },
  "llmGenerate": { "width": 320, "height": 360 },
  "splitGrid": { "width": 300, "height": 320 },
  "output": { "width": 320, "height": 320 },
  "outputGallery": { "width": 320, "height": 360 },
  "imageCompare": { "width": 400, "height": 360 },
  "videoStitch": { "width": 400, "height": 280 },
  "easeCurve": { "width": 340, "height": 280 },
  "videoTrim": { "width": 360, "height": 360 },
  "videoFrameGrab": { "width": 320, "height": 320 },
  "router": { "width": 200, "height": 80 },
  "switch": { "width": 220, "height": 120 },
  "conditionalSwitch": { "width": 260, "height": 180 },
  "glbViewer": { "width": 360, "height": 380 }
}
```

Spacing rules:

- Coordinates are top-left positions.
- Keep at least 120 px horizontal and vertical clearance between node rectangles.
- Two nodes overlap when: `a.x < b.x + b.width`, `a.x + a.width > b.x`, `a.y < b.y + b.height`, and `a.y + a.height > b.y`.
- If two nodes overlap, move the later or less important node to the next free slot, then measure all nodes again.
- Before completion, perform a final full-canvas measurement and confirm there are no overlaps.

Recommended columns:

- Inputs and briefs: `x = 120`
- Prompts, arrays, prompt constructors: `x = 520`
- LLM expansion or analysis: `x = 920`
- Image generation and image processing: `x = 1320`
- Video, audio, and 3D generation: `x = 1720`
- Stitching, comparison, galleries, and outputs: `x = 2160`

Recommended row spacing:

- Start first row at `y = 120`.
- For compact rows, add at least 480 px per row.
- For rows containing `llmGenerate`, `outputGallery`, or 3D viewer nodes, add at least 560 px per row.
- Use the measured bottom edge plus 120 px when calculating the next row.

## Inline Prompt Rule

Some generation nodes accept `data.inputPrompt`. For image generation, this can create a connected prompt node automatically. When using inline prompts:

- Include `position` for the generation node.
- Include `promptPosition` when the bridge supports it, so the auto-created prompt node does not fall back to a default position.
- Measure all nodes immediately afterward because inline creation may add more than one node.

Example:

```json
{
  "type": "addNode",
  "nodeType": "nanoBanana",
  "nodeId": "shot-01-image",
  "position": { "x": 1320, "y": 120 },
  "promptPosition": { "x": 520, "y": 120 },
  "data": {
    "customTitle": "Shot 01 Image",
    "inputPrompt": "Children's picture-book style, wide shot, warm sunlight in a large forest, 16:9",
    "aspectRatio": "16:9",
    "resolution": "2K",
    "imageCount": 1
  }
}
```

## Node And Handle Reference

Use `references/ai-node-skill-guide.md` for detailed node data fields, defaults, and examples.

High-frequency nodes:

| Node | Purpose | Main inputs | Main outputs |
| --- | --- | --- | --- |
| `imageInput` | User/source image | `reference` | `image` |
| `audioInput` | User/source audio | `audio` | `audio` |
| `videoInput` | User/source video | `video` | `video` |
| `prompt` | Text prompt source | `text` | `text` |
| `promptConstructor` | Template prompt assembly | `text` | `text` |
| `array` | Split text into items | `text` | `text` |
| `llmGenerate` | Expand, rewrite, analyze, classify | `text`, `image`, `video` | `text` |
| `nanoBanana` | Image generation/editing | `text`, `image` | `image` |
| `generateVideo` | Text/image/video/audio to video | `text`, `image`, `video`, `audio` | `video` |
| `generateAudio` | Audio/TTS/music/SFX generation | `text` | `audio` |
| `generate3d` | Text/image to 3D | `text`, `image` | `3d` |
| `videoTrim` | Trim video | `video` | `video` |
| `videoFrameGrab` | Extract video frame | `video` | `image` |
| `videoStitch` | Combine video clips and audio | `video`, `audio` | `video` |
| `glbViewer` | Preview/capture 3D model | `3d` | `image` |
| `imageCompare` | Compare two images | `image` | none |
| `output` | Final single output | `image`, `video`, `audio`, `3d` | none |
| `outputGallery` | Final gallery output | `image`, `video` | none |

## Workflow Patterns

### Text To Image

Use for posters, concept art, product images, scene images, thumbnails, and still frames.

```json
[
  { "type": "addNode", "nodeType": "prompt", "nodeId": "hero-prompt", "position": { "x": 520, "y": 120 }, "data": { "customTitle": "Hero Prompt", "prompt": "A cinematic product hero image on a clean set, 16:9" } },
  { "type": "addNode", "nodeType": "nanoBanana", "nodeId": "hero-image", "position": { "x": 1320, "y": 120 }, "data": { "customTitle": "Hero Image", "aspectRatio": "16:9", "resolution": "2K", "imageCount": 1 } },
  { "type": "addNode", "nodeType": "output", "nodeId": "hero-output", "position": { "x": 2160, "y": 120 }, "data": { "customTitle": "Hero Output" } },
  { "type": "addEdge", "source": "hero-prompt", "target": "hero-image", "sourceHandle": "text", "targetHandle": "text" },
  { "type": "addEdge", "source": "hero-image", "target": "hero-output", "sourceHandle": "image", "targetHandle": "image" }
]
```

### Image To Image

Use for reference-based generation, style transfer, background replacement, product cleanup, and character consistency.

```json
[
  { "type": "addNode", "nodeType": "imageInput", "nodeId": "source-image", "position": { "x": 120, "y": 120 }, "data": { "customTitle": "Source Image" } },
  { "type": "addNode", "nodeType": "prompt", "nodeId": "edit-prompt", "position": { "x": 520, "y": 120 }, "data": { "customTitle": "Edit Prompt", "prompt": "Keep the subject identity, replace the background with a premium studio set" } },
  { "type": "addNode", "nodeType": "nanoBanana", "nodeId": "edited-image", "position": { "x": 1320, "y": 120 }, "data": { "customTitle": "Edited Image", "aspectRatio": "1:1", "resolution": "2K", "imageCount": 1 } },
  { "type": "addNode", "nodeType": "imageCompare", "nodeId": "before-after", "position": { "x": 2160, "y": 120 }, "data": { "customTitle": "Before After" } },
  { "type": "addEdge", "source": "source-image", "target": "edited-image", "sourceHandle": "image", "targetHandle": "image" },
  { "type": "addEdge", "source": "edit-prompt", "target": "edited-image", "sourceHandle": "text", "targetHandle": "text" },
  { "type": "addEdge", "source": "source-image", "target": "before-after", "sourceHandle": "image", "targetHandle": "image" },
  { "type": "addEdge", "source": "edited-image", "target": "before-after", "sourceHandle": "image", "targetHandle": "image" }
]
```

### Image To Video

Use for animating a key visual, product motion, character motion, or shot-based videos.

```json
[
  { "type": "addNode", "nodeType": "imageInput", "nodeId": "video-source", "position": { "x": 120, "y": 120 }, "data": { "customTitle": "Video Source" } },
  { "type": "addNode", "nodeType": "prompt", "nodeId": "motion-prompt", "position": { "x": 520, "y": 120 }, "data": { "customTitle": "Motion Prompt", "prompt": "Slow cinematic push-in, gentle natural movement, no text overlays" } },
  { "type": "addNode", "nodeType": "generateVideo", "nodeId": "generated-video", "position": { "x": 1720, "y": 120 }, "data": { "customTitle": "Generated Video", "durationSeconds": 5, "aspectRatio": "16:9", "soundEnabled": false } },
  { "type": "addNode", "nodeType": "output", "nodeId": "video-output", "position": { "x": 2160, "y": 120 }, "data": { "customTitle": "Video Output" } },
  { "type": "addEdge", "source": "video-source", "target": "generated-video", "sourceHandle": "image", "targetHandle": "image" },
  { "type": "addEdge", "source": "motion-prompt", "target": "generated-video", "sourceHandle": "text", "targetHandle": "text" },
  { "type": "addEdge", "source": "generated-video", "target": "video-output", "sourceHandle": "video", "targetHandle": "video" }
]
```

### Multi-Shot Video

Use for storyboards, ads, trailers, explainers, and short films.

Recommended structure per shot row:

- `shot-NN-brief` or `shot-NN-prompt`
- Optional `shot-NN-expand` (`llmGenerate`)
- `shot-NN-image` (`nanoBanana`)
- `shot-NN-motion` (`generateVideo`)
- Final `videoStitch`
- Final `output`

Rules:

- Use a separate row for each shot.
- Keep shot ids zero-padded: `shot-01`, `shot-02`, `shot-03`.
- Store shot duration in each `generateVideo.data.durationSeconds`.
- Use consistent `aspectRatio` across all shot image/video nodes unless the user asks otherwise.
- Connect all generated videos to one `videoStitch` node, then connect that node to `output`.
- If narration or music is requested, create `generateAudio` and connect it to `videoStitch.audio`.

### Prompt Expansion

Use when a brief is too short or the user wants a more professional prompt pipeline.

```json
[
  { "type": "addNode", "nodeType": "prompt", "nodeId": "brief", "position": { "x": 520, "y": 120 }, "data": { "customTitle": "Brief", "prompt": "A futuristic city at sunrise" } },
  { "type": "addNode", "nodeType": "llmGenerate", "nodeId": "expand-brief", "position": { "x": 920, "y": 120 }, "data": { "customTitle": "Prompt Expansion", "inputPrompt": "Expand the connected brief into a precise visual generation prompt. Include subject, style, lighting, composition, lens, mood, and negative constraints.", "temperature": 0.7, "maxTokens": 1200 } },
  { "type": "addNode", "nodeType": "nanoBanana", "nodeId": "expanded-image", "position": { "x": 1320, "y": 120 }, "data": { "customTitle": "Expanded Image", "aspectRatio": "16:9", "resolution": "2K" } },
  { "type": "addEdge", "source": "brief", "target": "expand-brief", "sourceHandle": "text", "targetHandle": "text" },
  { "type": "addEdge", "source": "expand-brief", "target": "expanded-image", "sourceHandle": "text", "targetHandle": "text" }
]
```

## Run Strategy

Before running:

- Ensure all required source inputs exist or are marked optional.
- Ensure generation nodes have either connected text/image/video/audio inputs or valid `data.inputPrompt`.
- Ensure final expected media is connected to `output` or `outputGallery`.
- Ensure there are no overlapping nodes.
- Avoid running if the user only asked for a plan, explanation, or layout edit.

During and after running:

- Use `popitv__run_canvas` for a full workflow when the graph is complete.
- Use selected-node runs when the user asks to test one branch or when a full run would waste time.
- If a run fails, call `popitv__read_canvas`, identify failed nodes and error messages, then fix the graph or data if possible.
- If the user asks to stop, call `popitv__stop_canvas` and then read the canvas to report the stopped state.

## Validation Checklist

Before reporting completion:

- Canvas was read at least once when tools were available.
- All new nodes have explicit ids and positions.
- All moved or added nodes were measured after placement.
- Final full-canvas measurement found no overlap.
- Every edge connects existing nodes.
- Source and target handles are compatible.
- Every generation node has enough input for its intended task.
- Output assets are connected to `output`, `outputGallery`, `imageCompare`, or another visible review node.
- User-requested dimensions, duration, style, language, brand constraints, and deliverable format were reflected in node data.
- Run status and important generated assets were reported when a run was requested or performed.

## Response Style

When you edit a canvas, keep the response concise and factual:

- State what was changed: nodes, edges, prompts, layout, outputs.
- State whether layout was measured and whether overlaps remain.
- State run status if a run happened.
- State any missing user inputs, failed nodes, or manual next steps.

Do not paste large JSON operation blocks to the user unless they ask for the implementation details. Do not describe fictional results. Do not over-explain basic node concepts unless the user asks.
