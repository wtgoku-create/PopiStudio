import type {
  GetWikiPageRequest,
  KnowledgeResult,
  PreviewRagContextRequest,
  PreviewRagContextResult,
  RemoteKnowledgeBase,
  WikiPage,
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

  async getWikiPage(request: GetWikiPageRequest): Promise<KnowledgeResult<WikiPage>> {
    const knowledgeApi = window.electron?.knowledge;
    if (!knowledgeApi?.getWikiPage) {
      return {
        success: false,
        error: 'Knowledge IPC is unavailable',
      };
    }

    try {
      return await knowledgeApi.getWikiPage(request);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get wiki page',
      };
    }
  }
}

export const knowledgeService = new KnowledgeService();
