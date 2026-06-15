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
 * 3. 调用 auth login（token 通过命令行参数传入；cli 会写入 config.json）
 * 4. 调用 whoami 验证
 * 5. 可选：设置当前 project
 * 6. 更新 SQLite 中的非敏感状态
 * 7. 触发 OpenClaw 环境刷新
 */

import fs from 'fs';

import { PopiArtAuthStatus } from '../../shared/popiart/constants';
import { getServerApiBaseUrl } from '../libs/endpoints';
import type { SqliteStore } from '../sqliteStore';
import { clearPopiArtConfig, popiArtCliExists, resolvePopiArtCliPath, resolvePopiArtConfigDir, runPopiArtCli } from './popiartCliManager';
import { PopiArtStore } from './popiartStore';
import type { PopiArtLoginInput, PopiArtStatus } from './types';

interface PopiArtServiceOptions {
  /** 获取当前应用鉴权 token。 */
  getAuthToken: () => string | null;
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

  private getDefaultEndpoint(): string {
    return getServerApiBaseUrl();
  }

  /**
   * 登录 PopiArt：
   * 1. 验证 token 非空
   * 2. 确保配置目录存在（权限 0o700）
   * 3. 调用 auth login — token 写入 POPIART_CONFIG_DIR/config.json
   * 4. 可选：设置当前 project
   * 5. 调用 verify 验证登录
   *
   * @throws token 为空或 auth login 失败
   */
  async login(input: PopiArtLoginInput): Promise<PopiArtStatus> {
    const token = input.token.trim();
    if (!token) {
      throw new Error('PopiArt token is required.');
    }

    const endpoint = input.endpoint?.trim() || this.getDefaultEndpoint();
    // 确保配置目录存在，权限 0o700 保护 auth token
    fs.mkdirSync(resolvePopiArtConfigDir(), { recursive: true, mode: 0o700 });

    // 调用 popiart auth login，token 通过命令行传递。
    // 实际 CLI 命令格式为：popiart --endpoint https://www.popi.art auth login --key <token>
    console.log(`[PopiArt] login: running popiart auth login, configDir=${resolvePopiArtConfigDir()}`);
    const result = await runPopiArtCli(['auth', 'login', '--key', token, '--output', 'json', '--quiet', '--non-interactive'], {
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
    const endpoint = this.getStatus().endpoint || this.getDefaultEndpoint();
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
   * 读取当前应用鉴权 token。
   *
   * PopiArt CLI 现在直接复用应用登录态里的鉴权 token，
   * 不再额外请求网关 key。
   */
  private getAuthToken(): string | null {
    const token = this.options.getAuthToken()?.trim();
    return token || null;
  }

  /**
   * 根据当前 popiai 登录态，自动同步 PopiArt 登录状态。
   *
   * 流程：
   * 1. 读取当前应用鉴权 token
   * 2. 用该 token 自动登录 popiartcli
   * 3. 验证登录成功后写入本地 CLI 配置
   *
   * 如果当前没有可用 token，则会确保 PopiArt 处于不可用状态。
   */
  async ensureAuthenticatedFromGatewayKey(): Promise<PopiArtStatus> {
    try {
      console.log('[PopiArt] reading auth token for CLI login...');
      const token = this.getAuthToken();
      if (!token) {
        console.log('[PopiArt] no auth token available');
        return this.markUnavailable('PopiArt auth token is not available for the current user.');
      }

      console.log('[PopiArt] auth token available, logging in CLI...');
      return await this.login({
        endpoint: this.getStatus().endpoint || this.getDefaultEndpoint(),
        token,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to sync PopiArt authentication.';
      console.error('[PopiArt] CLI login failed:', message);
      return this.markError(message);
    }
  }

  /**
   * 在用户未登录、用户登出，或读取 PopiArt auth token 失败时，
   * 统一将 PopiArt 置为不可用状态。
   */
  async ensureUnavailable(): Promise<PopiArtStatus> {
    try {
      return await this.logout();
    } catch {
      clearPopiArtConfig();
      return this.popiArtStore.saveStatus({
        endpoint: this.getStatus().endpoint || this.getDefaultEndpoint(),
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
    const endpoint = this.getStatus().endpoint || this.getDefaultEndpoint();
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
  async verify(endpoint = this.getStatus().endpoint || this.getDefaultEndpoint()): Promise<PopiArtStatus> {
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
   * 统一记录错误状态。
   */
  private markError(message: string): PopiArtStatus {
    return this.popiArtStore.saveStatus({
      endpoint: this.getStatus().endpoint || this.getDefaultEndpoint(),
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
      endpoint: this.getStatus().endpoint || this.getDefaultEndpoint(),
      authStatus: PopiArtAuthStatus.Unauthenticated,
      user: undefined,
      project: undefined,
      lastError: message,
      lastVerifiedAt: Date.now(),
    });
  }

}
