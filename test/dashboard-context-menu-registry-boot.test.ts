import { describe, expect, test } from 'bun:test';

import { bootDashboardContextMenuRegistry } from '../src/dashboard/context-menu-registry-boot.js';

describe('bootDashboardContextMenuRegistry', () => {
  test('delegates dashboard presenter boot to the shared registry initializer', () => {
    const calls: Array<{
      termSize: { cols: number; rows: number };
      pushed: unknown;
      themeName: string;
    }> = [];

    bootDashboardContextMenuRegistry({
      termSize: () => ({ cols: 120, rows: 40 }),
      pushSurface: (surface) => {
        calls.push({
          termSize: { cols: 120, rows: 40 },
          pushed: surface,
          themeName: 'unused',
        });
      },
      redraw: () => {},
      getTheme: () => ({ name: 'amber' } as never),
      initRegistry: (deps) => {
        deps.pushSurface({ kind: 'menu' } as never);
        calls[0]!.themeName = (deps.getTheme() as { name: string }).name;
        calls[0]!.termSize = deps.termSize();
      },
    });

    expect(calls).toEqual([{
      termSize: { cols: 120, rows: 40 },
      pushed: { kind: 'menu' },
      themeName: 'amber',
    }]);
  });
});
