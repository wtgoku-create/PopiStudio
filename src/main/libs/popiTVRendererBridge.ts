import crypto from 'crypto';
import { BrowserWindow, ipcMain } from 'electron';

import type { PopiTVCanvasBridgeRequest } from './popiTVMcpBridgeTools';

type PendingRequest = {
  resolve: (payload: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  request: PopiTVCanvasBridgeRequest;
  abortCleanup?: () => void;
};

type RendererResponse = {
  requestId?: unknown;
  ok?: unknown;
  payload?: unknown;
  error?: unknown;
};

const REQUEST_CHANNEL = 'popitv:tool-request';
const RESPONSE_CHANNEL = 'popitv:tool-response';
const REGISTER_SESSION_CHANNEL = 'popitv:register-session';
const UNREGISTER_SESSION_CHANNEL = 'popitv:unregister-session';
const UPDATE_SNAPSHOT_CHANNEL = 'popitv:update-snapshot';
const CLEAR_SNAPSHOT_CHANNEL = 'popitv:clear-snapshot';
const DEFAULT_TIMEOUT_MS = 90_000;

const pendingRequests = new Map<string, PendingRequest>();
const sessionTargets = new Map<string, number>();
const snapshotsBySessionId = new Map<string, { snapshot: unknown; receivedAt: number }>();
let isRegistered = false;

const isRendererResponse = (value: unknown): value is RendererResponse => {
  return !!value && typeof value === 'object' && !Array.isArray(value);
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return !!value && typeof value === 'object' && !Array.isArray(value);
};

const getSnapshotSessionId = (sessionId: unknown, snapshot: unknown): string | null => {
  if (typeof sessionId === 'string' && sessionId.trim()) {
    return sessionId.trim();
  }
  if (isRecord(snapshot) && typeof snapshot.sessionId === 'string' && snapshot.sessionId.trim()) {
    return snapshot.sessionId.trim();
  }
  return null;
};

const storeCanvasSnapshot = (sessionId: unknown, snapshot: unknown): boolean => {
  if (!isRecord(snapshot)) return false;
  const normalizedSessionId = getSnapshotSessionId(sessionId, snapshot);
  if (!normalizedSessionId) return false;

  snapshotsBySessionId.set(normalizedSessionId, {
    snapshot,
    receivedAt: Date.now(),
  });
  return true;
};

export function registerPopiTVRendererBridgeIpc(): void {
  if (isRegistered) return;
  ipcMain.on(RESPONSE_CHANNEL, (_event, response: unknown) => {
    if (!isRendererResponse(response) || typeof response.requestId !== 'string') {
      return;
    }

    const pending = pendingRequests.get(response.requestId);
    if (!pending) return;

    clearTimeout(pending.timer);
    pending.abortCleanup?.();
    pendingRequests.delete(response.requestId);

    if (response.ok === true) {
      storeCanvasSnapshot(pending.request.sessionId, response.payload);
      pending.resolve(response.payload);
      return;
    }

    const message =
      typeof response.error === 'string' && response.error.trim()
        ? response.error.trim()
        : 'PopiTV canvas request failed';
    pending.reject(new Error(message));
  });
  ipcMain.handle(REGISTER_SESSION_CHANNEL, (event, sessionId: unknown) => {
    if (typeof sessionId !== 'string' || !sessionId.trim()) return false;
    sessionTargets.set(sessionId, event.sender.id);
    event.sender.once('destroyed', () => {
      if (sessionTargets.get(sessionId) === event.sender.id) {
        sessionTargets.delete(sessionId);
        snapshotsBySessionId.delete(sessionId);
      }
    });
    return true;
  });
  ipcMain.handle(UNREGISTER_SESSION_CHANNEL, (event, sessionId: unknown) => {
    if (typeof sessionId !== 'string' || !sessionId.trim()) return false;
    if (sessionTargets.get(sessionId) === event.sender.id) {
      sessionTargets.delete(sessionId);
      snapshotsBySessionId.delete(sessionId);
    }
    return true;
  });
  ipcMain.handle(UPDATE_SNAPSHOT_CHANNEL, (_event, sessionId: unknown, snapshot: unknown) => {
    return storeCanvasSnapshot(sessionId, snapshot);
  });
  ipcMain.handle(CLEAR_SNAPSHOT_CHANNEL, (_event, sessionId: unknown) => {
    if (typeof sessionId !== 'string' || !sessionId.trim()) return false;
    snapshotsBySessionId.delete(sessionId);
    return true;
  });
  isRegistered = true;
}

export function getCachedPopiTVCanvasSnapshot(sessionId?: string): unknown | null {
  if (sessionId) {
    return snapshotsBySessionId.get(sessionId)?.snapshot ?? null;
  }

  let latest: { snapshot: unknown; receivedAt: number } | null = null;
  for (const stored of snapshotsBySessionId.values()) {
    if (!latest || stored.receivedAt > latest.receivedAt) {
      latest = stored;
    }
  }
  return latest?.snapshot ?? null;
}

export function requestPopiTVCanvasFromRenderer(
  request: PopiTVCanvasBridgeRequest,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<unknown> {
  registerPopiTVRendererBridgeIpc();

  const allWindows = BrowserWindow.getAllWindows().filter(win => !win.isDestroyed());
  const targetWebContentsId = request.sessionId
    ? sessionTargets.get(request.sessionId)
    : undefined;
  const windows = targetWebContentsId
    ? allWindows.filter(win => win.webContents.id === targetWebContentsId)
    : allWindows;
  if (windows.length === 0) {
    return Promise.reject(
      new Error('No Popiai renderer window is available for PopiTV canvas tools.'),
    );
  }

  if (options.signal?.aborted) {
    return Promise.reject(new Error('PopiTV canvas request aborted before dispatch.'));
  }

  const requestId = crypto.randomUUID();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      const pending = pendingRequests.get(requestId);
      if (!pending) return;
      clearTimeout(pending.timer);
      pending.abortCleanup?.();
      pendingRequests.delete(requestId);
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for an active PopiTV canvas.'));
    }, timeoutMs);

    const abortHandler = () => {
      cleanup();
      reject(new Error('PopiTV canvas request aborted.'));
    };

    let abortCleanup: (() => void) | undefined;
    if (options.signal) {
      options.signal.addEventListener('abort', abortHandler, { once: true });
      abortCleanup = () => options.signal?.removeEventListener('abort', abortHandler);
    }

    pendingRequests.set(requestId, {
      resolve,
      reject,
      timer,
      request,
      abortCleanup,
    });

    for (const win of windows) {
      win.webContents.send(REQUEST_CHANNEL, {
        requestId,
        ...request,
      });
    }
  });
}
