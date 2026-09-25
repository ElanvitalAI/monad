import { describe, expect, test } from 'bun:test';
import { resolvePaneBodyMouseActionPlan } from '../src/dashboard/input/mouse-surface-actions.js';

describe('resolvePaneBodyMouseActionPlan', () => {
  test('passes through log widget wheel events so tail log scroll can run', () => {
    const plan = resolvePaneBodyMouseActionPlan(
      { type: 'scroll-down', row: 10, col: 20 },
      { kind: 'widget-handled', focusPane: null, submitText: null, widgetInstanceId: 'wd-log' },
      { allowFocusSteal: true, currentFocus: 'log' },
    );
    expect(plan).toEqual({ result: 'passthrough' });
  });

  test('still consumes non-log widget wheel events', () => {
    const plan = resolvePaneBodyMouseActionPlan(
      { type: 'scroll-down', row: 10, col: 20 },
      { kind: 'widget-handled', focusPane: null, submitText: null, widgetInstanceId: 'wd-browser' },
      { allowFocusSteal: true, currentFocus: 'browser' },
    );
    expect(plan).toEqual({ result: 'consumed' });
  });

  test('still consumes log widget clicks', () => {
    const plan = resolvePaneBodyMouseActionPlan(
      { type: 'click', row: 10, col: 20 },
      { kind: 'widget-handled', focusPane: 'log', submitText: null, widgetInstanceId: 'wd-log' },
      { allowFocusSteal: true, currentFocus: 'browser' },
    );
    expect(plan).toEqual({ result: 'consumed', focusPane: 'log' });
  });
});
