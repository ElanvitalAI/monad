import { describe, expect, test } from 'bun:test';

import {
  buildTerminalMouseIntentEvent,
  interpretTerminalSurfaceIntent,
} from '../src/dashboard/terminal-surface-intent.js';
import { interactiveTerminalExposure } from '../src/dashboard/terminal-exposure.js';

describe('terminal surface intent classifier', () => {
  test('maps terminal mouse types to richer surface semantics', () => {
    expect(interpretTerminalSurfaceIntent({ mouseType: 'click' })).toBe('caret-focus');
    expect(interpretTerminalSurfaceIntent({ mouseType: 'double-click' })).toBe('word-select');
    expect(interpretTerminalSurfaceIntent({ mouseType: 'right-click' })).toBe('context-menu');
    expect(interpretTerminalSurfaceIntent({ mouseType: 'scroll-up' })).toBe('viewport-scroll');
    expect(interpretTerminalSurfaceIntent({ mouseType: 'scroll-down' })).toBe('viewport-scroll');
    expect(interpretTerminalSurfaceIntent({ mouseType: 'drag' })).toBe('range-select-update');
    expect(interpretTerminalSurfaceIntent({ mouseType: 'release' })).toBe('range-select-end');
    expect(interpretTerminalSurfaceIntent({ mouseType: 'motion' })).toBe('hover');
  });

  test('builds terminal mouse intent events with canonical transport and posture defaults', () => {
    expect(buildTerminalMouseIntentEvent({
      surfaceId: 'pane:1',
      paneKind: 'terminal',
      mouseType: 'double-click',
      row: 3,
      col: 9,
      exposure: interactiveTerminalExposure(),
    })).toEqual({
      type: 'terminal:mouse-intent',
      surfaceId: 'pane:1',
      paneKind: 'terminal',
      mouseType: 'double-click',
      row: 3,
      col: 9,
      transport: 'host-only',
      exposure: { userExposure: 'user-interactive', agentInteractive: true },
      interactionPolicy: {
        keyboardParticipation: 'full',
        mouseTransport: 'full',
        hostMouseIntentVisible: true,
        hostInspectable: true,
        agentWriteAllowed: true,
      },
    });
  });
});
