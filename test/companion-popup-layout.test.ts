import { describe, expect, test } from 'bun:test';

import { computeCompanionPopupBounds } from '../src/window/companion-popup-layout.js';

describe('computeCompanionPopupBounds', () => {
  test('narrow terminals pin companion popups to the right edge and stack downward', () => {
    const first = computeCompanionPopupBounds({ termCols: 100, termRows: 28, slotIndex: 0 });
    const second = computeCompanionPopupBounds({ termCols: 100, termRows: 28, slotIndex: 1 });

    expect(first.col).toBe(second.col);
    expect(second.row).toBeGreaterThan(first.row);
    expect(first.width).toBeLessThanOrEqual(94);
  });

  test('wide terminals cascade companion popups diagonally', () => {
    const first = computeCompanionPopupBounds({ termCols: 180, termRows: 44, slotIndex: 0 });
    const second = computeCompanionPopupBounds({ termCols: 180, termRows: 44, slotIndex: 1 });

    expect(second.row).toBeGreaterThan(first.row);
    expect(second.col).toBeLessThan(first.col);
    expect(first.width).toBeLessThanOrEqual(72);
  });

  test('bounds stay inside the terminal', () => {
    const bounds = computeCompanionPopupBounds({ termCols: 88, termRows: 16, slotIndex: 3 });

    expect(bounds.row).toBeGreaterThanOrEqual(1);
    expect(bounds.col).toBeGreaterThanOrEqual(1);
    expect(bounds.row + bounds.height - 1).toBeLessThanOrEqual(16);
    expect(bounds.col + bounds.width - 1).toBeLessThanOrEqual(88);
  });
});
