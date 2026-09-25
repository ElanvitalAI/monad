import { describe, expect, test } from 'bun:test';

import type { PromptFrame } from '../src/display/prompt-frame.js';
import {
  buildPromptFrameDividerRows,
  buildPromptFramePlaceholderRows,
} from '../src/display/prompt-frame-paint.js';

describe('prompt-frame paint', () => {
  const frame: PromptFrame = {
    inputHeight: 3,
    promptTopRow: 10,
    promptBottomRow: 12,
    topDividerRow: 9,
    bottomDividerRow: 13,
  };

  test('builds placeholder rows with prompt only on the bottom row', () => {
    expect(buildPromptFramePlaceholderRows(frame, '> ')).toEqual(['', '', '> ']);
  });

  test('respects composer-assigned placeholder height when truncated', () => {
    expect(buildPromptFramePlaceholderRows(frame, '> ', 2)).toEqual(['', '> ']);
  });

  test('builds divider rows for both prompt-frame borders', () => {
    expect(buildPromptFrameDividerRows(frame, '---')).toEqual([
      { row: 9, text: '---' },
      { row: 13, text: '---' },
    ]);
  });

  test('omits divider rows that are outside the visible terminal range', () => {
    expect(buildPromptFrameDividerRows({
      ...frame,
      topDividerRow: 0,
      bottomDividerRow: -1,
    }, '---')).toEqual([]);
  });
});
