/**
 * constants.ts
 *
 * PopiArt 模块的字符串常量集中管理。
 * 所有 IPC channel 名称、认证状态、store key 等必须使用此处定义的常量，
 * 禁止在代码中出现裸字符串。
 *
 * 设计原则（来自 CLAUDE.md String Literal Constants 规范）：
 * - 一个模块一个 constants 文件，作为唯一真实来源
 * - 消费者同时导入值对象和类型
 * - IPC channel 必须用常量，不用裸字符串
 */

export const PopiArtMcp = {
  /** 显示名称 */
  Name: 'PopiArt',
  /** PopiArt API endpoint */
  Endpoint: 'https://server.popi.art/v1',
} as const;

/** PopiArt 认证状态枚举 */
export const PopiArtAuthStatus = {
  Unknown: 'unknown',          // 未验证（从未登录或状态未知）
  Authenticated: 'authenticated', // 已认证（登录成功且 token 有效）
  Unauthenticated: 'unauthenticated', // 未认证（未登录或 token 已失效）
  Error: 'error',             // 错误状态（上次操作失败）
} as const;
export type PopiArtAuthStatus = typeof PopiArtAuthStatus[keyof typeof PopiArtAuthStatus];

/** PopiArt SQLite store key */
export const PopiArtStoreKey = {
  Status: 'popiart.status',  // 状态数据（endpoint、authStatus、user、project 等）
} as const;
export type PopiArtStoreKey = typeof PopiArtStoreKey[keyof typeof PopiArtStoreKey];
