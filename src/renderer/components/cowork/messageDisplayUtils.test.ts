import { expect, test } from 'vitest';

import type { CoworkMessage } from '../../types/cowork';
import {
  buildConversationTurns,
  buildDisplayItems,
  getToolResultCollapsedDisplay,
  TOOL_RESULT_COLLAPSED_FULL_DISPLAY_MAX_CHARS,
  TOOL_RESULT_COLLAPSED_PREVIEW_MAX_CHARS,
} from './messageDisplayUtils';

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

test('getToolResultCollapsedDisplay summarizes small tool output by lines', () => {
  const result = getToolResultCollapsedDisplay(
    message('tool-result-1', 'tool_result', 'first\nsecond\nthird'),
  );

  expect(result).toEqual({
    hasText: true,
    text: 'first\nsecond\nthird',
    lineCount: 3,
    isLarge: false,
    sizeLabel: null,
  });
});

test('getToolResultCollapsedDisplay uses preview for large tool output', () => {
  const largeText = 'x'.repeat(TOOL_RESULT_COLLAPSED_FULL_DISPLAY_MAX_CHARS + 1);
  const result = getToolResultCollapsedDisplay(
    message('tool-result-2', 'tool_result', largeText),
  );

  expect(result.hasText).toBe(true);
  expect(result.isLarge).toBe(true);
  expect(result.text).toHaveLength(TOOL_RESULT_COLLAPSED_PREVIEW_MAX_CHARS);
  expect(result.sizeLabel).toBe('17 KB');
});
