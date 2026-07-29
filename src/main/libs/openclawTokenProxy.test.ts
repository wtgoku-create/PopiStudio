import { PassThrough } from 'node:stream';

import { net } from 'electron';
import http from 'http';
import { expect, test, vi } from 'vitest';

vi.mock('electron', () => ({
  net: { fetch: vi.fn() },
}));

import { __openClawTokenProxyTestUtils } from './openclawTokenProxy';

const testUtils = __openClawTokenProxyTestUtils;

type MockProxyResponse = {
  write: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  destroyed: boolean;
};

function createMockProxyResponse(): MockProxyResponse {
  const res: MockProxyResponse = {
    write: vi.fn(),
    end: vi.fn(),
    destroy: vi.fn(() => {
      res.destroyed = true;
    }),
    destroyed: false,
  };
  return res;
}

function asServerResponse(res: MockProxyResponse): http.ServerResponse {
  return res as unknown as http.ServerResponse;
}

function flushStreamEvents(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function createDiagnostics() {
  return {
    method: 'POST',
    upstreamPath: '/api_client/anime/task/llmChat',
    startedAt: Date.now(),
    headersAt: Date.now(),
  };
}

test('retries transient HTTP/2 ping failures before returning upstream response', async () => {
  vi.useFakeTimers();
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  try {
    const fetchMock = vi.mocked(net.fetch);
    fetchMock.mockReset();
    fetchMock
      .mockRejectedValueOnce(new Error('net::ERR_HTTP2_PING_FAILED'))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }) as Awaited<ReturnType<typeof net.fetch>>);

    const responsePromise = testUtils.fetchUpstreamWithRetry(
      'https://example.invalid/api',
      { method: 'POST' },
      { method: 'POST', upstreamPath: '/api_client/anime/task/llmChat' },
    );

    await vi.advanceTimersByTimeAsync(250);
    const response = await responsePromise;

    expect(response?.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(warnSpy).not.toHaveBeenCalled();
  } finally {
    warnSpy.mockRestore();
    vi.useRealTimers();
  }
});

test('does not retry non-transient upstream fetch failures', async () => {
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  try {
    const fetchMock = vi.mocked(net.fetch);
    fetchMock.mockReset();
    fetchMock.mockRejectedValueOnce(new Error('certificate rejected'));

    const response = await testUtils.fetchUpstreamWithRetry(
      'https://example.invalid/api',
      { method: 'POST' },
      { method: 'POST', upstreamPath: '/api_client/anime/task/llmChat' },
    );

    expect(response).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  } finally {
    warnSpy.mockRestore();
  }
});

test('classifies SSE packets as terminal only on done, finish reason, error, or message stop', () => {
  const terminalPackets = [
    'data: [DONE]',
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
    'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
    'event: error\ndata: {"message":"quota exhausted"}',
    'data: {"type":"error","error":{"message":"boom"}}',
    'event: message_stop\ndata: {"type":"message_stop"}',
  ];

  for (const packet of terminalPackets) {
    expect(testUtils.isTerminalProxySSEPacket(testUtils.parseProxySSEPacket(packet))).toBe(true);
  }

  const nonTerminalPackets = [
    'data: {"choices":[{"delta":{"content":"hi"},"finish_reason":null}]}',
    'data: {"choices":[{"delta":{"content":"hi"}}]}',
    ': keep-alive comment',
    'data: not-json',
    '',
  ];

  for (const packet of nonTerminalPackets) {
    expect(testUtils.isTerminalProxySSEPacket(testUtils.parseProxySSEPacket(packet))).toBe(false);
  }
});

test('injects reasoning options into llmChat request bodies', () => {
  const body = Buffer.from(JSON.stringify({
    model: 'MiniMax-M3',
    stream: true,
    messages: [],
  }));

  const transformed = testUtils.injectReasoningOptions('/api_client/anime/task/llmChat', body);
  const payload = JSON.parse(transformed.toString('utf8'));

  expect(payload.reasoning_split).toBe(true);
  expect(payload.thinking).toEqual({ type: 'adaptive' });
  expect(payload.model).toBe('MiniMax-M3');
});

test('does not override existing reasoning request values', () => {
  const body = Buffer.from(JSON.stringify({
    model: 'MiniMax-M3',
    reasoning_split: false,
    thinking: { type: 'disabled' },
    messages: [],
  }));

  const transformed = testUtils.injectReasoningOptions('/api_client/anime/task/llmChat', body);
  const payload = JSON.parse(transformed.toString('utf8'));

  expect(payload.reasoning_split).toBe(false);
  expect(payload.thinking).toEqual({ type: 'disabled' });
});

test('does not inject reasoning options into non-MiniMax llmChat request bodies', () => {
  const body = Buffer.from(JSON.stringify({
    model: 'doubao-seed-2-0-lite-260428',
    stream: true,
    messages: [],
  }));

  const transformed = testUtils.injectReasoningOptions('/api_client/anime/task/llmChat', body);
  const payload = JSON.parse(transformed.toString('utf8'));

  expect(payload.reasoning_split).toBeUndefined();
  expect(payload.thinking).toBeUndefined();
});

test('does not inject reasoning options outside llmChat request bodies', () => {
  const body = Buffer.from(JSON.stringify({
    model: 'MiniMax-M3',
    stream: true,
    messages: [],
  }));

  const transformed = testUtils.injectReasoningOptions('/api/proxy/example', body);
  const payload = JSON.parse(transformed.toString('utf8'));

  expect(payload.reasoning_split).toBeUndefined();
  expect(payload.thinking).toBeUndefined();
});

test('scan state observes a terminal packet split across chunk boundaries', () => {
  const scanState = testUtils.createProxySSEStreamScanState();

  let buffer = testUtils.scanProxySSEBuffer(
    'data: {"choices":[{"delta":{"content":"hi"},"finish_reason":null}]}\n\ndata: [DO',
    scanState,
  );
  expect(scanState.sawTerminalPacket).toBe(false);

  buffer = testUtils.scanProxySSEBuffer(`${buffer}NE]\n\n`, scanState);
  expect(buffer).toBe('');
  expect(scanState.sawTerminalPacket).toBe(true);
});

test('flush detects a terminal packet in a trailing partial SSE frame', () => {
  const scanState = testUtils.createProxySSEStreamScanState();
  testUtils.flushProxySSEBuffer('data: [DONE]', scanState);
  expect(scanState.sawTerminalPacket).toBe(true);
});

test('node stream ends proxied response when upstream SSE completes', async () => {
  const upstream = new PassThrough();
  const res = createMockProxyResponse();

  testUtils.pipeNodeReadableResponse(
    upstream,
    asServerResponse(res),
    createDiagnostics(),
    testUtils.createProxySSEStreamScanState(),
  );
  upstream.write('data: {"choices":[{"delta":{"content":"hi"},"finish_reason":null}]}\n\n');
  upstream.write('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n');
  upstream.end();
  await flushStreamEvents();

  expect(res.end).toHaveBeenCalledTimes(1);
  expect(res.destroy).not.toHaveBeenCalled();
});

test('node stream aborts proxied response when upstream SSE ends without terminal packet', async () => {
  const upstream = new PassThrough();
  const res = createMockProxyResponse();

  testUtils.pipeNodeReadableResponse(
    upstream,
    asServerResponse(res),
    createDiagnostics(),
    testUtils.createProxySSEStreamScanState(),
  );
  upstream.write('data: {"choices":[{"delta":{"content":"partial plan"},"finish_reason":null}]}\n\n');
  upstream.end();
  await flushStreamEvents();

  expect(res.destroy).toHaveBeenCalledTimes(1);
  expect(res.end).not.toHaveBeenCalled();
});

test('node stream aborts proxied response on upstream read error', async () => {
  const upstream = new PassThrough();
  const res = createMockProxyResponse();

  testUtils.pipeNodeReadableResponse(
    upstream,
    asServerResponse(res),
    createDiagnostics(),
    testUtils.createProxySSEStreamScanState(),
  );
  upstream.write('data: {"choices":[{"delta":{"content":"hi"},"finish_reason":null}]}\n\n');
  await flushStreamEvents();
  upstream.destroy(new Error('net::ERR_CONNECTION_RESET'));
  await flushStreamEvents();

  expect(res.destroy).toHaveBeenCalledTimes(1);
  expect(res.end).not.toHaveBeenCalled();
});

test('web stream aborts proxied response when upstream SSE closes without terminal packet', async () => {
  const res = createMockProxyResponse();
  const webStream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(
        'data: {"choices":[{"delta":{"content":"hi"},"finish_reason":null}]}\n\n',
      ));
      controller.close();
    },
  });

  testUtils.pipeWebReadableResponse(
    webStream,
    asServerResponse(res),
    createDiagnostics(),
    testUtils.createProxySSEStreamScanState(),
  );

  await vi.waitFor(() => {
    expect(res.destroy).toHaveBeenCalledTimes(1);
  });
  expect(res.end).not.toHaveBeenCalled();
});

test('web stream aborts proxied response on upstream read failure', async () => {
  const res = createMockProxyResponse();
  const webStream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n'));
      controller.error(new Error('net::ERR_CONNECTION_RESET'));
    },
  });

  testUtils.pipeWebReadableResponse(
    webStream,
    asServerResponse(res),
    createDiagnostics(),
    testUtils.createProxySSEStreamScanState(),
  );

  await vi.waitFor(() => {
    expect(res.destroy).toHaveBeenCalledTimes(1);
  });
  expect(res.end).not.toHaveBeenCalled();
});

test('web stream skips completion scan when no scan state is provided', async () => {
  const res = createMockProxyResponse();
  const webStream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"object":"chat.completion","choices":[]}'));
      controller.close();
    },
  });

  testUtils.pipeWebReadableResponse(webStream, asServerResponse(res), createDiagnostics());

  await vi.waitFor(() => {
    expect(res.end).toHaveBeenCalledTimes(1);
  });
  expect(res.destroy).not.toHaveBeenCalled();
});
