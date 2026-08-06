import { classifyErrorKey } from '../../common/coworkErrorClassify';
import {
  ContextCompactionMode,
  ContextCompactionStatus,
  CoworkSystemMessageKind,
} from '../../common/coworkSystemMessages';
import type { OpenClawSessionPatch } from '../../common/openclawSession';
import { AgentId } from '../../shared/agent';
import {
  COWORK_MESSAGE_PAGE_SIZE,
  COWORK_SESSION_PAGE_SIZE,
  type CoworkSessionsChangedPayload,
} from '../../shared/cowork/constants';
import { buildCoworkErrorDetail, type CoworkErrorDetail } from '../../shared/cowork/errorDetail';
import { normalizeCoworkGoal } from '../../shared/cowork/goal';
import type { CoworkMessageRailIndexItem } from '../../shared/cowork/rail';
import {
  CoworkSteerRejectReason,
  type CoworkSteerRequest,
  CoworkSteerStatus,
} from '../../shared/cowork/steer';
import { store } from '../store';
import { clearSessionArtifacts, setSessionArtifacts } from '../store/slices/artifactSlice';
import {
  addMessage,
  addPendingSteer,
  addSession,
  appendMessages,
  appendSessions,
  clearCurrentSession,
  clearPendingPermissions,
  deleteSession as deleteSessionAction,
  deleteSessions as deleteSessionsAction,
  dequeuePendingPermission,
  enqueuePendingPermission,
  finishSessionActivity,
  markCompactionNotified,
  prependMessages,
  setConfig,
  setContextCompacting,
  setContextMaintenance,
  setContextUsage,
  setCurrentSession,
  setCurrentSessionId,
  setHasMoreSessions,
  setMessageRailIndex,
  setMessageRailIndexLoading,
  setMessageWindow,
  setRemoteManaged,
  setSessions,
  setStreaming,
  setSubagentMessages,
  setSubagentMessagesLoading,
  setSubagentRuns,
  setSubagentRunsLoading,
  updateMessageContent,
  updateSessionGoal,
  updateSessionPinned,
  updateSessionStatus,
  updateSessionTitle,
  updateSteerStatus,
  updateSubagentRunStatus,
  upsertSessionSummary,
} from '../store/slices/coworkSlice';
import type { Artifact } from '../types/artifact';
import type {
  CoworkApiConfig,
  CoworkConfigUpdate,
  CoworkContextUsage,
  CoworkContinueOptions,
  CoworkForkSessionOptions,
  CoworkMemoryStats,
  CoworkMessage,
  CoworkPermissionResult,
  CoworkSession,
  CoworkSessionListResult,
  CoworkSessionStatus,
  CoworkStartOptions,
  CoworkUserMemoryEntry,
  OpenClawEngineStatus,
  OpenClawSessionPolicyConfig,
  SubagentSessionSummary,
} from '../types/cowork';
import { CoworkSessionStatusValue } from '../types/cowork';
import { loadDetectedFileArtifact } from './artifactDetection';
import { CoworkQueuedFollowUpCoordinator } from './coworkQueuedFollowUpCoordinator';
import {
  getPreservedMessageWindow,
  shouldReloadCurrentSessionForChange,
} from './coworkSessionRefreshPolicy';
import { i18nService } from './i18n';

const classifyError = (error: string): string => {
  const key = classifyErrorKey(error);
  return key ? i18nService.t(key) : error;
};

const classifyErrorWithDetail = (
  error: string,
  errorDetail?: CoworkErrorDetail,
): string => {
  const detailText = [
    errorDetail?.providerErrorMessagePreview,
    errorDetail?.rawErrorPreview,
    errorDetail?.rawErrorMessage,
    errorDetail?.httpCode,
    error,
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0).join('\n');
  return classifyError(detailText || error);
};

const isSameCoworkErrorMessage = (
  message: CoworkMessage | undefined,
  error: string,
  displayError: string,
): boolean => (
  message?.type === 'system'
  && (
    message.content === error
    || message.content === displayError
    || message.metadata?.error === error
    || message.metadata?.error === displayError
  )
);

const CONTEXT_USAGE_REFRESH_DELAY_MS = 800;
const FINAL_CONTEXT_USAGE_REFRESH_DELAYS_MS = [800, 2500, 6000, 12000] as const;
const SESSION_ENTRY_CONTEXT_USAGE_REFRESH_COOLDOWN_MS = 1500;
const MANUAL_CONTEXT_COMPACTION_WATCHDOG_MS = 310_000;

const resolveCurrentAgentId = (): string => {
  return store.getState().agent.currentAgentId?.trim() || AgentId.Main;
};

// Whether a freshly-loaded session is materially identical to the one already
// shown (e.g. the instant cache), so re-dispatching it would only cause a
// wasted re-render and pin-loop restart. Compares identity plus the cheap
// signals that change when messages are appended or edited.
const isSameLoadedSession = (
  shown: CoworkSession | null,
  loaded: CoworkSession,
): boolean => {
  if (!shown || shown.id !== loaded.id) return false;
  if (shown.status !== loaded.status || shown.updatedAt !== loaded.updatedAt) return false;
  if (shown.totalMessages !== loaded.totalMessages) return false;
  if (shown.messages.length !== loaded.messages.length) return false;
  return shown.messages[shown.messages.length - 1]?.id
    === loaded.messages[loaded.messages.length - 1]?.id;
};

class CoworkService {
  private streamListenerCleanups: Array<() => void> = [];
  private initialized = false;
  private openClawStatus: OpenClawEngineStatus | null = null;
  private openClawStatusListeners = new Set<(status: OpenClawEngineStatus) => void>();
  private openClawEngineListenerAttached = false;
  private latestLoadSessionsRequestId = 0;
  private latestLoadSessionRequestId = 0;
  private contextUsageRefreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private sessionEntryContextUsageRefreshAt = new Map<string, number>();
  private contextCompactionWatchdogs = new Map<string, ReturnType<typeof setTimeout>>();
  private subagentListRequests = new Map<string, Promise<SubagentSessionSummary[]>>();
  private subagentHistoryRequests = new Map<string, Promise<CoworkMessage[]>>();
  private artifactRefreshTimers = new Map<string, number>();
  private artifactLoadRequestIds = new Map<string, number>();
  private hydratedArtifactFiles = new Map<string, Artifact>();
  private readonly queuedFollowUpCoordinator = new CoworkQueuedFollowUpCoordinator({
    getState: store.getState,
    dispatch: store.dispatch,
    continueSession: (options) => this.continueSession(options),
    stopSession: (sessionId) => this.stopSessionRuntime(sessionId),
    log: (level, message, error) => this.logDiagnostic(level, message, error),
  });

  async init(): Promise<void> {
    if (this.initialized) return;

    // Load initial config
    await this.loadConfig();

    // Load sessions list
    await this.loadSessions();

    // Set up stream listeners
    this.setupStreamListeners();
    this.setupOpenClawEngineListeners();

    // Load OpenClaw status
    await this.loadOpenClawEngineStatus();

    this.initialized = true;
  }

  private async hydrateArtifactsForPreview(artifacts: Artifact[], cwd?: string): Promise<Artifact[]> {
    const hydrated: Artifact[] = [];
    for (const artifact of artifacts) {
      if (!artifact.filePath) {
        hydrated.push(artifact);
        continue;
      }

      const cached = this.hydratedArtifactFiles.get(artifact.id);
      if (cached) {
        hydrated.push({
          ...artifact,
          content: cached.content,
          filePath: cached.filePath,
          contentVersion: cached.contentVersion ?? artifact.contentVersion,
          preview: cached.preview,
        });
        continue;
      }

      const loaded = await loadDetectedFileArtifact(artifact, cwd);
      if (loaded) {
        this.hydratedArtifactFiles.set(artifact.id, loaded);
        hydrated.push(loaded);
      } else {
        hydrated.push(artifact);
      }
    }
    return hydrated;
  }

  private async loadSessionArtifacts(sessionId: string, options: { resyncIfEmpty?: boolean } = {}): Promise<void> {
    const cowork = window.electron?.cowork;
    if (!cowork?.listArtifacts) return;

    const requestId = (this.artifactLoadRequestIds.get(sessionId) ?? 0) + 1;
    this.artifactLoadRequestIds.set(sessionId, requestId);
    const session = store.getState().cowork.currentSession;
    let result = await cowork.listArtifacts(sessionId);
    if (
      options.resyncIfEmpty &&
      result?.success &&
      result.artifacts?.length === 0 &&
      cowork.resyncArtifacts
    ) {
      result = await cowork.resyncArtifacts(sessionId);
    }
    if (!result?.success || !result.artifacts) return;
    if (this.artifactLoadRequestIds.get(sessionId) !== requestId) return;

    const hydrated = await this.hydrateArtifactsForPreview(
      result.artifacts,
      session?.id === sessionId ? session.cwd : undefined,
    );
    if (this.artifactLoadRequestIds.get(sessionId) !== requestId) return;
    const existingArtifacts = store.getState().artifact.artifactsBySession[sessionId] ?? [];
    const manualArtifacts = existingArtifacts.filter(artifact =>
      artifact.source === 'manual' || artifact.messageId.startsWith('source-reference:')
    );
    store.dispatch(setSessionArtifacts({ sessionId, artifacts: [...hydrated, ...manualArtifacts] }));
  }

  private scheduleArtifactRefresh(sessionId: string, delayMs = 120): void {
    const existing = this.artifactRefreshTimers.get(sessionId);
    if (existing) {
      window.clearTimeout(existing);
    }

    const timer = window.setTimeout(() => {
      this.artifactRefreshTimers.delete(sessionId);
      void this.loadSessionArtifacts(sessionId);
    }, delayMs);
    this.artifactRefreshTimers.set(sessionId, timer);
  }

  private setupStreamListeners(): void {
    const cowork = window.electron?.cowork;
    if (!cowork) return;

    // Clean up any existing listeners
    this.cleanupListeners();

    // Message listener - also check if session exists (for IM-created sessions)
    const messageCleanup = cowork.onStreamMessage(async ({ sessionId, message, beforeMessageId }) => {
      // Debug: log user messages to check if imageAttachments are preserved
      if (message.type === 'user') {
        const meta = message.metadata as Record<string, unknown> | undefined;
        console.log('[CoworkService] onStreamMessage received user message', {
          sessionId,
          messageId: message.id,
          hasMetadata: !!meta,
          metadataKeys: meta ? Object.keys(meta) : [],
          hasImageAttachments: !!(meta?.imageAttachments),
          imageAttachmentsCount: Array.isArray(meta?.imageAttachments) ? (meta.imageAttachments as unknown[]).length : 0,
        });
      }
      // Check if session exists in current list
      const state = store.getState().cowork;
      const sessionExists = state.sessions.some(s => s.id === sessionId);

      console.log('[CoworkService] onStreamMessage: sessionId=', sessionId, 'type=', message.type, 'sessionExists=', sessionExists, 'totalSessions=', state.sessions.length);
      if (!sessionExists) {
        // Session was created by IM or another source, refresh the session list
        console.log('[CoworkService] onStreamMessage: session NOT found in Redux, calling loadSessions...');
        await this.loadSessions();
        const newState = store.getState().cowork;
        const nowExists = newState.sessions.some(s => s.id === sessionId);
        console.log('[CoworkService] onStreamMessage: after loadSessions, sessionExists=', nowExists, 'totalSessions=', newState.sessions.length);
      }

      // A new user turn means this session is actively running again
      // (especially important for IM-triggered turns that do not call continueSession from renderer).
      if (message.type === 'user' || message.type === 'assistant' || message.type === 'tool_use' || message.type === 'tool_result') {
        store.dispatch(updateSessionStatus({ sessionId, status: CoworkSessionStatusValue.Running }));
        this.queuedFollowUpCoordinator.handleSessionRunning(sessionId);
      }
      store.dispatch(addMessage({ sessionId, message, beforeMessageId }));
      this.scheduleArtifactRefresh(sessionId);
      this.scheduleContextUsageRefresh(sessionId, true);
    });
    this.streamListenerCleanups.push(messageCleanup);

    // Message update listener (for streaming content updates)
    const messageUpdateCleanup = cowork.onStreamMessageUpdate(({ sessionId, messageId, content, metadata }) => {
      const session = store.getState().cowork.sessions.find(s => s.id === sessionId);
      if (metadata?.isFinal !== true && session?.status !== 'completed') {
        store.dispatch(updateSessionStatus({ sessionId, status: CoworkSessionStatusValue.Running }));
        this.queuedFollowUpCoordinator.handleSessionRunning(sessionId);
      }
      store.dispatch(updateMessageContent({ sessionId, messageId, content, metadata }));
      if (metadata?.isFinal === true) {
        this.scheduleArtifactRefresh(sessionId, 0);
      }
    });
    this.streamListenerCleanups.push(messageUpdateCleanup);

    const sessionStatusCleanup = cowork.onStreamSessionStatus?.(({ sessionId, status }) => {
      void this.handleStreamSessionStatus(sessionId, status);
    });
    if (sessionStatusCleanup) {
      this.streamListenerCleanups.push(sessionStatusCleanup);
    }

    const contextUsageCleanup = cowork.onStreamContextUsage?.(({ usage }) => {
      if (usage) {
        this.handleContextUsageUpdate(usage, true);
      }
    });
    if (contextUsageCleanup) {
      this.streamListenerCleanups.push(contextUsageCleanup);
    }

    const goalCleanup = cowork.onStreamGoal?.(({ sessionId, goal }) => {
      store.dispatch(updateSessionGoal({ sessionId, goal: normalizeCoworkGoal(goal) }));
    });
    if (goalCleanup) {
      this.streamListenerCleanups.push(goalCleanup);
    }

    const contextMaintenanceCleanup = cowork.onStreamContextMaintenance?.(({ sessionId, active }) => {
      console.log(`[CoworkService] received context maintenance ${active ? 'start' : 'end'} for session ${sessionId}.`);
      store.dispatch(setContextMaintenance({ sessionId, active }));
    });
    if (contextMaintenanceCleanup) {
      this.streamListenerCleanups.push(contextMaintenanceCleanup);
    }

    const subagentMessagesChangedCleanup = cowork.onSubagentMessagesChanged?.((event) => {
      if (!event.parentSessionId || !event.runId) return;

      if (Array.isArray(event.messages)) {
        store.dispatch(setSubagentMessages({
          runId: event.runId,
          messages: event.messages,
        }));
      }

      if (event.status) {
        store.dispatch(updateSubagentRunStatus({
          parentSessionId: event.parentSessionId,
          runId: event.runId,
          sessionKey: event.sessionKey,
          status: event.status,
          endedAt: event.status === 'running' ? null : Date.now(),
        }));
      }

      const runs = store.getState().cowork.subagentRunsByParentSessionId[event.parentSessionId] ?? [];
      const hasRun = runs.some(run => run.id === event.runId || (!!event.sessionKey && run.sessionKey === event.sessionKey));
      if (!hasRun || event.status === 'done' || event.status === 'error') {
        void this.loadSubagents(event.parentSessionId, { showLoading: false, force: true });
      }
    });
    if (subagentMessagesChangedCleanup) {
      this.streamListenerCleanups.push(subagentMessagesChangedCleanup);
    }

    // Permission request listener
    const permissionCleanup = cowork.onStreamPermission(({ sessionId, request }) => {
      store.dispatch(enqueuePendingPermission({
        sessionId,
        toolName: request.toolName,
        toolInput: request.toolInput,
        requestId: request.requestId,
        toolUseId: request.toolUseId ?? null,
      }));
    });
    this.streamListenerCleanups.push(permissionCleanup);

    // Permission dismiss listener (timeout or server-side resolution)
    const permissionDismissCleanup = cowork.onStreamPermissionDismiss(({ requestId }) => {
      store.dispatch(dequeuePendingPermission({ requestId }));
    });
    this.streamListenerCleanups.push(permissionDismissCleanup);

    // Complete listener
    const completeCleanup = cowork.onStreamComplete(({ sessionId }) => {
      const before = store.getState().cowork;
      console.log('[CoworkService] received stream complete.', {
        sessionId,
        currentSessionId: before.currentSession?.id ?? null,
        wasStreaming: before.isStreaming,
        hadContextMaintenance: before.contextMaintenanceSessionIds.includes(sessionId),
        hadContextCompaction: before.compactingSessionIds.includes(sessionId),
      });
      store.dispatch(updateSessionStatus({ sessionId, status: 'completed' }));
      store.dispatch(finishSessionActivity({ sessionId }));
      this.scheduleFinalContextUsageRefresh(sessionId, true);
      this.queuedFollowUpCoordinator.handleSessionCompleted(sessionId);
    });
    this.streamListenerCleanups.push(completeCleanup);

    // Error listener
    const errorCleanup = cowork.onStreamError(({ sessionId, error, errorDetail }) => {
      if (this.isStillRunningError(error)) {
        store.dispatch(updateSessionStatus({ sessionId, status: CoworkSessionStatusValue.Running }));
        window.dispatchEvent(new CustomEvent('app:showToast', {
          detail: i18nService.t('coworkSessionStillRunning'),
        }));
        return;
      }
      store.dispatch(updateSessionStatus({ sessionId, status: CoworkSessionStatusValue.Error }));
      store.dispatch(finishSessionActivity({ sessionId }));
      this.queuedFollowUpCoordinator.handleSessionError(sessionId);
      // Surface the error as a visible message so the user knows what happened.
      if (error) {
        const displayError = classifyErrorWithDetail(error, errorDetail);
        const existingMessages = store.getState().cowork.currentSession?.id === sessionId
          ? store.getState().cowork.currentSession?.messages ?? []
          : [];
        const latestMessage = existingMessages[existingMessages.length - 1];
        if (isSameCoworkErrorMessage(latestMessage, error, displayError)) return;
        const normalizedErrorDetail = buildCoworkErrorDetail({
          rawErrorMessage: error,
          displayMessage: displayError,
          metadata: errorDetail,
        });
        store.dispatch(addMessage({
          sessionId,
          message: {
            id: `error-${Date.now()}`,
            type: 'system',
            content: displayError,
            metadata: {
              error: displayError,
              ...(normalizedErrorDetail ? { errorDetail: normalizedErrorDetail } : {}),
            },
            timestamp: Date.now(),
          },
        }));
      }
    });
    this.streamListenerCleanups.push(errorCleanup);

    // Sessions changed listener (new channel sessions discovered by polling,
    // or reconcileWithHistory replaced messages for a channel session)
    const sessionsChangedCleanup = cowork.onSessionsChanged((event) => {
      const beforeState = store.getState().cowork;
      console.log('[CoworkService] onSessionsChanged: received IPC event, before sessions:', beforeState.sessions.length, 'changedSessionIds:', event?.sessionIds?.slice(0, 5) ?? []);
      void this.handleSessionsChanged(event).catch((err) => {
        console.error('[CoworkService] onSessionsChanged: refresh failed:', err);
      });
    });
    this.streamListenerCleanups.push(sessionsChangedCleanup);
  }

  private async handleSessionsChanged(payload?: CoworkSessionsChangedPayload): Promise<void> {
    const sessionIds = Array.isArray(payload?.sessionIds) ? payload.sessionIds : [];
    if (sessionIds.length > 0) {
      await Promise.all(sessionIds.map((sessionId) => this.loadSessionSummaryForChangedSession(sessionId)));
    } else {
      await this.loadSessions();
    }

    const state = store.getState().cowork;
    console.log('[CoworkService] onSessionsChanged: refresh complete, total sessions:', state.sessions.length, 'sessionIds:', state.sessions.map(s => s.id).slice(0, 5));

    // Reload the active session's full message list so that messages
    // replaced by reconcileWithHistory (bulk SQLite replace) are reflected
    // in the conversation view, not just the sidebar.  Without this,
    // user messages synced from gateway history would only appear after
    // the user manually re-enters the conversation.
    const currentId = state.currentSessionId;
    if (currentId && shouldReloadCurrentSessionForChange(currentId, payload)) {
      void this.loadSession(currentId, { preserveLoadedRange: true });
      void this.loadSessionMessageRailIndex(currentId);
    }
  }

  private async handleStreamSessionStatus(
    sessionId: string,
    status: CoworkSessionStatus,
  ): Promise<void> {
    const state = store.getState().cowork;
    const sessionExists = state.sessions.some((session) => session.id === sessionId)
      || state.currentSession?.id === sessionId;
    if (!sessionExists) {
      await this.loadSessionSummaryForChangedSession(sessionId);
    }

    store.dispatch(updateSessionStatus({ sessionId, status }));
    this.setCurrentSessionStreaming(
      sessionId,
      status === CoworkSessionStatusValue.Running,
    );
    if (status === CoworkSessionStatusValue.Running) {
      this.queuedFollowUpCoordinator.handleSessionRunning(sessionId);
    } else if (status === CoworkSessionStatusValue.Completed) {
      store.dispatch(finishSessionActivity({ sessionId }));
      this.queuedFollowUpCoordinator.handleSessionCompleted(sessionId);
    } else if (status === CoworkSessionStatusValue.Error) {
      store.dispatch(finishSessionActivity({ sessionId }));
      this.queuedFollowUpCoordinator.handleSessionError(sessionId);
    } else {
      store.dispatch(finishSessionActivity({ sessionId }));
      this.queuedFollowUpCoordinator.handleSessionIdle(sessionId);
    }
  }

  private async loadSessionSummaryForChangedSession(sessionId?: string): Promise<void> {
    if (!sessionId) {
      return;
    }

    const cowork = window.electron?.cowork;
    if (!cowork?.getSession) {
      return;
    }

    const result = await cowork.getSession(sessionId);
    if (!result?.success || !result.session) {
      return;
    }

    if (store.getState().cowork.currentSessionId === sessionId) {
      store.dispatch(setCurrentSession(result.session));
    }
    store.dispatch(upsertSessionSummary(result.session));
  }

  private setCurrentSessionStreaming(sessionId: string, isStreaming: boolean): void {
    const currentSessionId = store.getState().cowork.currentSessionId;
    if (currentSessionId !== sessionId) return;
    store.dispatch(setStreaming(isStreaming));
  }

  private isStillRunningError(error: string): boolean {
    return /session .* is still running/i.test(error);
  }

  private scheduleContextUsageRefresh(
    sessionId: string,
    notifyCompaction: boolean,
    delayMs = CONTEXT_USAGE_REFRESH_DELAY_MS,
  ): void {
    const timerKey = `${sessionId}:${delayMs}`;
    const existing = this.contextUsageRefreshTimers.get(timerKey);
    if (existing) {
      clearTimeout(existing);
    }
    const timer = setTimeout(() => {
      this.contextUsageRefreshTimers.delete(timerKey);
      void this.refreshContextUsage(sessionId, { notifyCompaction });
    }, delayMs);
    this.contextUsageRefreshTimers.set(timerKey, timer);
  }

  private scheduleFinalContextUsageRefresh(sessionId: string, notifyCompaction: boolean): void {
    for (const delayMs of FINAL_CONTEXT_USAGE_REFRESH_DELAYS_MS) {
      this.scheduleContextUsageRefresh(sessionId, notifyCompaction, delayMs);
    }
  }

  private handleContextUsageUpdate(usage: CoworkContextUsage, notifyCompaction: boolean): void {
    const state = store.getState().cowork;
    const previous = state.contextUsageBySessionId[usage.sessionId];
    store.dispatch(setContextUsage(usage));

    const nextCount = usage.compactionCount;
    const previousCount = previous?.compactionCount;
    const alreadyNotified = state.notifiedCompactionBySessionId[usage.sessionId] ?? 0;
    if (
      notifyCompaction &&
      typeof nextCount === 'number' &&
      nextCount > 0 &&
      typeof previousCount === 'number' &&
      nextCount > previousCount &&
      nextCount > alreadyNotified
    ) {
      store.dispatch(markCompactionNotified({
        sessionId: usage.sessionId,
        compactionCount: nextCount,
      }));
    }
  }

  async refreshContextUsage(sessionId: string, options: { notifyCompaction?: boolean } = {}): Promise<CoworkContextUsage | null> {
    const cowork = window.electron?.cowork;
    if (!cowork?.getContextUsage) return null;

    try {
      const result = await cowork.getContextUsage(sessionId);
      if (result?.success && result.usage) {
        this.handleContextUsageUpdate(result.usage, options.notifyCompaction === true);
        return result.usage;
      }
    } catch (error) {
      console.warn('[CoworkService] context usage refresh failed:', error);
    }
    return null;
  }

  refreshContextUsageForSessionEntry(sessionId: string): void {
    if (!sessionId) return;

    const now = Date.now();
    const lastRefreshAt = this.sessionEntryContextUsageRefreshAt.get(sessionId) ?? 0;
    if (now - lastRefreshAt < SESSION_ENTRY_CONTEXT_USAGE_REFRESH_COOLDOWN_MS) {
      return;
    }

    this.sessionEntryContextUsageRefreshAt.set(sessionId, now);
    void this.refreshContextUsage(sessionId, { notifyCompaction: false });
  }

  async compactContext(sessionId: string): Promise<boolean> {
    const cowork = window.electron?.cowork;
    if (!cowork?.compactContext) {
      console.warn('[CoworkService] manual context compaction is unavailable.');
      return false;
    }

    console.log(`[CoworkService] manual context compaction started for session ${sessionId}.`);
    store.dispatch(setContextCompacting({ sessionId, compacting: true }));
    this.clearContextCompactionWatchdog(sessionId);
    this.contextCompactionWatchdogs.set(sessionId, setTimeout(() => {
      console.warn(`[CoworkService] manual context compaction watchdog cleared stale state for session ${sessionId}.`);
      store.dispatch(setContextCompacting({ sessionId, compacting: false }));
      this.contextCompactionWatchdogs.delete(sessionId);
    }, MANUAL_CONTEXT_COMPACTION_WATCHDOG_MS));
    try {
      const result = await cowork.compactContext(sessionId);
      if (result.success) {
        console.log(`[CoworkService] manual context compaction completed for session ${sessionId}, compacted=${result.compacted === true}.`);
        if (result.usage) {
          this.handleContextUsageUpdate(result.usage, false);
        } else {
          await this.refreshContextUsage(sessionId);
        }
        store.dispatch(addMessage({
          sessionId,
          message: {
            id: `context-compaction-manual-${sessionId}-${Date.now()}`,
            type: 'system',
            content: result.compacted
              ? i18nService.t('coworkContextManualCompacted')
              : i18nService.t('coworkContextManualCompactNoop'),
            timestamp: Date.now(),
            metadata: {
              kind: CoworkSystemMessageKind.ContextCompaction,
              mode: ContextCompactionMode.Manual,
              status: result.compacted
                ? ContextCompactionStatus.Completed
                : ContextCompactionStatus.Failed,
              compacted: result.compacted === true,
            },
          },
        }));
        return true;
      }
      console.warn(`[CoworkService] manual context compaction failed for session ${sessionId}: ${result.error ?? 'Unknown error'}`);
      if (result.error) {
        window.dispatchEvent(new CustomEvent('app:showToast', {
          detail: result.error,
        }));
      }
      return false;
    } catch (error) {
      console.warn(`[CoworkService] manual context compaction failed for session ${sessionId}:`, error);
      window.dispatchEvent(new CustomEvent('app:showToast', {
        detail: error instanceof Error ? error.message : 'Failed to compact context',
      }));
      return false;
    } finally {
      this.clearContextCompactionWatchdog(sessionId);
      store.dispatch(setContextCompacting({ sessionId, compacting: false }));
    }
  }

  private clearContextCompactionWatchdog(sessionId: string): void {
    const timer = this.contextCompactionWatchdogs.get(sessionId);
    if (!timer) return;
    clearTimeout(timer);
    this.contextCompactionWatchdogs.delete(sessionId);
  }

  private setupOpenClawEngineListeners(): void {
    if (this.openClawEngineListenerAttached) return;
    const engineApi = window.electron?.openclaw?.engine;
    if (!engineApi?.onProgress) return;

    const statusCleanup = engineApi.onProgress((status) => {
      this.notifyOpenClawStatus(status);
    });
    this.streamListenerCleanups.push(statusCleanup);
    this.openClawEngineListenerAttached = true;
  }

  private notifyOpenClawStatus(status: OpenClawEngineStatus): void {
    this.openClawStatus = status;
    this.openClawStatusListeners.forEach((listener) => {
      listener(status);
    });
  }

  private cleanupListeners(): void {
    this.streamListenerCleanups.forEach(cleanup => cleanup());
    this.streamListenerCleanups = [];
    this.openClawEngineListenerAttached = false;
    this.contextUsageRefreshTimers.forEach(timer => clearTimeout(timer));
    this.contextUsageRefreshTimers.clear();
  }

  private logDiagnostic(level: 'debug' | 'warn' | 'error', message: string, error?: unknown): void {
    const formatted = `[CoworkService] ${message}`;
    if (level === 'error') {
      console.error(formatted, error);
      return;
    }
    if (level === 'warn') {
      console.warn(formatted, error);
      return;
    }
    console.debug(formatted, error);
  }

  async loadSessions(agentId?: string): Promise<void> {
    const requestId = ++this.latestLoadSessionsRequestId;
    const resolvedAgentId = agentId?.trim() || resolveCurrentAgentId();
    const result = await window.electron?.cowork?.listSessions({ limit: COWORK_SESSION_PAGE_SIZE, offset: 0, agentId: resolvedAgentId });
    if (result?.success && result.sessions) {
      // High-frequency IM traffic can trigger overlapping list refreshes.
      // Ignore stale responses so an older snapshot does not hide newer sessions.
      if (requestId !== this.latestLoadSessionsRequestId) {
        return;
      }
      store.dispatch(setSessions(result.sessions));
      store.dispatch(setHasMoreSessions(result.hasMore ?? false));
    }
  }

  async listSessionsForAgentPreview(
    agentId: string,
    limit: number,
    offset: number,
  ): Promise<CoworkSessionListResult> {
    const result = await window.electron?.cowork?.listSessions({ limit, offset, agentId });
    return result ?? { success: false, error: 'Cowork IPC is unavailable' };
  }

  async listAgentSidebarSessions() {
    const result = await window.electron?.cowork?.listAgentSidebarSessions();
    return result ?? { success: false, error: 'Cowork IPC is unavailable' };
  }

  async listArtifactResources() {
    const result = await window.electron?.cowork?.listArtifactResources();
    return result ?? { success: false, error: 'Cowork IPC is unavailable' };
  }

  async listSessionsForSearch(
    limit: number,
    offset: number,
    query?: string,
  ): Promise<CoworkSessionListResult> {
    const trimmedQuery = query?.trim();
    const result = await window.electron?.cowork?.listSessions({
      limit,
      offset,
      ...(trimmedQuery ? { searchQuery: trimmedQuery } : {}),
    });
    return result ?? { success: false, error: 'Cowork IPC is unavailable' };
  }

  async loadMoreSessions(): Promise<boolean> {
    const state = store.getState().cowork;
    if (!state.hasMoreSessions) return false;

    const offset = state.sessions.length;
    const result = await window.electron?.cowork?.listSessions({ limit: COWORK_SESSION_PAGE_SIZE, offset, agentId: resolveCurrentAgentId() });
    if (result?.success && result.sessions) {
      store.dispatch(appendSessions({ sessions: result.sessions, hasMore: result.hasMore ?? false }));
      return true;
    }
    return false;
  }

  async loadConfig(): Promise<void> {
    const [coworkResult, sessionPolicyResult] = await Promise.all([
      window.electron?.cowork?.getConfig(),
      window.electron?.openclaw?.sessionPolicy?.get?.(),
    ]);

    if (coworkResult?.success && coworkResult.config) {
      const cfg = coworkResult.config as unknown as Record<string, unknown>;
      store.dispatch(setConfig({
        ...coworkResult.config,
        dreamingEnabled: (cfg.dreamingEnabled as boolean) ?? false,
        dreamingFrequency: (cfg.dreamingFrequency as string) ?? '0 3 * * *',
        dreamingModel: (cfg.dreamingModel as string) ?? '',
        dreamingTimezone: (cfg.dreamingTimezone as string) ?? '',
        openClawSessionPolicy: sessionPolicyResult?.success && sessionPolicyResult.config
          ? sessionPolicyResult.config
          : { keepAlive: '30d' },
      }));
    }
  }

  async loadOpenClawEngineStatus(): Promise<OpenClawEngineStatus | null> {
    this.setupOpenClawEngineListeners();
    const engineApi = window.electron?.openclaw?.engine;
    if (!engineApi?.getStatus) {
      return null;
    }
    const result = await engineApi.getStatus();
    if (result?.success && result.status) {
      this.notifyOpenClawStatus(result.status);
      return result.status;
    }
    return this.openClawStatus;
  }

  async startSession(options: CoworkStartOptions): Promise<{ session: CoworkSession | null; error?: string }> {
    const cowork = window.electron?.cowork;
    if (!cowork) {
      console.error('Cowork API not available');
      return { session: null, error: 'Cowork API not available' };
    }

    store.dispatch(setStreaming(true));

    const result = await cowork.startSession(options);
    if (result.success && result.session) {
      store.dispatch(addSession(result.session));
      if (result.session.status !== 'running') {
        store.dispatch(setStreaming(false));
      }
      return { session: result.session };
    }

    if (result.engineStatus) {
      this.notifyOpenClawStatus(result.engineStatus);
    }

    // Show a user-visible error when session start fails
    if (result.error) {
      const errorContent = result.code === 'ENGINE_NOT_READY'
        ? i18nService.t('coworkErrorEngineNotReady')
        : classifyError(result.error);
      window.dispatchEvent(new CustomEvent('app:showToast', { detail: errorContent }));
    }

    store.dispatch(setStreaming(false));
    console.error('Failed to start session:', result.error);
    return { session: null, error: result.error };
  }

  async continueSession(options: CoworkContinueOptions): Promise<boolean> {
    const cowork = window.electron?.cowork;
    if (!cowork) {
      console.error('Cowork API not available');
      return false;
    }

    const state = store.getState().cowork;
    if (state.compactingSessionIds.includes(options.sessionId)) {
      console.debug(`[CoworkService] continue was ignored because manual context compaction is running for session ${options.sessionId}.`);
      window.dispatchEvent(new CustomEvent('app:showToast', {
        detail: i18nService.t('coworkContextCompactingSendBlocked'),
      }));
      return false;
    }

    store.dispatch(setStreaming(true));
    store.dispatch(updateSessionStatus({ sessionId: options.sessionId, status: CoworkSessionStatusValue.Running }));

    const result = await cowork.continueSession({
      sessionId: options.sessionId,
      prompt: options.prompt,
      knowledgeBases: options.knowledgeBases,
      knowledgeFiles: options.knowledgeFiles,
      selectedTextSnippets: options.selectedTextSnippets,
      browserAnnotations: options.browserAnnotations,
      promptDocument: options.promptDocument,
      systemPrompt: options.systemPrompt,
      turnInstructions: options.turnInstructions,
      activeSkillIds: options.activeSkillIds,
      imageAttachments: options.imageAttachments,
    });
    if (!result.success) {
      store.dispatch(setStreaming(false));
      if (result.engineStatus) {
        this.notifyOpenClawStatus(result.engineStatus);
      }
      if (result.error) {
        const errorContent = result.code === 'ENGINE_NOT_READY'
          ? i18nService.t('coworkErrorEngineNotReady')
          : classifyError(result.error);
        store.dispatch(updateSessionStatus({
          sessionId: options.sessionId,
          status: result.code === 'ENGINE_NOT_READY'
            ? CoworkSessionStatusValue.Idle
            : CoworkSessionStatusValue.Error,
        }));
        store.dispatch(addMessage({
          sessionId: options.sessionId,
          message: {
            id: `error-${Date.now()}`,
            type: 'system',
            content: errorContent,
            timestamp: Date.now(),
          },
        }));
      }
      console.error('Failed to continue session:', result.error);
      return false;
    }

    return true;
  }

  async forkSession(options: CoworkForkSessionOptions): Promise<CoworkSession | null> {
    const cowork = window.electron?.cowork;
    if (!cowork?.forkSession) {
      console.error('Cowork fork API not available');
      return null;
    }

    const result = await cowork.forkSession(options);
    if (result.success && result.session) {
      store.dispatch(addSession(result.session));
      store.dispatch(setCurrentSession(result.session));
      store.dispatch(setCurrentSessionId(result.session.id));
      store.dispatch(setStreaming(false));
      void this.loadSessionArtifacts(result.session.id, { resyncIfEmpty: true });
      void this.loadSessionMessageRailIndex(result.session.id);
      void this.refreshContextUsageForSessionEntry(result.session.id);
      window.dispatchEvent(new CustomEvent('app:showToast', {
        detail: i18nService.t('coworkForkCreated'),
      }));
      return result.session;
    }

    const error = result.error || i18nService.t('coworkForkFailed');
    window.dispatchEvent(new CustomEvent('app:showToast', {
      detail: error,
    }));
    console.error('Failed to fork session:', result.error);
    return null;
  }

  async submitSteer(options: CoworkSteerRequest): Promise<boolean> {
    const cowork = window.electron?.cowork;
    if (!cowork?.submitSteer) {
      window.dispatchEvent(new CustomEvent('app:showToast', {
        detail: i18nService.t('coworkSteerUnavailable'),
      }));
      return false;
    }

    const text = options.text.trim();
    if (!text) return false;

    const now = Date.now();
    const existingSteer = store.getState().cowork.pendingSteers[options.sessionId]
      ?.some(steer => steer.id === options.clientSteerId);
    if (!existingSteer) {
      store.dispatch(addPendingSteer({
        id: options.clientSteerId,
        sessionId: options.sessionId,
        text,
        status: CoworkSteerStatus.Pending,
        createdAt: now,
        updatedAt: now,
      }));
    }

    try {
      const result = await cowork.submitSteer({
        ...options,
        text,
      });
      if (result?.success && result.status === CoworkSteerStatus.Accepted) {
        store.dispatch(updateSteerStatus({
          sessionId: options.sessionId,
          steerId: options.clientSteerId,
          status: CoworkSteerStatus.Accepted,
        }));
        return true;
      }

      const reason = result?.reason ?? CoworkSteerRejectReason.Unknown;
      const keepQueued = reason === CoworkSteerRejectReason.RuntimeUnsupported
        || reason === CoworkSteerRejectReason.NoActiveTurn
        || reason === CoworkSteerRejectReason.NotStreaming;
      if (keepQueued) {
        return true;
      }

      const error = result?.error || i18nService.t('coworkSteerRejected');
      store.dispatch(updateSteerStatus({
        sessionId: options.sessionId,
        steerId: options.clientSteerId,
        status: CoworkSteerStatus.Rejected,
        error,
        reason,
      }));
      window.dispatchEvent(new CustomEvent('app:showToast', { detail: error }));
      return false;
    } catch (error) {
      const message = error instanceof Error ? error.message : i18nService.t('coworkSteerRejected');
      store.dispatch(updateSteerStatus({
        sessionId: options.sessionId,
        steerId: options.clientSteerId,
        status: CoworkSteerStatus.Rejected,
        error: message,
        reason: CoworkSteerRejectReason.Unknown,
      }));
      window.dispatchEvent(new CustomEvent('app:showToast', { detail: message }));
      return false;
    }
  }

  async submitQueuedFollowUp(sessionId: string, steerId: string): Promise<boolean> {
    return this.queuedFollowUpCoordinator.submitSelected(sessionId, steerId);
  }

  async runGoalCommand(sessionId: string, command: string): Promise<boolean> {
    const cowork = window.electron?.cowork;
    if (!cowork?.runGoalCommand) {
      window.dispatchEvent(new CustomEvent('app:showToast', {
        detail: i18nService.t('coworkGoalUnavailable'),
      }));
      return false;
    }

    const normalizedSessionId = sessionId.trim();
    const normalizedCommand = command.trim();
    if (!normalizedSessionId || !normalizedCommand) return false;

    const action = normalizedCommand.split(/\s+/, 2)[1]?.toLowerCase() ?? 'status';
    const mayStartRun = action === 'start'
      || action === 'create'
      || action === 'set'
      || action === 'resume';
    const stateBeforeGoalCommand = store.getState();
    const currentSessionBeforeGoalCommand = stateBeforeGoalCommand.cowork.currentSession?.id === normalizedSessionId
      ? stateBeforeGoalCommand.cowork.currentSession
      : undefined;
    const listedSessionBeforeGoalCommand = stateBeforeGoalCommand.cowork.sessions.find(
      session => session.id === normalizedSessionId,
    );
    const previousStatus = currentSessionBeforeGoalCommand?.status ?? listedSessionBeforeGoalCommand?.status;
    const restoreGoalCommandStatus = () => {
      if (!mayStartRun) return;
      this.setCurrentSessionStreaming(normalizedSessionId, false);
      if (previousStatus && previousStatus !== CoworkSessionStatusValue.Running) {
        store.dispatch(updateSessionStatus({
          sessionId: normalizedSessionId,
          status: previousStatus,
        }));
      }
    };

    try {
      if (mayStartRun) {
        this.setCurrentSessionStreaming(normalizedSessionId, true);
        store.dispatch(updateSessionStatus({
          sessionId: normalizedSessionId,
          status: CoworkSessionStatusValue.Running,
        }));
      }

      const result = await cowork.runGoalCommand({
        sessionId: normalizedSessionId,
        command: normalizedCommand,
      });
      if (result?.success) {
        store.dispatch(updateSessionGoal({
          sessionId: normalizedSessionId,
          goal: normalizeCoworkGoal(result.goal),
        }));
        return true;
      }

      restoreGoalCommandStatus();
      const error = result?.error || i18nService.t('coworkGoalCommandFailed');
      window.dispatchEvent(new CustomEvent('app:showToast', { detail: error }));
      return false;
    } catch (error) {
      restoreGoalCommandStatus();
      console.warn(`[CoworkGoal] failed to run goal command for session ${normalizedSessionId}.`, error);
      window.dispatchEvent(new CustomEvent('app:showToast', {
        detail: error instanceof Error ? error.message : i18nService.t('coworkGoalCommandFailed'),
      }));
      return false;
    }
  }

  async interruptForQueuedFollowUp(sessionId: string, steerId: string): Promise<boolean> {
    return this.queuedFollowUpCoordinator.interruptAndSubmit(sessionId, steerId);
  }

  async stopSession(sessionId: string): Promise<boolean> {
    return this.stopSessionRuntime(sessionId);
  }

  private async stopSessionRuntime(sessionId: string): Promise<boolean> {
    const cowork = window.electron?.cowork;
    if (!cowork) return false;

    const result = await cowork.stopSession(sessionId);
    if (result.success) {
      store.dispatch(setStreaming(false));
      store.dispatch(finishSessionActivity({ sessionId }));
      store.dispatch(updateSessionStatus({ sessionId, status: CoworkSessionStatusValue.Idle }));
      this.queuedFollowUpCoordinator.handleSessionIdle(sessionId);
      return true;
    }

    console.error('Failed to stop session:', result.error);
    return false;
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    const cowork = window.electron?.cowork;
    if (!cowork) return false;

    const result = await cowork.deleteSession(sessionId);
    if (result.success) {
      this.queuedFollowUpCoordinator.clearSession(sessionId);
      this.hydratedArtifactFiles.forEach((artifact, artifactId) => {
        if (artifact.sessionId === sessionId) {
          this.hydratedArtifactFiles.delete(artifactId);
        }
      });
      this.artifactLoadRequestIds.delete(sessionId);
      store.dispatch(deleteSessionAction(sessionId));
      store.dispatch(clearSessionArtifacts(sessionId));
      return true;
    }

    console.error('Failed to delete session:', result.error);
    return false;
  }

  async deleteSessions(sessionIds: string[]): Promise<boolean> {
    const cowork = window.electron?.cowork;
    if (!cowork) return false;

    const result = await cowork.deleteSessions(sessionIds);
    if (result.success) {
      sessionIds.forEach(sessionId => this.queuedFollowUpCoordinator.clearSession(sessionId));
      sessionIds.forEach(sessionId => {
        this.hydratedArtifactFiles.forEach((artifact, artifactId) => {
          if (artifact.sessionId === sessionId) {
            this.hydratedArtifactFiles.delete(artifactId);
          }
        });
        this.artifactLoadRequestIds.delete(sessionId);
      });
      store.dispatch(deleteSessionsAction(sessionIds));
      sessionIds.forEach(sessionId => store.dispatch(clearSessionArtifacts(sessionId)));
      return true;
    }

    console.error('Failed to batch delete sessions:', result.error);
    return false;
  }

  async setSessionPinned(sessionId: string, pinned: boolean): Promise<{ success: boolean; pinOrder: number | null }> {
    const cowork = window.electron?.cowork;
    if (!cowork?.setSessionPinned) return { success: false, pinOrder: null };

    const result = await cowork.setSessionPinned({ sessionId, pinned });
    if (result.success) {
      const pinOrder = result.pinOrder ?? null;
      store.dispatch(updateSessionPinned({ sessionId, pinned, pinOrder }));
      return { success: true, pinOrder };
    }

    console.error('Failed to update session pin:', result.error);
    return { success: false, pinOrder: null };
  }

  async renameSession(sessionId: string, title: string): Promise<boolean> {
    const cowork = window.electron?.cowork;
    if (!cowork?.renameSession) return false;

    const normalizedTitle = title.trim();
    if (!normalizedTitle) return false;

    const result = await cowork.renameSession({ sessionId, title: normalizedTitle });
    if (result.success) {
      store.dispatch(updateSessionTitle({ sessionId, title: normalizedTitle }));
      return true;
    }

    console.error('Failed to rename session:', result.error);
    return false;
  }

  async exportSessionResultImage(options: {
    rect: { x: number; y: number; width: number; height: number };
    defaultFileName?: string;
  }): Promise<{ success: boolean; canceled?: boolean; path?: string; error?: string }> {
    const cowork = window.electron?.cowork;
    if (!cowork?.exportResultImage) {
      return { success: false, error: 'Cowork export API not available' };
    }

    try {
      const result = await cowork.exportResultImage(options);
      return result ?? { success: false, error: 'Failed to export session image' };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to export session image',
      };
    }
  }

  async captureSessionImageChunk(options: {
    rect: { x: number; y: number; width: number; height: number };
  }): Promise<{ success: boolean; width?: number; height?: number; pngBase64?: string; error?: string }> {
    const cowork = window.electron?.cowork;
    if (!cowork?.captureImageChunk) {
      return { success: false, error: 'Cowork capture API not available' };
    }

    try {
      const result = await cowork.captureImageChunk(options);
      return result ?? { success: false, error: 'Failed to capture session image chunk' };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to capture session image chunk',
      };
    }
  }

  async saveSessionResultImage(options: {
    pngBase64: string;
    defaultFileName?: string;
  }): Promise<{ success: boolean; canceled?: boolean; path?: string; error?: string }> {
    const cowork = window.electron?.cowork;
    if (!cowork?.saveResultImage) {
      return { success: false, error: 'Cowork save image API not available' };
    }

    try {
      const result = await cowork.saveResultImage(options);
      return result ?? { success: false, error: 'Failed to save session image' };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to save session image',
      };
    }
  }

  async loadSession(
    sessionId: string,
    options: { preserveLoadedRange?: boolean } = {},
  ): Promise<CoworkSession | null> {
    const cowork = window.electron?.cowork;
    if (!cowork) return null;
    const requestId = ++this.latestLoadSessionRequestId;
    const previouslyLoadedSession = store.getState().cowork.currentSession;

    // Instant switch: on revisit render the cached full session immediately; for
    // a first visit at least switch the selection so the sidebar highlights the
    // clicked session. Either way the fresh session from getSession is applied
    // below once the IPC resolves.
    const coworkState = store.getState().cowork;
    if (coworkState.currentSessionId !== sessionId) {
      const cached = coworkState.sessionCacheById[sessionId];
      if (cached) {
        store.dispatch(setCurrentSession(cached));
        store.dispatch(setStreaming(cached.status === 'running'));
      } else {
        store.dispatch(setCurrentSessionId(sessionId));
      }
    }

    const result = await cowork.getSession(sessionId);
    if (result.success && result.session) {
      // Keep only the latest session load result to avoid stale async overwrites.
      if (requestId !== this.latestLoadSessionRequestId) {
        return result.session;
      }
      let session = result.session;
      if (
        options.preserveLoadedRange
        && previouslyLoadedSession?.id === sessionId
        && cowork.getSessionMessages
      ) {
        const preservedWindow = getPreservedMessageWindow(
          previouslyLoadedSession.messagesOffset,
          session.messagesOffset,
          session.totalMessages,
        );
        if (preservedWindow) {
          let pageResult;
          try {
            pageResult = await cowork.getSessionMessages({
              sessionId,
              ...preservedWindow,
            });
          } catch (error) {
            console.warn(`[CoworkService] failed to preserve loaded history for session ${sessionId}:`, error);
            return previouslyLoadedSession;
          }
          if (requestId !== this.latestLoadSessionRequestId) {
            return session;
          }
          if (pageResult.success && pageResult.messages && pageResult.messages.length > 0) {
            const returnedOffset = pageResult.offset ?? preservedWindow.offset;
            const returnedEnd = returnedOffset + pageResult.messages.length;
            const latestLoadedSession = store.getState().cowork.currentSession;
            const latestLoadedEnd = latestLoadedSession
              ? latestLoadedSession.messagesOffset + latestLoadedSession.messages.length
              : 0;
            if (
              latestLoadedSession?.id === sessionId
              && (
                latestLoadedSession.messagesOffset < returnedOffset
                || latestLoadedEnd > returnedEnd
              )
            ) {
              return latestLoadedSession;
            }
            session = {
              ...session,
              messages: pageResult.messages,
              messagesOffset: returnedOffset,
              totalMessages: pageResult.total ?? session.totalMessages,
            };
          } else {
            console.warn(`[CoworkService] failed to preserve loaded history for session ${sessionId}: ${pageResult.error ?? 'empty result'}`);
            return previouslyLoadedSession;
          }
        }
      }
      // When the instant cache already rendered this exact session, skip the
      // refresh dispatch if nothing changed. A redundant setCurrentSession would
      // re-render the detail view and re-trigger its initial bottom-pin loop,
      // causing visible jitter and yanking the viewport back to the bottom even
      // after the user started scrolling.
      const shown = store.getState().cowork.currentSession;
      if (!isSameLoadedSession(shown, session)) {
        store.dispatch(setCurrentSession(session));
      }
      void this.loadSessionArtifacts(sessionId, { resyncIfEmpty: true });
      store.dispatch(setStreaming(session.status === 'running'));
      this.refreshContextUsageForSessionEntry(sessionId);
      void this.loadSessionMessageRailIndex(sessionId);

      void cowork.remoteManaged(sessionId).then((imResult) => {
        if (requestId === this.latestLoadSessionRequestId) {
          store.dispatch(setRemoteManaged(imResult?.remoteManaged ?? false));
        }
      });

      return session;
    }

    console.error('Failed to load session:', result.error);
    // The optimistic switch moved currentSessionId ahead of currentSession; the
    // load failed, so reconcile it back to the still-shown session to avoid the
    // switching placeholder getting stuck. Only act if this is the latest load.
    if (requestId === this.latestLoadSessionRequestId) {
      store.dispatch(setCurrentSessionId(store.getState().cowork.currentSession?.id ?? null));
    }
    return null;
  }

  async loadSessionMessageRailIndex(sessionId: string): Promise<CoworkMessageRailIndexItem[]> {
    const cowork = window.electron?.cowork;
    if (!cowork?.getSessionMessageRailIndex) return [];

    const state = store.getState().cowork;
    if (state.messageRailIndexLoadingBySessionId[sessionId]) {
      return state.messageRailIndexBySessionId[sessionId] ?? [];
    }

    store.dispatch(setMessageRailIndexLoading({ sessionId, loading: true }));
    try {
      const result = await cowork.getSessionMessageRailIndex(sessionId);
      if (result.success && result.items) {
        store.dispatch(setMessageRailIndex({ sessionId, items: result.items }));
        return result.items;
      }
      console.warn(`[CoworkService] failed to load message rail index for session ${sessionId}: ${result.error ?? 'unknown error'}`);
    } catch (error) {
      console.warn(`[CoworkService] failed to load message rail index for session ${sessionId}:`, error);
    } finally {
      store.dispatch(setMessageRailIndexLoading({ sessionId, loading: false }));
    }
    return [];
  }

  async getSessionSnapshot(sessionId: string): Promise<CoworkSession | null> {
    const cowork = window.electron?.cowork;
    if (!cowork?.getSession) return null;

    const result = await cowork.getSession(sessionId);
    if (result.success && result.session) {
      return result.session;
    }

    console.error('Failed to get session snapshot:', result.error);
    return null;
  }

  /** Load older messages for the current session (for scroll-up history). */
  async loadMoreMessages(sessionId: string): Promise<boolean> {
    const cowork = window.electron?.cowork;
    if (!cowork?.getSessionMessages) return false;

    const state = store.getState().cowork;
    if (state.currentSession?.id !== sessionId) return false;

    const currentOffset = state.currentSession.messagesOffset;
    if (currentOffset <= 0) return false;

    const PAGE_SIZE = 50;
    const newOffset = Math.max(0, currentOffset - PAGE_SIZE);
    const limit = currentOffset - newOffset;

    const result = await cowork.getSessionMessages({ sessionId, limit, offset: newOffset });
    if (result.success && result.messages && result.messages.length > 0) {
      store.dispatch(prependMessages({ sessionId, messages: result.messages, newOffset }));
      return true;
    }
    return false;
  }

  /** Load newer messages after the current paged window when scrolling down. */
  async loadNewerMessages(sessionId: string): Promise<boolean> {
    const cowork = window.electron?.cowork;
    if (!cowork?.getSessionMessages) return false;

    const state = store.getState().cowork;
    if (state.currentSession?.id !== sessionId) return false;

    const { messages, messagesOffset, totalMessages } = state.currentSession;
    const nextOffset = messagesOffset + messages.length;
    if (nextOffset >= totalMessages) return false;

    const PAGE_SIZE = 50;
    const limit = Math.min(PAGE_SIZE, totalMessages - nextOffset);
    const result = await cowork.getSessionMessages({ sessionId, limit, offset: nextOffset });
    if (result.success && result.messages && result.messages.length > 0) {
      store.dispatch(appendMessages({
        sessionId,
        messages: result.messages,
        totalMessages: result.total ?? totalMessages,
      }));
      return true;
    }
    return false;
  }

  async loadMessageWindowAroundIndex(sessionId: string, absoluteIndex: number, pageSize = 50): Promise<boolean> {
    const cowork = window.electron?.cowork;
    if (!cowork?.getSessionMessages) return false;

    const state = store.getState().cowork;
    if (state.currentSession?.id !== sessionId) return false;

    const totalMessages = state.currentSession.totalMessages;
    const safeAbsoluteIndex = Number.isFinite(absoluteIndex) ? Math.max(0, Math.floor(absoluteIndex)) : 0;
    const safePageSize = Number.isFinite(pageSize) ? Math.floor(pageSize) : 50;
    const boundedPageSize = Math.max(COWORK_MESSAGE_PAGE_SIZE, Math.min(100, safePageSize));
    const offset = Math.max(0, Math.min(
      Math.max(0, totalMessages - boundedPageSize),
      safeAbsoluteIndex - Math.floor(boundedPageSize / 2),
    ));

    const result = await cowork.getSessionMessages({ sessionId, limit: boundedPageSize, offset });
    if (result.success && result.messages && result.messages.length > 0) {
      store.dispatch(setMessageWindow({
        sessionId,
        messages: result.messages,
        messagesOffset: result.offset ?? offset,
        totalMessages: result.total ?? totalMessages,
      }));
      return true;
    }

    console.warn(`[CoworkService] message window load for session ${sessionId} returned no messages at offset ${offset}: ${result.error ?? 'empty result'}`);
    return false;
  }

  async patchSession(sessionId: string, patch: OpenClawSessionPatch): Promise<CoworkSession | null> {
    const sessionApi = window.electron?.openclaw?.session;
    if (!sessionApi?.patch) {
      console.error('OpenClaw session patch API not available');
      return null;
    }

    const result = await sessionApi.patch({ sessionId, patch });
    if (result.success && result.session) {
      const currentSessionId = store.getState().cowork.currentSessionId;
      if (currentSessionId === sessionId) {
        store.dispatch(setCurrentSession(result.session));
        store.dispatch(setStreaming(result.session.status === 'running'));
        void this.refreshContextUsage(sessionId, { notifyCompaction: false });
      }
      return result.session;
    }

    console.error('Failed to patch session:', result.error);
    return null;
  }

  async respondToPermission(requestId: string, result: CoworkPermissionResult): Promise<boolean> {
    const cowork = window.electron?.cowork;
    if (!cowork) return false;

    const response = await cowork.respondToPermission({ requestId, result });
    if (response.success) {
      store.dispatch(dequeuePendingPermission({ requestId }));
      return true;
    }

    console.error('Failed to respond to permission:', response.error);
    return false;
  }

  async updateConfig(config: CoworkConfigUpdate): Promise<boolean> {
    const cowork = window.electron?.cowork;
    if (!cowork) return false;

    const currentConfig = store.getState().cowork.config;
    const engineChanged = config.agentEngine !== undefined
      && config.agentEngine !== currentConfig.agentEngine;
    const result = await cowork.setConfig(config);
    if (result.success) {
      store.dispatch(setConfig({ ...currentConfig, ...config }));
      if (engineChanged) {
        store.dispatch(clearPendingPermissions());
        store.dispatch(setStreaming(false));
      }
      return true;
    }

    console.error('Failed to update config:', result.error);
    return false;
  }

  async updateSessionPolicy(config: OpenClawSessionPolicyConfig): Promise<boolean> {
    const sessionPolicyApi = window.electron?.openclaw?.sessionPolicy;
    if (!sessionPolicyApi) return false;

    const currentConfig = store.getState().cowork.config;
    const result = await sessionPolicyApi.set(config);
    if (result.success) {
      store.dispatch(setConfig({
        ...currentConfig,
        openClawSessionPolicy: result.config ?? config,
      }));
      return true;
    }

    console.error('Failed to update OpenClaw session policy:', result.error);
    return false;
  }

  async getApiConfig(): Promise<CoworkApiConfig | null> {
    if (!window.electron?.getApiConfig) {
      return null;
    }
    return window.electron.getApiConfig();
  }

  async checkApiConfig(options?: { probeModel?: boolean }): Promise<{ hasConfig: boolean; config: CoworkApiConfig | null; error?: string } | null> {
    if (!window.electron?.checkApiConfig) {
      return null;
    }
    return window.electron.checkApiConfig(options);
  }

  async saveApiConfig(config: CoworkApiConfig): Promise<{ success: boolean; error?: string } | null> {
    if (!window.electron?.saveApiConfig) {
      return null;
    }
    return window.electron.saveApiConfig(config);
  }

  async deleteSubagentSession(parentSessionId: string, runId: string): Promise<boolean> {
    const cowork = window.electron?.cowork;
    if (!cowork?.deleteSubagentSession) return false;

    const result = await cowork.deleteSubagentSession({ parentSessionId, runId });
    if (result.success) {
      return result.deleted ?? true;
    }

    console.error('Failed to delete subagent session:', result.error);
    return false;
  }

  async loadSubagents(
    parentSessionId: string,
    options: { showLoading?: boolean; force?: boolean } = {},
  ): Promise<SubagentSessionSummary[]> {
    const cowork = window.electron?.cowork;
    if (!parentSessionId || !cowork?.listSubagentSessions) return [];

    const state = store.getState().cowork;
    const existing = state.subagentRunsByParentSessionId[parentSessionId] ?? [];
    if (!options.force && existing.length > 0) {
      return existing;
    }
    const existingRequest = this.subagentListRequests.get(parentSessionId);
    if (existingRequest) {
      return existingRequest;
    }

    if (options.showLoading) {
      store.dispatch(setSubagentRunsLoading({ parentSessionId, loading: true }));
    }

    const request = (async () => {
      const result = await cowork.listSubagentSessions(parentSessionId);
      if (!result?.success || !Array.isArray(result.runs)) {
        store.dispatch(setSubagentRuns({ parentSessionId, runs: [] }));
        return [];
      }

      const runs = result.runs.map((run) => ({
        id: run.id,
        agentId: run.agentId,
        task: run.task,
        label: run.label,
        sessionKey: run.sessionKey,
        childCoworkSessionId: run.childCoworkSessionId,
        parentSessionId,
        status: run.status,
        createdAt: run.createdAt,
        endedAt: run.endedAt ?? null,
      }));
      store.dispatch(setSubagentRuns({ parentSessionId, runs }));
      return runs;
    })();
    this.subagentListRequests.set(parentSessionId, request);

    try {
      return await request;
    } catch (error) {
      console.warn('[CoworkService] subagent list refresh failed:', error);
      store.dispatch(setSubagentRunsLoading({ parentSessionId, loading: false }));
      return existing;
    } finally {
      if (this.subagentListRequests.get(parentSessionId) === request) {
        this.subagentListRequests.delete(parentSessionId);
      }
    }
  }

  async loadSubagentHistory(
    parentSessionId: string,
    runId: string,
    sessionKey?: string,
    options: { showLoading?: boolean; force?: boolean } = {},
  ): Promise<CoworkMessage[]> {
    const cowork = window.electron?.cowork;
    if (!parentSessionId || !runId || !cowork?.getSubTaskHistory) return [];

    const state = store.getState().cowork;
    const existing = state.subagentMessagesByRunId[runId] ?? [];
    if (!options.force && existing.length > 0) {
      return existing;
    }
    const existingRequest = this.subagentHistoryRequests.get(runId);
    if (existingRequest) {
      return existingRequest;
    }

    if (options.showLoading) {
      store.dispatch(setSubagentMessagesLoading({ runId, loading: true }));
    }

    const request = (async () => {
      const result = await cowork.getSubTaskHistory({
        parentSessionId,
        agentId: runId,
        sessionKey,
      });
      const messages = result?.success && Array.isArray(result.messages)
        ? result.messages as CoworkMessage[]
        : [];
      store.dispatch(setSubagentMessages({ runId, messages }));
      return messages;
    })();
    this.subagentHistoryRequests.set(runId, request);

    try {
      return await request;
    } catch (error) {
      console.warn('[CoworkService] subagent history refresh failed:', error);
      store.dispatch(setSubagentMessagesLoading({ runId, loading: false }));
      return existing;
    } finally {
      if (this.subagentHistoryRequests.get(runId) === request) {
        this.subagentHistoryRequests.delete(runId);
      }
    }
  }

  async listMemoryEntries(input: {
    query?: string;
    limit?: number;
    offset?: number;
  }): Promise<CoworkUserMemoryEntry[]> {
    const api = window.electron?.cowork?.listMemoryEntries;
    if (!api) return [];
    const result = await api(input);
    if (!result?.success || !result.entries) return [];
    return result.entries;
  }

  async createMemoryEntry(input: {
    text: string;
  }): Promise<CoworkUserMemoryEntry | null> {
    const api = window.electron?.cowork?.createMemoryEntry;
    if (!api) return null;
    const result = await api(input);
    if (!result?.success || !result.entry) return null;
    return result.entry;
  }

  async updateMemoryEntry(input: {
    id: string;
    text: string;
  }): Promise<CoworkUserMemoryEntry | null> {
    const api = window.electron?.cowork?.updateMemoryEntry;
    if (!api) return null;
    const result = await api(input);
    if (!result?.success || !result.entry) return null;
    return result.entry;
  }

  async deleteMemoryEntry(input: { id: string }): Promise<boolean> {
    const api = window.electron?.cowork?.deleteMemoryEntry;
    if (!api) return false;
    const result = await api(input);
    return Boolean(result?.success);
  }

  async getMemoryStats(): Promise<CoworkMemoryStats | null> {
    const api = window.electron?.cowork?.getMemoryStats;
    if (!api) return null;
    const result = await api();
    if (!result?.success || !result.stats) return null;
    return result.stats;
  }

  async readBootstrapFile(filename: string, options?: { agentId?: string }): Promise<string> {
    const api = window.electron?.cowork?.readBootstrapFile;
    if (!api) return '';
    const result = await api(filename, options);
    if (!result?.success) {
      console.warn(`[CoworkService] readBootstrapFile: failed to read ${filename}`, result?.error);
      return '';
    }
    return result.content || '';
  }

  async writeBootstrapFile(filename: string, content: string, options?: { agentId?: string }): Promise<boolean> {
    const api = window.electron?.cowork?.writeBootstrapFile;
    if (!api) return false;
    const result = await api(filename, content, options);
    return Boolean(result?.success);
  }

  onOpenClawEngineStatus(callback: (status: OpenClawEngineStatus) => void): () => void {
    this.setupOpenClawEngineListeners();
    this.openClawStatusListeners.add(callback);
    if (this.openClawStatus) {
      callback(this.openClawStatus);
    }
    return () => {
      this.openClawStatusListeners.delete(callback);
    };
  }

  async getOpenClawEngineStatus(): Promise<OpenClawEngineStatus | null> {
    return this.loadOpenClawEngineStatus();
  }

  async installOpenClawEngine(): Promise<OpenClawEngineStatus | null> {
    const engineApi = window.electron?.openclaw?.engine;
    if (!engineApi?.install) {
      return null;
    }
    const result = await engineApi.install();
    if (result?.status) {
      this.notifyOpenClawStatus(result.status);
      return result.status;
    }
    return this.openClawStatus;
  }

  async retryOpenClawInstall(): Promise<OpenClawEngineStatus | null> {
    const engineApi = window.electron?.openclaw?.engine;
    if (!engineApi?.retryInstall) {
      return null;
    }
    const result = await engineApi.retryInstall();
    if (result?.status) {
      this.notifyOpenClawStatus(result.status);
      return result.status;
    }
    return this.openClawStatus;
  }

  async restartOpenClawGateway(): Promise<OpenClawEngineStatus | null> {
    const engineApi = window.electron?.openclaw?.engine;
    if (!engineApi?.restartGateway) {
      return null;
    }
    const result = await engineApi.restartGateway();
    if (result?.status) {
      this.notifyOpenClawStatus(result.status);
      return result.status;
    }
    return this.openClawStatus;
  }

  async generateSessionTitle(prompt: string | null): Promise<string | null> {
    if (!window.electron?.generateSessionTitle) {
      return null;
    }
    return window.electron.generateSessionTitle(prompt);
  }

  async getRecentCwds(limit?: number): Promise<string[]> {
    if (!window.electron?.getRecentCwds) {
      return [];
    }
    return window.electron.getRecentCwds(limit);
  }

  clearSession(): void {
    this.latestLoadSessionRequestId += 1;
    store.dispatch(clearCurrentSession());
  }

  destroy(): void {
    this.cleanupListeners();
    this.openClawStatusListeners.clear();
    this.initialized = false;
  }
}

export const coworkService = new CoworkService();
