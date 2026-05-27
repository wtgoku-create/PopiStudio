import { afterEach, describe, expect, test, vi } from 'vitest';

import { McpBridgeServer } from './mcpBridgeServer';

describe('McpBridgeServer local tool handling', () => {
  let server: McpBridgeServer | null = null;

  afterEach(async () => {
    await server?.stop();
    server = null;
  });

  test('lets a local tool handler intercept execute requests', async () => {
    server = new McpBridgeServer('test-secret');
    server.setLocalToolHandler(async (serverName, toolName, args) => ({
      content: [{ type: 'text', text: JSON.stringify({ serverName, toolName, args }) }],
      isError: false,
    }));
    await server.start();

    const response = await fetch(server.callbackUrl!, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-mcp-bridge-secret': 'test-secret',
      },
      body: JSON.stringify({
        server: 'popitv',
        tool: 'read_canvas',
        args: { sessionId: 's1' },
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            serverName: 'popitv',
            toolName: 'read_canvas',
            args: { sessionId: 's1' },
          }),
        },
      ],
      isError: false,
    });
  });

  test('returns a bridge error when no local handler accepts the request', async () => {
    server = new McpBridgeServer('test-secret');
    server.setLocalToolHandler(async () => null);
    await server.start();

    const response = await fetch(server.callbackUrl!, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-mcp-bridge-secret': 'test-secret',
      },
      body: JSON.stringify({
        server: 'remote',
        tool: 'tool_a',
        args: { value: 1 },
      }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      content: [{ type: 'text', text: 'No local MCP bridge handler for remote.tool_a' }],
      isError: true,
    });
  });
});
