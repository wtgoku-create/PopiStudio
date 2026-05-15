// Skill type definition
export interface Skill {
  id: string;
  name: string;
  description: string;
  enabled: boolean;       // Whether visible in popover
  isOfficial: boolean;    // "官方" badge
  isBuiltIn: boolean;     // Bundled with app, cannot be deleted
  updatedAt: number;      // Timestamp
  prompt: string;         // System prompt content
  skillPath: string;      // Absolute path to SKILL.md
  version?: string;       // Skill version from SKILL.md frontmatter
}

export type LocalizedText = { en: string; zh: string };

export interface MarketTag {
  id: string;
  en: string;
  zh: string;
}

export interface LocalSkillInfo {
  id: string;
  name: string;
  description: string | LocalizedText;
  version: string;
}

export interface MarketplaceSkill {
  id: string;
  name: string;
  description: string | LocalizedText;
  tags?: string[];
  url: string;              // Download URL (.zip)
  version: string;
  source: {
    from: string;           // e.g. "Github"
    url: string;            // Source repo URL
    author?: string;        // Author name
  };
}

export interface SkillHubSkillItem {
  id: number;
  name: string;
  version: string;
  categoryId?: number | null;
  tagId?: number | null;
  desp: string;
  author?: string;
  origin?: string;
  originDesp?: string;
  downloadNum?: number;
  likeNum?: number;
  installNum?: number;
  url?: string;
  path?: string;
  agentInstallDesp?: string;
  humanInstallDesp?: string;
  createTime?: string;
  updateTime?: string;
  userLiked?: boolean;
}

export interface SkillHubCategoryItem {
  id: number;
  name: string;
  icon?: string;
  color?: string;
  desp?: string;
  sort?: number;
}

export interface SkillMarketplaceData {
  skills: SkillHubSkillItem[];
  categories: SkillHubCategoryItem[];
  pageInfo?: SkillHubPageInfo;
}

export interface SkillHubPageInfo {
  page: number;
  pageSize: number;
  pageCount: number;
  total: number;
}

export interface MarketplaceQueryOptions {
  page?: number;
  pageSize?: number;
  categoryId?: string;
  keyword?: string;
}

export interface MarketplaceFetchResult {
  skills: MarketplaceSkill[];
  tags: MarketTag[];
  pageInfo: SkillHubPageInfo;
}
