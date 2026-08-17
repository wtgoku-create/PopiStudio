import { expect, test } from 'vitest';

import { CoworkSessionStatusValue } from '../../types/cowork';
import coworkReducer, {
  addMessage,
  addSession,
  deleteSession,
  setConfig,
  setCurrentSession,
  setCurrentSessionId,
  setMessageWindow,
  setSessions,
  updateCurrentSessionModelOverride,
  updateCurrentSessionModelSettings,
  updateSessionStatus,
  updateSessionTitle,
  upsertSessionSummary,
} from './coworkSlice';

const makeSession = (overrides: Partial<Parameters<typeof addSession>[0]> = {}) => ({
  id: 'session-1',
  title: 'Test Session',
  claudeSessionId: null,
  status: CoworkSessionStatusValue.Completed,
  pinned: false,
  cwd: '/tmp',
  systemPrompt: '',
  modelOverride: '',
  executionMode: 'local' as const,
  activeSkillIds: [],
  agentId: 'main',
  messages: [],
  messagesOffset: 0,
  totalMessages: 0,
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

test('defaults hidden OpenClaw session policy to thirty days', () => {
  const state = coworkReducer(undefined, { type: 'init' });

  expect(state.config.openClawSessionPolicy).toEqual({
    keepAlive: '30d',
  });
  expect(state.config.skipMissedJobs).toBe(true);
});

test('setConfig preserves loaded OpenClaw session policy', () => {
  const state = coworkReducer(undefined, setConfig({
    workingDirectory: '/tmp',
    systemPrompt: '',
    executionMode: 'local',
    agentEngine: 'openclaw',
    memoryEnabled: true,
    memoryImplicitUpdateEnabled: true,
    memoryLlmJudgeEnabled: false,
    memoryGuardLevel: 'strict',
    memoryUserMemoriesMaxItems: 12,
    skipMissedJobs: false,
    embeddingEnabled: false,
    embeddingProvider: 'openai',
    embeddingModel: '',
    embeddingLocalModelPath: '',
    embeddingVectorWeight: 0.7,
    embeddingRemoteBaseUrl: '',
    embeddingRemoteApiKey: '',
    dreamingEnabled: false,
    dreamingFrequency: '0 3 * * *',
    dreamingModel: '',
    dreamingTimezone: '',
    openClawSessionPolicy: {
      keepAlive: '365d',
    },
  }));

  expect(state.config.openClawSessionPolicy.keepAlive).toBe('365d');
});

test('updateCurrentSessionModelOverride only patches the active session', () => {
  const session = makeSession({ modelOverride: 'openai/gpt-5.4' });

  const activeState = coworkReducer(
    coworkReducer(undefined, addSession(session)),
    updateCurrentSessionModelOverride({
      sessionId: 'session-1',
      modelOverride: 'popiai-server/qwen3.6-plus-YoudaoInner',
    }),
  );

  expect(activeState.currentSession?.modelOverride).toBe('popiai-server/qwen3.6-plus-YoudaoInner');
  expect(activeState.currentSession?.updatedAt).toBe(1);

  const ignoredState = coworkReducer(
    activeState,
    updateCurrentSessionModelOverride({
      sessionId: 'session-2',
      modelOverride: 'moonshot/kimi-k2.6',
    }),
  );

  expect(ignoredState.currentSession?.modelOverride).toBe('popiai-server/qwen3.6-plus-YoudaoInner');
});

test('updateCurrentSessionModelSettings preserves the session list and messages', () => {
  const session = makeSession({
    modelOverride: 'openai/gpt-5.4',
    thinkingLevel: 'medium',
    messages: [{ id: 'message-1', type: 'user', content: 'Keep me', timestamp: 2 }],
  });
  const state = coworkReducer(coworkReducer(undefined, addSession(session)), updateCurrentSessionModelSettings({
    sessionId: 'session-1',
    modelOverride: 'popiai-server/kimi-k2.6',
    thinkingLevel: 'off',
  }));

  expect(state.sessions[0].updatedAt).toBe(1);
  expect(state.sessions[0].lastMessagePreview).toBe('Keep me');
  expect(state.currentSession?.modelOverride).toBe('popiai-server/kimi-k2.6');
  expect(state.currentSession?.thinkingLevel).toBe('off');
  expect(state.currentSession?.messages).toHaveLength(1);
});

test('updateSessionTitle preserves the session updated time', () => {
  const session = makeSession({ updatedAt: 1000 });
  const state = coworkReducer(
    coworkReducer(undefined, addSession(session)),
    updateSessionTitle({
      sessionId: 'session-1',
      title: 'Renamed task',
    }),
  );

  expect(state.sessions[0].title).toBe('Renamed task');
  expect(state.sessions[0].updatedAt).toBe(1000);
  expect(state.currentSession?.title).toBe('Renamed task');
  expect(state.currentSession?.updatedAt).toBe(1000);
});

test('addSession preserves the agent id in session summaries', () => {
  const state = coworkReducer(undefined, addSession(makeSession({
    id: 'session-agent-2',
    agentId: 'agent-2',
  })));

  expect(state.sessions[0].agentId).toBe('agent-2');
});

test('setCurrentSession preserves the agent id when inserting a summary', () => {
  const state = coworkReducer(undefined, setCurrentSession(makeSession({
    id: 'session-agent-3',
    agentId: 'agent-3',
  })));

  expect(state.sessions[0].agentId).toBe('agent-3');
});

test('setCurrentSession stores the latest user or assistant message preview', () => {
  const state = coworkReducer(undefined, setCurrentSession(makeSession({
    id: 'session-preview',
    messages: [
      {
        id: 'msg-user',
        type: 'user',
        content: 'question',
        timestamp: 1,
      },
      {
        id: 'msg-thinking',
        type: 'assistant',
        content: 'internal reasoning',
        timestamp: 2,
        metadata: { isThinking: true },
      },
      {
        id: 'msg-tool',
        type: 'tool_result',
        content: 'tool output',
        timestamp: 3,
      },
    ],
  })));

  expect(state.sessions[0].lastMessagePreview).toBe('question');
});

test('upsertSessionSummary inserts changed sessions outside the current list', () => {
  const state = coworkReducer(undefined, setSessions([{
    id: 'session-1',
    title: 'Existing task',
    status: CoworkSessionStatusValue.Completed,
    pinned: false,
    agentId: 'main',
    createdAt: 1,
    updatedAt: 1,
  }]));

  const changedState = coworkReducer(state, upsertSessionSummary(makeSession({
    id: 'im-session',
    title: 'WeChat conversation',
    agentId: 'agent-im',
    updatedAt: 10,
    messages: [
      {
        id: 'msg-1',
        type: 'assistant',
        content: 'IM reply',
        timestamp: 10,
      },
    ],
  })));

  expect(changedState.sessions.map((session) => session.id)).toEqual(['im-session', 'session-1']);
  expect(changedState.sessions[0].agentId).toBe('agent-im');
  expect(changedState.sessions[0].lastMessagePreview).toBe('IM reply');
});

test('updateSessionStatus marks completed inactive sessions unread', () => {
  const state = coworkReducer(undefined, setSessions([{
    id: 'session-1',
    title: 'Completed task',
    status: CoworkSessionStatusValue.Running,
    pinned: false,
    agentId: 'main',
    createdAt: 1,
    updatedAt: 1,
  }]));

  const completedState = coworkReducer(
    state,
    updateSessionStatus({
      sessionId: 'session-1',
      status: CoworkSessionStatusValue.Completed,
    }),
  );

  expect(completedState.unreadSessionIds).toEqual(['session-1']);
});

test('updateSessionStatus does not mark the active completed session unread', () => {
  const state = coworkReducer(
    coworkReducer(undefined, setSessions([{
      id: 'session-1',
      title: 'Active task',
      status: CoworkSessionStatusValue.Running,
      pinned: false,
      agentId: 'main',
      createdAt: 1,
      updatedAt: 1,
    }])),
    setCurrentSessionId('session-1'),
  );

  const completedState = coworkReducer(
    state,
    updateSessionStatus({
      sessionId: 'session-1',
      status: CoworkSessionStatusValue.Completed,
    }),
  );

  expect(completedState.unreadSessionIds).toEqual([]);
});

test('switching away caches the outgoing session and delete purges it', () => {
  const a = makeSession({ id: 'session-a', title: 'A' });
  const b = makeSession({ id: 'session-b', title: 'B' });

  // A becomes current but is not cached until it is left.
  let state = coworkReducer(undefined, setCurrentSession(a));
  expect(state.sessionCacheById['session-a']).toBeUndefined();

  // Switching to B snapshots the outgoing A into the revisit cache.
  state = coworkReducer(state, setCurrentSession(b));
  expect(state.currentSession?.id).toBe('session-b');
  expect(state.sessionCacheById['session-a']?.title).toBe('A');
  expect(state.sessionCacheOrder).toContain('session-a');

  // Deleting A removes both the cached snapshot and its LRU bookkeeping.
  state = coworkReducer(state, deleteSession('session-a'));
  expect(state.sessionCacheById['session-a']).toBeUndefined();
  expect(state.sessionCacheOrder).not.toContain('session-a');
});

test('cached snapshot captures streamed messages and is not mutated by later streaming', () => {
  const a = makeSession({ id: 'session-a', status: CoworkSessionStatusValue.Running });
  const b = makeSession({ id: 'session-b' });

  let state = coworkReducer(undefined, setCurrentSession(a));
  state = coworkReducer(state, addMessage({
    sessionId: 'session-a',
    message: { id: 'm1', type: 'assistant', content: 'streamed', timestamp: 5 },
  }));

  // Leaving A captures the freshest in-memory state, including the streamed msg.
  state = coworkReducer(state, setCurrentSession(b));
  expect(state.sessionCacheById['session-a']?.messages.map((m) => m.id)).toEqual(['m1']);

  // Streaming into B must not leak into A's frozen snapshot (Immer aliasing guard).
  state = coworkReducer(state, addMessage({
    sessionId: 'session-b',
    message: { id: 'm2', type: 'assistant', content: 'b msg', timestamp: 6 },
  }));
  expect(state.sessionCacheById['session-a']?.messages.map((m) => m.id)).toEqual(['m1']);
  expect(state.currentSession?.messages.map((m) => m.id)).toContain('m2');
});

test('revisit cache evicts the least-recently-left session beyond the limit', () => {
  let state = coworkReducer(undefined, { type: 'init' });
  const total = 27; // exceeds SESSION_CACHE_LIMIT (25)
  for (let i = 0; i < total; i += 1) {
    state = coworkReducer(state, setCurrentSession(makeSession({ id: `session-${i}`, title: `S${i}` })));
  }

  // 26 sessions were left (session-0..session-25); the current one (session-26)
  // is not cached yet, so the cache holds the last 25 left sessions.
  expect(state.sessionCacheOrder.length).toBe(25);
  expect(state.sessionCacheById['session-0']).toBeUndefined(); // oldest evicted
  expect(state.sessionCacheById['session-25']?.title).toBe('S25'); // most recently left
  expect(state.currentSession?.id).toBe('session-26');
});

test('keeps live messages detached while viewing an older message window', () => {
  const messages = [
    { id: 'user-1', type: 'user' as const, content: 'first', timestamp: 1 },
    { id: 'tool-1', type: 'tool_use' as const, content: 'work', timestamp: 2 },
    { id: 'assistant-1', type: 'assistant' as const, content: 'done', timestamp: 3 },
  ];
  let state = coworkReducer(undefined, addSession(makeSession({
    messages,
    totalMessages: messages.length,
  })));

  state = coworkReducer(state, setMessageWindow({
    sessionId: 'session-1',
    messages: [messages[0]],
    messagesOffset: 0,
    totalMessages: messages.length,
  }));
  state = coworkReducer(state, addMessage({
    sessionId: 'session-1',
    message: { id: 'tool-2', type: 'tool_use', content: 'new work', timestamp: 4 },
  }));

  expect(state.currentSession?.messages.map(message => message.id)).toEqual(['user-1']);
  expect(state.detachedTailMessagesBySessionId['session-1']?.map(message => message.id)).toEqual([
    'tool-1',
    'assistant-1',
    'tool-2',
  ]);
});

test('clears detached messages when the loaded window reaches the session tail', () => {
  const messages = [
    { id: 'user-1', type: 'user' as const, content: 'first', timestamp: 1 },
    { id: 'assistant-1', type: 'assistant' as const, content: 'done', timestamp: 2 },
  ];
  let state = coworkReducer(undefined, addSession(makeSession({
    messages,
    totalMessages: messages.length,
  })));

  state = coworkReducer(state, setMessageWindow({
    sessionId: 'session-1',
    messages: [messages[0]],
    messagesOffset: 0,
    totalMessages: messages.length,
  }));
  state = coworkReducer(state, setMessageWindow({
    sessionId: 'session-1',
    messages: [messages[1]],
    messagesOffset: 1,
    totalMessages: messages.length,
  }));

  expect(state.detachedTailMessagesBySessionId['session-1']).toBeUndefined();
});
