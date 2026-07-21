import { describe, expect, test } from 'vitest';

import {
  getPreservedMessageWindow,
  shouldReloadCurrentSessionForChange,
} from './coworkSessionRefreshPolicy';

describe('shouldReloadCurrentSessionForChange', () => {
  test('reloads legacy or broad session change events', () => {
    expect(shouldReloadCurrentSessionForChange('current')).toBe(true);
    expect(shouldReloadCurrentSessionForChange('current', { sessionIds: [] })).toBe(true);
  });

  test('reloads only when the current session is included', () => {
    expect(shouldReloadCurrentSessionForChange('current', { sessionIds: ['other'] })).toBe(false);
    expect(shouldReloadCurrentSessionForChange('current', { sessionIds: ['other', 'current'] })).toBe(true);
  });

  test('does not reload when there is no current session', () => {
    expect(shouldReloadCurrentSessionForChange(null, { sessionIds: ['current'] })).toBe(false);
  });
});

describe('getPreservedMessageWindow', () => {
  test('keeps the older loaded offset when refreshed page is only the tail', () => {
    expect(getPreservedMessageWindow(20, 70, 100)).toEqual({
      offset: 20,
      limit: 80,
    });
  });

  test('skips preservation when current window is not older than refreshed tail', () => {
    expect(getPreservedMessageWindow(70, 70, 100)).toBeNull();
    expect(getPreservedMessageWindow(80, 70, 100)).toBeNull();
  });

  test('normalizes invalid boundaries before computing the window', () => {
    expect(getPreservedMessageWindow(3.8, 9.2, 12.9)).toEqual({
      offset: 3,
      limit: 9,
    });
    expect(getPreservedMessageWindow(-5, 10, 20)).toEqual({
      offset: 0,
      limit: 20,
    });
  });
});
