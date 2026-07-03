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
      'measure_nodes',
      'run_canvas',
      'stop_canvas',
    ]);
  });

  test('announces popiartAi as the local MCP server name', async () => {
    server = new PopiTVToolBridgeServer('test-secret');
    await server.start();

    const response = await callMcp(server, {
      jsonrpc: '2.0',
      id: 6,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: {
          name: 'test-client',
          version: '1.0.0',
        },
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(
      expect.objectContaining({
        result: expect.objectContaining({
          serverInfo: expect.objectContaining({
            name: 'popiartAi',
          }),
        }),
      }),
    );
  });

  test('registers local application tools into the MCP tool list', async () => {
    server = new PopiTVToolBridgeServer('test-secret');
    server.registerLocalToolProvider({
      serverName: 'local-app',
      tools: [
        {
          name: 'open_panel',
          description: 'Open a local application panel.',
          inputSchema: {
            type: 'object',
            properties: {
              panelId: { type: 'string' },
            },
            required: ['panelId'],
            additionalProperties: false,
          },
        },
      ],
      handleToolCall: async (serverName, toolName, args) => ({
        content: [{ type: 'text', text: JSON.stringify({ serverName, toolName, args }) }],
        isError: false,
      }),
    });
    await server.start();

    const listResponse = await callMcp(server, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
    });

    expect(listResponse.status).toBe(200);
    const listPayload = await listResponse.json();
    expect(listPayload.result.tools).toContainEqual(
      expect.objectContaining({
        name: 'open_panel',
        description: 'Open a local application panel.',
        inputSchema: expect.objectContaining({
          properties: expect.objectContaining({
            panelId: { type: 'string' },
          }),
          required: ['panelId'],
          additionalProperties: false,
        }),
      }),
    );
    expect(listPayload.result.tools.map((tool: { name: string }) => tool.name)).toEqual(
      expect.arrayContaining([
        'read_canvas',
        'open_panel',
      ]),
    );

    const callResponse = await callMcp(server, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'open_panel',
        arguments: { panelId: 'settings' },
      },
    });

    expect(callResponse.status).toBe(200);
    expect(await callResponse.json()).toEqual({
      jsonrpc: '2.0',
      id: 3,
      result: {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              serverName: 'local-app',
              toolName: 'open_panel',
              args: { panelId: 'settings' },
            }),
          },
        ],
        isError: false,
      },
    });
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
      id: 4,
      method: 'tools/call',
      params: {
        name: 'read_canvas',
        arguments: { sessionId: 's1' },
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      jsonrpc: '2.0',
      id: 4,
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
      id: 5,
      method: 'tools/call',
      params: {
        name: 'tool_a',
        arguments: { value: 1 },
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      jsonrpc: '2.0',
      id: 5,
      result: {
        content: [{ type: 'text', text: 'No local MCP handler for tool "tool_a".' }],
        isError: true,
      },
    });
  });
});
