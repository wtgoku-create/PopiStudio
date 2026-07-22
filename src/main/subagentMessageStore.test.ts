import { expect, test, vi } from 'vitest';

import { SubagentMessageStore } from './subagentMessageStore';

test('getMessages maps sqlite timestamp columns to camelCase fields', () => {
  const all = vi.fn().mockReturnValue([{
    id: 'message-1',
    runId: 'run-1',
    type: 'assistant',
    content: 'hello',
    metadata: null,
    createdAt: 12345,
    sequence: 1,
  }]);
  const prepare = vi.fn().mockReturnValue({ all });
  const store = new SubagentMessageStore({ prepare } as never);

  expect(store.getMessages('run-1')).toEqual([{
    id: 'message-1',
    runId: 'run-1',
    type: 'assistant',
    content: 'hello',
    metadata: null,
    createdAt: 12345,
    sequence: 1,
  }]);
  expect(prepare.mock.calls[0][0]).toContain('created_at AS createdAt');
  expect(prepare.mock.calls[0][0]).toContain('run_id AS runId');
  expect(all).toHaveBeenCalledWith('run-1');
});
