import { describe, expect, test } from 'bun:test';

import { createDashboardLogWidgetRuntime } from '../src/dashboard/log-widget-runtime.js';
import type { LogSurfaceStateContract } from '../src/widgets/contracts/log-surface.js';

function createState(): LogSurfaceStateContract {
  return {
    lines: [],
    scrollOffset: 0,
    focused: false,
    footerLine: null,
    frozenTailIndex: null,
    filterQuery: null,
    filterHint: null,
    searchQuery: null,
    searchCursor: null,
    clickDeps: null,
  };
}

describe('createDashboardLogWidgetRuntime', () => {
  test('syncs main and debug log widget state', () => {
    const runtime = createDashboardLogWidgetRuntime();

    const main = createState();
    runtime.syncMain(main, {
      lines: ['a'],
      scrollOffset: 2,
      focused: true,
      footerLine: 'footer',
      logFrozenTailIndex: 5,
      logSearchCursor: 1,
      logSearchResultsLength: 3,
      logFilterQuery: 'err',
      logSearchQuery: 'needle',
      foldMode: 'line',
      clickDeps: null,
    });
    expect(main.lines).toEqual(['a']);
    expect(main.scrollOffset).toBe(2);
    expect(main.focused).toBe(true);
    expect(main.footerLine).toBe('footer');
    expect(main.frozenTailIndex).toBe(5);
    expect(main.filterHint).toBe('/log filter');
    expect(main.searchCursor).toEqual({ current: 2, total: 3 });

    const debug = createState();
    runtime.syncDebug(debug, {
      lines: ['d'],
      scrollOffset: 1,
      filterQuery: 'warn',
    });
    expect(debug.lines).toEqual(['d']);
    expect(debug.scrollOffset).toBe(1);
    expect(debug.focused).toBe(false);
    expect(debug.filterHint).toBe('/debug filter');
    expect(debug.searchCursor).toBeNull();
  });
});
