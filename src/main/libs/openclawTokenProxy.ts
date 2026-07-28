import { net } from 'electron';
import http from 'http';

import { getKnowledgeDefaultBaseUrl } from './endpoints';

const PROXY_BIND_HOST = '127.0.0.1';
const WEKNORA_OPENCLAW_MCP_PROXY_PATH = '/mcp/weknora-openclaw';
const WEKNORA_OPENCLAW_MCP_RETRY_DELAYS_MS = [250, 750, 1500];
const POPIAI_LLM_CHAT_PATH = '/api_client/anime/task/llmChat';

let proxyServer: http.Server | null = null;
let proxyPort: number | null = null;

// Injected dependencies
type AuthTokens = {
  accessToken: string;
  refreshToken: string;
  knowledgeToken?: string;
};

let tokenGetter: (() => AuthTokens | null) | null = null;
let tokenRefresher: ((reason: string) => Promise<string | null>) | null = null;
let serverBaseUrlGetter: (() => string) | null = null;

export type OpenClawTokenProxyConfig = {
  getAuthTokens: () => AuthTokens | null;
  refreshToken: (reason: string) => Promise<string | null>;
  getServerBaseUrl: () => string;
};

export function startOpenClawTokenProxy(config: OpenClawTokenProxyConfig): Promise<{ port: number }> {
  tokenGetter = config.getAuthTokens;
  tokenRefresher = config.refreshToken;
  serverBaseUrlGetter = config.getServerBaseUrl;

  return new Promise((resolve, reject) => {
    if (proxyServer) {
      if (proxyPort) {
        resolve({ port: proxyPort });
        return;
      }
      reject(new Error('Token proxy is starting'));
      return;
    }

    const server = http.createServer(handleRequest);

    server.listen(0, PROXY_BIND_HOST, () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        proxyPort = addr.port;
        proxyServer = server;
        console.log(`[OpenClawTokenProxy] started on ${PROXY_BIND_HOST}:${proxyPort}`);
        resolve({ port: proxyPort });
      } else {
        server.close();
        reject(new Error('Failed to bind token proxy'));
      }
    });

    server.on('error', (err) => {
      console.error('[OpenClawTokenProxy] server error:', err);
      reject(err);
    });
  });
}

export function stopOpenClawTokenProxy(): void {
  if (proxyServer) {
    proxyServer.close();
    proxyServer = null;
    proxyPort = null;
    console.log('[OpenClawTokenProxy] stopped');
  }
}

export function getOpenClawTokenProxyPort(): number | null {
  return proxyPort;
}

export function getWeknoraOpenClawMcpProxyUrl(): string | null {
  return proxyPort ? `http://${PROXY_BIND_HOST}:${proxyPort}${WEKNORA_OPENCLAW_MCP_PROXY_PATH}` : null;
}

function collectRequestBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function logLlmChatRequestSummary(upstreamPath: string, body: Buffer): void {
  if (upstreamPath !== POPIAI_LLM_CHAT_PATH || body.length === 0) {
    return;
  }

  try {
    const payload = JSON.parse(body.toString('utf8')) as Record<string, unknown>;
    const messages = Array.isArray(payload.messages) ? payload.messages : [];
    const tools = Array.isArray(payload.tools) ? payload.tools : [];
    const streamOptions = payload.stream_options && typeof payload.stream_options === 'object'
      ? Object.keys(payload.stream_options as Record<string, unknown>)
      : [];

    console.debug(
      `[OpenClawTokenProxy] llmChat request summary model=${String(payload.model ?? 'unknown')} `
      + `stream=${String(payload.stream)} messages=${messages.length} tools=${tools.length} `
      + `streamOptions=${streamOptions.join(',') || 'none'} `
      + `reasoningSplit=${String(payload.reasoning_split)} `
      + `thinking=${isRecord(payload.thinking) ? String(payload.thinking.type ?? 'present') : 'none'} `
      + `bodyBytes=${body.byteLength}`,
    );
  } catch {
    console.debug(`[OpenClawTokenProxy] llmChat request body is not JSON bytes=${body.byteLength}`);
  }
}

function injectReasoningOptions(upstreamPath: string, body: Buffer): Buffer {
  if (upstreamPath !== POPIAI_LLM_CHAT_PATH || body.length === 0) {
    return body;
  }

  try {
    const payload = JSON.parse(body.toString('utf8')) as Record<string, unknown>;
    const model = typeof payload.model === 'string' ? payload.model : '';
    if (!model.toLowerCase().includes('minimax')) {
      return body;
    }

    let changed = false;
    if (payload.reasoning_split === undefined) {
      payload.reasoning_split = true;
      changed = true;
    }
    if (payload.thinking === undefined) {
      payload.thinking = { type: 'adaptive' };
      changed = true;
    }
    if (!changed) {
      return body;
    }

    console.debug('[OpenClawTokenProxy] ensured llmChat reasoning options on request body');
    return Buffer.from(JSON.stringify(payload));
  } catch {
    return body;
  }
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const tokens = tokenGetter?.();
    const serverBaseUrl = serverBaseUrlGetter?.();

    if (req.url?.startsWith(WEKNORA_OPENCLAW_MCP_PROXY_PATH)) {
      await handleWeknoraOpenClawMcpRequest(req, res, tokens?.knowledgeToken ?? null);
      return;
    }

    if (!tokens?.accessToken || !serverBaseUrl) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No auth tokens available' }));
      return;
    }

    const body = await collectRequestBody(req);

    const upstreamPath = resolveUpstreamPath(req.url || '/');
    const forwardBody = injectReasoningOptions(upstreamPath, body);
    const upstreamUrl = `${serverBaseUrl}${upstreamPath}`;
    console.debug(`[OpenClawTokenProxy] forwarding request to ${upstreamUrl}`);
    logLlmChatRequestSummary(upstreamPath, forwardBody);

    const result = await forwardRequest(upstreamUrl, upstreamPath, req.method || 'POST', tokens.accessToken, forwardBody, req.headers);
    console.debug(`[OpenClawTokenProxy] upstream responded with status ${result.status}`);

    if ((result.status === 401 || result.status === 403) && !result.skipAuthRefresh && tokenRefresher) {
      console.log(`[OpenClawTokenProxy] received ${result.status}, attempting token refresh`);
      const newToken = await tokenRefresher('openclaw-proxy');
      if (newToken) {
        const retryResult = await forwardRequest(upstreamUrl, upstreamPath, req.method || 'POST', newToken, forwardBody, req.headers);
        console.debug(`[OpenClawTokenProxy] upstream retry responded with status ${retryResult.status}`);
        pipeResponse(retryResult, res);
        return;
      }
    }

    pipeResponse(result, res);
  } catch (err) {
    console.error('[OpenClawTokenProxy] request handling error:', err);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Token proxy upstream error' }));
    }
  }
}

function resolveUpstreamPath(requestUrl: string): string {
  const path = requestUrl.split('?')[0] || '/';
  if (path === '/v1/chat/completions' || path === '/chat/completions') {
    return POPIAI_LLM_CHAT_PATH;
  }
  return `/api/proxy${requestUrl}`;
}

async function handleWeknoraOpenClawMcpRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  accessToken: string | null,
): Promise<void> {
  if (!accessToken) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Login required' }));
    return;
  }

  const body = await collectRequestBody(req);
  const result = await forwardWeknoraOpenClawMcpRequest(
    req.method || 'POST',
    accessToken,
    body,
    req.headers,
  );

  if ((result.status === 401 || result.status === 403) && tokenRefresher) {
    console.log(`[OpenClawTokenProxy] Weknora MCP received ${result.status}, attempting token refresh`);
    await tokenRefresher('weknora-openclaw-mcp');
    const newToken = tokenGetter?.()?.knowledgeToken ?? null;
    if (newToken) {
      const retryResult = await forwardWeknoraOpenClawMcpRequest(
        req.method || 'POST',
        newToken,
        body,
        req.headers,
      );
      pipeResponse(retryResult, res);
      return;
    }
  }

  pipeResponse(result, res);
}

type UpstreamResult = {
  status: number;
  headers: Record<string, string>;
  body: NodeJS.ReadableStream | ReadableStream<Uint8Array> | Buffer;
  isStream: boolean;
  diagnostics: UpstreamDiagnostics;
  skipAuthRefresh?: boolean;
};

type UpstreamDiagnostics = {
  method: string;
  upstreamPath: string;
  startedAt: number;
  headersAt: number;
};

type ParsedProxySSEPacket = {
  event: string;
  payload: string;
};

type ProxySSEStreamScanState = {
  sawTerminalPacket: boolean;
  contentChunks: number;
  reasoningFields: Record<string, number>;
  thinkTagContentChunks: number;
  logRawPackets: boolean;
  loggedRawPackets: number;
};

function createProxySSEStreamScanState(options?: { logRawPackets?: boolean }): ProxySSEStreamScanState {
  return {
    sawTerminalPacket: false,
    contentChunks: 0,
    reasoningFields: {},
    thinkTagContentChunks: 0,
    logRawPackets: options?.logRawPackets === true,
    loggedRawPackets: 0,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function parseProxySSEPacket(packet: string): ParsedProxySSEPacket {
  const lines = packet.split(/\r?\n/);
  const dataLines: string[] = [];
  let event = '';

  for (const line of lines) {
    if (line.startsWith('event:')) {
      event = line.slice(6).trimStart();
      continue;
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  return {
    event,
    payload: dataLines.join('\n'),
  };
}

function isTerminalProxySSEPacket(packet: ParsedProxySSEPacket): boolean {
  const { event, payload } = packet;
  if (!payload) return false;
  if (payload === '[DONE]') return true;
  if (event === 'error' || event === 'message_stop') return true;

  const parsed = tryParseJson(payload);
  if (!isRecord(parsed)) return false;
  if (parsed.type === 'error' || parsed.error != null || parsed.type === 'message_stop') {
    return true;
  }
  for (const choice of toArray(parsed.choices)) {
    if (isRecord(choice) && choice.finish_reason != null && choice.finish_reason !== '') {
      return true;
    }
  }
  return false;
}

function findSSEPacketBoundary(buffer: string): { index: number; separatorLength: number } | null {
  const match = /\r?\n\r?\n/.exec(buffer);
  if (!match || typeof match.index !== 'number') return null;
  return {
    index: match.index,
    separatorLength: match[0].length,
  };
}

function truncateForDebug(value: string, maxChars = 1200): string {
  return value.length > maxChars ? `${value.slice(0, maxChars)}...` : value;
}

function logProxySSEPacketForDebug(packet: ParsedProxySSEPacket, parsed: unknown, scanState: ProxySSEStreamScanState): void {
  if (!scanState.logRawPackets || scanState.loggedRawPackets >= 30) {
    return;
  }
  scanState.loggedRawPackets += 1;

  console.debug(
    `[OpenClawTokenProxy] llmChat upstream SSE data #${scanState.loggedRawPackets}: `
    + truncateForDebug(packet.payload),
  );

  if (!isRecord(parsed)) {
    return;
  }

  for (const choice of toArray(parsed.choices)) {
    if (!isRecord(choice) || !isRecord(choice.delta)) continue;
    const delta = choice.delta;
    const preview: Record<string, unknown> = {
      deltaKeys: Object.keys(delta),
    };
    for (const field of ['reasoning_content', 'reasoning', 'reasoning_text', 'thoughts', 'thinking', 'content'] as const) {
      if (typeof delta[field] === 'string' && delta[field]) {
        preview[field] = truncateForDebug(delta[field], 240);
      }
    }
    if (choice.finish_reason != null) {
      preview.finishReason = choice.finish_reason;
    }
    console.debug(`[OpenClawTokenProxy] llmChat upstream SSE delta #${scanState.loggedRawPackets}: ${JSON.stringify(preview)}`);
  }
}

function inspectProxySSEPacket(packet: string, scanState?: ProxySSEStreamScanState): void {
  if (!scanState) return;

  const parsedPacket = parseProxySSEPacket(packet);
  if (!scanState.sawTerminalPacket && isTerminalProxySSEPacket(parsedPacket)) {
    scanState.sawTerminalPacket = true;
  }

  const parsed = tryParseJson(parsedPacket.payload);
  logProxySSEPacketForDebug(parsedPacket, parsed, scanState);
  if (!isRecord(parsed)) return;
  for (const choice of toArray(parsed.choices)) {
    if (!isRecord(choice) || !isRecord(choice.delta)) continue;
    const delta = choice.delta;
    const content = typeof delta.content === 'string' ? delta.content : '';
    if (content) {
      scanState.contentChunks += 1;
      if (content.includes('<think>') || content.includes('</think>')) {
        scanState.thinkTagContentChunks += 1;
      }
    }
    for (const field of ['reasoning_content', 'reasoning', 'reasoning_text', 'thoughts', 'thinking'] as const) {
      if (typeof delta[field] === 'string' && delta[field]) {
        scanState.reasoningFields[field] = (scanState.reasoningFields[field] ?? 0) + 1;
      }
    }
  }
}

function scanProxySSEBuffer(
  buffer: string,
  scanState?: ProxySSEStreamScanState,
): string {
  let remaining = buffer;
  let boundary = findSSEPacketBoundary(remaining);

  while (boundary) {
    const packet = remaining.slice(0, boundary.index);
    remaining = remaining.slice(boundary.index + boundary.separatorLength);
    inspectProxySSEPacket(packet, scanState);
    boundary = findSSEPacketBoundary(remaining);
  }

  return remaining;
}

function flushProxySSEBuffer(buffer: string, scanState?: ProxySSEStreamScanState): void {
  const remaining = scanProxySSEBuffer(buffer, scanState);
  if (!remaining.trim()) return;
  inspectProxySSEPacket(remaining, scanState);
}

function normalizeLlmChatBusinessError(responseText: string): UpstreamResult | null {
  const payload = tryParseJson(responseText);
  if (!isRecord(payload) || payload.status !== '5000' || typeof payload.message !== 'string') {
    return null;
  }

  const match = payload.message.match(/body=(\{[\s\S]*\})$/);
  const upstreamPayload = match ? tryParseJson(match[1]) : null;
  const upstreamError = isRecord(upstreamPayload) && isRecord(upstreamPayload.error)
    ? upstreamPayload.error
    : null;

  const message = typeof upstreamError?.user_message === 'string'
    ? upstreamError.user_message
    : typeof upstreamError?.message === 'string'
      ? upstreamError.message
      : payload.message;
  const status = typeof upstreamError?.http_status === 'number'
    ? upstreamError.http_status
    : 502;
  const type = typeof upstreamError?.type === 'string'
    ? upstreamError.type
    : 'upstream_error';
  const code = typeof upstreamError?.normalized_code === 'string'
    ? upstreamError.normalized_code
    : typeof upstreamError?.code === 'string'
      ? upstreamError.code
      : null;

  return {
    status,
    headers: { 'Content-Type': 'application/json' },
    body: Buffer.from(JSON.stringify({
      error: {
        message,
        type,
        code,
        upstream: upstreamError ?? payload,
      },
    })),
    isStream: false,
    diagnostics: {
      method: 'POST',
      upstreamPath: POPIAI_LLM_CHAT_PATH,
      startedAt: Date.now(),
      headersAt: Date.now(),
    },
    skipAuthRefresh: true,
  };
}

async function forwardRequest(
  url: string,
  upstreamPath: string,
  method: string,
  accessToken: string,
  body: Buffer,
  incomingHeaders: http.IncomingHttpHeaders,
): Promise<UpstreamResult> {
  const startedAt = Date.now();
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': incomingHeaders['content-type'] || 'application/json',
  };

  // Forward accept header for SSE streaming
  if (incomingHeaders.accept) {
    headers['Accept'] = incomingHeaders.accept;
  }

  const resp = await net.fetch(url, {
    method,
    headers,
    body: body.length > 0 ? new Uint8Array(body) : undefined,
  });
  const headersAt = Date.now();

  const contentType = resp.headers.get('content-type') || '';
  const isStream = contentType.includes('text/event-stream');
  console.debug(
    `[OpenClawTokenProxy] upstream headers received in ${headersAt - startedAt}ms `
    + `for ${method} ${upstreamPath} status=${resp.status} contentType=${contentType || 'unknown'}`,
  );

  const responseHeaders: Record<string, string> = {};
  resp.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });

  if (isStream && resp.body) {
    return {
      status: resp.status,
      headers: responseHeaders,
      body: resp.body,
      isStream: true,
      diagnostics: { method, upstreamPath, startedAt, headersAt },
    };
  }

  const respBuffer = Buffer.from(await resp.arrayBuffer());
  const responseText = respBuffer.toString('utf8');
  console.debug(
    `[OpenClawTokenProxy] upstream non-stream body received in ${Date.now() - startedAt}ms `
    + `for ${method} ${upstreamPath} bytes=${respBuffer.byteLength}`,
  );
  const normalizedBusinessError = normalizeLlmChatBusinessError(responseText);
  if (normalizedBusinessError) {
    return {
      ...normalizedBusinessError,
      diagnostics: { method, upstreamPath, startedAt, headersAt },
    };
  }
  return {
    status: resp.status,
    headers: responseHeaders,
    body: respBuffer,
    isStream: false,
    diagnostics: { method, upstreamPath, startedAt, headersAt },
  };
}

async function forwardWeknoraOpenClawMcpRequest(
  method: string,
  accessToken: string,
  body: Buffer,
  incomingHeaders: http.IncomingHttpHeaders,
): Promise<UpstreamResult> {
  const startedAt = Date.now();
  const upstreamPath = '/mcp';
  const headers: Record<string, string> = {
    'X-API-Key': accessToken,
    'Content-Type': headerValueToString(incomingHeaders['content-type']) || 'application/json',
  };

  copyHeader(incomingHeaders, headers, 'accept', 'Accept');
  copyHeader(incomingHeaders, headers, 'mcp-session-id', 'Mcp-Session-Id');
  copyHeader(incomingHeaders, headers, 'mcp-protocol-version', 'Mcp-Protocol-Version');
  copyHeader(incomingHeaders, headers, 'last-event-id', 'Last-Event-ID');


  console.debug('[OpenClawTokenProxy] forwardWeknoraOpenClawMcpRequest:', `${getKnowledgeDefaultBaseUrl()}/mcp`);
  const resp = await net.fetch(`${getKnowledgeDefaultBaseUrl()}/mcp`, {
    method,
    headers,
    body: body.length > 0 ? new Uint8Array(body) : undefined,
  }).catch(async (error) => {
    for (const delayMs of WEKNORA_OPENCLAW_MCP_RETRY_DELAYS_MS) {
      await delay(delayMs);
      try {
        return await net.fetch(`${getKnowledgeDefaultBaseUrl()}/mcp`, {
          method,
          headers,
          body: body.length > 0 ? new Uint8Array(body) : undefined,
        });
      } catch {
        // Retry with the next delay, then return a structured 503 below.
      }
    }
    console.warn('[OpenClawTokenProxy] Weknora MCP upstream is unavailable:', error);
    return null;
  });

  if (!resp) {
    return {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
      body: Buffer.from(JSON.stringify({
        error: 'Weknora MCP upstream unavailable',
        upstream: `${getKnowledgeDefaultBaseUrl()}/mcp`,
      })),
      isStream: false,
      diagnostics: { method, upstreamPath, startedAt, headersAt: Date.now() },
    };
  }

  const contentType = resp.headers.get('content-type') || '';
  const isStream = contentType.includes('text/event-stream');

  const responseHeaders: Record<string, string> = {};
  resp.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });

  if (isStream && resp.body) {
    return {
      status: resp.status,
      headers: responseHeaders,
      body: resp.body,
      isStream: true,
      diagnostics: { method, upstreamPath, startedAt, headersAt: Date.now() },
    };
  }

  const respBuffer = Buffer.from(await resp.arrayBuffer());
  return {
    status: resp.status,
    headers: responseHeaders,
    body: respBuffer,
    isStream: false,
    diagnostics: { method, upstreamPath, startedAt, headersAt: Date.now() },
  };
}

function headerValueToString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function copyHeader(
  source: http.IncomingHttpHeaders,
  target: Record<string, string>,
  sourceKey: string,
  targetKey: string,
): void {
  const value = headerValueToString(source[sourceKey]);
  if (value) target[targetKey] = value;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const RESPONSE_HEADERS_TO_DROP = new Set([
  'connection',
  'content-length',
  'content-encoding',
  'transfer-encoding',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'upgrade',
]);

function buildResponseHeaders(result: UpstreamResult): Record<string, string> {
  const headers: Record<string, string> = {};

  for (const [key, value] of Object.entries(result.headers)) {
    const normalizedKey = key.toLowerCase();
    if (RESPONSE_HEADERS_TO_DROP.has(normalizedKey)) {
      continue;
    }
    if (result.isStream && (normalizedKey === 'content-type' || normalizedKey === 'cache-control')) {
      continue;
    }
    headers[key] = value;
  }

  if (!result.isStream) {
    return headers;
  }

  return {
    ...headers,
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  };
}

function pipeResponse(result: UpstreamResult, res: http.ServerResponse): void {
  res.writeHead(result.status, buildResponseHeaders(result));
  const scanState = result.isStream
    ? createProxySSEStreamScanState({ logRawPackets: result.diagnostics.upstreamPath === POPIAI_LLM_CHAT_PATH })
    : undefined;

  if (result.isStream && 'pipe' in result.body && typeof (result.body as NodeJS.ReadableStream).pipe === 'function') {
    pipeNodeReadableResponse(result.body as NodeJS.ReadableStream, res, result.diagnostics, scanState);
  } else if (Buffer.isBuffer(result.body)) {
    console.debug(
      `[OpenClawTokenProxy] completed non-stream response in ${Date.now() - result.diagnostics.startedAt}ms `
      + `for ${result.diagnostics.method} ${result.diagnostics.upstreamPath} bytes=${result.body.byteLength}`,
    );
    res.end(result.body);
  } else {
    // Web ReadableStream from net.fetch — need to consume manually
    pipeWebReadableResponse(result.body as unknown as ReadableStream<Uint8Array>, res, result.diagnostics, scanState);
  }
}

function abortProxyResponse(res: http.ServerResponse): void {
  if (!res.destroyed) {
    res.destroy();
  }
}

function endProxyResponseAfterScan(
  res: http.ServerResponse,
  diagnostics: UpstreamDiagnostics,
  scanState?: ProxySSEStreamScanState,
): void {
  if (scanState && diagnostics.upstreamPath === POPIAI_LLM_CHAT_PATH) {
    const reasoningSummary = Object.entries(scanState.reasoningFields)
      .map(([field, count]) => `${field}:${count}`)
      .join(',') || 'none';
    console.debug(
      `[OpenClawTokenProxy] llmChat stream scan summary reasoningFields=${reasoningSummary} `
      + `contentChunks=${scanState.contentChunks} thinkTagContentChunks=${scanState.thinkTagContentChunks}`,
    );
  }
  if (scanState && !scanState.sawTerminalPacket) {
    console.error(
      `[OpenClawTokenProxy] upstream SSE stream ended without a terminal packet for `
      + `${diagnostics.method} ${diagnostics.upstreamPath}`,
    );
    abortProxyResponse(res);
    return;
  }
  res.end();
}

function pipeNodeReadableResponse(
  stream: NodeJS.ReadableStream,
  res: http.ServerResponse,
  diagnostics: UpstreamDiagnostics,
  scanState?: ProxySSEStreamScanState,
): void {
  let chunkCount = 0;
  let byteCount = 0;
  const decoder = new TextDecoder();
  let sseBuffer = '';

  stream.on('data', (chunk: Buffer | Uint8Array | string) => {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    chunkCount += 1;
    byteCount += buffer.byteLength;
    if (scanState) {
      sseBuffer = scanProxySSEBuffer(sseBuffer + decoder.decode(buffer, { stream: true }), scanState);
    }
    if (chunkCount === 1) {
      console.debug(
        `[OpenClawTokenProxy] first upstream body chunk received in ${Date.now() - diagnostics.startedAt}ms `
        + `for ${diagnostics.method} ${diagnostics.upstreamPath} bytes=${buffer.byteLength}`,
      );
    }
    res.write(buffer);
  });

  stream.on('end', () => {
    if (scanState) {
      const remainder = decoder.decode();
      flushProxySSEBuffer(sseBuffer + remainder, scanState);
    }
    console.debug(
      `[OpenClawTokenProxy] completed streaming response in ${Date.now() - diagnostics.startedAt}ms `
      + `for ${diagnostics.method} ${diagnostics.upstreamPath} chunks=${chunkCount} bytes=${byteCount}`,
    );
    endProxyResponseAfterScan(res, diagnostics, scanState);
  });

  stream.on('error', (err) => {
    console.error('[OpenClawTokenProxy] stream read error:', err);
    abortProxyResponse(res);
  });
}

function pipeWebReadableResponse(
  webStream: ReadableStream<Uint8Array>,
  res: http.ServerResponse,
  diagnostics: UpstreamDiagnostics,
  scanState?: ProxySSEStreamScanState,
): void {
  const reader = webStream.getReader();
  let chunkCount = 0;
  let byteCount = 0;
  const decoder = new TextDecoder();
  let sseBuffer = '';

  const pump = (): void => {
    reader.read().then(({ done, value }) => {
      if (done) {
        if (scanState) {
          const remainder = decoder.decode();
          flushProxySSEBuffer(sseBuffer + remainder, scanState);
        }
        console.debug(
          `[OpenClawTokenProxy] completed streaming response in ${Date.now() - diagnostics.startedAt}ms `
          + `for ${diagnostics.method} ${diagnostics.upstreamPath} chunks=${chunkCount} bytes=${byteCount}`,
        );
        endProxyResponseAfterScan(res, diagnostics, scanState);
        return;
      }
      chunkCount += 1;
      byteCount += value.byteLength;
      if (scanState) {
        sseBuffer = scanProxySSEBuffer(sseBuffer + decoder.decode(value, { stream: true }), scanState);
      }
      if (chunkCount === 1) {
        console.debug(
          `[OpenClawTokenProxy] first upstream body chunk received in ${Date.now() - diagnostics.startedAt}ms `
          + `for ${diagnostics.method} ${diagnostics.upstreamPath} bytes=${value.byteLength}`,
        );
      }
      res.write(value);
      pump();
    }).catch((err) => {
      console.error('[OpenClawTokenProxy] stream read error:', err);
      abortProxyResponse(res);
    });
  };
  pump();
}

export const __openClawTokenProxyTestUtils = {
  createProxySSEStreamScanState,
  flushProxySSEBuffer,
  injectReasoningOptions,
  isTerminalProxySSEPacket,
  parseProxySSEPacket,
  pipeNodeReadableResponse,
  pipeWebReadableResponse,
  scanProxySSEBuffer,
};
