import { ipcRenderer } from 'electron';

import { KnowledgeWebviewMessage } from '../shared/knowledge/constants';

type KnowledgeUploadLocalSessionMessage = {
  type?: unknown;
  knowledge_base_id?: unknown;
  knowledge_base_name?: unknown;
};

function isUploadLocalSessionMessage(value: unknown): value is KnowledgeUploadLocalSessionMessage {
  return Boolean(
    value
    && typeof value === 'object'
    && (value as KnowledgeUploadLocalSessionMessage).type === KnowledgeWebviewMessage.UploadLocalSession
  );
}

function forwardMessage(value: unknown): void {
  if (!isUploadLocalSessionMessage(value)) return;
  ipcRenderer.sendToHost(KnowledgeWebviewMessage.UploadLocalSession, value);
}

ipcRenderer.sendToHost(KnowledgeWebviewMessage.PreloadReady, {
  type: KnowledgeWebviewMessage.PreloadReady,
});

window.addEventListener('message', (event) => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  forwardMessage(event.data);
});
