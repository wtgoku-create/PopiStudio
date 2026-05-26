/**
 * popiartService.ts
 *
 * Main process 服务层，封装 PopiArt 的业务逻辑。
 *
 * 职责：
 * - CLI 可用性检查（版本、路径）
 * - 登录/登出（调用 popiart auth login/logout）
 * - 身份验证（whoami、project 当前状态）
 * - OpenClaw 环境刷新（登录/登出后让运行中的会话尽快感知最新 CLI 登录态）
 *
 * 登录流程：
 * 1. 确认 CLI 可用
 * 2. 确保 POPIART_CONFIG_DIR 存在
 * 3. 调用 auth login（key 通过命令行参数传入；cli 会写入 config.json）
 * 4. 调用 whoami 验证
 * 5. 可选：设置当前 project
 * 6. 更新 SQLite 中的非敏感状态
 * 7. 触发 OpenClaw 环境刷新
 */

import fs from 'fs';

import { PopiArtAuthStatus, PopiArtMcp } from '../../shared/popiart/constants';
import type { SqliteStore } from '../sqliteStore';
import { clearPopiArtConfig, popiArtCliExists, resolvePopiArtCliPath, resolvePopiArtConfigDir, runPopiArtCli } from './popiartCliManager';
import { PopiArtStore } from './popiartStore';
import type { PopiArtLoginInput, PopiArtStatus } from './types';

type FetchWithAuth = (url: string, options?: RequestInit) => Promise<Response>;

interface PopiArtServiceOptions {
  /** 使用当前 popiai 登录态发起鉴权请求。 */
  fetchWithAuth: FetchWithAuth;
  /** 获取当前服务器基础地址。 */
  getServerBaseUrl: () => string;
}

/**
 * PopiArt 主进程服务层。
 * 提供登录、登出、当前身份信息读取等能力。
 * 每次操作后都会刷新 OpenClaw 运行环境，使 CLI 登录态尽快生效。
 */
export class PopiArtService {
  private readonly popiArtStore: PopiArtStore;
  private readonly options: PopiArtServiceOptions;

  constructor(store: SqliteStore, options: PopiArtServiceOptions) {
    this.popiArtStore = new PopiArtStore(store);
    this.options = options;
  }

  /**
   * 获取当前 PopiArt 状态，包括 CLI 路径、配置目录、认证状态等。
   */
  getStatus(): PopiArtStatus {
    const status = this.popiArtStore.getStatus();
    return {
      ...status,
      cliPath: resolvePopiArtCliPath(),
      cliExists: popiArtCliExists(),
      configDir: resolvePopiArtConfigDir(),
    };
  }

  /**
   * 登录 PopiArt：
   * 1. 验证 key 非空
   * 2. 确保配置目录存在（权限 0o700）
   * 3. 调用 auth login — key 写入 POPIART_CONFIG_DIR/config.json
   * 4. 可选：设置当前 project
   * 5. 调用 verify 验证登录
   *
   * @throws key 为空或 auth login 失败
   */
  async login(input: PopiArtLoginInput): Promise<PopiArtStatus> {
    const key = input.key.trim();
    if (!key) {
      throw new Error('PopiArt key is required.');
    }

    const endpoint = input.endpoint?.trim() || PopiArtMcp.Endpoint;
    // 确保配置目录存在，权限 0o700 保护 auth token
    fs.mkdirSync(resolvePopiArtConfigDir(), { recursive: true, mode: 0o700 });

    // 调用 popiart auth login，key 通过命令行传递
    // 注意：key 不会进入 prompt 或 tool 输入，只出现在 CLI 进程参数中
    console.log(`[PopiArt] login: running popiart auth login, configDir=${resolvePopiArtConfigDir()}`);
    const result = await runPopiArtCli(['auth', 'login', '--key', key, '--output', 'json', '--quiet', '--non-interactive'], {
      endpoint,
      timeoutMs: 60_000,
    });
    if (!result.ok) {
      const message = result.error?.message || 'PopiArt login failed.';
      console.error(`[PopiArt] login failed: ${message}`);
      this.popiArtStore.saveStatus({
        endpoint,
        authStatus: PopiArtAuthStatus.Error,
        lastError: message,
        lastVerifiedAt: Date.now(),
      });
      throw new Error(message);
    }

    // 设置当前 project（可选）
    if (input.project?.trim()) {
      await runPopiArtCli(['project', 'use', input.project.trim(), '--output', 'json', '--quiet', '--non-interactive'], {
        endpoint,
        timeoutMs: 30_000,
      });
    }

    // 验证登录状态
    const status = await this.verify(endpoint);
    console.log(`[PopiArt] login success: authStatus=${status.authStatus}`);
    return status;
  }

  /**
   * 登出 PopiArt：
   * 调用 auth logout 清除本地配置目录中的 token，
   * 然后更新状态。
   */
  async logout(): Promise<PopiArtStatus> {
    const endpoint = this.getStatus().endpoint || PopiArtMcp.Endpoint;
    await runPopiArtCli(['auth', 'logout', '--output', 'json', '--quiet', '--non-interactive'], {
      endpoint,
      timeoutMs: 30_000,
    });
    clearPopiArtConfig();
    return this.popiArtStore.saveStatus({
      endpoint,
      authStatus: PopiArtAuthStatus.Unauthenticated,
      user: undefined,
      project: undefined,
      lastError: undefined,
      lastVerifiedAt: Date.now(),
    });
  }

  /**
   * 使用当前 popiai 登录 token，从网关接口拉取 PopiArt 专用 API key。
   *
   * 该 key 与用户登录态绑定，只在主进程中短暂使用，
   * 不会被长期存入 popiai 自己的 SQLite。
   */
  async fetchGatewayPopiArtKey(): Promise<string | null> {
    const serverBaseUrl = this.options.getServerBaseUrl().replace(/\/+$/, '');
    const response = await this.options.fetchWithAuth(`${serverBaseUrl}/api_client/gateway/apikey/list`);
    if (!response.ok) {
      throw new Error(`Failed to fetch PopiArt API key: HTTP ${response.status}`);
    }

    const payload = await response.json() as unknown;
    return this.extractGatewayPopiArtKey(payload);
  }

  /**
   * 根据当前 popiai 登录态，自动同步 PopiArt 登录状态。
   *
   * 流程：
   * 1. 调网关接口获取 PopiArt key
   * 2. 用该 key 自动登录 popiartcli
   * 3. 验证登录成功后写入本地 CLI 配置
   *
   * 如果当前没有可用 key，则会确保 PopiArt 处于不可用状态。
   */
  async ensureAuthenticatedFromGatewayKey(): Promise<PopiArtStatus> {
    try {
      console.log('[PopiArt] fetching gateway PopiArt key...');
      const key = await this.fetchGatewayPopiArtKey();
      if (!key) {
        console.log('[PopiArt] no gateway key available');
        return this.markUnavailable('PopiArt API key is not available for the current user.');
      }

      console.log('[PopiArt] gateway key received, logging in CLI...');
      return await this.login({
        endpoint: this.getStatus().endpoint || PopiArtMcp.Endpoint,
        key,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to sync PopiArt authentication.';
      console.error('[PopiArt] CLI login failed:', message);
      return this.markError(message);
    }
  }

  /**
   * 在用户未登录、用户登出，或拉取 PopiArt key 失败时，
   * 统一将 PopiArt 置为不可用状态。
   */
  async ensureUnavailable(): Promise<PopiArtStatus> {
    try {
      return await this.logout();
    } catch {
      clearPopiArtConfig();
      return this.popiArtStore.saveStatus({
        endpoint: this.getStatus().endpoint || PopiArtMcp.Endpoint,
        authStatus: PopiArtAuthStatus.Unauthenticated,
        user: undefined,
        project: undefined,
        lastError: undefined,
        lastVerifiedAt: Date.now(),
      });
    }
  }

  /**
   * 查询当前登录用户信息。
   */
  async whoami(): Promise<unknown> {
    const endpoint = this.getStatus().endpoint || PopiArtMcp.Endpoint;
    const result = await runPopiArtCli(['auth', 'whoami', '--output', 'json', '--quiet', '--non-interactive'], {
      endpoint,
      timeoutMs: 30_000,
    });
    if (!result.ok) {
      throw new Error(result.error?.message || 'PopiArt whoami failed.');
    }
    return result.data;
  }

  /**
   * 验证当前登录状态：
   * 调用 whoami 确认 token 有效，并查询当前 project。
   * 验证成功后将 authStatus 更新为 Authenticated。
   *
   * @note 登录成功后由 login() 调用，登出后由 logout() 调用，
   *       外部不应直接调用此方法；应通过 login/logout 间接触发。
   */
  async verify(endpoint = this.getStatus().endpoint || PopiArtMcp.Endpoint): Promise<PopiArtStatus> {
    const result = await runPopiArtCli(['auth', 'whoami', '--output', 'json', '--quiet', '--non-interactive'], {
      endpoint,
      timeoutMs: 30_000,
    });
    if (!result.ok) {
      return this.popiArtStore.saveStatus({
        endpoint,
        authStatus: PopiArtAuthStatus.Unauthenticated,
        user: undefined,
        project: undefined,
        lastError: result.error?.message || 'PopiArt authentication is missing.',
        lastVerifiedAt: Date.now(),
      });
    }

    // 查询当前 project
    let project: string | undefined;
    const projectResult = await runPopiArtCli<{ project?: string }>(['project', 'current', '--output', 'json', '--quiet', '--non-interactive'], {
      endpoint,
      timeoutMs: 30_000,
    });
    if (projectResult.ok && projectResult.data && typeof projectResult.data === 'object') {
      const rawProject = (projectResult.data as Record<string, unknown>).project;
      project = typeof rawProject === 'string' ? rawProject : undefined;
    }

    const status = this.popiArtStore.saveStatus({
      endpoint,
      authStatus: PopiArtAuthStatus.Authenticated,
      user: result.data,
      project,
      lastError: undefined,
      lastVerifiedAt: Date.now(),
    });
    return status;
  }

  /**
   * 从网关返回结构中提取 PopiArt API key。
   *
   * 兼容以下几种常见返回形式：
   * - { data: [{ provider: 'popiart', apiKey: '...' }] }
   * - { data: { list: [...] } }
   * - { data: { apiKey: '...' } }
   */
  private extractGatewayPopiArtKey(payload: unknown): string | null {
    const candidates = this.collectApiKeyCandidates(payload);
    if (candidates.length === 0) return null;

    // 优先选择明确标记为 PopiArt 的记录。
    const preferred = candidates.find((candidate) => this.isPopiArtCandidate(candidate.record));
    if (preferred?.key) {
      return preferred.key;
    }

    // 如果接口只返回单个 key，则直接使用第一个候选值。
    return candidates[0]?.key || null;
  }

  /**
   * 递归收集结构中所有可能的 key 记录。
   */
  private collectApiKeyCandidates(payload: unknown): Array<{ key: string; record: Record<string, unknown> }> {
    const results: Array<{ key: string; record: Record<string, unknown> }> = [];
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      if (!value || typeof value !== 'object') {
        return;
      }

      const record = value as Record<string, unknown>;
      const key = this.readKeyField(record);
      if (key) {
        results.push({ key, record });
      }

      Object.values(record).forEach(visit);
    };

    visit(payload);
    return results;
  }

  /**
   * 判断某条 key 记录是否明确指向 PopiArt。
   */
  private isPopiArtCandidate(record: Record<string, unknown>): boolean {
    const joined = Object.values(record)
      .filter((value): value is string => typeof value === 'string')
      .join(' ')
      .toLowerCase();
    return joined.includes('popiart') || joined.includes('popi art');
  }

  /**
   * 从单条记录中读取可能的 key 字段。
   */
  private readKeyField(record: Record<string, unknown>): string | null {
    for (const field of ['apiKey', 'apikey', 'key', 'value', 'secret']) {
      const raw = record[field];
      if (typeof raw === 'string' && raw.trim()) {
        return raw.trim();
      }
    }
    return null;
  }

  /**
   * 统一记录错误状态。
   */
  private markError(message: string): PopiArtStatus {
    return this.popiArtStore.saveStatus({
      endpoint: this.getStatus().endpoint || PopiArtMcp.Endpoint,
      authStatus: PopiArtAuthStatus.Error,
      user: undefined,
      project: undefined,
      lastError: message,
      lastVerifiedAt: Date.now(),
    });
  }

  /**
   * 统一记录未登录/不可用状态。
   */
  private markUnavailable(message: string): PopiArtStatus {
    clearPopiArtConfig();
    return this.popiArtStore.saveStatus({
      endpoint: this.getStatus().endpoint || PopiArtMcp.Endpoint,
      authStatus: PopiArtAuthStatus.Unauthenticated,
      user: undefined,
      project: undefined,
      lastError: message,
      lastVerifiedAt: Date.now(),
    });
  }

}
