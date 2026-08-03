import { expect, test, vi } from 'vitest';

import { SubagentSessionMaterializer } from './sessionMaterializer';

test('materializes an already completed child session as completed', () => {
  const upsertSubagentChildSession = vi.fn((session) => session);
  const materializer = new SubagentSessionMaterializer({
    store: {
      getSession: vi.fn(() => null),
      updateSession: vi.fn(),
      upsertSubagentChildSession,
    },
    rememberSessionKey: vi.fn(),
    markSessionHistoryUnsynced: vi.fn(),
    notifySessionsChanged: vi.fn(),
    emitSessionStatus: vi.fn(),
    emitComplete: vi.fn(),
    emitError: vi.fn(),
    resolveSessionIdBySessionKey: vi.fn(() => null),
    syncSessionHistory: vi.fn(async () => {}),
  });

  materializer.materialize({
    runId: 'run-1',
    childCoworkSessionId: 'child-1',
    parentSessionId: 'parent-1',
    childSessionKey: 'agent:main:subagent:run-1',
    agentId: 'worker',
    task: 'inspect files',
    label: 'Worker',
    status: 'done',
    createdAt: 1,
  });

  expect(upsertSubagentChildSession).toHaveBeenCalledWith(expect.objectContaining({
    id: 'child-1',
    status: 'completed',
  }));
});
