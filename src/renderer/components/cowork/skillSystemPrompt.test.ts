import { expect, test } from 'vitest';

import { PLAN_MODE_PROMPT_MARKER } from '../../../shared/cowork/planMode';
import { buildPlanAdjustmentSystemPrompt, buildPlanModeSystemPrompt } from './skillSystemPrompt';

test('builds a plan mode prompt that avoids tool use for non-code planning', () => {
  const prompt = buildPlanModeSystemPrompt();

  expect(prompt).toContain(PLAN_MODE_PROMPT_MARKER);
  expect(prompt).toContain('Use tools sparingly');
  expect(prompt).toContain('For content writing, scripts, outlines, concepts, prompts, copy, or other non-code planning, do not inspect the project environment');
  expect(prompt).toContain('Inspect relevant project environment and source files only when the request clearly depends on repo implementation details');
  expect(prompt).toContain('<proposed_plan>');
});

test('builds a plan adjustment prompt that still requires a replacement proposed plan', () => {
  const prompt = buildPlanAdjustmentSystemPrompt();

  expect(prompt).toContain('# Plan Adjustment');
  expect(prompt).toContain('Revise the latest plan according to the feedback');
  expect(prompt).toContain('<proposed_plan>');
});
