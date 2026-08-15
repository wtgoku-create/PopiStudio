import { expect, test } from 'vitest';

import {
  getConversationSearchCenterDelta,
  isUsableConversationSearchRect,
  shouldCorrectConversationSearchPosition,
} from './conversationSearchNavigation';

test('calculates the delta needed to center a search target', () => {
  expect(getConversationSearchCenterDelta({ top: 100 }, 600, { top: 500, height: 40 })).toBe(120);
});

test('rejects unusable target geometry', () => {
  expect(isUsableConversationSearchRect({ top: 10, width: 0, height: 20 })).toBe(false);
  expect(isUsableConversationSearchRect({ top: 10, width: 10, height: 20 })).toBe(true);
});

test('uses a tolerance to avoid search scroll jitter', () => {
  expect(shouldCorrectConversationSearchPosition(8)).toBe(false);
  expect(shouldCorrectConversationSearchPosition(9)).toBe(true);
});
