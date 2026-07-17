import crypto from 'crypto';
import { app, BrowserWindow } from 'electron';
import path from 'path';

import { SESSION_AGNOSTIC_PERMISSION_SESSION_ID } from '../shared/cowork/constants';
import { getElectronNodeRuntimePath } from './libs/coworkUtil';
import {
  type AskUserRequest,
  type AskUserResponse,
  McpBridgeServer,
} from './libs/mcpBridgeServer';
import type { ResolvedMcpServer } from './libs/openclawConfigSync';
import { resolveLocalDesktopCoworkSessionIdByOpenClawSessionKey } from './libs/openclawLocalSessionResolver';
import { LOCAL_MCP_SERVER_NAME } from './libs/popiTVToolBridgeServer';
import { resolveStdioCommand } from './libs/resolveStdioCommand';
import { McpStore } from './mcpStore';
import type { SqliteStore } from './sqliteStore';

export type { AskUserResponse };

export interface McpRuntimeDeps {
  getStore: () => SqliteStore;
  getPopiTVMcpUrl: () => string | null;
  getWeknoraOpenClawMcpProxyUrl: () => string | null;
  onAskUserPermissionRequest?: (
    sessionId: string,
    request: {
      requestId: string;
      toolName: string;
      toolInput: Record<string, unknown>;
    },
  ) => void;
  onAskUserPermissionDismiss?: (requestId: string) => void;
}

const WEKNORA_OPENCLAW_MCP_SERVER_NAME = 'weknora-openclaw';

export class McpRuntime {
  private mcpStore: McpStore | null = null;
  private bridgeServer: McpBridgeServer | null = null;
  private readonly bridgeSecret = crypto.randomUUID();
  private resolvedServersCache: ResolvedMcpServer[] = [];

  constructor(private readonly deps: McpRuntimeDeps) {}

  getStore(): McpStore {
    if (!this.mcpStore) {
      this.mcpStore = new McpStore(this.deps.getStore().getDatabase());
    }
    return this.mcpStore;
  }

  getAskUserCallbackUrl(): string | null {
    return this.bridgeServer?.askUserCallbackUrl ?? null;
  }

  getBridgeSecret(): string {
    return this.bridgeSecret;
  }

  getResolvedServersCache(): ResolvedMcpServer[] {
    return this.resolvedServersCache;
  }

  clearResolvedServersCache(): void {
    this.resolvedServersCache = [];
  }

  async refreshResolvedServersCache(): Promise<ResolvedMcpServer[]> {
    this.resolvedServersCache = await this.getResolvedServers();
    return this.resolvedServersCache;
  }

  async startAskUserServer(): Promise<void> {
    if (this.bridgeServer?.port) return;

    if (!this.bridgeServer) {
      this.bridgeServer = new McpBridgeServer(this.bridgeSecret);
    }

    console.log('[AskUser] starting HTTP callback server...');
    await this.bridgeServer.start();

    this.bridgeServer.onAskUser((request) => {
      const sessionId = this.resolveAskUserSessionId(request);
      if (!sessionId) {
        console.warn('[AskUser] denied request for non-desktop or unknown session:', request.sessionKey);
        this.resolveAskUser(request.requestId, { behavior: 'deny' });
        return;
      }

      const windows = BrowserWindow.getAllWindows();
      const permissionRequest = {
        requestId: request.requestId,
        toolName: 'AskUserQuestion',
        toolInput: {
          questions: request.questions,
          ...(request.sessionKey ? { sessionKey: request.sessionKey } : {}),
        },
      };
      this.deps.onAskUserPermissionRequest?.(sessionId, permissionRequest);
      windows.forEach((win) => {
        if (win.isDestroyed()) return;
        try {
          win.webContents.send('cowork:stream:permission', {
            sessionId,
            request: permissionRequest,
          });
        } catch (error) {
          console.error('[AskUser] failed to send permission request to window:', error);
        }
      });
    });

    this.bridgeServer.onAskUserDismiss((requestId) => {
      this.deps.onAskUserPermissionDismiss?.(requestId);
      const windows = BrowserWindow.getAllWindows();
      windows.forEach((win) => {
        if (win.isDestroyed()) return;
        try {
          win.webContents.send('cowork:stream:permissionDismiss', { requestId });
        } catch {
          // ignore destroyed windows
        }
      });
    });

    console.log(`[AskUser] started: askUserUrl=${this.bridgeServer.askUserCallbackUrl}`);
  }

  async askUserInternal(
    questions: AskUserRequest['questions'],
    timeoutMs?: number,
    options?: { sessionKey?: string },
  ): Promise<AskUserResponse | null> {
    if (!this.bridgeServer) return null;
    return await this.bridgeServer.askUserInternal(questions, timeoutMs, options);
  }

  resolveAskUser(requestId: string, response: AskUserResponse): void {
    this.bridgeServer?.resolveAskUser(requestId, response);
  }

  private resolveAskUserSessionId(request: AskUserRequest): string | null {
    if (!request.sessionKey) {
      return SESSION_AGNOSTIC_PERMISSION_SESSION_ID;
    }
    return resolveLocalDesktopCoworkSessionIdByOpenClawSessionKey(
      this.deps.getStore().getDatabase(),
      request.sessionKey,
    );
  }

  private async getResolvedServers(): Promise<ResolvedMcpServer[]> {
    const enabledServers = this.getStore().getEnabledServers();
    const resolved: ResolvedMcpServer[] = [];

    const electronPath = getElectronNodeRuntimePath();
    const npmBinDir = app.isPackaged
      ? path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'npm', 'bin')
      : '';

    for (const server of enabledServers) {
      if (server.transportType === 'stdio') {
        const r = await resolveStdioCommand(server);
        const shimEnv: Record<string, string> = {
          popiai_ELECTRON_PATH: electronPath,
        };
        if (npmBinDir) {
          shimEnv.popiai_NPM_BIN_DIR = npmBinDir;
        }
        resolved.push({
          name: server.name,
          transportType: 'stdio',
          command: r.command,
          args: r.args,
          env: { ...shimEnv, ...(r.env || {}) },
        });
      } else {
        resolved.push({
          name: server.name,
          transportType: server.transportType,
          url: server.url,
          headers: server.headers,
        });
      }
    }

    const hasUserConfiguredWeknoraOpenClaw = resolved.some(server => server.name === WEKNORA_OPENCLAW_MCP_SERVER_NAME);
    const weknoraOpenClawMcpProxyUrl = this.deps.getWeknoraOpenClawMcpProxyUrl();
    if (!hasUserConfiguredWeknoraOpenClaw && weknoraOpenClawMcpProxyUrl) {
      resolved.push({
        name: WEKNORA_OPENCLAW_MCP_SERVER_NAME,
        transportType: 'http',
        url: weknoraOpenClawMcpProxyUrl,
      });
    }

    const popiTvBridgeUrl = this.deps.getPopiTVMcpUrl();
    const hasUserConfiguredLocalMcp = resolved.some(server => server.name === LOCAL_MCP_SERVER_NAME);
    if (popiTvBridgeUrl && !hasUserConfiguredLocalMcp) {
      resolved.push({
        name: LOCAL_MCP_SERVER_NAME,
        transportType: 'http',
        url: popiTvBridgeUrl,
        headers: {
          'x-mcp-bridge-secret': '${LOBSTER_MCP_BRIDGE_SECRET}',
        },
      });
    }

    return resolved;
  }
}
