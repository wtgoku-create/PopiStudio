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
  PromptPlaceholder: 'openclawCronPromptPlaceholder',
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

export const isCronRunPromptHistoryText = (content: string): boolean => {
  const text = content.trim();
  return /^\[cron:[^\]]+\] /.test(text)
    && text.includes('\nCurrent time: ')
    && text.includes('\nReference UTC: ');
};

const normalizeCronRunSessionKey = (sessionKey: string): string => {
  const trimmed = sessionKey.trim();
  const legacyMatch = trimmed.match(/^cron:([^:\s]+)$/i);
  if (legacyMatch) return `cron:${legacyMatch[1]}`;
  const agentMatch = trimmed.match(/^agent:([^:]+):cron:([^:\s]+)(?::run:([^:\s]+))?$/i);
  if (agentMatch?.[3]) return `agent:${agentMatch[1]}:cron:${agentMatch[2]}:run:${agentMatch[3]}`;
  if (agentMatch) return `agent:${agentMatch[1]}:cron:${agentMatch[2]}`;
  return trimmed;
};

const isSameCronRunSessionKey = (left: string | null, right: string): boolean => {
  return Boolean(left && normalizeCronRunSessionKey(left) === normalizeCronRunSessionKey(right));
};

const normalizeCronRunJobSessionKey = (sessionKey: string): string => {
  return normalizeCronRunSessionKey(sessionKey).replace(/:run:[^:\s]+$/i, '');
};

const isSameCronRunJobSessionKey = (left: string | null, right: string): boolean => {
  return Boolean(left && normalizeCronRunJobSessionKey(left) === normalizeCronRunJobSessionKey(right));
};

const isJobLevelCronRunSessionKey = (sessionKey: string | null): boolean => {
  return Boolean(sessionKey && !/:run:[^:\s]+$/i.test(normalizeCronRunSessionKey(sessionKey)));
};

const isCoveredHistoryEntry = (
  local: { role: 'user' | 'assistant'; text: string },
  authoritative: { role: 'user' | 'assistant'; text: string },
): boolean => {
  if (isSameHistoryEntry(local, authoritative)) return true;
  if (local.role !== 'user' || authoritative.role !== 'user') return false;
  return isCronRunPromptContentCoveredByMessage(authoritative.text, local.text)
    || isCronRunPromptContentCoveredByMessage(local.text, authoritative.text);
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

export const mergeCronRunHistoryMetadata = (
  localMetadata: Record<string, unknown> | undefined,
  authoritativeMetadata: Record<string, unknown> | undefined,
): Record<string, unknown> => {
  const metadata = {
    ...(localMetadata ?? {}),
    ...(authoritativeMetadata ?? {}),
  };
  delete metadata[CronRunHistoryMetadataKey.PromptPlaceholder];
  return metadata;
};

const isCronRunPromptPlaceholder = (metadata: unknown): boolean => {
  return isRecord(metadata) && metadata[CronRunHistoryMetadataKey.PromptPlaceholder] === true;
};

export const isSameCronRunHistorySessionKey = (left: string | null, right: string): boolean => {
  return isSameCronRunSessionKey(left, right);
};

const isCronRunHistoryPromptDuplicate = (
  local: CronRunLocalHistoryEntry,
  authoritative: CronRunHistoryEntry,
  sessionKey: string,
): boolean => {
  if (local.role !== 'user' || authoritative.role !== 'user') return false;
  if (!isCoveredHistoryEntry(local, authoritative)) return false;
  const importedSessionKey = getCronRunHistorySessionKey(local.metadata);
  return !importedSessionKey
    || isSameCronRunSessionKey(importedSessionKey, sessionKey)
    || (isJobLevelCronRunSessionKey(importedSessionKey) && isSameCronRunJobSessionKey(importedSessionKey, sessionKey));
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
  const availableEntries = localEntries.filter(entry => !usedLocalMessageIds.has(entry.id));

  const sameRunMatch = availableEntries.find((entry) => {
    const importedSessionKey = getCronRunHistorySessionKey(entry.metadata);
    const importedEntryIndex = getCronRunHistoryEntryIndex(entry.metadata);
    const authoritativeEntryIndex = getCronRunHistoryEntryIndex(authoritative.metadata);
    return isSameCronRunSessionKey(importedSessionKey, sessionKey)
      && importedEntryIndex != null
      && importedEntryIndex === authoritativeEntryIndex
      && entry.role === authoritative.role;
  });
  if (sameRunMatch) return sameRunMatch;

  const legacyJobMatch = availableEntries.find((entry) => {
    const importedSessionKey = getCronRunHistorySessionKey(entry.metadata);
    const importedEntryIndex = getCronRunHistoryEntryIndex(entry.metadata);
    const authoritativeEntryIndex = getCronRunHistoryEntryIndex(authoritative.metadata);
    return isJobLevelCronRunSessionKey(importedSessionKey)
      && isSameCronRunJobSessionKey(importedSessionKey, sessionKey)
      && importedEntryIndex != null
      && importedEntryIndex === authoritativeEntryIndex
      && entry.role === authoritative.role
      && isCoveredHistoryEntry(entry, authoritative);
  });
  if (legacyJobMatch) return legacyJobMatch;

  const placeholderMatch = [...availableEntries].reverse().find((entry) => {
    const importedSessionKey = getCronRunHistorySessionKey(entry.metadata);
    const importedEntryIndex = getCronRunHistoryEntryIndex(entry.metadata);
    const authoritativeEntryIndex = getCronRunHistoryEntryIndex(authoritative.metadata);
    return entry.role === 'user'
      && authoritative.role === 'user'
      && isCronRunPromptPlaceholder(entry.metadata)
      && isSameCronRunJobSessionKey(importedSessionKey, sessionKey)
      && importedEntryIndex != null
      && authoritativeEntryIndex != null
      && importedEntryIndex === authoritativeEntryIndex;
  });
  if (placeholderMatch) return placeholderMatch;

  if (
    authoritative.role === 'user'
    && isCronRunPromptHistoryText(authoritative.text)
  ) {
    const exactPromptMatch = [...availableEntries].reverse().find((entry) => (
      entry.role === 'user'
      && entry.text === authoritative.text
      && isCronRunPromptHistoryText(entry.text)
    ));
    if (exactPromptMatch) return exactPromptMatch;
  }

  return availableEntries.find((entry) => {
    if (usedLocalMessageIds.has(entry.id)) return false;
    const importedSessionKey = getCronRunHistorySessionKey(entry.metadata);
    if (!isSameHistoryEntry(entry, authoritative)) return false;
    if (entry.role === 'user') {
      return isCronRunHistoryPromptDuplicate(entry, authoritative, sessionKey);
    }
    return !importedSessionKey
      || isSameCronRunSessionKey(importedSessionKey, sessionKey)
      || (isJobLevelCronRunSessionKey(importedSessionKey) && isSameCronRunJobSessionKey(importedSessionKey, sessionKey));
  });
};
