import { expect, test } from 'vitest';

import {
  extractSkillZipUrlFromInstallInstruction,
  isSkillHubPagedOrFilteredRequest,
  mapSkillMarketplaceData,
} from './skill';

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
