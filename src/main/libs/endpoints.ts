import { app } from 'electron';

import type { SqliteStore } from '../sqliteStore';

let cachedTestMode: boolean | null = null;

/**
 * Read testMode from store and cache it.
 * Call once at startup and again whenever app_config changes.
 */
export function refreshEndpointsTestMode(store: SqliteStore): void {
  const appConfig = store.get<any>('app_config');
  cachedTestMode = appConfig?.app?.testMode === true;
}

/**
 * Whether the app is in test mode.
 * Uses cached value after init; falls back to !app.isPackaged before init.
 */
const isTestMode = (): boolean => {
  return cachedTestMode ?? !app.isPackaged;
};

/**
 * Server API base URL — switches based on testMode.
 * Used for auth exchange/refresh, models, proxy, etc.
 */
export const getServerApiBaseUrl = (): string => {
  return 'https://popi.yuanzoo.cn';
};

export const getUpdateCheckUrl = (): string => (
  isTestMode()
    ? 'https://api-overmind.youdao.com/openapi/get/luna/hardware/popiai/test/update'
    : 'https://api-overmind.youdao.com/openapi/get/luna/hardware/popiai/prod/update'
);

export const getManualUpdateCheckUrl = (): string => (
  isTestMode()
    ? 'https://api-overmind.youdao.com/openapi/get/luna/hardware/popiai/test/update-manual'
    : 'https://api-overmind.youdao.com/openapi/get/luna/hardware/popiai/prod/update-manual'
);

export const getFallbackDownloadUrl = (): string => (
  isTestMode()
    ? 'https://popiai.inner.youdao.com/#/download-list'
    : 'https://popiai.youdao.com/#/download-list'
);

export const getSkillHubListUrl = (): string => (
  `${getServerApiBaseUrl()}/api_client/skill/list?pageSize=99999`
);

export const getSkillHubCategoryListUrl = (): string => (
  `${getServerApiBaseUrl()}/api_client/skill/category/list?pageSize=99999`
);
