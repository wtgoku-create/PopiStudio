import { expect, test } from 'vitest';

import type { CoworkMessage } from '../../types/cowork';
import { buildConversationTurns, buildDisplayItems } from './messageDisplayUtils';

const message = (
  id: string,
  type: CoworkMessage['type'],
  content: string,
  metadata: CoworkMessage['metadata'] = {},
): CoworkMessage => ({
  id,
  type,
  content,
  metadata,
  timestamp: 1,
});

test('buildConversationTurns preserves persisted thinking insertion order', () => {
  const messages: CoworkMessage[] = [
    message('user-1', 'user', 'start'),
    message('thinking-1', 'assistant', 'reasoning', { isThinking: true }),
    message('assistant-1', 'assistant', 'visible answer'),
    message('tool-1', 'tool_use', 'Using tool', { toolUseId: 'call-1' }),
  ];

  const turns = buildConversationTurns(buildDisplayItems(messages));

  expect(turns).toHaveLength(1);
  expect(turns[0].assistantItems.map(item => (
    item.type === 'assistant' ? item.message.id : item.type
  ))).toEqual(['thinking-1', 'assistant-1', 'tool_group']);
});
