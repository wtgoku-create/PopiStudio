import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { expect, test, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getAppPath: () => process.cwd(),
    getPath: () => process.cwd(),
  },
  BrowserWindow: {
    getAllWindows: () => [],
  },
}));

import {
  ContextCompactionStatus,
  CoworkSystemMessageKind,
} from '../../../common/coworkSystemMessages';
import {
  OpenClawSessionReasoningLevel,
  OpenClawSessionThinkingLevel,
} from '../../../common/openclawSession';
import { buildCronRunHistoryMetadata } from './openclawCronRunHistorySync';
import {
  __openClawRuntimeAdapterTestUtils,
  buildOpenClawChatSendPayloadTooLargeError,
  estimateOpenClawChatSendFrameBytes,
  isSignificantAssistantStreamReset,
  OPENCLAW_CHAT_SEND_PAYLOAD_SAFE_LIMIT_BYTES,
  OpenClawRuntimeAdapter,
  pickPersistedAssistantSegment,
} from './openclawRuntimeAdapter';

test('extracts provider details from a wrapped token proxy error', () => {
  const parsed = __openClawRuntimeAdapterTestUtils.parseWrappedProviderError(
    'llm chat stream failed: status=403 body=' + JSON.stringify({
      error: {
        message: '积分预扣失败: 积分不足，需要预扣 25，当前可用 10',
        user_message: '当前积分不足，请充值或更换计费方式',
        type: 'new_api_error',
        http_status: 403,
        request_id: 'request-123',
        params: { available_points: '10', model: 'kimi-k2.6', need_points: '25' },
      },
    }),
  );

  expect(parsed.providerErrorMessagePreview).toContain('当前积分不足');
  expect(parsed.rawErrorPreview).toContain('need points: 25');
  expect(parsed.rawErrorPreview).toContain('request id: request-123');
  expect(parsed.httpCode).toBe('403');
  expect(parsed.providerErrorType).toBe('new_api_error');
});

test('pickPersistedAssistantSegment: stream authority keeps previous when same length or longer', () => {
  expect(pickPersistedAssistantSegment('aa', 'a', true)).toEqual({
    content: 'aa',
    reason: 'stream_authority_same_or_longer',
  });
  expect(pickPersistedAssistantSegment('same', 'same', true)).toEqual({
    content: 'same',
    reason: 'stream_authority_same_or_longer',
  });
});

test('pickPersistedAssistantSegment: stream shorter prefers chat.final payload', () => {
  expect(pickPersistedAssistantSegment('a', 'final-longer', true)).toEqual({
    content: 'final-longer',
    reason: 'stream_shorter_prefer_chat_final',
  });
});

test('pickPersistedAssistantSegment: chat-only path prefers chat.final extraction', () => {
  expect(pickPersistedAssistantSegment('fromDelta', 'fromFinal', false)).toEqual({
    content: 'fromFinal',
    reason: 'chat_path_prefer_final',
  });
});

test('pickPersistedAssistantSegment: empty branches', () => {
  expect(pickPersistedAssistantSegment('', '', false)).toEqual({
    content: '',
    reason: 'both_empty',
  });
  expect(pickPersistedAssistantSegment('', 'fin', false)).toEqual({
    content: 'fin',
    reason: 'final_only',
  });
  expect(pickPersistedAssistantSegment('prev', '', false)).toEqual({
    content: 'prev',
    reason: 'previous_only',
  });
});

test('isSignificantAssistantStreamReset ignores tiny drops and accepts large resets', () => {
  expect(isSignificantAssistantStreamReset(120, 118)).toBe(false);
  expect(isSignificantAssistantStreamReset(120, 90)).toBe(false);
  expect(isSignificantAssistantStreamReset(120, 70)).toBe(true);
  expect(isSignificantAssistantStreamReset(5, 1)).toBe(false);
});

test('final assistant reuse crosses tool messages in the current user turn', () => {
  const { session, store } = createReconcileStore([
    { id: 'msg-1', type: 'user', content: 'delegate this', timestamp: 1, metadata: {} },
    {
      id: 'msg-2',
      type: 'assistant',
      content: 'Waiting for results.',
      timestamp: 2,
      metadata: { isStreaming: false, isFinal: true, model: 'test-model' },
    },
    { id: 'msg-3', type: 'tool_use', content: 'Using sessions_yield', timestamp: 3, metadata: {} },
    { id: 'msg-4', type: 'tool_result', content: 'yielded', timestamp: 4, metadata: {} },
  ]);
  const adapter = new OpenClawRuntimeAdapter(store, {});

  const reusedMessageId = (adapter as unknown as {
    reuseFinalAssistantMessage: (sessionId: string, content: string) => string | null;
  }).reuseFinalAssistantMessage(session.id, 'Waiting for results.');

  expect(reusedMessageId).toBe('msg-2');
  expect(session.messages).toHaveLength(4);
  expect(session.messages[1].metadata).toEqual({
    isStreaming: false,
    isFinal: true,
    model: 'test-model',
  });
});

test('final assistant reuse ignores trailing thinking messages', () => {
  const { session, store } = createReconcileStore([
    { id: 'msg-1', type: 'user', content: 'delegate this', timestamp: 1, metadata: {} },
    { id: 'msg-2', type: 'assistant', content: 'Waiting for results.', timestamp: 2, metadata: {} },
    {
      id: 'msg-3',
      type: 'assistant',
      content: 'One child finished, but more are running.',
      timestamp: 3,
      metadata: { isThinking: true },
    },
  ]);
  const adapter = new OpenClawRuntimeAdapter(store, {});

  const reusedMessageId = (adapter as unknown as {
    reuseFinalAssistantMessage: (sessionId: string, content: string) => string | null;
  }).reuseFinalAssistantMessage(session.id, 'Waiting for results.');

  expect(reusedMessageId).toBe('msg-2');
  expect(session.messages).toHaveLength(3);
});

test('final assistant reuse stops at another visible assistant message', () => {
  const { session, store } = createReconcileStore([
    { id: 'msg-1', type: 'user', content: 'delegate this', timestamp: 1, metadata: {} },
    { id: 'msg-2', type: 'assistant', content: 'Waiting for results.', timestamp: 2, metadata: {} },
    { id: 'msg-3', type: 'tool_result', content: 'progress', timestamp: 3, metadata: {} },
    { id: 'msg-4', type: 'assistant', content: 'One result arrived.', timestamp: 4, metadata: {} },
  ]);
  const adapter = new OpenClawRuntimeAdapter(store, {});

  const reusedMessageId = (adapter as unknown as {
    reuseFinalAssistantMessage: (sessionId: string, content: string) => string | null;
  }).reuseFinalAssistantMessage(session.id, 'Waiting for results.');

  expect(reusedMessageId).toBeNull();
});

test('final assistant reuse does not cross a user message', () => {
  const { session, store } = createReconcileStore([
    { id: 'msg-1', type: 'user', content: 'first request', timestamp: 1, metadata: {} },
    { id: 'msg-2', type: 'assistant', content: 'Same answer.', timestamp: 2, metadata: {} },
    { id: 'msg-3', type: 'user', content: 'repeat it', timestamp: 3, metadata: {} },
  ]);
  const adapter = new OpenClawRuntimeAdapter(store, {});

  const reusedMessageId = (adapter as unknown as {
    reuseFinalAssistantMessage: (sessionId: string, content: string) => string | null;
  }).reuseFinalAssistantMessage(session.id, 'Same answer.');

  expect(reusedMessageId).toBeNull();
});

test('estimateOpenClawChatSendFrameBytes measures the full RPC frame as UTF-8 JSON', () => {
  const params = {
    sessionKey: 'agent:main:popiai:session-1',
    message: '分析这张图',
    deliver: false,
    idempotencyKey: 'run-1',
    attachments: [{
      type: 'image',
      mimeType: 'image/png',
      fileName: 'image.png',
      content: 'A'.repeat(16),
    }],
  };

  const expected = Buffer.byteLength(JSON.stringify({
    id: 'estimate',
    method: 'chat.send',
    params,
  }), 'utf8');

  expect(estimateOpenClawChatSendFrameBytes(params)).toBe(expected);
  expect(expected).toBeGreaterThan(params.attachments[0].content.length);
});

test('buildOpenClawChatSendPayloadTooLargeError includes a stable classification marker', () => {
  const error = buildOpenClawChatSendPayloadTooLargeError({
    estimatedFrameBytes: OPENCLAW_CHAT_SEND_PAYLOAD_SAFE_LIMIT_BYTES + 1,
    safeLimitBytes: OPENCLAW_CHAT_SEND_PAYLOAD_SAFE_LIMIT_BYTES,
    attachmentCount: 4,
    attachmentBase64Bytes: 36_335_652,
  });

  expect(error.message).toContain('chat.send payload too large');
  expect(error.message).toContain(String(OPENCLAW_CHAT_SEND_PAYLOAD_SAFE_LIMIT_BYTES + 1));
  expect(error.message).toContain('attachments 4');
  expect(error.message).toContain('attachment base64 bytes 36335652');
});

test('context usage ignores non-checkpoint compactionCount', () => {
  const adapter = new OpenClawRuntimeAdapter({} as never, {} as never);
  const usage = (adapter as unknown as {
    buildContextUsageFromSessionRow: (sessionId: string, row: Record<string, unknown>) => Record<string, unknown>;
  }).buildContextUsageFromSessionRow('session-1', {
    key: 'agent:main:popiai:session-1',
    tokenCount: 53_250,
    contextTokens: 60_000,
    compactionCount: 1,
  });

  expect(usage.compactionCount).toBeUndefined();
  expect(usage.percent).toBe(89);
});

test('context usage uses checkpoint compaction count', () => {
  const adapter = new OpenClawRuntimeAdapter({} as never, {} as never);
  const usage = (adapter as unknown as {
    buildContextUsageFromSessionRow: (sessionId: string, row: Record<string, unknown>) => Record<string, unknown>;
  }).buildContextUsageFromSessionRow('session-1', {
    key: 'agent:main:popiai:session-1',
    tokenCount: 20_000,
    contextTokens: 60_000,
    compactionCount: 9,
    compactionCheckpointCount: 2,
    latestCompactionCheckpoint: {
      checkpointId: 'checkpoint-2',
      reason: 'overflow',
      createdAt: 123,
    },
  });

  expect(usage.compactionCount).toBe(2);
  expect(usage.latestCompactionCheckpointId).toBe('checkpoint-2');
});

test('context usage resolves historical sessions with targeted lookup', async () => {
  const session = {
    id: 'session-1',
    title: 'Historical Session',
    claudeSessionId: null,
    status: 'completed',
    pinned: false,
    cwd: '',
    systemPrompt: '',
    modelOverride: '',
    executionMode: 'local',
    activeSkillIds: [],
    agentId: 'main',
    messages: [],
    createdAt: 1,
    updatedAt: 1,
  };
  const sessionKey = `agent:main:popiai:${session.id}`;
  const requests: Array<{ method: string; params: Record<string, unknown> }> = [];
  const adapter = new OpenClawRuntimeAdapter({
    getSession: (sessionId: string) => (sessionId === session.id ? session : null),
  } as never, {} as never);
  adapter.gatewayClient = {
    request: async (method: string, params?: unknown) => {
      requests.push({ method, params: params as Record<string, unknown> });
      const p = params as Record<string, unknown>;
      if (p.search === sessionKey) {
        return {
          sessions: [{
            key: sessionKey,
            totalTokens: 42_000,
            contextTokens: 60_000,
          }],
        };
      }
      return { sessions: [] };
    },
  } as never;

  const usage = await adapter.getContextUsage(session.id);

  expect(usage?.usedTokens).toBe(42_000);
  expect(usage?.percent).toBe(70);
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({
    method: 'sessions.list',
    params: { search: sessionKey, limit: 5 },
  });
  expect(requests[0].params).not.toHaveProperty('activeMinutes');
});

test('usage metadata falls back to latest assistant when preferred id was replaced', async () => {
  const { session, store } = createReconcileStore([
    { id: 'msg-1', type: 'user', content: 'Hello', timestamp: 1, metadata: {} },
    { id: 'msg-2', type: 'assistant', content: 'Done', timestamp: 2, metadata: {} },
  ]);
  const adapter = new OpenClawRuntimeAdapter(store, {});

  await (adapter as unknown as {
    applyUsageMetadataFromFinal: (
      sessionId: string,
      sessionKey: string,
      assistantMessageId: string,
      inputTokens: number | undefined,
      outputTokens: number | undefined,
      model: string | undefined,
      totalTokens?: number | undefined,
      cacheReadTokens?: number | undefined,
    ) => Promise<void>;
  }).applyUsageMetadataFromFinal(
    session.id,
    `agent:main:popiai:${session.id}`,
    'stale-message-id',
    80_262,
    391,
    'qwen-portal/qwen3.6-plus',
  );

  expect(session.messages[1].metadata).toMatchObject({
    usage: {
      inputTokens: 80_262,
      outputTokens: 391,
    },
    model: 'qwen-portal/qwen3.6-plus',
    agentName: 'main',
  });
});

test('outbound prompt injects top-k evidence after context compaction', async () => {
  const { session, store } = createReconcileStore([
    { id: 'msg-1', type: 'user', content: 'src/pages/Bakery.tsx 的测试失败了', timestamp: 1, metadata: {} },
    {
      id: 'msg-2',
      type: 'tool_result',
      content: 'npm test failed in src/pages/Bakery.tsx: expected ja copy to be visible.',
      timestamp: 2,
      metadata: { toolName: 'shell' },
    },
  ]);
  const adapter = new OpenClawRuntimeAdapter(store, {});
  const internal = adapter as unknown as {
    bridgedSessions: Set<string>;
    continuityCapsuleBySession: Map<string, unknown>;
    buildOutboundPrompt: (sessionId: string, prompt: string) => Promise<string>;
  };

  internal.bridgedSessions.add(session.id);
  internal.continuityCapsuleBySession.set(session.id, {
    version: 1,
    sessionId: session.id,
    revision: 1,
    updatedAt: 100,
    lastSource: 'post_compaction',
    lastCompactedAt: 100,
    currentObjective: 'Fix the failing bakery page test.',
    recentUserRequests: [],
    userConstraints: [],
    decisions: [],
    completedFacts: [],
    recentActions: [],
    touchedFiles: [{ path: 'src/pages/Bakery.tsx' }],
    keySymbols: [],
    verification: [],
    nextSteps: ['Investigate npm test failure.'],
    recentFailures: [],
    activeCapabilities: [],
    openQuestions: [],
  });

  const prompt = await internal.buildOutboundPrompt(
    session.id,
    '继续处理 src/pages/Bakery.tsx 的 npm test failed',
  );

  expect(prompt).toContain('[Popiai retrieved evidence after context compaction]');
  expect(prompt).toContain('tool result: shell');
  expect(prompt).toContain('expected ja copy');
  expect(prompt.indexOf('[Popiai retrieved evidence after context compaction]')).toBeLessThan(
    prompt.indexOf('[Current user request]'),
  );
});

// ==================== Session patch tests ====================

function createPatchAdapter(options?: {
  isChannelSession?: boolean;
  persistedSessionKey?: string | null;
}) {
  const session = {
    id: 'session-1',
    title: 'Test Session',
    claudeSessionId: null,
    status: 'completed',
    pinned: false,
    cwd: '',
    systemPrompt: '',
    modelOverride: '',
    executionMode: 'local',
    activeSkillIds: [],
    agentId: 'main',
    messages: [],
    createdAt: 1,
    updatedAt: 1,
  };
  const requests: Array<{ method: string; params: Record<string, unknown> }> = [];
  const store = {
    getSession: (sessionId: string) => (sessionId === session.id ? session : null),
    updateSession: () => {},
  };
  const engineManager = {
    startGateway: async () => ({ phase: 'running', message: '' }),
    getGatewayConnectionInfo: () => ({
      url: 'ws://127.0.0.1:9999',
      token: 'token',
      version: 'test-version',
      clientEntryPath: '/tmp/openclaw-gateway-client.js',
    }),
  };
  const adapter = new OpenClawRuntimeAdapter(store as never, engineManager as never);
  adapter.gatewayClient = {
    start: () => {},
    stop: () => {},
    request: async (method: string, params?: unknown) => {
      requests.push({ method, params: params as Record<string, unknown> });
      return {};
    },
  };
  adapter.gatewayClientVersion = 'test-version';
  adapter.gatewayClientEntryPath = '/tmp/openclaw-gateway-client.js';
  adapter.gatewayReadyPromise = Promise.resolve();
  if (options?.isChannelSession !== undefined) {
    adapter.channelSessionSync = {
      getOpenClawSessionKeyForCoworkSession: () => ({
        isChannelSession: !!options.isChannelSession,
        sessionKey: options.persistedSessionKey ?? null,
      }),
    };
  }
  return { adapter, requests };
}

test('patchSession uses the persisted IM channel session key after runtime cache is empty', async () => {
  const { adapter, requests } = createPatchAdapter({
    isChannelSession: true,
    persistedSessionKey: 'agent:main:feishu:dm:ou_123',
  });

  await adapter.patchSession('session-1', { model: 'popiai-server/qwen3.6-plus-YoudaoInner' });

  expect(requests).toEqual([
    {
      method: 'sessions.patch',
      params: {
        key: 'agent:main:feishu:dm:ou_123',
        model: 'popiai-server/qwen3.6-plus-YoudaoInner',
      },
    },
  ]);
});

test('patchSession rejects IM channel sessions when the real OpenClaw key is missing', async () => {
  const { adapter, requests } = createPatchAdapter({
    isChannelSession: true,
    persistedSessionKey: null,
  });

  await expect(adapter.patchSession('session-1', { model: 'popiai-server/qwen3.6-plus-YoudaoInner' }))
    .rejects.toThrow('Cannot patch IM channel session because the OpenClaw session key is missing.');

  expect(requests).toHaveLength(0);
});

test('patchSession keeps managed-key fallback for normal Cowork sessions', async () => {
  const { adapter, requests } = createPatchAdapter({
    isChannelSession: false,
    persistedSessionKey: null,
  });

  await adapter.patchSession('session-1', { model: 'moonshot/kimi-k2.6' });

  expect(requests[0]).toEqual({
    method: 'sessions.patch',
    params: {
      key: 'agent:main:popiai:session-1',
      model: 'moonshot/kimi-k2.6',
    },
  });
});

function createRunTurnAdapter(options: {
  sessionModelOverride?: string;
  agentModel?: string;
  cachedModel?: string;
  holdFirstModelPatch?: boolean;
  sessionCwd?: string;
  sessionSystemPrompt?: string;
  managedSystemPrompt?: boolean;
} = {}) {
  const session = {
    id: 'session-1',
    title: 'Test Session',
    claudeSessionId: null,
    status: 'completed',
    pinned: false,
    cwd: options.sessionCwd ?? '',
    systemPrompt: options.sessionSystemPrompt ?? '',
    modelOverride: options.sessionModelOverride ?? '',
    executionMode: 'local',
    activeSkillIds: [],
    agentId: 'main',
    messages: [] as Array<Record<string, unknown>>,
    createdAt: 1,
    updatedAt: 1,
  };
  let nextMessageId = 1;
  let firstModelPatchStartedResolve: (() => void) | null = null;
  let firstModelPatchRelease: (() => void) | null = null;
  let modelPatchCount = 0;
  const firstModelPatchStarted = new Promise<void>((resolve) => {
    firstModelPatchStartedResolve = resolve;
  });
  const firstModelPatchBlocked = new Promise<void>((resolve) => {
    firstModelPatchRelease = resolve;
  });
  const requests: Array<{ method: string; params: Record<string, unknown> }> = [];
  const store = {
    getSession: (sessionId: string) => (sessionId === session.id ? session : null),
    updateSession: (sessionId: string, patch: Record<string, unknown>) => {
      expect(sessionId).toBe(session.id);
      Object.assign(session, patch);
    },
    addMessage: (sessionId: string, message: Record<string, unknown>) => {
      expect(sessionId).toBe(session.id);
      const created = {
        id: `msg-${nextMessageId++}`,
        timestamp: nextMessageId,
        metadata: {},
        ...message,
      };
      session.messages.push(created);
      return created;
    },
    updateMessage: (sessionId: string, messageId: string, patch: Record<string, unknown>) => {
      expect(sessionId).toBe(session.id);
      const message = session.messages.find((entry) => entry.id === messageId);
      if (message) {
        Object.assign(message, patch);
      }
    },
    deleteMessage: (sessionId: string, messageId: string) => {
      expect(sessionId).toBe(session.id);
      const before = session.messages.length;
      session.messages = session.messages.filter((entry) => entry.id !== messageId);
      return session.messages.length !== before;
    },
    getAgent: (agentId: string) => (agentId === 'main'
      ? {
        id: 'main',
        name: 'Main',
        model: options.agentModel ?? 'popiai-server/qwen3.5-plus-YoudaoInner',
      }
      : null),
    updateAgent: () => {},
  };
  const engineManager = {
    startGateway: async () => ({ phase: 'running', message: '' }),
    getGatewayConnectionInfo: () => ({
      url: 'ws://127.0.0.1:9999',
      token: 'token',
      version: 'test-version',
      clientEntryPath: '/tmp/openclaw-gateway-client.js',
    }),
  };
  const adapter = new OpenClawRuntimeAdapter(store as never, engineManager as never, {
    isSystemPromptManaged: () => options.managedSystemPrompt === true,
  });
  adapter.gatewayClient = {
    start: () => {},
    stop: () => {},
    request: async (method: string, params?: unknown) => {
      const requestParams = (params ?? {}) as Record<string, unknown>;
      requests.push({ method, params: requestParams });
      if (method === 'sessions.patch') {
        modelPatchCount++;
        if (options.holdFirstModelPatch && modelPatchCount === 1) {
          firstModelPatchStartedResolve?.();
          await firstModelPatchBlocked;
        }
        return {};
      }
      if (method === 'chat.history') {
        return { messages: [] };
      }
      if (method === 'chat.send') {
        const runId = typeof requestParams.idempotencyKey === 'string'
          ? requestParams.idempotencyKey
          : 'run-1';
        const sessionKey = typeof requestParams.sessionKey === 'string'
          ? requestParams.sessionKey
          : 'agent:main:popiai:session-1';
        queueMicrotask(() => {
          (adapter as unknown as {
            handleChatEvent: (payload: unknown, seq?: number) => void;
          }).handleChatEvent({
            state: 'final',
            runId,
            sessionKey,
            message: { role: 'assistant', content: 'Done' },
          }, 1);
        });
        return { runId };
      }
      return {};
    },
  };
  adapter.gatewayClientVersion = 'test-version';
  adapter.gatewayClientEntryPath = '/tmp/openclaw-gateway-client.js';
  adapter.gatewayReadyPromise = Promise.resolve();
  adapter.reconcileWithHistory = async () => {};

  if (options.cachedModel) {
    adapter.lastPatchedModelBySession.set(session.id, options.cachedModel);
  }

  return {
    adapter,
    requests,
    session,
    releaseFirstModelPatch: () => firstModelPatchRelease?.(),
    firstModelPatchStarted,
  };
}

test('continueSession patches a session override before chat.send even when the model cache matches', async () => {
  const model = 'popiai-server/qwen3.6-plus-YoudaoInner';
  const { adapter, requests } = createRunTurnAdapter({
    sessionModelOverride: model,
    cachedModel: model,
  });

  await adapter.continueSession('session-1', 'hello');

  expect(requests.map((request) => request.method).slice(0, 3)).toEqual([
    'sessions.patch',
    'chat.history',
    'chat.send',
  ]);
  expect(requests[0].params).toEqual({
    key: 'agent:main:popiai:session-1',
    model,
    reasoningLevel: OpenClawSessionReasoningLevel.Stream,
    thinkingLevel: OpenClawSessionThinkingLevel.Medium,
  });
});

test('runGoalCommand ensures the OpenClaw session exists before sessions.goal', async () => {
  const model = 'popiai-server/qwen3.5-plus-YoudaoInner';
  const { adapter, requests } = createRunTurnAdapter({
    agentModel: model,
    cachedModel: model,
  });

  await adapter.runGoalCommand('session-1', '/goal status');

  expect(requests.map((request) => request.method).slice(0, 2)).toEqual([
    'sessions.patch',
    'sessions.goal',
  ]);
  expect(requests[0].params).toEqual({
    key: 'agent:main:popiai:session-1',
    model,
    reasoningLevel: OpenClawSessionReasoningLevel.Stream,
    thinkingLevel: OpenClawSessionThinkingLevel.Medium,
  });
  expect(requests[1].params).toEqual({
    key: 'agent:main:popiai:session-1',
    action: 'status',
    text: '',
  });
});

test('continueSession waits for an in-flight model patch before chat.send', async () => {
  const model = 'popiai-server/qwen3.6-plus-YoudaoInner';
  const {
    adapter,
    requests,
    firstModelPatchStarted,
    releaseFirstModelPatch,
  } = createRunTurnAdapter({
    sessionModelOverride: model,
    holdFirstModelPatch: true,
  });

  const patchPromise = adapter.patchSession('session-1', { model });
  await firstModelPatchStarted;

  const continuePromise = adapter.continueSession('session-1', 'hello');
  await Promise.resolve();
  await Promise.resolve();

  expect(requests.map((request) => request.method)).toEqual(['sessions.patch']);

  releaseFirstModelPatch();
  await patchPromise;
  await continuePromise;

  expect(requests.map((request) => request.method).slice(0, 4)).toEqual([
    'sessions.patch',
    'sessions.patch',
    'chat.history',
    'chat.send',
  ]);
});

test('continueSession sends the session cwd to OpenClaw chat.send', async () => {
  const { adapter, requests } = createRunTurnAdapter({
    sessionCwd: '/tmp/popiai-selected-project',
  });

  await adapter.continueSession('session-1', 'hello');

  const chatSend = requests.find((request) => request.method === 'chat.send');
  expect(chatSend?.params).toMatchObject({
    cwd: path.resolve('/tmp/popiai-selected-project'),
  });
});

test('continueSession rejects oversized chat.send payloads before calling OpenClaw', async () => {
  const { adapter, requests, session } = createRunTurnAdapter();
  adapter.on('error', () => {});

  await expect(adapter.continueSession('session-1', 'inspect', {
    imageAttachments: [{
      name: 'large.png',
      mimeType: 'image/png',
      base64Data: 'A'.repeat(OPENCLAW_CHAT_SEND_PAYLOAD_SAFE_LIMIT_BYTES + 1),
    }],
  })).rejects.toThrow('chat.send payload too large');

  expect(requests.some((request) => request.method === 'chat.send')).toBe(false);
  expect(session.status).toBe('error');
  expect(session.messages).toHaveLength(2);
  expect(session.messages[session.messages.length - 1]).toMatchObject({
    type: 'system',
    content: expect.stringContaining('chat.send payload too large'),
    metadata: {
      error: expect.stringContaining('chat.send payload too large'),
    },
  });
});

test('continueSession creates a missing session cwd before chat.send', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'popiai-run-cwd-'));
  const missingCwd = path.join(tmpDir, 'missing-project');
  const { adapter, requests } = createRunTurnAdapter({
    sessionCwd: missingCwd,
  });

  await adapter.continueSession('session-1', 'hello');

  expect(fs.statSync(missingCwd).isDirectory()).toBe(true);
  const chatSend = requests.find((request) => request.method === 'chat.send');
  expect(chatSend?.params).toMatchObject({
    cwd: path.resolve(missingCwd),
  });
});

test('startSession injects the stored system prompt into the outbound message', async () => {
  const { adapter, requests } = createRunTurnAdapter({
    sessionSystemPrompt: 'stored system prompt',
  });

  await adapter.startSession('session-1', 'hello');

  const chatSend = requests.find((request) => request.method === 'chat.send');
  expect(chatSend?.params.message).toContain('[Popiai system instructions]');
  expect(chatSend?.params.message).toContain('stored system prompt');
});

test('desktop turns skip a managed static prompt but keep dynamic prompt additions', async () => {
  const { adapter } = createRunTurnAdapter({
    sessionSystemPrompt: 'stored system prompt',
    managedSystemPrompt: true,
  });
  const internal = adapter as unknown as {
    buildOutboundPrompt: (
      sessionId: string,
      prompt: string,
      systemPrompt: string,
      agentId: string,
      staticSystemPrompt: string,
    ) => Promise<string>;
  };

  const prompt = await internal.buildOutboundPrompt(
    'session-1',
    'hello',
    'stored system prompt\n\ntransient plan instruction',
    'main',
    'stored system prompt',
  );

  expect(prompt).not.toContain('stored system prompt');
  expect(prompt).toContain('transient plan instruction');
});

test('continueSession injects the stored system prompt only when it changes', async () => {
  const { adapter, requests } = createRunTurnAdapter({
    sessionSystemPrompt: 'stored system prompt',
  });

  await adapter.startSession('session-1', 'hello');
  await adapter.continueSession('session-1', 'continue');

  const chatSends = requests.filter((request) => request.method === 'chat.send');
  expect(chatSends).toHaveLength(2);
  expect(chatSends[0].params.message).toContain('[Popiai system instructions]');
  expect(chatSends[0].params.message).toContain('stored system prompt');
  expect(chatSends[1].params.message).not.toContain('[Popiai system instructions]');
  expect(chatSends[1].params.message).not.toContain('stored system prompt');
});

// ==================== Reconcile tests ====================

function createReconcileStore(messages: Array<Record<string, unknown>>) {
  const session = {
    id: 'session-1',
    title: 'Test Session',
    claudeSessionId: null,
    status: 'completed',
    pinned: false,
    cwd: '',
    systemPrompt: '',
    modelOverride: '',
    executionMode: 'local',
    activeSkillIds: [],
    messages: [...messages],
    createdAt: 1,
    updatedAt: 1,
  };
  let nextId = session.messages.length + 1;
  let replaceCallCount = 0;
  let lastReplaceArgs: { sessionId: string; authoritative: Array<Record<string, unknown>> } | null = null;

  return {
    session,
    getReplaceCallCount: () => replaceCallCount,
    getLastReplaceArgs: () => lastReplaceArgs,
    store: {
      getSession: (sessionId: string) => (sessionId === session.id ? session : null),
      getRecentConversationMessages: (sessionId: string, limit: number) => {
        expect(sessionId).toBe(session.id);
        return session.messages
          .filter((message) => message.type === 'user' || message.type === 'assistant')
          .slice(-Math.max(0, Math.floor(limit)));
      },
      getAllConversationMessages: (sessionId: string) => {
        expect(sessionId).toBe(session.id);
        return session.messages
          .filter((message) => message.type === 'user' || message.type === 'assistant');
      },
      addMessage: (sessionId: string, message: Record<string, unknown>) => {
        expect(sessionId).toBe(session.id);
        const created = {
          id: `msg-${nextId++}`,
          timestamp: nextId,
          metadata: {},
          ...message,
        };
        session.messages.push(created);
        return created;
      },
      insertMessageBeforeId: (sessionId: string, beforeMessageId: string, message: Record<string, unknown>) => {
        expect(sessionId).toBe(session.id);
        const created = {
          id: `msg-${nextId++}`,
          timestamp: nextId,
          metadata: {},
          ...message,
        };
        const targetIndex = session.messages.findIndex((item) => item.id === beforeMessageId);
        if (targetIndex >= 0) {
          session.messages.splice(targetIndex, 0, created);
        } else {
          session.messages.push(created);
        }
        return created;
      },
      updateSession: (sessionId: string, patch: Record<string, unknown>) => {
        expect(sessionId).toBe(session.id);
        Object.assign(session, patch);
      },
      updateMessage: (sessionId: string, messageId: string, patch: Record<string, unknown>) => {
        expect(sessionId).toBe(session.id);
        const message = session.messages.find((m) => m.id === messageId);
        if (!message) return false;
        Object.assign(message, patch);
        return true;
      },
      replaceConversationMessages: (sessionId: string, authoritative: Array<Record<string, unknown>>) => {
        replaceCallCount++;
        lastReplaceArgs = { sessionId, authoritative };
        // Simulate: remove old user/assistant, insert new ones
        session.messages = session.messages.filter(
          (m) => m.type !== 'user' && m.type !== 'assistant',
        );
        for (const entry of authoritative) {
          session.messages.push({
            id: `msg-${nextId++}`,
            type: entry.role,
            content: entry.text,
            metadata: { isStreaming: false, isFinal: true },
            timestamp: typeof entry.timestamp === 'number' ? entry.timestamp : nextId,
          });
        }
      },
      deleteMessage: (sessionId: string, messageId: string) => {
        expect(sessionId).toBe(session.id);
        const before = session.messages.length;
        session.messages = session.messages.filter((entry) => entry.id !== messageId);
        return session.messages.length !== before;
      },
    },
  };
}

function createActiveTurn(sessionId: string, sessionKey: string, runId: string) {
  return {
    sessionId,
    sessionKey,
    runId,
    turnToken: 1,
    startedAtMs: 1,
    knownRunIds: new Set([runId]),
    assistantMessageId: undefined,
    committedAssistantText: '',
    currentAssistantSegmentText: '',
    currentText: '',
    agentAssistantTextLength: 0,
    currentContentText: '',
    currentContentBlocks: [],
    sawNonTextContentBlocks: false,
    textStreamMode: 'snapshot',
    toolUseMessageIdByToolCallId: new Map(),
    toolNameByToolCallId: new Map(),
    toolResultMessageIdByToolCallId: new Map(),
    toolResultTextByToolCallId: new Map(),
    contextMaintenanceToolCallIds: new Set(),
    stopRequested: false,
    pendingUserSync: false,
    bufferedChatPayloads: [],
    bufferedAgentPayloads: [],
  };
}

test('fetchSessionByKey: cron run key uses gateway history instead of local session cache', async () => {
  const sessionKey = 'agent:main:cron:job-1:run:run-1';
  const { session, store } = createReconcileStore([
    { id: 'msg-1', type: 'assistant', content: 'local partial cron output', timestamp: 1, metadata: {} },
  ]);
  const adapter = new OpenClawRuntimeAdapter(store, {});
  const requests: Array<{ method: string; params: unknown }> = [];
  adapter.gatewayClient = {
    start: () => {},
    stop: () => {},
    request: async (method: string, params: unknown) => {
      requests.push({ method, params });
      if (method !== 'chat.history') return {};
      return {
        messages: [
          {
            role: 'user',
            content: '[cron:job-1 Daily] collect news',
          },
          {
            role: 'assistant',
            content: 'authoritative cron summary',
          },
        ],
      };
    },
  };

  const resolved = await adapter.fetchSessionByKey(sessionKey, { sessionId: session.id });

  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({
    method: 'chat.history',
    params: { sessionKey },
  });
  expect(resolved?.id).toBe(`transient-${sessionKey}`);
  expect(resolved?.messages.map(message => message.content)).toEqual([
    '[cron:job-1 Daily] collect news',
    'authoritative cron summary',
  ]);
});

test('syncChannelUserMessages inserts a late cron user prompt before current tool activity', () => {
  const { session, store } = createReconcileStore([
    { id: 'tool-1', type: 'tool_use', content: '', timestamp: 1, metadata: { toolName: 'Read' } },
    { id: 'tool-result-1', type: 'tool_result', content: '5 lines', timestamp: 2, metadata: { toolName: 'Read' } },
  ]);
  const adapter = new OpenClawRuntimeAdapter(store, {});

  (adapter as unknown as {
    syncChannelUserMessages: (
      sessionId: string,
      historyMessages: unknown[],
      latestOnly?: boolean,
      isDiscord?: boolean,
      isQQ?: boolean,
      isPopo?: boolean,
      isFeishu?: boolean,
      insertBeforeMessageIds?: string[],
    ) => void;
  }).syncChannelUserMessages(
    session.id,
    [{ role: 'user', content: '[cron:job-1 会议准备] 请梳理今天会议' }],
    false,
    false,
    false,
    false,
    false,
    ['tool-1', 'tool-result-1'],
  );

  expect(session.messages.map(message => message.type)).toEqual(['user', 'tool_use', 'tool_result']);
  expect(session.messages[0].content).toBe('[cron:job-1 会议准备] 请梳理今天会议');
});

test('ensureActiveTurn inserts the cron prompt before runtime tool messages', () => {
  const { session, store } = createReconcileStore([]);
  const adapter = new OpenClawRuntimeAdapter(store, {} as never, {
    resolveCronJobPrompt: (jobId) => ({
      message: '请收集新闻',
      name: jobId === 'job-1' ? '科技早报' : null,
    }),
  });
  const sessionKey = 'agent:main:cron:job-1:run:6bcc366b-b080-4fe6-b623-2caa27642c20';

  adapter.ensureActiveTurn(session.id, sessionKey, 'run-1');
  adapter.handleAgentEvent({
    runId: 'run-1',
    sessionKey,
    stream: 'tool',
    data: {
      phase: 'start',
      toolCallId: 'tool-1',
      name: 'Read',
      args: { file_path: '/tmp/file.md' },
    },
  });

  expect(session.messages.map(message => message.type)).toEqual(['user', 'tool_use']);
  expect(session.messages[0].content).toContain('[cron:job-1 科技早报] 请收集新闻\nCurrent time: ');
  expect(session.messages[0].content).toContain('\nReference UTC: ');
  expect(session.messages[1].content).toBe('Using tool: Read');
});

test('ensureActiveTurn inserts the cron prompt before earlier runtime system errors', () => {
  const { session, store } = createReconcileStore([
    {
      id: 'system-error-1',
      type: 'system',
      content: '请求过于频繁，请稍后再试',
      timestamp: 1,
      metadata: { error: '请求过于频繁，请稍后再试' },
    },
  ]);
  const adapter = new OpenClawRuntimeAdapter(store, {} as never, {
    resolveCronJobPrompt: (jobId) => ({
      message: '请收集新闻',
      name: jobId === 'job-1' ? '科技早报' : null,
    }),
  });
  const sessionKey = 'agent:main:cron:job-1:run:6bcc366b-b080-4fe6-b623-2caa27642c20';
  const emittedMessages: Array<{ message: Record<string, unknown>; beforeMessageId?: string }> = [];
  adapter.on('message', (_sessionId, message, beforeMessageId) => {
    emittedMessages.push({ message: message as Record<string, unknown>, beforeMessageId });
  });

  adapter.ensureActiveTurn(session.id, sessionKey, 'run-1');

  expect(session.messages.map(message => message.type)).toEqual(['user', 'system']);
  expect(session.messages[0].content).toContain('[cron:job-1 科技早报] 请收集新闻\nCurrent time: ');
  expect(session.messages[0].content).toContain('\nReference UTC: ');
  expect(session.messages[1].content).toBe('请求过于频繁，请稍后再试');
  expect(emittedMessages).toEqual([
    {
      message: expect.objectContaining({
        type: 'user',
        content: expect.stringContaining('[cron:job-1 科技早报] 请收集新闻\nCurrent time: '),
      }),
      beforeMessageId: 'system-error-1',
    },
  ]);
});

test('ensureActiveTurn appends a second cron prompt after the previous run output', () => {
  const { session, store } = createReconcileStore([
    {
      id: 'run-1-user',
      type: 'user',
      content: '[cron:job-1 科技早报] 请收集新闻',
      timestamp: 1,
      metadata: buildCronRunHistoryMetadata('agent:main:cron:job-1:run:run-1', 0),
    },
    {
      id: 'run-1-tool',
      type: 'tool_use',
      content: 'Using tool: Read',
      timestamp: 2,
      metadata: { toolName: 'Read' },
    },
    {
      id: 'run-1-assistant',
      type: 'assistant',
      content: '第一次结果',
      timestamp: 3,
      metadata: buildCronRunHistoryMetadata('agent:main:cron:job-1:run:run-1', 1),
    },
  ]);
  const adapter = new OpenClawRuntimeAdapter(store, {} as never, {
    resolveCronJobPrompt: (jobId) => ({
      message: '请收集新闻',
      name: jobId === 'job-1' ? '科技早报' : null,
    }),
  });

  adapter.ensureActiveTurn(session.id, 'agent:main:cron:job-1', 'run-2');

  expect(session.messages.map(message => message.type)).toEqual(['user', 'tool_use', 'assistant', 'user']);
  expect(session.messages[0].content).toBe('[cron:job-1 科技早报] 请收集新闻');
  expect(session.messages[3].content).toContain('[cron:job-1 科技早报] 请收集新闻\nCurrent time: ');
  expect(session.messages[3].content).toContain('\nReference UTC: ');
  expect(session.messages[3].metadata).toMatchObject({
    openclawCronRunSessionKey: 'agent:main:cron:job-1:run:run-2',
    openclawCronRunEntryIndex: 0,
  });
});

test('syncCronRunHistory inserts the cron prompt before early streamed tool activity', async () => {
  const { session, store } = createReconcileStore([
    { id: 'tool-1', type: 'tool_use', content: '', timestamp: 1, metadata: { toolName: 'browser' } },
    { id: 'tool-result-1', type: 'tool_result', content: '5 lines of output', timestamp: 2, metadata: { toolName: 'browser' } },
  ]);
  const adapter = new OpenClawRuntimeAdapter(store, {});
  adapter.gatewayClient = {
    start: () => {},
    stop: () => {},
    request: async () => ({
      messages: [
        { role: 'user', content: '[cron:job-1 科技早报] 请收集新闻' },
        { role: 'assistant', content: '科技早报内容' },
      ],
    }),
    onStatus: () => () => {},
    getStatus: () => 'connected',
  } as never;
  const emittedMessages: Array<{ message: Record<string, unknown>; beforeMessageId?: string }> = [];
  adapter.on('message', (_sessionId, message, beforeMessageId) => {
    emittedMessages.push({ message: message as Record<string, unknown>, beforeMessageId });
  });

  await (adapter as unknown as {
    syncCronRunHistory: (sessionId: string, sessionKey: string) => Promise<void>;
  }).syncCronRunHistory(
    session.id,
    'agent:main:cron:job-1:run:6bcc366b-b080-4fe6-b623-2caa27642c20',
  );

  expect(session.messages.map(message => ({
    type: message.type,
    content: message.content,
  }))).toEqual([
    { type: 'user', content: '[cron:job-1 科技早报] 请收集新闻' },
    { type: 'tool_use', content: '' },
    { type: 'tool_result', content: '5 lines of output' },
    { type: 'assistant', content: '科技早报内容' },
  ]);
  expect(emittedMessages).toEqual([
    {
      message: expect.objectContaining({
        type: 'user',
        content: '[cron:job-1 科技早报] 请收集新闻',
      }),
      beforeMessageId: 'tool-1',
    },
    {
      message: expect.objectContaining({
        type: 'assistant',
        content: '科技早报内容',
      }),
      beforeMessageId: undefined,
    },
  ]);
});

test('syncCronRunHistory updates the runtime cron prompt instead of duplicating it', async () => {
  const { session, store } = createReconcileStore([]);
  const adapter = new OpenClawRuntimeAdapter(store, {} as never, {
    resolveCronJobPrompt: () => ({
      message: '请收集新闻',
      name: '科技早报',
    }),
  });
  const runtimeSessionKey = 'agent:main:cron:job-1';
  const historySessionKey = 'agent:main:cron:job-1:run:6bcc366b-b080-4fe6-b623-2caa27642c20';
  const historyRunId = '6bcc366b-b080-4fe6-b623-2caa27642c20';
  const fullPrompt = [
    '[cron:job-1 科技早报] 请收集新闻',
    'Current time: Thursday, July 30th, 2026 - 15:47 (Asia/Shanghai)',
    'Reference UTC: 2026-07-30 07:47 UTC',
  ].join('\n');

  adapter.ensureActiveTurn(session.id, runtimeSessionKey, historyRunId);
  adapter.gatewayClient = {
    start: () => {},
    stop: () => {},
    request: async () => ({
      messages: [
        { role: 'user', content: fullPrompt },
        { role: 'assistant', content: '科技早报内容' },
      ],
    }),
    onStatus: () => () => {},
    getStatus: () => 'connected',
  } as never;

  await (adapter as unknown as {
    syncCronRunHistory: (sessionId: string, sessionKey: string) => Promise<void>;
  }).syncCronRunHistory(session.id, historySessionKey);

  const userMessages = session.messages.filter(message => message.type === 'user');
  expect(userMessages).toHaveLength(1);
  expect(userMessages[0].content).toBe(fullPrompt);
  expect(session.messages.map(message => message.type)).toEqual(['user', 'assistant']);
});

test('syncCronRunHistory reuses the preinserted full cron prompt when run metadata differs', async () => {
  const historySessionKey = 'agent:main:cron:job-1:run:6bcc366b-b080-4fe6-b623-2caa27642c20';
  const fullPrompt = [
    '[cron:job-1 科技早报] 请收集新闻',
    'Current time: Thursday, July 30th, 2026 - 15:47 (Asia/Shanghai)',
    'Reference UTC: 2026-07-30 07:47 UTC',
  ].join('\n');
  const { session, store } = createReconcileStore([
    {
      id: 'preinserted-prompt',
      type: 'user',
      content: fullPrompt,
      timestamp: 1,
      metadata: buildCronRunHistoryMetadata('agent:main:cron:job-1:run:runtime-run-id', 0),
    },
    {
      id: 'assistant-1',
      type: 'assistant',
      content: '科技早报内容',
      timestamp: 3,
      metadata: buildCronRunHistoryMetadata(historySessionKey, 1),
    },
  ]);
  const adapter = new OpenClawRuntimeAdapter(store, {});
  adapter.gatewayClient = {
    start: () => {},
    stop: () => {},
    request: async () => ({
      messages: [
        { role: 'user', content: fullPrompt },
        { role: 'assistant', content: '科技早报内容' },
      ],
    }),
    onStatus: () => () => {},
    getStatus: () => 'connected',
  } as never;

  await (adapter as unknown as {
    syncCronRunHistory: (sessionId: string, sessionKey: string) => Promise<void>;
  }).syncCronRunHistory(session.id, historySessionKey);

  expect(session.messages.filter(message => message.type === 'user')).toHaveLength(1);
  expect(session.messages[0].id).toBe('preinserted-prompt');
  expect(session.messages[0].metadata).toMatchObject({
    openclawCronRunSessionKey: 'agent:main:cron:job-1:run:6bcc366b-b080-4fe6-b623-2caa27642c20',
  });
  expect(session.messages.map(message => message.type)).toEqual(['user', 'assistant']);
});

test('syncCronRunHistory inserts a delayed cron prompt before current run tool and assistant output', async () => {
  const currentSessionKey = 'agent:main:cron:job-1:run:run-2';
  const { session, store, getReplaceCallCount } = createReconcileStore([
    {
      id: 'prev-user',
      type: 'user',
      content: '[cron:job-1 科技早报] 第一次',
      timestamp: 1,
      metadata: buildCronRunHistoryMetadata('agent:main:cron:job-1:run:run-1', 0),
    },
    {
      id: 'prev-assistant',
      type: 'assistant',
      content: '第一次结果',
      timestamp: 2,
      metadata: buildCronRunHistoryMetadata('agent:main:cron:job-1:run:run-1', 1),
    },
    { id: 'tool-2', type: 'tool_use', content: '', timestamp: 3, metadata: { toolName: 'browser' } },
    { id: 'assistant-2', type: 'assistant', content: '第二次结果', timestamp: 4, metadata: {} },
  ]);
  const adapter = new OpenClawRuntimeAdapter(store, {});
  adapter.gatewayClient = {
    start: () => {},
    stop: () => {},
    request: async () => ({
      messages: [
        { role: 'user', content: '[cron:job-1 科技早报] 第二次' },
        { role: 'assistant', content: '第二次结果' },
      ],
    }),
    onStatus: () => () => {},
    getStatus: () => 'connected',
  } as never;

  await (adapter as unknown as {
    syncCronRunHistory: (sessionId: string, sessionKey: string) => Promise<void>;
  }).syncCronRunHistory(session.id, currentSessionKey);

  expect(getReplaceCallCount()).toBe(0);
  expect(session.messages.map(message => ({
    type: message.type,
    content: message.content,
  }))).toEqual([
    { type: 'user', content: '[cron:job-1 科技早报] 第一次' },
    { type: 'assistant', content: '第一次结果' },
    { type: 'user', content: '[cron:job-1 科技早报] 第二次' },
    { type: 'tool_use', content: '' },
    { type: 'assistant', content: '第二次结果' },
  ]);
});

test('syncCronRunHistory does not update a previous cron run user message on the second run', async () => {
  const { session, store } = createReconcileStore([
    {
      id: 'prev-user',
      type: 'user',
      content: '[cron:job-1 科技早报] 第一次',
      timestamp: 1,
      metadata: buildCronRunHistoryMetadata('agent:main:cron:job-1:run:run-1', 0),
    },
    {
      id: 'prev-assistant',
      type: 'assistant',
      content: '第一次结果',
      timestamp: 2,
      metadata: buildCronRunHistoryMetadata('agent:main:cron:job-1:run:run-1', 1),
    },
  ]);
  const adapter = new OpenClawRuntimeAdapter(store, {});
  adapter.gatewayClient = {
    start: () => {},
    stop: () => {},
    request: async () => ({
      messages: [
        { role: 'user', content: '[cron:job-1 科技早报] 第二次' },
        { role: 'assistant', content: '第二次结果' },
      ],
    }),
    onStatus: () => () => {},
    getStatus: () => 'connected',
  } as never;

  await (adapter as unknown as {
    syncCronRunHistory: (sessionId: string, sessionKey: string) => Promise<void>;
  }).syncCronRunHistory(session.id, 'agent:main:cron:job-1:run:run-2');

  expect(session.messages.map(message => ({
    type: message.type,
    content: message.content,
  }))).toEqual([
    { type: 'user', content: '[cron:job-1 科技早报] 第一次' },
    { type: 'assistant', content: '第一次结果' },
    { type: 'user', content: '[cron:job-1 科技早报] 第二次' },
    { type: 'assistant', content: '第二次结果' },
  ]);
});

test('reconcileWithHistory: already in sync — skips replace', async () => {
  const { session, store, getReplaceCallCount } = createReconcileStore([
    { id: 'msg-1', type: 'user', content: 'Hello', timestamp: 1, metadata: {} },
    { id: 'msg-2', type: 'assistant', content: 'Hi there', timestamp: 2, metadata: {} },
  ]);

  const adapter = new OpenClawRuntimeAdapter(store, {});
  adapter.gatewayClient = {
    start: () => {},
    stop: () => {},
    request: async () => ({
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
      ],
    }),
  };

  await adapter.reconcileWithHistory(session.id, 'managed:session-1');

  expect(getReplaceCallCount()).toBe(0);
  expect(session.messages.length).toBe(2);
});

test('reconcileWithHistory: missing assistant message — triggers replace', async () => {
  const { session, store, getReplaceCallCount, getLastReplaceArgs } = createReconcileStore([
    { id: 'msg-1', type: 'user', content: 'Hello', timestamp: 1, metadata: {} },
    // assistant message missing locally
  ]);

  const adapter = new OpenClawRuntimeAdapter(store, {});
  adapter.gatewayClient = {
    start: () => {},
    stop: () => {},
    request: async () => ({
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
      ],
    }),
  };

  await adapter.reconcileWithHistory(session.id, 'managed:session-1');

  expect(getReplaceCallCount()).toBe(1);
  const args = getLastReplaceArgs()!;
  expect(args.sessionId).toBe(session.id);
  expect(args.authoritative).toEqual([
    { role: 'user', text: 'Hello', timestamp: 1 },
    { role: 'assistant', text: 'Hi there' },
  ]);
});

test('reconcileWithHistory: carries gateway timestamps into replacement entries', async () => {
  const { session, store, getLastReplaceArgs } = createReconcileStore([
    { id: 'msg-1', type: 'user', content: 'Hello', timestamp: 1, metadata: {} },
  ]);

  const adapter = new OpenClawRuntimeAdapter(store, {});
  adapter.gatewayClient = {
    start: () => {},
    stop: () => {},
    request: async () => ({
      messages: [
        { role: 'user', content: 'Hello', timestamp: 5000 },
        { role: 'assistant', content: 'Hi there', timestamp: 6000 },
      ],
    }),
  };

  await adapter.reconcileWithHistory(session.id, 'managed:session-1');

  expect(getLastReplaceArgs()?.authoritative).toEqual([
    { role: 'user', text: 'Hello', timestamp: 5000 },
    { role: 'assistant', text: 'Hi there', timestamp: 6000 },
  ]);
});

test('reconcileWithHistory: filters heartbeat prompt and ack entries', async () => {
  const { session, store, getReplaceCallCount, getLastReplaceArgs } = createReconcileStore([
    { id: 'msg-1', type: 'user', content: 'Hello', timestamp: 1, metadata: {} },
  ]);

  const adapter = new OpenClawRuntimeAdapter(store, {});
  adapter.gatewayClient = {
    start: () => {},
    stop: () => {},
    request: async () => ({
      messages: [
        { role: 'user', content: 'Hello' },
        {
          role: 'user',
          content: `Read HEARTBEAT.md if it exists.
When reading HEARTBEAT.md, use workspace file /tmp/HEARTBEAT.md.
Do not infer or repeat old tasks from prior chats.
If nothing needs attention, reply HEARTBEAT_OK.`,
        },
        { role: 'assistant', content: 'HEARTBEAT_OK' },
        { role: 'assistant', content: 'Real answer' },
      ],
    }),
  };

  await adapter.reconcileWithHistory(session.id, 'managed:session-1');

  expect(getReplaceCallCount()).toBe(1);
  expect(getLastReplaceArgs()?.authoritative).toEqual([
    { role: 'user', text: 'Hello', timestamp: 1 },
    { role: 'assistant', text: 'Real answer' },
  ]);
});

test('reconcileWithHistory: filters pre-compaction memory flush and silent entries', async () => {
  const { session, store, getReplaceCallCount, getLastReplaceArgs } = createReconcileStore([
    { id: 'msg-1', type: 'user', content: 'Build the page', timestamp: 1, metadata: {} },
  ]);

  const adapter = new OpenClawRuntimeAdapter(store, {});
  adapter.gatewayClient = {
    start: () => {},
    stop: () => {},
    request: async () => ({
      messages: [
        { role: 'user', content: 'Build the page' },
        {
          role: 'user',
          content: `Pre-compaction memory flush. Store durable memories only in memory/2026-05-09.md (create memory/ if needed). Treat workspace bootstrap/reference files such as MEMORY.md as read-only during this flush. If nothing to store, reply with NO_REPLY.`,
        },
        { role: 'assistant', content: 'NO_REPLY' },
        { role: 'assistant', content: 'Created index-en.html' },
      ],
    }),
  };

  await adapter.reconcileWithHistory(session.id, 'managed:session-1');

  expect(getReplaceCallCount()).toBe(1);
  expect(getLastReplaceArgs()?.authoritative).toEqual([
    { role: 'user', text: 'Build the page', timestamp: 1 },
    { role: 'assistant', text: 'Created index-en.html' },
  ]);
});

test('reconcileWithHistory: duplicate messages locally — triggers replace', async () => {
  const { session, store, getReplaceCallCount, getLastReplaceArgs } = createReconcileStore([
    { id: 'msg-1', type: 'user', content: 'Hello', timestamp: 1, metadata: {} },
    { id: 'msg-2', type: 'assistant', content: 'Hi there', timestamp: 2, metadata: {} },
    { id: 'msg-3', type: 'assistant', content: 'Hi there', timestamp: 3, metadata: {} }, // duplicate
  ]);

  const adapter = new OpenClawRuntimeAdapter(store, {});
  adapter.gatewayClient = {
    start: () => {},
    stop: () => {},
    request: async () => ({
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
      ],
    }),
  };

  await adapter.reconcileWithHistory(session.id, 'managed:session-1');

  // Gateway is authoritative — replaces to fix duplicates
  expect(getReplaceCallCount()).toBe(1);
  const args = getLastReplaceArgs()!;
  expect(args.authoritative.length).toBe(2);
});

test('reconcileWithHistory: content mismatch — triggers replace', async () => {
  const { session, store, getReplaceCallCount, getLastReplaceArgs } = createReconcileStore([
    { id: 'msg-1', type: 'user', content: 'Hello', timestamp: 1, metadata: {} },
    { id: 'msg-2', type: 'assistant', content: 'Streaming partial...', timestamp: 2, metadata: {} },
  ]);

  const adapter = new OpenClawRuntimeAdapter(store, {});
  adapter.gatewayClient = {
    start: () => {},
    stop: () => {},
    request: async () => ({
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Full complete response from the model.' },
      ],
    }),
  };

  await adapter.reconcileWithHistory(session.id, 'managed:session-1');

  expect(getReplaceCallCount()).toBe(1);
  const args = getLastReplaceArgs()!;
  expect((args.authoritative[1] as Record<string, unknown>).text).toBe('Full complete response from the model.');
});

test('lifecycle fallback repairs managed session assistant text from history', async () => {
  const brokenTable = [
    'OpenClaw 优缺点总结',
    '',
    '| 维度 | 优点 ✅ | 缺点 ❌ |',
    '|---------|',
    '| 架构设计 | 单 Gateway | 单点风险 |',
  ].join('\n');
  const finalTable = [
    'OpenClaw 优缺点总结',
    '',
    '| 维度 | 优点 ✅ | 缺点 ❌ |',
    '|------|---------|---------|',
    '| 架构设计 | 单 Gateway | 单点风险 |',
  ].join('\n');
  const { session, store, getReplaceCallCount } = createReconcileStore([
    { id: 'msg-1', type: 'user', content: '以表格总结 OpenClaw', timestamp: 1, metadata: {} },
    { id: 'msg-2', type: 'assistant', content: brokenTable, timestamp: 2, metadata: { isStreaming: true } },
  ]);

  const adapter = new OpenClawRuntimeAdapter(store, {});
  adapter.gatewayClient = {
    start: () => {},
    stop: () => {},
    request: async () => ({
      messages: [
        { role: 'user', content: '以表格总结 OpenClaw' },
        { role: 'assistant', content: finalTable },
      ],
    }),
  };

  const turn = {
    sessionId: session.id,
    sessionKey: `agent:main:popiai:${session.id}`,
    runId: 'run-1',
    turnToken: 1,
    startedAtMs: 1,
    knownRunIds: new Set(['run-1']),
    assistantMessageId: 'msg-2',
    committedAssistantText: '',
    currentAssistantSegmentText: brokenTable,
    currentText: brokenTable,
    agentAssistantTextLength: brokenTable.length,
    currentContentText: brokenTable,
    currentContentBlocks: [brokenTable],
    sawNonTextContentBlocks: false,
    textStreamMode: 'snapshot',
    toolUseMessageIdByToolCallId: new Map(),
    toolResultMessageIdByToolCallId: new Map(),
    toolResultTextByToolCallId: new Map(),
    contextMaintenanceToolCallIds: new Set(),
    stopRequested: false,
    pendingUserSync: false,
    bufferedChatPayloads: [],
    bufferedAgentPayloads: [],
  };

  adapter.activeTurns.set(session.id, turn);
  adapter.latestTurnTokenBySession.set(session.id, turn.turnToken);

  await adapter.completeChannelTurnFallback(session.id, turn);

  expect(getReplaceCallCount()).toBe(0);
  expect(session.messages.find((message) => message.id === 'msg-2')?.content).toBe(finalTable);
  expect(session.status).toBe('completed');
});

test('lifecycle fallback backfills missing tool result for the current turn', async () => {
  const { session, store } = createReconcileStore([
    { id: 'msg-1', type: 'user', content: 'read the gateway log', timestamp: 1, metadata: {} },
    { id: 'msg-2', type: 'tool_use', content: 'Using tool: read', timestamp: 2, metadata: { toolUseId: 'call-read' } },
  ]);
  const adapter = new OpenClawRuntimeAdapter(store, {});
  const sessionKey = `agent:main:popiai:${session.id}`;

  adapter.gatewayClient = {
    start: () => {},
    stop: () => {},
    request: async () => ({
      messages: [
        { role: 'user', content: 'read the gateway log' },
        {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'Need to inspect the log.' },
            { type: 'toolCall', id: 'call-read', name: 'read', arguments: { path: 'gateway.log' } },
          ],
        },
        { role: 'toolResult', toolCallId: 'call-read', content: 'gateway log output' },
        { role: 'assistant', content: 'The gateway log shows a clean shutdown.' },
      ],
    }),
  };

  const turn = createActiveTurn(session.id, sessionKey, 'run-fallback-tool');
  turn.toolUseMessageIdByToolCallId.set('call-read', 'msg-2');
  adapter.activeTurns.set(session.id, turn);
  adapter.latestTurnTokenBySession.set(session.id, turn.turnToken);

  await adapter.completeChannelTurnFallback(session.id, turn);

  const resultMessage = session.messages.find((message) => (
    message.type === 'tool_result'
    && message.metadata?.toolUseId === 'call-read'
  ));
  expect(resultMessage?.content).toBe('gateway log output');
  expect(session.status).toBe('completed');
});

test('history thinking reconciliation reuses a finalized stream thinking message before a tool', async () => {
  const { session, store } = createReconcileStore([
    { id: 'msg-1', type: 'user', content: 'read the gateway log', timestamp: 1, metadata: {} },
  ]);
  const adapter = new OpenClawRuntimeAdapter(store, {});
  const sessionKey = `agent:main:popiai:${session.id}`;
  const turn = createActiveTurn(session.id, sessionKey, 'run-thinking-reuse');
  turn.currentThinkingText = 'Need to inspect the log.';
  adapter.activeTurns.set(session.id, turn);

  adapter.syncThinkingMessage(session.id, turn);
  const thinkingMessageId = turn.thinkingMessageId;
  expect(thinkingMessageId).toBeTruthy();

  const finalizedThinkingMessageId = adapter.splitAssistantSegmentBeforeTool(session.id, turn);
  expect(finalizedThinkingMessageId).toBe(thinkingMessageId);

  const toolUseMessage = store.addMessage(session.id, {
    type: 'tool_use',
    content: 'Using tool: read',
    metadata: { toolUseId: 'call-read' },
  });
  turn.toolUseMessageIdByToolCallId.set('call-read', toolUseMessage.id);
  turn.thinkingMessageIdByKey = new Map([['tool:call-read:thinking:0', thinkingMessageId]]);

  adapter.syncThinkingBlocksFromHistory(session.id, turn, [
    { role: 'user', content: 'read the gateway log' },
    {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'Need to inspect the log.' },
        { type: 'toolCall', id: 'call-read', name: 'read', arguments: { path: 'gateway.log' } },
      ],
    },
  ], { includeUnanchored: false });

  const thinkingMessages = session.messages.filter((message) => message.metadata?.isThinking === true);
  expect(thinkingMessages).toHaveLength(1);
  expect(thinkingMessages[0].id).toBe(thinkingMessageId);
  expect(thinkingMessages[0].metadata).toMatchObject({
    isFinal: true,
    isStreaming: false,
    openclawThinkingAnchorToolCallId: 'call-read',
    openclawThinkingKey: 'tool:call-read:thinking:0',
  });
});

test('agent thinking stream creates and updates a streaming thinking message', async () => {
  const { session, store } = createReconcileStore([
    { id: 'msg-1', type: 'user', content: 'read the gateway log', timestamp: 1, metadata: {} },
  ]);
  const adapter = new OpenClawRuntimeAdapter(store, {});
  const sessionKey = `agent:main:popiai:${session.id}`;
  const messageUpdateSpy = vi.fn();
  const turn = createActiveTurn(session.id, sessionKey, 'run-thinking-stream');
  adapter.on('messageUpdate', messageUpdateSpy);
  adapter.activeTurns.set(session.id, turn);
  adapter.sessionIdByRunId.set('run-thinking-stream', session.id);
  adapter.rememberSessionKey(session.id, sessionKey);

  adapter.handleAgentEvent({
    runId: 'run-thinking-stream',
    sessionKey,
    stream: 'thinking',
    data: { text: 'Need to inspect the log.' },
  }, 1);

  const thinkingMessages = session.messages.filter((message) => message.metadata?.isThinking === true);
  expect(thinkingMessages).toHaveLength(1);
  expect(thinkingMessages[0]).toMatchObject({
    content: 'Need to inspect the log.',
    metadata: {
      isThinking: true,
      isStreaming: true,
      isFinal: false,
    },
  });
  expect(turn.thinkingMessageId).toBe(thinkingMessages[0].id);

  adapter.handleAgentEvent({
    runId: 'run-thinking-stream',
    sessionKey,
    stream: 'thinking',
    data: { text: 'Need to inspect the log. Then compare gateway events.' },
  }, 2);

  expect(messageUpdateSpy).toHaveBeenCalledWith(
    session.id,
    thinkingMessages[0].id,
    'Need to inspect the log. Then compare gateway events.',
    expect.objectContaining({
      isThinking: true,
      isStreaming: true,
      isFinal: false,
    }),
  );
});

test('agent thinking stream preserves formatting and rewrites the active thinking message', () => {
  const { session, store } = createReconcileStore([
    { id: 'msg-1', type: 'user', content: 'review the flow', timestamp: 1, metadata: {} },
  ]);
  const adapter = new OpenClawRuntimeAdapter(store, {});
  const sessionKey = `agent:main:popiai:${session.id}`;
  const messageUpdateSpy = vi.fn();
  const turn = createActiveTurn(session.id, sessionKey, 'run-thinking-format');
  adapter.on('messageUpdate', messageUpdateSpy);
  adapter.activeTurns.set(session.id, turn);
  adapter.sessionIdByRunId.set('run-thinking-format', session.id);
  adapter.rememberSessionKey(session.id, sessionKey);

  adapter.handleAgentEvent({
    runId: 'run-thinking-format',
    sessionKey,
    stream: 'thinking',
    data: { text: '\n  First line\n    indented detail\n' },
  }, 1);

  const initialThinkingMessages = session.messages.filter((message) => message.metadata?.isThinking === true);
  expect(initialThinkingMessages).toHaveLength(1);
  expect(initialThinkingMessages[0].content).toBe('\n  First line\n    indented detail\n');

  adapter.handleAgentEvent({
    runId: 'run-thinking-format',
    sessionKey,
    stream: 'thinking',
    data: { text: 'Rewritten reasoning snapshot.' },
  }, 2);

  const thinkingMessages = session.messages.filter((message) => message.metadata?.isThinking === true);
  expect(thinkingMessages).toHaveLength(1);
  expect(thinkingMessages[0].content).toBe('Rewritten reasoning snapshot.');
  expect(messageUpdateSpy).toHaveBeenCalledWith(
    session.id,
    thinkingMessages[0].id,
    'Rewritten reasoning snapshot.',
    expect.objectContaining({
      isThinking: true,
      isStreaming: true,
      isFinal: false,
    }),
  );
});

test('lifecycle fallback waits when history sync returns a short assistant segment after large tool results', async () => {
  vi.useFakeTimers();
  try {
    const interimAnswer = 'Let me check the main log around that time before I give the conclusion.';
    const finalAnswer = `Final answer: the retry after context compaction continued the same OpenClaw run. ${
      'The client must keep the turn open until the retry attempt reaches a stable final event, and the closed-run guard must not drop the same run id continuation. '.repeat(5)
    }`;
    const largeToolResult = 'gateway log line with context overflow evidence\n'.repeat(900);
    let historyAnswer = interimAnswer;
    const { session, store } = createReconcileStore([
      { id: 'msg-1', type: 'user', content: 'analyze the latest logs', timestamp: 1, metadata: {} },
      { id: 'msg-2', type: 'tool_use', content: 'Using grep', timestamp: 2, metadata: { toolUseId: 'call-grep' } },
      { id: 'msg-3', type: 'tool_result', content: 'partial log output', timestamp: 3, metadata: { toolUseId: 'call-grep' } },
    ]);
    const adapter = new OpenClawRuntimeAdapter(store, {});
    const sessionKey = `agent:main:popiai:${session.id}`;
    const completeSpy = vi.fn();
    const maintenanceSpy = vi.fn();

    adapter.gatewayClient = {
      start: () => {},
      stop: () => {},
      request: async (method: string) => {
        if (method !== 'chat.history') return {};
        return {
          messages: [
            { role: 'user', content: 'analyze the latest logs' },
            {
              role: 'assistant',
              content: [
                { type: 'toolCall', id: 'call-grep', name: 'exec', arguments: { command: 'grep restart gateway.log' } },
              ],
            },
            { role: 'toolResult', toolCallId: 'call-grep', content: largeToolResult },
            { role: 'assistant', content: historyAnswer },
          ],
        };
      },
    };

    session.status = 'running';
    adapter.on('complete', completeSpy);
    adapter.on('contextMaintenance', maintenanceSpy);
    const turn = createActiveTurn(session.id, sessionKey, 'run-lifecycle-retry');
    turn.toolUseMessageIdByToolCallId.set('call-grep', 'msg-2');
    turn.toolResultMessageIdByToolCallId.set('call-grep', 'msg-3');
    adapter.activeTurns.set(session.id, turn);
    adapter.latestTurnTokenBySession.set(session.id, turn.turnToken);
    adapter.rememberSessionKey(session.id, sessionKey);

    adapter.handleAgentEvent({
      runId: 'run-lifecycle-retry',
      sessionKey,
      stream: 'lifecycle',
      data: { phase: 'end' },
    }, 1);

    await vi.advanceTimersByTimeAsync(1_000);
    await Promise.resolve();
    await Promise.resolve();

    expect(completeSpy).not.toHaveBeenCalled();
    expect(session.status).toBe('running');
    expect(maintenanceSpy).toHaveBeenCalledWith(session.id, true);
    expect(adapter.activeTurns.get(session.id)?.pendingOpenClawRetry).toBe(true);
    expect(session.messages.some((message) => (
      message.type === 'assistant'
      && message.content === interimAnswer
    ))).toBe(true);

    historyAnswer = finalAnswer;
    adapter.handleAgentEvent({
      runId: 'run-lifecycle-retry',
      sessionKey,
      stream: 'lifecycle',
      data: { phase: 'start' },
    }, 2);
    adapter.processAgentAssistantText({
      runId: 'run-lifecycle-retry',
      sessionKey,
      stream: 'assistant',
      data: { text: finalAnswer },
    });

    expect(maintenanceSpy).toHaveBeenLastCalledWith(session.id, false);
    expect(session.messages.some((message) => (
      message.type === 'assistant'
      && message.content.includes('Final answer: the retry after context compaction')
    ))).toBe(true);

    adapter.handleChatEvent({
      state: 'final',
      runId: 'run-lifecycle-retry',
      sessionKey,
      message: { role: 'assistant', content: finalAnswer },
    }, 3);
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(800);

    expect(completeSpy).toHaveBeenCalledWith(session.id, 'run-lifecycle-retry');
    expect(session.status).toBe('completed');
  } finally {
    vi.useRealTimers();
  }
});

test('assistant stream inserts OpenAI reasoning block before visible assistant text', () => {
  const { session, store } = createReconcileStore([
    { id: 'msg-1', type: 'user', content: 'explain the plan', timestamp: 1, metadata: {} },
  ]);
  const adapter = new OpenClawRuntimeAdapter(store, {});
  const sessionKey = `agent:main:popiai:${session.id}`;
  const messageSpy = vi.fn();
  const updateSpy = vi.fn();

  session.status = 'running';
  adapter.on('message', messageSpy);
  adapter.on('messageUpdate', updateSpy);
  const turn = createActiveTurn(session.id, sessionKey, 'run-reasoning');
  adapter.activeTurns.set(session.id, turn);
  adapter.sessionIdByRunId.set('run-reasoning', session.id);
  adapter.rememberSessionKey(session.id, sessionKey);

  adapter.processAgentAssistantText({
    runId: 'run-reasoning',
    sessionKey,
    stream: 'assistant',
    data: { text: 'Visible answer.' },
  });
  adapter.processAgentAssistantText({
    runId: 'run-reasoning',
    sessionKey,
    stream: 'assistant',
    data: {
      text: 'Visible answer.',
      reasoning_content: 'Need to explain the plan first.',
    },
  });

  const assistantMessages = session.messages.filter((message) => message.type === 'assistant');
  expect(assistantMessages).toHaveLength(2);
  expect(assistantMessages.map((message) => message.metadata?.isThinking === true)).toEqual([true, false]);
  expect(assistantMessages.map((message) => message.content)).toEqual([
    'Need to explain the plan first.',
    'Visible answer.',
  ]);
  expect(messageSpy).toHaveBeenCalledWith(
    session.id,
    expect.objectContaining({
      content: 'Need to explain the plan first.',
      metadata: expect.objectContaining({ isThinking: true }),
    }),
    assistantMessages[1].id,
  );
});

test('chat final backfills only current-turn tool results from history', async () => {
  vi.useFakeTimers();
  try {
    const { session, store } = createReconcileStore([
      { id: 'msg-1', type: 'user', content: 'remember the gateway restart?', timestamp: 1, metadata: {} },
      { id: 'msg-2', type: 'tool_use', content: 'Using tool: memory_search', timestamp: 2, metadata: { toolUseId: 'call-current' } },
      { id: 'msg-3', type: 'assistant', content: 'working', timestamp: 3, metadata: { isStreaming: true } },
    ]);
    const adapter = new OpenClawRuntimeAdapter(store, {});
    const sessionKey = `agent:main:popiai:${session.id}`;
    const historyMessages = [
      { role: 'user', content: 'old question' },
      {
        role: 'assistant',
        content: [
          { type: 'toolCall', id: 'call-old', name: 'exec', arguments: { command: 'cat old.log' } },
        ],
      },
      { role: 'toolResult', toolCallId: 'call-old', content: 'old log output' },
      { role: 'user', content: 'remember the gateway restart?' },
      {
        role: 'assistant',
        content: [
          { type: 'toolCall', id: 'call-current', name: 'memory_search', arguments: { query: 'gateway restart' } },
        ],
      },
      { role: 'toolResult', toolCallId: 'call-current', content: 'current memory result' },
      { role: 'assistant', content: 'I remember the gateway restart analysis.' },
    ];

    adapter.gatewayClient = {
      start: () => {},
      stop: () => {},
      request: async () => ({ messages: historyMessages }),
    };

    const turn = createActiveTurn(session.id, sessionKey, 'run-current');
    turn.assistantMessageId = 'msg-3';
    turn.toolUseMessageIdByToolCallId.set('call-current', 'msg-2');
    adapter.activeTurns.set(session.id, turn);
    adapter.latestTurnTokenBySession.set(session.id, turn.turnToken);

    adapter.handleChatEvent({
      state: 'final',
      runId: 'run-current',
      sessionKey,
      message: { role: 'assistant', content: 'I remember the gateway restart analysis.' },
    }, 1);
    await Promise.resolve();
    await Promise.resolve();

    const toolResults = session.messages.filter((message) => message.type === 'tool_result');
    expect(toolResults).toHaveLength(1);
    expect(toolResults[0].metadata?.toolUseId).toBe('call-current');
    expect(toolResults[0].content).toBe('current memory result');
    expect(session.messages.some((message) => message.metadata?.toolUseId === 'call-old')).toBe(false);

    await vi.advanceTimersByTimeAsync(800);
    expect(session.status).toBe('completed');
  } finally {
    vi.useRealTimers();
  }
});

test('chat final repairs managed session assistant text from history', async () => {
  vi.useFakeTimers();
  try {
    const corruptedText = 'Created file://Users/admin/report.pptx';
    const canonicalText = 'Created file:///Users/admin/report.pptx';
    const { session, store } = createReconcileStore([
      { id: 'msg-1', type: 'user', content: 'create a ppt', timestamp: 1, metadata: {} },
      { id: 'msg-2', type: 'assistant', content: corruptedText, timestamp: 2, metadata: { isStreaming: true } },
    ]);

    const adapter = new OpenClawRuntimeAdapter(store, {});
    const sessionKey = `agent:main:popiai:${session.id}`;
    adapter.gatewayClient = {
      start: () => {},
      stop: () => {},
      request: async () => ({
        messages: [
          { role: 'user', content: 'create a ppt' },
          { role: 'assistant', content: canonicalText },
        ],
      }),
    };

    const turn = createActiveTurn(session.id, sessionKey, 'run-1');
    turn.assistantMessageId = 'msg-2';
    turn.currentAssistantSegmentText = corruptedText;
    turn.currentText = corruptedText;
    turn.currentContentText = corruptedText;
    turn.currentContentBlocks = [corruptedText];
    adapter.activeTurns.set(session.id, turn);
    adapter.latestTurnTokenBySession.set(session.id, turn.turnToken);

    adapter.handleChatEvent({
      state: 'final',
      runId: 'run-1',
      sessionKey,
      message: { role: 'assistant', content: corruptedText },
    }, 1);
    await Promise.resolve();
    await Promise.resolve();

    expect(session.messages.find((message) => message.id === 'msg-2')?.content).toBe(canonicalText);

    await vi.advanceTimersByTimeAsync(800);
    expect(session.status).toBe('completed');
  } finally {
    vi.useRealTimers();
  }
});

test('chat final repairs last segment with corrupted committed text from tool calls', async () => {
  vi.useFakeTimers();
  try {
    const committedSegment = 'I will create a file for you.';
    const corruptedLastSegment = 'Done! Created file://Users/admin/report.pptx';
    const canonicalLastSegment = 'Done! Created file:///Users/admin/report.pptx';
    const { session, store } = createReconcileStore([
      { id: 'msg-1', type: 'user', content: 'create a ppt', timestamp: 1, metadata: {} },
      { id: 'msg-2', type: 'assistant', content: committedSegment, timestamp: 2, metadata: { isStreaming: false, isFinal: true } },
      { id: 'msg-3', type: 'tool_use', content: 'write_file', timestamp: 3, metadata: {} },
      { id: 'msg-4', type: 'tool_result', content: 'file created', timestamp: 4, metadata: {} },
      { id: 'msg-5', type: 'assistant', content: corruptedLastSegment, timestamp: 5, metadata: { isStreaming: true } },
    ]);

    const adapter = new OpenClawRuntimeAdapter(store, {});
    const sessionKey = `agent:main:popiai:${session.id}`;
    adapter.gatewayClient = {
      start: () => {},
      stop: () => {},
      request: async () => ({
        messages: [
          { role: 'user', content: 'create a ppt' },
          { role: 'assistant', content: committedSegment },
          { role: 'assistant', content: canonicalLastSegment },
        ],
      }),
    };

    const turn = createActiveTurn(session.id, sessionKey, 'run-1');
    turn.assistantMessageId = 'msg-5';
    turn.committedAssistantText = committedSegment;
    turn.currentAssistantSegmentText = corruptedLastSegment;
    turn.currentText = `${committedSegment}\n\n${corruptedLastSegment}`;
    turn.currentContentText = `${committedSegment}\n\n${corruptedLastSegment}`;
    turn.currentContentBlocks = [`${committedSegment}\n\n${corruptedLastSegment}`];
    adapter.activeTurns.set(session.id, turn);
    adapter.latestTurnTokenBySession.set(session.id, turn.turnToken);

    adapter.handleChatEvent({
      state: 'final',
      runId: 'run-1',
      sessionKey,
      message: { role: 'assistant', content: `${committedSegment}\n\n${corruptedLastSegment}` },
    }, 1);
    await Promise.resolve();
    await Promise.resolve();

    expect(session.messages.find((message) => message.id === 'msg-5')?.content).toBe(canonicalLastSegment);
    expect(session.messages.find((message) => message.id === 'msg-2')?.content).toBe(committedSegment);

    await vi.advanceTimersByTimeAsync(800);
    expect(session.status).toBe('completed');
  } finally {
    vi.useRealTimers();
  }
});

test('late lifecycle fallback event does not reopen a completed managed session', () => {
  const { session, store } = createReconcileStore([
    { id: 'msg-1', type: 'user', content: '你是哪个模型', timestamp: 1, metadata: {} },
    {
      id: 'msg-2',
      type: 'assistant',
      content: '当前会话使用的是 qwen-portal/qwen3.6-plus 模型。',
      timestamp: 2,
      metadata: { isStreaming: false, isFinal: true },
    },
  ]);
  const adapter = new OpenClawRuntimeAdapter(store, {});
  const sessionKey = `agent:main:popiai:${session.id}`;

  adapter.rememberSessionKey(session.id, sessionKey);
  adapter.handleGatewayEvent({
    event: 'agent',
    seq: 1,
    payload: {
      runId: 'late-run',
      sessionKey,
      stream: 'lifecycle',
      data: { phase: 'fallback' },
    },
  });

  expect(session.status).toBe('completed');
  expect(adapter.activeTurns.has(session.id)).toBe(false);
  expect(adapter.sessionIdByRunId.has('late-run')).toBe(false);
});

test('late event for a closed run does not recreate a managed session turn', () => {
  const { session, store } = createReconcileStore([
    { id: 'msg-1', type: 'user', content: 'hello', timestamp: 1, metadata: {} },
    { id: 'msg-2', type: 'assistant', content: 'done', timestamp: 2, metadata: { isStreaming: false, isFinal: true } },
  ]);
  const adapter = new OpenClawRuntimeAdapter(store, {});
  const sessionKey = `agent:main:popiai:${session.id}`;

  adapter.rememberSessionKey(session.id, sessionKey);
  adapter.ensureActiveTurn(session.id, sessionKey, 'closed-run');
  session.status = 'completed';
  adapter.cleanupSessionTurn(session.id);

  adapter.handleGatewayEvent({
    event: 'agent',
    seq: 2,
    payload: {
      runId: 'closed-run',
      sessionKey,
      stream: 'lifecycle',
      data: { phase: 'start' },
    },
  });

  expect(session.status).toBe('completed');
  expect(adapter.activeTurns.has(session.id)).toBe(false);
  expect(adapter.sessionIdByRunId.has('closed-run')).toBe(false);
});

test('retryable closed run reopens on same-run lifecycle start', () => {
  const { session, store } = createReconcileStore([
    { id: 'msg-1', type: 'user', content: 'hello', timestamp: 1, metadata: {} },
    { id: 'msg-2', type: 'assistant', content: 'interim', timestamp: 2, metadata: { isStreaming: false, isFinal: true } },
  ]);
  const adapter = new OpenClawRuntimeAdapter(store, {});
  const sessionKey = `agent:main:popiai:${session.id}`;

  adapter.rememberSessionKey(session.id, sessionKey);
  adapter.ensureActiveTurn(session.id, sessionKey, 'retry-run');
  const turn = adapter.activeTurns.get(session.id);
  expect(turn).toBeTruthy();
  if (turn) {
    turn.allowRecentlyClosedRunRetryReopenOnCleanup = true;
  }
  session.status = 'completed';
  adapter.cleanupSessionTurn(session.id);

  adapter.handleGatewayEvent({
    event: 'agent',
    seq: 2,
    payload: {
      runId: 'retry-run',
      sessionKey,
      stream: 'lifecycle',
      data: { phase: 'start' },
    },
  });

  expect(session.status).toBe('running');
  expect(adapter.activeTurns.has(session.id)).toBe(true);
  expect(adapter.sessionIdByRunId.get('retry-run')).toBe(session.id);

  adapter.handleGatewayEvent({
    event: 'agent',
    seq: 3,
    payload: {
      runId: 'retry-run',
      sessionKey,
      stream: 'assistant',
      data: { text: 'final answer after retry' },
    },
  });

  expect(session.messages.some((message) => (
    message.type === 'assistant'
    && message.content === 'final answer after retry'
  ))).toBe(true);
});

test('chat final completes after the retry grace window', async () => {
  vi.useFakeTimers();
  try {
    const { session, store } = createReconcileStore([
      { id: 'msg-1', type: 'user', content: 'hello', timestamp: 1, metadata: {} },
    ]);
    const adapter = new OpenClawRuntimeAdapter(store, {});
    const sessionKey = `agent:main:popiai:${session.id}`;
    const completeSpy = vi.fn();

    session.status = 'running';
    adapter.reconcileWithHistory = async () => {};
    adapter.on('complete', completeSpy);
    adapter.activeTurns.set(session.id, createActiveTurn(session.id, sessionKey, 'run-final'));

    adapter.handleChatEvent({
      state: 'final',
      runId: 'run-final',
      sessionKey,
      message: { role: 'assistant', content: 'Done' },
    }, 1);
    await Promise.resolve();
    await Promise.resolve();

    await vi.advanceTimersByTimeAsync(799);
    expect(completeSpy).not.toHaveBeenCalled();
    expect(session.status).toBe('running');

    await vi.advanceTimersByTimeAsync(1);
    expect(completeSpy).toHaveBeenCalledWith(session.id, 'run-final');
    expect(session.status).toBe('completed');
  } finally {
    vi.useRealTimers();
  }
});

test('chat final completion is postponed when the same run continues streaming', async () => {
  vi.useFakeTimers();
  try {
    const { session, store } = createReconcileStore([
      { id: 'msg-1', type: 'user', content: 'hello', timestamp: 1, metadata: {} },
    ]);
    const adapter = new OpenClawRuntimeAdapter(store, {});
    const sessionKey = `agent:main:popiai:${session.id}`;
    const completeSpy = vi.fn();

    session.status = 'running';
    adapter.reconcileWithHistory = async () => {};
    adapter.on('complete', completeSpy);
    adapter.activeTurns.set(session.id, createActiveTurn(session.id, sessionKey, 'run-retry'));

    adapter.handleChatEvent({
      state: 'final',
      runId: 'run-retry',
      sessionKey,
      message: { role: 'assistant', content: 'Done' },
    }, 1);
    await Promise.resolve();
    await Promise.resolve();

    await vi.advanceTimersByTimeAsync(400);
    adapter.handleChatEvent({
      state: 'delta',
      runId: 'run-retry',
      sessionKey,
      message: { role: 'assistant', content: 'Still running after retry' },
    }, 2);

    await vi.advanceTimersByTimeAsync(700);
    expect(completeSpy).not.toHaveBeenCalled();
    expect(session.status).toBe('running');
    expect(adapter.activeTurns.has(session.id)).toBe(true);

    await vi.advanceTimersByTimeAsync(100);
    expect(completeSpy).toHaveBeenCalledWith(session.id, 'run-retry');
    expect(session.status).toBe('completed');
    expect(adapter.activeTurns.has(session.id)).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});

test('lifecycle end completes a pending chat final immediately', async () => {
  vi.useFakeTimers();
  try {
    const { session, store } = createReconcileStore([
      { id: 'msg-1', type: 'user', content: 'hello', timestamp: 1, metadata: {} },
    ]);
    const adapter = new OpenClawRuntimeAdapter(store, {});
    const sessionKey = `agent:main:popiai:${session.id}`;
    const completeSpy = vi.fn();

    session.status = 'running';
    adapter.reconcileWithHistory = async () => {};
    adapter.on('complete', completeSpy);
    adapter.activeTurns.set(session.id, createActiveTurn(session.id, sessionKey, 'run-final'));

    adapter.handleChatEvent({
      state: 'final',
      runId: 'run-final',
      sessionKey,
      message: { role: 'assistant', content: 'Done' },
    }, 1);
    await Promise.resolve();
    await Promise.resolve();

    await vi.advanceTimersByTimeAsync(1_000);
    adapter.handleAgentLifecycleEvent(session.id, { phase: 'end' }, 'run-final');

    expect(completeSpy).toHaveBeenCalledWith(session.id, 'run-final');
    expect(session.status).toBe('completed');
    expect(adapter.activeTurns.has(session.id)).toBe(false);

    await vi.advanceTimersByTimeAsync(800);
    expect(completeSpy).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});

test('chat final completion is canceled when tool work continues after final', async () => {
  vi.useFakeTimers();
  try {
    const { session, store } = createReconcileStore([
      { id: 'msg-1', type: 'user', content: 'hello', timestamp: 1, metadata: {} },
    ]);
    const adapter = new OpenClawRuntimeAdapter(store, {});
    const sessionKey = `agent:main:popiai:${session.id}`;
    const completeSpy = vi.fn();

    session.status = 'running';
    adapter.reconcileWithHistory = async () => {};
    adapter.on('complete', completeSpy);
    adapter.activeTurns.set(session.id, createActiveTurn(session.id, sessionKey, 'run-retry'));

    adapter.handleChatEvent({
      state: 'final',
      runId: 'run-retry',
      sessionKey,
      message: { role: 'assistant', content: 'Done' },
    }, 1);
    await Promise.resolve();
    await Promise.resolve();

    await vi.advanceTimersByTimeAsync(400);
    adapter.handleAgentEvent({
      runId: 'run-retry',
      sessionKey,
      stream: 'tool',
      data: { toolCallId: 'call-1', status: 'started', name: 'exec' },
    }, 2);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(completeSpy).not.toHaveBeenCalled();
    expect(session.status).toBe('running');
    expect(adapter.activeTurns.has(session.id)).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});

test('tool-use chat final keeps the session running until tool work arrives', async () => {
  vi.useFakeTimers();
  try {
    const { session, store } = createReconcileStore([
      { id: 'msg-1', type: 'user', content: 'read a file', timestamp: 1, metadata: {} },
    ]);
    const adapter = new OpenClawRuntimeAdapter(store, {});
    const sessionKey = `agent:main:popiai:${session.id}`;
    const completeSpy = vi.fn();

    session.status = 'running';
    adapter.reconcileWithHistory = async () => {};
    adapter.on('complete', completeSpy);
    adapter.activeTurns.set(session.id, createActiveTurn(session.id, sessionKey, 'run-tool-use'));

    adapter.handleChatEvent({
      state: 'final',
      runId: 'run-tool-use',
      sessionKey,
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Let me read the file first.' },
          { type: 'toolCall', id: 'call-1', name: 'read', arguments: { path: '/tmp/input.txt' } },
        ],
        stopReason: 'toolUse',
      },
    }, 1);
    await Promise.resolve();
    await Promise.resolve();

    await vi.advanceTimersByTimeAsync(5_000);
    expect(completeSpy).not.toHaveBeenCalled();
    expect(session.status).toBe('running');
    expect(adapter.activeTurns.has(session.id)).toBe(true);

    adapter.handleAgentEvent({
      runId: 'run-tool-use',
      sessionKey,
      stream: 'tool',
      data: { toolCallId: 'call-1', phase: 'start', name: 'read' },
    }, 2);

    expect(session.messages.find((message) => message.type === 'tool_use')?.metadata?.toolName).toBe('read');
    expect(session.status).toBe('running');
  } finally {
    vi.useRealTimers();
  }
});

test('tool-use chat final inserts later tools after the preceding assistant segment', async () => {
  vi.useFakeTimers();
  try {
    const { session, store } = createReconcileStore([
      { id: 'msg-1', type: 'user', content: 'verify the file', timestamp: 1, metadata: {} },
    ]);
    const adapter = new OpenClawRuntimeAdapter(store, {});
    const sessionKey = `agent:main:popiai:${session.id}`;
    const messageUpdateSpy = vi.fn();

    session.status = 'running';
    adapter.reconcileWithHistory = async () => {};
    adapter.on('messageUpdate', messageUpdateSpy);
    adapter.activeTurns.set(session.id, createActiveTurn(session.id, sessionKey, 'run-tool-use'));

    adapter.handleChatEvent({
      state: 'final',
      runId: 'run-tool-use',
      sessionKey,
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Verify:' },
          { type: 'toolCall', id: 'call-1', name: 'exec', arguments: { command: 'wc -l index.html' } },
        ],
        stopReason: 'toolUse',
      },
    }, 1);
    await Promise.resolve();
    await Promise.resolve();

    adapter.handleAgentEvent({
      runId: 'run-tool-use',
      sessionKey,
      stream: 'tool',
      data: { toolCallId: 'call-1', phase: 'start', name: 'exec' },
    }, 2);
    adapter.handleAgentEvent({
      runId: 'run-tool-use',
      sessionKey,
      stream: 'tool',
      data: { toolCallId: 'call-1', phase: 'result', name: 'exec', result: '100 index.html' },
    }, 3);
    adapter.processAgentAssistantText({
      runId: 'run-tool-use',
      sessionKey,
      stream: 'assistant',
      data: { text: 'Verify:Done.' },
    });
    adapter.handleChatEvent({
      state: 'final',
      runId: 'run-tool-use',
      sessionKey,
      message: {
        role: 'assistant',
        content: 'Verify:Done.',
      },
    }, 4);
    await Promise.resolve();
    await Promise.resolve();

    expect(session.messages.map((message) => message.type)).toEqual([
      'user',
      'assistant',
      'tool_use',
      'tool_result',
      'assistant',
    ]);
    expect(session.messages[1].content).toBe('Verify:');
    expect(session.messages[4].content).toBe('Done.');
    expect(session.messages[4].metadata).toMatchObject({
      isStreaming: false,
      isFinal: true,
    });
    expect(messageUpdateSpy).toHaveBeenCalledWith(
      session.id,
      session.messages[4].id,
      'Done.',
      expect.objectContaining({ isStreaming: false, isFinal: true }),
    );
  } finally {
    vi.useRealTimers();
  }
});

test('session.tool gateway events persist tool use and result messages', async () => {
  vi.useFakeTimers();
  try {
    const { session, store } = createReconcileStore([
      { id: 'msg-1', type: 'user', content: 'run the workflow', timestamp: 1, metadata: {} },
    ]);
    const adapter = new OpenClawRuntimeAdapter(store, {});
    const sessionKey = `agent:main:popiai:${session.id}`;

    session.status = 'running';
    adapter.reconcileWithHistory = async () => {};
    adapter.rememberSessionKey(session.id, sessionKey);
    adapter.activeTurns.set(session.id, createActiveTurn(session.id, sessionKey, 'announce-run'));
    adapter.sessionIdByRunId.set('announce-run', session.id);

    adapter.handleGatewayEvent({
      event: 'session.tool',
      seq: 2,
      payload: {
        runId: 'announce-run',
        sessionKey,
        phase: 'start',
        toolName: 'write',
        toolCallId: 'call-write',
        args: { path: '/tmp/report.md' },
      },
    });

    adapter.handleGatewayEvent({
      event: 'session.tool',
      seq: 3,
      payload: {
        runId: 'announce-run',
        sessionKey,
        phase: 'end',
        toolName: 'write',
        toolCallId: 'call-write',
        result: [
          { type: 'text', text: 'Successfully wrote 8177 bytes to /tmp/report.md' },
        ],
        isError: false,
      },
    });

    expect(session.messages.map((message) => message.type)).toEqual([
      'user',
      'tool_use',
      'tool_result',
    ]);
    expect(session.messages[1]).toMatchObject({
      type: 'tool_use',
      content: 'Using tool: write',
      metadata: {
        toolName: 'write',
        toolInput: { path: '/tmp/report.md' },
        toolUseId: 'call-write',
      },
    });
    expect(session.messages[2]).toMatchObject({
      type: 'tool_result',
      content: 'Successfully wrote 8177 bytes to /tmp/report.md',
      metadata: {
        toolResult: 'Successfully wrote 8177 bytes to /tmp/report.md',
        toolUseId: 'call-write',
        isError: false,
        isStreaming: false,
        isFinal: true,
      },
    });
  } finally {
    vi.useRealTimers();
  }
});

test('session.tool gateway events persist tool messages from session update payloads', async () => {
  vi.useFakeTimers();
  try {
    const { session, store } = createReconcileStore([
      { id: 'msg-1', type: 'user', content: 'run the workflow', timestamp: 1, metadata: {} },
    ]);
    const adapter = new OpenClawRuntimeAdapter(store, {});
    const sessionKey = `agent:main:popiai:${session.id}`;

    session.status = 'running';
    adapter.reconcileWithHistory = async () => {};
    adapter.rememberSessionKey(session.id, sessionKey);
    adapter.activeTurns.set(session.id, createActiveTurn(session.id, sessionKey, 'announce-run'));
    adapter.sessionIdByRunId.set('announce-run', session.id);

    adapter.handleGatewayEvent({
      event: 'session.tool',
      seq: 2,
      payload: {
        runId: 'announce-run',
        sessionKey,
        stream: 'item',
        data: {
          type: 'tool_call',
          tag: 'tool_call',
          title: 'write: path: /tmp/report.md',
          status: 'in_progress',
          toolCallId: 'call-write',
          rawInput: { path: '/tmp/report.md' },
        },
      },
    });

    adapter.handleGatewayEvent({
      event: 'session.tool',
      seq: 3,
      payload: {
        runId: 'announce-run',
        sessionKey,
        stream: 'item',
        data: {
          type: 'tool_call',
          tag: 'tool_call_update',
          title: 'write',
          status: 'completed',
          toolCallId: 'call-write',
          rawOutput: 'Successfully wrote 8177 bytes to /tmp/report.md',
        },
      },
    });

    expect(session.messages.map((message) => message.type)).toEqual([
      'user',
      'tool_use',
      'tool_result',
    ]);
    expect(session.messages[1]).toMatchObject({
      type: 'tool_use',
      content: 'Using tool: write',
      metadata: {
        toolName: 'write',
        toolInput: { path: '/tmp/report.md' },
        toolUseId: 'call-write',
      },
    });
    expect(session.messages[2]).toMatchObject({
      type: 'tool_result',
      content: 'Successfully wrote 8177 bytes to /tmp/report.md',
      metadata: {
        toolResult: 'Successfully wrote 8177 bytes to /tmp/report.md',
        toolUseId: 'call-write',
        isError: false,
        isStreaming: false,
        isFinal: true,
      },
    });
  } finally {
    vi.useRealTimers();
  }
});

test('session.tool duplicate agent tool events update existing messages', async () => {
  vi.useFakeTimers();
  try {
    const { session, store } = createReconcileStore([
      { id: 'msg-1', type: 'user', content: 'write a file', timestamp: 1, metadata: {} },
    ]);
    const adapter = new OpenClawRuntimeAdapter(store, {});
    const sessionKey = `agent:main:popiai:${session.id}`;

    session.status = 'running';
    adapter.reconcileWithHistory = async () => {};
    adapter.rememberSessionKey(session.id, sessionKey);
    adapter.activeTurns.set(session.id, createActiveTurn(session.id, sessionKey, 'run-dup'));
    adapter.sessionIdByRunId.set('run-dup', session.id);

    adapter.handleGatewayEvent({
      event: 'agent',
      seq: 2,
      payload: {
        runId: 'run-dup',
        sessionKey,
        stream: 'tool',
        data: {
          phase: 'start',
          name: 'write',
          toolCallId: 'call-write',
          args: { path: '/tmp/report.md' },
        },
      },
    });
    adapter.handleGatewayEvent({
      event: 'session.tool',
      seq: 3,
      payload: {
        runId: 'run-dup',
        sessionKey,
        phase: 'start',
        toolName: 'write',
        toolCallId: 'call-write',
        args: { path: '/tmp/report.md' },
      },
    });
    adapter.handleGatewayEvent({
      event: 'agent',
      seq: 4,
      payload: {
        runId: 'run-dup',
        sessionKey,
        stream: 'tool',
        data: {
          phase: 'result',
          name: 'write',
          toolCallId: 'call-write',
          result: 'first result',
          isError: false,
        },
      },
    });
    adapter.handleGatewayEvent({
      event: 'session.tool',
      seq: 5,
      payload: {
        runId: 'run-dup',
        sessionKey,
        phase: 'end',
        toolName: 'write',
        toolCallId: 'call-write',
        result: 'final result',
        isError: false,
      },
    });

    expect(session.messages.map((message) => message.type)).toEqual([
      'user',
      'tool_use',
      'tool_result',
    ]);
    expect(session.messages[2]).toMatchObject({
      type: 'tool_result',
      content: 'final result',
      metadata: {
        toolResult: 'final result',
        toolUseId: 'call-write',
        isError: false,
        isStreaming: false,
        isFinal: true,
      },
    });
  } finally {
    vi.useRealTimers();
  }
});

test('session.tool gateway events from stale runs do not attach to the active turn', async () => {
  vi.useFakeTimers();
  try {
    const { session, store } = createReconcileStore([
      { id: 'msg-1', type: 'user', content: 'new work', timestamp: 1, metadata: {} },
    ]);
    const adapter = new OpenClawRuntimeAdapter(store, {});
    const sessionKey = `agent:main:popiai:${session.id}`;

    session.status = 'running';
    adapter.reconcileWithHistory = async () => {};
    adapter.rememberSessionKey(session.id, sessionKey);
    adapter.activeTurns.set(session.id, createActiveTurn(session.id, sessionKey, 'new-run'));
    adapter.sessionIdByRunId.set('old-run', session.id);
    adapter.sessionIdByRunId.set('new-run', session.id);

    adapter.handleGatewayEvent({
      event: 'session.tool',
      seq: 2,
      payload: {
        runId: 'old-run',
        sessionKey,
        phase: 'start',
        toolName: 'write',
        toolCallId: 'call-old',
        args: { path: '/tmp/old.md' },
      },
    });

    expect(session.messages.map((message) => message.type)).toEqual(['user']);
    expect(adapter.activeTurns.get(session.id)?.runId).toBe('new-run');
  } finally {
    vi.useRealTimers();
  }
});

test('late session.tool events do not recreate a completed desktop turn', () => {
  const { session, store } = createReconcileStore([
    { id: 'msg-1', type: 'user', content: 'run the workflow', timestamp: 1, metadata: {} },
    { id: 'msg-2', type: 'assistant', content: 'done', timestamp: 2, metadata: { isStreaming: false, isFinal: true } },
  ]);
  const adapter = new OpenClawRuntimeAdapter(store, {});
  const sessionKey = `agent:main:popiai:${session.id}`;

  adapter.rememberSessionKey(session.id, sessionKey);
  adapter.ensureActiveTurn(session.id, sessionKey, 'closed-run');
  session.status = 'completed';
  adapter.cleanupSessionTurn(session.id);

  adapter.handleGatewayEvent({
    event: 'session.tool',
    seq: 2,
    payload: {
      sessionKey,
      phase: 'start',
      toolName: 'read',
      toolCallId: 'late-read',
      args: { path: '/tmp/late.md' },
    },
  });

  adapter.handleGatewayEvent({
    event: 'session.tool',
    seq: 3,
    payload: {
      runId: 'closed-run',
      sessionKey,
      phase: 'start',
      toolName: 'write',
      toolCallId: 'late-write',
      args: { path: '/tmp/late.md' },
    },
  });

  expect(session.status).toBe('completed');
  expect(session.messages).toHaveLength(2);
  expect(adapter.activeTurns.has(session.id)).toBe(false);
});

test('tool-use lifecycle end waits for OpenClaw compaction retry', async () => {
  vi.useFakeTimers();
  try {
    const { session, store } = createReconcileStore([
      { id: 'msg-1', type: 'user', content: 'read a file', timestamp: 1, metadata: {} },
    ]);
    const adapter = new OpenClawRuntimeAdapter(store, {});
    const sessionKey = `agent:main:popiai:${session.id}`;
    const completeSpy = vi.fn();

    session.status = 'running';
    adapter.reconcileWithHistory = async () => {};
    adapter.on('complete', completeSpy);
    adapter.activeTurns.set(session.id, createActiveTurn(session.id, sessionKey, 'run-tool-use'));

    adapter.handleChatEvent({
      state: 'final',
      runId: 'run-tool-use',
      sessionKey,
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Let me read the file first.' },
          { type: 'toolCall', id: 'call-1', name: 'read', arguments: { path: '/tmp/input.txt' } },
        ],
        stopReason: 'toolUse',
      },
    }, 1);
    await Promise.resolve();
    await Promise.resolve();

    adapter.handleAgentEvent({
      runId: 'run-tool-use',
      sessionKey,
      stream: 'lifecycle',
      data: { phase: 'end' },
    }, 2);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(completeSpy).not.toHaveBeenCalled();
    expect(session.status).toBe('running');
    expect(adapter.activeTurns.has(session.id)).toBe(true);

    adapter.handleAgentEvent({
      runId: 'run-tool-use',
      sessionKey,
      stream: 'lifecycle',
      data: { phase: 'start' },
    }, 3);

    await vi.advanceTimersByTimeAsync(20_000);
    expect(completeSpy).not.toHaveBeenCalled();
    expect(session.status).toBe('running');
    expect(adapter.activeTurns.has(session.id)).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});

test('compaction stream shows context maintenance state while keeping the session running', () => {
  const { session, store } = createReconcileStore([
    { id: 'msg-1', type: 'user', content: 'continue the task', timestamp: 1, metadata: {} },
  ]);
  const adapter = new OpenClawRuntimeAdapter(store, {});
  const sessionKey = `agent:main:popiai:${session.id}`;
  const messageSpy = vi.fn();
  const messageUpdateSpy = vi.fn();
  const maintenanceSpy = vi.fn();
  const statusSpy = vi.fn();

  session.status = 'running';
  adapter.on('message', messageSpy);
  adapter.on('messageUpdate', messageUpdateSpy);
  adapter.on('contextMaintenance', maintenanceSpy);
  adapter.on('sessionStatus', statusSpy);
  adapter.activeTurns.set(session.id, createActiveTurn(session.id, sessionKey, 'run-compaction'));

  adapter.handleAgentEvent({
    runId: 'run-compaction',
    sessionKey,
    stream: 'compaction',
    data: { phase: 'start' },
  }, 1);

  expect(session.status).toBe('running');
  expect(statusSpy).toHaveBeenCalledWith(session.id, 'running');
  expect(maintenanceSpy).toHaveBeenCalledWith(session.id, true);
  expect(adapter.activeTurns.get(session.id)?.hasContextCompactionEvent).toBe(true);
  const compactionMessages = session.messages.filter(
    (message) => message.metadata?.kind === CoworkSystemMessageKind.ContextCompaction,
  );
  expect(compactionMessages).toHaveLength(1);
  expect(compactionMessages[0].metadata?.status).toBe(ContextCompactionStatus.Running);
  expect(messageSpy).toHaveBeenCalledWith(session.id, compactionMessages[0]);

  adapter.handleAgentEvent({
    runId: 'run-compaction',
    sessionKey,
    stream: 'compaction',
    data: { phase: 'end', completed: false, willRetry: true },
  }, 2);

  expect(session.status).toBe('running');
  expect(maintenanceSpy).toHaveBeenLastCalledWith(session.id, true);
  expect(session.messages.filter(
    (message) => message.metadata?.kind === CoworkSystemMessageKind.ContextCompaction,
  )).toHaveLength(1);
  expect(compactionMessages[0].metadata?.status).toBe(ContextCompactionStatus.Retrying);
  expect(messageUpdateSpy).toHaveBeenCalledWith(
    session.id,
    compactionMessages[0].id,
    expect.any(String),
    expect.objectContaining({
      kind: CoworkSystemMessageKind.ContextCompaction,
      status: ContextCompactionStatus.Retrying,
    }),
  );
  expect(adapter.activeTurns.get(session.id)?.hasContextCompactionEvent).toBe(false);
  expect(adapter.activeTurns.get(session.id)?.pendingRecoverableFollowup).toBe(true);
  expect(adapter.activeTurns.has(session.id)).toBe(true);
});

test('compaction retry wait clears context maintenance when no follow-up arrives', async () => {
  vi.useFakeTimers();
  try {
    const { session, store } = createReconcileStore([
      { id: 'msg-1', type: 'user', content: 'continue the task', timestamp: 1, metadata: {} },
    ]);
    const adapter = new OpenClawRuntimeAdapter(store, {});
    const sessionKey = `agent:main:popiai:${session.id}`;
    const maintenanceSpy = vi.fn();
    const completeSpy = vi.fn();

    session.status = 'running';
    adapter.on('contextMaintenance', maintenanceSpy);
    adapter.on('complete', completeSpy);
    adapter.activeTurns.set(session.id, createActiveTurn(session.id, sessionKey, 'run-compaction-timeout'));

    adapter.handleAgentEvent({
      runId: 'run-compaction-timeout',
      sessionKey,
      stream: 'compaction',
      data: { phase: 'start' },
    }, 1);

    adapter.handleAgentEvent({
      runId: 'run-compaction-timeout',
      sessionKey,
      stream: 'compaction',
      data: { phase: 'end', completed: true, willRetry: true },
    }, 2);

    expect(maintenanceSpy).toHaveBeenLastCalledWith(session.id, true);
    expect(adapter.activeTurns.has(session.id)).toBe(true);

    await vi.advanceTimersByTimeAsync(120_000);
    await Promise.resolve();

    expect(maintenanceSpy).toHaveBeenLastCalledWith(session.id, false);
    expect(completeSpy).toHaveBeenCalledWith(session.id, 'run-compaction-timeout');
    expect(session.status).toBe('completed');
    expect(adapter.activeTurns.has(session.id)).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});

test('compaction stream reuses active structured message for duplicate start events', () => {
  const { session, store } = createReconcileStore([
    { id: 'msg-1', type: 'user', content: 'continue the task', timestamp: 1, metadata: {} },
  ]);
  const adapter = new OpenClawRuntimeAdapter(store, {});
  const sessionKey = `agent:main:popiai:${session.id}`;

  session.status = 'running';
  adapter.activeTurns.set(session.id, createActiveTurn(session.id, sessionKey, 'run-compaction'));

  adapter.handleAgentEvent({
    runId: 'run-compaction',
    sessionKey,
    stream: 'compaction',
    data: { phase: 'start' },
  }, 1);
  adapter.handleAgentEvent({
    runId: 'run-compaction',
    sessionKey,
    stream: 'compaction',
    data: { phase: 'start' },
  }, 2);

  expect(session.messages.filter(
    (message) => message.metadata?.kind === CoworkSystemMessageKind.ContextCompaction,
  )).toHaveLength(1);
});

test('compaction end without a structured start message does not append a late message', () => {
  const { session, store } = createReconcileStore([
    { id: 'msg-1', type: 'user', content: 'continue the task', timestamp: 1, metadata: {} },
  ]);
  const adapter = new OpenClawRuntimeAdapter(store, {});
  const sessionKey = `agent:main:popiai:${session.id}`;

  session.status = 'running';
  adapter.activeTurns.set(session.id, createActiveTurn(session.id, sessionKey, 'run-compaction'));

  adapter.handleAgentEvent({
    runId: 'run-compaction',
    sessionKey,
    stream: 'compaction',
    data: { phase: 'end', completed: true, willRetry: false },
  }, 1);

  expect(session.messages.filter(
    (message) => message.metadata?.kind === CoworkSystemMessageKind.ContextCompaction,
  )).toHaveLength(0);
});

test('empty tool final waits for compaction retry and accepts same-run continuation', async () => {
  vi.useFakeTimers();
  try {
    const { session, store } = createReconcileStore([
      { id: 'msg-1', type: 'user', content: 'publish the article', timestamp: 1, metadata: {} },
      { id: 'msg-2', type: 'tool_use', content: 'Using exec', timestamp: 2, metadata: { toolUseId: 'call-1' } },
      { id: 'msg-3', type: 'tool_result', content: 'OK', timestamp: 3, metadata: { toolUseId: 'call-1' } },
    ]);
    const adapter = new OpenClawRuntimeAdapter(store, {});
    const sessionKey = `agent:main:popiai:${session.id}`;
    const completeSpy = vi.fn();
    const maintenanceSpy = vi.fn();

    adapter.gatewayClient = {
      start: () => {},
      stop: () => {},
      request: async (method: string) => {
        if (method !== 'chat.history') return {};
        return {
          messages: [
            { role: 'user', content: 'publish the article' },
            {
              role: 'assistant',
              content: [
                { type: 'thinking', thinking: 'Need to inspect the repo.' },
                { type: 'toolCall', id: 'call-1', name: 'exec', arguments: { command: 'git status' } },
              ],
            },
            { role: 'toolResult', toolCallId: 'call-1', content: 'OK' },
          ],
        };
      },
    };

    session.status = 'running';
    adapter.on('complete', completeSpy);
    adapter.on('contextMaintenance', maintenanceSpy);
    const turn = createActiveTurn(session.id, sessionKey, 'run-retry');
    turn.toolUseMessageIdByToolCallId.set('call-1', 'msg-2');
    turn.toolResultMessageIdByToolCallId.set('call-1', 'msg-3');
    adapter.activeTurns.set(session.id, turn);
    adapter.sessionIdByRunId.set('run-retry', session.id);
    adapter.rememberSessionKey(session.id, sessionKey);

    adapter.handleChatEvent({
      state: 'final',
      runId: 'run-retry',
      sessionKey,
      message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'Compacting.' }] },
    }, 1);

    await vi.advanceTimersByTimeAsync(2_000);
    await Promise.resolve();
    await Promise.resolve();

    expect(completeSpy).not.toHaveBeenCalled();
    expect(session.status).toBe('running');
    expect(maintenanceSpy).toHaveBeenCalledWith(session.id, true);
    expect(session.messages.some((message) => message.type === 'system')).toBe(false);

    await vi.advanceTimersByTimeAsync(13_000);
    adapter.handleAgentEvent({
      runId: 'run-retry',
      sessionKey,
      stream: 'lifecycle',
      data: { phase: 'start' },
    }, 2);
    adapter.processAgentAssistantText({
      runId: 'run-retry',
      sessionKey,
      stream: 'assistant',
      data: { text: 'Retry produced a visible answer.' },
    });

    expect(maintenanceSpy).toHaveBeenLastCalledWith(session.id, false);
    expect(session.messages.some((message) => (
      message.type === 'assistant'
      && message.content === 'Retry produced a visible answer.'
    ))).toBe(true);
    expect(session.messages.some((message) => message.type === 'system')).toBe(false);

    adapter.handleChatEvent({
      state: 'final',
      runId: 'run-retry',
      sessionKey,
      message: { role: 'assistant', content: 'Retry produced a visible answer.' },
    }, 3);
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(800);

    expect(completeSpy).toHaveBeenCalledWith(session.id, 'run-retry');
    expect(session.status).toBe('completed');
  } finally {
    vi.useRealTimers();
  }
});

test('empty final with local tool messages waits when history only has interim assistant text', async () => {
  vi.useFakeTimers();
  try {
    const interimAnswer = '分析大致完成了，让我再确认一下 openclaw 日志有没有更多细节。';
    const finalAnswer = '最终结论：OpenClaw 在压缩后继续 retry，客户端不能提前关闭 run。';
    const { session, store } = createReconcileStore([
      { id: 'msg-1', type: 'user', content: 'analyze these logs', timestamp: 1, metadata: {} },
      { id: 'msg-2', type: 'tool_use', content: 'Using grep', timestamp: 2, metadata: { toolUseId: 'call-1' } },
      { id: 'msg-3', type: 'tool_result', content: '80 lines of output', timestamp: 3, metadata: { toolUseId: 'call-1' } },
    ]);
    const adapter = new OpenClawRuntimeAdapter(store, {});
    const sessionKey = `agent:main:popiai:${session.id}`;
    const completeSpy = vi.fn();
    const maintenanceSpy = vi.fn();
    let historyAnswer = interimAnswer;

    adapter.gatewayClient = {
      start: () => {},
      stop: () => {},
      request: async (method: string) => {
        if (method !== 'chat.history') return {};
        return {
          messages: [
            { role: 'user', content: 'analyze these logs' },
            {
              role: 'assistant',
              content: [
                { type: 'toolCall', id: 'call-1', name: 'exec', arguments: { command: 'grep restart gateway.log' } },
              ],
            },
            { role: 'toolResult', toolCallId: 'call-1', content: '80 lines of output' },
            { role: 'assistant', content: historyAnswer },
          ],
        };
      },
    };

    session.status = 'running';
    adapter.on('complete', completeSpy);
    adapter.on('contextMaintenance', maintenanceSpy);
    adapter.activeTurns.set(session.id, createActiveTurn(session.id, sessionKey, 'run-overflow'));
    adapter.sessionIdByRunId.set('run-overflow', session.id);
    adapter.latestTurnTokenBySession.set(session.id, 1);
    adapter.rememberSessionKey(session.id, sessionKey);

    adapter.handleChatEvent({
      state: 'final',
      runId: 'run-overflow',
      sessionKey,
    }, 1);

    await vi.advanceTimersByTimeAsync(1_000);
    await Promise.resolve();
    await Promise.resolve();

    expect(completeSpy).not.toHaveBeenCalled();
    expect(session.status).toBe('running');
    expect(maintenanceSpy).toHaveBeenCalledWith(session.id, true);
    expect(session.messages.some((message) => (
      message.type === 'assistant'
      && message.content === interimAnswer
    ))).toBe(true);

    adapter.handleAgentEvent({
      runId: 'run-overflow',
      sessionKey,
      stream: 'lifecycle',
      data: { phase: 'end' },
    }, 2);
    await vi.advanceTimersByTimeAsync(45_000);
    expect(completeSpy).not.toHaveBeenCalled();
    expect(session.status).toBe('running');

    adapter.handleAgentEvent({
      runId: 'run-overflow',
      sessionKey,
      stream: 'lifecycle',
      data: { phase: 'start' },
    }, 3);
    historyAnswer = finalAnswer;
    adapter.processAgentAssistantText({
      runId: 'run-overflow',
      sessionKey,
      stream: 'assistant',
      data: { text: finalAnswer },
    });
    await vi.advanceTimersByTimeAsync(300);

    expect(maintenanceSpy).toHaveBeenLastCalledWith(session.id, false);
    expect(session.messages.some((message) => (
      message.type === 'assistant'
      && message.content === finalAnswer
    ))).toBe(true);

    adapter.handleChatEvent({
      state: 'final',
      runId: 'run-overflow',
      sessionKey,
      message: { role: 'assistant', content: finalAnswer },
    }, 4);
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(800);

    expect(completeSpy).toHaveBeenCalledWith(session.id, 'run-overflow');
    expect(session.status).toBe('completed');
  } finally {
    vi.useRealTimers();
  }
});

test('visible short tool final waits under large tool results and accepts same-run continuation', async () => {
  vi.useFakeTimers();
  try {
    const shortAnswer = 'I will inspect the logs and then summarize the restart timeline.';
    const fullAnswer = `Full answer. ${'The gateway restart was caused by config sync and context retry evidence. '.repeat(12)}`;
    const largeToolResult = 'gateway log line\n'.repeat(1600);
    let historyAnswer = shortAnswer;
    const { session, store } = createReconcileStore([
      { id: 'msg-1', type: 'user', content: 'why did the gateway restart?', timestamp: 1, metadata: {} },
      { id: 'msg-2', type: 'tool_use', content: 'Using exec', timestamp: 2, metadata: { toolUseId: 'call-1' } },
      { id: 'msg-3', type: 'tool_result', content: 'partial', timestamp: 3, metadata: { toolUseId: 'call-1' } },
    ]);
    const adapter = new OpenClawRuntimeAdapter(store, {});
    const sessionKey = `agent:main:popiai:${session.id}`;
    const completeSpy = vi.fn();
    const maintenanceSpy = vi.fn();

    adapter.gatewayClient = {
      start: () => {},
      stop: () => {},
      request: async (method: string) => {
        if (method !== 'chat.history') return {};
        return {
          messages: [
            { role: 'user', content: 'why did the gateway restart?' },
            {
              role: 'assistant',
              content: [
                { type: 'thinking', thinking: 'Need to inspect the logs.' },
                { type: 'toolCall', id: 'call-1', name: 'exec', arguments: { command: 'cat gateway.log' } },
              ],
            },
            { role: 'toolResult', toolCallId: 'call-1', content: largeToolResult },
            { role: 'assistant', content: historyAnswer },
          ],
        };
      },
    };

    session.status = 'running';
    adapter.on('complete', completeSpy);
    adapter.on('contextMaintenance', maintenanceSpy);
    const turn = createActiveTurn(session.id, sessionKey, 'run-visible-retry');
    turn.toolUseMessageIdByToolCallId.set('call-1', 'msg-2');
    turn.toolResultMessageIdByToolCallId.set('call-1', 'msg-3');
    adapter.activeTurns.set(session.id, turn);
    adapter.sessionIdByRunId.set('run-visible-retry', session.id);
    adapter.rememberSessionKey(session.id, sessionKey);

    adapter.handleChatEvent({
      state: 'final',
      runId: 'run-visible-retry',
      sessionKey,
      message: { role: 'assistant', content: shortAnswer },
    }, 1);

    await vi.advanceTimersByTimeAsync(2_000);
    await Promise.resolve();
    await Promise.resolve();

    expect(completeSpy).not.toHaveBeenCalled();
    expect(session.status).toBe('running');
    expect(maintenanceSpy).toHaveBeenCalledWith(session.id, true);
    expect(session.messages.some((message) => (
      message.type === 'assistant'
      && message.content === shortAnswer
    ))).toBe(true);

    await vi.advanceTimersByTimeAsync(70_000);
    expect(completeSpy).not.toHaveBeenCalled();

    historyAnswer = fullAnswer;
    adapter.processAgentAssistantText({
      runId: 'run-visible-retry',
      sessionKey,
      stream: 'assistant',
      data: { text: fullAnswer },
    });
    await vi.advanceTimersByTimeAsync(300);

    expect(maintenanceSpy).toHaveBeenLastCalledWith(session.id, false);
    expect(session.messages.some((message) => (
      message.type === 'assistant'
      && message.content.trim() === fullAnswer.trim()
    ))).toBe(true);

    adapter.handleChatEvent({
      state: 'final',
      runId: 'run-visible-retry',
      sessionKey,
      message: { role: 'assistant', content: fullAnswer },
    }, 2);
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(800);

    expect(completeSpy).toHaveBeenCalledWith(session.id, 'run-visible-retry');
    expect(session.status).toBe('completed');
  } finally {
    vi.useRealTimers();
  }
});

test('visible short tool final completes with existing text when no continuation arrives', async () => {
  vi.useFakeTimers();
  try {
    const shortAnswer = 'I checked the logs and did not find a restart.';
    const lateAnswer = 'This late continuation should not be accepted.';
    const largeToolResult = 'main log line\n'.repeat(1600);
    const { session, store } = createReconcileStore([
      { id: 'msg-1', type: 'user', content: 'check the logs', timestamp: 1, metadata: {} },
      { id: 'msg-2', type: 'tool_use', content: 'Using exec', timestamp: 2, metadata: { toolUseId: 'call-1' } },
      { id: 'msg-3', type: 'tool_result', content: 'partial', timestamp: 3, metadata: { toolUseId: 'call-1' } },
    ]);
    const adapter = new OpenClawRuntimeAdapter(store, {});
    const sessionKey = `agent:main:popiai:${session.id}`;
    const completeSpy = vi.fn();

    adapter.gatewayClient = {
      start: () => {},
      stop: () => {},
      request: async (method: string) => {
        if (method !== 'chat.history') return {};
        return {
          messages: [
            { role: 'user', content: 'check the logs' },
            {
              role: 'assistant',
              content: [
                { type: 'thinking', thinking: 'Need to inspect the logs.' },
                { type: 'toolCall', id: 'call-1', name: 'exec', arguments: { command: 'cat main.log' } },
              ],
            },
            { role: 'toolResult', toolCallId: 'call-1', content: largeToolResult },
            { role: 'assistant', content: shortAnswer },
          ],
        };
      },
    };

    session.status = 'running';
    adapter.on('complete', completeSpy);
    const turn = createActiveTurn(session.id, sessionKey, 'run-visible-timeout');
    turn.toolUseMessageIdByToolCallId.set('call-1', 'msg-2');
    turn.toolResultMessageIdByToolCallId.set('call-1', 'msg-3');
    adapter.activeTurns.set(session.id, turn);
    adapter.sessionIdByRunId.set('run-visible-timeout', session.id);
    adapter.rememberSessionKey(session.id, sessionKey);

    adapter.handleChatEvent({
      state: 'final',
      runId: 'run-visible-timeout',
      sessionKey,
      message: { role: 'assistant', content: shortAnswer },
    }, 1);

    await vi.advanceTimersByTimeAsync(2_000);
    await Promise.resolve();
    await Promise.resolve();

    expect(completeSpy).not.toHaveBeenCalled();
    expect(session.messages.some((message) => message.type === 'system')).toBe(false);

    await vi.advanceTimersByTimeAsync(120_000);
    await Promise.resolve();
    await Promise.resolve();

    expect(completeSpy).toHaveBeenCalledWith(session.id, 'run-visible-timeout');
    expect(session.status).toBe('completed');
    expect(session.messages.some((message) => message.type === 'system')).toBe(false);
    expect(session.messages.some((message) => (
      message.type === 'assistant'
      && message.content === shortAnswer
    ))).toBe(true);

    adapter.processAgentAssistantText({
      runId: 'run-visible-timeout',
      sessionKey,
      stream: 'assistant',
      data: { text: lateAnswer },
    });

    expect(session.messages.some((message) => (
      message.type === 'assistant'
      && message.content === lateAnswer
    ))).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});

test('empty tool final shows thinking-only hint only after the follow-up grace window', async () => {
  vi.useFakeTimers();
  try {
    const { session, store } = createReconcileStore([
      { id: 'msg-1', type: 'user', content: 'finish silently', timestamp: 1, metadata: {} },
      { id: 'msg-2', type: 'tool_use', content: 'Using exec', timestamp: 2, metadata: { toolUseId: 'call-1' } },
      { id: 'msg-3', type: 'tool_result', content: 'OK', timestamp: 3, metadata: { toolUseId: 'call-1' } },
    ]);
    const adapter = new OpenClawRuntimeAdapter(store, {});
    const sessionKey = `agent:main:popiai:${session.id}`;
    const completeSpy = vi.fn();

    adapter.gatewayClient = {
      start: () => {},
      stop: () => {},
      request: async (method: string) => {
        if (method !== 'chat.history') return {};
        return {
          messages: [
            { role: 'user', content: 'finish silently' },
            {
              role: 'assistant',
              content: [
                { type: 'thinking', thinking: 'No visible answer.' },
                { type: 'toolCall', id: 'call-1', name: 'exec', arguments: { command: 'true' } },
              ],
            },
            { role: 'toolResult', toolCallId: 'call-1', content: 'OK' },
          ],
        };
      },
    };

    session.status = 'running';
    adapter.on('complete', completeSpy);
    const turn = createActiveTurn(session.id, sessionKey, 'run-empty');
    turn.toolUseMessageIdByToolCallId.set('call-1', 'msg-2');
    turn.toolResultMessageIdByToolCallId.set('call-1', 'msg-3');
    adapter.activeTurns.set(session.id, turn);
    adapter.sessionIdByRunId.set('run-empty', session.id);
    adapter.rememberSessionKey(session.id, sessionKey);

    adapter.handleChatEvent({
      state: 'final',
      runId: 'run-empty',
      sessionKey,
      message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'No visible answer.' }] },
    }, 1);
    await vi.advanceTimersByTimeAsync(2_000);
    await Promise.resolve();
    await Promise.resolve();

    expect(session.messages.some((message) => message.type === 'system')).toBe(false);
    expect(completeSpy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(60_000);
    await Promise.resolve();
    await Promise.resolve();

    expect(session.messages.some((message) => (
      message.type === 'system'
      && String(message.content).includes('[模型未输出内容]')
    ))).toBe(true);
    expect(completeSpy).toHaveBeenCalledWith(session.id, 'run-empty');
    expect(session.status).toBe('completed');
  } finally {
    vi.useRealTimers();
  }
});

test('sessions_yield final keeps session running while waiting for subagent work', async () => {
  vi.useFakeTimers();
  try {
    const { session, store } = createReconcileStore([
      { id: 'msg-1', type: 'user', content: 'delegate this', timestamp: 1, metadata: {} },
      {
        id: 'msg-2',
        type: 'tool_use',
        content: 'Using sessions_yield',
        timestamp: 2,
        metadata: { toolName: 'sessions_yield', toolUseId: 'call-1' },
      },
      {
        id: 'msg-3',
        type: 'tool_result',
        content: '{\n  "status": "yielded",\n  "message": "Waiting for sub agent"\n}',
        timestamp: 3,
        metadata: {
          toolResult: '{\n  "status": "yielded",\n  "message": "Waiting for sub agent"\n}',
          toolUseId: 'call-1',
        },
      },
    ]);
    const adapter = new OpenClawRuntimeAdapter(store, {});
    const sessionKey = `agent:main:popiai:${session.id}`;
    const completeSpy = vi.fn();
    const statusSpy = vi.fn();

    adapter.gatewayClient = {
      start: () => {},
      stop: () => {},
      request: async (method: string) => {
        if (method !== 'chat.history') return {};
        return {
          messages: [
            { role: 'user', content: 'delegate this' },
            {
              role: 'assistant',
              content: [
                { type: 'thinking', thinking: 'Waiting for registered continuation work.' },
                { type: 'toolCall', id: 'call-1', name: 'sessions_yield', arguments: {} },
              ],
            },
            {
              role: 'toolResult',
              toolCallId: 'call-1',
              content: '{\n  "status": "yielded",\n  "message": "Waiting for sub agent"\n}',
            },
          ],
        };
      },
    };

    session.status = 'running';
    adapter.on('complete', completeSpy);
    adapter.on('sessionStatus', statusSpy);
    const turn = createActiveTurn(session.id, sessionKey, 'run-yield');
    turn.toolUseMessageIdByToolCallId.set('call-1', 'msg-2');
    turn.toolResultMessageIdByToolCallId.set('call-1', 'msg-3');
    adapter.activeTurns.set(session.id, turn);
    adapter.sessionIdByRunId.set('run-yield', session.id);
    adapter.rememberSessionKey(session.id, sessionKey);

    adapter.handleChatEvent({
      state: 'final',
      runId: 'run-yield',
      sessionKey,
    }, 1);
    await vi.advanceTimersByTimeAsync(2_000);
    await Promise.resolve();
    await Promise.resolve();

    expect(completeSpy).toHaveBeenCalledWith(session.id, 'run-yield');
    expect(statusSpy).toHaveBeenCalledWith(session.id, 'completed');
    expect(session.status).toBe('completed');
    expect(adapter.activeTurns.has(session.id)).toBe(false);
    expect(adapter.sessionIdByRunId.has('run-yield')).toBe(false);

    await vi.advanceTimersByTimeAsync(120_000);
    await Promise.resolve();
    await Promise.resolve();

    expect(session.messages.some((message) => (
      message.type === 'system'
      && String(message.content).includes('[模型未输出内容]')
    ))).toBe(false);
    expect(completeSpy).toHaveBeenCalledTimes(1);
    expect(session.status).toBe('completed');
  } finally {
    vi.useRealTimers();
  }
});

test('visible final after sessions_yield completes the parent session', async () => {
  vi.useFakeTimers();
  try {
    const finalAnswer = 'Subagent finished and announced the final answer.';
    const yieldedResult = '{\n  "status": "yielded",\n  "message": "Waiting for sub agent"\n}';
    const { session, store } = createReconcileStore([
      { id: 'msg-1', type: 'user', content: 'delegate this', timestamp: 1, metadata: {} },
      {
        id: 'msg-2',
        type: 'tool_use',
        content: 'Using sessions_yield',
        timestamp: 2,
        metadata: { toolName: 'sessions_yield', toolUseId: 'call-1' },
      },
      {
        id: 'msg-3',
        type: 'tool_result',
        content: yieldedResult,
        timestamp: 3,
        metadata: { toolResult: yieldedResult, toolUseId: 'call-1' },
      },
    ]);
    const adapter = new OpenClawRuntimeAdapter(store, {});
    const sessionKey = `agent:main:popiai:${session.id}`;
    const runId = `announce:v1:${sessionKey}:child-run`;
    const completeSpy = vi.fn();

    adapter.gatewayClient = {
      start: () => {},
      stop: () => {},
      request: async (method: string) => {
        if (method !== 'chat.history') return {};
        return {
          messages: [
            { role: 'user', content: 'delegate this' },
            {
              role: 'assistant',
              content: [
                { type: 'toolCall', id: 'call-1', name: 'sessions_yield', arguments: {} },
              ],
            },
            { role: 'toolResult', toolCallId: 'call-1', content: yieldedResult },
            { role: 'assistant', content: finalAnswer },
          ],
        };
      },
    };

    session.status = 'running';
    adapter.on('complete', completeSpy);
    const turn = createActiveTurn(session.id, sessionKey, runId);
    adapter.activeTurns.set(session.id, turn);
    adapter.sessionIdByRunId.set(runId, session.id);
    adapter.rememberSessionKey(session.id, sessionKey);

    adapter.handleChatEvent({
      state: 'final',
      runId,
      sessionKey,
      message: { role: 'assistant', content: finalAnswer },
    }, 1);
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(800);

    expect(completeSpy).toHaveBeenCalledWith(session.id, runId);
    expect(session.status).toBe('completed');
    expect(adapter.activeTurns.has(session.id)).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});

test('new run thinking is inserted after a previous overlapping assistant run', () => {
  const { session, store } = createReconcileStore([
    { id: 'msg-1', type: 'user', content: 'first request', timestamp: 1, metadata: {} },
    {
      id: 'msg-2',
      type: 'assistant',
      content: 'Previous announce assistant text.',
      timestamp: 2,
      metadata: { isStreaming: true, isFinal: false },
    },
  ]);
  const adapter = new OpenClawRuntimeAdapter(store, {});
  const sessionKey = `agent:main:popiai:${session.id}`;
  const oldRunId = 'announce:v1:agent:main:subagent:old:old-run';
  const newRunId = 'new-user-run';

  adapter.rememberSessionKey(session.id, sessionKey);
  const oldTurn = createActiveTurn(session.id, sessionKey, oldRunId);
  oldTurn.assistantMessageId = 'msg-2';
  adapter.activeTurns.set(session.id, oldTurn);
  adapter.sessionIdByRunId.set(oldRunId, session.id);

  adapter.handleAgentEvent({
    runId: newRunId,
    sessionKey,
    stream: 'lifecycle',
    data: { phase: 'start' },
  }, 1);
  adapter.handleAgentEvent({
    runId: newRunId,
    sessionKey,
    stream: 'thinking',
    data: { text: 'New run thinking text.' },
  }, 2);

  expect(session.messages.map((message) => message.content)).toEqual([
    'first request',
    'Previous announce assistant text.',
    'New run thinking text.',
  ]);
  const thinkingMessage = session.messages.at(-1);
  expect(thinkingMessage?.metadata).toMatchObject({
    isThinking: true,
    isStreaming: true,
  });
  expect(adapter.activeTurns.get(session.id)?.runId).toBe(newRunId);
  expect(adapter.activeTurns.get(session.id)?.assistantMessageId).toBeNull();
});

test('memory maintenance NO_REPLY stays running while waiting for a follow-up run', async () => {
  vi.useFakeTimers();
  try {
    const { session, store } = createReconcileStore([
      { id: 'msg-1', type: 'user', content: 'continue the task', timestamp: 1, metadata: {} },
    ]);
    const adapter = new OpenClawRuntimeAdapter(store, {});
    const sessionKey = `agent:main:popiai:${session.id}`;
    const completeSpy = vi.fn();
    const maintenanceSpy = vi.fn();

    session.status = 'running';
    adapter.reconcileWithHistory = async () => {};
    adapter.on('complete', completeSpy);
    adapter.on('contextMaintenance', maintenanceSpy);
    adapter.activeTurns.set(session.id, createActiveTurn(session.id, sessionKey, 'run-memory'));

    adapter.handleAgentEvent({
      runId: 'run-memory',
      sessionKey,
      stream: 'tool',
      data: {
        toolCallId: 'memory-write',
        phase: 'start',
        name: 'write',
        args: { path: '/tmp/work/memory/2026-05-09.md' },
      },
    }, 1);
    adapter.handleAgentEvent({
      runId: 'run-memory',
      sessionKey,
      stream: 'tool',
      data: {
        toolCallId: 'memory-write',
        phase: 'result',
        name: 'write',
        result: 'updated memory',
      },
    }, 2);

    adapter.handleChatEvent({
      state: 'final',
      runId: 'run-memory',
      sessionKey,
      message: { role: 'assistant', content: 'NO_REPLY' },
    }, 3);
    await Promise.resolve();
    await Promise.resolve();

    expect(session.status).toBe('running');
    expect(completeSpy).not.toHaveBeenCalled();
    expect(session.messages.some((message) => message.type === 'assistant' && message.content === 'NO_REPLY')).toBe(false);
    expect(session.messages.some((message) => message.type === 'tool_use')).toBe(false);
    expect(session.messages.some((message) => message.type === 'tool_result')).toBe(false);
    expect(maintenanceSpy).toHaveBeenCalledWith(session.id, true);

    await vi.advanceTimersByTimeAsync(59_999);
    expect(completeSpy).not.toHaveBeenCalled();
    expect(session.status).toBe('running');

    await vi.advanceTimersByTimeAsync(1);
    expect(completeSpy).toHaveBeenCalledWith(session.id, 'run-memory');
    expect(session.status).toBe('completed');
    expect(maintenanceSpy).toHaveBeenLastCalledWith(session.id, false);
  } finally {
    vi.useRealTimers();
  }
});

test('memory maintenance fallback does not block a delayed queued run', async () => {
  vi.useFakeTimers();
  try {
    const { session, store } = createReconcileStore([
      { id: 'msg-1', type: 'user', content: 'continue the task', timestamp: 1, metadata: {} },
    ]);
    const adapter = new OpenClawRuntimeAdapter(store, {});
    const sessionKey = `agent:main:popiai:${session.id}`;
    const completeSpy = vi.fn();

    session.status = 'running';
    adapter.reconcileWithHistory = async () => {};
    adapter.on('complete', completeSpy);
    const turn = createActiveTurn(session.id, sessionKey, 'run-memory');
    turn.knownRunIds.add('run-followup');
    adapter.activeTurns.set(session.id, turn);

    adapter.handleAgentEvent({
      runId: 'run-memory',
      sessionKey,
      stream: 'tool',
      data: {
        toolCallId: 'memory-write',
        phase: 'start',
        name: 'write',
        args: { path: '/tmp/work/memory/2026-05-09.md' },
      },
    }, 1);
    adapter.handleChatEvent({
      state: 'final',
      runId: 'run-memory',
      sessionKey,
      message: { role: 'assistant', content: 'NO_REPLY' },
    }, 2);
    await Promise.resolve();
    await Promise.resolve();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(completeSpy).toHaveBeenCalledWith(session.id, 'run-memory');
    expect(session.status).toBe('completed');
    expect(adapter.activeTurns.has(session.id)).toBe(false);

    adapter.handleAgentEvent({
      runId: 'run-followup',
      sessionKey,
      stream: 'lifecycle',
      data: { phase: 'start' },
    }, 3);
    adapter.handleChatEvent({
      state: 'delta',
      runId: 'run-followup',
      sessionKey,
      message: { role: 'assistant', content: 'Real answer after delayed maintenance.' },
    }, 4);

    expect(session.status).toBe('running');
    expect(adapter.activeTurns.has(session.id)).toBe(true);
    expect(session.messages.some((message) => (
      message.type === 'assistant'
      && message.content === 'Real answer after delayed maintenance.'
    ))).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});

test('empty final with memory flush history waits for the original run to resume', async () => {
  vi.useFakeTimers();
  try {
    const { session, store } = createReconcileStore([
      { id: 'msg-1', type: 'user', content: 'create a Japanese version', timestamp: 1, metadata: {} },
    ]);
    const adapter = new OpenClawRuntimeAdapter(store, {});
    const sessionKey = `agent:main:popiai:${session.id}`;
    const completeSpy = vi.fn();
    const maintenanceSpy = vi.fn();

    adapter.gatewayClient = {
      start: () => {},
      stop: () => {},
      request: async (method: string) => {
        if (method !== 'chat.history') return {};
        return {
          messages: [
            {
              role: 'user',
              content: 'create a Japanese version',
            },
            {
              role: 'user',
              content: 'Pre-compaction memory flush. Store durable memories only in memory/2026-05-11.md. If nothing to store, reply with NO_REPLY.',
            },
            {
              role: 'assistant',
              content: [
                {
                  type: 'toolCall',
                  id: 'memory-write',
                  name: 'write',
                  arguments: { path: '/tmp/work/memory/2026-05-11.md' },
                },
              ],
            },
            {
              role: 'toolResult',
              toolCallId: 'memory-write',
              content: 'updated memory',
            },
          ],
        };
      },
    };

    session.status = 'running';
    adapter.reconcileWithHistory = async () => {};
    adapter.on('complete', completeSpy);
    adapter.on('contextMaintenance', maintenanceSpy);
    adapter.ensureActiveTurn(session.id, sessionKey, 'run-original');

    adapter.handleChatEvent({
      state: 'final',
      runId: 'run-original',
      sessionKey,
    }, 1);
    await vi.advanceTimersByTimeAsync(1_000);
    await Promise.resolve();
    await Promise.resolve();

    expect(session.status).toBe('running');
    expect(completeSpy).not.toHaveBeenCalled();
    expect(maintenanceSpy).toHaveBeenCalledWith(session.id, true);

    adapter.handleAgentEvent({
      runId: 'run-original',
      sessionKey,
      stream: 'lifecycle',
      data: { phase: 'start' },
    }, 2);
    adapter.handleChatEvent({
      state: 'delta',
      runId: 'run-original',
      sessionKey,
      message: { role: 'assistant', content: 'Real answer after memory flush.' },
    }, 3);

    expect(session.status).toBe('running');
    expect(adapter.activeTurns.has(session.id)).toBe(true);
    expect(session.messages.some((message) => (
      message.type === 'assistant'
      && message.content === 'Real answer after memory flush.'
    ))).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});

test('pre-compaction NO_REPLY without memory tools still waits for follow-up work', async () => {
  vi.useFakeTimers();
  try {
    const { session, store } = createReconcileStore([
      { id: 'msg-1', type: 'user', content: 'continue the task', timestamp: 1, metadata: {} },
    ]);
    const adapter = new OpenClawRuntimeAdapter(store, {});
    const sessionKey = `agent:main:popiai:${session.id}`;
    const completeSpy = vi.fn();
    const maintenanceSpy = vi.fn();

    adapter.gatewayClient = {
      start: () => {},
      stop: () => {},
      request: async (method: string) => {
        if (method !== 'chat.history') return {};
        return {
          messages: [
            {
              role: 'user',
              content: 'continue the task',
            },
            {
              role: 'user',
              content: 'Pre-compaction memory flush. Store durable memories only in memory/2026-05-11.md. If nothing to store, reply with NO_REPLY.',
            },
            {
              role: 'assistant',
              content: 'NO_REPLY',
            },
          ],
        };
      },
    };

    session.status = 'running';
    adapter.reconcileWithHistory = async () => {};
    adapter.on('complete', completeSpy);
    adapter.on('contextMaintenance', maintenanceSpy);
    adapter.ensureActiveTurn(session.id, sessionKey, 'run-original');

    adapter.handleChatEvent({
      state: 'final',
      runId: 'run-original',
      sessionKey,
      message: { role: 'assistant', content: 'NO_REPLY' },
    }, 1);
    await vi.advanceTimersByTimeAsync(1_000);
    await Promise.resolve();
    await Promise.resolve();

    expect(session.status).toBe('running');
    expect(completeSpy).not.toHaveBeenCalled();
    expect(session.messages.some((message) => message.type === 'assistant' && message.content === 'NO_REPLY')).toBe(false);
    expect(maintenanceSpy).toHaveBeenCalledWith(session.id, true);

    adapter.handleChatEvent({
      state: 'delta',
      runId: 'run-original',
      sessionKey,
      message: { role: 'assistant', content: 'Real answer after no-op memory flush.' },
    }, 2);

    expect(session.status).toBe('running');
    expect(adapter.activeTurns.has(session.id)).toBe(true);
    expect(session.messages.some((message) => (
      message.type === 'assistant'
      && message.content === 'Real answer after no-op memory flush.'
    ))).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});

test('silent token prefixes do not create visible assistant messages', () => {
  const { session, store } = createReconcileStore([
    { id: 'msg-1', type: 'user', content: 'continue the task', timestamp: 1, metadata: {} },
  ]);
  const adapter = new OpenClawRuntimeAdapter(store, {});
  const sessionKey = `agent:main:popiai:${session.id}`;

  session.status = 'running';
  adapter.activeTurns.set(session.id, createActiveTurn(session.id, sessionKey, 'run-memory'));

  adapter.handleAgentEvent({
    runId: 'run-memory',
    sessionKey,
    stream: 'assistant',
    data: { text: 'NO_REP' },
  }, 1);

  expect(session.messages.some((message) => message.type === 'assistant')).toBe(false);
});

test('usage metadata sync ignores silent latest assistant history entries', async () => {
  const { session, store } = createReconcileStore([
    { id: 'msg-1', type: 'user', content: 'Hello', timestamp: 1, metadata: {} },
    { id: 'msg-2', type: 'assistant', content: 'Visible answer', timestamp: 2, metadata: {} },
    { id: 'msg-3', type: 'assistant', content: 'NO_REPLY', timestamp: 3, metadata: {} },
  ]);
  const adapter = new OpenClawRuntimeAdapter(store, {});
  adapter.gatewayClient = {
    start: () => {},
    stop: () => {},
    request: async () => ({
      messages: [
        { role: 'user', content: 'Hello' },
        {
          role: 'assistant',
          content: 'NO_REPLY',
          model: 'qwen-portal/qwen3.6-plus',
          usage: { input: 40_668, output: 93 },
        },
      ],
    }),
  };

  await (adapter as unknown as {
    syncUsageMetadata: (sessionId: string, sessionKey: string, assistantMessageId: string) => Promise<void>;
  }).syncUsageMetadata(session.id, `agent:main:popiai:${session.id}`, 'missing-message-id');

  expect(session.messages[1].metadata).toEqual({});
  expect(session.messages[2].metadata).toEqual({});
});

test('memory maintenance wait is canceled when a follow-up run starts', async () => {
  vi.useFakeTimers();
  try {
    const { session, store } = createReconcileStore([
      { id: 'msg-1', type: 'user', content: 'continue the task', timestamp: 1, metadata: {} },
    ]);
    const adapter = new OpenClawRuntimeAdapter(store, {});
    const sessionKey = `agent:main:popiai:${session.id}`;
    const completeSpy = vi.fn();
    const maintenanceSpy = vi.fn();

    session.status = 'running';
    adapter.reconcileWithHistory = async () => {};
    adapter.on('complete', completeSpy);
    adapter.on('contextMaintenance', maintenanceSpy);
    adapter.activeTurns.set(session.id, createActiveTurn(session.id, sessionKey, 'run-memory'));

    adapter.handleAgentEvent({
      runId: 'run-memory',
      sessionKey,
      stream: 'tool',
      data: {
        toolCallId: 'memory-read',
        phase: 'start',
        name: 'read',
        args: { path: '/tmp/work/memory/2026-05-09.md' },
      },
    }, 1);
    adapter.handleChatEvent({
      state: 'final',
      runId: 'run-memory',
      sessionKey,
      message: { role: 'assistant', content: 'no_reply' },
    }, 2);
    await Promise.resolve();
    await Promise.resolve();

    adapter.bindRunIdToTurn(session.id, 'run-followup');
    adapter.handleAgentEvent({
      runId: 'run-followup',
      sessionKey,
      stream: 'lifecycle',
      data: { phase: 'start' },
    }, 3);

    await vi.advanceTimersByTimeAsync(16_000);
    expect(completeSpy).not.toHaveBeenCalled();
    expect(session.status).toBe('running');
    expect(adapter.activeTurns.has(session.id)).toBe(true);
    expect(maintenanceSpy).toHaveBeenLastCalledWith(session.id, false);
  } finally {
    vi.useRealTimers();
  }
});

test('memory maintenance lifecycle end does not close a follow-up run', async () => {
  vi.useFakeTimers();
  try {
    const { session, store } = createReconcileStore([
      { id: 'msg-1', type: 'user', content: 'continue the task', timestamp: 1, metadata: {} },
    ]);
    const adapter = new OpenClawRuntimeAdapter(store, {});
    const sessionKey = `agent:main:popiai:${session.id}`;
    const completeSpy = vi.fn();

    session.status = 'running';
    adapter.reconcileWithHistory = async () => {};
    adapter.on('complete', completeSpy);
    adapter.activeTurns.set(session.id, createActiveTurn(session.id, sessionKey, 'run-memory'));

    adapter.handleAgentEvent({
      runId: 'run-memory',
      sessionKey,
      stream: 'tool',
      data: {
        toolCallId: 'memory-read',
        phase: 'start',
        name: 'read',
        args: { path: '/tmp/work/memory/2026-05-09.md' },
      },
    }, 1);
    adapter.handleChatEvent({
      state: 'final',
      runId: 'run-memory',
      sessionKey,
      message: { role: 'assistant', content: 'NO_REPLY' },
    }, 2);
    adapter.handleAgentEvent({
      runId: 'run-memory',
      sessionKey,
      stream: 'lifecycle',
      data: { phase: 'end' },
    }, 3);
    await Promise.resolve();
    await Promise.resolve();

    adapter.handleAgentEvent({
      runId: 'run-followup',
      sessionKey,
      stream: 'lifecycle',
      data: { phase: 'start' },
    }, 4);

    await vi.advanceTimersByTimeAsync(5_000);
    adapter.handleChatEvent({
      state: 'delta',
      runId: 'run-followup',
      sessionKey,
      message: { role: 'assistant', content: 'Real answer after maintenance.' },
    }, 5);

    expect(completeSpy).not.toHaveBeenCalled();
    expect(session.status).toBe('running');
    expect(session.messages.some((message) => message.type === 'assistant' && message.content === 'Real answer after maintenance.')).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});

test('ordinary write tool does not trigger memory maintenance handling', async () => {
  const { session, store } = createReconcileStore([
    { id: 'msg-1', type: 'user', content: 'write a file', timestamp: 1, metadata: {} },
  ]);
  const adapter = new OpenClawRuntimeAdapter(store, {});
  const sessionKey = `agent:main:popiai:${session.id}`;
  const maintenanceSpy = vi.fn();

  adapter.on('contextMaintenance', maintenanceSpy);
  adapter.activeTurns.set(session.id, createActiveTurn(session.id, sessionKey, 'run-write'));
  adapter.handleAgentEvent({
    runId: 'run-write',
    sessionKey,
    stream: 'tool',
    data: {
      toolCallId: 'write-file',
      phase: 'start',
      name: 'write',
      args: { path: '/tmp/work/index.html' },
    },
  }, 1);

  expect(maintenanceSpy).not.toHaveBeenCalled();
  expect(session.messages.find((message) => message.type === 'tool_use')?.metadata?.toolName).toBe('write');
});

test('lifecycle error fallback waits before aborting a gateway run', async () => {
  vi.useFakeTimers();
  try {
    const { session, store } = createReconcileStore([
      { id: 'msg-1', type: 'user', content: 'hello', timestamp: 1, metadata: {} },
    ]);
    const adapter = new OpenClawRuntimeAdapter(store, {});
    const requests: Array<{ method: string; params: Record<string, unknown> }> = [];
    const sessionKey = `agent:main:popiai:${session.id}`;
    const turn = createActiveTurn(session.id, sessionKey, 'run-error');

    adapter.on('error', () => {});
    adapter.gatewayClient = {
      start: () => {},
      stop: () => {},
      request: async (method: string, params?: unknown) => {
        requests.push({ method, params: params as Record<string, unknown> });
        return {};
      },
    };
    adapter.activeTurns.set(session.id, turn);

    adapter.handleAgentLifecycleEvent(session.id, { phase: 'error', error: 'context exceeded' }, 'run-error');
    await vi.advanceTimersByTimeAsync(2_000);

    expect(requests.some((request) => request.method === 'chat.abort')).toBe(false);
    expect(session.status).toBe('completed');

    await vi.advanceTimersByTimeAsync(18_000);

    expect(requests.find((request) => request.method === 'chat.abort')?.params).toMatchObject({
      sessionKey,
      runId: 'run-error',
    });
    expect(session.status).toBe('error');
  } finally {
    vi.useRealTimers();
  }
});

test('lifecycle error fallback ignores a later run for the same session', async () => {
  vi.useFakeTimers();
  try {
    const { session, store } = createReconcileStore([
      { id: 'msg-1', type: 'user', content: 'hello', timestamp: 1, metadata: {} },
    ]);
    const adapter = new OpenClawRuntimeAdapter(store, {});
    const requests: Array<{ method: string; params: Record<string, unknown> }> = [];
    const sessionKey = `agent:main:popiai:${session.id}`;

    adapter.gatewayClient = {
      start: () => {},
      stop: () => {},
      request: async (method: string, params?: unknown) => {
        requests.push({ method, params: params as Record<string, unknown> });
        return {};
      },
    };
    adapter.activeTurns.set(session.id, createActiveTurn(session.id, sessionKey, 'old-run'));

    adapter.handleAgentLifecycleEvent(session.id, { phase: 'error', error: 'old run failed' }, 'old-run');
    adapter.activeTurns.set(session.id, createActiveTurn(session.id, sessionKey, 'new-run'));

    await vi.advanceTimersByTimeAsync(20_000);

    expect(requests.some((request) => request.method === 'chat.abort')).toBe(false);
    expect(session.status).toBe('completed');
    expect(adapter.activeTurns.get(session.id)?.runId).toBe('new-run');
  } finally {
    vi.useRealTimers();
  }
});

test('reconcileWithHistory: preserves tool messages', async () => {
  const { session, store, getReplaceCallCount } = createReconcileStore([
    { id: 'msg-1', type: 'user', content: 'Run a command', timestamp: 1, metadata: {} },
    { id: 'msg-2', type: 'tool_use', content: 'Using bash', timestamp: 2, metadata: {} },
    { id: 'msg-3', type: 'tool_result', content: 'OK', timestamp: 3, metadata: {} },
    { id: 'msg-4', type: 'assistant', content: 'Done!', timestamp: 4, metadata: {} },
  ]);

  const adapter = new OpenClawRuntimeAdapter(store, {});
  adapter.gatewayClient = {
    start: () => {},
    stop: () => {},
    request: async () => ({
      messages: [
        { role: 'user', content: 'Run a command' },
        { role: 'assistant', content: 'Done!' },
      ],
    }),
  };

  await adapter.reconcileWithHistory(session.id, 'managed:session-1');

  expect(getReplaceCallCount()).toBe(0);
});

test('reconcileWithHistory: gateway returns tail subset — preserves older local messages', async () => {
  const { session, store, getReplaceCallCount } = createReconcileStore([
    { id: 'msg-1', type: 'user', content: 'Hello', timestamp: 1, metadata: {} },
    { id: 'msg-2', type: 'assistant', content: 'Hi there', timestamp: 2, metadata: {} },
    { id: 'msg-3', type: 'user', content: 'How are you?', timestamp: 3, metadata: {} },
    { id: 'msg-4', type: 'assistant', content: 'I am fine', timestamp: 4, metadata: {} },
  ]);

  const adapter = new OpenClawRuntimeAdapter(store, {});
  adapter.gatewayClient = {
    start: () => {},
    stop: () => {},
    request: async () => ({
      messages: [
        { role: 'user', content: 'How are you?' },
        { role: 'assistant', content: 'I am fine' },
      ],
    }),
  };

  await adapter.reconcileWithHistory(session.id, 'managed:session-1');

  expect(getReplaceCallCount()).toBe(0);
  expect(session.messages.length).toBe(4);
});

test('reconcileWithHistory: tail window starting with assistant does not rewrite when already synced', async () => {
  const { session, store, getReplaceCallCount } = createReconcileStore([
    { id: 'msg-1', type: 'user', content: 'First question', timestamp: 1, metadata: {} },
    { id: 'msg-2', type: 'assistant', content: 'First answer', timestamp: 2, metadata: {} },
    { id: 'msg-3', type: 'user', content: 'Second question', timestamp: 3, metadata: {} },
    { id: 'msg-4', type: 'assistant', content: 'Second answer', timestamp: 4, metadata: {} },
  ]);

  const adapter = new OpenClawRuntimeAdapter(store, {});
  adapter.gatewayClient = {
    start: () => {},
    stop: () => {},
    request: async () => ({
      messages: [
        { role: 'assistant', content: 'First answer' },
        { role: 'user', content: 'Second question' },
        { role: 'assistant', content: 'Second answer' },
      ],
    }),
  };

  await adapter.reconcileWithHistory(session.id, 'managed:session-1');

  expect(getReplaceCallCount()).toBe(0);
  expect(session.messages.length).toBe(4);
});

test('reconcileWithHistory: tail window starting with assistant updates anchored tail without duplication', async () => {
  const { session, store, getReplaceCallCount, getLastReplaceArgs } = createReconcileStore([
    { id: 'msg-1', type: 'user', content: 'First question', timestamp: 1, metadata: {} },
    { id: 'msg-2', type: 'assistant', content: 'First answer', timestamp: 2, metadata: {} },
    { id: 'msg-3', type: 'user', content: 'Second question', timestamp: 3, metadata: {} },
    { id: 'msg-4', type: 'assistant', content: 'Streaming partial...', timestamp: 4, metadata: {} },
  ]);

  const adapter = new OpenClawRuntimeAdapter(store, {});
  adapter.gatewayClient = {
    start: () => {},
    stop: () => {},
    request: async () => ({
      messages: [
        { role: 'assistant', content: 'First answer' },
        { role: 'user', content: 'Second question' },
        { role: 'assistant', content: 'Full complete answer from gateway.' },
      ],
    }),
  };

  await adapter.reconcileWithHistory(session.id, 'managed:session-1');
  await adapter.reconcileWithHistory(session.id, 'managed:session-1');

  expect(getReplaceCallCount()).toBe(1);
  expect(getLastReplaceArgs()!.authoritative).toEqual([
    { role: 'user', text: 'First question', timestamp: 1, metadata: {} },
    { role: 'assistant', text: 'First answer', timestamp: 2, metadata: {} },
    { role: 'user', text: 'Second question', timestamp: 3 },
    { role: 'assistant', text: 'Full complete answer from gateway.' },
  ]);
});

test('reconcileWithHistory: tail window repairs stale leading assistant before anchor', async () => {
  const { session, store, getReplaceCallCount, getLastReplaceArgs } = createReconcileStore([
    { id: 'msg-1', type: 'user', content: 'First question', timestamp: 1, metadata: {} },
    { id: 'msg-2', type: 'assistant', content: 'Stale previous answer', timestamp: 2, metadata: {} },
    { id: 'msg-3', type: 'user', content: 'Second question', timestamp: 3, metadata: {} },
    { id: 'msg-4', type: 'assistant', content: 'Streaming partial...', timestamp: 4, metadata: {} },
  ]);

  const adapter = new OpenClawRuntimeAdapter(store, {});
  adapter.gatewayClient = {
    start: () => {},
    stop: () => {},
    request: async () => ({
      messages: [
        { role: 'assistant', content: 'Correct previous answer' },
        { role: 'user', content: 'Second question' },
        { role: 'assistant', content: 'Full complete answer from gateway.' },
      ],
    }),
  };

  await adapter.reconcileWithHistory(session.id, 'managed:session-1');

  expect(getReplaceCallCount()).toBe(1);
  expect(getLastReplaceArgs()!.authoritative).toEqual([
    { role: 'user', text: 'First question', timestamp: 1, metadata: {} },
    { role: 'assistant', text: 'Correct previous answer' },
    { role: 'user', text: 'Second question', timestamp: 3 },
    { role: 'assistant', text: 'Full complete answer from gateway.' },
  ]);
});

test('reconcileWithHistory: empty history — sets cursor to 0', async () => {
  const { session, store, getReplaceCallCount } = createReconcileStore([
    { id: 'msg-1', type: 'user', content: 'Hello', timestamp: 1, metadata: {} },
  ]);

  const adapter = new OpenClawRuntimeAdapter(store, {});
  adapter.gatewayClient = {
    start: () => {},
    stop: () => {},
    request: async () => ({ messages: [] }),
  };

  await adapter.reconcileWithHistory(session.id, 'managed:session-1');

  expect(getReplaceCallCount()).toBe(0);
  expect(adapter.channelSyncCursor.get(session.id)).toBe(0);
});

test('reconcileWithHistory: multi-turn conversation — correct order', async () => {
  const { session, store, getReplaceCallCount, getLastReplaceArgs } = createReconcileStore([
    { id: 'msg-1', type: 'user', content: 'First', timestamp: 1, metadata: {} },
    { id: 'msg-2', type: 'assistant', content: 'Reply 1', timestamp: 2, metadata: {} },
    // Missing second turn
  ]);

  const adapter = new OpenClawRuntimeAdapter(store, {});
  adapter.gatewayClient = {
    start: () => {},
    stop: () => {},
    request: async () => ({
      messages: [
        { role: 'user', content: 'First' },
        { role: 'assistant', content: 'Reply 1' },
        { role: 'user', content: 'Second' },
        { role: 'assistant', content: 'Reply 2' },
      ],
    }),
  };

  await adapter.reconcileWithHistory(session.id, 'managed:session-1');

  expect(getReplaceCallCount()).toBe(1);
  const args = getLastReplaceArgs()!;
  expect(args.authoritative.length).toBe(4);
  expect((args.authoritative[2] as Record<string, unknown>).text).toBe('Second');
  expect((args.authoritative[3] as Record<string, unknown>).text).toBe('Reply 2');
});

test('reconcileWithHistory: gateway error — does not crash', async () => {
  const { session, store, getReplaceCallCount } = createReconcileStore([
    { id: 'msg-1', type: 'user', content: 'Hello', timestamp: 1, metadata: {} },
  ]);

  const adapter = new OpenClawRuntimeAdapter(store, {});
  adapter.gatewayClient = {
    start: () => {},
    stop: () => {},
    request: async () => { throw new Error('Network timeout'); },
  };

  // Should not throw
  await adapter.reconcileWithHistory(session.id, 'managed:session-1');

  expect(getReplaceCallCount()).toBe(0);
});

test('reconcileWithHistory: tail content mismatch — replaces only tail, preserves prefix', async () => {
  const { session, store, getReplaceCallCount, getLastReplaceArgs } = createReconcileStore([
    { id: 'msg-1', type: 'user', content: 'First question', timestamp: 1, metadata: {} },
    { id: 'msg-2', type: 'assistant', content: 'First answer', timestamp: 2, metadata: {} },
    { id: 'msg-3', type: 'user', content: 'Second question', timestamp: 3, metadata: {} },
    { id: 'msg-4', type: 'assistant', content: 'Streaming partial...', timestamp: 4, metadata: {} },
  ]);

  const adapter = new OpenClawRuntimeAdapter(store, {});
  adapter.gatewayClient = {
    start: () => {},
    stop: () => {},
    request: async () => ({
      messages: [
        { role: 'user', content: 'Second question' },
        { role: 'assistant', content: 'Full complete answer from gateway.' },
      ],
    }),
  };

  await adapter.reconcileWithHistory(session.id, 'managed:session-1');

  expect(getReplaceCallCount()).toBe(1);
  const args = getLastReplaceArgs()!;
  // Prefix [First question, First answer] preserved + auth [Second question, Full complete answer]
  expect(args.authoritative.length).toBe(4);
  expect((args.authoritative[0] as Record<string, unknown>).text).toBe('First question');
  expect((args.authoritative[1] as Record<string, unknown>).text).toBe('First answer');
  expect((args.authoritative[2] as Record<string, unknown>).text).toBe('Second question');
  expect((args.authoritative[3] as Record<string, unknown>).text).toBe('Full complete answer from gateway.');
});

test('reconcileWithHistory: long conversation — preserves prefix, replaces tail', async () => {
  // Simulate a long conversation: 10 local turns, gateway returns last 3 turns
  const localMessages = [];
  for (let i = 1; i <= 10; i++) {
    localMessages.push(
      { id: `msg-u${i}`, type: 'user', content: `Question ${i}`, timestamp: i * 2 - 1, metadata: {} },
      { id: `msg-a${i}`, type: 'assistant', content: `Answer ${i}`, timestamp: i * 2, metadata: {} },
    );
  }

  const { session, store, getReplaceCallCount, getLastReplaceArgs } = createReconcileStore(localMessages);

  const adapter = new OpenClawRuntimeAdapter(store, {});
  adapter.gatewayClient = {
    start: () => {},
    stop: () => {},
    request: async () => ({
      messages: [
        { role: 'user', content: 'Question 8' },
        { role: 'assistant', content: 'Answer 8' },
        { role: 'user', content: 'Question 9' },
        { role: 'assistant', content: 'Answer 9' },
        { role: 'user', content: 'Question 10' },
        { role: 'assistant', content: 'Answer 10 updated' }, // updated content
      ],
    }),
  };

  await adapter.reconcileWithHistory(session.id, 'managed:session-1');

  expect(getReplaceCallCount()).toBe(1);
  const args = getLastReplaceArgs()!;
  // 7 preserved turns (14 entries) + 3 auth turns (6 entries) = 20 total
  expect(args.authoritative.length).toBe(20);
  // First preserved entry
  expect((args.authoritative[0] as Record<string, unknown>).text).toBe('Question 1');
  // Last preserved entry
  expect((args.authoritative[13] as Record<string, unknown>).text).toBe('Answer 7');
  // Last entry from gateway
  expect((args.authoritative[19] as Record<string, unknown>).text).toBe('Answer 10 updated');
});

test('reconcileWithHistory: no overlap — full replace for dashboard consistency', async () => {
  const { session, store, getReplaceCallCount, getLastReplaceArgs } = createReconcileStore([
    { id: 'msg-1', type: 'user', content: 'Old message 1', timestamp: 1, metadata: {} },
    { id: 'msg-2', type: 'assistant', content: 'Old reply 1', timestamp: 2, metadata: {} },
  ]);

  const adapter = new OpenClawRuntimeAdapter(store, {});
  adapter.gatewayClient = {
    start: () => {},
    stop: () => {},
    request: async () => ({
      messages: [
        { role: 'user', content: 'Completely new message' },
        { role: 'assistant', content: 'Completely new reply' },
      ],
    }),
  };

  await adapter.reconcileWithHistory(session.id, 'managed:session-1');

  // No overlap: full replace to match dashboard
  expect(getReplaceCallCount()).toBe(1);
  const args = getLastReplaceArgs()!;
  expect(args.authoritative.length).toBe(2);
  expect((args.authoritative[0] as Record<string, unknown>).text).toBe('Completely new message');
});

test('reconcileWithHistory: identical user messages — aligns to latest match', async () => {
  const { session, store, getReplaceCallCount } = createReconcileStore([
    { id: 'msg-1', type: 'user', content: 'Hello', timestamp: 1, metadata: {} },
    { id: 'msg-2', type: 'assistant', content: 'Hi (first)', timestamp: 2, metadata: {} },
    { id: 'msg-3', type: 'user', content: 'Hello', timestamp: 3, metadata: {} },
    { id: 'msg-4', type: 'assistant', content: 'Hi (second)', timestamp: 4, metadata: {} },
  ]);

  const adapter = new OpenClawRuntimeAdapter(store, {});
  adapter.gatewayClient = {
    start: () => {},
    stop: () => {},
    request: async () => ({
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi (second)' },
      ],
    }),
  };

  await adapter.reconcileWithHistory(session.id, 'managed:session-1');

  // Tail matches (user anchor aligns to latest "Hello") — no replace needed
  expect(getReplaceCallCount()).toBe(0);
  expect(session.messages.length).toBe(4);
});

test('reconcileWithHistory: new messages arrived — preserves old and adds new', async () => {
  const { session, store, getReplaceCallCount, getLastReplaceArgs } = createReconcileStore([
    { id: 'msg-1', type: 'user', content: 'Question 1', timestamp: 1, metadata: {} },
    { id: 'msg-2', type: 'assistant', content: 'Answer 1', timestamp: 2, metadata: {} },
    { id: 'msg-3', type: 'user', content: 'Question 2', timestamp: 3, metadata: {} },
    { id: 'msg-4', type: 'assistant', content: 'Answer 2', timestamp: 4, metadata: {} },
  ]);

  const adapter = new OpenClawRuntimeAdapter(store, {});
  adapter.gatewayClient = {
    start: () => {},
    stop: () => {},
    request: async () => ({
      messages: [
        { role: 'user', content: 'Question 2' },
        { role: 'assistant', content: 'Answer 2' },
        { role: 'user', content: 'Question 3' },
        { role: 'assistant', content: 'Answer 3' },
      ],
    }),
  };

  await adapter.reconcileWithHistory(session.id, 'managed:session-1');

  expect(getReplaceCallCount()).toBe(1);
  const args = getLastReplaceArgs()!;
  // Preserved [Q1, A1] + auth [Q2, A2, Q3, A3] = 6
  expect(args.authoritative.length).toBe(6);
  expect((args.authoritative[0] as Record<string, unknown>).text).toBe('Question 1');
  expect((args.authoritative[1] as Record<string, unknown>).text).toBe('Answer 1');
  expect((args.authoritative[5] as Record<string, unknown>).text).toBe('Answer 3');
});

// ==================== History tests ====================

function createHistoryStore(messages: Array<Record<string, unknown>>) {
  const session = {
    id: 'session-1',
    title: 'Channel Session',
    claudeSessionId: null,
    status: 'completed',
    pinned: false,
    cwd: '',
    systemPrompt: '',
    executionMode: 'local',
    activeSkillIds: [],
    messages: [...messages],
    createdAt: 1,
    updatedAt: 1,
  };
  let nextId = session.messages.length + 1;

  return {
    session,
    store: {
      getSession: (sessionId: string) => (sessionId === session.id ? session : null),
      getRecentConversationMessages: (sessionId: string, limit: number) => {
        expect(sessionId).toBe(session.id);
        return session.messages
          .filter((message) => message.type === 'user' || message.type === 'assistant')
          .slice(-Math.max(0, Math.floor(limit)));
      },
      getAllConversationMessages: (sessionId: string) => {
        expect(sessionId).toBe(session.id);
        return session.messages
          .filter((message) => message.type === 'user' || message.type === 'assistant');
      },
      addMessage: (sessionId: string, message: Record<string, unknown>) => {
        expect(sessionId).toBe(session.id);
        const created = {
          id: `msg-${nextId++}`,
          timestamp: nextId,
          metadata: {},
          ...message,
        };
        session.messages.push(created);
        return created;
      },
      replaceConversationMessages: (sessionId: string, authoritative: Array<Record<string, unknown>>) => {
        expect(sessionId).toBe(session.id);
        session.messages = session.messages.filter(
          (message) => message.type !== 'user' && message.type !== 'assistant',
        );
        for (const entry of authoritative) {
          session.messages.push({
            id: `msg-${nextId++}`,
            type: entry.role,
            content: entry.text,
            metadata: { isStreaming: false, isFinal: true },
            timestamp: typeof entry.timestamp === 'number' ? entry.timestamp : nextId,
          });
        }
      },
      updateSession: () => {},
    },
  };
}

const getSystemMessages = (session: { messages: Array<{ type: string }> }) =>
  session.messages.filter((message) => message.type === 'system');

test('syncFullChannelHistory seeds gateway history cursor so old reminders are not replayed', async () => {
  const { session, store } = createHistoryStore([
    { id: 'msg-1', type: 'user', content: 'old user', timestamp: 1, metadata: {} },
    { id: 'msg-2', type: 'assistant', content: 'old assistant', timestamp: 2, metadata: { isStreaming: false, isFinal: true } },
  ]);
  const historyMessages = [
    { role: 'user', content: 'old user' },
    { role: 'assistant', content: 'old assistant' },
    { role: 'system', content: 'Reminder: old reminder' },
  ];

  const adapter = new OpenClawRuntimeAdapter(store, {});
  adapter.gatewayClient = {
    start: () => {},
    stop: () => {},
    request: async () => ({ messages: historyMessages }),
  };

  await adapter.syncFullChannelHistory(session.id, 'dingtalk-connector:acct:user');

  expect(adapter.gatewayHistoryCountBySession.get(session.id)).toBe(historyMessages.length);

  adapter.syncSystemMessagesFromHistory(session.id, historyMessages, {
    previousCountKnown: adapter.gatewayHistoryCountBySession.has(session.id),
    previousCount: adapter.gatewayHistoryCountBySession.get(session.id) ?? 0,
  });

  expect(getSystemMessages(session).length).toBe(0);
});

test('prefetchChannelUserMessages also consumes existing reminder history backlog', async () => {
  const { session, store } = createHistoryStore([
    { id: 'msg-1', type: 'user', content: 'old user', timestamp: 1, metadata: {} },
    { id: 'msg-2', type: 'assistant', content: 'old assistant', timestamp: 2, metadata: { isStreaming: false, isFinal: true } },
  ]);
  const historyMessages = [
    { role: 'user', content: 'old user' },
    { role: 'assistant', content: 'old assistant' },
    { role: 'system', content: 'Reminder: old reminder' },
    { role: 'user', content: 'new user turn' },
  ];

  const adapter = new OpenClawRuntimeAdapter(store, {});
  adapter.gatewayClient = {
    start: () => {},
    stop: () => {},
    request: async () => ({ messages: historyMessages }),
  };

  await adapter.prefetchChannelUserMessages(session.id, 'dingtalk-connector:acct:user');

  expect(adapter.gatewayHistoryCountBySession.get(session.id)).toBe(historyMessages.length);
  expect(session.messages.filter((message: Record<string, unknown>) => message.type === 'user').length).toBe(2);

  adapter.syncSystemMessagesFromHistory(session.id, historyMessages, {
    previousCountKnown: adapter.gatewayHistoryCountBySession.has(session.id),
    previousCount: adapter.gatewayHistoryCountBySession.get(session.id) ?? 0,
  });

  expect(getSystemMessages(session).length).toBe(0);
});

test('syncSystemMessagesFromHistory skips pure heartbeat ack system messages', () => {
  const { session, store } = createHistoryStore([]);
  const adapter = new OpenClawRuntimeAdapter(store, {});
  const historyMessages = [
    { role: 'system', content: 'HEARTBEAT_OK' },
    { role: 'system', content: 'Reminder fired' },
  ];

  adapter.syncSystemMessagesFromHistory(session.id, historyMessages, {
    previousCountKnown: false,
    previousCount: 0,
  });

  expect(getSystemMessages(session).map((message) => message.content)).toEqual(['Reminder fired']);
});

test('child lifecycle end marks matching subagent done before local session resolution', () => {
  const runs = new Map<string, Record<string, unknown>>();
  const subagentRunStore = {
    insertSubagentRun: vi.fn((run: Record<string, unknown>) => {
      runs.set(run.id as string, { ...run });
    }),
    updateSubagentRunStatus: vi.fn((id: string, status: string, endedAt?: number) => {
      const run = runs.get(id);
      if (run) {
        run.status = status;
        run.endedAt = endedAt;
      }
    }),
    listSubagentRuns: () => [],
  };
  const adapter = new OpenClawRuntimeAdapter(
    { getSession: () => null } as never,
    {},
    {},
    subagentRunStore as never,
  );
  const childSessionKey = 'agent:main:subagent:e0fbd45e-25ef-4765-b1b1-a82035637f31';

  adapter.subagentTracker.onToolStart(
    'call-fibonacci',
    { taskName: 'fibonacci', task: 'calculate fibonacci' },
    'parent-session',
  );
  adapter.subagentTracker.onSpawnResult(
    'call-fibonacci',
    JSON.stringify({
      status: 'accepted',
      childSessionKey,
      runId: '7d6f0db8-1066-4900-b6ea-a47b23825c8e',
    }),
    {},
  );

  adapter.handleAgentEvent({
    runId: '7d6f0db8-1066-4900-b6ea-a47b23825c8e',
    sessionKey: childSessionKey,
    stream: 'lifecycle',
    data: { phase: 'end' },
  }, 1);

  expect(subagentRunStore.updateSubagentRunStatus).toHaveBeenCalledWith(
    'call-fibonacci',
    'done',
    expect.any(Number),
  );
  expect(runs.get('call-fibonacci')?.status).toBe('done');
});

test('child chat final marks matching subagent done before local session resolution', () => {
  const runs = new Map<string, Record<string, unknown>>();
  const subagentRunStore = {
    insertSubagentRun: vi.fn((run: Record<string, unknown>) => {
      runs.set(run.id as string, { ...run });
    }),
    updateSubagentRunStatus: vi.fn((id: string, status: string, endedAt?: number) => {
      const run = runs.get(id);
      if (run) {
        run.status = status;
        run.endedAt = endedAt;
      }
    }),
    listSubagentRuns: () => [],
  };
  const adapter = new OpenClawRuntimeAdapter(
    { getSession: () => null } as never,
    {},
    {},
    subagentRunStore as never,
  );
  const childSessionKey = 'agent:main:subagent:e0fbd45e-25ef-4765-b1b1-a82035637f31';

  adapter.subagentTracker.onToolStart(
    'call-fibonacci',
    { taskName: 'fibonacci', task: 'calculate fibonacci' },
    'parent-session',
  );
  adapter.subagentTracker.onSpawnResult(
    'call-fibonacci',
    JSON.stringify({
      status: 'accepted',
      childSessionKey,
      runId: '7d6f0db8-1066-4900-b6ea-a47b23825c8e',
    }),
    {},
  );

  adapter.handleChatEvent({
    state: 'final',
    runId: '7d6f0db8-1066-4900-b6ea-a47b23825c8e',
    sessionKey: childSessionKey,
    message: { role: 'assistant', content: 'completed' },
  }, 1);

  expect(subagentRunStore.updateSubagentRunStatus).toHaveBeenCalledWith(
    'call-fibonacci',
    'done',
    expect.any(Number),
  );
  expect(runs.get('call-fibonacci')?.status).toBe('done');
});

test('stopSession aborts running subagent sessions tracked under the parent', async () => {
  const { session, store } = createReconcileStore([
    { id: 'msg-1', type: 'user', content: 'spawn worker', timestamp: 1, metadata: {} },
  ]);
  const requests: Array<{ method: string; params: Record<string, unknown> }> = [];
  const runs = new Map<string, Record<string, unknown>>();
  const subagentRunStore = {
    insertSubagentRun: vi.fn((run: Record<string, unknown>) => {
      runs.set(run.id as string, { ...run });
    }),
    updateSubagentRunStatus: vi.fn((id: string, status: string, endedAt?: number) => {
      const run = runs.get(id);
      if (run) {
        run.status = status;
        run.endedAt = endedAt;
      }
    }),
    updateSubagentRunSessionKey: vi.fn((id: string, sessionKey: string) => {
      const run = runs.get(id);
      if (run) run.sessionKey = sessionKey;
    }),
    listSubagentRuns: vi.fn((parentSessionId: string) =>
      Array.from(runs.values()).filter(run => run.parentSessionId === parentSessionId),
    ),
    getSubagentRun: vi.fn((id: string) => runs.get(id) ?? null),
  };
  const adapter = new OpenClawRuntimeAdapter(store, {}, {}, subagentRunStore as never);
  const parentSessionKey = `agent:main:popiai:${session.id}`;
  const childSessionKey = 'agent:main:subagent:e0fbd45e-25ef-4765-b1b1-a82035637f31';

  session.status = 'running';
  adapter.activeTurns.set(session.id, createActiveTurn(session.id, parentSessionKey, 'parent-run'));
  adapter.gatewayClient = {
    start: () => {},
    stop: () => {},
    request: async (method: string, params?: unknown) => {
      requests.push({ method, params: params as Record<string, unknown> });
      return {};
    },
  };

  adapter.subagentTracker.onToolStart(
    'call-worker',
    { agentId: 'main', task: 'do child work' },
    session.id,
  );
  adapter.subagentTracker.onSpawnResult(
    'call-worker',
    JSON.stringify({
      status: 'accepted',
      childSessionKey,
    }),
    {},
  );

  adapter.stopSession(session.id);
  await Promise.resolve();

  expect(requests.filter(request => request.method === 'chat.abort')).toEqual([
    {
      method: 'chat.abort',
      params: {
        sessionKey: parentSessionKey,
        runId: 'parent-run',
      },
    },
    {
      method: 'chat.abort',
      params: {
        sessionKey: childSessionKey,
      },
    },
  ]);
  expect(session.status).toBe('idle');
});

test('subagent child sessions subscribe to gateway message events even when not materialized', async () => {
  const parentSession = {
    id: 'parent-session',
    agentId: 'child-agent',
    messages: [],
  };
  const childSessions = new Map<string, Record<string, unknown>>();
  const requests: Array<{ method: string; params: Record<string, unknown> }> = [];
  const runs = new Map<string, Record<string, unknown>>();
  const store = {
    getSession: vi.fn((sessionId: string) => (
      sessionId === parentSession.id
        ? parentSession
        : childSessions.get(sessionId) ?? null
    )),
    getAgent: vi.fn(() => ({ name: 'Child Agent' })),
    upsertSubagentChildSession: vi.fn((params: Record<string, unknown>) => {
      const session = {
        id: params.id,
        parentSessionId: params.parentSessionId,
        status: params.status,
        messages: [],
      };
      childSessions.set(String(params.id), session);
      return session;
    }),
    updateSession: vi.fn(),
  };
  const subagentRunStore = {
    insertSubagentRun: vi.fn((run: Record<string, unknown>) => {
      runs.set(run.id as string, { ...run });
    }),
    updateSubagentRunStatus: vi.fn(),
    updateSubagentRunSessionKey: vi.fn(),
    updateSubagentRunChildSession: vi.fn(),
    getSubagentRun: vi.fn((id: string) => runs.get(id) ?? null),
    listSubagentRuns: vi.fn(() => Array.from(runs.values())),
  };
  const adapter = new OpenClawRuntimeAdapter(
    store as never,
    {},
    {},
    subagentRunStore as never,
  );
  const childSessionKey = 'agent:child-agent:subagent:e0fbd45e-25ef-4765-b1b1-a82035637f31';

  adapter.gatewayClient = {
    start: () => {},
    stop: () => {},
    request: async (method: string, params?: unknown) => {
      requests.push({ method, params: params as Record<string, unknown> });
      if (method === 'sessions.messages.subscribe') {
        return { subscribed: true, key: childSessionKey };
      }
      if (method === 'chat.history') {
        return { messages: [] };
      }
      return {};
    },
  };

  adapter.subagentTracker.onToolStart(
    'call-worker',
    { agentId: 'child-task-name', task: 'do child work' },
    parentSession.id,
  );
  adapter.subagentTracker.onSpawnResult(
    'call-worker',
    JSON.stringify({
      status: 'accepted',
      childSessionKey,
    }),
    {},
  );
  await Promise.resolve();

  expect(store.upsertSubagentChildSession).not.toHaveBeenCalled();
  expect(requests).toContainEqual({
    method: 'sessions.messages.subscribe',
    params: {
      key: childSessionKey,
      agentId: 'child-agent',
    },
  });
});

test('unmapped subagent assistant stream is cached for subtask history', async () => {
  const parentSession = {
    id: 'parent-session',
    agentId: 'child-agent',
    messages: [],
  };
  const runs = new Map<string, Record<string, unknown>>();
  const store = {
    getSession: vi.fn((sessionId: string) => (
      sessionId === parentSession.id ? parentSession : null
    )),
    getAgent: vi.fn(() => ({ name: 'Child Agent' })),
    updateSession: vi.fn(),
  };
  const subagentRunStore = {
    insertSubagentRun: vi.fn((run: Record<string, unknown>) => {
      runs.set(run.id as string, { ...run });
    }),
    updateSubagentRunStatus: vi.fn(),
    updateSubagentRunSessionKey: vi.fn(),
    updateSubagentRunChildSession: vi.fn(),
    getSubagentRun: vi.fn((id: string) => runs.get(id) ?? null),
    findSubagentRunBySessionKey: vi.fn((sessionKey: string) =>
      Array.from(runs.values()).find(run => run.sessionKey === sessionKey) ?? null,
    ),
    listSubagentRuns: vi.fn(() => Array.from(runs.values())),
    isMessagesPersisted: vi.fn(() => false),
  };
  const adapter = new OpenClawRuntimeAdapter(
    store as never,
    {},
    {},
    subagentRunStore as never,
  );
  const childSessionKey = 'agent:child-agent:subagent:e0fbd45e-25ef-4765-b1b1-a82035637f31';

  adapter.gatewayClient = {
    start: () => {},
    stop: () => {},
    request: async (method: string) => (
      method === 'sessions.messages.subscribe'
        ? { subscribed: true, key: childSessionKey }
        : { messages: [] }
    ),
  };

  adapter.subagentTracker.onToolStart(
    'call-worker',
    { agentId: 'child-agent', task: 'do child work' },
    parentSession.id,
  );
  adapter.subagentTracker.onSpawnResult(
    'call-worker',
    JSON.stringify({
      status: 'accepted',
      childSessionKey,
    }),
    {},
  );
  (adapter as unknown as {
    processAgentAssistantText: (payload: unknown) => void;
  }).processAgentAssistantText({
    event: 'agent',
    stream: 'assistant',
    sessionKey: childSessionKey,
    runId: 'child-run',
    data: { text: 'child streamed answer' },
  });

  const messages = await adapter.getSubTaskHistory(parentSession.id, 'call-worker', childSessionKey);
  expect(messages).toHaveLength(2);
  expect(messages[0]).toMatchObject({
    type: 'user',
    content: 'do child work',
  });
  expect(messages[1]).toMatchObject({
    type: 'assistant',
    content: 'child streamed answer',
  });
});

test('terminal subagent status preserves pending streamed message snapshot', async () => {
  vi.useFakeTimers();
  try {
    const adapter = new OpenClawRuntimeAdapter({} as never, {} as never);
    const emitSpy = vi.spyOn(adapter as unknown as {
      emitSubagentMessagesChanged: (event: Record<string, unknown>) => void;
    }, 'emitSubagentMessagesChanged').mockImplementation(() => {});
    const streamedMessages = [{
      id: 'subagent-message-1',
      type: 'assistant' as const,
      content: '你好！我是 Popi 派出的第三位子代理，目前处于待命状态。',
      timestamp: 1,
      metadata: { isStreaming: true, isFinal: false },
    }];
    const notify = (adapter as unknown as {
      notifySubagentMessagesChanged: (event: Record<string, unknown>) => void;
    }).notifySubagentMessagesChanged.bind(adapter);

    notify({
      parentSessionId: 'parent-session',
      runId: 'call-worker',
      sessionKey: 'agent:child-agent:subagent:e0fbd45e-25ef-4765-b1b1-a82035637f31',
      status: 'running',
      messages: streamedMessages,
    });
    expect(emitSpy).not.toHaveBeenCalled();

    notify({
      parentSessionId: 'parent-session',
      runId: 'call-worker',
      sessionKey: 'agent:child-agent:subagent:e0fbd45e-25ef-4765-b1b1-a82035637f31',
      status: 'done',
    });

    expect(emitSpy).toHaveBeenCalledTimes(1);
    expect(emitSpy).toHaveBeenCalledWith({
      parentSessionId: 'parent-session',
      runId: 'call-worker',
      sessionKey: 'agent:child-agent:subagent:e0fbd45e-25ef-4765-b1b1-a82035637f31',
      status: 'done',
      messages: streamedMessages,
    });

    await vi.advanceTimersByTimeAsync(200);
    expect(emitSpy).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});

test('unmapped subagent session.tool events are cached for subtask history', async () => {
  const parentSession = {
    id: 'parent-session',
    agentId: 'child-agent',
    messages: [],
  };
  const runs = new Map<string, Record<string, unknown>>();
  const store = {
    getSession: vi.fn((sessionId: string) => (
      sessionId === parentSession.id ? parentSession : null
    )),
    getAgent: vi.fn(() => ({ name: 'Child Agent' })),
    updateSession: vi.fn(),
  };
  const subagentRunStore = {
    insertSubagentRun: vi.fn((run: Record<string, unknown>) => {
      runs.set(run.id as string, { ...run });
    }),
    updateSubagentRunStatus: vi.fn(),
    updateSubagentRunSessionKey: vi.fn(),
    updateSubagentRunChildSession: vi.fn(),
    getSubagentRun: vi.fn((id: string) => runs.get(id) ?? null),
    findSubagentRunBySessionKey: vi.fn((sessionKey: string) =>
      Array.from(runs.values()).find(run => run.sessionKey === sessionKey) ?? null,
    ),
    listSubagentRuns: vi.fn(() => Array.from(runs.values())),
    isMessagesPersisted: vi.fn(() => false),
  };
  const adapter = new OpenClawRuntimeAdapter(
    store as never,
    {},
    {},
    subagentRunStore as never,
  );
  const childSessionKey = 'agent:child-agent:subagent:e0fbd45e-25ef-4765-b1b1-a82035637f31';

  adapter.gatewayClient = {
    start: () => {},
    stop: () => {},
    request: async (method: string) => (
      method === 'sessions.messages.subscribe'
        ? { subscribed: true, key: childSessionKey }
        : { messages: [] }
    ),
  };

  adapter.subagentTracker.onToolStart(
    'call-worker',
    { agentId: 'child-agent', task: 'do child work' },
    parentSession.id,
  );
  adapter.subagentTracker.onSpawnResult(
    'call-worker',
    JSON.stringify({
      status: 'accepted',
      childSessionKey,
    }),
    {},
  );

  (adapter as unknown as {
    handleGatewayEvent: (event: unknown) => void;
  }).handleGatewayEvent({
    event: 'session.tool',
    payload: {
      runId: 'child-run',
      sessionKey: childSessionKey,
      data: {
        tag: 'tool_call_created',
        title: 'exec',
        toolCallId: 'exec_1',
        rawInput: { command: 'pwd' },
      },
    },
  });
  (adapter as unknown as {
    handleGatewayEvent: (event: unknown) => void;
  }).handleGatewayEvent({
    event: 'session.tool',
    payload: {
      runId: 'child-run',
      sessionKey: childSessionKey,
      data: {
        tag: 'tool_call_done',
        title: 'exec',
        toolCallId: 'exec_1',
        rawOutput: '/tmp\n',
      },
    },
  });

  const messages = await adapter.getSubTaskHistory(parentSession.id, 'call-worker', childSessionKey);
  expect(messages).toHaveLength(3);
  expect(messages[0]).toMatchObject({
    type: 'user',
    content: 'do child work',
  });
  expect(messages[1]).toMatchObject({
    type: 'tool_use',
    metadata: {
      toolName: 'exec',
      toolInput: { command: 'pwd' },
      toolUseId: 'exec_1',
    },
  });
  expect(messages[2]).toMatchObject({
    type: 'tool_result',
    content: '/tmp\n',
    metadata: {
      toolResult: '/tmp\n',
      toolUseId: 'exec_1',
      isError: false,
      isFinal: true,
    },
  });
});

test('unmapped subagent agent item events are cached for subtask history', async () => {
  const parentSession = {
    id: 'parent-session',
    agentId: 'child-agent',
    messages: [],
  };
  const runs = new Map<string, Record<string, unknown>>();
  const store = {
    getSession: vi.fn((sessionId: string) => (
      sessionId === parentSession.id ? parentSession : null
    )),
    getAgent: vi.fn(() => ({ name: 'Child Agent' })),
    updateSession: vi.fn(),
  };
  const subagentRunStore = {
    insertSubagentRun: vi.fn((run: Record<string, unknown>) => {
      runs.set(run.id as string, { ...run });
    }),
    updateSubagentRunStatus: vi.fn(),
    updateSubagentRunSessionKey: vi.fn(),
    updateSubagentRunChildSession: vi.fn(),
    getSubagentRun: vi.fn((id: string) => runs.get(id) ?? null),
    findSubagentRunBySessionKey: vi.fn((sessionKey: string) =>
      Array.from(runs.values()).find(run => run.sessionKey === sessionKey) ?? null,
    ),
    listSubagentRuns: vi.fn(() => Array.from(runs.values())),
    isMessagesPersisted: vi.fn(() => false),
  };
  const adapter = new OpenClawRuntimeAdapter(
    store as never,
    {},
    {},
    subagentRunStore as never,
  );
  const subagentId = 'e0fbd45e-25ef-4765-b1b1-a82035637f31';
  const childSessionKey = `agent:child-agent:subagent:${subagentId}`;

  adapter.gatewayClient = {
    start: () => {},
    stop: () => {},
    request: async (method: string) => (
      method === 'sessions.messages.subscribe'
        ? { subscribed: true, key: childSessionKey }
        : { messages: [] }
    ),
  };

  adapter.subagentTracker.onToolStart(
    'call-worker',
    { agentId: 'child-agent', task: 'do child work' },
    parentSession.id,
  );
  adapter.subagentTracker.onSpawnResult(
    'call-worker',
    JSON.stringify({
      status: 'accepted',
      childSessionKey,
    }),
    {},
  );

  (adapter as unknown as {
    handleGatewayEvent: (event: unknown) => void;
  }).handleGatewayEvent({
    event: 'agent',
    payload: {
      runId: 'child-run',
      sessionKey: `subagent:${subagentId}`,
      stream: 'item',
      data: {
        tag: 'tool_call_created',
        title: 'browser',
        toolCallId: 'browser_1',
        rawInput: { action: 'open', url: 'https://example.com' },
      },
    },
  });
  (adapter as unknown as {
    handleGatewayEvent: (event: unknown) => void;
  }).handleGatewayEvent({
    event: 'agent',
    payload: {
      runId: 'child-run',
      sessionKey: `subagent:${subagentId}`,
      stream: 'command_output',
      data: {
        tag: 'tool_call_done',
        title: 'browser',
        toolCallId: 'browser_1',
        rawOutput: 'Opened https://example.com',
      },
    },
  });

  const messages = await adapter.getSubTaskHistory(parentSession.id, 'call-worker', childSessionKey);
  expect(messages).toHaveLength(3);
  expect(messages[0]).toMatchObject({
    type: 'user',
    content: 'do child work',
  });
  expect(messages[1]).toMatchObject({
    type: 'tool_use',
    metadata: {
      toolName: 'browser',
      toolInput: { action: 'open', url: 'https://example.com' },
      toolUseId: 'browser_1',
    },
  });
  expect(messages[2]).toMatchObject({
    type: 'tool_result',
    content: 'Opened https://example.com',
    metadata: {
      toolResult: 'Opened https://example.com',
      toolUseId: 'browser_1',
      isFinal: true,
    },
  });
});

test('collectChannelHistoryEntries skips heartbeat prompt and ack messages', () => {
  const { store } = createHistoryStore([]);
  const adapter = new OpenClawRuntimeAdapter(store, {});

  const entries = adapter.collectChannelHistoryEntries([
    { role: 'user', content: 'regular user' },
    {
      role: 'user',
      content: `Read HEARTBEAT.md if it exists.
When reading HEARTBEAT.md, use workspace file /tmp/HEARTBEAT.md.
Do not infer or repeat old tasks from prior chats.
If nothing needs attention, reply HEARTBEAT_OK.`,
    },
    { role: 'assistant', content: 'HEARTBEAT_OK' },
    { role: 'assistant', content: 'NO_REPLY' },
    { role: 'assistant', content: 'regular assistant' },
  ]);

  expect(entries).toEqual([
    { role: 'user', text: 'regular user' },
    { role: 'assistant', text: 'regular assistant' },
  ]);
});

test('getSessionKeysForSession prefers channel keys before managed fallback', () => {
  const { store } = createHistoryStore([]);
  const adapter = new OpenClawRuntimeAdapter(store, {});

  adapter.rememberSessionKey('session-1', 'agent:main:openai-user:dingtalk-connector:__default__:2459325231940374');
  adapter.rememberSessionKey('session-1', 'agent:main:popiai:session-1');

  expect(adapter.getSessionKeysForSession('session-1')).toEqual([
    'agent:main:openai-user:dingtalk-connector:__default__:2459325231940374',
    'agent:main:popiai:session-1',
  ]);
});

test('onSessionDeleted deletes gateway transcripts for all session keys', async () => {
  const request = vi.fn(async () => ({}));
  const subagentRunStore = {
    listSubagentRuns: () => [],
    deleteSubagentRunsByParent: vi.fn(),
  };
  const adapter = new OpenClawRuntimeAdapter(
    { getSession: () => null } as never,
    {},
    {},
    subagentRunStore as never,
  );
  const channelSessionKey = 'agent:main:openclaw-weixin:bot-1:direct:user-1@im.wechat';
  const managedSessionKey = 'agent:main:popiai:session-1';

  adapter.gatewayClient = {
    start: () => {},
    stop: () => {},
    request,
  };
  adapter.channelSessionSync = {
    isChannelSessionKey: (key: string) => key === channelSessionKey,
    onSessionDeleted: vi.fn(),
  } as never;
  adapter.sessionIdBySessionKey.set(channelSessionKey, 'session-1');
  adapter.sessionIdBySessionKey.set(managedSessionKey, 'session-1');

  adapter.onSessionDeleted('session-1');

  await vi.waitFor(() => {
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenCalledWith(
      'sessions.delete',
      { key: channelSessionKey, deleteTranscript: true },
      { timeoutMs: 5_000 },
    );
    expect(request).toHaveBeenCalledWith(
      'sessions.delete',
      { key: managedSessionKey, deleteTranscript: true },
      { timeoutMs: 5_000 },
    );
  });
  expect(adapter.deletedChannelKeys.has(channelSessionKey)).toBe(false);
  expect(adapter.deletedChannelKeys.has(managedSessionKey)).toBe(false);
});
