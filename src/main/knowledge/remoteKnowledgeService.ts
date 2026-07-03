import type { IpcMain } from 'electron';

import {
  KNOWLEDGE_DEFAULT_BASE_URL,
  type GetChunkByIdRequest,
  KnowledgeIpc,
  type GetWikiPageRequest,
  type KnowledgeChunk,
  type KnowledgeResult,
  type PreviewRagContextRequest,
  type PreviewRagContextResult,
  type RemoteKnowledgeFile,
  type RemoteKnowledgeBase,
  type SearchRecentKnowledgeData,
  type SearchRecentKnowledgeRequest,
  type UploadLocalSessionMarkdownRequest,
  type UploadLocalSessionMarkdownResult,
  type UploadAgentKnowledgeFileRequest,
  type UploadAgentKnowledgeFileResult,
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

const getKnowledgeErrorMessage = (payload: unknown, fallback: string): string => {
  if (!isRecord(payload)) return fallback;

  if (isRecord(payload.error)) {
    const message = readString(payload.error, ['message', 'error', 'detail']);
    const code = readString(payload.error, ['code']);
    if (message && code) return `error code: ${code}, error message: ${message}`;
    if (message) return message;
  }

  const errorText = readString(payload, ['error']);
  if (errorText) return errorText;

  const message = readString(payload, ['message']);
  if (message) return message;

  return fallback;
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

const normalizeKnowledgeFile = (value: unknown): RemoteKnowledgeFile | null => {
  if (!isRecord(value)) return null;
  const id = readString(value, ['id']);
  if (!id) return null;

  return {
    id,
    tenant_id: readNumber(value, ['tenant_id']) ?? 0,
    knowledge_base_id: readString(value, ['knowledge_base_id']),
    knowledge_base_name: readString(value, ['knowledge_base_name']),
    type: readString(value, ['type']),
    title: readString(value, ['title']),
    description: readString(value, ['description']),
    source: readString(value, ['source']),
    channel: readString(value, ['channel']),
    parse_status: readString(value, ['parse_status']),
    summary_status: readString(value, ['summary_status']),
    enable_status: readString(value, ['enable_status']),
    embedding_model_id: readString(value, ['embedding_model_id']),
    file_name: readString(value, ['file_name']),
    file_type: readString(value, ['file_type']),
    file_size: readNumber(value, ['file_size']) ?? 0,
    file_hash: readString(value, ['file_hash']),
    file_path: readString(value, ['file_path']),
    storage_size: readNumber(value, ['storage_size']) ?? 0,
    created_by: readString(value, ['created_by']),
    metadata: isRecord(value.metadata) ? value.metadata : {},
    created_at: readString(value, ['created_at']),
    updated_at: readString(value, ['updated_at']),
    processed_at: readString(value, ['processed_at']),
    error_message: readString(value, ['error_message']),
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

const sanitizeUploadAgentKnowledgeFileRequest = (
  request: UploadAgentKnowledgeFileRequest,
): UploadAgentKnowledgeFileRequest => {
  if (!request || !(request.file instanceof Blob)) {
    throw new Error('Upload file is required');
  }

  if (typeof request.fileName !== 'string' || !request.fileName.trim()) {
    throw new Error('File name is required');
  }
  const fileName = sanitizeKnowledgeUploadFileName(request.fileName);

  const apiKey = typeof request.apiKey === 'string' ? request.apiKey.trim() : undefined;
  const channel = typeof request.channel === 'string' && request.channel.trim()
    ? request.channel.trim()
    : 'agent';

  return {
    file: request.file,
    fileName,
    ...(apiKey ? { apiKey } : {}),
    ...(isRecord(request.metadata) ? { metadata: request.metadata } : {}),
    channel,
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

  async searchRecentKnowledge(
    request: SearchRecentKnowledgeRequest = {},
  ): Promise<SearchRecentKnowledgeData> {
    const offset = Math.max(0, Math.trunc(request.offset ?? 0));
    const limit = Math.min(Math.max(1, Math.trunc(request.limit ?? 20)), 100);
    const payload = await this.request(`/api/v1/knowledge/search?recent=true&offset=${offset}&limit=${limit}`);
    const items = readArray(payload, ['data', 'items', 'list', 'records'])
      .map(normalizeKnowledgeFile)
      .filter((file): file is RemoteKnowledgeFile => file !== null);
    const hasMore = isRecord(payload) && typeof payload.has_more === 'boolean'
      ? payload.has_more
      : false;
    return { items, hasMore };
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

  async getChunkById(request: GetChunkByIdRequest): Promise<KnowledgeResult<KnowledgeChunk>> {
    const chunkId = request.chunkId.trim();
    if (!chunkId) {
      return {
        success: false,
        error: 'Chunk id is required',
      };
    }

    const payload = await this.request(
      `/api/v1/chunks/by-id/${encodeURIComponent(chunkId)}`,
    );
    return {
      success: true,
      data: isRecord(payload) && isRecord(payload.data)
        ? payload.data as unknown as KnowledgeChunk
        : payload as KnowledgeChunk,
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

  async uploadAgentKnowledgeFile(
    request: UploadAgentKnowledgeFileRequest,
  ): Promise<UploadAgentKnowledgeFileResult> {
    const sanitizedRequest = sanitizeUploadAgentKnowledgeFileRequest(request);
    const apiKey = sanitizedRequest.apiKey || this.options.getAccessKey?.();
    if (!apiKey) {
      return { success: false, error: 'Knowledge access token is missing' };
    }

    const form = new FormData();
    form.append('file', sanitizedRequest.file, sanitizedRequest.fileName);
    form.append('fileName', sanitizedRequest.fileName);
    form.append('channel', sanitizedRequest.channel || 'agent');
    if (sanitizedRequest.metadata) {
      form.append('metadata', JSON.stringify(sanitizedRequest.metadata));
    }

    const payload = await this.request('/api/v1/knowledge/agent-kb/file', {
      method: 'POST',
      body: form,
      jsonBody: false,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'X-API-Key': apiKey,
      },
    });

    const data = isRecord(payload) && isRecord(payload.data) ? payload.data : {};
    const knowledge = isRecord(data.knowledge)
      ? normalizeKnowledgeFile(data.knowledge)
      : null;
    const knowledgeBaseId = readString(data, ['knowledge_base_id', 'knowledgeBaseId']);
    const knowledgeId = knowledge?.id || (isRecord(data.knowledge) ? readString(data.knowledge, ['id']) : '');

    if (isRecord(payload) && payload.success === true) {
      return {
        success: true,
        ...(knowledgeId ? { knowledgeId } : {}),
        ...(knowledgeBaseId ? { knowledgeBaseId } : {}),
        ...(knowledge ? { knowledge } : {}),
        raw: payload,
      };
    }

    return {
      success: false,
      error: getKnowledgeErrorMessage(payload, 'Knowledge upload failed'),
      raw: payload,
    };
  }

  registerIpc(ipcMain: IpcMain): void {
    ipcMain.handle(KnowledgeIpc.ListBases, async (): Promise<KnowledgeResult<RemoteKnowledgeBase[]>> => {
      try {
        return { success: true, data: await this.listBases() };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Failed to list remote knowledge bases' };
      }
    });

    ipcMain.handle(KnowledgeIpc.SearchRecentKnowledge, async (_event, request: SearchRecentKnowledgeRequest): Promise<KnowledgeResult<SearchRecentKnowledgeData>> => {
      try {
        return { success: true, data: await this.searchRecentKnowledge(request) };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Failed to search recent knowledge files' };
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

    ipcMain.handle(KnowledgeIpc.GetChunkById, async (_event, request: GetChunkByIdRequest): Promise<KnowledgeResult<KnowledgeChunk>> => {
      try {
        return await this.getChunkById(request);
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Failed to get knowledge chunk' };
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
      throw new Error(getKnowledgeErrorMessage(
        payload,
        `Remote knowledge request failed with HTTP ${response.status}`,
      ));
    }
    if (isRecord(payload) && payload.success === false) {
      throw new Error(getKnowledgeErrorMessage(payload, 'Remote knowledge request failed'));
    }
    return payload;
  }
}
