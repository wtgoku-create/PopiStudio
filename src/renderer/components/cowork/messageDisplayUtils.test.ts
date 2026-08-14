import { expect, test } from 'vitest';

import type { CoworkMessage } from '../../types/cowork';
import {
  buildConversationTurns,
  buildDisplayItems,
  chunkConsolidatedItemsForDisplay,
  getToolResultCollapsedDisplay,
  isActivityConsolidatedItem,
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

test('activity grouping uses the new presentation for a single tool or thinking item', () => {
  const toolItems = buildConversationTurns(buildDisplayItems([
    message('user-1', 'user', 'start'),
    message('tool-1', 'tool_use', 'Using tool', { toolName: 'sessions_yield', toolUseId: 'call-1' }),
  ]))[0].assistantItems;
  const thinkingItems = buildConversationTurns(buildDisplayItems([
    message('user-2', 'user', 'start'),
    message('thinking-1', 'assistant', 'reasoning', { isThinking: true }),
  ]))[0].assistantItems;

  expect(chunkConsolidatedItemsForDisplay(toolItems, isActivityConsolidatedItem)).toEqual([
    { kind: 'activity_group', entries: [{ item: toolItems[0], index: 0 }] },
  ]);
  expect(chunkConsolidatedItemsForDisplay(thinkingItems, isActivityConsolidatedItem)).toEqual([
    { kind: 'activity_group', entries: [{ item: thinkingItems[0], index: 0 }] },
  ]);
});

test('buildDisplayItems pairs a tool result that was persisted before its tool use', () => {
  const result = message('tool-result-1', 'tool_result', 'accepted', { toolUseId: 'call-1' });
  const toolUse = message('tool-use-1', 'tool_use', 'Using sessions_spawn', {
    toolName: 'sessions_spawn',
    toolUseId: 'call-1',
  });

  const items = buildDisplayItems([result, toolUse]);

  expect(items).toEqual([expect.objectContaining({
    type: 'tool_group',
    toolUse,
    toolResult: result,
  })]);
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
