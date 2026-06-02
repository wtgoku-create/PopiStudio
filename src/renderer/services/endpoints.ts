/**
 * 集中管理所有业务 API 端点。
 * 后续新增的业务接口也应在此文件中配置。
 */

import { configService } from './config';

const isTestMode = () => {
  return configService.getConfig().app?.testMode === true;
};

// 自动更新
export const getUpdateCheckUrl = () => isTestMode()
  ? 'https://api-overmind.youdao.com/openapi/get/luna/hardware/popiai/test/update'
  : 'https://api-overmind.youdao.com/openapi/get/luna/hardware/popiai/prod/update';

// 手动检查更新
export const getManualUpdateCheckUrl = () => isTestMode()
  ? 'https://api-overmind.youdao.com/openapi/get/luna/hardware/popiai/test/update-manual'
  : 'https://api-overmind.youdao.com/openapi/get/luna/hardware/popiai/prod/update-manual';

export const getFallbackDownloadUrl = () => isTestMode()
  ? 'https://popiai.inner.youdao.com/#/download-list'
  : 'https://popiai.youdao.com/#/download-list';

// Skill 商店
export const getSkillHubListUrl = () => `${getLoginOvermindUrl().replace(/\/login$/, '')}/api_client/skill/list?pageSize=99999`;

export const getSkillHubCategoryListUrl = () => `${getLoginOvermindUrl().replace(/\/login$/, '')}/api_client/skill/category/list?pageSize=99999`;

// 登录地址
export const getLoginOvermindUrl = () => isTestMode()
  ? 'https://popi.yuanzoo.cn/login'
  : 'https://popi.yuanzoo.cn/login';

// Portal 页面
const PORTAL_BASE_TEST = 'https://wwwtest.popi.art';
const PORTAL_BASE_PROD = 'https://www.popi.art';

const getPortalBase = () => isTestMode() ? PORTAL_BASE_TEST : PORTAL_BASE_PROD;

export const getPortalLoginUrl = () => `${getPortalBase()}/login`;
export const getPortalPricingUrl = () => `${getPortalBase()}`;
export const getPortalProfileUrl = () => `${getPortalBase()}`;
export const getTermsOfServiceUrl = () => 'https://www.popi.art/content/user-terms';
export const getPrivacyPolicyUrl = () => 'https://www.popi.art/content/privacy-policy';
