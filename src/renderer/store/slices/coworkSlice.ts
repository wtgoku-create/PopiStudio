import { createSlice, PayloadAction } from '@reduxjs/toolkit';

import type { CoworkBrowserAnnotationBatch } from '../../../shared/cowork/browserAnnotations';
import {
  COWORK_RAIL_TOOLTIP_PREVIEW_MAX_LENGTH,
  type CoworkMessageRailIndexItem,
  getCoworkRailPreview,
} from '../../../shared/cowork/rail';
import type { CoworkSelectedTextSnippet } from '../../../shared/cowork/selectedText';
import {
  type CoworkPendingSteer,
  CoworkSteerStatus,
  type CoworkSteerStatus as CoworkSteerStatusType,
} from '../../../shared/cowork/steer';
import type { CoworkPromptResourceSource } from '../../../shared/cowork/promptDocument';
import {
  type CoworkConfig,
  type CoworkContextUsage,
  type CoworkMessage,
  type CoworkPermissionRequest,
  type CoworkSession,
  type CoworkSessionStatus,
  CoworkSessionStatusValue,
  type CoworkSessionSummary,
  type SubagentSessionSummary,
} from '../../types/cowork';
import { removeSessionFromState, removeSessionsFromState } from './coworkDeleteState';

export interface DraftAttachment {
  path: string;
  name: string;
  isImage?: boolean;
  isDirectory?: boolean;
  dataUrl?: string;
  hideInEditor?: boolean;
  source?: CoworkPromptResourceSource;
}

interface CoworkState {
  sessions: CoworkSessionSummary[];
  /** Whether more sessions exist on the server beyond what is currently loaded. */
  hasMoreSessions: boolean;
  currentSessionId: string | null;
  currentSession: CoworkSession | null;
  /** LRU cache of recently-viewed full sessions, keyed by id, for instant revisit. */
  sessionCacheById: Record<string, CoworkSession>;
  /** Session ids in least-recently-left → most-recently-left order (LRU bookkeeping). */
  sessionCacheOrder: string[];
  draftPrompts: Record<string, string>;
  /** Keyed by draftKey (sessionId or '__home__'), stores pending attachments */
  draftAttachments: Record<string, DraftAttachment[]>;
  /** Keyed by draftKey (sessionId or '__home__'), stores selected text snippets */
  draftSelectedTextSnippets: Record<string, CoworkSelectedTextSnippet[]>;
  /** Keyed by draftKey; screenshots are referenced by assetId and live in main. */
  draftBrowserAnnotationBatches: Record<string, CoworkBrowserAnnotationBatch[]>;
  /** Keyed by sessionId, stores steer drafts separately from normal drafts. */
  steerDrafts: Record<string, string>;
  /** Keyed by sessionId, stores follow-up inputs queued while a turn is active. */
  pendingSteers: Record<string, CoworkPendingSteer[]>;
  /** Keyed by sessionId, stores steer requests rejected by the runtime. */
  rejectedSteers: Record<string, CoworkPendingSteer[]>;
  unreadSessionIds: string[];
  isCoworkActive: boolean;
  isStreaming: boolean;
  contextUsageBySessionId: Record<string, CoworkContextUsage>;
  compactingSessionIds: string[];
  contextMaintenanceSessionIds: string[];
  notifiedCompactionBySessionId: Record<string, number>;
  messageRailIndexBySessionId: Record<string, CoworkMessageRailIndexItem[]>;
  messageRailIndexLoadingBySessionId: Record<string, boolean>;
  subagentRunsByParentSessionId: Record<string, SubagentSessionSummary[]>;
  subagentRunsLoadingByParentSessionId: Record<string, boolean>;
  subagentMessagesByRunId: Record<string, CoworkMessage[]>;
  subagentMessagesLoadingByRunId: Record<string, boolean>;
  remoteManaged: boolean;
  pendingPermissions: CoworkPermissionRequest[];
  config: CoworkConfig;
}

const initialState: CoworkState = {
  sessions: [],
  hasMoreSessions: false,
  currentSessionId: null,
  currentSession: null,
  sessionCacheById: {},
  sessionCacheOrder: [],
  draftPrompts: {},
  draftAttachments: {},
  draftSelectedTextSnippets: {},
  draftBrowserAnnotationBatches: {},
  steerDrafts: {},
  pendingSteers: {},
  rejectedSteers: {},
  unreadSessionIds: [],
  isCoworkActive: false,
  isStreaming: false,
  contextUsageBySessionId: {},
  compactingSessionIds: [],
  contextMaintenanceSessionIds: [],
  notifiedCompactionBySessionId: {},
  messageRailIndexBySessionId: {},
  messageRailIndexLoadingBySessionId: {},
  subagentRunsByParentSessionId: {},
  subagentRunsLoadingByParentSessionId: {},
  subagentMessagesByRunId: {},
  subagentMessagesLoadingByRunId: {},
  remoteManaged: false,
  pendingPermissions: [],
  config: {
    workingDirectory: '',
    systemPrompt: '',
    executionMode: 'local',
    agentEngine: 'openclaw',
    memoryEnabled: true,
    memoryImplicitUpdateEnabled: true,
    memoryLlmJudgeEnabled: false,
    memoryGuardLevel: 'strict',
    memoryUserMemoriesMaxItems: 12,
    skipMissedJobs: true,
    embeddingEnabled: false,
    embeddingProvider: 'openai',
    embeddingModel: '',
    embeddingLocalModelPath: '',
    embeddingVectorWeight: 0.7,
    embeddingRemoteBaseUrl: '',
    embeddingRemoteApiKey: '',
    dreamingEnabled: false,
    dreamingFrequency: '0 3 * * *',
    dreamingModel: '',
    dreamingTimezone: '',
    openClawSessionPolicy: {
      keepAlive: '30d',
    },
  },
};

export const COWORK_STEER_QUEUE_LIMIT = 20;
const COWORK_STEER_REJECTED_PREVIEW_LIMIT = 20;

/** Max number of full sessions retained in the revisit cache. */
const SESSION_CACHE_LIMIT = 25;

// Snapshot the session currently being left into the LRU revisit cache, so that
// returning to it can render instantly without waiting for the getSession IPC.
// Called right before currentSession is replaced or cleared, which captures the
// freshest in-memory state (including messages streamed in while it was open).
const cacheOutgoingSession = (state: CoworkState) => {
  const outgoing = state.currentSession;
  if (!outgoing || outgoing.id.startsWith('temp-')) return;
  const existingIdx = state.sessionCacheOrder.indexOf(outgoing.id);
  if (existingIdx !== -1) state.sessionCacheOrder.splice(existingIdx, 1);
  state.sessionCacheOrder.push(outgoing.id);
  state.sessionCacheById[outgoing.id] = outgoing;
  while (state.sessionCacheOrder.length > SESSION_CACHE_LIMIT) {
    const evicted = state.sessionCacheOrder.shift();
    if (evicted && evicted !== outgoing.id) delete state.sessionCacheById[evicted];
  }
};

const removeSessionFromCache = (state: CoworkState, sessionId: string) => {
  delete state.sessionCacheById[sessionId];
  const idx = state.sessionCacheOrder.indexOf(sessionId);
  if (idx !== -1) state.sessionCacheOrder.splice(idx, 1);
};

const markSessionRead = (state: CoworkState, sessionId: string | null) => {
  if (!sessionId) return;
  state.unreadSessionIds = state.unreadSessionIds.filter((id) => id !== sessionId);
};

const markSessionUnread = (state: CoworkState, sessionId: string) => {
  if (state.currentSessionId === sessionId) return;
  if (state.unreadSessionIds.includes(sessionId)) return;
  state.unreadSessionIds.push(sessionId);
};

const shouldUseMessageAsPreview = (message: CoworkMessage): boolean => {
  return (message.type === 'user' || message.type === 'assistant')
    && message.metadata?.isThinking !== true
    && message.content.trim().length > 0;
};

const toMessagePreview = (content: string): string => {
  const normalized = content.replace(/\s+/g, ' ').trim();
  return normalized.length > 120 ? `${normalized.slice(0, 117)}...` : normalized;
};

const getLatestMessagePreview = (messages: CoworkMessage[]): string | undefined => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (shouldUseMessageAsPreview(message)) {
      return toMessagePreview(message.content);
    }
  }
  return undefined;
};

const buildRailIndexItemFromMessage = (
  message: CoworkMessage,
  messageOffset: number,
  fallbackLabelIndex: number,
): CoworkMessageRailIndexItem | null => {
  if ((message.type !== 'user' && message.type !== 'assistant') || !message.content.trim()) {
    return null;
  }

  return {
    messageId: message.id,
    type: message.type,
    sequence: null,
    messageOffset,
    timestamp: message.timestamp,
    preview: getCoworkRailPreview(
      message.content,
      message.type === 'user' ? `Turn ${fallbackLabelIndex + 1}` : 'Popiai',
      COWORK_RAIL_TOOLTIP_PREVIEW_MAX_LENGTH,
    ),
    contentLen: message.content.length,
  };
};

const resolveRailMessageOffset = (
  state: CoworkState,
  sessionId: string,
  message: CoworkMessage,
  fallbackOffset: number,
): number => {
  if (state.currentSession?.id !== sessionId) {
    return fallbackOffset;
  }
  const messageIndex = state.currentSession.messages.findIndex(item => item.id === message.id);
  return messageIndex >= 0
    ? state.currentSession.messagesOffset + messageIndex
    : fallbackOffset;
};

const upsertRailIndexItem = (
  state: CoworkState,
  sessionId: string,
  message: CoworkMessage,
): void => {
  const existingItems = state.messageRailIndexBySessionId[sessionId];
  if (!existingItems) return;

  const existingIndex = existingItems.findIndex(item => item.messageId === message.id);
  const existingItem = existingIndex >= 0 ? existingItems[existingIndex] : null;
  const fallbackOffset = existingItem?.messageOffset ?? existingItems.length;
  const messageOffset = resolveRailMessageOffset(state, sessionId, message, fallbackOffset);
  const item = buildRailIndexItemFromMessage(
    message,
    messageOffset,
    existingIndex >= 0 ? existingIndex : existingItems.length,
  );
  if (!item) {
    if (existingIndex >= 0) {
      existingItems.splice(existingIndex, 1);
    }
    return;
  }

  if (existingIndex >= 0) {
    existingItems[existingIndex] = {
      ...existingItems[existingIndex],
      ...item,
      sequence: existingItems[existingIndex].sequence,
      messageOffset: existingItems[existingIndex].messageOffset,
    };
    return;
  }

  existingItems.push(item);
};

const toSessionSummary = (session: CoworkSession): CoworkSessionSummary => ({
  id: session.id,
  title: session.title,
  lastMessagePreview: getLatestMessagePreview(session.messages),
  status: session.status,
  pinned: session.pinned ?? false,
  pinOrder: session.pinOrder ?? null,
  agentId: session.agentId,
  goal: session.goal ?? null,
  source: session.source,
  createdAt: session.createdAt,
  updatedAt: session.updatedAt,
});

const coworkSlice = createSlice({
  name: 'cowork',
  initialState,
  reducers: {
    setCoworkActive(state, action: PayloadAction<boolean>) {
      state.isCoworkActive = action.payload;
    },

    setSessions(state, action: PayloadAction<CoworkSessionSummary[]>) {
      state.sessions = action.payload;
      const validSessionIds = new Set(action.payload.map((session) => session.id));
      state.unreadSessionIds = state.unreadSessionIds.filter((id) => {
        return validSessionIds.has(id) && id !== state.currentSessionId;
      });
    },

    upsertSessionSummary(state, action: PayloadAction<CoworkSession>) {
      const summary = toSessionSummary(action.payload);
      const sessionIndex = state.sessions.findIndex((session) => session.id === summary.id);
      if (sessionIndex !== -1) {
        state.sessions[sessionIndex] = {
          ...state.sessions[sessionIndex],
          ...summary,
        };
      } else {
        state.sessions.unshift(summary);
      }
    },

    setHasMoreSessions(state, action: PayloadAction<boolean>) {
      state.hasMoreSessions = action.payload;
    },

    appendSessions(state, action: PayloadAction<{ sessions: CoworkSessionSummary[]; hasMore: boolean }>) {
      const { sessions, hasMore } = action.payload;
      const existingIds = new Set(state.sessions.map(s => s.id));
      const newSessions = sessions.filter(s => !existingIds.has(s.id));
      state.sessions = [...state.sessions, ...newSessions];
      state.hasMoreSessions = hasMore;
    },

    setCurrentSessionId(state, action: PayloadAction<string | null>) {
      state.currentSessionId = action.payload;
      markSessionRead(state, action.payload);
    },

    setCurrentSession(state, action: PayloadAction<CoworkSession | null>) {
      cacheOutgoingSession(state);
      if (action.payload) {
        const session = action.payload;
        // Ensure pagination fields are always present (guard against stale IPC data).
        state.currentSession = {
          ...session,
          messagesOffset: session.messagesOffset ?? 0,
          totalMessages: session.totalMessages ?? session.messages.length,
        };
      } else {
        state.currentSession = null;
      }
      if (action.payload) {
        state.currentSessionId = action.payload.id;
        if (!action.payload.id.startsWith('temp-')) {
          const summary = toSessionSummary(action.payload);
          const sessionIndex = state.sessions.findIndex((session) => session.id === summary.id);
          if (sessionIndex !== -1) {
            state.sessions[sessionIndex] = {
              ...state.sessions[sessionIndex],
              ...summary,
            };
          } else {
            state.sessions.unshift(summary);
          }
        }
        markSessionRead(state, action.payload.id);
      }
    },

    setDraftPrompt(state, action: PayloadAction<{ sessionId: string; draft: string }>) {
      const { sessionId, draft } = action.payload;
      if (draft) {
        state.draftPrompts[sessionId] = draft;
      } else {
        delete state.draftPrompts[sessionId];
      }
    },

    setSteerDraft(state, action: PayloadAction<{ sessionId: string; draft: string }>) {
      const { sessionId, draft } = action.payload;
      if (draft) {
        state.steerDrafts[sessionId] = draft;
      } else {
        delete state.steerDrafts[sessionId];
      }
    },

    addPendingSteer(state, action: PayloadAction<CoworkPendingSteer>) {
      const steer = action.payload;
      const pending = state.pendingSteers[steer.sessionId] ?? [];
      const existingIndex = pending.findIndex(item => item.id === steer.id);
      if (existingIndex >= 0) {
        pending[existingIndex] = steer;
      } else {
        if (pending.length >= COWORK_STEER_QUEUE_LIMIT) {
          return;
        }
        pending.push(steer);
      }
      state.pendingSteers[steer.sessionId] = pending;
    },

    updateSteerStatus(
      state,
      action: PayloadAction<{
        sessionId: string;
        steerId: string;
        status: CoworkSteerStatusType;
        error?: string;
        reason?: CoworkPendingSteer['reason'];
      }>,
    ) {
      const { sessionId, steerId, status, error, reason } = action.payload;
      const pending = state.pendingSteers[sessionId] ?? [];
      const pendingIndex = pending.findIndex(item => item.id === steerId);
      const existing = pendingIndex >= 0
        ? pending[pendingIndex]
        : (state.rejectedSteers[sessionId] ?? []).find(item => item.id === steerId);
      if (!existing) return;

      const next: CoworkPendingSteer = {
        ...existing,
        status,
        updatedAt: Date.now(),
        ...(error ? { error } : {}),
        ...(reason ? { reason } : {}),
      };

      if (pendingIndex >= 0) {
        pending.splice(pendingIndex, 1);
        if (pending.length > 0) {
          state.pendingSteers[sessionId] = pending;
        } else {
          delete state.pendingSteers[sessionId];
        }
      }

      if (status === CoworkSteerStatus.Rejected) {
        const rejected = state.rejectedSteers[sessionId] ?? [];
        const rejectedIndex = rejected.findIndex(item => item.id === steerId);
        if (rejectedIndex >= 0) {
          rejected[rejectedIndex] = next;
        } else {
          rejected.push(next);
        }
        state.rejectedSteers[sessionId] = rejected.slice(-COWORK_STEER_REJECTED_PREVIEW_LIMIT);
        return;
      }

      if (status !== CoworkSteerStatus.Pending) {
        const rejected = state.rejectedSteers[sessionId] ?? [];
        state.rejectedSteers[sessionId] = rejected.filter(item => item.id !== steerId);
        if (state.rejectedSteers[sessionId].length === 0) {
          delete state.rejectedSteers[sessionId];
        }
      }
    },

    removePendingSteer(
      state,
      action: PayloadAction<{ sessionId: string; steerId: string }>,
    ) {
      const { sessionId, steerId } = action.payload;
      const pending = state.pendingSteers[sessionId] ?? [];
      const nextPending = pending.filter(item => item.id !== steerId);
      if (nextPending.length > 0) {
        state.pendingSteers[sessionId] = nextPending;
      } else {
        delete state.pendingSteers[sessionId];
      }
    },

    removeRejectedSteer(
      state,
      action: PayloadAction<{ sessionId: string; steerId: string }>,
    ) {
      const { sessionId, steerId } = action.payload;
      const rejected = state.rejectedSteers[sessionId] ?? [];
      const nextRejected = rejected.filter(item => item.id !== steerId);
      if (nextRejected.length > 0) {
        state.rejectedSteers[sessionId] = nextRejected;
      } else {
        delete state.rejectedSteers[sessionId];
      }
    },

    clearSteerQueue(state, action: PayloadAction<string>) {
      delete state.pendingSteers[action.payload];
      delete state.rejectedSteers[action.payload];
    },

    addSession(state, action: PayloadAction<CoworkSession>) {
      cacheOutgoingSession(state);
      const summary = toSessionSummary(action.payload);
      state.sessions.unshift(summary);
      state.currentSession = {
        ...action.payload,
        messagesOffset: action.payload.messagesOffset ?? 0,
        totalMessages: action.payload.totalMessages ?? action.payload.messages.length,
      };
      state.currentSessionId = action.payload.id;
      markSessionRead(state, action.payload.id);
    },

    updateSessionStatus(state, action: PayloadAction<{ sessionId: string; status: CoworkSessionStatus }>) {
      const { sessionId, status } = action.payload;

      // Update in sessions list
      const sessionIndex = state.sessions.findIndex(s => s.id === sessionId);
      if (sessionIndex !== -1) {
        state.sessions[sessionIndex].status = status;
        state.sessions[sessionIndex].updatedAt = Date.now();
      }

      // Update current session if applicable
      if (state.currentSession?.id === sessionId) {
        state.currentSession.status = status;
        state.currentSession.updatedAt = Date.now();
        // Streaming state is tied to the currently opened session only
        state.isStreaming = status === CoworkSessionStatusValue.Running;
      }

      if (status === CoworkSessionStatusValue.Completed) {
        markSessionUnread(state, sessionId);
      }
    },

    deleteSession(state, action: PayloadAction<string>) {
      removeSessionFromState(state, action.payload);
      removeSessionFromCache(state, action.payload);
      delete state.steerDrafts[action.payload];
      delete state.pendingSteers[action.payload];
      delete state.rejectedSteers[action.payload];
      delete state.messageRailIndexBySessionId[action.payload];
      delete state.messageRailIndexLoadingBySessionId[action.payload];
      for (const run of state.subagentRunsByParentSessionId[action.payload] ?? []) {
        delete state.subagentMessagesByRunId[run.id];
        delete state.subagentMessagesLoadingByRunId[run.id];
      }
      delete state.subagentRunsByParentSessionId[action.payload];
      delete state.subagentRunsLoadingByParentSessionId[action.payload];
    },

    deleteSessions(state, action: PayloadAction<string[]>) {
      removeSessionsFromState(state, action.payload);
      for (const sessionId of action.payload) {
        removeSessionFromCache(state, sessionId);
        delete state.steerDrafts[sessionId];
        delete state.pendingSteers[sessionId];
        delete state.rejectedSteers[sessionId];
        delete state.messageRailIndexBySessionId[sessionId];
        delete state.messageRailIndexLoadingBySessionId[sessionId];
        for (const run of state.subagentRunsByParentSessionId[sessionId] ?? []) {
          delete state.subagentMessagesByRunId[run.id];
          delete state.subagentMessagesLoadingByRunId[run.id];
        }
        delete state.subagentRunsByParentSessionId[sessionId];
        delete state.subagentRunsLoadingByParentSessionId[sessionId];
      }
    },

    setSubagentRunsLoading(state, action: PayloadAction<{ parentSessionId: string; loading: boolean }>) {
      const { parentSessionId, loading } = action.payload;
      if (loading) {
        state.subagentRunsLoadingByParentSessionId[parentSessionId] = true;
      } else {
        delete state.subagentRunsLoadingByParentSessionId[parentSessionId];
      }
    },

    setSubagentRuns(state, action: PayloadAction<{ parentSessionId: string; runs: SubagentSessionSummary[] }>) {
      const { parentSessionId, runs } = action.payload;
      state.subagentRunsByParentSessionId[parentSessionId] = runs;
      delete state.subagentRunsLoadingByParentSessionId[parentSessionId];
    },

    updateSubagentRunStatus(
      state,
      action: PayloadAction<{
        parentSessionId: string;
        runId: string;
        sessionKey?: string;
        status: SubagentSessionSummary['status'];
        endedAt?: number | null;
      }>,
    ) {
      const { parentSessionId, runId, sessionKey, status, endedAt } = action.payload;
      const runs = state.subagentRunsByParentSessionId[parentSessionId];
      if (!runs) return;
      const index = runs.findIndex(item => item.id === runId || (!!sessionKey && item.sessionKey === sessionKey));
      if (index < 0) return;
      runs[index] = {
        ...runs[index],
        status,
        endedAt: status === 'running' ? runs[index].endedAt : endedAt ?? runs[index].endedAt ?? Date.now(),
      };
    },

    setSubagentMessagesLoading(state, action: PayloadAction<{ runId: string; loading: boolean }>) {
      const { runId, loading } = action.payload;
      if (loading) {
        state.subagentMessagesLoadingByRunId[runId] = true;
      } else {
        delete state.subagentMessagesLoadingByRunId[runId];
      }
    },

    setSubagentMessages(state, action: PayloadAction<{ runId: string; messages: CoworkMessage[] }>) {
      const { runId, messages } = action.payload;
      state.subagentMessagesByRunId[runId] = messages;
      delete state.subagentMessagesLoadingByRunId[runId];
    },

    setMessageRailIndexLoading(state, action: PayloadAction<{ sessionId: string; loading: boolean }>) {
      const { sessionId, loading } = action.payload;
      if (loading) {
        state.messageRailIndexLoadingBySessionId[sessionId] = true;
      } else {
        delete state.messageRailIndexLoadingBySessionId[sessionId];
      }
    },

    setMessageRailIndex(state, action: PayloadAction<{ sessionId: string; items: CoworkMessageRailIndexItem[] }>) {
      const { sessionId, items } = action.payload;
      state.messageRailIndexBySessionId[sessionId] = items;
      delete state.messageRailIndexLoadingBySessionId[sessionId];
    },

    setMessageWindow(
      state,
      action: PayloadAction<{
        sessionId: string;
        messages: CoworkMessage[];
        messagesOffset: number;
        totalMessages: number;
      }>,
    ) {
      const { sessionId, messages, messagesOffset, totalMessages } = action.payload;
      if (state.currentSession?.id !== sessionId) return;
      state.currentSession.messages = messages;
      state.currentSession.messagesOffset = messagesOffset;
      state.currentSession.totalMessages = totalMessages;
    },

    addMessage(state, action: PayloadAction<{ sessionId: string; message: CoworkMessage; beforeMessageId?: string }>) {
      const { sessionId, message, beforeMessageId } = action.payload;
      if (state.currentSession?.id === sessionId) {
        const exists = state.currentSession.messages.some((item) => item.id === message.id);
        if (!exists) {
          // If beforeMessageId is specified, insert before that message to maintain correct order
          // (e.g. thinking block should appear before the assistant text)
          let inserted = false;
          if (beforeMessageId) {
            const targetIndex = state.currentSession.messages.findIndex((item) => item.id === beforeMessageId);
            if (targetIndex !== -1) {
              state.currentSession.messages.splice(targetIndex, 0, message);
              inserted = true;
            }
          }
          if (!inserted) {
            state.currentSession.messages.push(message);
          }
          state.currentSession.updatedAt = message.timestamp;
          state.currentSession.totalMessages += 1;
        }
      }

      upsertRailIndexItem(state, sessionId, message);
      // Update session in list
      const sessionIndex = state.sessions.findIndex(s => s.id === sessionId);
      if (sessionIndex !== -1) {
        state.sessions[sessionIndex].updatedAt = message.timestamp;
        if (shouldUseMessageAsPreview(message)) {
          state.sessions[sessionIndex].lastMessagePreview = toMessagePreview(message.content);
        }
      }

      markSessionUnread(state, sessionId);
    },

    /** Prepend older messages when user scrolls up to load more history. */
    prependMessages(state, action: PayloadAction<{ sessionId: string; messages: CoworkMessage[]; newOffset: number }>) {
      const { sessionId, messages, newOffset } = action.payload;
      if (state.currentSession?.id !== sessionId) return;
      if (messages.length === 0) return;
      const existingIds = new Set(state.currentSession.messages.map(m => m.id));
      const toInsert = messages.filter(m => !existingIds.has(m.id));
      state.currentSession.messages = [...toInsert, ...state.currentSession.messages];
      state.currentSession.messagesOffset = newOffset;
    },

    /** Append newer messages when a paged message window reaches its local bottom. */
    appendMessages(state, action: PayloadAction<{ sessionId: string; messages: CoworkMessage[]; totalMessages: number }>) {
      const { sessionId, messages, totalMessages } = action.payload;
      if (state.currentSession?.id !== sessionId) return;
      if (messages.length === 0) return;
      const existingIds = new Set(state.currentSession.messages.map(m => m.id));
      const toInsert = messages.filter(m => !existingIds.has(m.id));
      state.currentSession.messages = [...state.currentSession.messages, ...toInsert];
      state.currentSession.totalMessages = totalMessages;
    },

    updateMessageContent(state, action: PayloadAction<{ sessionId: string; messageId: string; content: string; metadata?: Record<string, unknown> }>) {
      const { sessionId, messageId, content, metadata } = action.payload;
      const updatedAt = Date.now();

      if (state.currentSession?.id === sessionId) {
        const messageIndex = state.currentSession.messages.findIndex(m => m.id === messageId);
        if (messageIndex !== -1) {
          state.currentSession.messages[messageIndex].content = content;
          if (metadata) {
            state.currentSession.messages[messageIndex].metadata = {
              ...state.currentSession.messages[messageIndex].metadata,
              ...metadata,
            };
          }
          state.currentSession.updatedAt = updatedAt;
        }
      }

      const sessionIndex = state.sessions.findIndex(s => s.id === sessionId);
      if (sessionIndex !== -1) {
        state.sessions[sessionIndex].updatedAt = updatedAt;
        if (metadata?.isThinking !== true && content.trim().length > 0) {
          state.sessions[sessionIndex].lastMessagePreview = toMessagePreview(content);
        }
      }

      const updatedMessage = state.currentSession?.id === sessionId
        ? state.currentSession.messages.find(m => m.id === messageId)
        : null;
      if (updatedMessage) {
        upsertRailIndexItem(state, sessionId, updatedMessage);
      }

      markSessionUnread(state, sessionId);
    },

    setStreaming(state, action: PayloadAction<boolean>) {
      state.isStreaming = action.payload;
    },

    setContextUsage(state, action: PayloadAction<CoworkContextUsage>) {
      state.contextUsageBySessionId[action.payload.sessionId] = action.payload;
    },

    setContextCompacting(state, action: PayloadAction<{ sessionId: string; compacting: boolean }>) {
      const { sessionId, compacting } = action.payload;
      const existing = state.compactingSessionIds.includes(sessionId);
      if (compacting && !existing) {
        state.compactingSessionIds.push(sessionId);
      } else if (!compacting && existing) {
        state.compactingSessionIds = state.compactingSessionIds.filter(id => id !== sessionId);
      }
    },

    setContextMaintenance(state, action: PayloadAction<{ sessionId: string; active: boolean }>) {
      const { sessionId, active } = action.payload;
      const existing = state.contextMaintenanceSessionIds.includes(sessionId);
      if (active && !existing) {
        state.contextMaintenanceSessionIds.push(sessionId);
      } else if (!active && existing) {
        state.contextMaintenanceSessionIds = state.contextMaintenanceSessionIds.filter(id => id !== sessionId);
      }
    },

    finishSessionActivity(state, action: PayloadAction<{ sessionId: string }>) {
      const { sessionId } = action.payload;
      state.contextMaintenanceSessionIds = state.contextMaintenanceSessionIds.filter(id => id !== sessionId);
      state.compactingSessionIds = state.compactingSessionIds.filter(id => id !== sessionId);
      if (state.currentSession?.id === sessionId) {
        state.isStreaming = false;
      }
    },

    markCompactionNotified(state, action: PayloadAction<{ sessionId: string; compactionCount: number }>) {
      state.notifiedCompactionBySessionId[action.payload.sessionId] = action.payload.compactionCount;
    },

    setRemoteManaged(state, action: PayloadAction<boolean>) {
      state.remoteManaged = action.payload;
    },

    updateSessionPinned(state, action: PayloadAction<{ sessionId: string; pinned: boolean; pinOrder?: number | null }>) {
      const { sessionId, pinned, pinOrder } = action.payload;
      const sessionIndex = state.sessions.findIndex(s => s.id === sessionId);
      if (sessionIndex !== -1) {
        state.sessions[sessionIndex].pinned = pinned;
        state.sessions[sessionIndex].pinOrder = pinned ? (pinOrder ?? state.sessions[sessionIndex].pinOrder ?? null) : null;
      }
      if (state.currentSession?.id === sessionId) {
        state.currentSession.pinned = pinned;
        state.currentSession.pinOrder = pinned ? (pinOrder ?? state.currentSession.pinOrder ?? null) : null;
      }
    },

    updateSessionTitle(state, action: PayloadAction<{ sessionId: string; title: string }>) {
      const { sessionId, title } = action.payload;
      const sessionIndex = state.sessions.findIndex(s => s.id === sessionId);
      if (sessionIndex !== -1) {
        state.sessions[sessionIndex].title = title;
      }
      if (state.currentSession?.id === sessionId) {
        state.currentSession.title = title;
      }
    },

    updateSessionGoal(state, action: PayloadAction<{ sessionId: string; goal: CoworkSession['goal'] }>) {
      const { sessionId, goal } = action.payload;
      const updatedAt = Date.now();
      const sessionIndex = state.sessions.findIndex(s => s.id === sessionId);
      if (sessionIndex !== -1) {
        state.sessions[sessionIndex].goal = goal ?? null;
        state.sessions[sessionIndex].updatedAt = updatedAt;
      }
      if (state.currentSession?.id === sessionId) {
        state.currentSession.goal = goal ?? null;
        state.currentSession.updatedAt = updatedAt;
      }
    },

    updateCurrentSessionModelOverride(state, action: PayloadAction<{ sessionId: string; modelOverride: string }>) {
      const { sessionId, modelOverride } = action.payload;
      if (state.currentSession?.id !== sessionId) return;
      state.currentSession.modelOverride = modelOverride;
    },

    enqueuePendingPermission(state, action: PayloadAction<CoworkPermissionRequest>) {
      const alreadyQueued = state.pendingPermissions.some(
        (permission) => permission.requestId === action.payload.requestId
      );
      if (alreadyQueued) return;
      state.pendingPermissions.push(action.payload);
    },

    dequeuePendingPermission(state, action: PayloadAction<{ requestId?: string } | undefined>) {
      const requestId = action.payload?.requestId;
      if (!requestId) {
        state.pendingPermissions.shift();
        return;
      }
      state.pendingPermissions = state.pendingPermissions.filter(
        (permission) => permission.requestId !== requestId
      );
    },

    clearPendingPermissions(state) {
      state.pendingPermissions = [];
    },

    setConfig(state, action: PayloadAction<CoworkConfig>) {
      state.config = action.payload;
    },

    updateConfig(state, action: PayloadAction<Partial<CoworkConfig>>) {
      state.config = { ...state.config, ...action.payload };
    },

    clearCurrentSession(state) {
      cacheOutgoingSession(state);
      state.currentSessionId = null;
      state.currentSession = null;
      state.isStreaming = false;
      state.remoteManaged = false;
    },

    setDraftAttachments(state, action: PayloadAction<{ draftKey: string; attachments: DraftAttachment[] }>) {
      const { draftKey, attachments } = action.payload;
      if (attachments.length === 0) {
        delete state.draftAttachments[draftKey];
      } else {
        state.draftAttachments[draftKey] = attachments;
      }
    },

    addDraftAttachment(state, action: PayloadAction<{ draftKey: string; attachment: DraftAttachment }>) {
      const { draftKey, attachment } = action.payload;
      const existing = state.draftAttachments[draftKey] || [];
      if (existing.some(a => a.path === attachment.path)) return;
      state.draftAttachments[draftKey] = [...existing, attachment];
    },

    removeDraftAttachment(state, action: PayloadAction<{ draftKey: string; path: string }>) {
      const { draftKey, path } = action.payload;
      const remaining = (state.draftAttachments[draftKey] || [])
        .filter(attachment => attachment.path !== path);
      if (remaining.length === 0) {
        delete state.draftAttachments[draftKey];
      } else {
        state.draftAttachments[draftKey] = remaining;
      }
    },

    clearDraftAttachments(state, action: PayloadAction<string>) {
      delete state.draftAttachments[action.payload];
    },

    setDraftSelectedTextSnippets(state, action: PayloadAction<{ draftKey: string; snippets: CoworkSelectedTextSnippet[] }>) {
      const { draftKey, snippets } = action.payload;
      if (snippets.length === 0) {
        delete state.draftSelectedTextSnippets[draftKey];
      } else {
        state.draftSelectedTextSnippets[draftKey] = snippets;
      }
    },

    addDraftSelectedTextSnippet(state, action: PayloadAction<{ draftKey: string; snippet: CoworkSelectedTextSnippet }>) {
      const { draftKey, snippet } = action.payload;
      const existing = state.draftSelectedTextSnippets[draftKey] || [];
      state.draftSelectedTextSnippets[draftKey] = [...existing, snippet];
    },

    removeDraftSelectedTextSnippet(state, action: PayloadAction<{ draftKey: string; snippetId: string }>) {
      const { draftKey, snippetId } = action.payload;
      const snippets = (state.draftSelectedTextSnippets[draftKey] || [])
        .filter(snippet => snippet.id !== snippetId);
      if (snippets.length === 0) {
        delete state.draftSelectedTextSnippets[draftKey];
      } else {
        state.draftSelectedTextSnippets[draftKey] = snippets;
      }
    },

    clearDraftSelectedTextSnippets(state, action: PayloadAction<string>) {
      delete state.draftSelectedTextSnippets[action.payload];
    },

    setDraftBrowserAnnotationBatches(
      state,
      action: PayloadAction<{ draftKey: string; batches: CoworkBrowserAnnotationBatch[] }>,
    ) {
      const { draftKey, batches } = action.payload;
      if (batches.length === 0) {
        delete state.draftBrowserAnnotationBatches[draftKey];
      } else {
        state.draftBrowserAnnotationBatches[draftKey] = batches;
      }
    },

    upsertDraftBrowserAnnotationBatch(
      state,
      action: PayloadAction<{ draftKey: string; batch: CoworkBrowserAnnotationBatch }>,
    ) {
      const { draftKey, batch } = action.payload;
      const existing = state.draftBrowserAnnotationBatches[draftKey] || [];
      const index = existing.findIndex(item => item.id === batch.id);
      state.draftBrowserAnnotationBatches[draftKey] = index < 0
        ? [...existing, batch]
        : existing.map(item => item.id === batch.id ? batch : item);
    },

    removeDraftBrowserAnnotationBatch(
      state,
      action: PayloadAction<{ draftKey: string; batchId: string }>,
    ) {
      const { draftKey, batchId } = action.payload;
      const batches = (state.draftBrowserAnnotationBatches[draftKey] || [])
        .filter(batch => batch.id !== batchId);
      if (batches.length === 0) {
        delete state.draftBrowserAnnotationBatches[draftKey];
      } else {
        state.draftBrowserAnnotationBatches[draftKey] = batches;
      }
    },

    clearDraftBrowserAnnotationBatches(state, action: PayloadAction<string>) {
      delete state.draftBrowserAnnotationBatches[action.payload];
    },
  },
});

export const {
  setCoworkActive,
  setSessions,
  upsertSessionSummary,
  setHasMoreSessions,
  appendSessions,
  setCurrentSessionId,
  setCurrentSession,
  setDraftPrompt,
  setSteerDraft,
  addPendingSteer,
  updateSteerStatus,
  removePendingSteer,
  removeRejectedSteer,
  clearSteerQueue,
  setDraftAttachments,
  addDraftAttachment,
  removeDraftAttachment,
  clearDraftAttachments,
  setDraftSelectedTextSnippets,
  addDraftSelectedTextSnippet,
  removeDraftSelectedTextSnippet,
  clearDraftSelectedTextSnippets,
  setDraftBrowserAnnotationBatches,
  upsertDraftBrowserAnnotationBatch,
  removeDraftBrowserAnnotationBatch,
  clearDraftBrowserAnnotationBatches,
  addSession,
  updateSessionStatus,
  deleteSession,
  deleteSessions,
  setMessageRailIndexLoading,
  setMessageRailIndex,
  setMessageWindow,
  setSubagentRunsLoading,
  setSubagentRuns,
  updateSubagentRunStatus,
  setSubagentMessagesLoading,
  setSubagentMessages,
  addMessage,
  appendMessages,
  prependMessages,
  updateMessageContent,
  setStreaming,
  setContextUsage,
  setContextCompacting,
  setContextMaintenance,
  finishSessionActivity,
  markCompactionNotified,
  setRemoteManaged,
  updateSessionPinned,
  updateSessionTitle,
  updateSessionGoal,
  updateCurrentSessionModelOverride,
  enqueuePendingPermission,
  dequeuePendingPermission,
  clearPendingPermissions,
  setConfig,
  updateConfig,
  clearCurrentSession,
} = coworkSlice.actions;

export default coworkSlice.reducer;
