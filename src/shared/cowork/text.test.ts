import { expect, test } from 'vitest';

import { stripNullChars } from './text';

test('stripNullChars removes embedded null bytes only', () => {
  expect(stripNullChars('a\u0000b\u0000c')).toBe('abc');
  expect(stripNullChars('line\nnext')).toBe('line\nnext');
});
