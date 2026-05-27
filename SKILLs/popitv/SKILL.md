---
name: popitv
description: 'Open and operate a session-bound PopiTV canvas for visual media workflows.'
official: true
category: '图像制作'
version: 0.1.0
---

# PopiTV Canvas

Use PopiTV when the user wants to build, inspect, modify, run, or discuss a visual workflow canvas in the current Popiai session.

## Core Rules

- Treat the canvas as part of the current session context.
- Use the `<popitv_canvas_context>` block in the system context as the current canvas snapshot when it is present.
- Prefer structured PopiTV canvas tools when they are available: `mcp_popitv_read_canvas`, `mcp_popitv_edit_canvas`, `mcp_popitv_run_canvas`, and `mcp_popitv_stop_canvas`.
- Do not pretend a canvas tool ran if the tool is unavailable.
- Keep workflow changes explicit: describe which nodes, edges, prompts, or outputs changed.
- After running a workflow, report the run status and the result assets that matter.

## Expected Tool Flow

When PopiTV tools are available, use this order:

1. Inspect the session canvas with `mcp_popitv_read_canvas`.
2. Apply structured workflow edits with `mcp_popitv_edit_canvas`.
3. Run the workflow or selected nodes with `mcp_popitv_run_canvas`.
4. Read status, errors, and result assets with `mcp_popitv_read_canvas`.
5. Summarize the canvas state for the user.

If tools are not available yet, produce a concrete workflow plan instead of claiming live canvas edits.

## Edit Operation Examples

Use `mcp_popitv_edit_canvas` with an `operations` array.

Add a runnable image generation node. Inline `inputPrompt` creates a connected prompt node automatically, so the node can be run later:

```json
{
  "sessionId": "<current session id>",
  "operations": [
    {
      "type": "addNode",
      "nodeType": "nanoBanana",
      "nodeId": "shot-1-image",
      "position": { "x": 120, "y": 160 },
      "data": {
        "customTitle": "Shot 1",
        "inputPrompt": "儿童绘本风格，全景，阳光明媚的大森林，16:9",
        "aspectRatio": "16:9"
      }
    }
  ]
}
```

Add a text prompt node:

```json
{
  "sessionId": "<current session id>",
  "operations": [
    {
      "type": "addNode",
      "nodeType": "prompt",
      "position": { "x": 120, "y": 160 },
      "data": {
        "customTitle": "Prompt 1",
        "prompt": "儿童绘本风格，全景，阳光明媚的大森林，16:9"
      }
    }
  ]
}
```

Supported node types include `prompt`, `nanoBanana`, `generateVideo`, `generateAudio`, `generate3d`, and `llmGenerate`. For image generation, prefer `nodeType: "nanoBanana"` and put the prompt in `data.inputPrompt`; the bridge will create the required text prompt connection.

Create a 5-second video node from an existing image node:

```json
{
  "sessionId": "<current session id>",
  "operations": [
    {
      "type": "addNode",
      "nodeType": "generateVideo",
      "nodeId": "shot-1-video",
      "position": { "x": 520, "y": 160 },
      "data": {
        "customTitle": "Shot 1 Video",
        "inputPrompt": "儿童绘本动画，镜头轻微推进，老虎眨眼，树叶轻轻摆动，5秒，16:9",
        "durationSeconds": 5,
        "aspectRatio": "16:9"
      }
    },
    {
      "type": "addEdge",
      "source": "<existing image node id>",
      "target": "shot-1-video",
      "sourceHandle": "image",
      "targetHandle": "image"
    }
  ]
}
```

Do not tell the user to switch an image node into video mode. To generate video, add `generateVideo` nodes and connect existing image outputs to them.
