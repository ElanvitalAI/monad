import { describe, expect, test } from 'bun:test';

import {
  isDashboardCursorScrollKey,
  runWidgetCursorBridge,
} from '../src/dashboard/input/widget-cursor-bridge.js';

describe('dashboard widget cursor bridge', () => {
  test('recognizes dashboard cursor scroll keys', () => {
    expect(isDashboardCursorScrollKey({ name: 'j', raw: 'j' } as any)).toBe(true);
    expect(isDashboardCursorScrollKey({ name: 'enter', raw: '\r' } as any)).toBe(false);
  });

  test('bridges dashboard cursor through widget state and back', () => {
    const state = { cursor: 0 };
    const seen: string[] = [];
    const handled = runWidgetCursorBridge(
      { name: 'down', raw: '\u001b[B' } as any,
      {
        itemCount: 3,
        currentCursor: 1,
        widgetState: state,
        setWidgetCursor: (s, cursor) => { s.cursor = cursor; seen.push(`set:${cursor}`); },
        getWidgetCursor: s => s.cursor,
        dispatchKey: () => { state.cursor = 2; seen.push('dispatch'); },
        applyNextCursor: next => { seen.push(`apply:${next}`); },
      },
    );
    expect(handled).toBe(true);
    expect(seen).toEqual(['set:1', 'dispatch', 'apply:2']);
  });
});
