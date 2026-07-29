import { describe, expect, test } from 'vitest';

import {
  canScrollElementInWheelDirection,
  CONVERSATION_AUTO_SCROLL_REATTACH_THRESHOLD,
  CONVERSATION_AUTO_SCROLL_THRESHOLD,
  CONVERSATION_SCROLL_TO_BOTTOM_BUTTON_THRESHOLD,
  isWheelScrollingAwayFromBottom,
  shouldAutoScrollForPosition,
  shouldShowScrollToBottomButton,
} from './conversationScrollPolicy';

describe('conversationScrollPolicy', () => {
  test('keeps near-bottom auto-scroll while attached', () => {
    expect(shouldAutoScrollForPosition(CONVERSATION_AUTO_SCROLL_THRESHOLD, false)).toBe(true);
    expect(shouldAutoScrollForPosition(CONVERSATION_AUTO_SCROLL_THRESHOLD + 1, false)).toBe(false);
  });

  test('requires actual bottom after user detaches from auto-scroll', () => {
    expect(shouldAutoScrollForPosition(CONVERSATION_AUTO_SCROLL_REATTACH_THRESHOLD, true)).toBe(true);
    expect(shouldAutoScrollForPosition(CONVERSATION_AUTO_SCROLL_REATTACH_THRESHOLD + 1, true)).toBe(false);
  });

  test('only shows the scroll-to-bottom button after moving meaningfully away from bottom', () => {
    expect(shouldShowScrollToBottomButton(CONVERSATION_SCROLL_TO_BOTTOM_BUTTON_THRESHOLD)).toBe(false);
    expect(shouldShowScrollToBottomButton(CONVERSATION_SCROLL_TO_BOTTOM_BUTTON_THRESHOLD + 1)).toBe(true);
  });

  test('detects wheel gestures away from bottom', () => {
    expect(isWheelScrollingAwayFromBottom(-1)).toBe(true);
    expect(isWheelScrollingAwayFromBottom(1)).toBe(false);
    expect(isWheelScrollingAwayFromBottom(0)).toBe(false);
  });

  test('detects whether nested scroll containers can consume wheel input', () => {
    expect(canScrollElementInWheelDirection(10, 100, 50, -1)).toBe(true);
    expect(canScrollElementInWheelDirection(0, 100, 50, -1)).toBe(false);
    expect(canScrollElementInWheelDirection(10, 100, 50, 1)).toBe(true);
    expect(canScrollElementInWheelDirection(50, 100, 50, 1)).toBe(false);
    expect(canScrollElementInWheelDirection(0, 50, 50, 1)).toBe(false);
  });
});
