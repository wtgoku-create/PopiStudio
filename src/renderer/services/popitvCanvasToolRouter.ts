export const PopiTVCanvasBridgeType = {
  GetSnapshot: 'popitv:get-snapshot',
  MeasureNodes: 'popitv:measure-nodes',
  ApplyEditOperations: 'popitv:apply-edit-operations',
  RunWorkflow: 'popitv:run-workflow',
  RunSelected: 'popitv:run-selected',
  StopWorkflow: 'popitv:stop-workflow',
} as const;

export type PopiTVCanvasBridgeType =
  (typeof PopiTVCanvasBridgeType)[keyof typeof PopiTVCanvasBridgeType];

export interface PopiTVCanvasToolRequest {
  requestId: string;
  bridgeType: PopiTVCanvasBridgeType;
  sessionId?: string;
  nodeIds?: string[];
  operations?: unknown[];
}

interface PopiTVCanvasToolResponse {
  requestId: string;
  ok: boolean;
  payload?: unknown;
  error?: string;
}

export type PopiTVCanvasToolHandler = (
  request: PopiTVCanvasToolRequest,
) => Promise<unknown>;

type PopiTVCanvasAutoOpenHandler = (sessionId: string) => Promise<boolean>;
type PopiTVCanvasHandlerWaiter = (handler: PopiTVCanvasToolHandler | null) => void;

const CANVAS_HANDLER_WAIT_MS = 45_000;

const handlersBySessionId = new Map<string, PopiTVCanvasToolHandler>();
const waitersBySessionId = new Map<string, PopiTVCanvasHandlerWaiter[]>();

let autoOpenHandler: PopiTVCanvasAutoOpenHandler | null = null;
let unsubscribeIpc: (() => void) | null = null;

const getPopiTVIpc = () => {
  if (typeof window === 'undefined') return undefined;
  return window.electron?.popitv;
};

const respond = (response: PopiTVCanvasToolResponse) => {
  getPopiTVIpc()?.respondToolRequest(response);
};

const getOnlyActiveHandler = (): PopiTVCanvasToolHandler | null => {
  if (handlersBySessionId.size !== 1) return null;
  return [...handlersBySessionId.values()][0] ?? null;
};

const waitForHandler = (
  sessionId: string,
  timeoutMs: number,
): Promise<PopiTVCanvasToolHandler | null> => {
  const handler = handlersBySessionId.get(sessionId);
  if (handler) return Promise.resolve(handler);

  return new Promise(resolve => {
    let waiter: PopiTVCanvasHandlerWaiter;
    const timer = setTimeout(() => {
      const waiters = waitersBySessionId.get(sessionId) ?? [];
      waitersBySessionId.set(
        sessionId,
        waiters.filter(candidate => candidate !== waiter),
      );
      resolve(null);
    }, timeoutMs);

    waiter = nextHandler => {
      clearTimeout(timer);
      resolve(nextHandler);
    };
    const waiters = waitersBySessionId.get(sessionId) ?? [];
    waitersBySessionId.set(sessionId, [...waiters, waiter]);
  });
};

const notifyHandlerWaiters = (sessionId: string, handler: PopiTVCanvasToolHandler) => {
  const waiters = waitersBySessionId.get(sessionId);
  if (!waiters) return;
  waitersBySessionId.delete(sessionId);
  waiters.forEach(waiter => waiter(handler));
};

const resolveHandler = async (
  request: PopiTVCanvasToolRequest,
): Promise<PopiTVCanvasToolHandler | null> => {
  if (request.sessionId) {
    const directHandler = handlersBySessionId.get(request.sessionId);
    if (directHandler) return directHandler;

    if (!autoOpenHandler) return null;

    const opened = await autoOpenHandler(request.sessionId);
    if (!opened) return null;

    return waitForHandler(request.sessionId, CANVAS_HANDLER_WAIT_MS);
  }

  return getOnlyActiveHandler();
};

const buildNoHandlerError = (request: PopiTVCanvasToolRequest): string => {
  if (request.sessionId) {
    return `PopiTV canvas is not open for session ${request.sessionId}. Open the popitv skill canvas and retry.`;
  }

  return 'PopiTV canvas is not open. Open the popitv skill canvas and retry.';
};

const handleToolRequest = async (request: PopiTVCanvasToolRequest) => {
  try {
    const handler = await resolveHandler(request);
    if (!handler) {
      respond({
        requestId: request.requestId,
        ok: false,
        error: buildNoHandlerError(request),
      });
      return;
    }

    const payload = await handler(request);
    respond({
      requestId: request.requestId,
      ok: true,
      payload,
    });
  } catch (error) {
    respond({
      requestId: request.requestId,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

const ensureIpcListener = () => {
  if (unsubscribeIpc) return;
  const popitv = getPopiTVIpc();
  if (!popitv) return;
  unsubscribeIpc = popitv.onToolRequest(handleToolRequest);
};

export const registerPopiTVCanvasToolHandler = (
  sessionId: string,
  handler: PopiTVCanvasToolHandler,
): (() => void) => {
  ensureIpcListener();
  handlersBySessionId.set(sessionId, handler);
  notifyHandlerWaiters(sessionId, handler);

  return () => {
    if (handlersBySessionId.get(sessionId) === handler) {
      handlersBySessionId.delete(sessionId);
    }
  };
};

export const registerPopiTVCanvasAutoOpenHandler = (
  handler: PopiTVCanvasAutoOpenHandler,
): (() => void) => {
  ensureIpcListener();
  autoOpenHandler = handler;

  return () => {
    if (autoOpenHandler === handler) {
      autoOpenHandler = null;
    }
  };
};

export const __resetPopiTVCanvasToolRouterForTests = (): void => {
  unsubscribeIpc?.();
  unsubscribeIpc = null;
  autoOpenHandler = null;
  handlersBySessionId.clear();
  waitersBySessionId.clear();
};
