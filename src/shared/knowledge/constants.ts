export const KnowledgeIpc = {
  ListBases: 'knowledge:bases:list',
  PreviewRagContext: 'knowledge:rag:previewContext',
} as const;

export type KnowledgeIpc = typeof KnowledgeIpc[keyof typeof KnowledgeIpc];

export const KNOWLEDGE_DEFAULT_BASE_URL = 'http://192.168.77.27:8080';

export interface RemoteKnowledgeBase {
  id: string;
  name: string;
  description?: string;
  documentCount?: number;
  enabled?: boolean;
  updatedAt?: number;
  raw?: unknown;
}

export interface PreviewRagContextRequest {
  query: string;
  knowledgeBaseIds?: string[];
  knowledgeIds?: string[];
  agentId?: string;
  webSearchEnabled?: boolean;
  summaryModelId?: string;
  mentionedItems?: Array<Record<string, unknown>>;
  enableMemory?: boolean;
  images?: Array<Record<string, unknown>>;
  attachmentUploads?: Array<Record<string, unknown>>;
  channel?: string;
}

export interface RagContextChunk {
  id: string;
  knowledge_id?: string;
  knowledge_base_id?: string;
  knowledge_title?: string;
  chunk_index?: number;
  content: string;
  score?: number;
  chunk_type?: string;
  [key: string]: unknown;
}

export interface PreviewRagContextData {
  query: string;
  rewrite_query?: string;
  intent?: string;
  knowledge_base_ids?: string[];
  knowledge_ids?: string[];
  search_targets?: Array<Record<string, unknown>>;
  chat_model_id?: string;
  rerank_model_id?: string;
  web_search_enabled?: boolean;
  enable_rewrite?: boolean;
  context_template?: string;
  search_result?: RagContextChunk[];
  rerank_result?: RagContextChunk[];
  merge_result?: RagContextChunk[];
  rendered_contexts?: string;
  user_content?: string;
  [key: string]: unknown;
}

export interface PreviewRagContextResult {
  success: boolean;
  data?: PreviewRagContextData;
  error?: string;
}

export interface KnowledgeResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}
