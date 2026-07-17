import { type ProviderConfig,ProviderName,ProviderRegistry } from '@shared/providers';

import {
  type BrowserWebAccessConfig,
  defaultBrowserWebAccessConfig,
} from '../shared/browserWebAccess/constants';

// 配置类型定义
export interface AppConfig {
  // API 配置
  api: {
    key: string;
    baseUrl: string;
  };
  // 模型配置
  model: {
    availableModels: Array<{
      id: string;
      name: string;
      supportsImage?: boolean;
      supportsThinking?: boolean;
    }>;
    defaultModel: string;
    defaultModelProvider?: string;
  };
  providers?: Record<string, ProviderConfig>;
  // 主题配置
  theme: 'light' | 'dark' | 'system';
  // UI 字号配置
  uiFontSize?: number;
  // 代码字体大小配置
  codeFontSize?: number;
  // 语言配置
  language: 'zh' | 'en';
  // 是否使用系统代理
  useSystemProxy: boolean;
  // 是否启用 SQLite 自动备份与恢复
  sqliteAutoBackupEnabled?: boolean;
  // 浏览器与网页访问配置
  browserWebAccess: BrowserWebAccessConfig;
  // 语言初始化标记 (用于判断是否是首次启动)
  language_initialized?: boolean;
  // 应用配置
  app: {
    port: number;
    isDevelopment: boolean;
    testMode?: boolean;
  };
  // 快捷键配置
  shortcuts?: {
    newChat: string;
    search: string;
    settings: string;
    sendMessage: string;
    [key: string]: string | undefined;
  };
}

export const FontPreferences = {
  UiFontSizeMin: 12,
  UiFontSizeMax: 18,
  UiFontSizeDefault: 14,
  CodeFontSizeMin: 10,
  CodeFontSizeMax: 18,
  CodeFontSizeDefault: 12,
} as const;

export const normalizeFontPreference = (
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number => {
  const parsed = typeof value === 'number'
    ? value
    : (typeof value === 'string' ? Number(value) : Number.NaN);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
};

const buildDefaultProviders = (): AppConfig['providers'] => {
  const providers: Record<string, ProviderConfig> = {};

  for (const id of ProviderRegistry.providerIds) {
    const def = ProviderRegistry.get(id)!;
    providers[id] = {
      enabled: false,
      apiKey: '',
      baseUrl: def.defaultBaseUrl,
      apiFormat: def.defaultApiFormat,
      ...(def.codingPlanSupported ? { codingPlanEnabled: false } : {}),
      models: def.defaultModels.map(m => ({ ...m })),
    };
  }

  return providers;
};

// 默认配置
export const defaultConfig: AppConfig = {
  api: {
    key: '',
    baseUrl: '',
  },
  model: {
    availableModels: [],
    defaultModel: '',
    defaultModelProvider: ProviderName.PopiaiServer,
  },
  providers: buildDefaultProviders(),
  theme: 'system',
  uiFontSize: FontPreferences.UiFontSizeDefault,
  codeFontSize: FontPreferences.CodeFontSizeDefault,
  language: 'zh',
  useSystemProxy: false,
  sqliteAutoBackupEnabled: false,
  browserWebAccess: defaultBrowserWebAccessConfig,
  app: {
    port: 3000,
    isDevelopment: process.env.NODE_ENV === 'development',
    testMode: process.env.NODE_ENV === 'development',
  },
  shortcuts: {
    newChat: 'Ctrl+N',
    search: 'Ctrl+F',
    settings: 'Ctrl+,',
    sendMessage: 'Enter',
  }
};

// 配置存储键
export const CONFIG_KEYS = {
  APP_CONFIG: 'app_config',
  AUTH: 'auth_state',
  CONVERSATIONS: 'conversations',
  PROVIDERS_EXPORT_KEY: 'providers_export_key',
  SKILLS: 'skills',
};

// 模型提供商分类
export const EN_PRIORITY_PROVIDERS = ['openai', 'anthropic', 'gemini'] as const;
// Provider lists derived from ProviderRegistry — single source of truth
export const CHINA_PROVIDERS = [...ProviderRegistry.idsByRegion('china')] as const;
export const GLOBAL_PROVIDERS = ProviderRegistry.idsByRegion('global');

export const getVisibleProviders = (language: 'zh' | 'en'): readonly string[] => {
  if (language === 'zh') {
    return [...CHINA_PROVIDERS];
  }
  return ProviderRegistry.idsForEnLocale();
};

/**
 * 判断 provider key 是否为自定义提供商（custom_0, custom_1, ...）
 */
export const isCustomProvider = (key: string): boolean => key.startsWith('custom_');

/**
 * 从 custom_N key 中提取默认显示名称（如 custom_0 → "Custom0"）
 */
export const getCustomProviderDefaultName = (key: string): string => {
  const suffix = key.replace('custom_', '');
  return `Custom${suffix}`;
};

/**
 * 获取 provider 的显示名称，自定义 provider 优先使用 displayName，
 * 内置 provider 使用首字母大写的 key。
 */
export const getProviderDisplayName = (
  providerKey: string,
  providerConfig?: { displayName?: string },
): string => {
  if (isCustomProvider(providerKey)) {
    const name = providerConfig && typeof providerConfig.displayName === 'string'
      ? providerConfig.displayName
      : '';
    return name || getCustomProviderDefaultName(providerKey);
  }
  const def = ProviderRegistry.get(providerKey);
  if (def) return def.label;
  return providerKey.charAt(0).toUpperCase() + providerKey.slice(1);
};
