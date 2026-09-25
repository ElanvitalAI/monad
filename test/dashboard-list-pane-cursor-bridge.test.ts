import { describe, expect, test } from 'bun:test';

import { runListPaneCursorBridge } from '../src/dashboard/input/list-pane-cursor-bridge.js';

describe('dashboard list pane cursor bridge', () => {
  test('resets offset on home and calls cursor-changed hook when cursor moved', () => {
    const state = { cursor: 0 };
    const seen: string[] = [];
    let cursor = 3;
    const handled = runListPaneCursorBridge({
      key: { name: 'home', raw: '' } as any,
      itemCount: 5,
      currentCursor: cursor,
      widgetState: state,
      setWidgetCursor: (s, next) => { s.cursor = next; },
      getWidgetCursor: s => s.cursor,
      dispatchKey: () => {
        state.cursor = 0;
      },
      setCursor: next => {
        cursor = next;
        seen.push(`cursor:${next}`);
      },
      resetOffsetToHome: () => {
        seen.push('offset:0');
      },
      onCursorChanged: (prev, next) => {
        seen.push(`changed:${prev}->${next}`);
      },
    });
    expect(handled).toBe(true);
    expect(cursor).toBe(0);
    expect(seen).toEqual(['cursor:0', 'offset:0', 'changed:3->0']);
  });
});
