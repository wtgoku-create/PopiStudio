import {
  ArrowPathIcon,
  LinkIcon,
  MapIcon,
  PlayIcon,
  Squares2X2Icon,
  StopIcon,
} from '@heroicons/react/24/outline';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import {
  clearPopiTVCanvasSnapshot,
  type PopiTVCanvasSnapshot,
  setPopiTVCanvasSnapshot,
} from '../../services/popitvCanvasContext';
import {
  PopiTVCanvasBridgeType,
  type PopiTVCanvasToolRequest,
  registerPopiTVCanvasToolHandler,
} from '../../services/popitvCanvasToolRouter';

interface PopiTVCanvasWorkspaceProps {
  sessionId: string;
  sessionTitle: string;
}

const POPITV_CANVAS_ORIGIN = 'https://canvas.popi.art'
const POPIAI_BRIDGE_SOURCE = 'popiai';
const POPITV_BRIDGE_SOURCE = 'popitv';
const CANVAS_REQUEST_TIMEOUT_MS = 45_000;
const BRIDGE_READY_TIMEOUT_MS = 45_000;

interface PopiTVBridgeEvent {
  source?: string;
  type?: 'popitv:ready' | 'popitv:snapshot' | 'popitv:node-dimensions' | 'popitv:error';
  requestId?: string;
  payload?:
    | PopiTVCanvasSnapshot
    | Array<{ id: string; x?: number; y?: number; width: number; height: number }>
    | { message?: string };
}

type PendingCanvasRequest = {
  resolve: (payload: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type BridgeReadyWaiter = {
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const PopiTVCanvasWorkspace: React.FC<PopiTVCanvasWorkspaceProps> = ({
  sessionId,
  sessionTitle,
}) => {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const pendingCanvasRequestsRef = useRef<Map<string, PendingCanvasRequest>>(new Map());
  const bridgeReadyWaitersRef = useRef<Set<BridgeReadyWaiter>>(new Set());
  const isBridgeReadyRef = useRef(false);
  const [frameKey, setFrameKey] = useState(0);
  const [isLoaded, setIsLoaded] = useState(false);
  const [snapshot, setSnapshot] = useState<PopiTVCanvasSnapshot | null>(null);
  const [bridgeError, setBridgeError] = useState<string | null>(null);
  const [canvasUrl, setCanvasUrl] = useState<string>('');

  useEffect(() => {
    window.electron.store.get('auth_tokens').then((authTokens: any) => {
      const url = new URL(POPITV_CANVAS_ORIGIN);
      url.searchParams.set('token', authTokens?.accessToken || '');
      url.searchParams.set('t', new Date().getTime().toString()); // prevent caching
      url.searchParams.set('embed', 'popiai');
      url.searchParams.set('sessionId', sessionId);
      url.searchParams.set('parentOrigin', window.location.origin);
      setCanvasUrl(url.toString());
    });
  }, [sessionId]);

  const postCanvasMessage = useCallback(
    (type: string, requestId: string, extra?: Record<string, unknown>) => {
      const targetWindow = frameRef.current?.contentWindow;
      if (!targetWindow) return false;
      targetWindow.postMessage(
        {
          source: POPIAI_BRIDGE_SOURCE,
          type,
          requestId,
          sessionId,
          ...extra,
        },
        POPITV_CANVAS_ORIGIN,
      );
      return true;
    },
    [sessionId],
  );

  const rejectBridgeReadyWaiters = useCallback((message: string) => {
    for (const waiter of bridgeReadyWaitersRef.current) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error(message));
    }
    bridgeReadyWaitersRef.current.clear();
  }, []);

  const rejectPendingCanvasRequests = useCallback((message: string) => {
    for (const pending of pendingCanvasRequestsRef.current.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(message));
    }
    pendingCanvasRequestsRef.current.clear();
  }, []);

  const markBridgeReady = useCallback(() => {
    isBridgeReadyRef.current = true;
    for (const waiter of bridgeReadyWaitersRef.current) {
      clearTimeout(waiter.timer);
      waiter.resolve();
    }
    bridgeReadyWaitersRef.current.clear();
  }, []);

  const waitForBridgeReady = useCallback((): Promise<void> => {
    if (isBridgeReadyRef.current) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const waiter: BridgeReadyWaiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          bridgeReadyWaitersRef.current.delete(waiter);
          reject(new Error('Timed out waiting for PopiTV canvas bridge readiness'));
        }, BRIDGE_READY_TIMEOUT_MS),
      };
      bridgeReadyWaitersRef.current.add(waiter);
    });
  }, []);

  const sendCanvasRequest = useCallback(
    async (type: PopiTVCanvasBridgeType, extra?: Record<string, unknown>): Promise<unknown> => {
      await waitForBridgeReady();

      const requestId =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pendingCanvasRequestsRef.current.delete(requestId);
          reject(new Error('Timed out waiting for PopiTV canvas response'));
        }, CANVAS_REQUEST_TIMEOUT_MS);

        pendingCanvasRequestsRef.current.set(requestId, { resolve, reject, timer });

        if (!postCanvasMessage(type, requestId, extra)) {
          clearTimeout(timer);
          pendingCanvasRequestsRef.current.delete(requestId);
          reject(new Error('PopiTV canvas frame is not ready'));
        }
      });
    },
    [postCanvasMessage, waitForBridgeReady],
  );

  useEffect(() => {
    const handleMessage = (event: MessageEvent<PopiTVBridgeEvent>) => {
      if (event.origin !== POPITV_CANVAS_ORIGIN || event.data?.source !== POPITV_BRIDGE_SOURCE) {
        return;
      }

      if (event.data.type === 'popitv:error') {
        if (event.data.requestId) {
          const pending = pendingCanvasRequestsRef.current.get(event.data.requestId);
          if (pending) {
            pendingCanvasRequestsRef.current.delete(event.data.requestId);
            clearTimeout(pending.timer);
            const payload = event.data.payload as { message?: string } | undefined;
            pending.reject(new Error(payload?.message || 'Canvas command failed'));
          }
        }
        const payload = event.data.payload as { message?: string } | undefined;
        setBridgeError(payload?.message || 'Canvas command failed');
        return;
      }

      if (event.data.type === 'popitv:node-dimensions') {
        if (event.data.requestId) {
          const pending = pendingCanvasRequestsRef.current.get(event.data.requestId);
          if (pending) {
            pendingCanvasRequestsRef.current.delete(event.data.requestId);
            clearTimeout(pending.timer);
            pending.resolve(event.data.payload);
          }
        }
        setBridgeError(null);
        return;
      }

      if (event.data.type === 'popitv:ready' || event.data.type === 'popitv:snapshot') {
        const nextSnapshot = event.data.payload as PopiTVCanvasSnapshot;
        if (nextSnapshot.sessionId !== sessionId) {
          return;
        }
        markBridgeReady();
        if (event.data.requestId) {
          const pending = pendingCanvasRequestsRef.current.get(event.data.requestId);
          if (pending) {
            pendingCanvasRequestsRef.current.delete(event.data.requestId);
            clearTimeout(pending.timer);
            pending.resolve(event.data.payload);
          }
        }
        setBridgeError(null);
        setSnapshot(nextSnapshot);
        setPopiTVCanvasSnapshot(sessionId, nextSnapshot);
        void window.electron.popitv.updateSnapshot(sessionId, nextSnapshot).catch(() => false);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [markBridgeReady, sessionId]);

  useEffect(() => {
    isBridgeReadyRef.current = false;
    rejectBridgeReadyWaiters('PopiTV canvas session changed');
    rejectPendingCanvasRequests('PopiTV canvas session changed');
    setIsLoaded(false);
    setSnapshot(null);
    setBridgeError(null);
    clearPopiTVCanvasSnapshot(sessionId);
    void window.electron.popitv.clearSnapshot(sessionId).catch(() => false);
  }, [canvasUrl, rejectBridgeReadyWaiters, rejectPendingCanvasRequests, sessionId]);

  useEffect(() => {
    void window.electron.popitv.registerSession(sessionId).catch(() => false);
    const handleCanvasToolRequest = (request: PopiTVCanvasToolRequest) =>
      sendCanvasRequest(request.bridgeType, {
        ...(request.nodeIds ? { nodeIds: request.nodeIds } : {}),
        ...(request.operations ? { operations: request.operations } : {}),
      });

    const unregisterHandler = registerPopiTVCanvasToolHandler(sessionId, handleCanvasToolRequest);
    return () => {
      unregisterHandler();
      void window.electron.popitv.unregisterSession(sessionId).catch(() => false);
    };
  }, [sendCanvasRequest, sessionId]);

  useEffect(() => {
    return () => {
      rejectBridgeReadyWaiters('PopiTV canvas workspace was closed');
      rejectPendingCanvasRequests('PopiTV canvas workspace was closed');
    };
  }, [rejectBridgeReadyWaiters, rejectPendingCanvasRequests]);

  const handleReload = () => {
    isBridgeReadyRef.current = false;
    rejectBridgeReadyWaiters('PopiTV canvas workspace was reloading');
    rejectPendingCanvasRequests('PopiTV canvas workspace was reloading');
    setIsLoaded(false);
    setSnapshot(null);
    setBridgeError(null);
    clearPopiTVCanvasSnapshot(sessionId);
    void window.electron.popitv.clearSnapshot(sessionId).catch(() => false);
    setFrameKey(key => key + 1);
  };

  return (
    <section className="relative flex-1 min-w-0 h-full overflow-hidden bg-[#f6f7f8] dark:bg-neutral-950">
      <>
        <div className="absolute left-4 top-16 z-20 flex items-center gap-2 rounded-md border border-neutral-200 bg-white/95 px-2 py-1 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/95">
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
            title="Workflow"
          >
            <Squares2X2Icon className="h-4 w-4" />
          </button>
          <div className="h-5 w-px bg-neutral-200 dark:bg-neutral-800" />
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
            title="Run workflow"
            disabled={snapshot?.isRunning}
            onClick={() => {
              void sendCanvasRequest(PopiTVCanvasBridgeType.RunWorkflow).catch((error: unknown) => {
                setBridgeError(error instanceof Error ? error.message : String(error));
              });
            }}
          >
            <PlayIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded text-neutral-600 hover:bg-neutral-100 disabled:opacity-40 dark:text-neutral-300 dark:hover:bg-neutral-800"
            title="Stop workflow"
            disabled={!snapshot?.isRunning}
            onClick={() => {
              void sendCanvasRequest(PopiTVCanvasBridgeType.StopWorkflow).catch(
                (error: unknown) => {
                  setBridgeError(error instanceof Error ? error.message : String(error));
                },
              );
            }}
          >
            <StopIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
            title="Refresh"
            onClick={handleReload}
          >
            <ArrowPathIcon className="h-4 w-4" />
          </button>
          <div className="h-5 w-px bg-neutral-200 dark:bg-neutral-800" />
          <span className="max-w-[220px] truncate px-1 text-xs font-medium text-neutral-700 dark:text-neutral-200">
            {sessionTitle}
          </span>
        </div>

        <div className="absolute right-4 top-16 z-20 flex items-center gap-1 rounded-md border border-neutral-200 bg-white/95 px-2 py-1 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/95">
          <MapIcon className="h-4 w-4 text-neutral-500" />
          <span className="text-xs text-neutral-600 dark:text-neutral-300">Canvas context</span>
          <span className="ml-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
            {snapshot ? `${snapshot.nodeCount} nodes` : 'linking'}
          </span>
        </div>

        <iframe
          ref={frameRef}
          key={`${sessionId}:${frameKey}`}
          title="PopiTV canvas"
          src={canvasUrl}
          className="absolute inset-0 h-full w-full border-0 bg-white"
          onLoad={() => {
            setIsLoaded(true);
            void sendCanvasRequest(PopiTVCanvasBridgeType.GetSnapshot).catch(() => {
              // The bridge posts a ready snapshot on mount; avoid surfacing a duplicate load-time error.
            });
          }}
          referrerPolicy="no-referrer"
        />

        {!isLoaded && (
          <div className="absolute left-1/2 top-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 items-center gap-3 rounded-md border border-neutral-200 bg-white px-4 py-3 shadow-lg dark:border-neutral-800 dark:bg-neutral-900">
            <LinkIcon className="h-5 w-5 text-violet-500" />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">
                Loading PopiTV canvas
              </div>
              <div className="mt-0.5 max-w-[360px] text-xs leading-5 text-neutral-500 dark:text-neutral-400">
                Session {sessionId.slice(0, 8)} is opening the local popiart-node canvas.
              </div>
            </div>
          </div>
        )}

        <a
          href={canvasUrl}
          target="_blank"
          rel="noreferrer"
          className="absolute bottom-4 left-20 z-20 flex items-center gap-2 rounded-md border border-neutral-200 bg-white/95 px-3 py-2 text-xs font-medium text-neutral-700 shadow-sm hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900/95 dark:text-neutral-200 dark:hover:bg-neutral-800"
        >
          <LinkIcon className="h-5 w-5 text-violet-500" />
          {bridgeError || snapshot?.workflowName || 'Open canvas'}
        </a>
      </>
    </section>
  );
};

export default PopiTVCanvasWorkspace;
