import { describe, expect, test } from 'vitest';

import type { CoworkMessage } from '../types/cowork';
import { mergeCoworkTextExportMessages } from './coworkSessionExport';

const message = (
  id: string,
  content: string,
  timestamp = 100,
): CoworkMessage => ({
  id,
  type: 'assistant',
  content,
  timestamp,
});

describe('mergeCoworkTextExportMessages', () => {
  test('uses current message content over stored content for matching ids', () => {
    const merged = mergeCoworkTextExportMessages(
      [message('m1', 'stored')],
      [message('m1', 'streamed')],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0].content).toBe('streamed');
  });

  test('appends current messages that are not present in stored history', () => {
    const merged = mergeCoworkTextExportMessages(
      [message('m1', 'stored')],
      [message('m2', 'new streaming message')],
    );

    expect(merged.map(item => item.id)).toEqual(['m1', 'm2']);
  });
});
