import { describe, expect, test } from 'bun:test';

import { createChatMainInputSession } from '../src/dashboard/input/chat-main-session.js';
import type { PromptFrame } from '../src/display/prompt-frame.js';

describe('createChatMainInputSession', () => {
  test('uses the full input column width so picker overlays align with prompt dividers', () => {
    const frame: PromptFrame = {
      inputHeight: 3,
      promptTopRow: 10,
      promptBottomRow: 12,
      topDividerRow: 9,
      bottomDividerRow: 13,
    };
    const session = createChatMainInputSession({
      promptFrame: frame,
      inputCols: 80,
      surfaceRegistry: {
        register: () => {},
        unregister: () => {},
      } as never,
      invalidateRenderCacheRow: () => {},
      buildPromptFrameDividerRows: () => [],
      shouldPaint: () => true,
    });
    expect(session.inputWidth).toBe(80);
  });

  test('reads the current prompt frame for chrome and input row after resize', () => {
    let frame: PromptFrame = {
      inputHeight: 1,
      promptTopRow: 33,
      promptBottomRow: 33,
      topDividerRow: 32,
      bottomDividerRow: 34,
    };
    const dividerFrames: PromptFrame[] = [];
    const session = createChatMainInputSession({
      promptFrame: frame,
      getPromptFrame: () => frame,
      inputCols: 80,
      surfaceRegistry: { register: () => {}, unregister: () => {} } as never,
      invalidateRenderCacheRow: () => {},
      buildPromptFrameDividerRows: (nextFrame) => {
        dividerFrames.push(nextFrame);
        return [];
      },
      shouldPaint: () => true,
    });

    frame = {
      inputHeight: 1,
      promptTopRow: 21,
      promptBottomRow: 21,
      topDividerRow: 20,
      bottomDividerRow: 22,
    };
    session.paintChrome();

    expect(session.inputRow).toBe(33);
    expect(session.getInputRow()).toBe(21);
    expect(dividerFrames).toEqual([frame]);
  });
});
