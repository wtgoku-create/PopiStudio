import { afterEach, describe, expect, test } from 'vitest';

import { McpBridgeServer } from './mcpBridgeServer';

describe('McpBridgeServer AskUser handling', () => {
  let server: McpBridgeServer | null = null;

  afterEach(async () => {
    await server?.stop();
    server = null;
  });

  test('rejects non-askuser routes', async () => {
    server = new McpBridgeServer('test-secret');
    await server.start();

    const baseUrl = server.askUserCallbackUrl!.replace('/askuser', '');
    const response = await fetch(`${baseUrl}/execute`, {
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

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Not found' });
  });

  test('rejects askuser requests without the bridge secret', async () => {
    server = new McpBridgeServer('test-secret');
    await server.start();

    const response = await fetch(server.askUserCallbackUrl!, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        questions: [
          {
            question: 'Continue?',
            options: [{ label: 'Allow' }, { label: 'Deny' }],
          },
        ],
      }),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
  });
});
