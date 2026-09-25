import { describe, expect, test } from 'bun:test';

import { createMousePaneHitRuntime } from '../src/dashboard/input/mouse-pane-hit-runtime.js';

describe('createMousePaneHitRuntime', () => {
  test('classifies pane-nav row hits and falls back to focused pane', () => {
    const runtime = createMousePaneHitRuntime({
      getPaneNavRow: () => 3,
      paneAtColumn: () => null,
      getCurrentFocusPaneId: () => 'browser',
      getGridMetrics: () => ({
        hasLayout: false,
        gridZoneStart: null,
        gridZoneHeight: null,
        termCols: 120,
      }),
      hitTestLayoutCell: () => null,
      describeHitFor: () => null,
    });

    expect(runtime.getPaneRegionKind?.(3, 10)).toBe('pane-nav');
    expect(runtime.getPaneHitTarget?.(3, 10)).toEqual({
      kind: 'pane-nav-tab',
      paneId: 'browser',
    });
  });

  test('classifies title vs body rows from layout hit', () => {
    const runtime = createMousePaneHitRuntime({
      getPaneNavRow: () => null,
      paneAtColumn: () => null,
      getCurrentFocusPaneId: () => 'browser',
      getGridMetrics: () => ({
        hasLayout: true,
        gridZoneStart: 5,
        gridZoneHeight: 10,
        termCols: 120,
      }),
      hitTestLayoutCell: (row) =>
        row === 5
          ? { widgetInstanceId: 'preview', localRow: 0, localCol: 2 }
          : { widgetInstanceId: 'preview', localRow: 2, localCol: 4 },
      describeHitFor: () => null,
    });

    expect(runtime.getPaneRegionKind?.(5, 8)).toBe('pane-title');
    expect(runtime.getPaneRegionKind?.(7, 8)).toBe('pane-body');
    expect(runtime.getPaneHitTarget?.(5, 8)).toEqual({
      kind: 'pane-title',
      paneId: 'preview',
      widgetInstanceId: 'preview',
    });
  });

  test('composes pane-body refinement from widget describeHit', () => {
    const runtime = createMousePaneHitRuntime({
      getPaneNavRow: () => null,
      paneAtColumn: () => null,
      getCurrentFocusPaneId: () => 'browser',
      getGridMetrics: () => ({
        hasLayout: true,
        gridZoneStart: 5,
        gridZoneHeight: 10,
        termCols: 120,
      }),
      hitTestLayoutCell: () => ({
        widgetInstanceId: 'log',
        localRow: 4,
        localCol: 6,
      }),
      describeHitFor: () => ({ kind: 'conversation-message', sessionId: 's1', turnId: 't1', role: 'user' }),
    });

    expect(runtime.getPaneHitTarget?.(8, 12)).toEqual({
      kind: 'pane-body',
      paneId: 'log',
      widgetInstanceId: 'log',
      bodyRow: 4,
      bodyCol: 6,
      hit: { kind: 'conversation-message', sessionId: 's1', turnId: 't1', role: 'user' },
    });
  });
});
