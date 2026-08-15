import { describe, expect, test } from 'vitest';

import { isTextEditingSafeShortcut } from './shortcuts';

describe('isTextEditingSafeShortcut', () => {
  test('allows command/control shortcuts while editing', () => {
    expect(isTextEditingSafeShortcut('CommandOrControl+Shift+K')).toBe(true);
    expect(isTextEditingSafeShortcut('Ctrl+K')).toBe(true);
    expect(isTextEditingSafeShortcut('Cmd+K')).toBe(true);
  });

  test('rejects plain and alt-only shortcuts while editing', () => {
    expect(isTextEditingSafeShortcut('K')).toBe(false);
    expect(isTextEditingSafeShortcut('Alt+K')).toBe(false);
    expect(isTextEditingSafeShortcut('')).toBe(false);
  });
});
