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

/**
 * Trim, strip leading `v`, drop build metadata / parenthetical tails Hub sometimes appends.
 */
export function normalizeVersionForCompare(version: string): string {
  if (!version) return '';
  let s = version.trim().replace(/^v+/i, '');
  s = (s.split(/\s+/)[0] ?? s).replace(/\([^)]*\)/g, '').trim();
  s = (s.split('+')[0] ?? s).trim();
  return s;
}

export function compareVersions(a: string, b: string): number {
  const aNorm = normalizeVersionForCompare(a);
  const bNorm = normalizeVersionForCompare(b);
  const pa = aNorm.split('.').map(s => parseInt(s, 10) || 0);
  const pb = bNorm.split('.').map(s => parseInt(s, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

/**
 * True when the marketplace catalog version is strictly newer than the installed SKILL.md version.
 * Many skills omit `version` in frontmatter; if the install folder matches this card's zip stem, treat as
 * same package and do not show a spurious "update" (avoids comparing hub version against implicit 0.0.0).
 */
export function marketplaceHasNewerVersionThanInstalled(
  marketplaceSkill: MarketplaceSkill,
  installed: Skill,
): boolean {
  const remote = marketplaceSkill.version?.trim();
  if (!remote) return false;
  const local = installed.version?.trim();
  if (!local) {
    const stems = marketplaceZipStemBases(marketplaceSkill);
    if (stems.some((base) => installedSkillFolderMatchesBase(installed.id, base))) {
      return false;
    }
  }
  const localEff = local || '0.0.0';
  return compareVersions(remote, localEff) > 0;
}

/** Same rules as main process `normalizeFolderName` (skill install directory id). */
export function normalizeSkillFolderKey(name: string): string {
  const normalized = name.replace(/[^a-zA-Z0-9-_]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized || 'skill';
}

/** Basename of `.zip` path segment from an absolute URL, without `.zip`. */
export function zipStemFromSkillUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    const { pathname } = new URL(trimmed);
    const rawSeg = pathname.split('/').filter(Boolean).pop();
    if (!rawSeg || !/\.zip$/i.test(rawSeg)) return null;
    let seg = rawSeg;
    try {
      seg = decodeURIComponent(rawSeg);
    } catch {
      seg = rawSeg;
    }
    return seg.replace(/\.zip$/i, '');
  } catch {
    return null;
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * True if installed folder id equals `base` or collision suffix `base-1`, `base-2`, …
 * (matches skillManager.install duplicate naming).
 */
export function installedSkillFolderMatchesBase(installedId: string, base: string): boolean {
  const b = normalizeSkillFolderKey(base).toLowerCase();
  if (!b || b === 'skill') return false;
  const id = installedId.toLowerCase();
  if (id === b) return true;
  return new RegExp(`^${escapeRegExp(b)}-\\d+$`).test(id);
}

/** Zip path stems derived from marketplace skill URLs / embedded zip links in description. */
export function marketplaceZipStemBases(marketplaceSkill: MarketplaceSkill): string[] {
  const stems = new Set<string>();
  const addStemFromUrl = (u: string | undefined) => {
    const stem = zipStemFromSkillUrl(u || '');
    if (stem) stems.add(normalizeSkillFolderKey(stem));
  };

  addStemFromUrl(marketplaceSkill.url);
  addStemFromUrl(marketplaceSkill.source?.url);

  const descText =
    typeof marketplaceSkill.description === 'string'
      ? marketplaceSkill.description
      : resolveLocalizedText(marketplaceSkill.description || '');
  addStemFromUrl(extractSkillZipUrlFromInstallInstruction(descText));

  return [...stems].filter((s) => s && s !== 'skill');
}

function resolveSkillHubInstallUrl(skill: SkillHubSkillItem): string {
  const fromHuman = extractSkillZipUrlFromInstallInstruction(skill.humanInstallDesp);
  if (fromHuman) return fromHuman;

  const fromAgent = extractSkillZipUrlFromInstallInstruction(skill.agentInstallDesp);
  if (fromAgent) return fromAgent;

  const rawUrl = (skill.url || '').trim();
  if (/\.zip(\?|$)/i.test(rawUrl)) return rawUrl;

  const fromDesp =
    extractSkillZipUrlFromInstallInstruction(skill.desp)
    || extractSkillZipUrlFromInstallInstruction(skill.originDesp);
  if (fromDesp) return fromDesp;

  const fromOrigin = extractSkillZipUrlFromInstallInstruction(skill.origin || '');
  if (fromOrigin) return fromOrigin;

  const fromPath = extractSkillZipUrlFromInstallInstruction(skill.path || '');
  if (fromPath) return fromPath;

  if (rawUrl) return rawUrl;

  const originFallback = (skill.origin || '').trim();
  if (originFallback) return originFallback;

  return (skill.path || '').trim();
}

/**
 * Folder ids that might match a locally installed skill after marketplace download.
 * Hub catalog `id` is often numeric and differs from install folder name (zip stem).
 */
export function marketplaceInstallFolderCandidates(marketplaceSkill: MarketplaceSkill): string[] {
  const out = new Set<string>();
  const hubId = marketplaceSkill.id?.trim();
  if (hubId) out.add(hubId);
  for (const stemBase of marketplaceZipStemBases(marketplaceSkill)) {
    out.add(stemBase);
  }
  const nameKey = normalizeSkillFolderKey((marketplaceSkill.name || '').trim());
  if (nameKey && nameKey !== 'skill') out.add(nameKey);
  return [...out];
}

export function findInstalledSkillForMarketplace(
  marketplaceSkill: MarketplaceSkill,
  installedSkills: Skill[],
): Skill | undefined {
  const hubId = marketplaceSkill.id?.trim();
  if (hubId) {
    const byHub = installedSkills.find((s) => s.id === hubId);
    if (byHub) return byHub;
  }

  for (const base of marketplaceZipStemBases(marketplaceSkill)) {
    const hit = installedSkills.find((s) => installedSkillFolderMatchesBase(s.id, base));
    if (hit) return hit;
  }

  const nameKey = normalizeSkillFolderKey((marketplaceSkill.name || '').trim());
  if (nameKey && nameKey !== 'skill') {
    const byFolder = installedSkills.find((s) => installedSkillFolderMatchesBase(s.id, nameKey));
    if (byFolder) return byFolder;
    const byExactId = installedSkills.find((s) => s.id === nameKey);
    if (byExactId) return byExactId;
  }

  const mpNameKey = normalizeSkillFolderKey(
    resolveLocalizedText(marketplaceSkill.name || ''),
  );
  if (mpNameKey && mpNameKey !== 'skill') {
    const bySkillMdName = installedSkills.find(
      (s) => normalizeSkillFolderKey(s.name.trim()) === mpNameKey,
    );
    if (bySkillMdName) return bySkillMdName;
  }

  return undefined;
}

export function installedSkillMatchesMarketplace(installed: Skill, marketplace: MarketplaceSkill): boolean {
  return findInstalledSkillForMarketplace(marketplace, [installed])?.id === installed.id;
}

export function findMarketplaceSkillForInstalled(
  installedSkill: Skill,
  marketplaceSkills: MarketplaceSkill[],
): MarketplaceSkill | undefined {
  return marketplaceSkills.find((m) => installedSkillMatchesMarketplace(installedSkill, m));
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

/**
 * Extracts a direct http(s) `.zip` download URL from Skill Hub install copy
 * (markdown / `curl -fsSL …` lines, including stray trailing `"` characters).
 */
export function extractSkillZipUrlFromInstallInstruction(text: string | undefined | null): string {
  if (text == null || typeof text !== 'string') {
    return '';
  }
  const s = text.trim();
  if (!s) {
    return '';
  }

  const stripEdgeQuotes = (raw: string): string => raw.replace(/^["'`]+/, '').replace(/["'`]+$/, '');

  const zipUrl = s.match(/https?:\/\/[^\s"'<>]+\.zip/i);
  if (zipUrl?.[0]) {
    return stripEdgeQuotes(zipUrl[0]);
  }

  const afterCurl = s.match(/curl(?:\s+-\S+)*\s+(https?:\/\/\S+)/i);
  if (afterCurl?.[1]) {
    return stripEdgeQuotes(afterCurl[1].replace(/\s+$/, ''));
  }

  const anyHttp = s.match(/https?:\/\/[^\s"'<>]+/i);
  if (anyHttp?.[0]) {
    return stripEdgeQuotes(anyHttp[0]);
  }

  return '';
}

const deriveMarketplaceSource = (skill: SkillHubSkillItem, installSource: string): MarketplaceSkill['source'] => {

  let from = 'SkillHub';
  if (installSource) {
    try {
      const host = new URL(installSource).hostname.toLowerCase();
      if (host.includes('clawhub.ai')) {
        from = 'ClawHub';
      } else if (host.includes('github.com')) {
        from = 'GitHub';
      }
    } catch {
      from = installSource.includes('/') ? 'GitHub' : 'SkillHub';
    }
  }

  return {
    from,
    url: installSource,
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
    const installSource = resolveSkillHubInstallUrl(skill);
    return {
      id: String(skill.id),
      name: skill.name,
      description: skill.desp || skill.originDesp || skill.agentInstallDesp || '',
      tags: categoryTag ? [categoryTag] : [],
      url: installSource,
      version: skill.version || '',
      source: deriveMarketplaceSource(skill, installSource),
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
