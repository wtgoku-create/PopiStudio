import type { IpcMain } from 'electron';

import {
  KNOWLEDGE_DEFAULT_BASE_URL,
  KnowledgeIpc,
  type KnowledgeResult,
  type PreviewRagContextRequest,
  type PreviewRagContextResult,
  type RemoteKnowledgeBase,
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

export class RemoteKnowledgeService {
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
  }

  private async request(pathname: string, init?: RequestInit): Promise<unknown> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
    };
    const apiKey ='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6IjI5Mjc5MzM0MjZAcXEuY29tIiwiZXhwIjoxNzgyMzcwNTA5LCJpYXQiOjE3ODIyODQxMDksInRlbmFudF9pZCI6MTAwMDIsInR5cGUiOiJhY2Nlc3MiLCJ1c2VyX2lkIjoiZmMyZDkwODUtNmUzNi00NzdjLTljNGQtYjMwYmYwZjhkNzE2In0.-3x_VJ4vkbM0_rCxkUBVlp3dh0-gHQrB6xoKI-mHUzk';
    if (apiKey) {
      headers['X-API-Key'] = apiKey;
      headers.Authorization = `Bearer ${apiKey}`;
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
