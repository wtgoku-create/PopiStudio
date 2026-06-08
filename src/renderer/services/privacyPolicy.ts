import { getPrivacyPolicyContentApiUrl } from './endpoints';

export const PrivacyPolicyContentKey = {
  UserTerms: 'web.userTerms',
  PrivacyPolicy: 'web.privacyPolicy',
} as const;

export type PrivacyPolicyContentKey =
  typeof PrivacyPolicyContentKey[keyof typeof PrivacyPolicyContentKey];

interface PrivacyPolicyContentRecord {
  content?: string;
}

interface PrivacyPolicyContentResponse {
  data?: PrivacyPolicyContentRecord;
  message?: string;
  status?: string;
}

const PRIVACY_POLICY_SUCCESS_STATUS = '0000';

export const getPolicyUrl = async (key: PrivacyPolicyContentKey): Promise<string> => {
  const query = new URLSearchParams({ key });
  const response = await window.electron.api.fetch({
    url: `${getPrivacyPolicyContentApiUrl()}?${query.toString()}`,
    method: 'GET',
    headers: {
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Policy request failed: ${response.status}`);
  }

  const payload = (response.data ?? {}) as PrivacyPolicyContentResponse;
  if (payload.status !== PRIVACY_POLICY_SUCCESS_STATUS) {
    throw new Error(payload.message || 'Policy request returned an unexpected status');
  }

  const content = payload.data?.content?.trim();
  if (!content) {
    throw new Error('Policy response did not include a content URL');
  }

  return content;
};
