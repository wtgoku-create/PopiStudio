import { describe, expect, test, vi } from 'vitest';

import {
  executePopiTVMcpTool,
  getPopiTVMcpToolManifest,
  normalizePopiTVEditOperations,
  POPITV_MCP_SERVER_NAME,
} from './popiTVMcpBridgeTools';

describe('PopiTV MCP bridge tools', () => {
  test('declares the native PopiTV tool manifest', () => {
    const manifest = getPopiTVMcpToolManifest();

    expect(manifest.map(tool => tool.name)).toEqual([
      'read_canvas',
      'edit_canvas',
      'measure_nodes',
      'run_canvas',
      'stop_canvas',
    ]);
    expect(manifest.every(tool => tool.server === POPITV_MCP_SERVER_NAME)).toBe(true);
    expect(manifest.find(tool => tool.name === 'edit_canvas')?.inputSchema.required).toEqual([
      'operations',
    ]);
  });

  test('maps read_canvas to a snapshot renderer request', async () => {
    const requestCanvas = vi.fn(async () => ({
      workflowName: 'Storyboard',
      nodeCount: 2,
      edgeCount: 1,
    }));

    const result = await executePopiTVMcpTool(
      POPITV_MCP_SERVER_NAME,
      'read_canvas',
      { sessionId: 'session-1' },
      requestCanvas,
    );

    expect(requestCanvas).toHaveBeenCalledWith({
      bridgeType: 'popitv:get-snapshot',
      sessionId: 'session-1',
    });
    expect(result?.isError).toBe(false);
    expect(result?.content[0].text).toContain('"workflowName": "Storyboard"');
  });

  test('reads canvas snapshots from cache when refresh is not requested', async () => {
    const requestCanvas = vi.fn(async () => ({
      workflowName: 'Fresh',
      nodeCount: 1,
      edgeCount: 0,
    }));
    const readCachedCanvas = vi.fn(() => ({
      workflowName: 'Cached',
      nodeCount: 2,
      edgeCount: 1,
    }));

    const result = await executePopiTVMcpTool(
      POPITV_MCP_SERVER_NAME,
      'read_canvas',
      { sessionId: 'session-1' },
      requestCanvas,
      readCachedCanvas,
    );

    expect(readCachedCanvas).toHaveBeenCalledWith('session-1');
    expect(requestCanvas).not.toHaveBeenCalled();
    expect(result?.details).toEqual({
      server: POPITV_MCP_SERVER_NAME,
      tool: 'read_canvas',
      cached: true,
    });
    expect(result?.content[0].text).toContain('"workflowName": "Cached"');
  });

  test('bypasses cached snapshots when read_canvas refresh is requested', async () => {
    const requestCanvas = vi.fn(async () => ({
      workflowName: 'Fresh',
      nodeCount: 1,
      edgeCount: 0,
    }));
    const readCachedCanvas = vi.fn(() => ({
      workflowName: 'Cached',
      nodeCount: 2,
      edgeCount: 1,
    }));

    const result = await executePopiTVMcpTool(
      POPITV_MCP_SERVER_NAME,
      'read_canvas',
      { sessionId: 'session-1', refresh: true },
      requestCanvas,
      readCachedCanvas,
    );

    expect(readCachedCanvas).not.toHaveBeenCalled();
    expect(requestCanvas).toHaveBeenCalledWith({
      bridgeType: 'popitv:get-snapshot',
      sessionId: 'session-1',
    });
    expect(result?.content[0].text).toContain('"workflowName": "Fresh"');
  });

  test('maps edit_canvas operations to the renderer edit bridge', async () => {
    const operations = [{ type: 'updateNode', nodeId: 'prompt-1', data: { prompt: 'new' } }];
    const requestCanvas = vi.fn(async () => ({ operationResult: { applied: 1, skipped: [] } }));

    const result = await executePopiTVMcpTool(
      POPITV_MCP_SERVER_NAME,
      'edit_canvas',
      { sessionId: 'session-1', operations },
      requestCanvas,
    );

    expect(requestCanvas).toHaveBeenCalledWith({
      bridgeType: 'popitv:apply-edit-operations',
      sessionId: 'session-1',
      operations: [
        {
          type: 'updateNode',
          nodeId: 'prompt-1',
          data: {
            prompt: 'new',
            inputPrompt: 'new',
          },
        },
      ],
    });
    expect(result?.isError).toBe(false);
    expect(result?.content[0].text).toContain('"applied": 1');
  });

  test('normalizes agent-friendly edit operation aliases', () => {
    expect(
      normalizePopiTVEditOperations([
        {
          action: 'add_node',
          nodeType: 'image_generation',
          nodeId: 'shot-1',
          position: { x: 100, y: 100 },
          data: {
            text: 'storybook tiger',
            aspect_ratio: '16:9',
            custom_title: 'Shot 1',
          },
        },
        {
          action: 'addNode',
          nodeType: 'prompt',
          data: { text: 'prompt text' },
        },
      ]),
    ).toEqual([
      {
        type: 'addNode',
        nodeType: 'prompt',
        nodeId: 'shot-1-prompt',
        data: {
          prompt: 'storybook tiger',
          customTitle: 'Shot 1 Prompt',
        },
      },
      {
        type: 'addNode',
        nodeType: 'nanoBanana',
        nodeId: 'shot-1',
        position: { x: 100, y: 100 },
        data: {
          inputPrompt: 'storybook tiger',
          aspectRatio: '16:9',
          customTitle: 'Shot 1',
        },
      },
      {
        type: 'addEdge',
        source: 'shot-1-prompt',
        target: 'shot-1',
        sourceHandle: 'text',
        targetHandle: 'text',
      },
      {
        type: 'addNode',
        nodeType: 'prompt',
        data: { prompt: 'prompt text' },
      },
    ]);
  });

  test('normalizes editNode text updates without knowing the target node type', () => {
    expect(
      normalizePopiTVEditOperations([
        {
          type: 'editNode',
          nodeId: 'node-1',
          data: { text: 'updated prompt' },
        },
      ]),
    ).toEqual([
      {
        type: 'updateNode',
        nodeId: 'node-1',
        data: {
          prompt: 'updated prompt',
          inputPrompt: 'updated prompt',
        },
      },
    ]);
  });

  test('sends normalized edit_canvas operations to the renderer edit bridge', async () => {
    const requestCanvas = vi.fn(async () => ({ operationResult: { applied: 1, skipped: [] } }));
    const readCachedCanvas = vi.fn(() => ({
      nodes: [{ id: 'existing-node', type: 'prompt', position: { x: 200, y: 200 } }],
    }));

    await executePopiTVMcpTool(
      POPITV_MCP_SERVER_NAME,
      'edit_canvas',
      {
        sessionId: 'session-1',
        operations: [
          {
            action: 'addNode',
            nodeType: 'image_generation',
            nodeId: 'gen-1',
            promptPosition: { x: 200, y: 200 },
            position: { x: 640, y: 200 },
            data: { prompt: 'new image', aspect_ratio: '16:9' },
          },
        ],
      },
      requestCanvas,
      readCachedCanvas,
    );

    expect(readCachedCanvas).not.toHaveBeenCalled();
    expect(requestCanvas).toHaveBeenCalledWith({
      bridgeType: 'popitv:apply-edit-operations',
      sessionId: 'session-1',
      operations: [
        {
          type: 'addNode',
          nodeType: 'prompt',
          nodeId: 'gen-1-prompt',
          position: { x: 200, y: 200 },
          data: { prompt: 'new image' },
        },
        {
          type: 'addNode',
          nodeType: 'nanoBanana',
          nodeId: 'gen-1',
          promptPosition: { x: 200, y: 200 },
          position: { x: 640, y: 200 },
          data: { inputPrompt: 'new image', aspectRatio: '16:9' },
        },
        {
          type: 'addEdge',
          source: 'gen-1-prompt',
          target: 'gen-1',
          sourceHandle: 'text',
          targetHandle: 'text',
        },
      ],
    });
  });

  test('rejects addNode operations without explicit positions', async () => {
    const requestCanvas = vi.fn();

    const result = await executePopiTVMcpTool(
      POPITV_MCP_SERVER_NAME,
      'edit_canvas',
      {
        operations: [
          {
            type: 'addNode',
            nodeType: 'prompt',
            nodeId: 'prompt-1',
            data: { prompt: 'text' },
          },
        ],
      },
      requestCanvas,
    );

    expect(requestCanvas).not.toHaveBeenCalled();
    expect(result?.isError).toBe(true);
    expect(result?.content[0].text).toContain('requires an explicit position');
  });

  test('rejects overlapping addNode operations', async () => {
    const requestCanvas = vi.fn();

    const result = await executePopiTVMcpTool(
      POPITV_MCP_SERVER_NAME,
      'edit_canvas',
      {
        operations: [
          {
            type: 'addNode',
            nodeType: 'prompt',
            nodeId: 'prompt-1',
            position: { x: 200, y: 200 },
            data: { prompt: 'one' },
          },
          {
            type: 'addNode',
            nodeType: 'prompt',
            nodeId: 'prompt-2',
            position: { x: 300, y: 240 },
            data: { prompt: 'two' },
          },
        ],
      },
      requestCanvas,
    );

    expect(requestCanvas).not.toHaveBeenCalled();
    expect(result?.isError).toBe(true);
    expect(result?.content[0].text).toContain('overlaps');
  });

  test('rejects addNode operations without horizontal clearance', async () => {
    const requestCanvas = vi.fn();

    const result = await executePopiTVMcpTool(
      POPITV_MCP_SERVER_NAME,
      'edit_canvas',
      {
        operations: [
          {
            type: 'addNode',
            nodeType: 'prompt',
            nodeId: 'prompt-1',
            position: { x: 200, y: 200 },
            data: { prompt: 'one' },
          },
          {
            type: 'addNode',
            nodeType: 'nanoBanana',
            nodeId: 'image-1',
            position: { x: 580, y: 200 },
            data: { inputPrompt: 'two' },
          },
        ],
      },
      requestCanvas,
    );

    expect(requestCanvas).not.toHaveBeenCalled();
    expect(result?.isError).toBe(true);
    expect(result?.content[0].text).toContain('horizontal clearance');
  });

  test('maps run_canvas nodeIds to selected-node execution', async () => {
    const requestCanvas = vi.fn(async () => ({ isRunning: true }));

    await executePopiTVMcpTool(
      POPITV_MCP_SERVER_NAME,
      'run_canvas',
      { nodeIds: ['gen-1'] },
      requestCanvas,
    );

    expect(requestCanvas).toHaveBeenCalledWith({
      bridgeType: 'popitv:run-selected',
      nodeIds: ['gen-1'],
    });
  });

  test('maps measure_nodes nodeIds to the renderer measurement bridge', async () => {
    const requestCanvas = vi.fn(async () => [
      { id: 'node-1', x: 200, y: 160, width: 320, height: 220 },
      { id: 'node-2', x: 600, y: 160, width: 300, height: 300 },
    ]);

    const result = await executePopiTVMcpTool(
      POPITV_MCP_SERVER_NAME,
      'measure_nodes',
      { sessionId: 'session-1', nodeIds: ['node-1', 'node-2'] },
      requestCanvas,
    );

    expect(requestCanvas).toHaveBeenCalledWith({
      bridgeType: 'popitv:measure-nodes',
      sessionId: 'session-1',
      nodeIds: ['node-1', 'node-2'],
    });
    expect(result?.isError).toBe(false);
    expect(result?.content[0].text).toContain('"x": 200');
    expect(result?.content[0].text).toContain('"y": 160');
    expect(result?.content[0].text).toContain('"width": 320');
  });

  test('rejects edit_canvas without an operations array', async () => {
    const result = await executePopiTVMcpTool(POPITV_MCP_SERVER_NAME, 'edit_canvas', {}, vi.fn());

    expect(result?.isError).toBe(true);
    expect(result?.content[0].text).toContain('operations');
  });

  test('rejects measure_nodes without nodeIds', async () => {
    const result = await executePopiTVMcpTool(
      POPITV_MCP_SERVER_NAME,
      'measure_nodes',
      {},
      vi.fn(),
    );

    expect(result?.isError).toBe(true);
    expect(result?.content[0].text).toContain('nodeIds');
  });

  test('returns null for non-PopiTV tools', async () => {
    await expect(executePopiTVMcpTool('other', 'read_canvas', {}, vi.fn())).resolves.toBeNull();
  });
});
