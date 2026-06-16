import { expect, test } from 'vitest';

import { CoworkSystemMessageKind } from '../../../common/coworkSystemMessages';
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

test('buildConversationTurns displays thinking before other assistant items in the same turn', () => {
  const messages: CoworkMessage[] = [
    message('user-1', 'user', 'start'),
    message('assistant-1', 'assistant', 'visible answer'),
    message('tool-1', 'tool_use', 'Using tool', { toolUseId: 'call-1' }),
    message('thinking-1', 'assistant', 'reasoning', { isThinking: true }),
  ];

  const turns = buildConversationTurns(buildDisplayItems(messages));

  expect(turns).toHaveLength(1);
  expect(turns[0].assistantItems.map(item => (
    item.type === 'assistant' ? item.message.id : item.type
  ))).toEqual(['thinking-1', 'assistant-1', 'tool_group']);
});

test('buildConversationTurns keeps subagent lifecycle system messages in assistant items', () => {
  const messages: CoworkMessage[] = [
    message('user-1', 'user', '帮我做个视频落地页'),
    message('system-1', 'system', '视频 Agent 已接手任务。', {
      kind: CoworkSystemMessageKind.SubagentLifecycle,
      subagentRunId: 'run-1',
      subagentStatus: 'spawned',
      agentName: '视频 Agent',
      task: '生成一版产品视频',
    }),
  ];

  const turns = buildConversationTurns(buildDisplayItems(messages));

  expect(turns).toHaveLength(1);
  expect(turns[0].assistantItems).toHaveLength(1);
  expect(turns[0].assistantItems[0].type).toBe('system');
  if (turns[0].assistantItems[0].type === 'system') {
    expect(turns[0].assistantItems[0].message.metadata?.kind).toBe(CoworkSystemMessageKind.SubagentLifecycle);
  }
});

test('buildConversationTurns dedupes subagent lifecycle messages by run id and keeps the latest status', () => {
  const messages: CoworkMessage[] = [
    message('user-1', 'user', '帮我做个视频落地页'),
    message('system-1', 'system', '视频 Agent 已接手任务。', {
      kind: CoworkSystemMessageKind.SubagentLifecycle,
      subagentRunId: 'run-1',
      subagentStatus: 'spawned',
      agentName: '视频 Agent',
      task: '生成一版产品视频',
    }),
    message('system-2', 'system', '视频 Agent 开始执行：生成一版产品视频', {
      kind: CoworkSystemMessageKind.SubagentLifecycle,
      subagentRunId: 'run-1',
      subagentStatus: 'running',
      agentName: '视频 Agent',
      task: '生成一版产品视频',
    }),
    message('system-3', 'system', '法务 Agent 已接手任务。', {
      kind: CoworkSystemMessageKind.SubagentLifecycle,
      subagentRunId: 'run-2',
      subagentStatus: 'spawned',
      agentName: '法务 Agent',
      task: '检查文案风险',
    }),
  ];

  const turns = buildConversationTurns(buildDisplayItems(messages));

  expect(turns).toHaveLength(1);
  expect(turns[0].assistantItems).toHaveLength(2);
  const systemItems = turns[0].assistantItems.filter((item) => item.type === 'system');
  expect(systemItems).toHaveLength(2);
  if (systemItems[0]?.type === 'system' && systemItems[1]?.type === 'system') {
    expect(systemItems.map((item) => item.message.metadata?.subagentRunId)).toEqual(['run-1', 'run-2']);
    expect(systemItems[0].message.metadata?.subagentStatus).toBe('running');
  }
});
