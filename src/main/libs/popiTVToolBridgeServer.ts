import http from 'http';
import net from 'net';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';

import {
  getPopiTVMcpToolManifest,
  POPITV_MCP_SERVER_NAME,
  type PopiTVBridgeToolResult,
} from './popiTVMcpBridgeTools';

export const LOCAL_MCP_SERVER_NAME = 'popiartAi';

export type PopiTVToolBridgeHandler = (
  serverName: string,
  toolName: string,
  args: Record<string, unknown>,
  options: { signal?: AbortSignal },
) => Promise<PopiTVBridgeToolResult | null>;

export type LocalMcpToolManifestEntry = {
  name: string;
  description: string;
  inputSchema: Tool['inputSchema'];
};

export type LocalMcpToolProvider = {
  serverName: string;
  tools: LocalMcpToolManifestEntry[];
  handleToolCall: PopiTVToolBridgeHandler;
};

const PROTOCOL_VERSION = '2025-06-18';

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
  private readonly localToolProviders = new Map<string, LocalMcpToolProvider>();
  private popiTVToolHandler: PopiTVToolBridgeHandler | null = null;

  constructor(private readonly secret: string) {
    // this.registerLocalToolProvider({
    //   serverName: POPITV_MCP_SERVER_NAME,
    //   tools: getPopiTVMcpToolManifest(),
    //   handleToolCall: (serverName, toolName, args, options) => (
    //     this.popiTVToolHandler?.(serverName, toolName, args, options) ?? Promise.resolve(null)
    //   ),
    // });
  }

  get port(): number | null {
    return this._port;
  }

  get mcpUrl(): string | null {
    return this._port ? `http://127.0.0.1:${this._port}/mcp` : null;
  }

  registerLocalToolProvider(provider: LocalMcpToolProvider): void {
    const serverName = provider.serverName.trim();
    if (!serverName) {
      throw new Error('Local MCP tool provider requires a server name.');
    }

    this.localToolProviders.set(serverName, {
      ...provider,
      serverName,
    });
  }

  unregisterLocalToolProvider(serverName: string): void {
    this.localToolProviders.delete(serverName.trim());
  }

  setLocalToolHandler(handler: PopiTVToolBridgeHandler | null): void {
    this.popiTVToolHandler = handler;
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
            this.writeJson(res, 500, this.buildJsonRpcError('Internal server error'));
          } else {
            res.end();
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

    if (req.method === 'DELETE') {
      this.writeJson(res, 405, this.buildJsonRpcError('Method not allowed.'));
      return;
    }

    if (req.method !== 'POST' && req.method !== 'GET') {
      this.writeJson(res, 404, { error: 'Not found' });
      return;
    }

    if (req.method === 'GET') {
      this.writeJson(res, 405, this.buildJsonRpcError('Method not allowed.'));
      return;
    }

    await this.handleMcpRequestWithSdk(req, res);
  }

  private async handleMcpRequestWithSdk(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const mcpServer = this.createMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    try {
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res);
    } catch (error) {
      log('ERROR', `MCP request failed: ${error instanceof Error ? error.message : String(error)}`);
      if (!res.headersSent) {
        this.writeJson(res, 500, this.buildJsonRpcError('Internal server error'));
      }
    } finally {
      await transport.close().catch(() => {});
      await mcpServer.close().catch(() => {});
    }
  }

  private createMcpServer(): Server {
    const mcpServer = new Server(
      {
        name: LOCAL_MCP_SERVER_NAME,
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      },
    );

    mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.getLocalToolManifest().map(tool => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    }));

    mcpServer.setRequestHandler(CallToolRequestSchema, async (request, extra): Promise<CallToolResult> => {
      const toolName = request.params.name;
      const args = isRecord(request.params.arguments) ? request.params.arguments : {};
      const provider = this.findLocalToolProvider(toolName);
      const result = provider
        ? await provider.handleToolCall(provider.serverName, toolName, args, { signal: extra.signal })
        : null;

      if (!result) {
        return {
          content: [
            {
              type: 'text',
              text: `No local MCP handler for tool "${toolName}".`,
            },
          ],
          isError: true,
        };
      }

      return result;
    });

    return mcpServer;
  }

  private getLocalToolManifest(): LocalMcpToolManifestEntry[] {
    return Array.from(this.localToolProviders.values())
      .flatMap(provider => provider.tools);
  }

  private findLocalToolProvider(toolName: string): LocalMcpToolProvider | null {
    for (const provider of this.localToolProviders.values()) {
      if (provider.tools.some(tool => tool.name === toolName)) {
        return provider;
      }
    }
    return null;
  }

  private buildJsonRpcError(message: string): {
    jsonrpc: '2.0';
    error: { code: -32000; message: string };
    id: null;
  } {
    return {
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message,
      },
      id: null,
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
