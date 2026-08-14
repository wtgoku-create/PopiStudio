import type { IpcMain } from 'electron';
import { app, net } from 'electron';

import { ProviderName } from '../shared/providers';
import { getKeyfromAttribution } from './libs/keyfromAttribution';
import { PopiArtService } from './popiart/popiartService';
import type { SqliteStore } from './sqliteStore';

export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
  knowledgeToken?: string;
};

type PopiUser = {
  id?: number;
  code?: string;
  name?: string;
  avatar?: string | null;
  phone?: string | null;
  email?: string | null;
  isMember?: boolean;
  memberLevel?: number;
  allCoins?: number;
  memberCoins?: number;
  otherCoins?: number;
  pointPackageCoins?: number;
  status?: number;
};

type WechatQrCodeData = {
  qrCodeUrl: string;
  sceneCode: string;
};

type WechatLoginCheckData = {
  expired?: number;
  token?: string;
  needBindPhone?: boolean;
  registerToken?: string;
  user?: PopiUser | null;
};

type PopiModelListItem = {
  id: number;
  code: string;
  name: string;
  status: number;
  deleted: boolean;
  context?: number | null;
  isSupportImages: boolean;
};

export type ServerModelMetadata = {
  modelId: string;
  modelName: string;
  provider: string;
  context?: number;
  contextWindow?: number;
  apiFormat: string;
  supportsImage?: boolean;
  supportsThinking?: boolean;
  thinkingConfig?: import('../shared/providers/modelThinking').ModelThinkingConfig;
};

export const POPI_DEFAULT_SERVER_MODELS = [
  { modelId: 'doubao-seed-2-0-mini-260428', modelName: 'doubao-seed-2-0-mini-260428', context: 262144, provider: ProviderName.PopiaiServer, apiFormat: 'openai', supportsImage: true, supportsThinking: true },
] as const;

const readPositiveNumber = (value: unknown): number | undefined => (
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
);

export type SkillMarketplacePageOptions = {
  page?: number;
  pageSize?: number;
  categoryId?: string;
  keyword?: string;
};

type AuthManagerDeps = {
  ipcMain: IpcMain;
  getStore: () => SqliteStore;
  getServerApiBaseUrl: () => string;
  getSkillHubListUrl: () => string;
  getSkillHubCategoryListUrl: () => string;
  installationUuidKey: string;
  t: (key: string) => string;
  clearServerModelMetadata: () => void;
  updateServerModelMetadata: (models: readonly ServerModelMetadata[]) => boolean;
  syncOpenClawConfig: (options: { reason: string; restartGatewayIfRunning?: boolean }) => Promise<unknown>;
};

const AUTH_USER_STORE_KEY = 'auth_user';

export class AuthManager {
  private pendingTokenRefresh: Promise<string | null> | null = null;
  private popiArtService: PopiArtService | null = null;

  constructor(private readonly deps: AuthManagerDeps) {}

  getKnowledgeAccessKey = (): string | null => {
    try {
      const knowledgeToken = this.deps.getStore().get<AuthTokens>('auth_tokens')?.knowledgeToken;
      return typeof knowledgeToken === 'string' && knowledgeToken.trim() ? knowledgeToken.trim() : null;
    } catch (error) {
      console.warn('[KnowledgeAuth] failed to read access token:', error);
      return null;
    }
  };

  getAuthTokens = (): AuthTokens | null => {
    return this.deps.getStore().get<AuthTokens>('auth_tokens') || null;
  };

  refreshOnce = async (reason: string): Promise<string | null> => {
    if (this.pendingTokenRefresh) {
      return this.pendingTokenRefresh;
    }
    let resolvedToken: string | null = null;
    this.pendingTokenRefresh = (async () => {
      try {
        const tokens = this.getAuthTokens();
        if (!tokens?.refreshToken) return null;
        const serverBaseUrl = this.deps.getServerApiBaseUrl();
        const refreshUrl = `${serverBaseUrl}/api/auth/refresh`;
        console.log(`[Auth] requesting token refresh (reason: ${reason}) at ${refreshUrl}`);
        const resp = await net.fetch(refreshUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.withKeyfromBody({ refreshToken: tokens.refreshToken })),
        });
        if (resp.ok) {
          const body = await resp.json() as { code: number; data: { accessToken: string; refreshToken?: string } };
          if (body.code === 0 && body.data) {
            await this.saveCompleteAuthTokens(body.data.accessToken, body.data.refreshToken || tokens.refreshToken);
            console.log(`[Auth] token refresh succeeded (reason: ${reason})`);
            resolvedToken = body.data.accessToken;
            this.deps.syncOpenClawConfig({ reason: `token-refresh:${reason}`, restartGatewayIfRunning: false }).catch((err) => {
              console.warn('[Auth] post-refresh OpenClaw config sync failed:', err);
            });
          }
        }
      } catch (err) {
        console.warn(`[Auth] token refresh failed (reason: ${reason}):`, err);
      } finally {
        this.pendingTokenRefresh = null;
      }
      return resolvedToken;
    })();
    return this.pendingTokenRefresh;
  };

  waitForPendingRefresh = async (): Promise<void> => {
    if (this.pendingTokenRefresh) {
      await this.pendingTokenRefresh.catch(() => {});
    }
  };

  fetchWithAuth = async (url: string, options?: RequestInit): Promise<Response> => {
    const tokens = this.getAuthTokens();
    if (!tokens) throw new Error('No auth tokens');

    const doFetch = (accessToken: string) =>
      net.fetch(url, {
        ...options,
        headers: {
          ...(options?.headers as Record<string, string>),
          Authorization: `Bearer ${accessToken}`,
          token: accessToken,
        },
      });

    let resp = await doFetch(tokens.accessToken);

    if (resp.status === 401 && tokens.refreshToken) {
      const refreshedAccessToken = await this.refreshOnce('passive');
      if (refreshedAccessToken) {
        resp = await doFetch(refreshedAccessToken);
      }
    }

    return resp;
  };

  fetchSkillMarketplacePage = async (options?: SkillMarketplacePageOptions): Promise<unknown> => {
    const fetchSkillHubJson = async (url: string) => {
      const response = this.getAuthTokens()
        ? await this.fetchWithAuth(url, { method: 'GET' })
        : await net.fetch(url, { method: 'GET' });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return response.json();
    };

    const buildListUrl = () => {
      const listUrl = new URL(this.deps.getSkillHubListUrl());
      const page = Math.max(1, options?.page ?? 1);
      const pageSize = Math.max(1, options?.pageSize ?? 20);
      listUrl.searchParams.set('page', String(page));
      listUrl.searchParams.set('pageSize', String(pageSize));
      if (options?.categoryId && options.categoryId !== 'all') {
        listUrl.searchParams.set('categoryId', options.categoryId);
      }
      const keyword = options?.keyword?.trim();
      if (keyword) {
        listUrl.searchParams.set('keyword', keyword);
      }
      return listUrl.toString();
    };

    const [skillsBody, categoriesBody] = await Promise.all([
      fetchSkillHubJson(buildListUrl()),
      fetchSkillHubJson(this.deps.getSkillHubCategoryListUrl()),
    ]);

    const skills = Array.isArray(skillsBody?.data?.list) ? skillsBody.data.list : [];
    const categories = Array.isArray(categoriesBody?.data?.list) ? categoriesBody.data.list : [];
    const pageInfo = typeof skillsBody?.data?.pageInfo === 'object' && skillsBody.data.pageInfo
      ? skillsBody.data.pageInfo
      : undefined;

    return {
      skills,
      categories,
      pageInfo,
    };
  };

  registerIpcHandlers(): void {
    const { ipcMain } = this.deps;

    ipcMain.handle('auth:login', async (_event, { loginUrl }: { loginUrl?: string } = {}) => {
      return { success: true, loginUrl };
    });

    ipcMain.handle('auth:getCaptcha', async () => {
      try {
        const serverBaseUrl = this.deps.getServerApiBaseUrl();
        const resp = await net.fetch(`${serverBaseUrl}/api_client/captcha/gen`);
        if (!resp.ok) {
          return { success: false, error: `Captcha request failed: ${resp.status}` };
        }
        const data = await this.parsePopiResponse<{ id: number; data: string }>(resp);
        return { success: true, captcha: data };
      } catch (error) {
        console.error('[Auth] captcha request failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Failed to request captcha' };
      }
    });

    ipcMain.handle('auth:sendSmsCode', async (_event, payload: { phone: string; captchaId: number; captchaValue: string }) => {
      try {
        const phone = payload.phone?.trim();
        const captchaValue = payload.captchaValue?.trim();
        if (!phone || !payload.captchaId || !captchaValue) {
          return { success: false, error: 'Phone and captcha are required.' };
        }
        const serverBaseUrl = this.deps.getServerApiBaseUrl();
        const params = new URLSearchParams({
          phone,
          usage: 'LOGIN',
          captchaId: String(payload.captchaId),
          captchaValue,
        });
        const resp = await net.fetch(`${serverBaseUrl}/api_client/auth/code?${params.toString()}`);
        if (!resp.ok) {
          return { success: false, error: `SMS code request failed: ${resp.status}` };
        }
        await this.parsePopiResponse<Record<string, unknown>>(resp);
        return { success: true };
      } catch (error) {
        console.error('[Auth] SMS code request failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Failed to send SMS code' };
      }
    });

    ipcMain.handle('auth:loginWithPassword', async (_event, payload: { username: string; password: string; inviteCode?: string }) => {
      try {
        const serverBaseUrl = this.deps.getServerApiBaseUrl();
        const resp = await net.fetch(`${serverBaseUrl}/api_client/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: payload.username?.trim(),
            password: payload.password,
            inviteCode: payload.inviteCode?.trim() || '',
          }),
        });
        if (!resp.ok) {
          return { success: false, error: `Login failed: ${resp.status}` };
        }
        const data = await this.parsePopiResponse<{ token: string; expired?: number; user: PopiUser }>(resp);
        if (!data?.token || !data.user) {
          return { success: false, error: 'Login response is missing token or user.' };
        }
        return await this.buildPopiAuthResult(data.token, data.user, data.expired);
      } catch (error) {
        console.error('[Auth] password login failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Login failed' };
      }
    });

    ipcMain.handle('auth:loginWithCode', async (_event, payload: { phone: string; code: string; inviteCode?: string }) => {
      try {
        const serverBaseUrl = this.deps.getServerApiBaseUrl();
        const resp = await net.fetch(`${serverBaseUrl}/api_client/auth/loginByCode`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phone: payload.phone?.trim(),
            code: payload.code?.trim(),
            inviteCode: payload.inviteCode?.trim() || '',
          }),
        });
        if (!resp.ok) {
          return { success: false, error: `Login failed: ${resp.status}` };
        }
        const data = await this.parsePopiResponse<{ token: string; expired?: number; user: PopiUser }>(resp);
        if (!data?.token || !data.user) {
          return { success: false, error: 'Login response is missing token or user.' };
        }
        return await this.buildPopiAuthResult(data.token, data.user, data.expired);
      } catch (error) {
        console.error('[Auth] SMS login failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Login failed' };
      }
    });

    ipcMain.handle('auth:getWechatQrCode', async () => {
      try {
        const serverBaseUrl = this.deps.getServerApiBaseUrl();
        const resp = await net.fetch(`${serverBaseUrl}/api_client/auth/wxghQrCode`);
        if (!resp.ok) {
          return { success: false, error: `WeChat QR code request failed: ${resp.status}` };
        }
        const data = await this.parsePopiResponse<WechatQrCodeData>(resp);
        if (!data?.qrCodeUrl || !data?.sceneCode) {
          return { success: false, error: 'WeChat QR code response is missing required fields.' };
        }
        return { success: true, data };
      } catch (error) {
        console.error('[Auth] WeChat QR code request failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Failed to request WeChat QR code' };
      }
    });

    ipcMain.handle('auth:checkWechatLogin', async (_event, payload: { sceneCode: string }) => {
      try {
        const sceneCode = payload.sceneCode?.trim();
        if (!sceneCode) {
          return { success: false, error: 'sceneCode is required.' };
        }
        const serverBaseUrl = this.deps.getServerApiBaseUrl();
        const params = new URLSearchParams({ sceneCode });
        const resp = await net.fetch(`${serverBaseUrl}/api_client/auth/checkWxghLogin?${params.toString()}`);
        if (!resp.ok) {
          return { success: false, error: `WeChat login check failed: ${resp.status}` };
        }
        const data = await this.parsePopiResponse<WechatLoginCheckData>(resp);

        if (data?.token && data.user) {
          return await this.buildPopiAuthResult(data.token, data.user, data.expired);
        }

        if (data?.needBindPhone === true && data.registerToken) {
          return {
            success: true,
            needBindPhone: true,
            registerToken: data.registerToken,
          };
        }

        return {
          success: true,
          pending: true,
        };
      } catch (error) {
        console.error('[Auth] WeChat login check failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Failed to check WeChat login' };
      }
    });

    ipcMain.handle('auth:registerWechatByPhone', async (
      _event,
      payload: { registerToken: string; phone: string; code: string; inviteCode?: string },
    ) => {
      try {
        const registerToken = payload.registerToken?.trim();
        const phone = payload.phone?.trim();
        const code = payload.code?.trim();
        if (!registerToken || !phone || !code) {
          return { success: false, error: 'registerToken, phone, and code are required.' };
        }
        const serverBaseUrl = this.deps.getServerApiBaseUrl();
        const resp = await net.fetch(`${serverBaseUrl}/api_client/auth/wxghRegisterByPhone`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            registerToken,
            phone,
            code,
            inviteCode: payload.inviteCode?.trim() || '',
          }),
        });
        if (!resp.ok) {
          return { success: false, error: `WeChat phone binding failed: ${resp.status}` };
        }
        const data = await this.parsePopiResponse<{ token: string; expired?: number; user: PopiUser }>(resp);
        if (!data?.token || !data.user) {
          return { success: false, error: 'WeChat phone binding response is missing token or user.' };
        }
        return await this.buildPopiAuthResult(data.token, data.user, data.expired);
      } catch (error) {
        console.error('[Auth] WeChat phone binding failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Failed to bind phone' };
      }
    });

    ipcMain.handle('auth:exchange', async (_event, { code }: { code: string }) => {
      try {
        const serverBaseUrl = this.deps.getServerApiBaseUrl();
        const exchangeUrl = `${serverBaseUrl}/api/auth/exchange`;
        console.log(`[Auth] requesting auth exchange at ${exchangeUrl}`);
        const resp = await net.fetch(exchangeUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.withKeyfromBody({ authCode: code })),
        });
        if (!resp.ok) {
          return { success: false, error: `Exchange failed: ${resp.status}` };
        }
        const body = await resp.json() as {
          code: number;
          message?: string;
          data: {
            accessToken: string;
            refreshToken: string;
            user: Record<string, unknown>;
            quota: Record<string, unknown>;
          };
        };
        if (body.code !== 0 || !body.data) {
          return { success: false, error: body.message || 'Exchange failed' };
        }
        await this.saveCompleteAuthTokens(body.data.accessToken, body.data.refreshToken);
        this.saveAuthUser(body.data.user);
        void this.syncPopiArtLoginState('auth-exchange');
        console.log('[Auth] exchange user data:', JSON.stringify(body.data.user));
        return { success: true, user: body.data.user, quota: this.normalizeQuota(body.data.quota) };
      } catch (error) {
        console.error('[Auth] exchange failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Exchange failed' };
      }
    });

    ipcMain.handle('auth:getUser', async () => {
      try {
        const tokens = this.getAuthTokens();
        if (!tokens) return { success: false };
        const serverBaseUrl = this.deps.getServerApiBaseUrl();
        const profileResp = await this.fetchWithAuth(`${serverBaseUrl}/api_client/auth/userInfo`);
        if (!profileResp.ok) return { success: false };
        const profileData = await this.parsePopiResponse<{ token?: string; user: PopiUser }>(profileResp);
        if (!profileData?.user) return { success: false };
        if (profileData.token && profileData.token !== tokens.accessToken) {
          await this.saveCompleteAuthTokens(profileData.token, profileData.token);
        } else if (!tokens.knowledgeToken) {
          await this.saveCompleteAuthTokens(tokens.accessToken, tokens.refreshToken);
        }
        const points = await this.fetchPopiUserPoints();
        const quota = this.normalizePopiQuota({
          ...(profileData.user as Record<string, unknown>),
          ...(points ?? {}),
        });
        this.deps.updateServerModelMetadata([...POPI_DEFAULT_SERVER_MODELS]);
        void this.syncPopiArtLoginState('auth-restore');
        console.log('[Auth] restored Popi user session');
        return { success: true, user: this.normalizePopiUser(profileData.user), quota };
      } catch {
        return { success: false };
      }
    });

    ipcMain.handle('auth:getQuota', async () => {
      try {
        const tokens = this.getAuthTokens();
        if (!tokens) return { success: false };
        const points = await this.fetchPopiUserPoints();
        return { success: true, quota: this.normalizePopiQuota(points) };
      } catch {
        return { success: false };
      }
    });

    ipcMain.handle('auth:getProfileSummary', async () => {
      try {
        const tokens = this.getAuthTokens();
        if (!tokens) return { success: false };
        const points = await this.fetchPopiUserPoints();
        const userResp = await this.fetchWithAuth(`${this.deps.getServerApiBaseUrl()}/api_client/auth/userInfo`);
        if (!userResp.ok) return { success: false };
        const userData = await this.parsePopiResponse<{ user: PopiUser }>(userResp);
        const totalCreditsRemaining = typeof points?.availableTotalPoints === 'number' ? points.availableTotalPoints : 0;
        return {
          success: true,
          data: {
            id: userData.user.id ?? 0,
            nickname: userData.user.name || userData.user.phone || 'Popi user',
            avatarUrl: userData.user.avatar || null,
            totalCreditsRemaining,
            creditItems: [
              {
                type: userData.user.isMember ? 'subscription' : 'free',
                label: userData.user.isMember ? `会员 Lv.${userData.user.memberLevel ?? 0}` : '积分',
                labelEn: userData.user.isMember ? `Member Lv.${userData.user.memberLevel ?? 0}` : 'Points',
                creditsRemaining: totalCreditsRemaining,
                expiresAt: null,
              },
            ],
          },
        };
      } catch {
        return { success: false };
      }
    });

    ipcMain.handle('auth:logout', async () => {
      try {
        const tokens = this.getAuthTokens();
        if (tokens) {
          const serverBaseUrl = this.deps.getServerApiBaseUrl();
          await net.fetch(`${serverBaseUrl}/api_client/auth/logout`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${tokens.accessToken}`, token: tokens.accessToken },
          }).catch(() => { /* best-effort */ });
        }
        this.clearAuthTokens();
        this.clearAuthUser();
        this.deps.clearServerModelMetadata();
        await this.syncPopiArtLogoutState('auth-logout');
        return { success: true };
      } catch {
        this.clearAuthTokens();
        this.clearAuthUser();
        this.deps.clearServerModelMetadata();
        await this.syncPopiArtLogoutState('auth-logout-fallback');
        return { success: true };
      }
    });

    ipcMain.handle('auth:refreshToken', async () => {
      try {
        const tokens = this.getAuthTokens();
        if (!tokens?.accessToken || !tokens.refreshToken) return { success: false };
        await this.saveCompleteAuthTokens(tokens.accessToken, tokens.refreshToken);
        const refreshedTokens = this.getAuthTokens();
        if (!refreshedTokens?.accessToken || !refreshedTokens.refreshToken || !refreshedTokens.knowledgeToken) {
          return { success: false };
        }
        return { success: true, accessToken: refreshedTokens.accessToken };
      } catch {
        return { success: false };
      }
    });

    ipcMain.handle('auth:getAccessToken', async () => {
      const tokens = this.getAuthTokens();
      return tokens?.accessToken || null;
    });

    ipcMain.handle('auth:getKnowledgeToken', async () => {
      return this.getKnowledgeAccessKey();
    });

    ipcMain.handle('auth:getModels', async () => {
      try {
        const tokens = this.getAuthTokens();
        if (!tokens) {
          console.log('[Auth:getModels] No auth tokens available');
          return { success: false };
        }
        const accessToken = tokens.accessToken.trim();
        if (!accessToken) return { success: false };
        let models: ServerModelMetadata[] = [...POPI_DEFAULT_SERVER_MODELS];

        try {
          const serverBaseUrl = this.deps.getServerApiBaseUrl();
          const modelsUrl = `${serverBaseUrl}/api_client/anime/ai/model/list?&origin=pc`;
          const resp = await this.fetchWithAuth(modelsUrl);
          if (resp.ok) {
            const data = await this.parsePopiResponse<PopiModelListItem[]>(resp);
            const serverModels = this.normalizeServerModelList(data);
            if (serverModels.length > 0) {
              models = serverModels;
            }
          }
        } catch (error) {
          console.debug('[Auth:getModels] server model list unavailable, using fallback model:', error);
        }

        const serverModelsChanged = this.deps.updateServerModelMetadata(models);
        if (serverModelsChanged) {
          this.deps.syncOpenClawConfig({ reason: 'server-models-updated', restartGatewayIfRunning: false }).catch(() => {});
        } else {
          console.debug('[Auth:getModels] server model metadata unchanged, skipping config sync');
        }
        return { success: true, models };
      } catch (e) {
        console.error('[Auth:getModels] Error:', e);
        return { success: false };
      }
    });
  }

  private saveAuthTokens(accessToken: string, refreshToken: string, knowledgeToken: string): void {
    if (!accessToken.trim() || !refreshToken.trim() || !knowledgeToken.trim()) {
      throw new Error('Auth tokens must include access, refresh, and knowledge tokens.');
    }
    this.deps.getStore().set('auth_tokens', {
      accessToken: accessToken.trim(),
      refreshToken: refreshToken.trim(),
      knowledgeToken: knowledgeToken.trim(),
    });
  }

  private clearAuthTokens(): void {
    this.deps.getStore().delete('auth_tokens');
    this.deps.getStore().delete('auth_token_meta');
  }

  private normalizePopiUser(user: PopiUser): Record<string, unknown> {
    return {
      yid: user.code || String(user.id || ''),
      nickname: user.name || user.phone || user.email || 'Popi user',
      avatarUrl: user.avatar || null,
      phone: user.phone || null,
      userId: user.id !== undefined ? String(user.id) : undefined,
      id: user.id,
      status: user.status,
    };
  }

  private normalizePopiQuota(raw?: Record<string, unknown> | null): Record<string, unknown> {
    const availableTotalPoints = typeof raw?.availableTotalPoints === 'number'
      ? raw.availableTotalPoints
      : typeof raw?.allCoins === 'number'
        ? raw.allCoins
        : 0;
    const consumePoints = typeof raw?.consumePoints === 'number' ? raw.consumePoints : 0;
    return {
      planName: typeof raw?.planName === 'string' ? raw.planName : this.deps.t('authPlanFree'),
      subscriptionStatus: raw?.isMember === true ? 'active' : 'free',
      creditsLimit: availableTotalPoints + consumePoints,
      creditsUsed: consumePoints,
      creditsRemaining: availableTotalPoints,
    };
  }

  private normalizeQuota(raw: Record<string, unknown>): Record<string, unknown> {
    let creditsLimit = 0;
    let creditsUsed = 0;
    let planName = this.deps.t('authPlanFree');
    let subscriptionStatus = 'free';

    if (typeof raw.freeCreditsTotal === 'number') {
      creditsLimit = raw.freeCreditsTotal as number;
      creditsUsed = (raw.freeCreditsUsed as number) || 0;
      planName = (raw.planName as string) || this.deps.t('authPlanFree');
      subscriptionStatus = (raw.subscriptionStatus as string) || 'free';
    } else if (typeof raw.monthlyCreditsLimit === 'number') {
      creditsLimit = raw.monthlyCreditsLimit as number;
      creditsUsed = (raw.monthlyCreditsUsed as number) || 0;
      planName = (raw.planName as string) || this.deps.t('authPlanStandard');
      subscriptionStatus = (raw.subscriptionStatus as string) || 'active';
    } else if (typeof raw.dailyCreditsLimit === 'number') {
      creditsLimit = raw.dailyCreditsLimit as number;
      creditsUsed = (raw.dailyCreditsUsed as number) || 0;
      planName = (raw.planName as string) || this.deps.t('authPlanFree');
      subscriptionStatus = (raw.subscriptionStatus as string) || 'free';
    } else if (typeof raw.creditsLimit === 'number') {
      return raw;
    }

    return {
      planName,
      subscriptionStatus,
      creditsLimit,
      creditsUsed,
      creditsRemaining: Math.max(0, creditsLimit - creditsUsed),
    };
  }

  private parsePopiResponse = async <T>(resp: Response): Promise<T> => {
    const body = await resp.json() as { status?: string; message?: string; data?: T };
    if (body.status !== '0000') {
      throw new Error(body.message || 'Popi API request failed');
    }
    return body.data as T;
  };

  private normalizeServerModelList = (models: PopiModelListItem[]): ServerModelMetadata[] => {
    return models
      .filter(item => item.deleted !== true && item.status !== 0)
      .map((item): ServerModelMetadata | null => {
        const modelId = item.code.trim();
        if (!modelId) return null;
        const contextWindow = readPositiveNumber(item.context);
        return {
          modelId,
          modelName: item.name.trim() || modelId,
          provider: ProviderName.PopiaiServer,
          apiFormat: 'openai',
          ...(contextWindow !== undefined ? { context: contextWindow, contextWindow } : {}),
          supportsImage: item.isSupportImages,
          supportsThinking: true,
          thinkingConfig: {
            options: [
              { level: 'off', openclawLevel: 'off' },
              { level: 'low', openclawLevel: 'low' },
              { level: 'medium', openclawLevel: 'medium' },
              { level: 'high', openclawLevel: 'high' },
            ],
            defaultLevel: 'medium',
          },
        };
      })
      .filter((model): model is ServerModelMetadata => model !== null);
  };

  private fetchPopiUserPoints = async (): Promise<Record<string, unknown> | null> => {
    const serverBaseUrl = this.deps.getServerApiBaseUrl();
    const resp = await this.fetchWithAuth(`${serverBaseUrl}/api_client/users/userPoints/total`);
    if (!resp.ok) return null;
    return this.parsePopiResponse<Record<string, unknown>>(resp);
  };

  private fetchKnowledgeTokenForAccessToken = async (accessToken: string): Promise<string> => {
    const serverBaseUrl = this.deps.getServerApiBaseUrl();
    const resp = await this.fetchWithAccessToken(`${serverBaseUrl}/api_client/knowledgeUser/detail`, accessToken);
    if (!resp.ok) {
      throw new Error(`Knowledge user detail request failed: ${resp.status}`);
    }

    const data = await this.parsePopiResponse<{
      accessKey?: string;
    }>(resp);

    const accessKey = data?.accessKey?.trim();
    if (!accessKey) {
      throw new Error('Knowledge user detail response did not include an access key.');
    }
    return accessKey;
  };

  private saveCompleteAuthTokens = async (accessToken: string, refreshToken: string): Promise<void> => {
    const knowledgeToken = await this.fetchKnowledgeTokenForAccessToken(accessToken);
    this.saveAuthTokens(accessToken, refreshToken, knowledgeToken);
    console.log('[KnowledgeAuth] saved auth tokens with bound knowledge token.');
  };

  private buildPopiAuthResult = async (token: string, user: PopiUser, expired?: number): Promise<Record<string, unknown>> => {
    const expiresAt = expired ? Date.now() + expired * 1000 : undefined;
    await this.saveCompleteAuthTokens(token, token);
    this.deps.getStore().set('auth_token_meta', { expiresAt });
    const quota = this.normalizePopiQuota({
      ...(user as Record<string, unknown>),
      ...(await this.fetchPopiUserPoints() ?? {}),
    });
    this.deps.clearServerModelMetadata();
    this.deps.updateServerModelMetadata([...POPI_DEFAULT_SERVER_MODELS]);
    this.deps.syncOpenClawConfig({ reason: 'popi-login', restartGatewayIfRunning: false }).catch(() => {});
    void this.syncPopiArtLoginState('popi-login');
    return { success: true, user: this.normalizePopiUser(user), quota };
  };

  private saveAuthUser(user: Record<string, unknown>): void {
    try {
      this.deps.getStore().set(AUTH_USER_STORE_KEY, user);
    } catch (error) {
      console.warn('[Auth] failed to save auth user for attribution:', error);
    }
  }

  private getAuthUserId(): string | null {
    try {
      const user = this.deps.getStore().get<Record<string, unknown>>(AUTH_USER_STORE_KEY);
      const yid = user?.yid;
      if (typeof yid === 'string' && yid.trim()) return yid;
      const userId = user?.userId;
      if (typeof userId === 'string' && userId.trim()) return userId;
    } catch (error) {
      console.warn('[Auth] failed to read auth user for attribution:', error);
    }
    return null;
  }

  private clearAuthUser(): void {
    try {
      this.deps.getStore().delete(AUTH_USER_STORE_KEY);
    } catch (error) {
      console.warn('[Auth] failed to clear auth user for attribution:', error);
    }
  }

  private getOrCreateInstallationId(): string | null {
    try {
      const existing = this.deps.getStore().get<string>(this.deps.installationUuidKey);
      if (typeof existing === 'string' && existing.trim()) {
        return existing;
      }
      const nextId = crypto.randomUUID();
      this.deps.getStore().set(this.deps.installationUuidKey, nextId);
      return nextId;
    } catch (error) {
      console.warn('[Auth] failed to get installation uuid:', error);
      return null;
    }
  }

  private buildKeyfromPayload(): { firstKeyfrom: string; latestKeyfrom: string; uuid?: string; userId?: string; version: string } {
    const { firstKeyfrom, latestKeyfrom } = getKeyfromAttribution(this.deps.getStore());
    const uuid = this.getOrCreateInstallationId();
    const userId = this.getAuthUserId();
    return {
      firstKeyfrom,
      latestKeyfrom,
      ...(uuid ? { uuid } : {}),
      ...(userId ? { userId } : {}),
      version: app.getVersion(),
    };
  }

  private withKeyfromBody<T extends Record<string, unknown>>(body: T): T & ReturnType<AuthManager['buildKeyfromPayload']> {
    return {
      ...body,
      ...this.buildKeyfromPayload(),
    };
  }

  private fetchWithAccessToken(url: string, accessToken: string, options?: RequestInit): Promise<Response> {
    return net.fetch(url, {
      ...options,
      headers: {
        ...(options?.headers as Record<string, string>),
        Authorization: `Bearer ${accessToken}`,
        token: accessToken,
      },
    });
  }

  private getPopiArtService(): PopiArtService {
    if (!this.popiArtService) {
      this.popiArtService = new PopiArtService(this.deps.getStore(), {
        getAuthToken: () => this.getAuthTokens()?.accessToken || null,
      });
    }
    return this.popiArtService;
  }

  private async syncPopiArtLoginState(reason: string): Promise<void> {
    try {
      await this.getPopiArtService().ensureAuthenticatedFromGatewayKey();
      console.log(`[PopiArt] synchronized login state after ${reason}`);
    } catch (error) {
      console.warn(`[PopiArt] failed to synchronize login state after ${reason}:`, error);
    }
  }

  private async syncPopiArtLogoutState(reason: string): Promise<void> {
    try {
      await this.getPopiArtService().ensureUnavailable();
      console.log(`[PopiArt] synchronized logout state after ${reason}`);
    } catch (error) {
      console.warn(`[PopiArt] failed to synchronize logout state after ${reason}:`, error);
    }
  }
}
