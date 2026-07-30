import type { CoworkMessage } from '../../coworkStore';
import {
  extractGatewayHistoryEntries,
  shouldSuppressHeartbeatText,
} from '../openclawHistory';
import { buildGatewayMediaMetadata } from './openclawConversationReconciliation';

export type CronRunHistoryEntry = {
  role: 'user' | 'assistant';
  text: string;
  metadata?: Record<string, unknown>;
  timestamp?: number;
};

export type CronRunLocalHistoryEntry = CronRunHistoryEntry & {
  id: string;
};

const CronRunHistoryMetadataKey = {
  SessionKey: 'openclawCronRunSessionKey',
  EntryIndex: 'openclawCronRunEntryIndex',
} as const;

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
};

const isSameHistoryEntry = (
  left: { role: 'user' | 'assistant'; text: string },
  right: { role: 'user' | 'assistant'; text: string },
): boolean => left.role === right.role && left.text === right.text;

export const isCronRunPromptContentCoveredByMessage = (
  messageContent: string,
  promptContent: string,
): boolean => {
  const message = messageContent.trim();
  const prompt = promptContent.trim();
  return Boolean(prompt && (message === prompt || message.startsWith(`${prompt}\n`)));
};

const normalizeCronRunSessionKey = (sessionKey: string): string => {
  const trimmed = sessionKey.trim();
  const legacyMatch = trimmed.match(/^cron:([^:\s]+)$/i);
  if (legacyMatch) return `cron:${legacyMatch[1]}`;
  const agentMatch = trimmed.match(/^agent:([^:]+):cron:([^:\s]+)(?::run:.+)?$/i);
  if (agentMatch) return `agent:${agentMatch[1]}:cron:${agentMatch[2]}`;
  return trimmed;
};

const isSameCronRunSessionKey = (left: string | null, right: string): boolean => {
  return Boolean(left && normalizeCronRunSessionKey(left) === normalizeCronRunSessionKey(right));
};

export const buildCronRunHistoryMetadata = (
  sessionKey: string,
  entryIndex: number,
  metadata: Record<string, unknown> = {},
): Record<string, unknown> => ({
  ...metadata,
  [CronRunHistoryMetadataKey.SessionKey]: normalizeCronRunSessionKey(sessionKey),
  [CronRunHistoryMetadataKey.EntryIndex]: entryIndex,
});

export const getCronRunHistorySessionKey = (metadata: unknown): string | null => {
  if (!isRecord(metadata)) return null;
  const value = metadata[CronRunHistoryMetadataKey.SessionKey];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
};

export const getCronRunHistoryEntryIndex = (metadata: unknown): number | null => {
  if (!isRecord(metadata)) return null;
  const value = metadata[CronRunHistoryMetadataKey.EntryIndex];
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
};

const withCronRunHistoryMetadata = (
  entry: CronRunHistoryEntry,
  sessionKey: string,
  entryIndex: number,
): CronRunHistoryEntry => ({
  ...entry,
  metadata: buildCronRunHistoryMetadata(sessionKey, entryIndex, entry.metadata),
});

export const buildCronRunHistoryEntries = (
  historyMessages: unknown[],
  sessionKey: string,
): CronRunHistoryEntry[] => {
  const entries: CronRunHistoryEntry[] = [];

  for (const entry of extractGatewayHistoryEntries(historyMessages)) {
    const role = entry.role;
    if (role !== 'user' && role !== 'assistant') continue;
    const text = entry.text.trim();
    if (!text || shouldSuppressHeartbeatText(role, text)) continue;

    let metadata: Record<string, unknown> | undefined;
    const mediaMetadata = buildGatewayMediaMetadata(entry);
    if (role === 'assistant' && (entry.usage || entry.model)) {
      metadata = {};
      if (entry.usage) {
        metadata.usage = {
          ...(entry.usage.input != null && { inputTokens: entry.usage.input }),
          ...(entry.usage.output != null && { outputTokens: entry.usage.output }),
        };
      }
      if (entry.model) {
        metadata.model = entry.model;
      }
    }
    if (mediaMetadata) {
      metadata = {
        ...(metadata ?? {}),
        ...mediaMetadata,
      };
    }

    entries.push(withCronRunHistoryMetadata({
      role,
      text,
      ...(metadata && { metadata }),
      ...(entry.timestamp != null && { timestamp: entry.timestamp }),
    }, sessionKey, entries.length));
  }

  return entries;
};

export const buildCronRunLocalHistoryEntries = (
  messages: CoworkMessage[],
): CronRunLocalHistoryEntry[] => {
  return messages
    .filter((message) => message.type === 'user' || message.type === 'assistant')
    .map((message) => ({
      id: message.id,
      role: message.type as 'user' | 'assistant',
      text: message.content.trim(),
      metadata: isRecord(message.metadata) ? message.metadata : undefined,
      timestamp: message.timestamp,
    }))
    .filter((entry) => entry.text && !shouldSuppressHeartbeatText(entry.role, entry.text));
};

export const isLocalConversationCoveredByCronHistory = (
  localEntries: ReadonlyArray<{ role: 'user' | 'assistant'; text: string }>,
  authoritativeEntries: ReadonlyArray<CronRunHistoryEntry>,
): boolean => {
  if (localEntries.length > authoritativeEntries.length) return false;

  let authIdx = 0;
  for (const local of localEntries) {
    let matched = false;
    while (authIdx < authoritativeEntries.length) {
      const authoritative = authoritativeEntries[authIdx++];
      if (isSameHistoryEntry(local, authoritative)) {
        matched = true;
        break;
      }
    }
    if (!matched) return false;
  }
  return true;
};

export const shouldReplaceLocalConversationWithCronHistory = (
  localEntries: ReadonlyArray<CronRunLocalHistoryEntry>,
  authoritativeEntries: ReadonlyArray<CronRunHistoryEntry>,
  sessionKey: string,
): boolean => {
  const hasOtherCronRunHistory = localEntries.some((entry) => {
    const importedSessionKey = getCronRunHistorySessionKey(entry.metadata);
    return Boolean(importedSessionKey && !isSameCronRunSessionKey(importedSessionKey, sessionKey));
  });

  return !hasOtherCronRunHistory
    && isLocalConversationCoveredByCronHistory(localEntries, authoritativeEntries);
};

export const findCronRunHistoryLocalMatch = (
  authoritative: CronRunHistoryEntry,
  localEntries: ReadonlyArray<CronRunLocalHistoryEntry>,
  usedLocalMessageIds: ReadonlySet<string>,
  sessionKey: string,
): CronRunLocalHistoryEntry | undefined => {
  return localEntries.find((entry) => {
    if (usedLocalMessageIds.has(entry.id)) return false;
    const importedSessionKey = getCronRunHistorySessionKey(entry.metadata);
    const importedEntryIndex = getCronRunHistoryEntryIndex(entry.metadata);
    const authoritativeEntryIndex = getCronRunHistoryEntryIndex(authoritative.metadata);
    if (
      isSameCronRunSessionKey(importedSessionKey, sessionKey)
      && importedEntryIndex != null
      && importedEntryIndex === authoritativeEntryIndex
      && entry.role === authoritative.role
    ) {
      return true;
    }
    if (!isSameHistoryEntry(entry, authoritative)) return false;
    return !importedSessionKey || isSameCronRunSessionKey(importedSessionKey, sessionKey);
  });
};
