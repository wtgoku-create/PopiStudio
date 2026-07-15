import { expect, test, vi } from 'vitest';

import { OpenClawTurnHistorySync } from './openclawTurnHistorySync';

test('debounces thinking history requests and drops stale turns', async () => {
  vi.useFakeTimers();
  try {
    let turn = { sessionKey: 'agent:main:popiai:session-1', turnToken: 1 };
    const requestHistory = vi.fn(async () => {
      turn = { ...turn, turnToken: 2 };
      return [{ role: 'assistant' }];
    });
    const handleThinkingHistory = vi.fn();
    const sync = new OpenClawTurnHistorySync({
      getTurn: () => turn,
      requestHistory,
      handleThinkingHistory,
      handleBackfillHistory: vi.fn(),
    });

    sync.scheduleThinking('session-1', 'call-a');
    sync.scheduleThinking('session-1', 'call-b');

    await vi.advanceTimersByTimeAsync(250);

    expect(requestHistory).toHaveBeenCalledWith('agent:main:popiai:session-1', 11);
    expect(handleThinkingHistory).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

test('retries tool result backfill after a failed history request', async () => {
  vi.useFakeTimers();
  try {
    const turn = { sessionKey: 'agent:main:popiai:session-1', turnToken: 1 };
    const requestHistory = vi.fn()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce([{ role: 'toolResult', toolCallId: 'call-a', content: 'done' }]);
    const handleBackfillHistory = vi.fn();
    const sync = new OpenClawTurnHistorySync({
      getTurn: () => turn,
      requestHistory,
      handleThinkingHistory: vi.fn(),
      handleBackfillHistory,
    });

    sync.scheduleToolResultBackfill('session-1', 'call-a');
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.advanceTimersByTimeAsync(2_000);

    expect(requestHistory).toHaveBeenCalledTimes(2);
    expect(handleBackfillHistory).toHaveBeenCalledWith(
      'session-1',
      [{ role: 'toolResult', toolCallId: 'call-a', content: 'done' }],
    );
  } finally {
    vi.useRealTimers();
  }
});

test('clearSession cancels pending history work', async () => {
  vi.useFakeTimers();
  try {
    const requestHistory = vi.fn(async () => []);
    const sync = new OpenClawTurnHistorySync({
      getTurn: () => ({ sessionKey: 'agent:main:popiai:session-1', turnToken: 1 }),
      requestHistory,
      handleThinkingHistory: vi.fn(),
      handleBackfillHistory: vi.fn(),
    });

    sync.scheduleThinking('session-1', 'call-a');
    sync.scheduleToolResultBackfill('session-1', 'call-a');
    sync.clearSession('session-1');

    await vi.advanceTimersByTimeAsync(2_000);

    expect(requestHistory).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});
