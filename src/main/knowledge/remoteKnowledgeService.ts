import type { IpcMain } from 'electron';

import {
  KNOWLEDGE_DEFAULT_BASE_URL,
  KnowledgeIpc,
  type GetWikiPageRequest,
  type KnowledgeResult,
  type PreviewRagContextRequest,
  type PreviewRagContextResult,
  type RemoteKnowledgeBase,
  type UploadLocalSessionMarkdownRequest,
  type UploadLocalSessionMarkdownResult,
  type WikiPage,
} from '../../shared/knowledge/constants';

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const readString = (source: Record<string, unknown>, keys: string[]): string => {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
  }
  return '';
};

const readNumber = (source: Record<string, unknown>, keys: string[]): number | undefined => {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return undefined;
};

const readArray = (payload: unknown, keys: string[]): unknown[] => {
  if (Array.isArray(payload)) return payload;
  if (!isRecord(payload)) return [];

  for (const key of keys) {
    const value = payload[key];
    if (Array.isArray(value)) {
      return value;
    }
    if (isRecord(value)) {
      const nested = readArray(value, keys);
      if (nested.length > 0) {
        return nested;
      }
    }
  }
  return [];
};

const normalizeKnowledgeBase = (value: unknown): RemoteKnowledgeBase | null => {
  if (!isRecord(value)) return null;

  const id = readString(value, ['id', 'uuid', 'key', 'knowledgeBaseId', 'knowledge_base_id']);
  if (!id) return null;

  const name = readString(value, ['name', 'title', 'displayName', 'display_name']) || id;
  const description = readString(value, ['description', 'desc', 'summary']);
  const documentCount = readNumber(value, ['documentCount', 'document_count', 'documentsCount', 'docsCount', 'knowledge_count', 'chunk_count']);
  const updatedAt = readNumber(value, ['updatedAt', 'updated_at', 'mtime', 'modifiedAt']);
  const enabled = typeof value.enabled === 'boolean' ? value.enabled : undefined;

  return {
    id,
    name,
    ...(description ? { description } : {}),
    ...(documentCount !== undefined ? { documentCount } : {}),
    ...(enabled !== undefined ? { enabled } : {}),
    ...(updatedAt !== undefined ? { updatedAt } : {}),
    raw: value,
  };
};

const sanitizeKnowledgeUploadFileName = (value: string): string => {
  const sanitized = value.replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ').replace(/\s+/g, ' ').trim();
  return sanitized || 'cowork-session.md';
};

const sanitizeUploadLocalSessionMarkdownRequest = (request: unknown): UploadLocalSessionMarkdownRequest => {
  if (!isRecord(request)) {
    throw new Error('Invalid upload request');
  }

  const knowledgeBaseId = typeof request.knowledgeBaseId === 'string' ? request.knowledgeBaseId.trim() : '';
  const fileName = typeof request.fileName === 'string' ? sanitizeKnowledgeUploadFileName(request.fileName) : '';
  const markdown = typeof request.markdown === 'string' ? request.markdown : '';

  if (!knowledgeBaseId) throw new Error('Knowledge base id is required');
  if (!fileName) throw new Error('File name is required');
  if (!markdown.trim()) throw new Error('Markdown content is required');

  return {
    knowledgeBaseId,
    fileName,
    markdown,
  };
};

export type RemoteKnowledgeServiceOptions = {
  getAccessKey?: () => string | null;
};

export class RemoteKnowledgeService {
  constructor(private readonly options: RemoteKnowledgeServiceOptions = {}) {}

  async listBases(): Promise<RemoteKnowledgeBase[]> {
    const payload = await this.request('/api/v1/knowledge-bases');
    return readArray(payload, ['items', 'data', 'list', 'records', 'knowledgeBases', 'knowledge_bases'])
      .map(normalizeKnowledgeBase)
      .filter((base): base is RemoteKnowledgeBase => base !== null);
  }

  async previewRagContext(request: PreviewRagContextRequest): Promise<PreviewRagContextResult> {
    const query = request.query.trim();
    if (!query) {
      return {
        success: false,
        error: 'Query is required',
      };
    }

    const payload = await this.request('/api/v1/agent-chat/preview-rag-context', {
      method: 'POST',

      body: JSON.stringify({
        query,
        knowledge_base_ids: request.knowledgeBaseIds,
        knowledge_ids: request.knowledgeIds,
        agent_id: request.agentId,
        web_search_enabled: request.webSearchEnabled,
        summary_model_id: request.summaryModelId,
        mentioned_items: request.mentionedItems,
        enable_memory: request.enableMemory,
        images: request.images,
        attachment_uploads: request.attachmentUploads,
        channel: request.channel,
      }),
    });

    if (isRecord(payload) && typeof payload.success === 'boolean') {
      return payload as unknown as PreviewRagContextResult;
    }

    return {
      success: true,
      data: isRecord(payload) && isRecord(payload.data)
        ? payload.data as PreviewRagContextResult['data']
        : payload as PreviewRagContextResult['data'],
    };
  }

  async getWikiPage(request: GetWikiPageRequest): Promise<KnowledgeResult<WikiPage>> {
    const knowledgeBaseId = request.knowledgeBaseId.trim();
    const slug = request.slug.trim();
    if (!knowledgeBaseId || !slug) {
      return {
        success: false,
        error: 'Knowledge base id and slug are required',
      };
    }

    const payload = await this.request(
      `/api/v1/knowledgebase/${encodeURIComponent(knowledgeBaseId)}/wiki/pages/${encodeURIComponent(slug)}`,
    );
    return {
      success: true,
      data: isRecord(payload) && isRecord(payload.data)
        ? payload.data as unknown as WikiPage
        : payload as WikiPage,
    };
  }

  async uploadLocalSessionMarkdown(
    request: UploadLocalSessionMarkdownRequest,
  ): Promise<UploadLocalSessionMarkdownResult> {
    const sanitizedRequest = sanitizeUploadLocalSessionMarkdownRequest(request);
    const apiKey = this.options.getAccessKey?.();
    if (!apiKey) {
      return { success: false, error: 'Knowledge access token is missing' };
    }

    const form = new FormData();
    form.append(
      'file',
      new Blob([sanitizedRequest.markdown], { type: 'text/markdown;charset=utf-8' }),
      sanitizedRequest.fileName,
    );
    form.append('fileName', sanitizedRequest.fileName);
    form.append('channel', 'web');

    const payload = await this.request(
      `/api/v1/knowledge-bases/${encodeURIComponent(sanitizedRequest.knowledgeBaseId)}/knowledge/file`,
      {
        method: 'POST',
        body: form,
        jsonBody: false,
      },
    );

    if (isRecord(payload) && payload.success && isRecord(payload.data) && payload.data.id) {
      return {
        success: true,
        knowledgeId: String(payload.data.id),
      };
    }

    const message = isRecord(payload) && typeof payload.message === 'string'
      ? payload.message
      : 'Knowledge upload failed';
    return { success: false, error: message };
  }

  registerIpc(ipcMain: IpcMain): void {
    ipcMain.handle(KnowledgeIpc.ListBases, async (): Promise<KnowledgeResult<RemoteKnowledgeBase[]>> => {
      try {
        return { success: true, data: await this.listBases() };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Failed to list remote knowledge bases' };
      }
    });

    ipcMain.handle(KnowledgeIpc.PreviewRagContext, async (_event, request: PreviewRagContextRequest): Promise<PreviewRagContextResult> => {
      try {
        return await this.previewRagContext(request);
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Failed to preview RAG context' };
      }
    });

    ipcMain.handle(KnowledgeIpc.GetWikiPage, async (_event, request: GetWikiPageRequest): Promise<KnowledgeResult<WikiPage>> => {
      try {
        return await this.getWikiPage(request);
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Failed to get wiki page' };
      }
    });

    ipcMain.handle(KnowledgeIpc.UploadLocalSessionMarkdown, async (_event, request: UploadLocalSessionMarkdownRequest): Promise<UploadLocalSessionMarkdownResult> => {
      try {
        return await this.uploadLocalSessionMarkdown(request);
      } catch (error) {
        console.warn('[RemoteKnowledgeService] local session markdown upload failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Failed to upload local session markdown' };
      }
    });
  }

  private async request(
    pathname: string,
    init?: RequestInit & { jsonBody?: boolean },
  ): Promise<unknown> {
    const shouldSendJson = init?.jsonBody !== false && Boolean(init?.body);
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...(shouldSendJson ? { 'Content-Type': 'application/json' } : {}),
    };
    const apiKey = this.options.getAccessKey?.();
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
      headers['X-API-Key'] = apiKey;
    }

    const response = await fetch(`${KNOWLEDGE_DEFAULT_BASE_URL}${pathname}`, {
      method: init?.method ?? 'GET',
      body: init?.body,
      headers: {
        ...headers,
        ...(init?.headers as Record<string, string> | undefined),
      },
    });
    const text = await response.text();
    const payload = text ? JSON.parse(text) : null;
    if (!response.ok) {
      const message = isRecord(payload) && typeof payload.message === 'string'
        ? payload.message
        : `Remote knowledge request failed with HTTP ${response.status}`;
      throw new Error(message);
    }
    return payload;
  }
}
