# PopiTV AI Node Skill Guide

Detailed reference for PopiTV canvas tools, edit operations, node types, handles, data fields, workflow templates, and troubleshooting. Load this file when a PopiTV task needs exact node details, operation JSON, handle compatibility, or reusable graph patterns.

## Table Of Contents

- [Tool API](#tool-api)
- [Canvas Snapshot Shape](#canvas-snapshot-shape)
- [Edit Operations](#edit-operations)
- [Normalization Rules](#normalization-rules)
- [Layout Rules](#layout-rules)
- [Common Data Fields](#common-data-fields)
- [Handle Compatibility](#handle-compatibility)
- [Node Reference](#node-reference)
- [Workflow Templates](#workflow-templates)
- [Run And Debug Guide](#run-and-debug-guide)
- [Preflight Checklist](#preflight-checklist)

## Tool API

PopiTV exposes these tools through the `popitv` MCP server.

### `read_canvas`

Read the current canvas snapshot.

Input:

```json
{
  "sessionId": "optional Popiai cowork session id",
  "refresh": false
}
```

Rules:

- Omit `sessionId` only when exactly one visible PopiTV canvas can handle the request.
- Use `refresh: true` when the cached snapshot may be stale after an external UI change.
- Read before editing, running, or diagnosing a canvas.

### `edit_canvas`

Apply edit operations.

Input:

```json
{
  "sessionId": "optional Popiai cowork session id",
  "operations": []
}
```

Rules:

- `operations` is required and must be an array.
- Every `addNode` operation must have an explicit `position`.
- Inline prompt generation expands into extra operations; include `promptPosition` or the generated prompt node will fail layout validation.
- The bridge validates new nodes in the same edit batch for missing positions, overlap, and horizontal clearance.
- Existing canvas overlap must still be checked with `measure_nodes`; the bridge only validates the submitted add-node batch.

### `measure_nodes`

Measure rendered node bounds.

Input:

```json
{
  "sessionId": "optional Popiai cowork session id",
  "nodeIds": ["node-1", "node-2"]
}
```

Returns:

```json
[
  { "id": "node-1", "x": 200, "y": 160, "width": 320, "height": 220 }
]
```

Rules:

- `nodeIds` is required and must contain at least one non-empty id.
- Measure all current nodes after every add or move.
- Use measured dimensions over default dimensions for subsequent placement.

### `run_canvas`

Run the full workflow or selected nodes.

Input:

```json
{
  "sessionId": "optional Popiai cowork session id",
  "nodeIds": ["optional-node-id"]
}
```

Rules:

- Omit `nodeIds` to run the full workflow.
- Provide `nodeIds` to run only selected nodes.
- Run only after layout and graph preflight checks pass.

### `stop_canvas`

Stop workflow execution.

Input:

```json
{
  "sessionId": "optional Popiai cowork session id"
}
```

## Canvas Snapshot Shape

`read_canvas` returns a snapshot similar to:

```json
{
  "sessionId": "session-id",
  "workflowId": "workflow-id",
  "workflowName": "Storyboard",
  "nodeCount": 4,
  "edgeCount": 3,
  "isRunning": false,
  "currentNodeIds": [],
  "hasUnsavedChanges": true,
  "nodes": [
    {
      "id": "shot-01-prompt",
      "type": "prompt",
      "position": { "x": 520, "y": 120 },
      "data": { "prompt": "A warm forest scene" }
    }
  ],
  "edges": [
    {
      "id": "edge-1",
      "source": "shot-01-prompt",
      "sourceHandle": "text",
      "target": "shot-01-image",
      "targetHandle": "text"
    }
  ]
}
```

Snapshot use:

- Use `nodes[].id`, `nodes[].type`, and `nodes[].position` to preserve existing graph structure.
- Use `edges[]` to avoid duplicate connections and to find missing endpoints.
- Use `isRunning` before running or stopping.
- Use `currentNodeIds` to understand active execution.
- Use `hasUnsavedChanges` as status only; do not treat it as an error.

## Edit Operations

Use an `operations` array. Common operation shapes:

```json
[
  {
    "type": "addNode",
    "nodeType": "prompt",
    "nodeId": "scene-prompt",
    "position": { "x": 520, "y": 120 },
    "data": { "customTitle": "Scene Prompt", "prompt": "A cinematic forest" }
  },
  {
    "type": "updateNode",
    "nodeId": "scene-prompt",
    "position": { "x": 520, "y": 240 },
    "data": { "prompt": "A cinematic forest at sunrise" }
  },
  {
    "type": "removeNode",
    "nodeId": "obsolete-node"
  },
  {
    "type": "addEdge",
    "source": "scene-prompt",
    "target": "scene-image",
    "sourceHandle": "text",
    "targetHandle": "text"
  },
  {
    "type": "removeEdge",
    "edgeId": "edge-id"
  }
]
```

Operation guidance:

- Use top-level `position` for node position changes.
- Use `data` only for editable node fields.
- Use explicit `nodeId` for every node that later needs edges, updates, runs, or measurement.
- Add nodes before adding edges that reference them.
- Prefer one logical group per edit call, then measure the whole canvas.

## Normalization Rules

The bridge accepts some agent-friendly aliases and normalizes them before sending operations to the canvas.

Operation aliases:

| Input | Normalized |
| --- | --- |
| `action: "add_node"` | `type: "addNode"` |
| `action: "addNode"` | `type: "addNode"` |
| `type: "editNode"` | `type: "updateNode"` |
| `type: "modifyNode"` | `type: "updateNode"` |
| `type: "setNode"` | `type: "updateNode"` |
| `type: "add_edge"` | `type: "addEdge"` |
| `type: "remove_edge"` | `type: "removeEdge"` |

Node type aliases:

| Input | Normalized |
| --- | --- |
| `image`, `image_generation`, `generateImage`, `textToImage`, `text2image` | `nanoBanana` |
| `videoGen`, `video_generation`, `generateVideo` | `generateVideo` |
| `audioGen`, `audio_generation`, `generateAudio` | `generateAudio` |
| `generation3d`, `generateThreeD`, `generate3d` | `generate3d` |
| `llm`, `text_generation`, `generateText` | `llmGenerate` |

Data field aliases:

| Input | Normalized |
| --- | --- |
| `custom_title` | `customTitle` |
| `aspect_ratio` | `aspectRatio` |
| `image_count` | `imageCount` |
| `duration_seconds` | `durationSeconds` |
| `input_prompt` | `inputPrompt` |
| `text` | `prompt` for `prompt`, `inputPrompt` for generation nodes |

Inline prompt expansion:

If an `addNode` operation creates a generation node with `data.inputPrompt`, the bridge expands it into:

1. A `prompt` node with id `<baseId>-prompt`.
2. The requested generation node.
3. An edge from `<baseId>-prompt:text` to `<baseId>:text`.

Because of layout validation, inline prompt generation must include both `position` and `promptPosition`:

```json
{
  "type": "addNode",
  "nodeType": "nanoBanana",
  "nodeId": "shot-01-image",
  "promptPosition": { "x": 520, "y": 120 },
  "position": { "x": 1320, "y": 120 },
  "data": {
    "customTitle": "Shot 01 Image",
    "inputPrompt": "A wide cinematic forest scene, warm sunrise, 16:9",
    "aspectRatio": "16:9",
    "resolution": "2K",
    "imageCount": 1
  }
}
```

## Layout Rules

Default dimensions used by bridge validation:

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

Recommended production columns:

| Stage | x |
| --- | ---: |
| Inputs and briefs | 120 |
| Prompts, arrays, prompt constructors | 520 |
| LLM expansion or analysis | 920 |
| Image generation and image processing | 1320 |
| Video, audio, and 3D generation | 1720 |
| Stitching, comparison, galleries, outputs | 2160 |

Spacing rules:

- Keep at least 120 px between node rectangles.
- Horizontal clearance is enforced for add nodes in the same edit batch when their vertical ranges overlap.
- Overlap formula: `a.x < b.x + b.width`, `a.x + a.width > b.x`, `a.y < b.y + b.height`, and `a.y + a.height > b.y`.
- Use measured dimensions from `measure_nodes` after placement.
- Use row gaps of 480 px for normal rows and 560 px when the row includes `llmGenerate`, `outputGallery`, or `glbViewer`.

## Common Data Fields

Common editable fields across many nodes:

| Field | Use |
| --- | --- |
| `customTitle` | Human-readable node title |
| `isOptional` | Mark source/input as optional when supported |
| `selectedModel` | Primary model choice |
| `parameters` | Provider-specific parameters |
| `fallbackModel` | Backup model |
| `fallbackParameters` | Backup provider parameters |

Common generation fields:

| Field | Nodes | Use |
| --- | --- | --- |
| `inputPrompt` | `nanoBanana`, `generateVideo`, `generateAudio`, `generate3d`, `llmGenerate` | Direct prompt text or instruction |
| `aspectRatio` | `nanoBanana`, `generateVideo` | `1:1`, `2:3`, `3:2`, `3:4`, `4:3`, `4:5`, `5:4`, `9:16`, `16:9`, `21:9` |
| `resolution` | `nanoBanana`, `generateVideo` | Common values: `1K`, `2K`, `4K` |
| `imageCount` | `nanoBanana` | Number of images to generate |
| `durationSeconds` | `generateVideo` | Video length in seconds |
| `fps` | `generateVideo` | Frames per second |
| `soundEnabled` | `generateVideo` | Whether video generation should include sound |
| `temperature` | `llmGenerate` | Creativity for text generation |
| `maxTokens` | `llmGenerate` | Maximum output tokens |

## Handle Compatibility

Use these common handle pairs:

| Source node | Source handle | Target node | Target handle |
| --- | --- | --- | --- |
| `prompt` | `text` | `nanoBanana` | `text` |
| `prompt` | `text` | `generateVideo` | `text` |
| `prompt` | `text` | `generateAudio` | `text` |
| `prompt` | `text` | `generate3d` | `text` |
| `prompt` | `text` | `llmGenerate` | `text` |
| `llmGenerate` | `text` | `nanoBanana` | `text` |
| `llmGenerate` | `text` | `generateVideo` | `text` |
| `imageInput` | `image` | `nanoBanana` | `image` |
| `imageInput` | `image` | `generateVideo` | `image` |
| `imageInput` | `image` | `generate3d` | `image` |
| `nanoBanana` | `image` | `generateVideo` | `image` |
| `nanoBanana` | `image` | `output` | `image` |
| `nanoBanana` | `image` | `outputGallery` | `image` |
| `nanoBanana` | `image` | `imageCompare` | `image` |
| `videoInput` | `video` | `videoTrim` | `video` |
| `videoInput` | `video` | `videoFrameGrab` | `video` |
| `videoInput` | `video` | `videoStitch` | `video` |
| `generateVideo` | `video` | `videoTrim` | `video` |
| `generateVideo` | `video` | `videoStitch` | `video` |
| `generateVideo` | `video` | `output` | `video` |
| `generateVideo` | `video` | `outputGallery` | `video` |
| `generateAudio` | `audio` | `videoStitch` | `audio` |
| `generateAudio` | `audio` | `output` | `audio` |
| `generate3d` | `3d` | `glbViewer` | `3d` |
| `generate3d` | `3d` | `output` | `3d` |
| `glbViewer` | `image` | `nanoBanana` | `image` |
| `videoFrameGrab` | `image` | `nanoBanana` | `image` |
| `videoTrim` | `video` | `videoStitch` | `video` |
| `videoStitch` | `video` | `output` | `video` |

Avoid these mistakes:

- Do not connect `image` to `text`.
- Do not connect `video` to `image` unless using `videoFrameGrab`.
- Do not connect `3d` directly to image-only nodes; use `glbViewer` when an image capture is needed.
- Do not use an `output` node as a source; output nodes have no outputs.

## Node Reference

### `imageInput`

Purpose: user-provided image source.

Handles:

- Inputs: `reference`
- Outputs: `image`

Editable data:

- Common fields only: `customTitle`, `isOptional`

Default data:

```json
{ "image": null, "filename": null, "dimensions": null }
```

Use for uploaded/source images. Connect to image consumers such as `nanoBanana`, `annotation`, `splitGrid`, `generateVideo`, `generate3d`, `imageCompare`, or `output`.

### `audioInput`

Purpose: user-provided audio source.

Handles:

- Inputs: `audio`
- Outputs: `audio`

Editable data:

- Common fields only: `customTitle`, `isOptional`

Default data:

```json
{ "audioFile": null, "filename": null, "duration": null, "format": null }
```

Use for uploaded narration, music, sound effects, or reference audio. Connect to `generateVideo`, `videoStitch`, or `output`.

### `videoInput`

Purpose: user-provided video source.

Handles:

- Inputs: `video`
- Outputs: `video`

Editable data:

- Common fields only: `customTitle`, `isOptional`

Default data:

```json
{ "video": null, "filename": null, "duration": null, "dimensions": null, "format": null }
```

Use when a workflow starts from video. Connect to `videoTrim`, `videoFrameGrab`, `easeCurve`, `videoStitch`, `llmGenerate`, or `output`.

### `prompt`

Purpose: plain text prompt source.

Handles:

- Inputs: `text`
- Outputs: `text`

Editable data:

- `prompt`
- `variableName`
- Common fields

Default data:

```json
{ "prompt": "" }
```

Use for generation instructions, shot descriptions, negative prompts, style notes, narration text, or routing text.

### `promptConstructor`

Purpose: build a prompt from a template and connected variables.

Handles:

- Inputs: `text`
- Outputs: `text`

Editable data:

- `template`
- Common fields

Default data:

```json
{ "template": "", "outputText": null, "unresolvedVars": [] }
```

Use when assembling repeatable prompt formats, such as `Create a @style image of @subject with @lighting`.

### `array`

Purpose: split text into ordered items and emit selected or batched text.

Handles:

- Inputs: `text`
- Outputs: `text`

Editable data:

- `inputText`
- `splitMode`: `delimiter`, `newline`, or `regex`
- `delimiter`
- `regexPattern`
- `trimItems`
- `removeEmpty`
- `batchMode`
- `selectedOutputIndex`
- Common fields

Default data:

```json
{
  "inputText": null,
  "splitMode": "delimiter",
  "delimiter": "*",
  "regexPattern": "",
  "trimItems": true,
  "removeEmpty": true,
  "batchMode": false,
  "selectedOutputIndex": null
}
```

Use for multi-prompt workflows, shot lists, style variations, and batch-like fanout.

### `annotation`

Purpose: draw or mark up an image and output the annotated image.

Handles:

- Inputs: `image`
- Outputs: `image`

Editable data:

- Common fields only

Default data:

```json
{ "sourceImage": null, "annotations": [], "outputImage": null }
```

Use when the user wants to mark a region or guide downstream edits.

### `nanoBanana`

Purpose: AI image generation and image editing.

Handles:

- Inputs: `image`, `text`
- Outputs: `image`

Editable data:

- `inputPrompt`
- `aspectRatio`
- `resolution`
- `imageCount`
- `useGoogleSearch`
- `useImageSearch`
- `selectedModel`
- `parameters`
- `fallbackModel`
- `fallbackParameters`
- Common fields

Default behavior:

- Uses connected prompt text or `inputPrompt`.
- Accepts one or more connected images as references when supported.
- Produces `outputImage`.

Use for text-to-image, image-to-image, style transfer, product image generation, reference-based editing, keyframes, thumbnails, and concept art.

### `generateVideo`

Purpose: AI video generation from text and optional image/video/audio inputs.

Handles:

- Inputs: `image`, `video`, `text`, `audio`
- Outputs: `video`

Editable data:

- `inputPrompt`
- `aspectRatio`
- `resolution`
- `durationSeconds`
- `fps`
- `soundEnabled`
- `selectedModel`
- `parameters`
- `fallbackModel`
- `fallbackParameters`
- Common fields

Default behavior:

- Uses connected text or `inputPrompt` as motion/generation prompt.
- Uses connected image/video/audio when the selected model supports it.
- Produces `outputVideo`.

Use for text-to-video, image-to-video, video extension, product motion, character motion, and shot production.

### `generateAudio`

Purpose: AI audio, TTS, music, or sound effect generation from text.

Handles:

- Inputs: `text`
- Outputs: `audio`

Editable data:

- `inputPrompt`
- `selectedModel`
- `parameters`
- `fallbackModel`
- `fallbackParameters`
- Common fields

Default behavior:

- Uses connected text or `inputPrompt`.
- Produces `outputAudio`.

Use for narration, voiceover, ambience, music beds, and SFX.

### `generate3d`

Purpose: AI 3D model generation.

Handles:

- Inputs: `image`, `text`
- Outputs: `3d`

Editable data:

- `inputPrompt`
- `selectedModel`
- `parameters`
- `fallbackModel`
- `fallbackParameters`
- Common fields

Default behavior:

- Uses connected image and/or text.
- Produces `output3dUrl`.

Connect to `glbViewer` for preview or to `output` for final 3D output.

### `llmGenerate`

Purpose: LLM text generation from text plus optional images or videos.

Handles:

- Inputs: `text`, `image`, `video`
- Outputs: `text`

Editable data:

- `inputPrompt`
- `provider`
- `model`
- `temperature`
- `maxTokens`
- `fallbackModel`
- `fallbackParameters`
- Common fields

Provider values:

- `popiserver`
- `newapiwg`
- `google`
- `openai`
- `anthropic`

Default values:

- `temperature`: `0.7`
- `maxTokens`: `8192`

Use for prompt expansion, image/video analysis, rewrite, classification, routing text, shot breakdowns, and creative variants.

### `splitGrid`

Purpose: split an image into grid cells and create parallel reference branches.

Handles:

- Inputs: `image`
- Outputs: `reference`

Editable data:

- `targetCount`
- `defaultPrompt`
- `generateSettings`
- Common fields

Default data:

```json
{
  "targetCount": 6,
  "defaultPrompt": "",
  "generateSettings": {
    "aspectRatio": "1:1",
    "resolution": "1K",
    "model": "nano-banana-pro",
    "useGoogleSearch": false,
    "useImageSearch": false
  }
}
```

Use for splitting a composite image into 4, 6, 8, 9, or 10 regions and generating variants from each region.

### `output`

Purpose: display final output media.

Handles:

- Inputs: `image`, `video`, `audio`, `3d`
- Outputs: none

Editable data:

- `outputFilename`
- Common fields

Default data:

```json
{ "image": null, "outputFilename": "" }
```

Use as the final endpoint for single image, video, audio, or 3D outputs.

### `outputGallery`

Purpose: display multiple images or videos in a gallery.

Handles:

- Inputs: `image`, `video`
- Outputs: none

Editable data:

- Common fields only

Default data:

```json
{ "images": [], "videos": [] }
```

Use for multi-shot outputs, variant review, and batch image/video collections.

### `imageCompare`

Purpose: compare two images side by side with a slider.

Handles:

- Inputs: `image`
- Outputs: none

Editable data:

- Common fields only

Default data:

```json
{ "imageA": null, "imageB": null }
```

Use for before/after comparisons or comparing two generations.

### `videoStitch`

Purpose: concatenate multiple video clips and optionally attach audio.

Handles:

- Inputs: `video`, `audio`
- Outputs: `video`

Editable data:

- `loopCount`: `1`, `2`, or `3`
- Common fields

Default data:

```json
{ "clips": [], "clipOrder": [], "outputVideo": null, "loopCount": 1 }
```

Use for combining generated shots into one final video or adding audio to a video sequence.

### `easeCurve`

Purpose: apply a speed/easing curve to video.

Handles:

- Inputs: `video`, `easeCurve`
- Outputs: `video`, `easeCurve`

Editable data:

- `bezierHandles`
- `easingPreset`
- `outputDuration`
- Common fields

Default data:

```json
{ "bezierHandles": [0.445, 0.05, 0.55, 0.95], "easingPreset": "easeInOutSine", "outputDuration": 1.5 }
```

Use for timing changes before stitching or final output.

### `videoTrim`

Purpose: trim a video to a start/end range.

Handles:

- Inputs: `video`
- Outputs: `video`

Editable data:

- `startTime`
- `endTime`
- Common fields

Default data:

```json
{ "startTime": 0, "endTime": 0 }
```

Use before stitching or output when only a segment is needed.

### `videoFrameGrab`

Purpose: extract the first or last frame from a video as an image.

Handles:

- Inputs: `video`
- Outputs: `image`

Editable data:

- `framePosition`: `first` or `last`
- Common fields

Default data:

```json
{ "framePosition": "first", "outputImage": null }
```

Use to create an image reference from video for generation, continuity, or output.

### `router`

Purpose: passthrough routing node for many media types.

Handles:

- Inputs: `image`, `text`, `video`, `audio`, `3d`, `easeCurve`, `generic-input`
- Outputs: `image`, `text`, `video`, `audio`, `3d`, `easeCurve`, `generic-output`

Editable data:

- Common fields only

Default data:

```json
{}
```

Use to reorganize a complex graph without changing media content.

### `switch`

Purpose: toggle-controlled routing with named outputs.

Handles:

- Inputs: `generic-input`, `image`, `text`, `video`, `audio`, `3d`, `easeCurve`
- Outputs: dynamic switch handles

Editable data:

- `switches`
- Common fields

Default data shape:

```json
{
  "switches": [
    { "id": "generated-id", "name": "Output 1", "enabled": true }
  ]
}
```

Use for manually enabling or disabling branches.

### `conditionalSwitch`

Purpose: route text by matching rules.

Handles:

- Inputs: `text`
- Outputs: `default`, plus dynamic `rule-*` handles

Editable data:

- `rules`
- `evaluationPaused`
- Common fields

Rule shape:

```json
{
  "id": "rule-example",
  "value": "keyword",
  "mode": "contains",
  "label": "Rule 1",
  "isMatched": false
}
```

Match modes:

- `exact`
- `contains`
- `starts-with`
- `ends-with`

Use for text classification, prompt routing, style routing, or conditional branches. Connect unmatched text through `default`.

### `glbViewer`

Purpose: load/display a GLB model and capture the 3D viewport as an image.

Handles:

- Inputs: `3d`
- Outputs: `image`

Editable data:

- Common fields only

Default data:

```json
{ "glbUrl": null, "filename": null, "capturedImage": null }
```

Use after `generate3d` when the workflow needs preview, inspection, or image capture from a 3D model.

## Workflow Templates

The examples below are operation arrays for `edit_canvas`. Adjust ids, prompts, and positions based on the current canvas and measurements.

### Text To Image

```json
[
  { "type": "addNode", "nodeType": "prompt", "nodeId": "hero-prompt", "position": { "x": 520, "y": 120 }, "data": { "customTitle": "Hero Prompt", "prompt": "A clean product hero image, premium studio lighting, 16:9" } },
  { "type": "addNode", "nodeType": "nanoBanana", "nodeId": "hero-image", "position": { "x": 1320, "y": 120 }, "data": { "customTitle": "Hero Image", "aspectRatio": "16:9", "resolution": "2K", "imageCount": 1 } },
  { "type": "addNode", "nodeType": "output", "nodeId": "hero-output", "position": { "x": 2160, "y": 120 }, "data": { "customTitle": "Hero Output" } },
  { "type": "addEdge", "source": "hero-prompt", "target": "hero-image", "sourceHandle": "text", "targetHandle": "text" },
  { "type": "addEdge", "source": "hero-image", "target": "hero-output", "sourceHandle": "image", "targetHandle": "image" }
]
```

### Inline Text To Image

This is shorter, but it creates a prompt node automatically. Always include `promptPosition`.

```json
[
  {
    "type": "addNode",
    "nodeType": "nanoBanana",
    "nodeId": "hero-image",
    "promptPosition": { "x": 520, "y": 120 },
    "position": { "x": 1320, "y": 120 },
    "data": {
      "customTitle": "Hero Image",
      "inputPrompt": "A clean product hero image, premium studio lighting, 16:9",
      "aspectRatio": "16:9",
      "resolution": "2K",
      "imageCount": 1
    }
  },
  { "type": "addNode", "nodeType": "output", "nodeId": "hero-output", "position": { "x": 2160, "y": 120 }, "data": { "customTitle": "Hero Output" } },
  { "type": "addEdge", "source": "hero-image", "target": "hero-output", "sourceHandle": "image", "targetHandle": "image" }
]
```

### Image To Image With Before/After

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

```json
[
  { "type": "addNode", "nodeType": "imageInput", "nodeId": "video-source", "position": { "x": 120, "y": 120 }, "data": { "customTitle": "Video Source" } },
  { "type": "addNode", "nodeType": "prompt", "nodeId": "motion-prompt", "position": { "x": 520, "y": 120 }, "data": { "customTitle": "Motion Prompt", "prompt": "Slow cinematic camera push-in, subtle natural motion, no text overlays" } },
  { "type": "addNode", "nodeType": "generateVideo", "nodeId": "generated-video", "position": { "x": 1720, "y": 120 }, "data": { "customTitle": "Generated Video", "durationSeconds": 5, "aspectRatio": "16:9", "resolution": "1080p", "soundEnabled": false } },
  { "type": "addNode", "nodeType": "output", "nodeId": "video-output", "position": { "x": 2160, "y": 120 }, "data": { "customTitle": "Video Output" } },
  { "type": "addEdge", "source": "video-source", "target": "generated-video", "sourceHandle": "image", "targetHandle": "image" },
  { "type": "addEdge", "source": "motion-prompt", "target": "generated-video", "sourceHandle": "text", "targetHandle": "text" },
  { "type": "addEdge", "source": "generated-video", "target": "video-output", "sourceHandle": "video", "targetHandle": "video" }
]
```

### Prompt Expansion To Image

```json
[
  { "type": "addNode", "nodeType": "prompt", "nodeId": "brief", "position": { "x": 520, "y": 120 }, "data": { "customTitle": "Brief", "prompt": "A futuristic city at sunrise" } },
  { "type": "addNode", "nodeType": "llmGenerate", "nodeId": "expand-brief", "position": { "x": 920, "y": 120 }, "data": { "customTitle": "Prompt Expansion", "inputPrompt": "Expand the connected brief into a precise visual generation prompt. Include subject, style, lighting, composition, lens, mood, and negative constraints.", "temperature": 0.7, "maxTokens": 1200 } },
  { "type": "addNode", "nodeType": "nanoBanana", "nodeId": "expanded-image", "position": { "x": 1320, "y": 120 }, "data": { "customTitle": "Expanded Image", "aspectRatio": "16:9", "resolution": "2K", "imageCount": 1 } },
  { "type": "addNode", "nodeType": "output", "nodeId": "expanded-output", "position": { "x": 2160, "y": 120 }, "data": { "customTitle": "Expanded Output" } },
  { "type": "addEdge", "source": "brief", "target": "expand-brief", "sourceHandle": "text", "targetHandle": "text" },
  { "type": "addEdge", "source": "expand-brief", "target": "expanded-image", "sourceHandle": "text", "targetHandle": "text" },
  { "type": "addEdge", "source": "expanded-image", "target": "expanded-output", "sourceHandle": "image", "targetHandle": "image" }
]
```

### Three-Shot Video With Stitch

Use one row per shot and connect each generated video to `videoStitch`.

```json
[
  { "type": "addNode", "nodeType": "prompt", "nodeId": "shot-01-prompt", "position": { "x": 520, "y": 120 }, "data": { "customTitle": "Shot 01 Prompt", "prompt": "Shot 01: wide establishing shot of a warm forest at sunrise" } },
  { "type": "addNode", "nodeType": "nanoBanana", "nodeId": "shot-01-image", "position": { "x": 1320, "y": 120 }, "data": { "customTitle": "Shot 01 Image", "aspectRatio": "16:9", "resolution": "2K" } },
  { "type": "addNode", "nodeType": "generateVideo", "nodeId": "shot-01-video", "position": { "x": 1720, "y": 120 }, "data": { "customTitle": "Shot 01 Video", "inputPrompt": "Slow push-in, leaves moving gently, cinematic natural motion", "durationSeconds": 5, "aspectRatio": "16:9", "soundEnabled": false } },

  { "type": "addNode", "nodeType": "prompt", "nodeId": "shot-02-prompt", "position": { "x": 520, "y": 680 }, "data": { "customTitle": "Shot 02 Prompt", "prompt": "Shot 02: close shot of the main character discovering a glowing object" } },
  { "type": "addNode", "nodeType": "nanoBanana", "nodeId": "shot-02-image", "position": { "x": 1320, "y": 680 }, "data": { "customTitle": "Shot 02 Image", "aspectRatio": "16:9", "resolution": "2K" } },
  { "type": "addNode", "nodeType": "generateVideo", "nodeId": "shot-02-video", "position": { "x": 1720, "y": 680 }, "data": { "customTitle": "Shot 02 Video", "inputPrompt": "Small camera drift, object glowing softly, character reacts with curiosity", "durationSeconds": 5, "aspectRatio": "16:9", "soundEnabled": false } },

  { "type": "addNode", "nodeType": "prompt", "nodeId": "shot-03-prompt", "position": { "x": 520, "y": 1240 }, "data": { "customTitle": "Shot 03 Prompt", "prompt": "Shot 03: final wide shot with the forest illuminated by magic" } },
  { "type": "addNode", "nodeType": "nanoBanana", "nodeId": "shot-03-image", "position": { "x": 1320, "y": 1240 }, "data": { "customTitle": "Shot 03 Image", "aspectRatio": "16:9", "resolution": "2K" } },
  { "type": "addNode", "nodeType": "generateVideo", "nodeId": "shot-03-video", "position": { "x": 1720, "y": 1240 }, "data": { "customTitle": "Shot 03 Video", "inputPrompt": "Light spreads through the forest, gentle cinematic pull-back", "durationSeconds": 5, "aspectRatio": "16:9", "soundEnabled": false } },

  { "type": "addNode", "nodeType": "videoStitch", "nodeId": "final-stitch", "position": { "x": 2160, "y": 680 }, "data": { "customTitle": "Final Stitch", "loopCount": 1 } },
  { "type": "addNode", "nodeType": "output", "nodeId": "final-output", "position": { "x": 2680, "y": 680 }, "data": { "customTitle": "Final Output", "outputFilename": "three-shot-video" } },

  { "type": "addEdge", "source": "shot-01-prompt", "target": "shot-01-image", "sourceHandle": "text", "targetHandle": "text" },
  { "type": "addEdge", "source": "shot-01-image", "target": "shot-01-video", "sourceHandle": "image", "targetHandle": "image" },
  { "type": "addEdge", "source": "shot-01-video", "target": "final-stitch", "sourceHandle": "video", "targetHandle": "video" },

  { "type": "addEdge", "source": "shot-02-prompt", "target": "shot-02-image", "sourceHandle": "text", "targetHandle": "text" },
  { "type": "addEdge", "source": "shot-02-image", "target": "shot-02-video", "sourceHandle": "image", "targetHandle": "image" },
  { "type": "addEdge", "source": "shot-02-video", "target": "final-stitch", "sourceHandle": "video", "targetHandle": "video" },

  { "type": "addEdge", "source": "shot-03-prompt", "target": "shot-03-image", "sourceHandle": "text", "targetHandle": "text" },
  { "type": "addEdge", "source": "shot-03-image", "target": "shot-03-video", "sourceHandle": "image", "targetHandle": "image" },
  { "type": "addEdge", "source": "shot-03-video", "target": "final-stitch", "sourceHandle": "video", "targetHandle": "video" },

  { "type": "addEdge", "source": "final-stitch", "target": "final-output", "sourceHandle": "video", "targetHandle": "video" }
]
```

For production, place and measure this template incrementally by row instead of sending all nodes at once.

## Run And Debug Guide

Common tool errors:

| Error | Cause | Fix |
| --- | --- | --- |
| `edit_canvas requires an "operations" array` | Missing or invalid `operations` | Send `{ "operations": [...] }` |
| `addNode "<id>" requires an explicit position` | New node lacks `position`; inline prompt lacks `promptPosition` | Add `position` to every add node and `promptPosition` to inline generation |
| `addNode "<a>" overlaps "<b>"` | New add-node rectangles intersect | Move one node using default or measured dimensions |
| `need at least 120px horizontal clearance` | Same-row nodes are too close horizontally | Increase x gap between columns |
| `measure_nodes requires a non-empty "nodeIds" array` | Missing node ids | Read canvas, collect node ids, retry |
| `PopiTV canvas is not open` | No active canvas handler | Open the PopiTV skill canvas for the session and retry |
| `Timed out waiting for PopiTV canvas response` | Canvas bridge did not respond in time | Refresh/open canvas, then retry read or edit |

Debug sequence:

1. Call `read_canvas` with `refresh: true`.
2. Inspect `nodes`, `edges`, `isRunning`, and `currentNodeIds`.
3. If layout is suspect, call `measure_nodes` for all node ids.
4. Fix missing positions or overlaps with `updateNode` position edits.
5. Validate edge endpoints and handles.
6. Run selected nodes first when diagnosing one branch.
7. Read the canvas again after the run to inspect status and outputs.

## Preflight Checklist

Before returning an edit plan or running a workflow:

- The current canvas snapshot has been read.
- All new nodes have stable ids.
- Every `addNode` has explicit `position`.
- Inline generation nodes with `inputPrompt` also have `promptPosition`.
- All current nodes have been measured after add/move operations.
- No measured node rectangles overlap.
- New same-row nodes have at least 120 px horizontal clearance.
- Every edge endpoint exists.
- Every edge uses compatible source and target handles.
- Generation nodes have connected inputs or valid `inputPrompt`.
- Final user-visible assets connect to `output`, `outputGallery`, or `imageCompare`.
- Full workflow is not already running unless the task is to stop or inspect it.
