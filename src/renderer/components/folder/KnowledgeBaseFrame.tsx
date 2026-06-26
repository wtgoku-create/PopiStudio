import React, { useCallback, useEffect, useRef } from 'react';
import { useSelector } from 'react-redux';

import { i18nService } from '../../services/i18n';
import type { RootState } from '../../store';

const KNOWLEDGE_BASES_URL = 'http://localhost:5174/platform/knowledge-bases';

const KnowledgeBaseFrame: React.FC = () => {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const isLoggedIn = useSelector((state: RootState) => state.auth.isLoggedIn);

  const postKnowledgeToken = useCallback(async () => {
    const targetWindow = iframeRef.current?.contentWindow;
    console.log('targetWindow', targetWindow);
    if (!targetWindow) return;

    const token = isLoggedIn
      ? await window.electron?.auth?.getKnowledgeToken?.()
      : '';
      console.log('token', token);
    targetWindow.postMessage(
      { type: 'weknora:kb-token', token: token || '' },
      '*',
    );
  }, [isLoggedIn]);

  useEffect(() => {
    void postKnowledgeToken();
  }, [postKnowledgeToken]);

  return (
    <div className="h-full overflow-hidden rounded-lg border border-border bg-background">
      <iframe
        ref={iframeRef}
        title={i18nService.t('knowledgeBase')}
        src={KNOWLEDGE_BASES_URL}
        className="h-full w-full border-0 bg-background"
        sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-downloads"
        onLoad={() => void postKnowledgeToken()}
      />
    </div>
  );
};

export default KnowledgeBaseFrame;
