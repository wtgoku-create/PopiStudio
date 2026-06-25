export const SourceReferenceKind = {
  Chunk: 'chunk',
  Wiki: 'wiki',
  Generic: 'generic',
} as const;

export type SourceReferenceKind =
  typeof SourceReferenceKind[keyof typeof SourceReferenceKind];

export interface ChunkSourceReference {
  kind: typeof SourceReferenceKind.Chunk;
  app: string;
  doc: string;
  kbId: string;
  chunkId: string;
  label: string;
}

export interface WikiSourceReference {
  kind: typeof SourceReferenceKind.Wiki;
  app: string;
  slug: string;
  title: string;
  kbId?: string;
  label: string;
}

export interface GenericSourceReference {
  kind: typeof SourceReferenceKind.Generic;
  app: string;
  type: string;
  id?: string;
  title?: string;
  label: string;
  metadata: Record<string, string>;
}

export type SourceReference =
  | ChunkSourceReference
  | WikiSourceReference
  | GenericSourceReference;
