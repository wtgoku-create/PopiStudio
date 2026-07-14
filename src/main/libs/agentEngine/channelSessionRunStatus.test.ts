import { describe, expect, test } from 'vitest';

import { resolveChannelSessionNextStatus } from './channelSessionRunStatus';

describe('resolveChannelSessionNextStatus', () => {
  test('live run tracker wins over any raw status', () => {
    expect(
      resolveChannelSessionNextStatus({
        hasActiveRun: true,
        rawStatus: 'failed',
        currentStatus: 'idle',
      }),
    ).toBe('running');
  });

  test('raw running status marks the session running even when active run flag is false', () => {
    expect(
      resolveChannelSessionNextStatus({
        hasActiveRun: false,
        rawStatus: 'running',
        currentStatus: 'running',
      }),
    ).toBe('running');
    expect(
      resolveChannelSessionNextStatus({
        hasActiveRun: false,
        rawStatus: 'processing',
        currentStatus: 'idle',
      }),
    ).toBe('running');
  });

  test('run end reverts a locally running session to completed', () => {
    expect(
      resolveChannelSessionNextStatus({
        hasActiveRun: false,
        rawStatus: '',
        currentStatus: 'running',
      }),
    ).toBe('completed');
    expect(
      resolveChannelSessionNextStatus({
        hasActiveRun: false,
        rawStatus: '',
        currentStatus: 'idle',
      }),
    ).toBe(null);
  });

  test('terminal raw statuses map to error or completed', () => {
    for (const rawStatus of ['failed', 'killed', 'timeout', 'error']) {
      expect(
        resolveChannelSessionNextStatus({
          hasActiveRun: false,
          rawStatus,
          currentStatus: 'running',
        }),
      ).toBe('error');
    }
    expect(
      resolveChannelSessionNextStatus({
        hasActiveRun: false,
        rawStatus: 'done',
        currentStatus: 'running',
      }),
    ).toBe('completed');
  });

  test('falls back to the raw status when the live run flag is unavailable', () => {
    expect(
      resolveChannelSessionNextStatus({
        hasActiveRun: null,
        rawStatus: 'running',
        currentStatus: 'idle',
      }),
    ).toBe('running');
    expect(
      resolveChannelSessionNextStatus({
        hasActiveRun: null,
        rawStatus: 'processing',
        currentStatus: 'completed',
      }),
    ).toBe('running');
    expect(
      resolveChannelSessionNextStatus({
        hasActiveRun: null,
        rawStatus: '',
        currentStatus: 'running',
      }),
    ).toBe(null);
  });
});
