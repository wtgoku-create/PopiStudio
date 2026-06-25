import type {
  KnowledgeResult,
  PreviewRagContextRequest,
  PreviewRagContextResult,
  RemoteKnowledgeBase,
} from '../../shared/knowledge/constants';

class KnowledgeService {
  async listBases(): Promise<KnowledgeResult<RemoteKnowledgeBase[]>> {
    const knowledgeApi = window.electron?.knowledge;
    if (!knowledgeApi?.listBases) {
      return {
        success: false,
        error: 'Knowledge IPC is unavailable',
      };
    }

    try {
      return await knowledgeApi.listBases();
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list knowledge bases',
      };
    }
  }

  async previewRagContext(request: PreviewRagContextRequest): Promise<PreviewRagContextResult> {
    const knowledgeApi = window.electron?.knowledge;
    if (!knowledgeApi?.previewRagContext) {
      return {
        success: false,
        error: 'Knowledge IPC is unavailable',
      };
    }

    try {
      return await knowledgeApi.previewRagContext(request);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to preview RAG context',
      };
    }
  }
}

export const knowledgeService = new KnowledgeService();
