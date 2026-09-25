import { describe, expect, test } from 'bun:test';

import {
  resolveLogZoneMouseActionPlan,
  resolvePaneBodyMouseActionPlan,
  resolvePaneNavMouseActionPlan,
  runDashboardMouseSurfaceActionPlan,
} from '../src/dashboard/input/mouse-surface-actions.js';

describe('dashboard mouse surface actions', () => {
  test('pane-nav click resolves to a focus action', () => {
    expect(resolvePaneNavMouseActionPlan(
      { row: 3, col: 9, type: 'click' },
      {
        paneNavRow: 3,
        paneAtColumn: () => 'preview',
      },
    )).toEqual({ result: 'consumed', focusPane: 'preview' });
  });

  test('pane-body widget submit keeps consume semantics and carries submit text', () => {
    expect(resolvePaneBodyMouseActionPlan(
      { row: 10, col: 2, type: 'click' },
      { kind: 'widget-handled', focusPane: 'browser', submitText: 'file-attach:/tmp/demo.txt' },
      {
        allowFocusSteal: true,
        currentFocus: 'log',
      },
    )).toEqual({
      result: 'consumed',
      focusPane: 'browser',
      submitText: 'file-attach:/tmp/demo.txt',
    });
  });

  test('input-style pane-body route suppresses focus steal but still consumes widget submit', () => {
    expect(resolvePaneBodyMouseActionPlan(
      { row: 10, col: 2, type: 'click' },
      { kind: 'widget-handled', focusPane: 'browser', submitText: 'session:abc' },
      {
        allowFocusSteal: false,
        currentFocus: 'input',
      },
    )).toEqual({
      result: 'consumed',
      submitText: 'session:abc',
    });
  });

  test('log-zone consume can optionally focus log', () => {
    expect(resolveLogZoneMouseActionPlan(
      { row: 12, col: 4, type: 'click' },
      'consumed',
      {
        allowFocusSteal: true,
        currentFocus: 'browser',
      },
    )).toEqual({ result: 'consumed', focusPane: 'log' });
  });

  test('runner applies focus and submit side effects in one place', () => {
    const calls: string[] = [];
    const result = runDashboardMouseSurfaceActionPlan(
      { result: 'consumed', focusPane: 'preview', submitText: 'file-attach:/tmp/demo.txt' },
      {
        setWorkingFocus: (pane, reason) => calls.push(`focus:${pane}:${reason}`),
        focusReason: 'mouse-test',
        dispatchSubmitText: (text) => calls.push(`submit:${text}`),
      },
    );
    expect(result).toBe('consumed');
    expect(calls).toEqual([
      'focus:preview:mouse-test',
      'submit:file-attach:/tmp/demo.txt',
    ]);
  });
});
