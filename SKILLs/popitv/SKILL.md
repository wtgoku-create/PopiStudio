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
- Use `popitv__measure_nodes` with `nodeIds` when exact rendered node bounds are needed; it returns `{ id, x, y, width, height }[]`.
- Node layout is a hard requirement, not a best effort. Never leave overlapping nodes on the canvas.
- After every `popitv__edit_canvas` call that adds or moves nodes, immediately call `popitv__measure_nodes` for all current canvas node ids before adding or moving any more nodes.
- For multi-node layout work, add and measure incrementally. Do not create a large batch of nodes before measuring; place one logical node group, measure the full canvas, beautify its position, confirm it does not overlap, then place the next.
- If full-canvas measurement shows any overlap, update the overlapping node positions with another `popitv__edit_canvas` call, then measure the full canvas again. Do not run the workflow or report completion while overlap remains.
- Do not pretend a canvas tool ran if the tool is unavailable.
- Keep workflow changes explicit: describe which nodes, edges, prompts, or outputs changed.
- After running a workflow, report the run status and the result assets that matter.

## Expected Tool Flow

When PopiTV tools are available, use this order:

1. Inspect the session canvas with `popitv__read_canvas`.
2. Measure existing nodes with `popitv__measure_nodes` when layout decisions need exact rendered sizes.
3. Add nodes incrementally with `popitv__edit_canvas`: one standalone node at a time, or one automatic prompt+generation pair at a time.
4. Immediately measure all current canvas node ids with `popitv__measure_nodes`, not only the newly added node.
5. Compare every measured rectangle against every other measured rectangle. If any overlap or spacing violation exists, update the overlapping node positions with `popitv__edit_canvas` and measure the full canvas again.
6. Repeat steps 3-5 until every node is placed and no rectangles overlap.
7. Run the workflow or selected nodes with `popitv__run_canvas`.
8. Read status, errors, and result assets with `popitv__read_canvas`.
9. Summarize the canvas state for the user, including that layout was measured and checked.

If tools are not available yet, produce a concrete workflow plan instead of claiming live canvas edits.

## Node Dimensions and Layout

Use this default size table when exact measurements are not available:

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

Coordinates are node top-left positions. Never place two nodes at the same `position`, and never reuse a position from an existing node. Keep at least 120 px horizontal and vertical clearance between node rectangles:

- Horizontal clearance: next node x should be at least `previous.x + previous.width + 120`.
- Vertical clearance in the same stage column: next node y should be at least `previous.y + previous.height + 120`.
- Prefer measured dimensions from `popitv__measure_nodes`; fall back to the table only when measurement is unavailable.
- Treat two nodes as overlapping when their measured rectangles intersect: `a.x < b.x + b.width`, `a.x + a.width > b.x`, `a.y < b.y + b.height`, and `a.y + a.height > b.y`.
- For beautified layouts, align stages into stable columns and align related nodes into rows. Use measured `x`, `y`, `width`, and `height` values to calculate the next free position.
- Every `addNode` operation must include an explicit `position`. For inline generation nodes with `data.inputPrompt`, also include `promptPosition` so the auto-created prompt node does not fall back to a default position.
- Keep stage columns far enough apart. With default sizes, use x values like `200`, `640`, `1060`, and `1540` instead of placing adjacent stages too close together.
- Before finishing any canvas edit task, perform a final `popitv__measure_nodes` pass for all current canvas node ids and update any remaining overlapping node positions.

## Edit Operation Examples

Use `popitv__edit_canvas` with an `operations` array.

Common node and edge CRUD operations:

```json
{
  "sessionId": "<current session id>",
  "operations": [
    {
      "type": "addNode",
      "nodeType": "prompt",
      "nodeId": "my-prompt-node",
      "position": { "x": 200, "y": 200 },
      "data": { "prompt": "A beautiful sunset" }
    },
    {
      "type": "removeNode",
      "nodeId": "node-to-remove"
    },
    {
      "type": "updateNode",
      "nodeId": "node-id",
      "position": { "x": 300, "y": 300 },
      "data": { "prompt": "Updated prompt" }
    },
    {
      "type": "addEdge",
      "source": "node-1",
      "target": "node-2",
      "sourceHandle": "output",
      "targetHandle": "input"
    },
    {
      "type": "removeEdge",
      "edgeId": "edge-id"
    }
  ]
}
```

For layout-sensitive workflows, do not create many nodes in one large `edit_canvas` call. Add one logical node group, measure it, then add the next group. A logical group may be:

- One standalone node, such as a `prompt`, `generateVideo`, or `generateAudio` node.
- One inline generation node with `data.inputPrompt`; the bridge will create the connected prompt node and generation node together.
- One edge that connects two already placed nodes.

After each add, call `popitv__measure_nodes` with all current canvas node ids, then use those measured `{ id, x, y, width, height }` values and the latest canvas snapshot to decide the next node position. This is mandatory for multi-stage canvases so nodes do not stack on top of each other. If any measured node overlaps another node, immediately update the overlapping node position to the next free position and measure the full canvas again.

For multi-stage workflows, arrange nodes from left to right by stage and from top to bottom by shot/task row:

- `prompt`: x around 200
- `nanoBanana` / `llmGenerate`: x around 600
- `generateVideo`: x around 1020
- `generateAudio` / `generate3d`: x around 1500

Leave at least one node height plus about 120 px vertical spacing between rows. Do not omit `position`; the Popiai bridge rejects add-node edits that do not provide explicit non-overlapping positions. When you provide `position`, calculate it from the table or measured sizes; do not repeat coordinates across nodes.

Add a runnable image generation node. Inline `inputPrompt` creates a connected prompt node automatically, so the node can be run later:

```json
{
  "sessionId": "<current session id>",
  "operations": [
    {
      "type": "addNode",
      "nodeType": "nanoBanana",
      "nodeId": "shot-1-image",
      "position": { "x": 600, "y": 200 },
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
      "position": { "x": 200, "y": 200 },
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
      "position": { "x": 1020, "y": 200 },
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
