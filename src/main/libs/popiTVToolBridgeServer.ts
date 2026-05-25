import http from 'http';
import net from 'net';

import {
  getPopiTVMcpToolManifest,
  POPITV_MCP_SERVER_NAME,
  type PopiTVBridgeToolResult,
} from './popiTVMcpBridgeTools';

export type PopiTVToolBridgeHandler = (
  serverName: string,
  toolName: string,
  args: Record<string, unknown>,
  options: { signal?: AbortSignal },
) => Promise<PopiTVBridgeToolResult | null>;

type JsonRpcRequest = {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
};

type JsonRpcResponse = {
  jsonrpc: '2.0';
  id: unknown;
  result?: unknown;
  error?: {
    code: number;
    message: string;
  };
};

const PROTOCOL_VERSION = '2025-06-18';

const JsonRpcErrorCode = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
} as const;

const log = (level: string, msg: string) => {
  const formatted = `[PopiTVMcpHttp][${level}] ${msg}`;
  if (level === 'ERROR') {
    console.error(formatted);
  } else if (level === 'WARN') {
    console.warn(formatted);
  } else {
    console.log(formatted);
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return !!value && typeof value === 'object' && !Array.isArray(value);
};

export class PopiTVToolBridgeServer {
  private server: http.Server | null = null;
  private _port: number | null = null;
  private localToolHandler: PopiTVToolBridgeHandler | null = null;

  constructor(private readonly secret: string) {}

  get port(): number | null {
    return this._port;
  }

  get mcpUrl(): string | null {
    return this._port ? `http://127.0.0.1:${this._port}/mcp` : null;
  }

  setLocalToolHandler(handler: PopiTVToolBridgeHandler | null): void {
    this.localToolHandler = handler;
  }

  async start(): Promise<number> {
    if (this.server) {
      throw new Error('PopiTVToolBridgeServer is already running');
    }

    const port = await this.findFreePort();

    return new Promise((resolve, reject) => {
      const srv = http.createServer((req, res) => {
        this.handleRequest(req, res).catch(error => {
          log('ERROR', `Unhandled request failed: ${error instanceof Error ? error.message : String(error)}`);
          if (!res.headersSent) {
            this.writeJson(res, 500, {
              jsonrpc: '2.0',
              id: null,
              error: {
                code: JsonRpcErrorCode.InternalError,
                message: 'Internal server error',
              },
            });
          }
        });
      });

      srv.on('error', error => {
        log('ERROR', `HTTP server failed: ${error.message}`);
        reject(error);
      });

      srv.listen(port, '127.0.0.1', () => {
        this._port = port;
        this.server = srv;
        log('INFO', `listening on http://127.0.0.1:${port}/mcp`);
        resolve(port);
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.server) return;

    return new Promise(resolve => {
      this.server!.close(() => {
        this.server = null;
        this._port = null;
        resolve();
      });
      setTimeout(() => {
        this.server?.closeAllConnections?.();
      }, 2000);
    });
  }

  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    if (req.url?.startsWith('/health')) {
      this.writeJson(res, 200, { ok: true });
      return;
    }

    if (!req.url?.startsWith('/mcp')) {
      this.writeJson(res, 404, { error: 'Not found' });
      return;
    }

    const authHeader = req.headers['x-mcp-bridge-secret'];
    if (authHeader !== this.secret) {
      this.writeJson(res, 401, { error: 'Unauthorized' });
      return;
    }

    if (req.method === 'GET') {
      this.writeJson(res, 405, { error: 'Server-sent events are not required for PopiTV MCP.' });
      return;
    }

    if (req.method !== 'POST') {
      this.writeJson(res, 404, { error: 'Not found' });
      return;
    }

    await this.handleMcpPost(req, res);
  }

  private async handleMcpPost(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const abortController = new AbortController();
    const onClose = () => {
      if (!res.writableFinished) {
        abortController.abort();
      }
    };
    res.on('close', onClose);

    try {
      const input = await this.parseJsonRpcRequest(req);
      if (Array.isArray(input)) {
        const responses = await Promise.all(
          input
            .filter(request => request.id !== undefined)
            .map(request => this.handleJsonRpcRequest(request, abortController.signal)),
        );
        this.writeJson(res, 200, responses);
        return;
      }

      if (input.id === undefined) {
        await this.handleJsonRpcNotification(input);
        res.writeHead(202);
        res.end();
        return;
      }

      const response = await this.handleJsonRpcRequest(input, abortController.signal);
      this.writeJson(res, 200, response);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.writeJson(res, 200, this.errorResponse(null, JsonRpcErrorCode.ParseError, message));
    } finally {
      res.removeListener('close', onClose);
    }
  }

  private async handleJsonRpcRequest(
    request: JsonRpcRequest,
    signal: AbortSignal,
  ): Promise<JsonRpcResponse> {
    const id = request.id ?? null;
    if (request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
      return this.errorResponse(id, JsonRpcErrorCode.InvalidRequest, 'Invalid JSON-RPC request.');
    }

    try {
      switch (request.method) {
        case 'initialize':
          console.log(`[PopiTVMcpHttp] initialize received from client, id=${id}`);
          return {
            jsonrpc: '2.0',
            id,
            result: {
              protocolVersion: PROTOCOL_VERSION,
              capabilities: {
                tools: {},
              },
              serverInfo: {
                name: POPITV_MCP_SERVER_NAME,
                version: '1.0.0',
              },
            },
          };
        case 'ping':
          return { jsonrpc: '2.0', id, result: {} };
        case 'tools/list':
          return {
            jsonrpc: '2.0',
            id,
            result: {
              tools: getPopiTVMcpToolManifest().map(tool => ({
                name: tool.name,
                description: tool.description,
                inputSchema: tool.inputSchema,
              })),
            },
          };
        case 'tools/call':
          return await this.handleToolCall(id, request.params, signal);
        default:
          return this.errorResponse(
            id,
            JsonRpcErrorCode.MethodNotFound,
            `Unsupported MCP method "${request.method}".`,
          );
      }
    } catch (error) {
      return this.errorResponse(
        id,
        JsonRpcErrorCode.InternalError,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private async handleJsonRpcNotification(request: JsonRpcRequest): Promise<void> {
    if (request.method === 'notifications/initialized') {
      return;
    }
  }

  private async handleToolCall(
    id: unknown,
    params: unknown,
    signal: AbortSignal,
  ): Promise<JsonRpcResponse> {
    if (!isRecord(params) || typeof params.name !== 'string') {
      return this.errorResponse(id, JsonRpcErrorCode.InvalidParams, 'Missing tool name.');
    }

    const args = isRecord(params.arguments) ? params.arguments : {};
    const result = await this.localToolHandler?.(
      POPITV_MCP_SERVER_NAME,
      params.name,
      args,
      { signal },
    );

    if (!result) {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text: `No local PopiTV MCP handler for ${POPITV_MCP_SERVER_NAME}.${params.name}`,
            },
          ],
          isError: true,
        },
      };
    }

    return {
      jsonrpc: '2.0',
      id,
      result,
    };
  }

  private async parseJsonRpcRequest(req: http.IncomingMessage): Promise<JsonRpcRequest | JsonRpcRequest[]> {
    const body = await this.readBody(req);
    const input = JSON.parse(body) as unknown;
    if (Array.isArray(input)) {
      return input.filter(isRecord) as JsonRpcRequest[];
    }
    if (!isRecord(input)) {
      throw new Error('Invalid JSON body.');
    }
    return input as JsonRpcRequest;
  }

  private errorResponse(id: unknown, code: number, message: string): JsonRpcResponse {
    return {
      jsonrpc: '2.0',
      id,
      error: {
        code,
        message,
      },
    };
  }

  private writeJson(res: http.ServerResponse, status: number, payload: unknown): void {
    if (res.writableEnded) return;
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'MCP-Protocol-Version': PROTOCOL_VERSION,
    });
    res.end(JSON.stringify(payload));
  }

  private readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });
  }

  private findFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const srv = net.createServer();
      srv.once('error', reject);
      srv.once('listening', () => {
        const addr = srv.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        srv.close(() => resolve(port));
      });
      srv.listen(0, '127.0.0.1');
    });
  }
}
