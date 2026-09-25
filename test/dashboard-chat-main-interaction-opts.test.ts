import { describe, expect, test } from 'bun:test';

import { createDashboardChatMainInteractionOpts } from '../src/dashboard/input/chat-main-interaction-opts.js';

describe('dashboard chat-main interaction opts', () => {
  test('onMouse still dispatches shared host routing when chat-main is not the active input owner', () => {
    const seen: string[] = [];
    const opts = createDashboardChatMainInteractionOpts({
      cursorSink: {} as never,
      canClaimCursor: () => false,
      modalSink: {} as never,
      onPasteImage: async () => {},
      routeInputKey: async () => 'passthrough',
      hasActiveStatusPopup: () => false,
      hasTerminalModal: () => false,
      toKeyEvent: key => ({ name: key.name, sequence: key.raw }),
      routeStatusPopupKey: () => 'passthrough',
      handleTerminalModalKey: () => 'passthrough',
      tryRouteForegroundModalKey: async () => 'passthrough',
      redraw: () => {},
      dispatchMouse: mouse => {
        seen.push(`${mouse.type}:${mouse.row}:${mouse.col}`);
      },
    });

    const repaint = opts.onMouse?.({ type: 'click', row: 5, col: 8 });

    expect(seen).toEqual(['click:5:8']);
    expect(repaint).toBe(false);
  });

  test('onMouse dispatches when chat-main still owns input', () => {
    const seen: string[] = [];
    const opts = createDashboardChatMainInteractionOpts({
      cursorSink: {} as never,
      canClaimCursor: () => true,
      modalSink: {} as never,
      onPasteImage: async () => {},
      routeInputKey: async () => 'passthrough',
      hasActiveStatusPopup: () => false,
      hasTerminalModal: () => false,
      toKeyEvent: key => ({ name: key.name, sequence: key.raw }),
      routeStatusPopupKey: () => 'passthrough',
      handleTerminalModalKey: () => 'passthrough',
      tryRouteForegroundModalKey: async () => 'passthrough',
      redraw: () => {},
      dispatchMouse: mouse => {
        seen.push(`${mouse.type}:${mouse.row}:${mouse.col}`);
      },
    });

    const repaint = opts.onMouse?.({ type: 'click', row: 5, col: 8 });

    expect(seen).toEqual(['click:5:8']);
    expect(repaint).toBeUndefined();
  });
});
