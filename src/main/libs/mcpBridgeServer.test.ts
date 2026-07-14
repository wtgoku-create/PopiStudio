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

  test('forwards session key and resolves askuser requests', async () => {
    server = new McpBridgeServer('test-secret');
    await server.start();

    server.onAskUser((request) => {
      expect(request.sessionKey).toBe('agent:main:popiai:session-1');
      server?.resolveAskUser(request.requestId, {
        behavior: 'allow',
        answers: { 'Continue?': 'Allow' },
      });
    });

    const response = await fetch(server.askUserCallbackUrl!, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-mcp-bridge-secret': 'test-secret',
      },
      body: JSON.stringify({
        sessionKey: 'agent:main:popiai:session-1',
        questions: [
          {
            question: 'Continue?',
            title: 'Confirm action',
            subtitle: 'Review **carefully**',
            options: [{ label: 'Allow' }, { label: 'Deny' }],
          },
        ],
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      behavior: 'allow',
      answers: { 'Continue?': 'Allow' },
    });
  });

  test('supports internal askuser requests', async () => {
    server = new McpBridgeServer('test-secret');

    server.onAskUser((request) => {
      expect(request.sessionKey).toBe('agent:main:popiai:session-2');
      server?.resolveAskUser(request.requestId, { behavior: 'deny' });
    });

    await expect(server.askUserInternal(
      [
        {
          question: 'Continue?',
          options: [{ label: 'Allow' }, { label: 'Deny' }],
        },
      ],
      1000,
      { sessionKey: 'agent:main:popiai:session-2' },
    )).resolves.toEqual({ behavior: 'deny' });
  });
});
