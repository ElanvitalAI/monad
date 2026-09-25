import { describe, expect, test } from 'bun:test';

import { createDashboardDebugEventRuntime } from '../src/dashboard/debug-event-runtime.js';

describe('createDashboardDebugEventRuntime', () => {
  test('resets cursor when not manual and clamps when manual', () => {
    const runtime = createDashboardDebugEventRuntime();
    const oldest = [
      { ts: '1', category: 'a', event: 'A' },
      { ts: '2', category: 'b', event: 'B' },
    ] as any;

    expect(runtime.snapshot(oldest, 9, false)).toEqual({
      oldest,
      newest: [oldest[1], oldest[0]],
      cursor: 0,
      selected: oldest[1],
    });

    expect(runtime.snapshot(oldest, 9, true)).toEqual({
      oldest,
      newest: [oldest[1], oldest[0]],
      cursor: 1,
      selected: oldest[0],
    });
  });
});
