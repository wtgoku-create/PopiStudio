import { expect, test } from 'vitest';

import {
  buildCronRunHistoryEntries,
  buildCronRunHistoryMetadata,
  buildCronRunLocalHistoryEntries,
  findCronRunHistoryLocalMatch,
  isCronRunPromptContentCoveredByMessage,
  mergeCronRunHistoryMetadata,
} from './openclawCronRunHistorySync';

test('cron prompt coverage accepts authoritative history with runtime context', () => {
  const prompt = '[cron:job-1 Daily check] 获取今天的时间';
  const authoritative = [
    prompt,
    'Current time: Thursday, July 30, 2026 - 16:16 (Asia/Shanghai)',
    'Reference UTC: 2026-07-30 08:16 UTC',
  ].join('\n');

  expect(isCronRunPromptContentCoveredByMessage(authoritative, prompt)).toBe(true);
});

test('cron prompt coverage rejects different cron prompts', () => {
  expect(
    isCronRunPromptContentCoveredByMessage(
      '[cron:job-2 Daily check] 获取今天的时间',
      '[cron:job-1 Daily check] 获取今天的时间',
    ),
  ).toBe(false);
});

test('cron run history reuses a local prompt placeholder without text matching', () => {
  const [authoritative] = buildCronRunHistoryEntries([
    {
      role: 'user',
      content: [
        '[cron:job-1 Daily check] 获取今天的时间',
        'Current time: Thursday, July 30, 2026 - 16:16 PM (Asia/Shanghai)',
        'Reference UTC: 2026-07-30 08:16 UTC',
      ].join('\n'),
    },
  ], 'agent:main:cron:job-1:run:gateway-run-id');
  const [local] = buildCronRunLocalHistoryEntries([
    {
      id: 'placeholder-prompt',
      type: 'user',
      content: [
        '[cron:job-1 Daily check] 获取今天的时间',
        'Current time: Thursday, July 30, 2026 - 16:16 (Asia/Shanghai)',
        'Reference UTC: 2026-07-30 08:16 UTC',
      ].join('\n'),
      timestamp: 1,
      metadata: buildCronRunHistoryMetadata('agent:main:cron:job-1:run:local-run-id', 0, {
        openclawCronPromptPlaceholder: true,
      }),
    } as never,
  ]);

  const match = findCronRunHistoryLocalMatch(
    authoritative,
    [local],
    new Set(),
    'agent:main:cron:job-1:run:gateway-run-id',
  );

  expect(match?.id).toBe('placeholder-prompt');
});

test('cron run history metadata clears the local prompt placeholder flag after merge', () => {
  const metadata = mergeCronRunHistoryMetadata(
    buildCronRunHistoryMetadata('agent:main:cron:job-1:run:local-run-id', 0, {
      openclawCronPromptPlaceholder: true,
    }),
    buildCronRunHistoryMetadata('agent:main:cron:job-1:run:gateway-run-id', 0),
  );

  expect(metadata).toMatchObject({
    openclawCronRunSessionKey: 'agent:main:cron:job-1:run:gateway-run-id',
    openclawCronRunEntryIndex: 0,
  });
  expect(metadata).not.toHaveProperty('openclawCronPromptPlaceholder');
});
