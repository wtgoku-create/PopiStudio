/**
 * popiartStore.ts
 *
 * 在 popiai SQLite 中管理 PopiArt 的非敏感状态。
 *
 * 设计原则：
 * - Key/token 不单独复制到 popiai SQLite；登录后由 popiartcli 自己写入
 *   POPIART_CONFIG_DIR/config.json，popiai 只保存非敏感状态。
 * - 状态包括：endpoint、auth status、user summary、project、cli version、
 *   lastVerifiedAt、lastError。
 */

import { PopiArtAuthStatus, PopiArtMcp, PopiArtStoreKey } from '../../shared/popiart/constants';
import type { SqliteStore } from '../sqliteStore';
import { popiArtCliExists, resolvePopiArtCliPath, resolvePopiArtConfigDir } from './popiartCliManager';
import type { PopiArtStatus } from './types';

/**
 * 管理 PopiArt 在 SQLite 中的持久化状态。
 * 只存储非敏感信息：认证状态、用户摘要、project 等，不存储 API key。
 */
export class PopiArtStore {
  constructor(private readonly store: SqliteStore) {}

  /**
   * 从 SQLite 读取当前状态，并合并 CLI 路径等动态探测信息。
   */
  getStatus(): PopiArtStatus {
    const saved = this.store.get<Partial<PopiArtStatus>>(PopiArtStoreKey.Status) || {};
    return {
      endpoint: saved.endpoint || PopiArtMcp.Endpoint,
      configDir: resolvePopiArtConfigDir(),
      cliPath: resolvePopiArtCliPath(),
      cliExists: popiArtCliExists(),
      authStatus: saved.authStatus || PopiArtAuthStatus.Unknown,
      user: saved.user,
      project: saved.project,
      cliVersion: saved.cliVersion,
      lastVerifiedAt: saved.lastVerifiedAt,
      lastError: saved.lastError,
    };
  }

  /**
   * 将状态 patch 合并到现有状态后写入 SQLite。
   * 自动保留未覆盖的字段。
   */
  saveStatus(patch: Partial<PopiArtStatus>): PopiArtStatus {
    const next = {
      ...this.getStatus(),
      ...patch,
    };
    this.store.set(PopiArtStoreKey.Status, next);
    return next;
  }
}
