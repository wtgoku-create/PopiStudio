import { afterEach, describe, expect, test } from 'vitest';

import { PopiTVToolBridgeServer } from './popiTVToolBridgeServer';

const callMcp = async (server: PopiTVToolBridgeServer, body: unknown) => {
  return fetch(server.mcpUrl!, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-mcp-bridge-secret': 'test-secret',
    },
    body: JSON.stringify(body),
  });
};

describe('PopiTVToolBridgeServer MCP HTTP handling', () => {
  let server: PopiTVToolBridgeServer | null = null;

  afterEach(async () => {
    await server?.stop();
    server = null;
  });

  test('lists PopiTV MCP tools over JSON-RPC', async () => {
    server = new PopiTVToolBridgeServer('test-secret');
    await server.start();

    const response = await callMcp(server, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      'read_canvas',
      'edit_canvas',
      'run_canvas',
      'stop_canvas',
    ]);
  });

  test('lets a PopiTV tool handler handle tools/call requests', async () => {
    server = new PopiTVToolBridgeServer('test-secret');
    server.setLocalToolHandler(async (serverName, toolName, args) => ({
      content: [{ type: 'text', text: JSON.stringify({ serverName, toolName, args }) }],
      isError: false,
    }));
    await server.start();

    const response = await callMcp(server, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'read_canvas',
        arguments: { sessionId: 's1' },
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      jsonrpc: '2.0',
      id: 2,
      result: {
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
      },
    });
  });

  test('returns an MCP tool error when no PopiTV handler accepts the request', async () => {
    server = new PopiTVToolBridgeServer('test-secret');
    server.setLocalToolHandler(async () => null);
    await server.start();

    const response = await callMcp(server, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'tool_a',
        arguments: { value: 1 },
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      jsonrpc: '2.0',
      id: 3,
      result: {
        content: [{ type: 'text', text: 'No local PopiTV MCP handler for popitv.tool_a' }],
        isError: true,
      },
    });
  });
});
