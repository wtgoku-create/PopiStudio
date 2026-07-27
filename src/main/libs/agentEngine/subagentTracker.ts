import crypto from 'node:crypto';

import type { SubagentMessageStore } from '../../subagentMessageStore';
import type { SubagentRunStore, SubagentRunWithParent } from '../../subagentRunStore';
import {
  shouldSuppressHeartbeatText,
} from '../openclawHistory';
import { normalizeSubagentVisibleUserText } from './subagent/childHistorySync';
import {
  parseSubagentGatewayHistoryMessages,
  type SubagentCoworkMessage,
} from './subagent/historyParser';
import { parseSubagentSessionId } from './subagent/sessionKeys';

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
};

const resolveSpawnDisplayLabel = (...sources: Array<Record<string, unknown> | null | undefined>): string | null => {
  for (const source of sources) {
    const explicitLabel = typeof source?.label === 'string' ? source.label.trim() : '';
    if (explicitLabel) return explicitLabel;
    const taskName = typeof source?.taskName === 'string' ? source.taskName.trim() : '';
    if (taskName) return taskName;
  }
  return null;
};

/**
 * Resolve tool input from a tool_use block, handling multiple field names and formats.
 * The gateway can return tool arguments as:
 *  - `input` (Anthropic format, object)
 *  - `args` (OpenClaw format, object)
 *  - `arguments` (OpenAI format, may be a JSON string)
 */
const resolveToolInput = (block: Record<string, unknown>): Record<string, unknown> => {
  if (isRecord(block.input)) return block.input;
  if (isRecord(block.args)) return block.args;
  if (isRecord(block.arguments)) return block.arguments;
  // arguments may be a JSON string (OpenAI format)
  if (typeof block.arguments === 'string') {
    try {
      const parsed = JSON.parse(block.arguments);
      if (isRecord(parsed)) return parsed;
    } catch { /* ignore parse errors */ }
  }
  if (typeof block.input === 'string') {
    try {
      const parsed = JSON.parse(block.input);
      if (isRecord(parsed)) return parsed;
    } catch { /* ignore parse errors */ }
  }
  return {};
};

const extractToolText = (payload: unknown): string => {
  if (typeof payload === 'string') return payload;
  if (Array.isArray(payload)) {
    const lines = payload.map((item) => extractToolText(item).trim()).filter(Boolean);
    return lines.join('\n');
  }
  if (!isRecord(payload)) {
    if (payload === undefined || payload === null) return '';
    try {
      return JSON.stringify(payload, null, 2);
    } catch {
      return String(payload);
    }
  }
  if (typeof payload.text === 'string' && payload.text.trim()) return payload.text;
  if (typeof payload.output === 'string' && payload.output.trim()) return payload.output;
  if (typeof payload.stdout === 'string' || typeof payload.stderr === 'string') {
    return [
      typeof payload.stdout === 'string' ? payload.stdout : '',
      typeof payload.stderr === 'string' ? payload.stderr : '',
    ].filter(Boolean).join('\n');
  }
  if (typeof payload.content === 'string' && payload.content.trim()) return payload.content;
  if (Array.isArray(payload.content)) {
    const lines = payload.content.map((item) => extractToolText(item).trim()).filter(Boolean);
    if (lines.length > 0) return lines.join('\n');
  }
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
};

const mergeToolText = (previous: string, incoming: string): string => {
  if (!previous) return incoming;
  if (!incoming) return previous;
  if (incoming.startsWith(previous)) return incoming;
  if (previous.includes(incoming)) return previous;
  return `${previous}${incoming}`;
};

export type GatewayClientLike = {
  request: <T = Record<string, unknown>>(
    method: string,
    params?: unknown,
    opts?: { expectFinal?: boolean; timeoutMs?: number | null },
  ) => Promise<T>;
};

interface GatewaySessionDeleteTask {
  sessionKey: string;
  attempt: number;
}

export interface SubagentChildSessionMaterializeParams {
  runId: string;
  childCoworkSessionId: string;
  parentSessionId: string;
  childSessionKey: string;
  agentId: string;
  task: string | null;
  label: string | null;
  status: 'running' | 'done' | 'error';
  createdAt: number;
}

export type SubagentChildSessionCandidateParams = Omit<
  SubagentChildSessionMaterializeParams,
  'childCoworkSessionId'
>;

const GATEWAY_SESSION_DELETE_CONCURRENCY = 2;
const GATEWAY_SESSION_DELETE_MAX_ATTEMPTS = 3;
const GATEWAY_SESSION_DELETE_BASE_DELAY_MS = 5_000;
const GATEWAY_SESSION_DELETE_MAX_DELAY_MS = 20_000;

/**
 * Encapsulates all subagent (child session) tracking logic:
 * state maps, lifecycle detection, history fetching, and persistence.
 *
 * All in-memory maps are keyed by toolCallId (unique per spawn invocation)
 * to avoid collisions when multiple subagents share the same agentId.
 */
export class SubagentTracker {
  /** Maps toolCallId → OpenClaw session key for the subagent session */
  private readonly subagentSessionKeys = new Map<string, string>();
  /** Maps toolCallId → collected conversation messages (CoworkMessage format) */
  private readonly subagentMessages = new Map<string, SubagentCoworkMessage[]>();
  /** Maps toolCallId → agentId for correlating spawn start → result */
  private readonly subagentToolCallIdToAgentId = new Map<string, string>();
  /** Maps toolCallId → lifecycle status */
  private readonly subagentStatus = new Map<string, 'running' | 'done' | 'error'>();
  /** Reverse map: child session key → toolCallId/runId */
  private readonly subagentRunIdBySessionKey = new Map<string, string>();
  private readonly subscribedChildSessionKeys = new Set<string>();
  /** Reverse map: agentId → Set of toolCallIds (for lookups from sessions_resume args) */
  private readonly agentIdToToolCallIds = new Map<string, Set<string>>();
  /** Run ids explicitly deleted by the user. Suppresses late spawn/backfill re-inserts. */
  private readonly deletedSubagentRunIds = new Set<string>();
  private readonly gatewaySessionDeleteQueue = new Map<string, GatewaySessionDeleteTask>();
  private readonly gatewaySessionDeleteInFlight = new Set<string>();
  private readonly gatewaySessionDeleteRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Pending spawn info stored at tool start, used for DB insertion when result arrives */
  private readonly pendingSpawnInfo = new Map<string, {
    agentId: string;
    task: string | null;
    label: string | null;
    parentSessionId: string;
    createdAt: number;
  }>();
  private readonly pendingSendInfo = new Map<string, {
    runId: string;
    sessionKey: string;
    previousStatus: 'running' | 'done' | 'error';
    appendedMessageId: string | null;
    wasMessagesPersisted: boolean;
  }>();

  constructor(
    private readonly store: SubagentRunStore,
    private readonly messageStore: SubagentMessageStore | null,
    private readonly getGatewayClient: () => GatewayClientLike | null,
    private readonly onChildSessionMaterialized?: (params: SubagentChildSessionMaterializeParams) => void,
    private readonly shouldMaterializeChildSession?: (params: SubagentChildSessionCandidateParams) => boolean,
    private readonly subscribeChildSessionMessages?: (params: SubagentChildSessionCandidateParams) => void,
    private readonly notifySubagentMessagesChanged?: (event: {
      parentSessionId: string;
      runId: string;
      sessionKey?: string;
      status?: 'running' | 'done' | 'error';
      messages?: SubagentCoworkMessage[];
    }) => void,
  ) {}

  // ── Event hooks (called by adapter at key points) ──────────────────────

  /**
   * Called when a sessions_spawn tool call starts.
   * Stores spawn info in memory only — DB insertion is deferred until the result arrives
   * so we can determine the correct initial status (running vs error).
   */
  onToolStart(
    toolCallId: string,
    args: Record<string, unknown>,
    sessionId: string,
  ): void {
    this.deletedSubagentRunIds.delete(toolCallId);
    const agentId = typeof args?.agentId === 'string' && args.agentId
      ? args.agentId
      : typeof args?.taskName === 'string' && args.taskName
        ? args.taskName
        : typeof args?.label === 'string' && args.label
          ? args.label
          : toolCallId;
    if (agentId) {
      this.registerPendingSpawn(toolCallId, args, sessionId, agentId, Date.now());
    }
  }

  /**
   * Called when a sessions_spawn tool result arrives (non-empty).
   * Creates the DB record with the correct status based on the result.
   */
  onSpawnResult(toolCallId: string, resultText: string, _args: Record<string, unknown>): void {
    if (!resultText) return;
    if (this.deletedSubagentRunIds.has(toolCallId)) return;
    if (!this.subagentToolCallIdToAgentId.has(toolCallId)) return;
    try {
      const parsed = JSON.parse(resultText);
      this.commitSpawnResult(toolCallId, parsed);
    } catch { /* result may not be JSON */ }
  }

  /**
   * Called when backfill retrieves a sessions_spawn tool result text.
   * Creates the DB record if not already done.
   */
  onBackfillResult(toolCallId: string, text: string): void {
    if (this.deletedSubagentRunIds.has(toolCallId)) return;
    if (!this.subagentToolCallIdToAgentId.has(toolCallId)) return;
    try {
      const parsed = JSON.parse(text);
      this.commitSpawnResult(toolCallId, parsed);
    } catch { /* not JSON */ }
  }

  /**
   * Reconstructs a sessions_spawn run from authoritative chat.history when the
   * realtime tool event was missed after sessions_yield.
   */
  onHistorySpawnResult(params: {
    toolCallId: string;
    args: Record<string, unknown>;
    resultText: string;
    parentSessionId: string;
    createdAt?: number;
  }): void {
    const { toolCallId, args, resultText, parentSessionId } = params;
    if (!resultText) return;
    if (this.deletedSubagentRunIds.has(toolCallId)) return;

    try {
      const parsed = JSON.parse(resultText);
      const childSessionKey = typeof parsed?.childSessionKey === 'string' ? parsed.childSessionKey : '';
      const agentId = this.resolveSpawnAgentId(args, childSessionKey, toolCallId);
      if (!agentId) return;

      this.registerPendingSpawn(toolCallId, args, parentSessionId, agentId, params.createdAt ?? Date.now());
      this.commitSpawnResult(toolCallId, parsed);
    } catch { /* result may not be JSON */ }
  }

  /**
   * Called when sessions_resume or sessions_read tool result arrives.
   * Marks matching subagent(s) as done.
   */
  onResumeOrReadResult(args: Record<string, unknown>): void {
    const agentId = typeof args?.agentId === 'string' ? args.agentId : '';
    if (!agentId) return;
    const toolCallIds = this.agentIdToToolCallIds.get(agentId);
    if (!toolCallIds) return;
    for (const tcId of toolCallIds) {
      if (this.subagentStatus.get(tcId) === 'running') {
        this.subagentStatus.set(tcId, 'done');
        this.store.updateSubagentRunStatus(tcId, 'done', Date.now());
        // Persist cached messages now that completion is confirmed
        this.tryPersistCachedMessages(tcId);
      }
    }
  }

  /**
   * Called when a parent turn sends a message into an existing subagent session.
   * Reopens the matching run and appends the sent user text so the subtask panel
   * continues from the previous transcript instead of showing a stale snapshot.
   */
  onSendStart(toolCallId: string, args: Record<string, unknown>): boolean {
    const sessionKey = typeof args?.sessionKey === 'string' ? args.sessionKey.trim() : '';
    const message = typeof args?.message === 'string' ? args.message.trim() : '';
    if (!toolCallId || !sessionKey || !message) return false;

    const runId = this.resolveRunIdBySessionKey(sessionKey);
    if (!runId) return false;
    const run = this.store.getSubagentRun?.(runId);
    if (!run) return false;

    const messages = this.ensureMutableMessages(runId);
    const lastMessage = messages[messages.length - 1];
    let appendedMessageId: string | null = null;
    if (!(lastMessage?.type === 'user' && lastMessage.content === message)) {
      appendedMessageId = crypto.randomUUID();
      messages.push({
        id: appendedMessageId,
        type: 'user',
        content: message,
        timestamp: Date.now(),
      });
    } else {
      appendedMessageId = lastMessage.id;
    }

    const previousStatus = this.subagentStatus.get(runId) ?? run.status;
    this.pendingSendInfo.set(toolCallId, {
      runId,
      sessionKey,
      previousStatus,
      appendedMessageId,
      wasMessagesPersisted: this.store.isMessagesPersisted(runId),
    });

    this.subagentMessages.set(runId, messages);
    this.subagentStatus.set(runId, 'running');
    this.store.updateSubagentRunStatus(runId, 'running');
    this.clearPersistedMessageFlag(runId);

    const agentId = run.agentId?.trim();
    if (agentId) {
      this.subagentToolCallIdToAgentId.set(runId, agentId);
      let toolCallIds = this.agentIdToToolCallIds.get(agentId);
      if (!toolCallIds) {
        toolCallIds = new Set();
        this.agentIdToToolCallIds.set(agentId, toolCallIds);
      }
      toolCallIds.add(runId);
    }

    this.notifySubagentMessagesChanged?.({
      parentSessionId: run.parentSessionId,
      runId,
      sessionKey,
      status: 'running',
      messages,
    });
    return true;
  }

  onSendResult(toolCallId: string, args: Record<string, unknown>, resultText: string, isError: boolean): boolean {
    if (!toolCallId) return false;
    const pending = this.pendingSendInfo.get(toolCallId);
    this.pendingSendInfo.delete(toolCallId);
    if (!pending) return false;

    const parsed = this.parseToolResultRecord(resultText);
    const status = typeof parsed?.status === 'string' ? parsed.status.trim().toLowerCase() : '';
    if (!isError && status !== 'forbidden' && status !== 'error' && status !== 'failed') {
      return true;
    }

    const run = this.store.getSubagentRun?.(pending.runId);
    if (!run) return false;
    const message = typeof args?.message === 'string' ? args.message.trim() : '';
    const messages = (this.subagentMessages.get(pending.runId) ?? []).filter((item) => {
      if (!pending.appendedMessageId) return true;
      return !(item.id === pending.appendedMessageId && item.type === 'user' && item.content.trim() === message);
    });
    this.subagentMessages.set(pending.runId, messages);
    this.subagentStatus.set(pending.runId, pending.previousStatus);
    this.store.updateSubagentRunStatus(
      pending.runId,
      pending.previousStatus,
      pending.previousStatus === 'running' ? undefined : Date.now(),
    );
    if (pending.wasMessagesPersisted) {
      this.store.markMessagesPersisted(pending.runId);
    }

    this.notifySubagentMessagesChanged?.({
      parentSessionId: run.parentSessionId,
      runId: pending.runId,
      sessionKey: pending.sessionKey,
      status: pending.previousStatus,
      messages,
    });
    return true;
  }

  private parseToolResultRecord(resultText: string): Record<string, unknown> | null {
    if (!resultText.trim()) return null;
    try {
      const parsed = JSON.parse(resultText);
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  /**
   * Detects announce-style runIds that signal subagent completion.
   * Announce runIds follow the pattern: announce:v<N>:agent:<parent>:subagent:<uuid>:<runUuid>
   * Returns true if the runId was an announce pattern (even if no matching subagent was found).
   */
  tryMarkDoneFromAnnounceRunId(runId: string): boolean {
    const match = runId.match(/^announce:.*:subagent:([0-9a-f-]+)/i);
    if (!match) return false;
    const subagentUuid = match[1];
    for (const [toolCallId, sessionKey] of this.subagentSessionKeys) {
      if (sessionKey.includes(subagentUuid)) {
        if (this.subagentStatus.get(toolCallId) !== 'done') {
          this.subagentStatus.set(toolCallId, 'done');
          this.store.updateSubagentRunStatus(toolCallId, 'done', Date.now());
          console.log('[SubagentTracker] marked subagent as done via announce:', toolCallId);
          // Persist cached messages now that completion is confirmed
          this.tryPersistCachedMessages(toolCallId);
        }
        return true;
      }
    }
    console.debug('[SubagentTracker] announce runId detected but no matching subagent:', runId);
    return true;
  }

  /**
   * Child session lifecycle/chat terminal events use the subagent's own
   * sessionKey, not the parent announce runId. Mark the matching parent run
   * terminal before the adapter drops the event as an unknown local session.
   */
  tryMarkTerminalFromSessionKey(
    sessionKey: string,
    status: 'done' | 'error',
  ): boolean {
    if (!sessionKey) return false;
    for (const [toolCallId, childSessionKey] of this.subagentSessionKeys) {
      if (childSessionKey !== sessionKey) continue;
      const currentStatus = this.subagentStatus.get(toolCallId);
      if (currentStatus === 'done' && status === 'error') {
        return true;
      }
      if (currentStatus !== status) {
        this.subagentStatus.set(toolCallId, status);
        this.store.updateSubagentRunStatus(toolCallId, status, Date.now());
        console.log('[SubagentTracker] marked subagent as terminal via session key:', toolCallId, status);
        this.tryPersistCachedMessages(toolCallId);
      }
      const parentSessionId = this.resolveParentSessionId(toolCallId);
      if (parentSessionId) {
        this.notifySubagentMessagesChanged?.({
          parentSessionId,
          runId: toolCallId,
          sessionKey,
          status,
        });
      }
      return true;
    }
    return false;
  }

  appendAssistantStreamFromSessionKey(sessionKey: string, text: string): boolean {
    const runId = this.resolveRunIdBySessionKey(sessionKey);
    if (!runId) return false;
    const trimmed = text.trim();
    if (!trimmed || shouldSuppressHeartbeatText('assistant', trimmed)) return true;

    this.markRunActiveFromChildEvent(runId);
    const messages = this.subagentMessages.get(runId) ?? [];
    const lastMessage = messages[messages.length - 1];
    const timestamp = Date.now();
    if (lastMessage?.type === 'assistant') {
      lastMessage.content = trimmed;
      lastMessage.timestamp = timestamp;
    } else {
      messages.push({
        id: crypto.randomUUID(),
        type: 'assistant',
        content: trimmed,
        timestamp,
        metadata: { isStreaming: true, isFinal: false },
      });
    }
    this.subagentMessages.set(runId, messages);

    const parentSessionId = this.resolveParentSessionId(runId);
    if (parentSessionId) {
      this.notifySubagentMessagesChanged?.({
        parentSessionId,
        runId,
        sessionKey,
        status: this.subagentStatus.get(runId) ?? 'running',
        messages,
      });
    }
    return true;
  }

  appendToolEventFromSessionKey(sessionKey: string, event: Record<string, unknown>): boolean {
    const runId = this.resolveRunIdBySessionKey(sessionKey);
    if (!runId) return false;

    const toolCallId = typeof event.toolCallId === 'string' ? event.toolCallId.trim() : '';
    if (!toolCallId) return true;
    const phase = typeof event.phase === 'string' ? event.phase.trim() : '';
    if (phase !== 'start' && phase !== 'update' && phase !== 'result') return true;

    this.markRunActiveFromChildEvent(runId);
    const toolName = typeof event.name === 'string' && event.name.trim()
      ? event.name.trim()
      : 'Tool';
    const messages = this.subagentMessages.get(runId) ?? [];
    const timestamp = Date.now();
    const findToolUse = () => messages.find((message) =>
      message.type === 'tool_use' && message.metadata?.toolUseId === toolCallId,
    );
    const findToolResult = () => messages.find((message) =>
      message.type === 'tool_result' && message.metadata?.toolUseId === toolCallId,
    );

    if (!findToolUse()) {
      messages.push({
        id: crypto.randomUUID(),
        type: 'tool_use',
        content: `Using tool: ${toolName}`,
        timestamp,
        metadata: {
          toolName,
          toolInput: resolveToolInput({ args: event.args }),
          toolUseId: toolCallId,
        },
      });
    }

    if (phase === 'update') {
      const incoming = extractToolText(event.partialResult);
      if (incoming.trim()) {
        const result = findToolResult();
        const previous = result?.content ?? '';
        const merged = mergeToolText(previous, incoming);
        if (result) {
          result.content = merged;
          result.timestamp = timestamp;
          result.metadata = {
            ...result.metadata,
            toolResult: merged,
            toolUseId: toolCallId,
            isError: false,
            isStreaming: true,
            isFinal: false,
          };
        } else {
          messages.push({
            id: crypto.randomUUID(),
            type: 'tool_result',
            content: merged,
            timestamp,
            metadata: {
              toolResult: merged,
              toolUseId: toolCallId,
              isError: false,
              isStreaming: true,
              isFinal: false,
            },
          });
        }
      }
    }

    if (phase === 'result') {
      const incoming = extractToolText(event.result);
      const result = findToolResult();
      const previous = result?.content ?? '';
      const finalContent = incoming.trim() ? incoming : previous;
      const isError = Boolean(event.isError);
      const finalError = isError ? (finalContent || 'Tool execution failed') : undefined;
      if (result) {
        result.content = finalContent;
        result.timestamp = timestamp;
        result.metadata = {
          ...result.metadata,
          toolResult: finalContent,
          toolUseId: toolCallId,
          error: finalError,
          isError,
          isStreaming: false,
          isFinal: true,
        };
      } else {
        messages.push({
          id: crypto.randomUUID(),
          type: 'tool_result',
          content: finalContent,
          timestamp,
          metadata: {
            toolResult: finalContent,
            toolUseId: toolCallId,
            error: finalError,
            isError,
            isStreaming: false,
            isFinal: true,
          },
        });
      }
    }

    this.subagentMessages.set(runId, messages);
    const parentSessionId = this.resolveParentSessionId(runId);
    if (parentSessionId) {
      this.notifySubagentMessagesChanged?.({
        parentSessionId,
        runId,
        sessionKey,
        status: this.subagentStatus.get(runId) ?? 'running',
        messages,
      });
    }
    return true;
  }

  resolveRunIdBySessionKey(sessionKey: string): string | null {
    if (!sessionKey) return null;
    const cached = this.subagentRunIdBySessionKey.get(sessionKey);
    if (cached) return cached;
    const subagentSessionId = parseSubagentSessionId(sessionKey);
    for (const [runId, childSessionKey] of this.subagentSessionKeys) {
      if (
        childSessionKey === sessionKey
        || (subagentSessionId && parseSubagentSessionId(childSessionKey) === subagentSessionId)
      ) {
        this.subagentRunIdBySessionKey.set(sessionKey, runId);
        return runId;
      }
    }
    const run = this.store.findSubagentRunBySessionKey?.(sessionKey);
    if (run?.id) {
      this.subagentRunIdBySessionKey.set(sessionKey, run.id);
      this.subagentSessionKeys.set(run.id, sessionKey);
      if (run.agentId) {
        this.subagentToolCallIdToAgentId.set(run.id, run.agentId);
      }
      return run.id;
    }
    return null;
  }

  /**
   * Clears all in-memory subagent tracking state and removes persisted messages.
   */
  onSessionDeleted(parentSessionId?: string): void {
    if (!parentSessionId) {
      this.subagentSessionKeys.clear();
      this.subagentMessages.clear();
      this.subagentStatus.clear();
      this.subagentRunIdBySessionKey.clear();
      this.subscribedChildSessionKeys.clear();
      this.subagentToolCallIdToAgentId.clear();
      this.agentIdToToolCallIds.clear();
      this.pendingSpawnInfo.clear();
      return;
    }

    if (typeof this.store.clearChildSessionReference === 'function') {
      this.store.clearChildSessionReference(parentSessionId);
    }
    const runs = this.store.listSubagentRuns(parentSessionId);
    if (runs.length === 0) {
      return;
    }

    for (const run of runs) {
      this.deletedSubagentRunIds.add(run.id);
      this.clearSubagentMemory(run.id);
    }
    if (this.messageStore) {
      this.messageStore.deleteByParentSession(parentSessionId);
    }
    this.store.deleteSubagentRunsByParent(parentSessionId);
  }

  async deleteSubagentRun(parentSessionId: string, runId: string): Promise<boolean> {
    const run = this.store.getSubagentRun(runId);
    if (!run || run.parentSessionId !== parentSessionId) {
      return false;
    }

    this.deletedSubagentRunIds.add(runId);
    const sessionKey = this.subagentSessionKeys.get(runId) || run.sessionKey;
    this.clearSubagentMemory(runId);

    if (this.messageStore) {
      this.messageStore.deleteByRunIds([runId]);
    }
    this.store.deleteSubagentRun(runId);

    if (sessionKey) {
      this.enqueueGatewaySessionDelete(sessionKey);
    }

    return true;
  }

  // ── Public query API ───────────────────────────────────────────────────

  /**
   * Returns persisted subagent runs for a parent session.
   * Merges in-memory status with database records for real-time accuracy.
   * Records stuck in 'running' from a previous app session (no in-memory state)
   * are automatically marked as 'error'.
   */
  listSubagentRuns(parentSessionId: string): Array<{
    id: string;
    agentId: string | null;
    task: string | null;
    label: string | null;
    sessionKey: string | null;
    childCoworkSessionId: string | null;
    status: 'running' | 'done' | 'error';
    createdAt: number;
    endedAt: number | null;
  }> {
    const runs = this.store.listSubagentRuns(parentSessionId);
    return runs.map((run) => {
      const memoryStatus = this.subagentStatus.get(run.id);
      const memorySessionKey = this.subagentSessionKeys.get(run.id);

      // Stale 'running' record from a previous session: no in-memory tracking means
      // it was never committed in this app lifecycle → mark as error and persist.
      if (run.status === 'running' && !memoryStatus && !this.pendingSpawnInfo.has(run.id)) {
        this.store.updateSubagentRunStatus(run.id, 'error', Date.now());
        return {
          id: run.id,
          agentId: run.agentId,
          task: run.task,
          label: run.label,
          sessionKey: memorySessionKey ?? run.sessionKey,
          childCoworkSessionId: run.childCoworkSessionId,
          status: 'error' as const,
          createdAt: run.createdAt,
          endedAt: Date.now(),
        };
      }

      return {
        id: run.id,
        agentId: run.agentId,
        task: run.task,
        label: run.label,
        sessionKey: memorySessionKey ?? run.sessionKey,
        childCoworkSessionId: run.childCoworkSessionId,
        status: memoryStatus ?? run.status,
        createdAt: run.createdAt,
        endedAt: run.endedAt,
      };
    });
  }

  listRunningChildSessionKeys(parentSessionId: string): string[] {
    const keys = new Set<string>();
    for (const run of this.store.listSubagentRuns(parentSessionId)) {
      const status = this.subagentStatus.get(run.id) ?? run.status;
      const sessionKey = this.subagentSessionKeys.get(run.id) ?? run.sessionKey;
      if (status === 'running' && sessionKey) {
        keys.add(sessionKey);
      }
    }
    return Array.from(keys);
  }

  listSubagentRunsByAgent(
    agentId: string,
    limit: number,
    offset: number,
  ): { runs: SubagentRunWithParent[]; hasMore: boolean } {
    const normalizedLimit = Math.max(1, Math.min(100, Math.floor(limit)));
    const normalizedOffset = Math.max(0, Math.floor(offset));
    const runs = this.store.listSubagentRunsByAgent(agentId, normalizedLimit, normalizedOffset)
      .map((run) => {
        const memoryStatus = this.subagentStatus.get(run.id);
        const memorySessionKey = this.subagentSessionKeys.get(run.id);
        if (run.status === 'running' && !memoryStatus && !this.pendingSpawnInfo.has(run.id)) {
          const endedAt = Date.now();
          this.store.updateSubagentRunStatus(run.id, 'error', endedAt);
          return {
            ...run,
            status: 'error' as const,
            sessionKey: memorySessionKey ?? run.sessionKey,
            endedAt,
          };
        }
        return {
          ...run,
          status: memoryStatus ?? run.status,
          sessionKey: memorySessionKey ?? run.sessionKey,
        };
      });
    const total = this.store.countSubagentRunsByAgent(agentId);
    return {
      runs,
      hasMore: normalizedOffset + runs.length < total,
    };
  }

  /**
   * Fetch conversation history for a subagent session.
   * Tries local cache first, then falls back to gateway RPC.
   * Note: runId parameter is the unique run identifier (toolCallId stored as DB id).
   */
  async getSubTaskHistory(
    parentSessionId: string,
    runId: string,
    sessionKey?: string,
  ): Promise<SubagentCoworkMessage[]> {
    // 1. Try locally collected messages from the live subagent stream.
    const local = this.subagentMessages.get(runId);
    if (local && local.length > 0) {
      const normalizedLocal = this.normalizeVisibleMessages(local);
      if (!this.shouldRefreshTerminalSnapshot(runId, local)) {
        return normalizedLocal;
      }
    }

    // 2. Try persisted messages from local database
    const persisted = this.loadPersistedMessages(runId);
    if (persisted && !this.shouldRefreshTerminalSnapshot(runId, persisted)) return persisted;

    // 3. Resolve session key from multiple sources
    let key = sessionKey || this.subagentSessionKeys.get(runId);

    // Cache externally-provided session key in memory for later lookups
    if (sessionKey && !this.subagentSessionKeys.has(runId)) {
      this.subagentSessionKeys.set(runId, sessionKey);
      this.subagentRunIdBySessionKey.set(sessionKey, runId);
    }

    // 3b. Try reading from persistent store if not in memory
    if (!key) {
      const runs = this.store.listSubagentRuns(parentSessionId);
      const matchingRun = runs.find((r) => r.id === runId || r.agentId === runId);
      if (matchingRun?.sessionKey) {
        key = matchingRun.sessionKey;
        this.subagentSessionKeys.set(runId, key);
        this.subagentRunIdBySessionKey.set(key, runId);
      }
      // 3c. If runId didn't match directly, check if it's a UUID that appears in any session key
      if (!key) {
        const runWithKeyMatch = runs.find((r) =>
          r.sessionKey && r.sessionKey.includes(runId),
        );
        if (runWithKeyMatch?.sessionKey) {
          key = runWithKeyMatch.sessionKey;
          this.subagentSessionKeys.set(runId, key);
          this.subagentRunIdBySessionKey.set(key, runId);
        }
      }
    }

    if (!key) {
      console.log('[SubagentTracker] getSubTaskHistory: no session key resolved for runId:', runId, 'parentSession:', parentSessionId);
      const discovered = await this.discoverSubagentSessionKey(runId);
      if (!discovered) return [];
      this.subagentSessionKeys.set(runId, discovered);
      key = discovered;
    }

    console.log('[SubagentTracker] getSubTaskHistory: fetching history for runId:', runId, 'key:', key);
    const fetched = await this.fetchSubagentHistory(key, runId);
    if (fetched.length > 0) return fetched;
    return local
      ? this.normalizeVisibleMessages(local)
      : this.loadPersistedMessages(runId, { requirePersistedFlag: false }) ?? [];
  }

  // ── Private helpers ────────────────────────────────────────────────────

  /**
   * Shared logic for onSpawnResult and onBackfillResult.
   * Inserts the DB record (if not already done) with the correct status.
   */
  private commitSpawnResult(toolCallId: string, parsed: Record<string, unknown>): void {
    if (this.deletedSubagentRunIds.has(toolCallId)) return;
    const childSessionKey = typeof parsed?.childSessionKey === 'string' ? parsed.childSessionKey : '';
    const isAccepted = parsed?.status === 'accepted' && Boolean(childSessionKey);
    const isError = !isAccepted;
    const status: SubagentChildSessionCandidateParams['status'] = isError ? 'error' : 'running';

    // Store session key in memory
    const hadSessionKey = this.subagentSessionKeys.has(toolCallId);
    if (childSessionKey) {
      this.subagentSessionKeys.set(toolCallId, childSessionKey);
      this.subagentRunIdBySessionKey.set(childSessionKey, toolCallId);
    }

    // If already committed (e.g., onSpawnResult fired then backfill also fires), just update
    if (this.subagentStatus.has(toolCallId)) {
      // Update session key in DB if newly discovered
      if (childSessionKey && !hadSessionKey) {
        this.store.updateSubagentRunSessionKey(toolCallId, childSessionKey);
      }
      if (isError && this.subagentStatus.get(toolCallId) !== 'error') {
        this.subagentStatus.set(toolCallId, 'error');
        this.store.updateSubagentRunStatus(toolCallId, 'error', Date.now());
      }
      return;
    }

    const existingRun = typeof this.store.getSubagentRun === 'function'
      ? this.store.getSubagentRun(toolCallId)
      : null;
    if (existingRun) {
      const nextStatus = isError && existingRun.status !== 'done' ? 'error' : existingRun.status;
      this.subagentStatus.set(toolCallId, nextStatus);
      if (nextStatus !== existingRun.status) {
        this.store.updateSubagentRunStatus(toolCallId, nextStatus, Date.now());
      }
      if (childSessionKey && existingRun.sessionKey !== childSessionKey) {
        this.store.updateSubagentRunSessionKey(toolCallId, childSessionKey);
      }
      const candidate = {
        runId: toolCallId,
        parentSessionId: existingRun.parentSessionId,
        childSessionKey,
        agentId: this.resolveSpawnAgentId({}, childSessionKey, existingRun.agentId || toolCallId),
        task: existingRun.task,
        label: existingRun.label,
        status: nextStatus,
        createdAt: existingRun.createdAt,
      };
      const shouldMaterialize = !isError
        && Boolean(childSessionKey)
        && (this.shouldMaterializeChildSession?.(candidate) ?? true);
      if (shouldMaterialize) {
        const childCoworkSessionId = existingRun.childCoworkSessionId || crypto.randomUUID();
        if (!existingRun.childCoworkSessionId && typeof this.store.updateSubagentRunChildSession === 'function') {
          this.store.updateSubagentRunChildSession(toolCallId, childCoworkSessionId);
        }
        this.materializeChildSession({
          ...candidate,
          childCoworkSessionId,
        });
      }
      this.appendInitialTaskMessage(toolCallId, existingRun.task, existingRun.createdAt);
      this.subscribeChildSession(candidate);
      return;
    }

    // First time: insert the DB record
    this.subagentStatus.set(toolCallId, status);
    const pending = this.pendingSpawnInfo.get(toolCallId);
    if (pending) {
      const displayLabel = pending.label ?? resolveSpawnDisplayLabel(parsed);
      const childAgentId = this.resolveSpawnAgentId({}, childSessionKey, pending.agentId);
      const candidate = {
        runId: toolCallId,
        parentSessionId: pending.parentSessionId,
        childSessionKey,
        agentId: childAgentId,
        task: pending.task,
        label: displayLabel,
        status,
        createdAt: pending.createdAt,
      };
      const shouldMaterialize = !isError
        && Boolean(childSessionKey)
        && (this.shouldMaterializeChildSession?.(candidate) ?? true);
      const childCoworkSessionId = shouldMaterialize ? crypto.randomUUID() : null;
      this.store.insertSubagentRun({
        id: toolCallId,
        parentSessionId: pending.parentSessionId,
        sessionKey: childSessionKey || null,
        childCoworkSessionId,
        agentId: childAgentId,
        task: pending.task,
        label: displayLabel,
        status,
        createdAt: pending.createdAt,
        endedAt: isError ? Date.now() : null,
      });
      this.appendInitialTaskMessage(toolCallId, pending.task, pending.createdAt);
      if (shouldMaterialize && childCoworkSessionId) {
        this.materializeChildSession({
          ...candidate,
          childCoworkSessionId,
        });
      }
      this.subscribeChildSession(candidate);
      this.pendingSpawnInfo.delete(toolCallId);
      console.log('[SubagentTracker] committed spawn result:', toolCallId, status,
        isError ? parsed.error : '');
    }
  }

  private materializeChildSession(params: SubagentChildSessionMaterializeParams): void {
    try {
      console.log(
        '[SubagentTracker] materialize child session:',
        `runId=${params.runId}`,
        `agentId=${params.agentId}`,
        `childCoworkSessionId=${params.childCoworkSessionId}`,
        `childSessionKey=${params.childSessionKey}`,
        `status=${params.status}`,
      );
      this.onChildSessionMaterialized?.(params);
    } catch (error) {
      console.warn('[SubagentTracker] failed to materialize child session:', error);
    }
  }

  private subscribeChildSession(params: SubagentChildSessionCandidateParams): void {
    if (!params.childSessionKey || params.status === 'error') return;
    if (this.subscribedChildSessionKeys.has(params.childSessionKey)) return;
    this.subscribedChildSessionKeys.add(params.childSessionKey);
    try {
      this.subscribeChildSessionMessages?.(params);
    } catch (error) {
      this.subscribedChildSessionKeys.delete(params.childSessionKey);
      console.warn('[SubagentTracker] failed to subscribe to child session messages:', error);
    }
  }

  releaseChildSessionSubscription(sessionKey: string): void {
    if (!sessionKey) return;
    this.subscribedChildSessionKeys.delete(sessionKey);
  }

  private resolveParentSessionId(runId: string): string | null {
    const pending = this.pendingSpawnInfo.get(runId);
    if (pending?.parentSessionId) return pending.parentSessionId;
    const run = this.store.getSubagentRun?.(runId);
    return run?.parentSessionId ?? null;
  }

  private resolveSpawnAgentId(
    args: Record<string, unknown>,
    childSessionKey: string,
    fallback: string,
  ): string {
    if (typeof args?.agentId === 'string' && args.agentId.trim()) {
      return args.agentId.trim();
    }
    const match = childSessionKey.match(/^agent:([^:]+):subagent:/);
    if (match?.[1]) {
      return match[1];
    }
    if (typeof args?.taskName === 'string' && args.taskName.trim()) {
      return args.taskName.trim();
    }
    if (typeof args?.label === 'string' && args.label.trim()) {
      return args.label.trim();
    }
    return fallback;
  }

  private registerPendingSpawn(
    toolCallId: string,
    args: Record<string, unknown>,
    parentSessionId: string,
    agentId: string,
    createdAt: number,
  ): void {
    if (!this.subagentMessages.has(toolCallId)) {
      this.subagentMessages.set(toolCallId, []);
    }
    this.subagentToolCallIdToAgentId.set(toolCallId, agentId);

    let toolCallIds = this.agentIdToToolCallIds.get(agentId);
    if (!toolCallIds) {
      toolCallIds = new Set();
      this.agentIdToToolCallIds.set(agentId, toolCallIds);
    }
    toolCallIds.add(toolCallId);

    const task = typeof args?.task === 'string' ? args.task : '';
    const label = resolveSpawnDisplayLabel(args);
    this.pendingSpawnInfo.set(toolCallId, {
      agentId,
      task: task || null,
      label,
      parentSessionId,
      createdAt,
    });
  }

  private clearSubagentMemory(runId: string): void {
    const agentId = this.subagentToolCallIdToAgentId.get(runId);
    const sessionKey = this.subagentSessionKeys.get(runId);
    this.subagentSessionKeys.delete(runId);
    if (sessionKey) {
      this.subagentRunIdBySessionKey.delete(sessionKey);
      this.subscribedChildSessionKeys.delete(sessionKey);
    }
    this.subagentMessages.delete(runId);
    this.subagentStatus.delete(runId);
    this.subagentToolCallIdToAgentId.delete(runId);
    this.pendingSpawnInfo.delete(runId);

    if (agentId) {
      const toolCallIds = this.agentIdToToolCallIds.get(agentId);
      toolCallIds?.delete(runId);
      if (toolCallIds?.size === 0) {
        this.agentIdToToolCallIds.delete(agentId);
      }
    }
  }

  private enqueueGatewaySessionDelete(sessionKey: string): void {
    if (
      this.gatewaySessionDeleteQueue.has(sessionKey)
      || this.gatewaySessionDeleteInFlight.has(sessionKey)
      || this.gatewaySessionDeleteRetryTimers.has(sessionKey)
    ) {
      return;
    }

    this.gatewaySessionDeleteQueue.set(sessionKey, { sessionKey, attempt: 1 });
    this.processGatewaySessionDeleteQueue();
  }

  private processGatewaySessionDeleteQueue(): void {
    while (
      this.gatewaySessionDeleteInFlight.size < GATEWAY_SESSION_DELETE_CONCURRENCY
      && this.gatewaySessionDeleteQueue.size > 0
    ) {
      const task = this.gatewaySessionDeleteQueue.values().next().value as GatewaySessionDeleteTask | undefined;
      if (!task) return;
      this.gatewaySessionDeleteQueue.delete(task.sessionKey);
      this.gatewaySessionDeleteInFlight.add(task.sessionKey);
      void this.runGatewaySessionDeleteTask(task);
    }
  }

  private async runGatewaySessionDeleteTask(task: GatewaySessionDeleteTask): Promise<void> {
    try {
      const deleted = await this.deleteGatewaySession(task.sessionKey);
      if (!deleted) {
        this.scheduleGatewaySessionDeleteRetry(task);
      }
    } finally {
      this.gatewaySessionDeleteInFlight.delete(task.sessionKey);
      this.processGatewaySessionDeleteQueue();
    }
  }

  private scheduleGatewaySessionDeleteRetry(task: GatewaySessionDeleteTask): void {
    if (task.attempt >= GATEWAY_SESSION_DELETE_MAX_ATTEMPTS) {
      console.warn('[SubagentTracker] gateway subagent session cleanup reached the retry limit');
      return;
    }

    const delayMs = Math.min(
      GATEWAY_SESSION_DELETE_BASE_DELAY_MS * (2 ** (task.attempt - 1)),
      GATEWAY_SESSION_DELETE_MAX_DELAY_MS,
    );
    const timer = setTimeout(() => {
      this.gatewaySessionDeleteRetryTimers.delete(task.sessionKey);
      this.gatewaySessionDeleteQueue.set(task.sessionKey, {
        sessionKey: task.sessionKey,
        attempt: task.attempt + 1,
      });
      this.processGatewaySessionDeleteQueue();
    }, delayMs);
    this.gatewaySessionDeleteRetryTimers.set(task.sessionKey, timer);
    console.warn('[SubagentTracker] gateway subagent session cleanup failed, retrying later');
  }

  private async deleteGatewaySession(sessionKey: string): Promise<boolean> {
    const client = this.getGatewayClient();
    if (!client) return false;

    try {
      await client.request('sessions.delete', {
        key: sessionKey,
        deleteTranscript: true,
      }, { timeoutMs: 5_000 });
      return true;
    } catch (error) {
      console.warn('[SubagentTracker] Failed to delete gateway subagent session:', error);
      return false;
    }
  }

  private async discoverSubagentSessionKey(runId: string): Promise<string | null> {
    const client = this.getGatewayClient();
    if (!client) return null;
    // Also try the agentId for discovery (the run may have been registered with a meaningful agentId)
    const agentId = this.subagentToolCallIdToAgentId.get(runId) || runId;
    try {
      const result = await client.request<{ sessions?: unknown[] }>('sessions.list', {
        activeMinutes: 120,
      }, { timeoutMs: 5_000 });
      const sessions = Array.isArray(result?.sessions) ? result.sessions : [];
      for (const session of sessions) {
        if (!isRecord(session)) continue;
        const key = typeof session.key === 'string' ? session.key : '';
        if (key.includes(`:${agentId}:`) || key.includes(`:${agentId}`)
            || key.includes(`subagent:${agentId}`)) {
          return key;
        }
      }
    } catch (error) {
      console.warn('[SubagentTracker] Failed to discover subagent session key:', error);
    }
    return null;
  }

  private async fetchSubagentHistory(
    sessionKey: string,
    runId: string,
  ): Promise<SubagentCoworkMessage[]> {
    const client = this.getGatewayClient();
    if (!client) return [];
    try {
      const history = await client.request<{ messages?: unknown[] }>('chat.history', {
        sessionKey,
        limit: 100,
      }, { timeoutMs: 10_000 });

      if (!Array.isArray(history?.messages) || history.messages.length === 0) {
        console.log('[SubagentTracker] fetchSubagentHistory: no messages returned for key:', sessionKey);
        return [];
      }

      console.log('[SubagentTracker] fetchSubagentHistory: got', history.messages.length, 'raw messages for key:', sessionKey);

      const parsedMessages = this.normalizeVisibleMessages(
        parseSubagentGatewayHistoryMessages(history.messages),
      );
      const run = this.store.getSubagentRun?.(runId);
      const messages = this.withInitialTaskMessage(parsedMessages, run?.task, run?.createdAt);

      // Cache locally
      this.subagentMessages.set(runId, messages);

      // Only persist to database if the subagent is confirmed done/error.
      // If still running, the history may be incomplete — persist later when
      // done is confirmed via announce/resume/read events.
      const currentStatus = this.subagentStatus.get(runId)
        || this.store.getRunStatus(runId);
      if (currentStatus === 'done' || currentStatus === 'error') {
        this.persistMessages(runId, messages);
      }

      console.log('[SubagentTracker] fetchSubagentHistory: extracted', messages.length, 'display messages for runId:', runId);
      return messages;
    } catch (error) {
      console.warn('[SubagentTracker] Failed to fetch subagent history:', error);
      return [];
    }
  }

  /**
   * Load messages from the persisted subagent_messages table.
   * Returns null if no persisted messages are found.
   */
  private loadPersistedMessages(
    runId: string,
    options: { requirePersistedFlag?: boolean } = {},
  ): SubagentCoworkMessage[] | null {
    if (!this.messageStore) return null;
    if ((options.requirePersistedFlag ?? true) && !this.store.isMessagesPersisted(runId)) return null;

    const rows = this.messageStore.getMessages(runId);
    if (rows.length === 0) return null;

    const messages = this.normalizeVisibleMessages(rows.map((row) => ({
      id: row.id,
      type: row.type as SubagentCoworkMessage['type'],
      content: row.content,
      timestamp: row.createdAt,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    })));

    // Populate in-memory cache so subsequent reads skip the DB
    this.subagentMessages.set(runId, messages);
    return messages;
  }

  private ensureMutableMessages(runId: string): SubagentCoworkMessage[] {
    const local = this.subagentMessages.get(runId);
    if (local) return local;
    return this.loadPersistedMessages(runId, { requirePersistedFlag: false }) ?? [];
  }

  private appendInitialTaskMessage(
    runId: string,
    task: string | null | undefined,
    createdAt: number | null | undefined,
  ): void {
    const messages = this.ensureMutableMessages(runId);
    const withInitialTask = this.withInitialTaskMessage(messages, task, createdAt);
    if (withInitialTask !== messages) {
      this.subagentMessages.set(runId, this.normalizeVisibleMessages(withInitialTask));
    }
  }

  private withInitialTaskMessage(
    messages: SubagentCoworkMessage[],
    task: string | null | undefined,
    createdAt: number | null | undefined,
  ): SubagentCoworkMessage[] {
    const content = typeof task === 'string' ? task.trim() : '';
    if (!content) return messages;
    const normalizedMessages = this.normalizeVisibleMessages(messages);
    const first = normalizedMessages[0];
    if (first?.type === 'user' && first.content.trim() === content) return normalizedMessages;
    return [{
      id: crypto.randomUUID(),
      type: 'user',
      content,
      timestamp: createdAt ?? Date.now(),
    }, ...normalizedMessages];
  }

  private normalizeVisibleMessages(
    messages: SubagentCoworkMessage[],
  ): SubagentCoworkMessage[] {
    const seen = new Set<string>();
    const normalized: SubagentCoworkMessage[] = [];
    for (const message of messages) {
      let next = message;
      if (message.type === 'user') {
        const content = normalizeSubagentVisibleUserText(message.content).trim();
        if (!content) continue;
        next = content === message.content ? message : { ...message, content };
      } else if (!message.content.trim() && message.type !== 'tool_use') {
        continue;
      }
      const key = `${next.type}:${next.content.trim()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      normalized.push(next);
    }
    return normalized;
  }

  private clearPersistedMessageFlag(runId: string): void {
    const store = this.store as SubagentRunStore & {
      clearMessagesPersisted?: (id: string) => void;
    };
    store.clearMessagesPersisted?.(runId);
  }

  private markRunActiveFromChildEvent(runId: string): void {
    if (this.subagentStatus.get(runId) === 'running') return;
    const run = this.store.getSubagentRun?.(runId);
    if (!run || run.status === 'running') {
      this.subagentStatus.set(runId, 'running');
      return;
    }
    this.subagentStatus.set(runId, 'running');
    this.store.updateSubagentRunStatus(runId, 'running');
  }

  /**
   * Persist fetched messages to local database for instant future reads.
   */
  private persistMessages(runId: string, messages: SubagentCoworkMessage[]): void {
    if (!this.messageStore) return;
    if (messages.length === 0) return;
    if (this.store.isMessagesPersisted(runId)) return;

    try {
      const normalizedMessages = this.normalizeVisibleMessages(messages);
      this.messageStore.insertMessages(runId, normalizedMessages.map((msg, idx) => ({
        id: msg.id,
        type: msg.type,
        content: msg.content,
        metadata: msg.metadata ?? null,
        timestamp: msg.timestamp,
        sequence: idx + 1,
      })));
      this.store.markMessagesPersisted(runId);
      console.log('[SubagentTracker] persisted', messages.length, 'messages for runId:', runId);
    } catch (error) {
      console.warn('[SubagentTracker] Failed to persist messages for runId:', runId, error);
    }
  }

  private tryPersistCachedMessages(runId: string): void {
    const messages = this.subagentMessages.get(runId);
    if (!messages || messages.length === 0) return;
    if (this.isOnlyInitialTaskSnapshot(messages)) return;
    this.persistMessages(runId, messages);
  }

  private shouldRefreshTerminalSnapshot(
    runId: string,
    messages: SubagentCoworkMessage[],
  ): boolean {
    const status = this.subagentStatus.get(runId) || this.store.getRunStatus(runId);
    if (status !== 'done' && status !== 'error') return false;
    return this.isOnlyInitialTaskSnapshot(messages);
  }

  private isOnlyInitialTaskSnapshot(messages: SubagentCoworkMessage[]): boolean {
    return messages.length === 1 && messages[0]?.type === 'user';
  }
}
