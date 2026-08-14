/**
 * Utility functions and types for message display in conversation views.
 * Extracted from CoworkSessionDetail.tsx for reuse by ConversationTurnsView.
 */

import {
  ContextCompactionMode,
  ContextCompactionStatus,
  CoworkSystemMessageKind,
  isInternalCompactionSystemText,
} from '../../../common/coworkSystemMessages';
import { i18nService } from '../../services/i18n';
import type { CoworkMessage, CoworkMessageMetadata } from '../../types/cowork';

// ── Types ────────────────────────────────────────────────────────────────────

export type TodoStatus = 'completed' | 'in_progress' | 'pending' | 'unknown';

export type ParsedTodoItem = {
  primaryText: string;
  secondaryText: string | null;
  status: TodoStatus;
};

export type ToolGroupItem = {
  type: 'tool_group';
  toolUse: CoworkMessage;
  toolResult?: CoworkMessage | null;
};

export type DisplayItem =
  | { type: 'message'; message: CoworkMessage }
  | ToolGroupItem;

export type AssistantTurnItem =
  | { type: 'assistant'; message: CoworkMessage }
  | { type: 'system'; message: CoworkMessage }
  | { type: 'tool_group'; group: ToolGroupItem }
  | { type: 'tool_result'; message: CoworkMessage };

export type ConversationTurn = {
  id: string;
  userMessage: CoworkMessage | null;
  assistantItems: AssistantTurnItem[];
};

// ── Constants ────────────────────────────────────────────────────────────────

export const COWORK_DETAIL_CONTENT_CLASS = 'mx-auto w-full max-w-[760px]';
export const COWORK_DETAIL_GUTTER_CLASS = 'px-6 sm:px-8 lg:px-10';

const TOOL_USE_ERROR_TAG_PATTERN = /^<tool_use_error>([\s\S]*?)<\/tool_use_error>$/i;
const ANSI_ESCAPE_PATTERN = /\u001B\[[0-?]*[ -/]*[@-~]/g;
export const MEDIA_TOKEN_DISPLAY_RE = /\n?MEDIA:\s*`?[^`\n]+?`?\s*$/gim;
const SILENT_TOKEN_RE = /^[`*_~"'""''()[\]{}<>.,!?;:，。！？；：\s-]{0,8}NO_REPLY[`*_~"'""''()[\]{}<>.,!?;:，。！？；：\s-]{0,8}$/i;
export const TOOL_RESULT_COLLAPSED_FULL_DISPLAY_MAX_CHARS = 16 * 1024;
export const TOOL_RESULT_COLLAPSED_PREVIEW_MAX_CHARS = 4 * 1024;
export const STRUCTURED_TEXT_FORMAT_MAX_CHARS = 128 * 1024;

export type ToolResultCollapsedDisplay = {
  hasText: boolean;
  text: string;
  lineCount: number;
  isLarge: boolean;
  sizeLabel: string | null;
};

// ── Pure utility functions ───────────────────────────────────────────────────

export const formatUnknown = (value: unknown): string => {
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

export const getStringArray = (value: unknown): string | null => {
  if (!Array.isArray(value)) return null;
  const lines = value.filter((item) => typeof item === 'string') as string[];
  return lines.length > 0 ? lines.join('\n') : null;
};

export const normalizeToolName = (value: string): string => value.toLowerCase().replace(/[\s_]+/g, '');

export const getToolDisplayName = (toolName: string | undefined): string => {
  if (!toolName) return 'Tool';
  const normalized = normalizeToolName(toolName);
  switch (normalized) {
    case 'cron':
      return 'Cron';
    case 'exec':
    case 'bash':
    case 'shell':
      return 'Bash';
    case 'read':
    case 'readfile':
      return 'Read';
    case 'write':
    case 'writefile':
      return 'Write';
    case 'edit':
    case 'editfile':
      return 'Edit';
    case 'multiedit':
      return 'MultiEdit';
    case 'process':
      return 'Process';
    case 'sessionsspawn':
      return 'Subagent';
    case 'sessionsyield':
      return i18nService.t('coworkToolWaitingSubagents');
    default:
      return toolName;
  }
};

export const isBashLikeToolName = (toolName: string | undefined): boolean => {
  if (!toolName) return false;
  const normalized = normalizeToolName(toolName);
  return normalized === 'bash' || normalized === 'exec' || normalized === 'shell';
};

export const getToolInputString = (
  input: Record<string, unknown>,
  keys: string[],
): string | null => {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }
  return null;
};

export const truncatePreview = (value: string, maxLength = 120): string =>
  value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;

export const normalizeToolResultText = (value: string): string => {
  const withoutAnsi = value.replace(ANSI_ESCAPE_PATTERN, '');
  const errorTagMatch = withoutAnsi.trim().match(TOOL_USE_ERROR_TAG_PATTERN);
  const cleaned = errorTagMatch ? errorTagMatch[1].trim() : withoutAnsi;
  return cleaned.replace(MEDIA_TOKEN_DISPLAY_RE, '').trimEnd();
};

export const isTodoWriteToolName = (toolName: string | undefined): boolean => {
  if (!toolName) return false;
  return normalizeToolName(toolName) === 'todowrite';
};

export const isCronToolName = (toolName: string | undefined): boolean => {
  if (!toolName) return false;
  return normalizeToolName(toolName) === 'cron';
};

export const getCronToolSummary = (input: Record<string, unknown>): string | null => {
  const action = getToolInputString(input, ['action']);
  if (!action) return null;

  const job = input.job && typeof input.job === 'object'
    ? input.job as Record<string, unknown>
    : null;
  const jobName = job
    ? getToolInputString(job, ['name', 'id'])
    : null;
  const jobId = getToolInputString(input, ['jobId', 'id'])
    ?? (job ? getToolInputString(job, ['id']) : null);
  const wakeText = getToolInputString(input, ['text']);

  switch (action) {
    case 'add':
      return [action, jobName ?? jobId].filter(Boolean).join(' · ');
    case 'update':
    case 'remove':
    case 'run':
    case 'runs':
      return [action, jobId ?? jobName].filter(Boolean).join(' · ');
    case 'wake':
      return [action, wakeText].filter(Boolean).join(' · ');
    default:
      return action;
  }
};

export const formatStructuredText = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return value;
  }
  if (trimmed.length > STRUCTURED_TEXT_FORMAT_MAX_CHARS) {
    return value;
  }

  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return value;
  }
};

export const toTrimmedString = (value: unknown): string | null => (
  typeof value === 'string' && value.trim() ? value.trim() : null
);

export const normalizeTodoStatus = (value: unknown): TodoStatus => {
  const normalized = typeof value === 'string'
    ? value.trim().toLowerCase().replace(/-/g, '_')
    : '';

  if (normalized === 'completed') return 'completed';
  if (normalized === 'in_progress' || normalized === 'running') return 'in_progress';
  if (normalized === 'pending' || normalized === 'todo') return 'pending';
  return 'unknown';
};

export const parseTodoWriteItems = (input: unknown): ParsedTodoItem[] | null => {
  if (!input || typeof input !== 'object') return null;
  const record = input as Record<string, unknown>;
  if (!Array.isArray(record.todos)) return null;

  const parsedItems = record.todos
    .map((rawTodo) => {
      if (!rawTodo || typeof rawTodo !== 'object') {
        return null;
      }

      const todo = rawTodo as Record<string, unknown>;
      const activeForm = toTrimmedString(todo.activeForm);
      const content = toTrimmedString(todo.content);
      const primaryText = activeForm ?? content ?? i18nService.t('coworkTodoUntitled');
      const secondaryText = content && content !== primaryText ? content : null;

      return {
        primaryText,
        secondaryText,
        status: normalizeTodoStatus(todo.status),
      } satisfies ParsedTodoItem;
    })
    .filter((item): item is ParsedTodoItem => item !== null);

  return parsedItems.length > 0 ? parsedItems : null;
};

export const getTodoWriteSummary = (items: ParsedTodoItem[]): string => {
  const completedCount = items.filter((item) => item.status === 'completed').length;
  const inProgressCount = items.filter((item) => item.status === 'in_progress').length;
  const pendingCount = items.length - completedCount - inProgressCount;

  const summary = [
    `${items.length} ${i18nService.t('coworkTodoItems')}`,
    `${completedCount} ${i18nService.t('coworkTodoCompleted')}`,
    `${inProgressCount} ${i18nService.t('coworkTodoInProgress')}`,
    `${pendingCount} ${i18nService.t('coworkTodoPending')}`,
  ];

  const activeItem = items.find((item) => item.status === 'in_progress');
  if (activeItem) {
    summary.push(activeItem.primaryText);
  }

  return summary.join(' · ');
};

export const getToolInputSummary = (
  toolName: string | undefined,
  toolInput?: Record<string, unknown>
): string | null => {
  if (!toolName || !toolInput) return null;
  const input = toolInput as Record<string, unknown>;
  if (isTodoWriteToolName(toolName)) {
    const items = parseTodoWriteItems(input);
    return items ? getTodoWriteSummary(items) : null;
  }

  const normalizedToolName = normalizeToolName(toolName);

  switch (normalizedToolName) {
    case 'cron':
      return getCronToolSummary(input);
    case 'bash':
    case 'exec':
    case 'shell':
      return getToolInputString(input, ['command', 'cmd', 'script'])
        ?? getStringArray(input.commands);
    case 'read':
    case 'readfile':
    case 'write':
    case 'writefile':
    case 'edit':
    case 'editfile':
    case 'multiedit':
      return getToolInputString(input, ['file_path', 'path', 'filePath', 'target_file', 'targetFile'])
        ?? (
          typeof input.content === 'string' && input.content.trim()
            ? truncatePreview(input.content.split('\n')[0].trim())
            : null
        );
    case 'glob':
    case 'grep':
      return getToolInputString(input, ['pattern', 'query']);
    case 'task':
      return getToolInputString(input, ['description', 'task']);
    case 'webfetch':
      return getToolInputString(input, ['url']);
    case 'process': {
      const action = getToolInputString(input, ['action']);
      const sessionId = getToolInputString(input, ['sessionId', 'session_id']);
      if (action && sessionId) return `${action} · ${sessionId}`;
      return action ?? sessionId;
    }
    case 'sessionsspawn': {
      const spawnAgent = getToolInputString(input, ['agentId', 'agent_id']);
      const spawnTask = getToolInputString(input, ['task']);
      return [spawnAgent, spawnTask ? truncatePreview(spawnTask) : null].filter(Boolean).join(' · ');
    }
    default:
      return null;
  }
};

export const getToolStepDisplay = (
  toolName: string | undefined,
  toolInput?: Record<string, unknown>,
): { name: string; summary: string | null } => {
  const name = getToolDisplayName(toolName);
  let summary = getToolInputSummary(toolName, toolInput);
  if (summary) {
    const normalized = toolName ? normalizeToolName(toolName) : '';
    const isFileTool = normalized === 'read'
      || normalized === 'readfile'
      || normalized === 'write'
      || normalized === 'writefile'
      || normalized === 'edit'
      || normalized === 'editfile'
      || normalized === 'multiedit';
    if (isFileTool) {
      summary = summary.split(/[\\/]/).pop() ?? summary;
    }
    summary = truncatePreview(summary.split('\n')[0].trim(), 96);
  }
  return { name, summary: summary || null };
};

export type ActivityStepDisplay = { name: string; summary: string | null };

export const getActivityStepDisplay = (item: ConsolidatedItem): ActivityStepDisplay => {
  if (item.type === 'tool_group') {
    const rawName = item.group.toolUse.metadata?.toolName;
    return getToolStepDisplay(
      typeof rawName === 'string' ? rawName : undefined,
      item.group.toolUse.metadata?.toolInput,
    );
  }
  if (item.type === 'tool_result') {
    return { name: i18nService.t('coworkToolResult'), summary: null };
  }
  return { name: i18nService.t('reasoning'), summary: null };
};

export const formatToolInput = (
  toolName: string | undefined,
  toolInput?: Record<string, unknown>
): string | null => {
  if (!toolInput) return null;
  const summary = getToolInputSummary(toolName, toolInput);
  if (summary && summary.trim()) {
    return summary;
  }
  return formatUnknown(toolInput);
};

export const hasText = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

export const getToolResultRawText = (message: CoworkMessage): string => {
  if (hasText(message.content)) {
    return message.content;
  }
  if (hasText(message.metadata?.toolResult)) {
    return message.metadata?.toolResult ?? '';
  }
  if (hasText(message.metadata?.error)) {
    return message.metadata?.error ?? '';
  }
  return '';
};

export const getToolResultDisplay = (message: CoworkMessage): string => {
  const rawText = getToolResultRawText(message);
  return hasText(rawText)
    ? formatStructuredText(normalizeToolResultText(rawText))
    : '';
};

export const getToolResultLineCount = (result: string): number => {
  if (!result) return 0;
  let lineCount = 1;
  for (let index = 0; index < result.length; index += 1) {
    if (result.charCodeAt(index) === 10) {
      lineCount += 1;
    }
  }
  return lineCount;
};

const formatToolResultSize = (charCount: number): string => {
  if (charCount < 1024) {
    return `${charCount} B`;
  }
  if (charCount < 1024 * 1024) {
    return `${Math.ceil(charCount / 1024)} KB`;
  }
  return `${(charCount / (1024 * 1024)).toFixed(1)} MB`;
};

export const getToolResultLineCountSummary = (lineCount: number): string => {
  const unit = i18nService.t(lineCount === 1 ? 'coworkToolOutputLine' : 'coworkToolOutputLines');
  return i18nService.t('coworkToolOutputLineCount')
    .replace('{count}', String(lineCount))
    .replace('{unit}', unit);
};

export const getLargeToolResultSummary = (sizeLabel: string): string =>
  i18nService.t('coworkToolLargeOutput').replace('{size}', sizeLabel);

export const getToolResultCollapsedDisplay = (message: CoworkMessage): ToolResultCollapsedDisplay => {
  const rawText = getToolResultRawText(message);
  if (!hasText(rawText)) {
    return {
      hasText: false,
      text: '',
      lineCount: 0,
      isLarge: false,
      sizeLabel: null,
    };
  }

  if (rawText.length > TOOL_RESULT_COLLAPSED_FULL_DISPLAY_MAX_CHARS) {
    const previewText = normalizeToolResultText(rawText.slice(0, TOOL_RESULT_COLLAPSED_PREVIEW_MAX_CHARS));
    return {
      hasText: hasText(previewText) || hasText(rawText),
      text: previewText,
      lineCount: 0,
      isLarge: true,
      sizeLabel: formatToolResultSize(rawText.length),
    };
  }

  const displayText = getToolResultDisplay(message);
  return {
    hasText: hasText(displayText),
    text: displayText,
    lineCount: hasText(displayText) ? getToolResultLineCount(displayText) : 0,
    isLarge: false,
    sizeLabel: null,
  };
};

// ── Message classification ───────────────────────────────────────────────────

export const isSilentAssistantMessage = (message: CoworkMessage): boolean => (
  message.type === 'assistant' && SILENT_TOKEN_RE.test(message.content.trim())
);

export const isContextCompactionMessage = (message: CoworkMessage): boolean => (
  message.type === 'system' && message.metadata?.kind === CoworkSystemMessageKind.ContextCompaction
);

export const isLegacyInternalCompactionSystemMessage = (message: CoworkMessage): boolean => (
  message.type === 'system'
  && !message.metadata?.kind
  && isInternalCompactionSystemText(message.content)
);

const isRenderableAssistantOrSystemMessage = (message: CoworkMessage): boolean => {
  if (message.metadata?.hidden === true) {
    return false;
  }
  if (isSilentAssistantMessage(message)) {
    return false;
  }
  if (isLegacyInternalCompactionSystemMessage(message)) {
    return false;
  }
  if (hasText(message.content) || hasText(message.metadata?.error)) {
    return true;
  }
  if (message.metadata?.isThinking) {
    return true;
  }
  return false;
};

const isVisibleAssistantTurnItem = (item: AssistantTurnItem): boolean => {
  if (item.type === 'assistant' || item.type === 'system') {
    return isRenderableAssistantOrSystemMessage(item.message);
  }
  if (item.type === 'tool_result') {
    return getToolResultCollapsedDisplay(item.message).hasText;
  }
  return true;
};

export const getVisibleAssistantItems = (assistantItems: AssistantTurnItem[]): AssistantTurnItem[] =>
  assistantItems.filter(isVisibleAssistantTurnItem);

export const hasRenderableAssistantContent = (turn: ConversationTurn): boolean => (
  getVisibleAssistantItems(turn.assistantItems).length > 0
);

// ── Build pipeline ───────────────────────────────────────────────────────────

export const buildDisplayItems = (messages: CoworkMessage[]): DisplayItem[] => {
  const items: DisplayItem[] = [];
  const groupsByToolUseId = new Map<string, ToolGroupItem>();
  const knownToolUseIds = new Set<string>();
  const toolResultsByToolUseId = new Map<string, CoworkMessage>();
  for (const message of messages) {
    const toolUseId = typeof message.metadata?.toolUseId === 'string'
      ? message.metadata.toolUseId.trim()
      : '';
    if (!toolUseId) continue;
    if (message.type === 'tool_use') {
      knownToolUseIds.add(toolUseId);
    } else if (message.type === 'tool_result') {
      toolResultsByToolUseId.set(toolUseId, message);
    }
  }
  let pendingAdjacentGroup: ToolGroupItem | null = null;

  for (const message of messages) {
    if (message.metadata?.hidden === true) {
      continue;
    }
    if (isSilentAssistantMessage(message)) {
      continue;
    }
    if (isLegacyInternalCompactionSystemMessage(message)) {
      continue;
    }

    if (message.type === 'tool_use') {
      const toolUseId = typeof message.metadata?.toolUseId === 'string'
        ? message.metadata.toolUseId.trim()
        : '';
      const group: ToolGroupItem = {
        type: 'tool_group',
        toolUse: message,
        ...(toolUseId && toolResultsByToolUseId.has(toolUseId)
          ? { toolResult: toolResultsByToolUseId.get(toolUseId) }
          : {}),
      };
      items.push(group);

      if (toolUseId) {
        groupsByToolUseId.set(toolUseId, group);
      }
      pendingAdjacentGroup = group;
      continue;
    }

    if (message.type === 'tool_result') {
      let matched = false;
      const toolUseId = message.metadata?.toolUseId;
      if (typeof toolUseId === 'string' && groupsByToolUseId.has(toolUseId)) {
        const group = groupsByToolUseId.get(toolUseId);
        if (group) {
          group.toolResult = message;
          matched = true;
        }
      } else if (typeof toolUseId === 'string' && knownToolUseIds.has(toolUseId.trim())) {
        matched = true;
      } else if (pendingAdjacentGroup && !pendingAdjacentGroup.toolResult) {
        pendingAdjacentGroup.toolResult = message;
        matched = true;
      }

      pendingAdjacentGroup = null;
      if (!matched) {
        items.push({ type: 'message', message });
      }
      continue;
    }

    pendingAdjacentGroup = null;
    items.push({ type: 'message', message });
  }

  return items;
};

export const buildConversationTurns = (items: DisplayItem[]): ConversationTurn[] => {
  const turns: ConversationTurn[] = [];
  let currentTurn: ConversationTurn | null = null;
  let orphanIndex = 0;

  const ensureTurn = (): ConversationTurn => {
    if (currentTurn) return currentTurn;
    const orphanTurn: ConversationTurn = {
      id: `orphan-${orphanIndex++}`,
      userMessage: null,
      assistantItems: [],
    };
    turns.push(orphanTurn);
    currentTurn = orphanTurn;
    return orphanTurn;
  };

  for (const item of items) {
    if (item.type === 'message' && item.message.type === 'user') {
      currentTurn = {
        id: item.message.id,
        userMessage: item.message,
        assistantItems: [],
      };
      turns.push(currentTurn);
      continue;
    }

    if (item.type === 'tool_group') {
      const turn = ensureTurn();
      turn.assistantItems.push({ type: 'tool_group', group: item });
      continue;
    }

    const message = item.message;
    if (isContextCompactionMessage(message) && currentTurn?.assistantItems.length) {
      currentTurn = null;
    }
    const turn = ensureTurn();

    if (message.type === 'assistant') {
      turn.assistantItems.push({ type: 'assistant', message });
      continue;
    }

    if (message.type === 'system') {
      turn.assistantItems.push({ type: 'system', message });
      continue;
    }

    if (message.type === 'tool_result') {
      turn.assistantItems.push({ type: 'tool_result', message });
      continue;
    }

    if (message.type === 'tool_use') {
      turn.assistantItems.push({
        type: 'tool_group',
        group: {
          type: 'tool_group',
          toolUse: message,
        },
      });
    }
  }

  return turns;
};

// Activity grouping keeps intermediate work readable without hiding final
// assistant answers. A single work item is also collapsed so tool/thinking
// rows use the same Lobster activity presentation as multi-step work.
export type ConsolidatedItem = AssistantTurnItem;
export type ActivityChunkEntry = { item: ConsolidatedItem; index: number };
export type ConsolidatedRenderChunk =
  | { kind: 'item'; item: ConsolidatedItem; index: number }
  | { kind: 'activity_group'; entries: ActivityChunkEntry[] };

export const ACTIVITY_GROUP_MIN_ITEMS = 1;

export const isActivityConsolidatedItem = (item: ConsolidatedItem): boolean => (
  item.type === 'tool_group'
  || item.type === 'tool_result'
  || (item.type === 'assistant' && item.message.metadata?.isThinking === true)
);

// Pending tool rows already show their own live state. Avoid rendering a
// duplicate generic activity indicator while the parent waits for a result.
export const turnHasSelfIndicatingActivity = (turn: ConversationTurn): boolean => (
  turn.assistantItems.some(item => item.type === 'tool_group' && !item.group.toolResult)
);

export const chunkConsolidatedItemsForDisplay = (
  items: ConsolidatedItem[],
  isGroupable: (item: ConsolidatedItem, index: number) => boolean = isActivityConsolidatedItem,
): ConsolidatedRenderChunk[] => {
  const chunks: ConsolidatedRenderChunk[] = [];
  let pending: ActivityChunkEntry[] = [];
  const flush = () => {
    if (pending.length >= ACTIVITY_GROUP_MIN_ITEMS) {
      chunks.push({ kind: 'activity_group', entries: pending });
    } else {
      pending.forEach(entry => chunks.push({ kind: 'item', ...entry }));
    }
    pending = [];
  };
  items.forEach((item, index) => {
    if (isGroupable(item, index)) {
      pending.push({ item, index });
    } else {
      flush();
      chunks.push({ kind: 'item', item, index });
    }
  });
  flush();
  return chunks;
};

export const getTurnStartTimestamp = (turn: ConversationTurn): number | null => {
  const timestamps: number[] = [];
  if (turn.userMessage?.timestamp) timestamps.push(turn.userMessage.timestamp);
  turn.assistantItems.forEach(item => {
    if (item.type === 'tool_group') {
      timestamps.push(item.group.toolUse.timestamp);
      if (item.group.toolResult?.timestamp) timestamps.push(item.group.toolResult.timestamp);
    } else if (item.message.timestamp) {
      timestamps.push(item.message.timestamp);
    }
  });
  return timestamps.length > 0 ? Math.min(...timestamps) : null;
};

export const getTurnEndTimestamp = (turn: ConversationTurn): number | null => {
  const start = getTurnStartTimestamp(turn);
  if (start == null) return null;
  const timestamps = [start];
  turn.assistantItems.forEach(item => {
    timestamps.push(item.type === 'tool_group'
      ? item.group.toolResult?.timestamp ?? item.group.toolUse.timestamp
      : item.message.timestamp);
  });
  return Math.max(...timestamps);
};

export const formatTurnDuration = (durationMs: number): string => {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return i18nService.t('coworkDurationHours').replace('{hours}', String(hours)).replace('{minutes}', String(minutes));
  if (minutes > 0) return i18nService.t('coworkDurationMinutes').replace('{minutes}', String(minutes)).replace('{seconds}', String(seconds));
  return i18nService.t('coworkDurationSecondsOnly').replace('{seconds}', String(seconds));
};

export const getTurnActivityFingerprint = (turn: ConversationTurn): string => (
  `${turn.id}:${turn.assistantItems.length}:${turn.assistantItems.map(item => item.type === 'tool_group'
    ? `${item.group.toolUse.content.length}:${item.group.toolResult?.content.length ?? 0}`
    : item.message.content.length).join(',')}`
);

export const getTurnAnswerStartIndex = (chunks: ConsolidatedRenderChunk[]): number => {
  let index = chunks.length;
  while (index > 0) {
    const chunk = chunks[index - 1];
    if (chunk.kind !== 'item') break;
    const item = chunk.item;
    if (!(item.type === 'system' || (item.type === 'assistant' && item.message.metadata?.isThinking !== true))) break;
    index -= 1;
  }
  return index;
};

export type ActivityGroupSummary = { stepCount: number; durationMs: number | null };

export const getActivityGroupSummary = (items: ConsolidatedItem[]): ActivityGroupSummary => {
  const timestamps = items.flatMap(item => {
    if (item.type === 'tool_group') {
      return [item.group.toolUse.timestamp, item.group.toolResult?.timestamp].filter(
        (value): value is number => typeof value === 'number' && value > 0,
      );
    }
    return [item.message.timestamp].filter((value): value is number => typeof value === 'number' && value > 0);
  });
  const span = timestamps.length > 1 ? Math.max(...timestamps) - Math.min(...timestamps) : 0;
  return {
    stepCount: items.length,
    durationMs: span >= 1000 && span <= 24 * 60 * 60 * 1000 ? span : null,
  };
};

export const formatActivityDuration = (durationMs: number | null): string | null => {
  if (!durationMs || durationMs < 1000) return null;
  const seconds = Math.round(durationMs / 1000);
  const hours = Math.floor(seconds / 3600);
  if (hours > 0) {
    return i18nService.t('coworkActivityDurationHours')
      .replace('{hours}', String(hours))
      .replace('{minutes}', String(Math.floor((seconds % 3600) / 60)));
  }
  if (seconds < 60) return i18nService.t('coworkActivityDurationSeconds').replace('{seconds}', String(seconds));
  const minutes = Math.floor(seconds / 60);
  return i18nService.t('coworkActivityDurationMinutes')
    .replace('{minutes}', String(minutes))
    .replace('{seconds}', String(seconds % 60));
};

export const getActivityGroupHeaderLabel = (items: ConsolidatedItem[]): string => {
  if (items.length === 1 && items[0].type !== 'assistant') {
    const step = getActivityStepDisplay(items[0]);
    return step.summary ? `${step.name} ${step.summary}` : step.name;
  }
  const counts = { commands: 0, reads: 0, edits: 0, tools: 0, thinking: 0 };
  items.forEach(item => {
    if (item.type === 'assistant') {
      counts.thinking += 1;
      return;
    }
    if (item.type !== 'tool_group') {
      counts.tools += 1;
      return;
    }
    const name = typeof item.group.toolUse.metadata?.toolName === 'string'
      ? item.group.toolUse.metadata.toolName
      : undefined;
    const normalized = name ? normalizeToolName(name) : '';
    if (isBashLikeToolName(name)) counts.commands += 1;
    else if (normalized === 'read' || normalized === 'readfile') counts.reads += 1;
    else if (normalized === 'write' || normalized === 'writefile' || normalized === 'edit' || normalized === 'editfile' || normalized === 'multiedit') counts.edits += 1;
    else counts.tools += 1;
  });
  const parts: string[] = [];
  const add = (count: number, one: string, many: string) => {
    if (count > 0) parts.push(i18nService.t(count === 1 ? one : many).replace('{count}', String(count)));
  };
  add(counts.commands, 'coworkActivitySegmentCommand', 'coworkActivitySegmentCommands');
  add(counts.reads, 'coworkActivitySegmentFileRead', 'coworkActivitySegmentFilesRead');
  add(counts.edits, 'coworkActivitySegmentEdit', 'coworkActivitySegmentEdits');
  add(counts.tools, 'coworkActivitySegmentTool', 'coworkActivitySegmentTools');
  return parts.join(i18nService.t('coworkActivitySegmentSeparator')) || i18nService.t('coworkActivityThoughtProcess');
};

export const getActivityCurrentActionText = (item: ConsolidatedItem): string => {
  if (item.type === 'assistant') return i18nService.t('coworkActivityThinkingNow');
  if (item.type === 'tool_result') return i18nService.t('coworkToolResult');
  if (item.type !== 'tool_group') return i18nService.t('coworkActivityRunning');
  const name = typeof item.group.toolUse.metadata?.toolName === 'string'
    ? item.group.toolUse.metadata.toolName
    : undefined;
  const normalized = name ? normalizeToolName(name) : '';
  if (normalized === 'sessionsyield') {
    return i18nService.t('coworkActivityLiveWaitSubagents');
  }
  if (normalized === 'sessionsspawn') {
    return i18nService.t('coworkActivityLiveSpawnSubagent');
  }
  const summary = name ? getToolInputSummary(name, item.group.toolUse.metadata?.toolInput) : null;
  return summary ? `${getToolDisplayName(name)} ${truncatePreview(summary, 96)}` : getToolDisplayName(name);
};

// ── Metadata helpers ─────────────────────────────────────────────────────────

export const getMessageModelLabel = (metadata?: CoworkMessageMetadata | null): string | null => {
  const model = typeof metadata?.model === 'string' ? metadata.model.trim() : '';
  if (!model) return null;
  return model.includes('/') ? (model.split('/').pop() || model) : model;
};

export const messageMetaClassName = (visible: boolean, align: 'left' | 'right' = 'left'): string => [
  'flex items-center gap-2 mt-1 text-[11px] text-zinc-400 dark:text-zinc-500 select-none transition-opacity duration-200',
  align === 'right' ? 'justify-end' : '',
  visible ? 'opacity-100' : 'opacity-0 pointer-events-none',
].filter(Boolean).join(' ');

// ── Context compaction helpers ───────────────────────────────────────────────

export const getContextCompactionMessageLabel = (message: CoworkMessage, fallbackContent: string): string => {
  if (message.metadata?.mode === ContextCompactionMode.Manual && fallbackContent.trim()) {
    return fallbackContent;
  }

  switch (message.metadata?.status) {
    case ContextCompactionStatus.Running:
      return i18nService.t('coworkContextCompactionRunning');
    case ContextCompactionStatus.Retrying:
      return i18nService.t('coworkContextCompactionRetrying');
    case ContextCompactionStatus.Failed:
      return i18nService.t('coworkContextCompactionFailed');
    case ContextCompactionStatus.Completed:
      return i18nService.t('coworkContextCompactionCompleted');
    default:
      return fallbackContent.trim()
        ? fallbackContent
        : i18nService.t('coworkContextCompactionCompleted');
  }
};
