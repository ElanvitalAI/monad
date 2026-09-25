import { describe, expect, test } from 'bun:test';

import { DashboardStateStore } from '../src/dashboard/runtime/state-store.js';

describe('DashboardStateStore', () => {
  test('tracks input lines and reports changes', () => {
    const store = new DashboardStateStore();

    expect(store.getInputLines()).toBe(1);
    expect(store.setInputLines(1)).toBe(false);
    expect(store.setInputLines(3)).toBe(true);
    expect(store.getInputLines()).toBe(3);

    store.resetInputLines();
    expect(store.getInputLines()).toBe(1);
  });

  test('reuses composed prompt frame when the height still matches', () => {
    const store = new DashboardStateStore();
    const frame = {
      inputHeight: 1,
      promptTopRow: 20,
      promptBottomRow: 20,
      topDividerRow: 19,
      bottomDividerRow: 21,
    };

    store.setComposedPromptFrame(30, frame);
    expect(store.getLayoutPromptFrame(30)).toEqual(frame);
  });

  test('rebuilds current prompt frame from the cached bottom row and live input lines', () => {
    const store = new DashboardStateStore();
    store.setComposedPromptFrame(30, {
      inputHeight: 1,
      promptTopRow: 20,
      promptBottomRow: 20,
      topDividerRow: 19,
      bottomDividerRow: 21,
    });
    store.setInputLines(3);

    expect(store.getCurrentPromptFrame(30)).toEqual({
      inputHeight: 3,
      promptTopRow: 18,
      promptBottomRow: 20,
      topDividerRow: 17,
      bottomDividerRow: 21,
    });
  });
});
