import type { ApiFormat } from './constants';

export interface ProviderConfig {
  enabled: boolean;
  apiKey: string;
  baseUrl: string;
  apiFormat?: ApiFormat;
  models?: Array<{
    id: string;
    name: string;
    supportsImage?: boolean;
    supportsVideo?: boolean;
    supportsThinking?: boolean;
    contextWindow?: number;
    maxTokens?: number;
    runtimeProfile?: string;
    customParams?: Record<string, unknown>;
  }>;
  displayName?: string;
  codingPlanEnabled?: boolean;
  authType?: 'apikey' | 'oauth';
  /** OAuth access token (stored separately from apiKey to avoid conflicts) */
  oauthAccessToken?: string;
  /** Base URL returned by OAuth resource_url (stored separately from user-configured baseUrl) */
  oauthBaseUrl?: string;
  oauthRefreshToken?: string;
  oauthTokenExpiresAt?: number;
}
