import { expect, test } from 'vitest';

import { isSkillHubPagedOrFilteredRequest, mapSkillMarketplaceData } from './skill';

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
