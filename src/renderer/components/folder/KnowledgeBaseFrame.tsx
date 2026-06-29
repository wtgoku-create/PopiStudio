import { KNOWLEDGE_BASES_URL, KnowledgeBrowserPartition } from '@shared/knowledge/constants';
import React, { useCallback, useEffect, useRef } from 'react';
import { useSelector } from 'react-redux';

import { i18nService } from '../../services/i18n';
import type { RootState } from '../../store';

type KnowledgeWebviewElement = HTMLElement & {
  addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => void;
  executeJavaScript?: (code: string) => Promise<unknown>;
  removeEventListener: (type: string, listener: EventListenerOrEventListenerObject) => void;
};

const getKnowledgeTheme = (): string => {
  return document.documentElement.dataset.theme?.includes('dark') ? 'dark' : 'light';
};

const KnowledgeBaseFrame: React.FC = () => {
  const webviewRef = useRef<KnowledgeWebviewElement | null>(null);
  const isWebviewReadyRef = useRef(false);
  const postKnowledgeThemeRef = useRef<() => void>(() => undefined);
  const postKnowledgeTokenRef = useRef<() => void>(() => undefined);
  const isLoggedIn = useSelector((state: RootState) => state.auth.isLoggedIn);

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
    console.log('postKnowledgeTheme', theme);

    await postKnowledgeMessage({
      type: 'weknora:theme',
      theme,
    });
  }, [postKnowledgeMessage]);

  useEffect(() => {
    void postKnowledgeToken();
    void postKnowledgeTheme();
  }, [postKnowledgeTheme, postKnowledgeToken]);

  useEffect(() => {
    postKnowledgeTokenRef.current = () => {
      void postKnowledgeToken();
    };
    postKnowledgeThemeRef.current = () => {
      void postKnowledgeTheme();
    };
  }, [postKnowledgeTheme, postKnowledgeToken]);

  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) return;

    const postKnowledgeState = () => {
      postKnowledgeTokenRef.current();
      postKnowledgeThemeRef.current();
    };

    const handleStartLoading = () => {
      isWebviewReadyRef.current = false;
    };

    const handleDomReady = () => {
      isWebviewReadyRef.current = true;
      postKnowledgeState();
    };

    const handleStopLoading = () => {
      postKnowledgeState();
    };

    webview.addEventListener('did-start-loading', handleStartLoading);
    webview.addEventListener('did-stop-loading', handleStopLoading);
    webview.addEventListener('dom-ready', handleDomReady);

    return () => {
      isWebviewReadyRef.current = false;
      webview.removeEventListener('did-start-loading', handleStartLoading);
      webview.removeEventListener('did-stop-loading', handleStopLoading);
      webview.removeEventListener('dom-ready', handleDomReady);
    };
  }, []);

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
    <div className="h-full overflow-hidden rounded-lg border border-border bg-background">
      {React.createElement('webview', {
        ref: webviewRef,
        src: KNOWLEDGE_BASES_URL,
        partition: KnowledgeBrowserPartition.Default,
        className: 'h-full w-full border-0 bg-background',
        title: i18nService.t('knowledgeBase'),
        allowpopups: 'false',
      })}
    </div>
  );
};

export default KnowledgeBaseFrame;
