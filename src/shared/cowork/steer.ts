import type { CoworkBrowserAnnotationMessageBatch } from './browserAnnotations';
import type { CoworkPromptDocument, CoworkPromptResourceSource } from './promptDocument';

export const CoworkSteerStatus = {
  Pending: 'pending',
  Accepted: 'accepted',
  Rejected: 'rejected',
} as const;
export type CoworkSteerStatus = typeof CoworkSteerStatus[keyof typeof CoworkSteerStatus];

export const CoworkSteerRejectReason = {
  NoActiveTurn: 'no_active_turn',
  NotStreaming: 'not_streaming',
  ContextMaintenance: 'context_maintenance',
  RuntimeUnsupported: 'runtime_unsupported',
  RuntimeRejected: 'runtime_rejected',
  EmptyInput: 'empty_input',
  Unknown: 'unknown',
} as const;
export type CoworkSteerRejectReason =
  typeof CoworkSteerRejectReason[keyof typeof CoworkSteerRejectReason];

export interface CoworkSteerRequest {
  sessionId: string;
  text: string;
  clientSteerId: string;
}

export interface CoworkSteerResponse {
  success: boolean;
  status: CoworkSteerStatus;
  clientSteerId: string;
  error?: string;
  reason?: CoworkSteerRejectReason;
}

export interface CoworkPendingSteer {
  id: string;
  sessionId: string;
  text: string;
  attachments?: CoworkSteerAttachment[];
  browserAnnotations?: CoworkBrowserAnnotationMessageBatch[];
  promptDocument?: CoworkPromptDocument;
  status: CoworkSteerStatus;
  createdAt: number;
  updatedAt: number;
  error?: string;
  reason?: CoworkSteerRejectReason;
}

export interface CoworkSteerAttachment {
  path: string;
  name: string;
  isImage?: boolean;
  isDirectory?: boolean;
  dataUrl?: string;
  source?: CoworkPromptResourceSource;
}
