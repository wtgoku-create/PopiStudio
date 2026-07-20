import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import type { SubagentRun } from '../../subagentRunStore';
import { type GatewayClientLike, SubagentTracker } from './subagentTracker';

const createStores = () => {
  const runs = new Map<string, SubagentRun & { messagesPersisted?: boolean }>();
  const messages = new Map<string, unknown[]>();
  const runStore = {
    insertSubagentRun: vi.fn((run: Omit<SubagentRun, 'endedAt'>) => {
      runs.set(run.id, { ...run, endedAt: null });
    }),
    updateSubagentRunStatus: vi.fn((id: string, status: SubagentRun['status'], endedAt?: number) => {
      const run = runs.get(id);
      if (run) {
        run.status = status;
        if (endedAt != null) run.endedAt = endedAt;
      }
    }),
    updateSubagentRunSessionKey: vi.fn((id: string, sessionKey: string) => {
      const run = runs.get(id);
      if (run) run.sessionKey = sessionKey;
    }),
    listSubagentRuns: vi.fn((parentSessionId: string) =>
      Array.from(runs.values()).filter((run) => run.parentSessionId === parentSessionId),
    ),
    getSubagentRun: vi.fn((id: string) => runs.get(id) ?? null),
    markMessagesPersisted: vi.fn((id: string) => {
      const run = runs.get(id);
      if (run) run.messagesPersisted = true;
    }),
    isMessagesPersisted: vi.fn((id: string) => runs.get(id)?.messagesPersisted === true),
    getRunStatus: vi.fn((id: string) => runs.get(id)?.status ?? null),
    clearChildSessionReference: vi.fn(),
    deleteSubagentRunsByParent: vi.fn((parentSessionId: string) => {
      for (const run of Array.from(runs.values())) {
        if (run.parentSessionId === parentSessionId) runs.delete(run.id);
      }
    }),
    deleteSubagentRun: vi.fn((id: string) => {
      runs.delete(id);
    }),
  };
  const messageStore = {
    insertMessages: vi.fn((runId: string, rows: unknown[]) => {
      messages.set(runId, rows);
    }),
    getMessages: vi.fn((runId: string) => messages.get(runId) ?? []),
    hasMessages: vi.fn((runId: string) => (messages.get(runId)?.length ?? 0) > 0),
    deleteByRunIds: vi.fn((runIds: string[]) => {
      for (const runId of runIds) messages.delete(runId);
    }),
    deleteByParentSession: vi.fn((parentSessionId: string) => {
      for (const run of runs.values()) {
        if (run.parentSessionId === parentSessionId) messages.delete(run.id);
      }
    }),
  };

  return { runs, messages, runStore, messageStore };
};

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test('deleteSubagentRun removes a single run, messages, and gateway transcript', async () => {
  const { runs, messages, runStore, messageStore } = createStores();
  const gatewayClient: GatewayClientLike = {
    request: vi.fn().mockResolvedValue({}),
  };
  const tracker = new SubagentTracker(runStore as never, messageStore as never, () => gatewayClient);

  runs.set('run-1', {
    id: 'run-1',
    parentSessionId: 'parent-1',
    sessionKey: 'agent:main:subagent:run-1',
    agentId: 'worker',
    task: 'inspect files',
    label: 'worker',
    status: 'done',
    createdAt: 1000,
    endedAt: null,
  });
  messages.set('run-1', [{ id: 'message-1' }]);

  const deleted = await tracker.deleteSubagentRun('parent-1', 'run-1');

  expect(deleted).toBe(true);
  expect(runStore.getSubagentRun('run-1')).toBeNull();
  expect(messageStore.hasMessages('run-1')).toBe(false);
  expect(gatewayClient.request).toHaveBeenCalledWith(
    'sessions.delete',
    { key: 'agent:main:subagent:run-1', deleteTranscript: true },
    { timeoutMs: 5_000 },
  );
});

test('deleteSubagentRun returns after local deletion without waiting for gateway cleanup', async () => {
  const { runs, runStore, messageStore } = createStores();
  let resolveGatewayDelete: (() => void) | null = null;
  const gatewayDeletePromise = new Promise<void>((resolve) => {
    resolveGatewayDelete = resolve;
  });
  const gatewayClient: GatewayClientLike = {
    request: vi.fn().mockReturnValue(gatewayDeletePromise),
  };
  const tracker = new SubagentTracker(runStore as never, messageStore as never, () => gatewayClient);
  runs.set('run-1', {
    id: 'run-1',
    parentSessionId: 'parent-1',
    sessionKey: 'agent:main:subagent:run-1',
    agentId: 'worker',
    task: 'inspect files',
    label: 'worker',
    status: 'done',
    createdAt: 1000,
    endedAt: null,
  });

  const deleted = await tracker.deleteSubagentRun('parent-1', 'run-1');

  expect(deleted).toBe(true);
  expect(runStore.getSubagentRun('run-1')).toBeNull();
  expect(gatewayClient.request).toHaveBeenCalledTimes(1);

  resolveGatewayDelete?.();
});

test('gateway cleanup retries are capped when delete keeps failing', async () => {
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const { runs, runStore, messageStore } = createStores();
  const gatewayClient: GatewayClientLike = {
    request: vi.fn().mockRejectedValue(new Error('gateway busy')),
  };
  const tracker = new SubagentTracker(runStore as never, messageStore as never, () => gatewayClient);
  runs.set('run-1', {
    id: 'run-1',
    parentSessionId: 'parent-1',
    sessionKey: 'agent:main:subagent:run-1',
    agentId: 'worker',
    task: 'inspect files',
    label: 'worker',
    status: 'done',
    createdAt: 1000,
    endedAt: null,
  });

  const deleted = await tracker.deleteSubagentRun('parent-1', 'run-1');

  expect(deleted).toBe(true);
  expect(gatewayClient.request).toHaveBeenCalledTimes(1);

  await vi.advanceTimersByTimeAsync(5_000);
  expect(gatewayClient.request).toHaveBeenCalledTimes(2);

  await vi.advanceTimersByTimeAsync(10_000);
  expect(gatewayClient.request).toHaveBeenCalledTimes(3);

  await vi.advanceTimersByTimeAsync(20_000);
  expect(gatewayClient.request).toHaveBeenCalledTimes(3);
});

test('deleteSubagentRun refuses to delete a run from another parent session', async () => {
  const { runs, runStore, messageStore } = createStores();
  const tracker = new SubagentTracker(runStore as never, messageStore as never, () => null);
  runs.set('run-1', {
    id: 'run-1',
    parentSessionId: 'parent-1',
    sessionKey: null,
    agentId: 'worker',
    task: 'inspect files',
    label: 'worker',
    status: 'done',
    createdAt: 1000,
    endedAt: null,
  });

  const deleted = await tracker.deleteSubagentRun('parent-2', 'run-1');

  expect(deleted).toBe(false);
  expect(runStore.getSubagentRun('run-1')).not.toBeNull();
});

test('onSessionDeleted removes subagent runs and messages for the parent session', () => {
  const { runs, messages, runStore, messageStore } = createStores();
  const tracker = new SubagentTracker(runStore as never, messageStore as never, () => null);
  runs.set('run-1', {
    id: 'run-1',
    parentSessionId: 'parent-1',
    sessionKey: null,
    agentId: 'worker',
    task: 'inspect files',
    label: 'worker',
    status: 'done',
    createdAt: 1000,
    endedAt: null,
  });
  runs.set('run-2', {
    id: 'run-2',
    parentSessionId: 'parent-2',
    sessionKey: null,
    agentId: 'worker',
    task: 'inspect files',
    label: 'worker',
    status: 'done',
    createdAt: 1000,
    endedAt: null,
  });
  messages.set('run-1', [{ id: 'message-1' }]);

  tracker.onSessionDeleted('parent-1');

  expect(runStore.getSubagentRun('run-1')).toBeNull();
  expect(messageStore.hasMessages('run-1')).toBe(false);
  expect(runStore.getSubagentRun('run-2')).not.toBeNull();
});

test('onSessionDeleted keeps in-memory tracking for other parent sessions', () => {
  const { runStore, messageStore } = createStores();
  const tracker = new SubagentTracker(runStore as never, messageStore as never, () => null);

  tracker.onToolStart('run-1', {
    agentId: 'worker-a',
    task: 'inspect first session',
    label: 'Worker A',
  }, 'parent-1');
  tracker.onSpawnResult('run-1', JSON.stringify({
    status: 'accepted',
    childSessionKey: 'agent:main:subagent:run-1',
  }), {});

  tracker.onToolStart('run-2', {
    agentId: 'worker-b',
    task: 'inspect second session',
    label: 'Worker B',
  }, 'parent-2');
  tracker.onSpawnResult('run-2', JSON.stringify({
    status: 'accepted',
    childSessionKey: 'agent:main:subagent:run-2',
  }), {});

  tracker.onSessionDeleted('parent-1');

  expect(tracker.listRunningChildSessionKeys('parent-1')).toEqual([]);
  expect(tracker.listRunningChildSessionKeys('parent-2')).toEqual(['agent:main:subagent:run-2']);
  expect(runStore.clearChildSessionReference).toHaveBeenCalledWith('parent-1');
});

test('spawn result stores display label from taskName when label is missing', () => {
  const { runStore, messageStore } = createStores();
  const tracker = new SubagentTracker(runStore as never, messageStore as never, () => null);

  tracker.onToolStart('run-1', {
    agentId: 'worker',
    taskName: 'Image Style Analyzer',
    task: 'inspect image style',
  }, 'parent-1');
  tracker.onSpawnResult('run-1', JSON.stringify({
    status: 'accepted',
    childSessionKey: 'agent:main:subagent:run-1',
  }), {});

  expect(runStore.getSubagentRun('run-1')?.label).toBe('Image Style Analyzer');
});

test('deleted subagent run is not reinserted by late spawn results', async () => {
  const { runStore, messageStore } = createStores();
  const tracker = new SubagentTracker(runStore as never, messageStore as never, () => null);
  tracker.onToolStart('run-1', {
    agentId: 'worker',
    task: 'inspect files',
    label: 'worker',
  }, 'parent-1');
  tracker.onSpawnResult('run-1', JSON.stringify({
    childSessionKey: 'agent:main:subagent:run-1',
    status: 'running',
  }), {});

  const deleted = await tracker.deleteSubagentRun('parent-1', 'run-1');
  tracker.onSpawnResult('run-1', JSON.stringify({
    childSessionKey: 'agent:main:subagent:run-1',
    status: 'running',
  }), {});

  expect(deleted).toBe(true);
  expect(runStore.getSubagentRun('run-1')).toBeNull();
});
