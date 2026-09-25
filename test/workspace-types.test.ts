// ── workspace-types smoke tests ──
// The type module is mostly declarations — only `nextSortMode` has
// behaviour worth testing. Keeps the test file pinned so the sort
// cycle order can't drift without review.

import { describe, test, expect } from 'bun:test';
import { nextSortMode, FILE_SORT_ORDER } from '../src/workspace-types.js';

describe('nextSortMode', () => {
  test('cycles through the declared order', () => {
    expect(nextSortMode('name')).toBe('mtime');
    expect(nextSortMode('mtime')).toBe('type');
    expect(nextSortMode('type')).toBe('size');
    expect(nextSortMode('size')).toBe('name');
  });

  test('FILE_SORT_ORDER covers every mode exactly once', () => {
    expect(FILE_SORT_ORDER).toEqual(['name', 'mtime', 'type', 'size']);
    expect(new Set(FILE_SORT_ORDER).size).toBe(FILE_SORT_ORDER.length);
  });
});
