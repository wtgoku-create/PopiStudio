import http from 'http';
import { net } from 'electron';

const PROXY_BIND_HOST = '127.0.0.1';
const WEKNORA_OPENCLAW_MCP_PROXY_PATH = '/mcp/weknora-openclaw';
const WEKNORA_OPENCLAW_MCP_UPSTREAM_URL = 'https://weknora.popi.art/mcp';
const WEKNORA_OPENCLAW_MCP_RETRY_DELAYS_MS = [250, 750, 1500];

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

    // Build upstream URL: serverBaseUrl + request path
    // OpenClaw sends to /v1/chat/completions, upstream is /api/proxy/v1/chat/completions
    const upstreamPath = `/api/proxy${req.url || '/'}`;
    const upstreamUrl = `${serverBaseUrl}${upstreamPath}`;

    const result = await forwardRequest(upstreamUrl, req.method || 'POST', tokens.accessToken, body, req.headers);

    if ((result.status === 401 || result.status === 403) && tokenRefresher) {
      console.log(`[OpenClawTokenProxy] received ${result.status}, attempting token refresh`);
      const newToken = await tokenRefresher('openclaw-proxy');
      if (newToken) {
        const retryResult = await forwardRequest(upstreamUrl, req.method || 'POST', newToken, body, req.headers);
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
  body: NodeJS.ReadableStream | Buffer;
  isStream: boolean;
};

async function forwardRequest(
  url: string,
  method: string,
  accessToken: string,
  body: Buffer,
  incomingHeaders: http.IncomingHttpHeaders,
): Promise<UpstreamResult> {
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
      body: resp.body as unknown as NodeJS.ReadableStream,
      isStream: true,
    };
  }

  const respBuffer = Buffer.from(await resp.arrayBuffer());
  return {
    status: resp.status,
    headers: responseHeaders,
    body: respBuffer,
    isStream: false,
  };
}

async function forwardWeknoraOpenClawMcpRequest(
  method: string,
  accessToken: string,
  body: Buffer,
  incomingHeaders: http.IncomingHttpHeaders,
): Promise<UpstreamResult> {
  const headers: Record<string, string> = {
    'X-API-Key': accessToken,
    'Content-Type': headerValueToString(incomingHeaders['content-type']) || 'application/json',
  };

  copyHeader(incomingHeaders, headers, 'accept', 'Accept');
  copyHeader(incomingHeaders, headers, 'mcp-session-id', 'Mcp-Session-Id');
  copyHeader(incomingHeaders, headers, 'mcp-protocol-version', 'Mcp-Protocol-Version');
  copyHeader(incomingHeaders, headers, 'last-event-id', 'Last-Event-ID');

  const resp = await net.fetch(WEKNORA_OPENCLAW_MCP_UPSTREAM_URL, {
    method,
    headers,
    body: body.length > 0 ? new Uint8Array(body) : undefined,
  }).catch(async (error) => {
    for (const delayMs of WEKNORA_OPENCLAW_MCP_RETRY_DELAYS_MS) {
      await delay(delayMs);
      try {
        return await net.fetch(WEKNORA_OPENCLAW_MCP_UPSTREAM_URL, {
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
        upstream: WEKNORA_OPENCLAW_MCP_UPSTREAM_URL,
      })),
      isStream: false,
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
      body: resp.body as unknown as NodeJS.ReadableStream,
      isStream: true,
    };
  }

  const respBuffer = Buffer.from(await resp.arrayBuffer());
  return {
    status: resp.status,
    headers: responseHeaders,
    body: respBuffer,
    isStream: false,
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

function pipeResponse(result: UpstreamResult, res: http.ServerResponse): void {
  res.writeHead(result.status, result.headers);

  if (result.isStream && 'pipe' in result.body && typeof (result.body as NodeJS.ReadableStream).pipe === 'function') {
    (result.body as NodeJS.ReadableStream).pipe(res);
  } else if (Buffer.isBuffer(result.body)) {
    res.end(result.body);
  } else {
    // Web ReadableStream from net.fetch — need to consume manually
    const webStream = result.body as unknown as ReadableStream<Uint8Array>;
    const reader = webStream.getReader();
    const pump = (): void => {
      reader.read().then(({ done, value }) => {
        if (done) {
          res.end();
          return;
        }
        res.write(value);
        pump();
      }).catch((err) => {
        console.error('[OpenClawTokenProxy] stream read error:', err);
        res.end();
      });
    };
    pump();
  }
}
