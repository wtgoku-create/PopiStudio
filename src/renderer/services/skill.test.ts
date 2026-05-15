import { expect, test } from 'vitest';

import type { MarketplaceSkill, Skill } from '../types/skill';
import {
  compareVersions,
  extractSkillZipUrlFromInstallInstruction,
  findInstalledSkillForMarketplace,
  installedSkillFolderMatchesBase,
  installedSkillMatchesMarketplace,
  isSkillHubPagedOrFilteredRequest,
  mapSkillMarketplaceData,
  marketplaceHasNewerVersionThanInstalled,
  marketplaceInstallFolderCandidates,
  normalizeVersionForCompare,
  zipStemFromSkillUrl,
} from './skill';

test('compareVersions treats v-prefix and trailing labels as equal', () => {
  expect(compareVersions('v2.3.7', '2.3.7')).toBe(0);
  expect(compareVersions('2.3.7', '2.3.7 (stable)')).toBe(0);
  expect(compareVersions('2.3.7(stable)', '2.3.7')).toBe(0);
  expect(normalizeVersionForCompare('  v1.0.0+build42 ')).toBe('1.0.0');
});

test('marketplaceHasNewerVersionThanInstalled: no local version but zip stem matches folder → not newer', () => {
  const mp: MarketplaceSkill = {
    id: '999',
    name: 'X',
    description: '',
    url: 'https://example.com/foo-bar.zip',
    version: '2.0.0',
    source: { from: 'Hub', url: '' },
  };
  const installed: Skill = {
    id: 'foo-bar',
    name: 'Foo',
    description: '',
    enabled: true,
    isOfficial: false,
    isBuiltIn: false,
    updatedAt: 0,
    prompt: '',
    skillPath: '/SKILLs/foo-bar/SKILL.md',
  };
  expect(marketplaceHasNewerVersionThanInstalled(mp, installed)).toBe(false);
});

test('marketplaceHasNewerVersionThanInstalled: explicit versions compared', () => {
  const mp: MarketplaceSkill = {
    id: '1',
    name: 'X',
    description: '',
    url: 'https://example.com/x.zip',
    version: '2.0.0',
    source: { from: 'Hub', url: '' },
  };
  const installed: Skill = {
    id: 'x',
    name: 'X',
    description: '',
    enabled: true,
    isOfficial: false,
    isBuiltIn: false,
    updatedAt: 0,
    prompt: '',
    skillPath: '/SKILLs/x/SKILL.md',
    version: '1.0.0',
  };
  expect(marketplaceHasNewerVersionThanInstalled(mp, installed)).toBe(true);
  expect(marketplaceHasNewerVersionThanInstalled(mp, { ...installed, version: '2.0.0' })).toBe(false);
});

test('installedSkillFolderMatchesBase is case-insensitive', () => {
  expect(installedSkillFolderMatchesBase('My-Skill', 'my-skill')).toBe(true);
  expect(installedSkillFolderMatchesBase('MY-SKILL-1', 'my-skill')).toBe(true);
});

test('zipStemFromSkillUrl decodes URI-encoded path segment', () => {
  expect(
    zipStemFromSkillUrl('https://example.com/path/foo%20bar.zip'),
  ).toBe('foo bar');
});

test('extractSkillZipUrlFromInstallInstruction: curl markdown with trailing quotes', () => {
  const input =
    '### 在终端中执行以下命令，即可下载该skill。\n\n> curl -fsSL https://gittea.dev/popiskill/skills/raw/branch/master/E-commerce_tools/color-palette-cn-2.3.7/color-palette-cn-2.3.7.zip""\n';
  expect(extractSkillZipUrlFromInstallInstruction(input)).toBe(
    'https://gittea.dev/popiskill/skills/raw/branch/master/E-commerce_tools/color-palette-cn-2.3.7/color-palette-cn-2.3.7.zip',
  );
});

test('extractSkillZipUrlFromInstallInstruction: empty and non-zip', () => {
  expect(extractSkillZipUrlFromInstallInstruction(undefined)).toBe('');
  expect(extractSkillZipUrlFromInstallInstruction('')).toBe('');
  expect(extractSkillZipUrlFromInstallInstruction('   ')).toBe('');
  expect(extractSkillZipUrlFromInstallInstruction('no url here')).toBe('');
});

test('mapSkillMarketplaceData uses humanInstallDesp zip when url fields empty', () => {
  const human =
    '### 在终端中执行以下命令，即可下载该skill。\n\n> curl -fsSL https://example.com/a.zip""\n';
  const result = mapSkillMarketplaceData({
    skills: [
      {
        id: 99,
        name: 'Zip Only',
        version: '1.0.0',
        desp: 'd',
        url: '',
        origin: '',
        path: '',
        humanInstallDesp: human,
      },
    ],
    categories: [],
  });
  expect(result.skills[0].url).toBe('https://example.com/a.zip');
  expect(result.skills[0].source.url).toBe('https://example.com/a.zip');
});

test('isSkillHubPagedOrFilteredRequest: page or pageSize forces paginated API', () => {
  expect(isSkillHubPagedOrFilteredRequest(undefined)).toBe(false);
  expect(isSkillHubPagedOrFilteredRequest({})).toBe(false);
  expect(isSkillHubPagedOrFilteredRequest({ page: 1, pageSize: 24 })).toBe(true);
  expect(isSkillHubPagedOrFilteredRequest({ page: 2 })).toBe(true);
  expect(isSkillHubPagedOrFilteredRequest({ keyword: '  foo  ' })).toBe(true);
  expect(isSkillHubPagedOrFilteredRequest({ keyword: '   ' })).toBe(false);
  expect(isSkillHubPagedOrFilteredRequest({ categoryId: 'all' })).toBe(false);
  expect(isSkillHubPagedOrFilteredRequest({ categoryId: '9' })).toBe(true);
});

test('mapSkillMarketplaceData maps skill hub payload to marketplace cards', () => {
  const result = mapSkillMarketplaceData({
    skills: [
      {
        id: 1,
        name: 'Multi Search Engine',
        version: '1.0.0',
        categoryId: 9,
        desp: 'Search across multiple engines.',
        author: 'admin',
        origin: 'https://clawhub.ai/gpyAngyoujun/multi-search-engine',
        url: '',
        path: '',
      },
    ],
    categories: [
      {
        id: 9,
        name: 'Productivity',
      },
    ],
    pageInfo: {
      page: 1,
      pageSize: 20,
      pageCount: 3,
      total: 48,
    },
  });

  expect(result.tags).toEqual([
    {
      id: '9',
      en: 'Productivity',
      zh: 'Productivity',
    },
  ]);

  expect(result.skills).toEqual([
    {
      id: '1',
      name: 'Multi Search Engine',
      description: 'Search across multiple engines.',
      tags: ['9'],
      url: 'https://clawhub.ai/gpyAngyoujun/multi-search-engine',
      version: '1.0.0',
      source: {
        from: 'ClawHub',
        url: 'https://clawhub.ai/gpyAngyoujun/multi-search-engine',
        author: 'admin',
      },
    },
  ]);
  expect(result.pageInfo).toEqual({
    page: 1,
    pageSize: 20,
    pageCount: 3,
    total: 48,
  });
});

test('mapSkillMarketplaceData falls back to url when origin is missing', () => {
  const result = mapSkillMarketplaceData({
    skills: [
      {
        id: 2,
        name: 'Repo Skill',
        version: '2.0.0',
        categoryId: null,
        desp: 'Install from GitHub.',
        url: 'https://github.com/example/repo',
      },
    ],
    categories: [],
  });

  expect(result.skills[0]).toMatchObject({
    id: '2',
    tags: [],
    url: 'https://github.com/example/repo',
    source: {
      from: 'GitHub',
      url: 'https://github.com/example/repo',
    },
  });
});

test('zipStemFromSkillUrl and marketplace ↔ installed matching use zip basename', () => {
  expect(zipStemFromSkillUrl(
    'https://gittea.dev/popiskill/skills/raw/branch/master/foo/popiskill-image-multiview/popiskill-image-multiview.zip',
  )).toBe('popiskill-image-multiview');

  const mp: MarketplaceSkill = {
    id: '999',
    name: 'Human Readable Title',
    description: '',
    url: 'https://example.com/path/to/my-skill.zip',
    version: '1.0.0',
    source: { from: 'Hub', url: '' },
  };

  expect(marketplaceInstallFolderCandidates(mp)).toContain('999');
  expect(marketplaceInstallFolderCandidates(mp)).toContain('my-skill');

  const installed: Skill = {
    id: 'my-skill',
    name: 'My Skill',
    description: '',
    enabled: true,
    isOfficial: false,
    isBuiltIn: false,
    updatedAt: 0,
    prompt: '',
    skillPath: '/skills/my-skill/SKILL.md',
    version: '0.9.0',
  };

  expect(findInstalledSkillForMarketplace(mp, [installed])?.id).toBe('my-skill');
  expect(installedSkillMatchesMarketplace(installed, mp)).toBe(true);
});

test('findInstalledSkillForMarketplace matches collision suffix folder id my-skill-1', () => {
  const mp: MarketplaceSkill = {
    id: '999',
    name: 'Human Readable Title',
    description: '',
    url: 'https://example.com/path/to/my-skill.zip',
    version: '1.0.0',
    source: { from: 'Hub', url: '' },
  };
  const installed: Skill = {
    id: 'my-skill-1',
    name: 'My Skill',
    description: '',
    enabled: true,
    isOfficial: false,
    isBuiltIn: false,
    updatedAt: 0,
    prompt: '',
    skillPath: '/skills/my-skill-1/SKILL.md',
    version: '1.0.0',
  };
  expect(installedSkillFolderMatchesBase('my-skill-1', 'my-skill')).toBe(true);
  expect(findInstalledSkillForMarketplace(mp, [installed])?.id).toBe('my-skill-1');
  expect(installedSkillMatchesMarketplace(installed, mp)).toBe(true);
});

test('findInstalledSkillForMarketplace falls back to normalized display name', () => {
  const mp: MarketplaceSkill = {
    id: '1',
    name: 'Color Palette CN',
    description: '',
    url: '',
    version: '2.0.0',
    source: { from: 'Hub', url: '' },
  };
  const installed: Skill = {
    id: 'Color-Palette-CN',
    name: 'x',
    description: '',
    enabled: true,
    isOfficial: false,
    isBuiltIn: false,
    updatedAt: 0,
    prompt: '',
    skillPath: '/skills/Color-Palette-CN/SKILL.md',
  };
  expect(findInstalledSkillForMarketplace(mp, [installed])?.id).toBe('Color-Palette-CN');
});
