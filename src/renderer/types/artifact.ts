export const ArtifactTypeValue = {
  Html: 'html',
  Svg: 'svg',
  Image: 'image',
  Video: 'video',
  Audio: 'audio',
  Mermaid: 'mermaid',
  Code: 'code',
  Markdown: 'markdown',
  Text: 'text',
  Wiki: 'wiki',
  Document: 'document',
  LocalService: 'local-service',
} as const;
export type ArtifactType = typeof ArtifactTypeValue[keyof typeof ArtifactTypeValue];

export const PREVIEWABLE_ARTIFACT_TYPES = new Set<ArtifactType>([
  ArtifactTypeValue.Html,
  ArtifactTypeValue.Svg,
  ArtifactTypeValue.Mermaid,
  ArtifactTypeValue.Image,
  ArtifactTypeValue.Video,
  ArtifactTypeValue.Audio,
  ArtifactTypeValue.Markdown,
  ArtifactTypeValue.Text,
  ArtifactTypeValue.Wiki,
  ArtifactTypeValue.Document,
  ArtifactTypeValue.LocalService,
]);

export interface Artifact {
  id: string;
  messageId: string;
  sessionId: string;
  type: ArtifactType;
  title: string;
  content: string;
  language?: string;
  fileName?: string;
  filePath?: string;
  url?: string;
  contentVersion?: number;
  metadata?: Record<string, unknown>;
  createdAt: number;
}

export interface ArtifactMarker {
  type: ArtifactType;
  title: string;
  content: string;
  language?: string;
  fullMatch: string;
}
