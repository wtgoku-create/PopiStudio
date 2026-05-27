import crypto from 'crypto';
import { BrowserWindow, ipcMain } from 'electron';

import type { PopiTVCanvasBridgeRequest } from './popiTVMcpBridgeTools';

type PendingRequest = {
  resolve: (payload: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
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
const DEFAULT_TIMEOUT_MS = 90_000;

const pendingRequests = new Map<string, PendingRequest>();
let isRegistered = false;

const isRendererResponse = (value: unknown): value is RendererResponse => {
  return !!value && typeof value === 'object' && !Array.isArray(value);
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
      pending.resolve(response.payload);
      return;
    }

    const message =
      typeof response.error === 'string' && response.error.trim()
        ? response.error.trim()
        : 'PopiTV canvas request failed';
    pending.reject(new Error(message));
  });
  isRegistered = true;
}

export function requestPopiTVCanvasFromRenderer(
  request: PopiTVCanvasBridgeRequest,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<unknown> {
  registerPopiTVRendererBridgeIpc();

  const windows = BrowserWindow.getAllWindows().filter(win => !win.isDestroyed());
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
