import { describe, expect, test } from 'bun:test';

import { createDisplayEventBus } from '../src/display/events.js';
import { describeTerminalPosture, interactiveTerminalExposure } from '../src/dashboard/terminal-exposure.js';

describe('display event bus', () => {
  test('terminal:mouse-intent events publish to subscribers', () => {
    const bus = createDisplayEventBus();
    const seen: Array<unknown> = [];
    bus.subscribe('terminal:mouse-intent', (event) => seen.push(event));

    bus.emit({
      type: 'terminal:mouse-intent',
      surfaceId: 'wd-preview',
      paneKind: 'preview-terminal',
      mouseType: 'double-click',
      row: 12,
      col: 34,
      transport: 'host-only',
      ...describeTerminalPosture(interactiveTerminalExposure()),
    });

    expect(seen).toEqual([{
      type: 'terminal:mouse-intent',
      surfaceId: 'wd-preview',
      paneKind: 'preview-terminal',
      mouseType: 'double-click',
      row: 12,
      col: 34,
      transport: 'host-only',
      ...describeTerminalPosture(interactiveTerminalExposure()),
    }]);
  });
});
