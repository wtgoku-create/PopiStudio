import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { store } from '../store';
import { setCurrentSession } from '../store/slices/coworkSlice';
import { type CoworkSession,CoworkSessionStatusValue } from '../types/cowork';
import { coworkService } from './cowork';

const makeSession = (): CoworkSession => ({
  id: 'session-1',
  title: 'Session 1',
  claudeSessionId: null,
  status: CoworkSessionStatusValue.Running,
  pinned: false,
  pinOrder: null,
  cwd: '/tmp',
  systemPrompt: '',
  modelOverride: '',
  executionMode: 'local',
  activeSkillIds: [],
  agentId: 'agent-1',
  messages: [],
  messagesOffset: 0,
  totalMessages: 0,
  createdAt: 1,
  updatedAt: 1,
});

beforeEach(() => {
  store.dispatch(setCurrentSession(null));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('coworkService.clearSession', () => {
  test('clears the current session', () => {
    store.dispatch(setCurrentSession(makeSession()));

    coworkService.clearSession();

    expect(store.getState().cowork.currentSession).toBeNull();
  });

  test('does not restore a session whose load finishes after clearing', async () => {
    let resolveGetSession: ((value: { success: true; session: CoworkSession }) => void) | undefined;
    const getSession = vi.fn(() => new Promise<{ success: true; session: CoworkSession }>((resolve) => {
      resolveGetSession = resolve;
    }));
    const remoteManaged = vi.fn(async () => ({ remoteManaged: true }));
    vi.stubGlobal('window', {
      electron: {
        cowork: {
          getSession,
          remoteManaged,
        },
      },
    });

    const pendingLoad = coworkService.loadSession('session-1');
    coworkService.clearSession();
    resolveGetSession?.({ success: true, session: makeSession() });
    await pendingLoad;

    expect(store.getState().cowork.currentSession).toBeNull();
    expect(store.getState().cowork.remoteManaged).toBe(false);
    expect(remoteManaged).not.toHaveBeenCalled();
  });
});
