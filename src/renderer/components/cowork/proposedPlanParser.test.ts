import { describe, expect, test } from 'vitest';

import {
  normalizeProposedPlanMarkdown,
  parseProposedPlanBlock,
} from './proposedPlanParser';

describe('parseProposedPlanBlock', () => {
  test('extracts a complete proposed plan block', () => {
    expect(parseProposedPlanBlock('Intro\n<proposed_plan>\n- Step\n</proposed_plan>\nOutro')).toEqual({
      visibleText: 'Intro\nOutro',
      planText: '- Step',
    });
  });

  test('keeps ordinary content without a plan block', () => {
    expect(parseProposedPlanBlock('Intro')).toEqual({
      visibleText: 'Intro',
      planText: null,
    });
  });

  test('handles a streaming partial plan block', () => {
    expect(parseProposedPlanBlock('Intro\n<proposed_plan>\n- Step')).toEqual({
      visibleText: 'Intro',
      planText: '- Step',
    });
  });
});

describe('normalizeProposedPlanMarkdown', () => {
  test('normalizes inline plan section labels into headings', () => {
    expect(normalizeProposedPlanMarkdown('Summary: Build it. Validation: Run tests.')).toBe([
      '## Summary',
      '',
      'Build it.',
      '## Validation',
      '',
      'Run tests.',
    ].join('\n'));
  });
});
