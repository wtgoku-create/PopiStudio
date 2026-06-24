export const KnowledgeIpc = {
  ListBases: 'knowledge:bases:list',
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

export interface KnowledgeResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}
