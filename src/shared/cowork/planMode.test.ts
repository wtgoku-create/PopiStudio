import { expect, test } from 'vitest';

import {
  PLAN_MODE_PROMPT_MARKER,
  containsPlanModePrompt,
  isPlanImplementationApproval,
} from './planMode';

test('detects plan implementation approval phrases', () => {
  expect(isPlanImplementationApproval('按照计划实现吧')).toBe(true);
  expect(isPlanImplementationApproval('计划没问题，直接开始开发')).toBe(true);
  expect(isPlanImplementationApproval('Go ahead and implement the plan')).toBe(true);
  expect(isPlanImplementationApproval('Implement it')).toBe(true);
});

test('does not treat planning questions as implementation approval', () => {
  expect(isPlanImplementationApproval('这个计划如何实现？')).toBe(false);
  expect(isPlanImplementationApproval('继续完善计划')).toBe(false);
  expect(isPlanImplementationApproval('解释一下计划')).toBe(false);
});

test('detects the plan mode prompt marker', () => {
  expect(containsPlanModePrompt(`${PLAN_MODE_PROMPT_MARKER}\nRules`)).toBe(true);
  expect(containsPlanModePrompt('# Plan Mode Execution Override')).toBe(false);
  expect(containsPlanModePrompt('# Default Mode')).toBe(false);
});
