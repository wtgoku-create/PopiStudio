import type { OpenClawSessionPatch } from '../../../common/openclawSession';
import type { CoworkBrowserAnnotationMessageBatch } from '../../../shared/cowork/browserAnnotations';
import type { CoworkErrorDetail } from '../../../shared/cowork/errorDetail';
import type { CoworkGoal } from '../../../shared/cowork/goal';
import type { PlanControl, PlanControlState } from '../../../shared/cowork/planProtocol';
import type { CoworkSelectedTextSnippet } from '../../../shared/cowork/selectedText';
import type { CoworkSteerResponse } from '../../../shared/cowork/steer';
import type { CoworkMessage, CoworkSessionStatus } from '../../coworkStore';

export type CoworkAgentEngine = 'openclaw';

export type PermissionResult =
  | {
      behavior: 'allow';
      updatedInput?: Record<string, unknown>;
      updatedPermissions?: Record<string, unknown>[];
      toolUseID?: string;
    }
  | {
      behavior: 'deny';
      message: string;
      interrupt?: boolean;
      toolUseID?: string;
    };

export const ENGINE_SWITCHED_CODE = 'ENGINE_SWITCHED';

export interface PermissionRequest {
  requestId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  toolUseId?: string | null;
}

export interface CoworkRuntimeEvents {
  message: (sessionId: string, message: CoworkMessage, beforeMessageId?: string) => void;
  messageUpdate: (sessionId: string, messageId: string, content: string, metadata?: Record<string, unknown>) => void;
  sessionStatus: (sessionId: string, status: CoworkSessionStatus) => void;
  contextUsageUpdate: (sessionId: string, usage: CoworkContextUsage) => void;
  goalUpdate: (sessionId: string, goal: CoworkGoal | null) => void;
  contextMaintenance: (sessionId: string, active: boolean) => void;
  permissionRequest: (sessionId: string, request: PermissionRequest) => void;
  complete: (sessionId: string, claudeSessionId: string | null) => void;
  error: (sessionId: string, error: string, errorDetail?: CoworkErrorDetail) => void;
  sessionStopped: (sessionId: string) => void;
}

export type CoworkContextUsage = {
  sessionId: string;
  sessionKey?: string;
  usedTokens?: number;
  contextTokens?: number;
  percent?: number;
  compactionCount?: number;
  status: 'unknown' | 'normal' | 'warning' | 'danger' | 'compacting';
  latestCompactionCheckpointId?: string;
  latestCompactionReason?: string;
  latestCompactionCreatedAt?: number;
  model?: string;
  updatedAt: number;
};

export type CoworkForkCompactionSummary = {
  summary: string;
  sessionKey: string;
  checkpointId?: string;
  reason?: string;
  createdAt?: number;
  tokensBefore?: number;
  tokensAfter?: number;
  truncated?: boolean;
};

export type CoworkImageAttachment = {
  name: string;
  mimeType: string;
  base64Data: string;
};

export type CoworkCreateRuntimeSessionOptions = {
  agentId?: string;
  model?: string;
};

export type CoworkStartOptions = {
  skipInitialUserMessage?: boolean;
  skillIds?: string[];
  systemPrompt?: string;
  autoApprove?: boolean;
  workspaceRoot?: string;
  confirmationMode?: 'modal' | 'text';
  imageAttachments?: CoworkImageAttachment[];
  selectedTextSnippets?: CoworkSelectedTextSnippet[];
  browserAnnotations?: CoworkBrowserAnnotationMessageBatch[];
  agentId?: string;
  planControl?: PlanControl;
};

export type CoworkContinueOptions = {
  skipInitialUserMessage?: boolean;
  systemPrompt?: string;
  extraSystemPrompt?: string;
  skillIds?: string[];
  confirmationMode?: 'modal' | 'text';
  imageAttachments?: CoworkImageAttachment[];
  selectedTextSnippets?: CoworkSelectedTextSnippet[];
  browserAnnotations?: CoworkBrowserAnnotationMessageBatch[];
  planControl?: PlanControl;
};

export interface CoworkRuntime {
  on<U extends keyof CoworkRuntimeEvents>(
    event: U,
    listener: CoworkRuntimeEvents[U],
  ): this;
  off<U extends keyof CoworkRuntimeEvents>(
    event: U,
    listener: CoworkRuntimeEvents[U],
  ): this;
  startSession(sessionId: string, prompt: string, options?: CoworkStartOptions): Promise<void>;
  continueSession(sessionId: string, prompt: string, options?: CoworkContinueOptions): Promise<void>;
  createSession?(sessionId: string, options?: CoworkCreateRuntimeSessionOptions): Promise<void>;
  patchSession?(sessionId: string, patch: OpenClawSessionPatch): Promise<void>;
  getPlanControlState?(sessionId: string): Promise<PlanControlState | null>;
  controlPlanMode?(sessionId: string, control: PlanControl): Promise<PlanControlState | null>;
  getContextUsage?(sessionId: string): Promise<CoworkContextUsage | null>;
  compactContext?(sessionId: string): Promise<{ compacted: boolean; reason?: string; usage?: CoworkContextUsage | null }>;
  getForkCompactionSummary?(sessionId: string, beforeCreatedAt?: number): Promise<CoworkForkCompactionSummary | null>;
  submitSteer?(sessionId: string, text: string, clientSteerId: string): Promise<CoworkSteerResponse>;
  runGoalCommand?(sessionId: string, command: string): Promise<CoworkGoal | null>;
  stopSession(sessionId: string): void;
  stopAllSessions(): void;
  respondToPermission(requestId: string, result: PermissionResult): void;
  isSessionActive(sessionId: string): boolean;
  getSessionConfirmationMode(sessionId: string): 'modal' | 'text' | null;
  deleteSubagentSession?(parentSessionId: string, runId: string): Promise<boolean>;
  onSessionDeleted?(sessionId: string): void;
}
