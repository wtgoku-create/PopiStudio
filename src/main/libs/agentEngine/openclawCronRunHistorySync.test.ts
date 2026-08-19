import { expect, test } from 'vitest';

import { isCronRunPromptContentCoveredByMessage } from './openclawCronRunHistorySync';

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
