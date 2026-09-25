// Unit tests for the shared pane-click dispatch helper. The helper is
// reused by both the pane-focus-mode mx-mouse branch (dashboard.ts)
// and the input-mode textInput.onMouse path; these tests exercise
// the hit-test decisions, focus resolution, and widget-submit plumbing
// without booting the full dashboard.

import { describe, expect, test } from 'bun:test';
import {
  dispatchPaneClick,
  type PaneClickDispatchDeps,
} from '../src/display/pane-click-dispatch.js';
import type { DisplayMouseEvent } from '../src/display/types.js';
import type { Layout } from '../src/layout/types.js';

// A one-row two-cell layout: [browser | preview], 80 cols wide, 10
// rows tall, starting at row 5 (so mouseRow 5..14 is in-grid).
const TEST_LAYOUT: Layout = {
  rows: [
    {
      height: 'flex',
      cells: [
        { width: 'flex', widgetInstanceId: 'wd-browser' },
        { width: 'flex', widgetInstanceId: 'wd-preview' },
      ],
    },
  ],
};

function makeDeps(
  overrides: Partial<PaneClickDispatchDeps> = {},
): PaneClickDispatchDeps {
  return {
    layout: TEST_LAYOUT,
    gridZoneStart: 5,
    gridZoneHeight: 10,
    termCols: 80,
    paneFocusForWidgetInstanceId: (wid) =>
      wid === 'wd-browser' ? 'browser'
      : wid === 'wd-preview' ? 'preview'
      : null,
    invokeWidgetMouse: () => ({ kind: 'no-handler' }),
    ...overrides,
  };
}

function event(type: DisplayMouseEvent['type'], row: number, col: number): DisplayMouseEvent {
  return { type, row, col };
}

describe('dispatchPaneClick', () => {
  test('returns no-hit when layout is null', () => {
    const result = dispatchPaneClick(event('click', 10, 20), makeDeps({ layout: null }));
    expect(result).toEqual({ kind: 'no-hit' });
  });

  test('returns no-hit when gridZone is unset', () => {
    expect(dispatchPaneClick(event('click', 10, 20), makeDeps({ gridZoneStart: null }))).toEqual({ kind: 'no-hit' });
    expect(dispatchPaneClick(event('click', 10, 20), makeDeps({ gridZoneHeight: null }))).toEqual({ kind: 'no-hit' });
  });

  test('returns no-hit when the event row is above or below the grid', () => {
    expect(dispatchPaneClick(event('click', 4, 20), makeDeps())).toEqual({ kind: 'no-hit' });
    expect(dispatchPaneClick(event('click', 15, 20), makeDeps())).toEqual({ kind: 'no-hit' });
  });

  test('returns no-hit for unhandled event types (right-click, motion)', () => {
    // Bundle 1 P2 (2026-04-20) — drag / release now route through to
    // widgets (sketch-style widgets like IUL Canvas need them). Only
    // right-click and motion still bypass this dispatcher.
    for (const type of ['right-click', 'motion'] as const) {
      expect(dispatchPaneClick(event(type, 10, 20), makeDeps())).toEqual({ kind: 'no-hit' });
    }
  });

  test('drag / release route to the widget (Bundle 1 P2 IUL Canvas needs the full lifecycle)', () => {
    for (const type of ['drag', 'release'] as const) {
      const deps = makeDeps({
        invokeWidgetMouse: (_wid, t) => {
          expect(t).toBe(type);
          return { kind: 'none' };
        },
      });
      const result = dispatchPaneClick(event(type, 10, 20), deps);
      // No widget onMouse handler in default deps → focus-only with
      // null focusPane (drag / release don't shift focus).
      expect(result.kind).toBe('widget-handled');
    }
  });

  test('click on the browser cell with no widget onMouse → focus-only with the pane', () => {
    const result = dispatchPaneClick(event('click', 10, 20), makeDeps());
    expect(result).toEqual({ kind: 'focus-only', focusPane: 'browser', widgetInstanceId: 'wd-browser' });
  });

  test('click on the preview cell resolves to the preview pane', () => {
    // Preview cell starts around col 41 (80 - 1 divider, split 50/50 → left 40, right 39).
    const result = dispatchPaneClick(event('click', 10, 60), makeDeps());
    expect(result).toEqual({ kind: 'focus-only', focusPane: 'preview', widgetInstanceId: 'wd-preview' });
  });

  test('scroll events do not shift focus even when they hit a pane', () => {
    const result = dispatchPaneClick(event('scroll-up', 10, 20), makeDeps());
    // Widget has no onMouse handler, scroll doesn't focus → focus-only with null focusPane
    expect(result).toEqual({ kind: 'focus-only', focusPane: null, widgetInstanceId: 'wd-browser' });
  });

  test('widget that handles the event without returning submit → widget-handled with null submitText', () => {
    let called = 0;
    const deps = makeDeps({
      invokeWidgetMouse: (wid, type) => {
        called++;
        expect(wid).toBe('wd-browser');
        expect(type).toBe('click');
        return { kind: 'none' };
      },
    });
    const result = dispatchPaneClick(event('click', 10, 20), deps);
    expect(called).toBe(1);
    expect(result).toEqual({ kind: 'widget-handled', focusPane: 'browser', submitText: null, widgetInstanceId: 'wd-browser' });
  });

  test('widget returning a submit action → widget-handled carries submitText verbatim', () => {
    const deps = makeDeps({
      invokeWidgetMouse: () => ({ kind: 'submit', text: 'toolbelt:attach:sess-123' }),
    });
    const result = dispatchPaneClick(event('double-click', 10, 20), deps);
    expect(result).toEqual({
      kind: 'widget-handled',
      focusPane: 'browser',
      submitText: 'toolbelt:attach:sess-123',
      widgetInstanceId: 'wd-browser',
    });
  });

  test('scroll over widget that handles scroll → widget-handled, focusPane stays null', () => {
    const deps = makeDeps({
      invokeWidgetMouse: (_wid, type) => {
        expect(type).toBe('scroll-down');
        return { kind: 'none' };
      },
    });
    const result = dispatchPaneClick(event('scroll-down', 10, 20), deps);
    expect(result).toEqual({ kind: 'widget-handled', focusPane: null, submitText: null, widgetInstanceId: 'wd-browser' });
  });

  test('passes local (cell-relative) coordinates to invokeWidgetMouse', () => {
    let capturedLocalRow = -1;
    let capturedLocalCol = -1;
    const deps = makeDeps({
      invokeWidgetMouse: (_wid, _type, localRow, localCol) => {
        capturedLocalRow = localRow;
        capturedLocalCol = localCol;
        return { kind: 'none' };
      },
    });
    // Mouse at absolute row 8 (grid starts at 5 → local row 3) col 15.
    dispatchPaneClick(event('click', 8, 15), deps);
    expect(capturedLocalRow).toBe(3);
    // Col 15 is within the browser cell (which starts at col 1).
    // localCol = 15 - 1 = 14.
    expect(capturedLocalCol).toBe(14);
  });
});
