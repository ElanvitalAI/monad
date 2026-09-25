import { describe, expect, test } from 'bun:test';

import {
  isScrollPaneKey,
  runScrollPaneBridge,
} from '../src/dashboard/input/scroll-pane-bridge.js';

describe('dashboard scroll pane bridge', () => {
  test('recognizes page and ctrl-half-page keys', () => {
    expect(isScrollPaneKey({ name: 'pageup', raw: '' } as any)).toBe(true);
    expect(isScrollPaneKey({ name: 'd', ctrl: true, raw: '' } as any, { acceptsHalfPageCtrl: true })).toBe(true);
    expect(isScrollPaneKey({ name: 'enter', raw: '' } as any)).toBe(false);
  });

  test('bridges dashboard scroll state through widget scroll state', () => {
    const state = { scroll: 0, maxScroll: 0, pageSize: 0, halfPageSize: 0 };
    let scroll = 3;
    const seen: string[] = [];
    const handled = runScrollPaneBridge({
      key: { name: 'pagedown', raw: '' } as any,
      widgetState: state,
      currentScroll: scroll,
      maxScroll: 10,
      pageSize: 4,
      halfPageSize: 2,
      acceptsHalfPageCtrl: true,
      setWidgetScroll: (s, next) => { s.scroll = next; seen.push(`set:${next}`); },
      getWidgetScroll: s => s.scroll,
      configureWidget: (s) => {
        s.maxScroll = 10;
        s.pageSize = 4;
        s.halfPageSize = 2;
        seen.push('configure');
      },
      dispatchKey: () => {
        state.scroll = 7;
        seen.push('dispatch');
      },
      applyNextScroll: (next) => {
        scroll = next;
        seen.push(`apply:${next}`);
      },
    });
    expect(handled).toBe(true);
    expect(scroll).toBe(7);
    expect(seen).toEqual(['set:3', 'configure', 'dispatch', 'apply:7']);
  });
});
