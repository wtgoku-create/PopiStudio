import { describe, expect, test } from 'vitest';

import { parseSubagentGatewayHistoryMessages } from './historyParser';

const deterministicIds = (): (() => string) => {
  let index = 0;
  return () => `msg-${++index}`;
};

describe('subagent history parser', () => {
  test('reads assistant top-level tool calls', () => {
    const messages = parseSubagentGatewayHistoryMessages([
      {
        role: 'assistant',
        content: 'prepare workspace',
        toolCalls: [{
          id: 'call-mkdir',
          name: 'exec',
          arguments: { command: 'mkdir -p /tmp/work' },
        }],
      },
      {
        role: 'toolResult',
        toolCallId: 'call-mkdir',
        name: 'exec',
        content: 'ok',
      },
    ], { createId: deterministicIds(), startTimestamp: 1000 });

    expect(messages).toEqual([
      { id: 'msg-1', type: 'assistant', content: 'prepare workspace', timestamp: 1000 },
      {
        id: 'msg-2',
        type: 'tool_use',
        content: '',
        timestamp: 1001,
        metadata: {
          toolName: 'exec',
          toolInput: { command: 'mkdir -p /tmp/work' },
          toolUseId: 'call-mkdir',
        },
      },
      {
        id: 'msg-3',
        type: 'tool_result',
        content: 'ok',
        timestamp: 1002,
        metadata: { toolName: 'exec', toolResult: 'ok', toolUseId: 'call-mkdir' },
      },
    ]);
  });

  test('synthesizes missing exec tool use from shell error output', () => {
    const resultText = [
      'mkdir: /tmp/work: File exists',
      '+ mkdir -p /tmp/work',
      '+ ~~~~~~~~~~~~~~~~~~',
      '(Command exited with code 1)',
    ].join('\n');

    const messages = parseSubagentGatewayHistoryMessages([
      {
        role: 'toolResult',
        toolCallId: 'call-mkdir',
        name: 'exec',
        content: resultText,
      },
    ], { createId: deterministicIds(), startTimestamp: 1000 });

    expect(messages).toEqual([
      {
        id: 'msg-2',
        type: 'tool_use',
        content: '',
        timestamp: 1000,
        metadata: {
          toolName: 'exec',
          toolInput: { command: 'mkdir -p /tmp/work' },
          toolUseId: 'call-mkdir',
          inferredFromResult: true,
        },
      },
      {
        id: 'msg-1',
        type: 'tool_result',
        content: resultText,
        timestamp: 1000,
        metadata: {
          toolName: 'exec',
          toolResult: resultText,
          toolUseId: 'call-mkdir',
        },
      },
    ]);
  });
});
