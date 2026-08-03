import { describe, expect, test } from 'vitest';

import {
  collectBackfillableHistoryToolEntries,
  getHistoryToolCallId,
  getHistoryToolName,
  isHistoryToolResultRole,
} from './historyBackfill';

describe('subagent history backfill parsing', () => {
  test('reads common historical tool identifiers and names', () => {
    expect(getHistoryToolCallId({ tool_call_id: ' call-1 ' })).toBe('call-1');
    expect(getHistoryToolCallId({ toolUseId: 'call-2' })).toBe('call-2');
    expect(getHistoryToolName({ tool_name: ' sessions_spawn ' })).toBe('sessions_spawn');
    expect(getHistoryToolName({ name: 'sessions_yield' })).toBe('sessions_yield');
    expect(isHistoryToolResultRole('toolResult')).toBe(true);
    expect(isHistoryToolResultRole('assistant')).toBe(false);
  });

  test('reconstructs missed sessions_spawn calls after the last user message', () => {
    const entries = collectBackfillableHistoryToolEntries([
      { role: 'user', content: 'previous turn' },
      {
        role: 'assistant',
        content: [
          { type: 'toolCall', id: 'old-call', name: 'sessions_spawn', arguments: { agentId: 'old' } },
        ],
      },
      {
        role: 'toolResult',
        toolCallId: 'old-call',
        content: '{"status":"accepted","childSessionKey":"agent:old:subagent:one"}',
      },
      { role: 'user', content: 'current turn' },
      {
        role: 'assistant',
        content: [
          {
            type: 'toolCall',
            id: 'call-ts',
            name: 'sessions_spawn',
            arguments: JSON.stringify({ agentId: 'ts-engineer', task: 'implement' }),
          },
        ],
      },
      {
        role: 'toolResult',
        toolCallId: 'call-ts',
        content: '{"status":"accepted","childSessionKey":"agent:ts-engineer:subagent:two"}',
        timestamp: '2026-07-07T00:00:00.000Z',
      },
    ]);

    expect(entries).toEqual([
      expect.objectContaining({
        toolCallId: 'call-ts',
        toolName: 'sessions_spawn',
        args: { agentId: 'ts-engineer', task: 'implement' },
        resultText: '{"status":"accepted","childSessionKey":"agent:ts-engineer:subagent:two"}',
        resultTimestamp: Date.parse('2026-07-07T00:00:00.000Z'),
        resultIsError: false,
      }),
    ]);
  });

  test('infers sessions_spawn args from a standalone result payload', () => {
    const entries = collectBackfillableHistoryToolEntries([
      { role: 'user', content: 'coordinate implementation' },
      {
        role: 'toolResult',
        toolCallId: 'call-ts',
        content: '{"status":"accepted","childSessionKey":"agent:ts-engineer:subagent:two","taskName":"impl"}',
      },
    ]);

    expect(entries).toEqual([
      expect.objectContaining({
        toolCallId: 'call-ts',
        toolName: 'sessions_spawn',
        args: { agentId: 'ts-engineer', taskName: 'impl' },
      }),
    ]);
  });

  test('does not backfill orphaned sessions_spawn calls without results', () => {
    const entries = collectBackfillableHistoryToolEntries([
      { role: 'user', content: 'coordinate implementation' },
      {
        role: 'assistant',
        content: [
          { type: 'toolCall', id: 'call-finished', name: 'sessions_spawn', arguments: { agentId: 'worker' } },
          { type: 'toolCall', id: 'call-orphaned', name: 'sessions_spawn', arguments: { agentId: 'stale' } },
        ],
      },
      {
        role: 'toolResult',
        toolCallId: 'call-finished',
        content: '{"status":"accepted","childSessionKey":"agent:worker:subagent:one"}',
      },
      { role: 'assistant', content: 'All experts completed.' },
    ]);

    expect(entries.map(entry => entry.toolCallId)).toEqual(['call-finished']);
  });

  test('reconstructs ordinary tool calls after the last user message', () => {
    const entries = collectBackfillableHistoryToolEntries([
      { role: 'user', content: 'previous turn' },
      {
        role: 'assistant',
        content: [
          { type: 'toolCall', id: 'old-write', name: 'write', arguments: { path: '/tmp/old.md' } },
        ],
      },
      {
        role: 'toolResult',
        toolCallId: 'old-write',
        toolName: 'write',
        content: 'old result',
      },
      { role: 'user', content: 'current turn' },
      {
        role: 'assistant',
        content: [
          { type: 'toolCall', id: 'call-write', name: 'write', arguments: { path: '/tmp/report.md' } },
          {
            type: 'toolCall',
            id: 'call-upload',
            name: 'popiartAi__upload_agent_knowledge_file',
            arguments: { filePath: '/tmp/report.md' },
          },
        ],
      },
      {
        role: 'toolResult',
        toolCallId: 'call-write',
        toolName: 'write',
        content: 'Successfully wrote 8177 bytes to /tmp/report.md',
      },
      {
        role: 'toolResult',
        toolCallId: 'call-upload',
        toolName: 'popiartAi__upload_agent_knowledge_file',
        content: '{"ok":true}',
      },
    ]);

    expect(entries).toEqual([
      expect.objectContaining({
        toolCallId: 'call-write',
        toolName: 'write',
        args: { path: '/tmp/report.md' },
        resultText: 'Successfully wrote 8177 bytes to /tmp/report.md',
      }),
      expect.objectContaining({
        toolCallId: 'call-upload',
        toolName: 'popiartai__upload_agent_knowledge_file',
        args: { filePath: '/tmp/report.md' },
        resultText: '{"ok":true}',
      }),
    ]);
  });
});
