import type {
  CoworkMessage,
  CoworkMessageMetadata,
  CoworkStore,
} from '../../../coworkStore';
import {
  extractCurrentTurnThinkingBlocks,
  OpenClawThinkingMetadata,
} from './blocks';

type ThinkingMessagePayload = Omit<CoworkMessage, 'id' | 'timestamp'>;

export type OpenClawThinkingReconciliationStore = Pick<
  CoworkStore,
  'addMessage' | 'getSession' | 'insertMessageBeforeId' | 'updateMessage'
>;

export interface ReconcileOpenClawThinkingBlocksOptions {
  sessionId: string;
  historyMessages: unknown[];
  includeUnanchored: boolean;
  assistantMessageId?: string;
  toolUseMessageIdByToolCallId: ReadonlyMap<string, string>;
  messageIdByThinkingKey: Map<string, string>;
  store: OpenClawThinkingReconciliationStore;
  emitMessage: (message: CoworkMessage, beforeMessageId?: string) => void;
  emitMessageUpdate: (
    messageId: string,
    content: string,
    metadata: CoworkMessageMetadata,
  ) => void;
  onMessageCreated?: (details: {
    key: string;
    chars: number;
    beforeMessageId?: string;
  }) => void;
}

const getCurrentTurnMessages = (messages: CoworkMessage[]): CoworkMessage[] => {
  const lastUserIndex = messages.findLastIndex((message) => message.type === 'user');
  return messages.slice(lastUserIndex + 1);
};

const selectCanonicalBlocks = (
  historyMessages: unknown[],
  toolUseMessageIdByToolCallId: ReadonlyMap<string, string>,
  includeUnanchored: boolean,
) => {
  const extractedBlocks = extractCurrentTurnThinkingBlocks(historyMessages);
  const anchoredBlocks = extractedBlocks.filter((block) => {
    return block.anchorToolCallId
      && toolUseMessageIdByToolCallId.has(block.anchorToolCallId);
  });
  const unanchoredBlocks = extractedBlocks.filter((block) => !block.anchorToolCallId);
  const lastUnanchoredAssistantOrdinal = unanchoredBlocks.reduce(
    (latest, block) => Math.max(latest, block.assistantOrdinal),
    -1,
  );

  return [
    ...anchoredBlocks,
    ...(includeUnanchored
      ? unanchoredBlocks.filter((block) => {
        return block.assistantOrdinal === lastUnanchoredAssistantOrdinal;
      })
      : []),
  ].sort((left, right) => {
    return left.assistantOrdinal - right.assistantOrdinal
      || left.contentIndex - right.contentIndex;
  });
};

const normalizeThinkingText = (text: string): string => {
  return text.trim().replace(/\s+/g, ' ');
};

const countCommonSubsequenceChars = (left: string, right: string): number => {
  if (!left || !right) return 0;
  const previous = new Array(right.length + 1).fill(0);
  const current = new Array(right.length + 1).fill(0);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = left[leftIndex - 1] === right[rightIndex - 1]
        ? previous[rightIndex - 1] + 1
        : Math.max(previous[rightIndex], current[rightIndex - 1]);
    }
    previous.splice(0, previous.length, ...current);
    current.fill(0);
  }

  return previous[right.length];
};

const hasReusableThinkingText = (candidateText: string, canonicalText: string): boolean => {
  const candidate = normalizeThinkingText(candidateText);
  const canonical = normalizeThinkingText(canonicalText);
  if (!candidate || !canonical) return false;
  if (candidate === canonical) return true;

  const shorterLength = Math.min(candidate.length, canonical.length);
  if (shorterLength >= 8 && (candidate.includes(canonical) || canonical.includes(candidate))) {
    return true;
  }

  const longerLength = Math.max(candidate.length, canonical.length);
  if (longerLength < 12) return false;
  if (longerLength > 1000) return false;
  return countCommonSubsequenceChars(candidate, canonical) / longerLength >= 0.72;
};

export const reconcileOpenClawThinkingBlocks = (
  options: ReconcileOpenClawThinkingBlocksOptions,
): void => {
  const canonicalBlocks = selectCanonicalBlocks(
    options.historyMessages,
    options.toolUseMessageIdByToolCallId,
    options.includeUnanchored,
  );
  if (canonicalBlocks.length === 0) return;

  const session = options.store.getSession(options.sessionId);
  if (!session) return;

  const currentTurnMessages = getCurrentTurnMessages(session.messages);
  const claimedMessageIds = new Set<string>();

  for (const block of canonicalBlocks) {
    const anchorMessageId = block.anchorToolCallId
      ? options.toolUseMessageIdByToolCallId.get(block.anchorToolCallId)
      : options.assistantMessageId;
    const indexedMessageId = options.messageIdByThinkingKey.get(block.key);
    let message = indexedMessageId
      ? currentTurnMessages.find((candidate) => candidate.id === indexedMessageId)
      : undefined;
    let messageId = indexedMessageId;

    if (!messageId) {
      message = currentTurnMessages.find((candidate) => {
        return candidate.type === 'assistant'
          && candidate.metadata?.isThinking === true
          && candidate.metadata?.[OpenClawThinkingMetadata.Key] === block.key
          && !claimedMessageIds.has(candidate.id);
      });
      messageId = message?.id;
    }

    if (!messageId) {
      const anchorIndex = anchorMessageId
        ? currentTurnMessages.findIndex((candidate) => candidate.id === anchorMessageId)
        : currentTurnMessages.length;
      const reusableCandidates = currentTurnMessages.filter((candidate, index) => {
        return candidate.type === 'assistant'
          && candidate.metadata?.isThinking === true
          && !candidate.metadata?.[OpenClawThinkingMetadata.Key]
          && hasReusableThinkingText(candidate.content, block.text)
          && !claimedMessageIds.has(candidate.id)
          && (anchorIndex < 0 || index < anchorIndex);
      });
      message = reusableCandidates.at(-1);
      messageId = message?.id;
    }

    const metadata: CoworkMessageMetadata = {
      ...message?.metadata,
      isThinking: true,
      isStreaming: false,
      isFinal: true,
      [OpenClawThinkingMetadata.Key]: block.key,
      ...(block.anchorToolCallId
        ? { [OpenClawThinkingMetadata.AnchorToolCallId]: block.anchorToolCallId }
        : {}),
    };

    if (messageId) {
      claimedMessageIds.add(messageId);
      options.messageIdByThinkingKey.set(block.key, messageId);
      if (!message
          || message.content !== block.text
          || message.metadata?.[OpenClawThinkingMetadata.Key] !== block.key
          || message.metadata?.isStreaming !== false
          || message.metadata?.isFinal !== true) {
        options.store.updateMessage(options.sessionId, messageId, {
          content: block.text,
          metadata,
        });
        options.emitMessageUpdate(messageId, block.text, metadata);
      }
      continue;
    }

    const messagePayload: ThinkingMessagePayload = {
      type: 'assistant',
      content: block.text,
      metadata,
    };
    const thinkingMessage = anchorMessageId
      ? options.store.insertMessageBeforeId(options.sessionId, anchorMessageId, messagePayload)
      : options.store.addMessage(options.sessionId, messagePayload);
    claimedMessageIds.add(thinkingMessage.id);
    options.messageIdByThinkingKey.set(block.key, thinkingMessage.id);

    const localAnchorIndex = anchorMessageId
      ? currentTurnMessages.findIndex((candidate) => candidate.id === anchorMessageId)
      : -1;
    if (localAnchorIndex >= 0) {
      currentTurnMessages.splice(localAnchorIndex, 0, thinkingMessage);
    } else {
      currentTurnMessages.push(thinkingMessage);
    }

    options.emitMessage(thinkingMessage, anchorMessageId);
    options.onMessageCreated?.({
      key: block.key,
      chars: block.text.length,
      beforeMessageId: anchorMessageId,
    });
  }
};
