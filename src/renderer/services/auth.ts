import { store } from '../store';
import { setAuthLoading, setLoggedIn, setLoggedOut, updateQuota, setProfileSummary } from '../store/slices/authSlice';
import { setServerModels, clearServerModels, setDefaultSelectedModel } from '../store/slices/modelSlice';
import type { Model } from '../store/slices/modelSlice';
import { configService } from './config';

class AuthService {
  private unsubCallback: (() => void) | null = null;
  private unsubQuotaChanged: (() => void) | null = null;
  private unsubWindowState: (() => void) | null = null;
  private lastRefreshTime = 0;
  private loginDialogOpener: (() => void) | null = null;

  setLoginDialogOpener(opener: (() => void) | null) {
    this.loginDialogOpener = opener;
  }

  /**
   * Initialize: try to restore login state from persisted token.
   */
  async init() {
    // Clean up any existing listeners to prevent stacking on repeated init()
    this.destroy();

    store.dispatch(setAuthLoading(true));
    try {
      const result = await window.electron.auth.getUser();
      if (result.success && result.user) {
        store.dispatch(setLoggedIn({ user: result.user, quota: result.quota }));
        await this.loadServerModels();
      } else {
        store.dispatch(setLoggedOut());
      }
    } catch {
      store.dispatch(setLoggedOut());
    }

    // Listen for OAuth callback from protocol handler
    this.unsubCallback = window.electron.auth.onCallback(async ({ code }) => {
      await this.handleCallback(code);
    });

    // Listen for quota changes (e.g. after cowork session using server model)
    this.unsubQuotaChanged = window.electron.auth.onQuotaChanged(() => {
      this.refreshQuota();
      this.loadServerModels();
    });

    // Refresh quota and models when Electron window gains focus — user may have purchased on portal
    this.unsubWindowState = window.electron.window.onStateChanged((state) => {
      if (state.isFocused && store.getState().auth.isLoggedIn) {
        const now = Date.now();
        if (now - this.lastRefreshTime > 30_000) {
          this.lastRefreshTime = now;
          this.refreshQuota();
          this.loadServerModels();
        }
      }
    });
  }

  /**
   * Initiate login (opens system browser).
   */
  async login() {
    if (this.loginDialogOpener) {
      this.loginDialogOpener();
      return;
    }
    await window.electron.auth.login();
  }

  async requestCaptcha() {
    return window.electron.auth.getCaptcha();
  }

  async sendSmsCode(payload: { phone: string; captchaId: number; captchaValue: string }) {
    return window.electron.auth.sendSmsCode(payload);
  }

  async loginWithPassword(payload: { username: string; password: string; inviteCode?: string }) {
    const result = await window.electron.auth.loginWithPassword(payload);
    if (result.success && result.user && result.quota) {
      store.dispatch(setLoggedIn({ user: result.user, quota: result.quota }));
      await this.loadServerModels();
    }
    return result;
  }

  async loginWithCode(payload: { phone: string; code: string; inviteCode?: string }) {
    const result = await window.electron.auth.loginWithCode(payload);
    if (result.success && result.user && result.quota) {
      store.dispatch(setLoggedIn({ user: result.user, quota: result.quota }));
      await this.loadServerModels();
    }
    return result;
  }

  /**
   * Handle OAuth callback with auth code.
   */
  async handleCallback(code: string) {
    try {
      const result = await window.electron.auth.exchange(code);
      if (result.success) {
        store.dispatch(setLoggedIn({ user: result.user, quota: result.quota }));
        await this.loadServerModels();
      }
    } catch (e) {
      console.error('Auth callback failed:', e);
    }
  }

  /**
   * Logout.
   */
  async logout() {
    await window.electron.auth.logout();
    store.dispatch(setLoggedOut());
    store.dispatch(clearServerModels());
    const config = configService.getConfig();
    await configService.updateConfig({
      model: {
        ...config.model,
        defaultModel: '',
        defaultModelProvider: 'popiai-server',
      },
    });
  }

  /**
   * Refresh quota information.
   */
  async refreshQuota() {
    try {
      const result = await window.electron.auth.getQuota();
      if (result.success) {
        store.dispatch(updateQuota(result.quota));
      }
    } catch {
      // ignore
    }
  }

  /**
   * Fetch profile summary (credits breakdown).
   */
  async fetchProfileSummary() {
    try {
      const result = await window.electron.auth.getProfileSummary();
      if (result.success && result.data) {
        store.dispatch(setProfileSummary(result.data));
      }
    } catch {
      // ignore
    }
  }

  /**
   * Get current access token (for proxy API calls).
   */
  async getAccessToken(): Promise<string | null> {
    try {
      return await window.electron.auth.getAccessToken();
    } catch {
      return null;
    }
  }

  destroy() {
    this.unsubCallback?.();
    this.unsubCallback = null;
    this.unsubQuotaChanged?.();
    this.unsubQuotaChanged = null;
    this.unsubWindowState?.();
    this.unsubWindowState = null;
  }

  /**
   * Load available models from server and dispatch to store.
   */
  private async loadServerModels() {
    try {
      const modelsResult = await window.electron.auth.getModels();
      if (modelsResult.success && modelsResult.models) {
        const serverModels: Model[] = modelsResult.models.map((m: { modelId: string; modelName: string; provider: string; apiFormat: string; supportsImage?: boolean }) => ({
          id: m.modelId,
          name: m.modelName,
          provider: m.provider,
          providerKey: 'popiai-server',
          isServerModel: true,
          serverApiFormat: m.apiFormat,
          supportsImage: m.supportsImage ?? false,
        }));
        store.dispatch(setServerModels(serverModels));
        if (serverModels.length > 0) {
          store.dispatch(setDefaultSelectedModel(serverModels[0]));
          const config = configService.getConfig();
          await configService.updateConfig({
            model: {
              ...config.model,
              defaultModel: serverModels[0].id,
              defaultModelProvider: serverModels[0].providerKey,
            },
          });
        }
      }
    } catch {
      // ignore — server models are optional
    }
  }
}

export const authService = new AuthService();
