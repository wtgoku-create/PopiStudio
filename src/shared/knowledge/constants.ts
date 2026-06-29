export const KnowledgeIpc = {
  ListBases: 'knowledge:bases:list',
  PreviewRagContext: 'knowledge:rag:previewContext',
  GetWikiPage: 'knowledge:wiki:getPage',
} as const;

export type KnowledgeIpc = typeof KnowledgeIpc[keyof typeof KnowledgeIpc];
// https://weknora.popi.art
export const KNOWLEDGE_DEFAULT_BASE_URL = 'http://localhost:5174';
export const KNOWLEDGE_BASES_URL = `${KNOWLEDGE_DEFAULT_BASE_URL}/kb/platform/knowledge-bases`;

export const KnowledgeBrowserPartition = {
  Default: 'persist:popiai-knowledge-browser',
} as const;

export type KnowledgeBrowserPartition = typeof KnowledgeBrowserPartition[keyof typeof KnowledgeBrowserPartition];

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

export interface GetWikiPageRequest {
  knowledgeBaseId: string;
  slug: string;
}

export interface WikiPage {
  id: string;
  tenant_id: number;
  knowledge_base_id: string;
  slug: string;
  title: string;
  page_type: string;
  status: string;
  content: string;
  summary: string;
  aliases: string[];
  parent_slug?: string;
  category_path?: string[];
  wiki_path?: string;
  depth?: number;
  sort_order?: number;
  source_refs: string[];
  in_links: string[];
  out_links: string[];
  page_metadata: Record<string, unknown>;
  version: number;
  created_at: string;
  updated_at: string;
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
