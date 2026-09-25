import { describe, expect, test } from 'bun:test';

import type { DashboardVirtualWindows } from '../src/dashboard/windowing/virtual-windows.js';
import { routeVirtualWindowKey } from '../src/dashboard/input/virtual-window-key-router.js';
import type { Key } from '../src/tui.js';

function key(overrides?: Partial<Key>): Key {
  return { name: 'a', ctrl: false, shift: false, ...overrides };
}

function virtualWindows(opts?: {
  armed?: boolean;
  nav?: 'passthrough' | 'armed' | 'consumed' | 'cancelled';
}) {
  const events: unknown[] = [];
  const vw = {
    registry: {
      current: () => null,  // KX4b: unused — chord-only router
    },
    router: {
      isArmed: () => opts?.armed ?? false,
      handleKey: (ev: unknown) => {
        events.push(ev);
        return opts?.nav ?? 'passthrough';
      },
    },
  } as DashboardVirtualWindows;
  return { vw, events };
}

describe('routeVirtualWindowKey (KX4b — chord only)', () => {
  test('passes through when chord is not armed', () => {
    const t = virtualWindows();
    expect(routeVirtualWindowKey(key(), t.vw)).toBe('passthrough');
    expect(t.events).toEqual([]);
  });

  test('consumes navigation results when chord is armed', () => {
    for (const nav of ['armed', 'consumed', 'cancelled'] as const) {
      const t = virtualWindows({ armed: true, nav });
      expect(routeVirtualWindowKey(key({ name: 'b', ctrl: true }), t.vw)).toBe('consumed');
      expect(t.events).toHaveLength(1);
    }
  });

  test('passes through when chord router returns passthrough even if armed', () => {
    const t = virtualWindows({ armed: true, nav: 'passthrough' });
    expect(routeVirtualWindowKey(key({ name: 'x', raw: 'x' }), t.vw)).toBe('passthrough');
    expect(t.events).toHaveLength(1);
  });
});
