import { describe, expect, test } from 'bun:test';

import type { PromptFrame } from '../src/display/prompt-frame.js';
import {
  computePromptFrameGridHeight,
  computePromptFrameLogViewportBounds,
  computePromptFrameLogEndRow,
  computePromptFrameLogViewportHeight,
} from '../src/display/prompt-frame-layout.js';

describe('prompt-frame layout helpers', () => {
  const frame: PromptFrame = {
    inputHeight: 3,
    promptTopRow: 10,
    promptBottomRow: 12,
    topDividerRow: 9,
    bottomDividerRow: 13,
  };

  test('computes grid height above hud and fixed bottom rows', () => {
    expect(computePromptFrameGridHeight(30, frame)).toBe(19);
  });

  test('computes the last row owned by the log viewport', () => {
    expect(computePromptFrameLogEndRow(30, frame)).toBe(27);
  });

  test('computes log viewport height from pane height and prompt frame', () => {
    expect(computePromptFrameLogViewportHeight(30, 12, frame)).toBe(14);
  });

  test('clamps log viewport height to the minimum size', () => {
    expect(computePromptFrameLogViewportHeight(8, 6, frame)).toBe(3);
  });

  test('builds log viewport bounds from pane height and prompt frame', () => {
    expect(computePromptFrameLogViewportBounds(30, 12, frame)).toEqual({
      startRow: 13,
      endRow: 27,
      height: 14,
    });
  });
});
