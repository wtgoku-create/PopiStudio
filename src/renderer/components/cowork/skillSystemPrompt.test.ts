import { describe, expect, test } from 'vitest';

import {
  buildCoworkContinuationSystemPrompt,
  buildCoworkSystemPrompt,
} from './skillSystemPrompt';

describe('buildCoworkSystemPrompt', () => {
  test('combines skill and base system prompts for a new session', () => {
    expect(buildCoworkSystemPrompt('skill prompt', 'base prompt')).toBe('skill prompt\n\nbase prompt');
  });

  test('places low-priority prompt after skill and base prompts', () => {
    expect(
      buildCoworkSystemPrompt('skill prompt', 'base prompt', 'tail prompt'),
    ).toBe('skill prompt\n\nbase prompt\n\ntail prompt');
  });

  test('omits empty prompt parts', () => {
    expect(buildCoworkSystemPrompt('  ', 'base prompt')).toBe('base prompt');
    expect(buildCoworkSystemPrompt('skill prompt', '')).toBe('skill prompt');
    expect(buildCoworkSystemPrompt('', '', 'tail prompt')).toBe('tail prompt');
    expect(buildCoworkSystemPrompt()).toBeUndefined();
  });
});

describe('buildCoworkContinuationSystemPrompt', () => {
  test('does not override the existing session prompt when no new skill is selected', () => {
    expect(buildCoworkContinuationSystemPrompt(undefined, 'base prompt')).toBeUndefined();
    expect(buildCoworkContinuationSystemPrompt('', 'base prompt')).toBeUndefined();
  });

  test('sends a refreshed prompt when the user selects a skill for this turn', () => {
    expect(buildCoworkContinuationSystemPrompt('skill prompt', 'base prompt')).toBe('skill prompt\n\nbase prompt');
  });

  test('does not refresh the session prompt when only low-priority context changes', () => {
    expect(
      buildCoworkContinuationSystemPrompt(undefined, 'base prompt', 'tail prompt'),
    ).toBeUndefined();
  });
});
