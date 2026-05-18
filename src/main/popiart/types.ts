import type { PopiArtAuthStatus } from '../../shared/popiart/constants';

/** PopiArt 登录请求输入。 */
export interface PopiArtLoginInput {
  /** API endpoint（可选，默认使用 constants 中的默认值） */
  endpoint?: string;
  /** API key（必填） */
  key: string;
  /** 可选的 project 名称 */
  project?: string;
}

/** PopiArt 内部状态，供 main 进程同步登录态和 CLI 元数据。 */
export interface PopiArtStatus {
  /** API endpoint（默认 https://server.popi.art/v1） */
  endpoint: string;
  /** 配置目录路径 */
  configDir: string;
  /** CLI 二进制路径 */
  cliPath: string;
  /** CLI 是否存在 */
  cliExists: boolean;
  /** 当前认证状态 */
  authStatus: PopiArtAuthStatus;
  /** 当前登录用户信息（来自 whoami） */
  user?: unknown;
  /** 当前 project 名称 */
  project?: string;
  /** CLI 版本号 */
  cliVersion?: string;
  /** 上次验证时间（时间戳） */
  lastVerifiedAt?: number;
  /** 上次错误信息 */
  lastError?: string;
}
