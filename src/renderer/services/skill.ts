import {
  LocalizedText,
  MarketplaceFetchResult,
  MarketplaceQueryOptions,
  MarketplaceSkill,
  Skill,
  SkillHubCategoryItem,
  SkillHubPageInfo,
  SkillHubSkillItem,
  SkillMarketplaceData,
} from '../types/skill';
import { i18nService } from './i18n';

export function resolveLocalizedText(text: string | LocalizedText): string {
  if (!text) return '';
  if (typeof text === 'string') return text;
  const lang = i18nService.getLanguage();
  return text[lang] || text.en || '';
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(s => parseInt(s, 10) || 0);
  const pb = b.split('.').map(s => parseInt(s, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

type EmailConnectivityCheck = {
  code: 'imap_connection' | 'smtp_connection';
  level: 'pass' | 'fail';
  message: string;
  durationMs: number;
};

type EmailConnectivityTestResult = {
  testedAt: number;
  verdict: 'pass' | 'fail';
  checks: EmailConnectivityCheck[];
};

const deriveMarketplaceSource = (skill: SkillHubSkillItem): MarketplaceSkill['source'] => {
  const sourceUrl = skill.origin || skill.url || skill.path || '';
  let from = 'SkillHub';
  if (sourceUrl) {
    try {
      const host = new URL(sourceUrl).hostname.toLowerCase();
      if (host.includes('clawhub.ai')) {
        from = 'ClawHub';
      } else if (host.includes('github.com')) {
        from = 'GitHub';
      }
    } catch {
      from = sourceUrl.includes('/') ? 'GitHub' : 'SkillHub';
    }
  }

  return {
    from,
    url: sourceUrl,
    author: skill.author,
  };
};

/** True when the request should use Skill Hub list pagination (`fetchMarketplacePage`), not the legacy full-catalog IPC. */
export function isSkillHubPagedOrFilteredRequest(options?: MarketplaceQueryOptions): boolean {
  if (options == null) {
    return false;
  }
  if (typeof options.page === 'number' || typeof options.pageSize === 'number') {
    return true;
  }
  const keyword = options.keyword?.trim();
  if (keyword) {
    return true;
  }
  const categoryId = options.categoryId?.trim();
  if (categoryId && categoryId !== 'all') {
    return true;
  }
  return false;
}

export function mapSkillMarketplaceData(
  marketplaceData: SkillMarketplaceData
): MarketplaceFetchResult {
  const categories = Array.isArray(marketplaceData.categories) ? marketplaceData.categories : [];
  const skills = (Array.isArray(marketplaceData.skills) ? marketplaceData.skills : []).map((skill) => {
    const categoryTag = skill.categoryId != null ? String(skill.categoryId) : undefined;
    const installSource = skill.url || skill.origin || skill.path || '';
    return {
      id: String(skill.id),
      name: skill.name,
      description: skill.desp || skill.originDesp || skill.agentInstallDesp || '',
      tags: categoryTag ? [categoryTag] : [],
      url: installSource,
      version: skill.version || '',
      source: deriveMarketplaceSource(skill),
    };
  });

  const tags = categories.map((category: SkillHubCategoryItem) => ({
    id: String(category.id),
    en: category.name,
    zh: category.name,
  }));

  const pageInfo: SkillHubPageInfo = marketplaceData.pageInfo ?? {
    page: 1,
    pageSize: skills.length,
    pageCount: skills.length > 0 ? 1 : 0,
    total: skills.length,
  };

  return { skills, tags, pageInfo };
}

class SkillService {
  private skills: Skill[] = [];
  private initialized = false;
  private localSkillDescriptions: Map<string, string | LocalizedText> = new Map();
  private marketplaceSkillDescriptions: Map<string, string | LocalizedText> = new Map();
  private marketplaceCache: MarketplaceFetchResult | null = null;
  private marketplaceFetchPromise: Promise<MarketplaceFetchResult> | null = null;

  async init(): Promise<void> {
    if (this.initialized) return;
    await this.loadSkills();
    this.initialized = true;
  }

  async loadSkills(): Promise<Skill[]> {
    try {
      const result = await window.electron.skills.list();
      if (result.success && result.skills) {
        this.skills = result.skills;
      } else {
        this.skills = [];
      }
      return this.skills;
    } catch (error) {
      console.error('Failed to load skills:', error);
      this.skills = [];
      return this.skills;
    }
  }

  async setSkillEnabled(id: string, enabled: boolean): Promise<Skill[]> {
    try {
      const result = await window.electron.skills.setEnabled({ id, enabled });
      if (result.success && result.skills) {
        this.skills = result.skills;
        return this.skills;
      }
      throw new Error(result.error || 'Failed to update skill');
    } catch (error) {
      console.error('Failed to update skill:', error);
      throw error;
    }
  }

  async deleteSkill(id: string): Promise<{ success: boolean; skills?: Skill[]; error?: string }> {
    try {
      const result = await window.electron.skills.delete(id);
      if (result.success && result.skills) {
        this.skills = result.skills;
      }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete skill';
      console.error('Failed to delete skill:', error);
      return { success: false, error: message };
    }
  }

  async downloadSkill(source: string): Promise<{
    success: boolean;
    skills?: Skill[];
    error?: string;
    auditReport?: any;
    pendingInstallId?: string;
  }> {
    try {
      const result = await window.electron.skills.download(source);
      if (result.success && result.skills) {
        this.skills = result.skills;
      }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to download skill';
      console.error('Failed to download skill:', error);
      return { success: false, error: message };
    }
  }

  async confirmInstall(
    pendingId: string,
    action: string
  ): Promise<{ success: boolean; skills?: Skill[]; error?: string }> {
    try {
      const result = await window.electron.skills.confirmInstall(pendingId, action);
      if (result.success && result.skills) {
        this.skills = result.skills;
      }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to confirm install';
      console.error('Failed to confirm install:', error);
      return { success: false, error: message };
    }
  }

  async upgradeSkill(skillId: string, downloadUrl: string): Promise<{
    success: boolean;
    skills?: Skill[];
    error?: string;
    auditReport?: any;
    pendingInstallId?: string;
  }> {
    try {
      const result = await window.electron.skills.upgrade(skillId, downloadUrl);
      if (result.success && result.skills) {
        this.skills = result.skills;
      }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to upgrade skill';
      console.error('Failed to upgrade skill:', error);
      return { success: false, error: message };
    }
  }

  async getSkillsRoot(): Promise<string | null> {
    try {
      const result = await window.electron.skills.getRoot();
      if (result.success && result.path) {
        return result.path;
      }
      return null;
    } catch (error) {
      console.error('Failed to get skills root:', error);
      return null;
    }
  }

  onSkillsChanged(callback: () => void): () => void {
    return window.electron.skills.onChanged(callback);
  }

  getSkills(): Skill[] {
    return this.skills;
  }

  getEnabledSkills(): Skill[] {
    return this.skills.filter(s => s.enabled);
  }

  getSkillById(id: string): Skill | undefined {
    return this.skills.find(s => s.id === id);
  }

  async getSkillConfig(skillId: string): Promise<Record<string, string>> {
    try {
      const result = await window.electron.skills.getConfig(skillId);
      if (result.success && result.config) {
        return result.config;
      }
      return {};
    } catch (error) {
      console.error('Failed to get skill config:', error);
      return {};
    }
  }

  async setSkillConfig(skillId: string, config: Record<string, string>): Promise<boolean> {
    try {
      const result = await window.electron.skills.setConfig(skillId, config);
      return result.success;
    } catch (error) {
      console.error('Failed to set skill config:', error);
      return false;
    }
  }

  async testEmailConnectivity(
    skillId: string,
    config: Record<string, string>
  ): Promise<EmailConnectivityTestResult | null> {
    try {
      const result = await window.electron.skills.testEmailConnectivity(skillId, config);
      if (result.success && result.result) {
        return result.result;
      }
      return null;
    } catch (error) {
      console.error('Failed to test email connectivity:', error);
      return null;
    }
  }

  async getAutoRoutingPrompt(): Promise<string | null> {
    try {
      const result = await window.electron.skills.autoRoutingPrompt();
      return result.success ? (result.prompt || null) : null;
    } catch (error) {
      console.error('Failed to get auto-routing prompt:', error);
      return null;
    }
  }
  hasLocalizedSkillDescriptions(): boolean {
    return this.localSkillDescriptions.size > 0 || this.marketplaceSkillDescriptions.size > 0;
  }

  /** Clears the unscoped marketplace snapshot used by `fetchMarketplaceSkills()` with no query (e.g. after store pull-to-refresh). */
  invalidateMarketplaceCache(): void {
    this.marketplaceCache = null;
    this.marketplaceFetchPromise = null;
  }

  async fetchMarketplaceSkills(options?: MarketplaceQueryOptions): Promise<MarketplaceFetchResult> {
    const useDefaultCache = !isSkillHubPagedOrFilteredRequest(options);
    if (useDefaultCache && this.marketplaceCache) {
      return this.marketplaceCache;
    }
    if (useDefaultCache && this.marketplaceFetchPromise) {
      return this.marketplaceFetchPromise;
    }

    if (useDefaultCache) {
      this.marketplaceFetchPromise = this.loadMarketplaceSkills();
      const result = await this.marketplaceFetchPromise;
      this.marketplaceFetchPromise = null;
      return result;
    }

    return this.loadMarketplaceSkills(options);
  }

  private async loadMarketplaceSkills(options?: MarketplaceQueryOptions): Promise<MarketplaceFetchResult> {
    try {
      const result = options
        ? await window.electron.skills.fetchMarketplacePage(options)
        : await window.electron.skills.fetchMarketplace();
        console.log('result', result);
      if (!result.success || !result.data) {
        throw new Error(result.error || 'Failed to fetch');
      }
      const mapped = mapSkillMarketplaceData(result.data);

      for (const ms of mapped.skills) {
        this.marketplaceSkillDescriptions.set(ms.id, ms.description);
        this.marketplaceSkillDescriptions.set(ms.name, ms.description);
      }

      if (!isSkillHubPagedOrFilteredRequest(options)) {
        this.localSkillDescriptions.clear();
        this.marketplaceCache = mapped;
        return this.marketplaceCache;
      }
      return mapped;
    } catch (error) {
      console.error('Failed to fetch marketplace skills:', error);
      return {
        skills: [],
        tags: [],
        pageInfo: {
          page: options?.page ?? 1,
          pageSize: options?.pageSize ?? 20,
          pageCount: 0,
          total: 0,
        },
      };
    }
  }

  getLocalizedSkillDescription(skillId: string, skillName: string, fallback: string): string {
    const localDesc = this.localSkillDescriptions.get(skillName) ?? this.localSkillDescriptions.get(skillId);
    if (localDesc != null) return resolveLocalizedText(localDesc);
    const marketDesc = this.marketplaceSkillDescriptions.get(skillId);
    if (marketDesc != null) return resolveLocalizedText(marketDesc);
    return fallback;
  }
}

export const skillService = new SkillService();
