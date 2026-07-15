export const KnowledgeIpc = {
  ListBases: 'knowledge:bases:list',
  SearchRecentKnowledge: 'knowledge:knowledge:searchRecent',
  PreviewRagContext: 'knowledge:rag:previewContext',
  GetWikiPage: 'knowledge:wiki:getPage',
  GetChunkById: 'knowledge:chunks:getById',
  UploadLocalSessionMarkdown: 'knowledge:localSession:uploadMarkdown',
} as const;

export type KnowledgeIpc = typeof KnowledgeIpc[keyof typeof KnowledgeIpc];

export const KnowledgeSkill = {
  Base: 'knowledge-base',
} as const;

export type KnowledgeSkill = typeof KnowledgeSkill[keyof typeof KnowledgeSkill];

export const KnowledgeBaseUrl = {
  Production: 'https://rag.popi.art',
  Test: 'https://weknora.popi.art',
} as const;

export type KnowledgeBaseUrl = typeof KnowledgeBaseUrl[keyof typeof KnowledgeBaseUrl];

export const KnowledgePath = {
  Root: '/kb',
  Bases: '/kb/platform/knowledge-bases',
} as const;

export type KnowledgePath = typeof KnowledgePath[keyof typeof KnowledgePath];

export const getKnowledgeDefaultBaseUrl = (testMode: boolean): KnowledgeBaseUrl => (
  testMode ? KnowledgeBaseUrl.Test : KnowledgeBaseUrl.Production
);

export const getKnowledgeBasesUrl = (testMode: boolean): string => (
  `${getKnowledgeDefaultBaseUrl(testMode)}${KnowledgePath.Bases}`
);

export const getKnowledgeFrameSource = (testMode: boolean): string => (
  `${getKnowledgeDefaultBaseUrl(testMode)}${KnowledgePath.Root}`
);

export const KnowledgeNavigationEvent = {
  OpenGraph: 'knowledge:navigation:openGraph',
} as const;

export type KnowledgeNavigationEvent =
  typeof KnowledgeNavigationEvent[keyof typeof KnowledgeNavigationEvent];

export interface OpenKnowledgeGraphEventDetail {
  knowledgeBaseId: string;
  slug: string;
}

export const KnowledgeBrowserPartition = {
  Default: 'persist:popiai-knowledge-browser',
} as const;

export type KnowledgeBrowserPartition = typeof KnowledgeBrowserPartition[keyof typeof KnowledgeBrowserPartition];

export const KnowledgeWebviewMessage = {
  UploadLocalSession: 'weknora:upload-local-session',
  LocalSessionUploadComplete: 'weknora:local-session-upload-complete',
  PreloadReady: 'weknora:preload-ready',
} as const;

export type KnowledgeWebviewMessage = typeof KnowledgeWebviewMessage[keyof typeof KnowledgeWebviewMessage];

export interface RemoteKnowledgeBase {
  id: string;
  name: string;
  description?: string;
  documentCount?: number;
  enabled?: boolean;
  updatedAt?: number;
  raw?: unknown;
}

export interface SearchRecentKnowledgeRequest {
  recent?: boolean;
  offset?: number;
  limit?: number;
}

export interface RemoteKnowledgeFile {
  id: string;
  tenant_id: number;
  knowledge_base_id: string;
  knowledge_base_name: string;
  type: string;
  title: string;
  description: string;
  source: string;
  channel: string;
  parse_status: string;
  summary_status: string;
  enable_status: string;
  embedding_model_id: string;
  file_name: string;
  file_type: string;
  file_size: number;
  file_hash: string;
  file_path: string;
  storage_size: number;
  created_by: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  processed_at: string;
  error_message: string;
}

export interface SearchRecentKnowledgeData {
  items: RemoteKnowledgeFile[];
  hasMore: boolean;
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

export interface GetChunkByIdRequest {
  chunkId: string;
}

export interface UploadLocalSessionMarkdownRequest {
  knowledgeBaseId: string;
  fileName: string;
  markdown: string;
}

export interface UploadLocalSessionMarkdownResult {
  success: boolean;
  knowledgeId?: string;
  error?: string;
}

export interface UploadAgentKnowledgeFileRequest {
  file: Blob;
  fileName: string;
  apiKey?: string;
  metadata?: Record<string, unknown>;
  channel?: string;
}

export interface UploadAgentKnowledgeFileResult {
  success: boolean;
  knowledgeId?: string;
  knowledgeBaseId?: string;
  knowledge?: RemoteKnowledgeFile;
  raw?: unknown;
  error?: string;
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

export interface KnowledgeChunk {
  id: string;
  seq_id: number;
  knowledge_id: string;
  knowledge_base_id: string;
  tenant_id: number;
  tag_id: string;
  content: string;
  chunk_index: number;
  is_enabled: boolean;
  status: number;
  start_at: number;
  end_at: number;
  pre_chunk_id: string;
  next_chunk_id: string;
  chunk_type: string;
  parent_chunk_id: string;
  relation_chunks: unknown;
  indirect_relation_chunks: unknown;
  metadata: unknown;
  content_hash: string;
  image_info: string;
  created_at: string;
  updated_at: string;
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
