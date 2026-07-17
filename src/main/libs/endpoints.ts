import { app } from 'electron';

import {
  getKnowledgeBasesUrl as resolveKnowledgeBasesUrl,
  getKnowledgeDefaultBaseUrl as resolveKnowledgeDefaultBaseUrl,
  getKnowledgeFrameSource as resolveKnowledgeFrameSource,
} from '../../shared/knowledge/constants';
import type { SqliteStore } from '../sqliteStore';
import { APP_UPDATE_CHANNEL } from './appUpdateConfig';

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
  return isTestMode()
    ? 'https://wwwtest.popi.art'
    : 'https://www.popi.art';
};

export const getPortalBaseUrl = (): string => (
  isTestMode()
    ? 'https://wwwtest.popi.art/index'
    : 'https://www.popi.art/index'
);

export const getUpdateCheckUrl = (_manual: boolean): string => (
  `${getServerApiBaseUrl()}/api_client/app/latest?channel=${encodeURIComponent(APP_UPDATE_CHANNEL)}`
);

// export const getManualUpdateCheckUrl = (): string => (
//   isTestMode()
//     ? 'https://api-overmind.youdao.com/openapi/get/luna/hardware/popiai/test/update-manual'
//     : 'https://api-overmind.youdao.com/openapi/get/luna/hardware/popiai/prod/update-manual'
// );

export const getFallbackDownloadUrl = (): string => (
  isTestMode()
    ? getPortalBaseUrl()
    : getPortalBaseUrl()
);

export const getSkillHubListUrl = (): string => (
  `${getServerApiBaseUrl()}/api_client/skill/list?pageSize=99999`
);

export const getSkillHubCategoryListUrl = (): string => (
  `${getServerApiBaseUrl()}/api_client/skill/category/list?pageSize=99999`
);

export const getKitStoreUrl = (): string => (
  isTestMode()
    ? 'https://api-overmind.youdao.com/openapi/get/luna/hardware/lobsterai/test/kit-store'
    : 'https://api-overmind.youdao.com/openapi/get/luna/hardware/lobsterai/prod/kit-store'
);

export const getKnowledgeDefaultBaseUrl = (): string => (
  resolveKnowledgeDefaultBaseUrl(isTestMode())
);

export const getKnowledgeBasesUrl = (): string => (
  resolveKnowledgeBasesUrl(isTestMode())
);

export const getKnowledgeFrameSource = (): string => (
  resolveKnowledgeFrameSource(isTestMode())
);
