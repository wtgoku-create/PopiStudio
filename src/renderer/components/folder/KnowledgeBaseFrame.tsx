import {
  KNOWLEDGE_BASES_URL,
  KnowledgeBrowserPartition,
  KnowledgeWebviewMessage,
  type OpenKnowledgeGraphEventDetail,
} from '@shared/knowledge/constants';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSelector } from 'react-redux';

import { coworkService } from '../../services/cowork';
import { i18nService } from '../../services/i18n';
import type { RootState } from '../../store';
import type { CoworkSessionSummary } from '../../types/cowork';
import { sanitizeExportFileName, sessionToMarkdown } from '../../utils/coworkSessionExport';
import KnowledgeSessionUploadModal from './KnowledgeSessionUploadModal';

type KnowledgeWebviewElement = HTMLElement & {
  addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => void;
  executeJavaScript?: (code: string) => Promise<unknown>;
  loadURL?: (url: string) => Promise<void>;
  remove: () => void;
  removeEventListener: (type: string, listener: EventListenerOrEventListenerObject) => void;
  setAttribute: (qualifiedName: string, value: string) => void;
};

type KnowledgeIpcEvent = Event & {
  channel?: string;
  args?: unknown[];
};

type KnowledgePreloadErrorEvent = Event & {
  error?: Error;
  errorMessage?: string;
  message?: string;
};

type KnowledgeUploadLocalSessionRequest = {
  type: typeof KnowledgeWebviewMessage.UploadLocalSession;
  knowledge_base_id: string;
  knowledge_base_name?: string;
};

type KnowledgeUploadCompleteMessage = {
  type: typeof KnowledgeWebviewMessage.LocalSessionUploadComplete;
  knowledge_base_id: string;
  success_count: number;
  fail_count: number;
  knowledge_ids: string[];
};

interface KnowledgeBaseFrameProps {
  graphTarget?: OpenKnowledgeGraphEventDetail | null;
  onGraphTargetConsumed?: () => void;
}

const getKnowledgeTheme = (): string => {
  return document.documentElement.dataset.theme?.includes('dark') ? 'dark' : 'light';
};

const buildKnowledgeGraphUrl = (detail: OpenKnowledgeGraphEventDetail): string => {
  const url = new URL(`${KNOWLEDGE_BASES_URL}/${encodeURIComponent(detail.knowledgeBaseId)}`);
  url.searchParams.set('tab', 'graph');
  url.searchParams.set('slug', detail.slug);
  return url.toString();
};

const KnowledgeBaseFrame: React.FC<KnowledgeBaseFrameProps> = ({
  graphTarget = null,
  onGraphTargetConsumed,
}) => {
  const webviewContainerRef = useRef<HTMLDivElement | null>(null);
  const webviewRef = useRef<KnowledgeWebviewElement | null>(null);
  const unbindKnowledgeWebviewRef = useRef<(() => void) | null>(null);
  const isWebviewReadyRef = useRef(false);
  const postKnowledgeThemeRef = useRef<() => void>(() => undefined);
  const postKnowledgeTokenRef = useRef<() => void>(() => undefined);
  const isLoggedIn = useSelector((state: RootState) => state.auth.isLoggedIn);
  const [uploadRequest, setUploadRequest] = useState<KnowledgeUploadLocalSessionRequest | null>(
    null,
  );
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const initialKnowledgeUrl = useMemo(
    () => graphTarget ? buildKnowledgeGraphUrl(graphTarget) : KNOWLEDGE_BASES_URL,
    [graphTarget],
  );
  const initialKnowledgeUrlRef = useRef(initialKnowledgeUrl);

  const knowledgeBaseName = useMemo(
    () => uploadRequest?.knowledge_base_name?.trim() || i18nService.t('knowledgeBase'),
    [uploadRequest],
  );

  const postKnowledgeMessage = useCallback(async (payload: Record<string, unknown>) => {
    const webview = webviewRef.current;
    if (!isWebviewReadyRef.current) return;
    if (!webview?.executeJavaScript) return;

    const message = JSON.stringify(payload);
    await webview
      .executeJavaScript(`window.postMessage(${message}, window.location.origin);`)
      .catch(() => undefined);
  }, []);

  const postKnowledgeToken = useCallback(async () => {
    const token = isLoggedIn ? await window.electron?.auth?.getKnowledgeToken?.() : '';
    await postKnowledgeMessage({ type: 'weknora:kb-token', token: token || '' });
  }, [isLoggedIn, postKnowledgeMessage]);

  const postKnowledgeTheme = useCallback(async () => {
    const theme = getKnowledgeTheme();
    await postKnowledgeMessage({
      type: 'weknora:theme',
      theme,
    });
  }, [postKnowledgeMessage]);

  const completeKnowledgeSessionUpload = useCallback(
    async (message: KnowledgeUploadCompleteMessage) => {
      const webview = webviewRef.current;
      if (!webview?.executeJavaScript) return;
      const serializedMessage = JSON.stringify(message);
      await webview
        .executeJavaScript(
          `window.postMessage(${serializedMessage}, window.location.origin);`,
        )
        .catch(() => undefined);
    },
    [],
  );

  const handleUploadLocalSessions = useCallback(
    async (selectedSessions: CoworkSessionSummary[]) => {
      if (!uploadRequest) return;
      setIsUploading(true);

      const knowledgeIds: string[] = [];
      let successCount = 0;
      let failCount = 0;

      for (let index = 0; index < selectedSessions.length; index += 1) {
        const sessionSummary = selectedSessions[index];
        setUploadProgress(
          i18nService
            .t('knowledgeUploadLocalSessionProgress')
            .replace('{current}', String(index + 1))
            .replace('{total}', String(selectedSessions.length)),
        );

        try {
          const session = await coworkService.getSessionSnapshot(sessionSummary.id);
          if (!session) {
            failCount += 1;
            continue;
          }

          const markdown = sessionToMarkdown(session);
          const fileName = sanitizeExportFileName(`${session.title}.md`);
          const result = await window.electron.knowledge.uploadLocalSessionMarkdown({
            knowledgeBaseId: uploadRequest.knowledge_base_id,
            fileName,
            markdown,
          });

          if (result.success && result.knowledgeId) {
            successCount += 1;
            knowledgeIds.push(result.knowledgeId);
          } else {
            failCount += 1;
          }
        } catch {
          failCount += 1;
        }
      }

      const completeMessage: KnowledgeUploadCompleteMessage = {
        type: KnowledgeWebviewMessage.LocalSessionUploadComplete,
        knowledge_base_id: uploadRequest.knowledge_base_id,
        success_count: successCount,
        fail_count: failCount,
        knowledge_ids: knowledgeIds,
      };
      await completeKnowledgeSessionUpload(completeMessage);
      setIsUploading(false);
      setUploadProgress('');
      setUploadRequest(null);
    },
    [completeKnowledgeSessionUpload, uploadRequest],
  );

  useEffect(() => {
    void postKnowledgeToken();
    void postKnowledgeTheme();
  }, [postKnowledgeTheme, postKnowledgeToken]);

  useEffect(() => {
    if (!graphTarget) return;
    const targetUrl = buildKnowledgeGraphUrl(graphTarget);
    const webview = webviewRef.current;
    if (webview?.loadURL) {
      void webview.loadURL(targetUrl);
      onGraphTargetConsumed?.();
      return;
    }
    webview?.setAttribute('src', targetUrl);
    onGraphTargetConsumed?.();
  }, [graphTarget, onGraphTargetConsumed]);

  useEffect(() => {
    postKnowledgeTokenRef.current = () => {
      void postKnowledgeToken();
    };
    postKnowledgeThemeRef.current = () => {
      void postKnowledgeTheme();
    };
  }, [postKnowledgeTheme, postKnowledgeToken]);

  const bindKnowledgeWebview = useCallback((webview: KnowledgeWebviewElement) => {
    unbindKnowledgeWebviewRef.current?.();
    unbindKnowledgeWebviewRef.current = null;
    webviewRef.current = webview;
    isWebviewReadyRef.current = false;

    const postKnowledgeState = () => {
      postKnowledgeTokenRef.current();
      postKnowledgeThemeRef.current();
    };

    const markWebviewReady = () => {
      isWebviewReadyRef.current = true;
      postKnowledgeState();
    };

    const handleStartLoading = () => {
      isWebviewReadyRef.current = false;
    };

    const handleDomReady = () => {
      markWebviewReady();
    };

    const handleStopLoading = () => {
      markWebviewReady();
    };

    const handleIpcMessage = (event: Event) => {
      const ipcEvent = event as KnowledgeIpcEvent;
      if (ipcEvent.channel === KnowledgeWebviewMessage.PreloadReady) {
        return;
      }
      if (ipcEvent.channel !== KnowledgeWebviewMessage.UploadLocalSession) return;
      const detail = ipcEvent.args?.[0];
      if (!detail || typeof detail !== 'object') return;
      const payload = detail as Partial<KnowledgeUploadLocalSessionRequest>;
      if (payload.type !== KnowledgeWebviewMessage.UploadLocalSession) return;
      const knowledgeBaseId =
        typeof payload.knowledge_base_id === 'string' ? payload.knowledge_base_id.trim() : '';
      if (!knowledgeBaseId) return;
      setUploadRequest({
        type: KnowledgeWebviewMessage.UploadLocalSession,
        knowledge_base_id: knowledgeBaseId,
        knowledge_base_name:
          typeof payload.knowledge_base_name === 'string' ? payload.knowledge_base_name : '',
      });
    };

    const handlePreloadError = (event: Event) => {
      const preloadError = event as KnowledgePreloadErrorEvent;
      console.warn(
        '[KnowledgeBaseFrame] knowledge webview preload failed:',
        preloadError.error || preloadError.errorMessage || preloadError.message,
      );
    };

    webview.addEventListener('did-start-loading', handleStartLoading);
    webview.addEventListener('did-stop-loading', handleStopLoading);
    webview.addEventListener('dom-ready', handleDomReady);
    webview.addEventListener('ipc-message', handleIpcMessage);
    webview.addEventListener('preload-error', handlePreloadError);
    unbindKnowledgeWebviewRef.current = () => {
      isWebviewReadyRef.current = false;
      webview.removeEventListener('did-start-loading', handleStartLoading);
      webview.removeEventListener('did-stop-loading', handleStopLoading);
      webview.removeEventListener('dom-ready', handleDomReady);
      webview.removeEventListener('ipc-message', handleIpcMessage);
      webview.removeEventListener('preload-error', handlePreloadError);
    };
  }, []);

  useEffect(() => {
    const container = webviewContainerRef.current;
    if (!container) return undefined;

    const webview = document.createElement('webview') as KnowledgeWebviewElement;
    webview.setAttribute('src', initialKnowledgeUrlRef.current);
    webview.setAttribute('partition', KnowledgeBrowserPartition.Default);
    webview.setAttribute('webpreferences', 'contextIsolation=yes,nodeIntegration=no,sandbox=no');
    webview.setAttribute('title', i18nService.t('knowledgeBase'));
    webview.setAttribute('allowpopups', 'false');
    webview.className = 'h-full w-full border-0 bg-background';

    bindKnowledgeWebview(webview);
    container.appendChild(webview);

    return () => {
      unbindKnowledgeWebviewRef.current?.();
      unbindKnowledgeWebviewRef.current = null;
      webviewRef.current = null;
      webview.remove();
    };
  }, [bindKnowledgeWebview]);

  useEffect(() => {
    const observer = new MutationObserver(() => {
      void postKnowledgeTheme();
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    return () => observer.disconnect();
  }, [postKnowledgeTheme]);

  return (
    <>
      <div
        ref={webviewContainerRef}
        className="relative h-full overflow-hidden rounded-lg border border-border bg-background"
      />
      <KnowledgeSessionUploadModal
        isOpen={Boolean(uploadRequest)}
        knowledgeBaseName={knowledgeBaseName}
        isUploading={isUploading}
        progressText={uploadProgress}
        onCancel={() => {
          if (isUploading) return;
          setUploadRequest(null);
        }}
        onSubmit={sessions => {
          void handleUploadLocalSessions(sessions);
        }}
      />
    </>
  );
};

export default KnowledgeBaseFrame;
