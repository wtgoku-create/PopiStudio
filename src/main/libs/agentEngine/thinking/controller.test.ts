import { expect, test, vi } from 'vitest';

import type { CoworkMessage } from '../../../coworkStore';
import {
  createOpenClawThinkingTurnState,
  OpenClawThinkingController,
  type OpenClawThinkingTurnContext,
} from './controller';

const createMessage = (
  id: string,
  type: CoworkMessage['type'],
  content: string,
  metadata: CoworkMessage['metadata'] = {},
): CoworkMessage => ({
  id,
  type,
  content,
  metadata,
  timestamp: Number(id.replace(/\D/g, '')) || 1,
});

const createStore = (initialMessages: CoworkMessage[]) => {
  const messages = [...initialMessages];
  let nextId = messages.length + 1;
  const store = {
    addMessage: vi.fn((_sessionId: string, payload: Omit<CoworkMessage, 'id' | 'timestamp'>) => {
      const message = createMessage(`msg-${nextId++}`, payload.type, payload.content, payload.metadata);
      messages.push(message);
      return message;
    }),
    insertMessageBeforeId: vi.fn((
      _sessionId: string,
      beforeMessageId: string,
      payload: Omit<CoworkMessage, 'id' | 'timestamp'>,
    ) => {
      const message = createMessage(`msg-${nextId++}`, payload.type, payload.content, payload.metadata);
      const index = messages.findIndex((candidate) => candidate.id === beforeMessageId);
      messages.splice(index < 0 ? messages.length : index, 0, message);
      return message;
    }),
    updateMessage: vi.fn((
      _sessionId: string,
      messageId: string,
      updates: { content?: string; metadata?: CoworkMessage['metadata'] },
    ) => {
      const message = messages.find((candidate) => candidate.id === messageId);
      if (message) Object.assign(message, updates);
    }),
    getSession: vi.fn(() => ({ messages })),
  };
  return { messages, store };
};

const createController = (store: ReturnType<typeof createStore>['store']) => {
  return new OpenClawThinkingController({
    store,
    emitMessage: vi.fn(),
    emitMessageUpdate: vi.fn(),
    throttledStoreUpdate: vi.fn((sessionId, messageId, content, metadata) => {
      store.updateMessage(sessionId, messageId, { content, metadata });
    }),
    throttledEmitMessageUpdate: vi.fn(),
    flushPendingStoreUpdate: vi.fn(),
    clearPendingMessageUpdate: vi.fn(),
  });
};

test('thinking stream creates and updates a provisional message', () => {
  const { messages, store } = createStore([
    createMessage('msg-1', 'user', 'inspect'),
  ]);
  const controller = createController(store);
  const turn: OpenClawThinkingTurnContext = {
    toolUseMessageIdByToolCallId: new Map(),
    thinking: createOpenClawThinkingTurnState(),
  };

  controller.handleStream('session-1', turn, { text: 'Inspect the source.' });
  controller.handleStream('session-1', turn, { delta: ' Run tests.' });

  expect(messages.filter((message) => message.metadata?.isThinking)).toHaveLength(1);
  expect(messages[1]).toMatchObject({
    content: 'Inspect the source. Run tests.',
    metadata: { isThinking: true, isStreaming: true, isFinal: false },
  });
});

test('finalizeBeforeTool finalizes a stream message and indexes it by tool key', () => {
  const { messages, store } = createStore([
    createMessage('msg-1', 'user', 'inspect'),
  ]);
  const controller = createController(store);
  const turn: OpenClawThinkingTurnContext = {
    toolUseMessageIdByToolCallId: new Map(),
    thinking: createOpenClawThinkingTurnState(),
  };

  controller.handleStream('session-1', turn, { text: 'Inspect the source.' });
  const messageId = turn.thinking.messageId;
  controller.finalizeBeforeTool('session-1', turn, 'call-read');

  expect(turn.thinking.messageIdByKey.get('tool:call-read:thinking:0')).toBe(messageId);
  expect(messages[1].metadata).toMatchObject({
    isThinking: true,
    isStreaming: false,
    isFinal: true,
  });
});

test('reconcile reuses a finalized stream message before a tool', () => {
  const { messages, store } = createStore([
    createMessage('msg-1', 'user', 'inspect'),
  ]);
  const controller = createController(store);
  const turn: OpenClawThinkingTurnContext = {
    toolUseMessageIdByToolCallId: new Map(),
    thinking: createOpenClawThinkingTurnState(),
  };

  controller.handleStream('session-1', turn, { text: 'Inspect the source.' });
  controller.finalizeBeforeTool('session-1', turn, 'call-read');
  const toolMessage = createMessage('msg-3', 'tool_use', 'Using tool: read', { toolUseId: 'call-read' });
  messages.push(toolMessage);
  turn.toolUseMessageIdByToolCallId.set('call-read', toolMessage.id);

  controller.reconcile('session-1', turn, [
    { role: 'user', content: 'inspect' },
    {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'Inspect the source.' },
        { type: 'toolCall', id: 'call-read', name: 'read' },
      ],
    },
  ], false);

  expect(messages.filter((message) => message.metadata?.isThinking)).toHaveLength(1);
  expect(messages[1].metadata).toMatchObject({
    openclawThinkingAnchorToolCallId: 'call-read',
    openclawThinkingKey: 'tool:call-read:thinking:0',
  });
});
