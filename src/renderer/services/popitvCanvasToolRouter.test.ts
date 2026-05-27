import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  __resetPopiTVCanvasToolRouterForTests,
  PopiTVCanvasBridgeType,
  type PopiTVCanvasToolRequest,
  registerPopiTVCanvasAutoOpenHandler,
  registerPopiTVCanvasToolHandler,
} from './popitvCanvasToolRouter';

interface PopiTVCanvasToolResponse {
  requestId: string;
  ok: boolean;
  payload?: unknown;
  error?: string;
}

const setupElectronPopiTV = () => {
  let listener: ((request: PopiTVCanvasToolRequest) => void | Promise<void>) | null = null;
  const responses: PopiTVCanvasToolResponse[] = [];

  vi.stubGlobal('window', {
    electron: {
      popitv: {
        onToolRequest: vi.fn((callback: (request: PopiTVCanvasToolRequest) => void) => {
          listener = callback;
          return vi.fn();
        }),
        respondToolRequest: vi.fn((response: PopiTVCanvasToolResponse) => {
          responses.push(response);
        }),
      },
    },
  });

  return {
    responses,
    async emit(request: PopiTVCanvasToolRequest) {
      if (!listener) {
        throw new Error('PopiTV tool listener was not registered');
      }
      await listener(request);
    },
  };
};

describe('popitvCanvasToolRouter', () => {
  afterEach(() => {
    vi.useRealTimers();
    __resetPopiTVCanvasToolRouterForTests();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test('routes tool requests to the matching session canvas handler', async () => {
    const electron = setupElectronPopiTV();
    registerPopiTVCanvasToolHandler('session-a', async request => ({
      bridgeType: request.bridgeType,
      nodeIds: request.nodeIds,
    }));

    await electron.emit({
      requestId: 'request-1',
      bridgeType: PopiTVCanvasBridgeType.RunSelected,
      sessionId: 'session-a',
      nodeIds: ['node-1'],
    });

    expect(electron.responses).toEqual([
      {
        requestId: 'request-1',
        ok: true,
        payload: {
          bridgeType: PopiTVCanvasBridgeType.RunSelected,
          nodeIds: ['node-1'],
        },
      },
    ]);
  });

  test('routes sessionless requests to the only active canvas handler', async () => {
    const electron = setupElectronPopiTV();
    registerPopiTVCanvasToolHandler('session-a', async () => ({ nodeCount: 2 }));

    await electron.emit({
      requestId: 'request-1',
      bridgeType: PopiTVCanvasBridgeType.GetSnapshot,
    });

    expect(electron.responses).toEqual([
      {
        requestId: 'request-1',
        ok: true,
        payload: { nodeCount: 2 },
      },
    ]);
  });

  test('auto-opens a requested session before routing the tool request', async () => {
    const electron = setupElectronPopiTV();
    const autoOpen = vi.fn(async (sessionId: string) => {
      registerPopiTVCanvasToolHandler(sessionId, async () => ({ opened: sessionId }));
      return true;
    });
    registerPopiTVCanvasAutoOpenHandler(autoOpen);

    await electron.emit({
      requestId: 'request-1',
      bridgeType: PopiTVCanvasBridgeType.GetSnapshot,
      sessionId: 'session-a',
    });

    expect(autoOpen).toHaveBeenCalledWith('session-a');
    expect(electron.responses).toEqual([
      {
        requestId: 'request-1',
        ok: true,
        payload: { opened: 'session-a' },
      },
    ]);
  });

  test('waits for a delayed canvas handler after auto-open', async () => {
    vi.useFakeTimers();
    const electron = setupElectronPopiTV();
    const autoOpen = vi.fn(async (sessionId: string) => {
      setTimeout(() => {
        registerPopiTVCanvasToolHandler(sessionId, async () => ({ opened: sessionId }));
      }, 100);
      return true;
    });
    registerPopiTVCanvasAutoOpenHandler(autoOpen);

    const emitPromise = electron.emit({
      requestId: 'request-1',
      bridgeType: PopiTVCanvasBridgeType.GetSnapshot,
      sessionId: 'session-a',
    });

    await vi.advanceTimersByTimeAsync(100);
    await emitPromise;

    expect(electron.responses).toEqual([
      {
        requestId: 'request-1',
        ok: true,
        payload: { opened: 'session-a' },
      },
    ]);
  });

  test('responds with an actionable error when no canvas can handle the request', async () => {
    const electron = setupElectronPopiTV();
    registerPopiTVCanvasAutoOpenHandler(async () => false);

    await electron.emit({
      requestId: 'request-1',
      bridgeType: PopiTVCanvasBridgeType.GetSnapshot,
      sessionId: 'missing-session',
    });

    expect(electron.responses).toEqual([
      {
        requestId: 'request-1',
        ok: false,
        error:
          'PopiTV canvas is not open for session missing-session. Open the popitv skill canvas and retry.',
      },
    ]);
  });
});
