---
name: popitv
description: 'Provides PopiTV canvas support for Popiai sessions, enabling visual node-based orchestration of complete media creation workflows covering image generation, video generation, audio synthesis, and 3D modeling.'
official: true
category: '图像制作'
version: 0.1.0
---

# PopiTV Canvas

Use PopiTV when the user wants to build, inspect, modify, run, or discuss a visual workflow canvas in the current Popiai session.

## Core Rules

- Treat the canvas as part of the current session context.
- Use the `<popitv_canvas_context>` block in the system context as the current canvas snapshot when it is present.
- Prefer structured PopiTV canvas tools when they are available: `popitv__read_canvas`, `popitv__edit_canvas`, `popitv__run_canvas`, and `popitv__stop_canvas`.
- Use `popitv__measure_nodes` with `nodeIds` when exact rendered node sizes are needed; it returns `{ id, width, height }[]`.
- For multi-node layout work, add and measure incrementally. Do not create a large batch of nodes before measuring; place one logical node group, measure it, then place the next.
- Do not pretend a canvas tool ran if the tool is unavailable.
- Keep workflow changes explicit: describe which nodes, edges, prompts, or outputs changed.
- After running a workflow, report the run status and the result assets that matter.

## Expected Tool Flow

When PopiTV tools are available, use this order:

1. Inspect the session canvas with `popitv__read_canvas`.
2. Measure existing nodes with `popitv__measure_nodes` when layout decisions need exact rendered sizes.
3. Add nodes incrementally with `popitv__edit_canvas`: one standalone node at a time, or one automatic prompt+generation pair at a time.
4. Immediately read or measure the newly added node ids with `popitv__measure_nodes` before placing the next node.
5. Repeat steps 3-4 until the workflow is complete.
6. Run the workflow or selected nodes with `popitv__run_canvas`.
7. Read status, errors, and result assets with `popitv__read_canvas`.
8. Summarize the canvas state for the user.

If tools are not available yet, produce a concrete workflow plan instead of claiming live canvas edits.

## Edit Operation Examples

Use `popitv__edit_canvas` with an `operations` array.

For layout-sensitive workflows, do not create many nodes in one large `edit_canvas` call. Add one logical node group, measure it, then add the next group. A logical group may be:

- One standalone node, such as a `prompt`, `generateVideo`, or `generateAudio` node.
- One inline generation node with `data.inputPrompt`; the bridge will create the connected prompt node and generation node together.
- One edge that connects two already placed nodes.

After each add, call `popitv__measure_nodes` with the ids that were just created, then use those measured `{ id, width, height }` values and the latest canvas snapshot to decide the next node position. This is required for multi-stage canvases so nodes do not stack on top of each other.

For multi-stage workflows, arrange nodes from left to right by stage and from top to bottom by shot/task row:

- `prompt`: x around 200
- `nanoBanana` / `llmGenerate`: x around 600
- `generateVideo`: x around 1020
- `generateAudio` / `generate3d`: x around 1500

Leave at least one node height plus about 80 px vertical spacing between rows. If you omit `position`, the Popiai bridge will assign a stage-aware default position using PopiTV node dimensions and avoid existing nodes when a live canvas snapshot is available.

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
