import { describe, expect, test } from 'bun:test';
import {
  applyLogSurfaceState,
  type LogSurfaceStateContract,
} from '../src/widgets/contracts/log-surface.js';

function state(): LogSurfaceStateContract {
  return {
    lines: [],
    scrollOffset: -1,
    focused: false,
    footerLine: null,
    frozenTailIndex: null,
    filterQuery: null,
    searchQuery: null,
    searchCursor: null,
    clickDeps: null,
  };
}

describe('applyLogSurfaceState', () => {
  test('hydrates the shared log/debug-log state vocabulary', () => {
    const target = state();
    applyLogSurfaceState(target, {
      lines: ['a', 'b'],
      scrollOffset: 4,
      focused: true,
      footerLine: 'thinking...',
      frozenTailIndex: 2,
      filterQuery: 'error',
      filterHint: '/log filter',
      searchQuery: 'err',
      searchCursor: { current: 2, total: 5 },
      clickDeps: null,
    });
    expect(target.lines).toEqual(['a', 'b']);
    expect(target.scrollOffset).toBe(4);
    expect(target.focused).toBe(true);
    expect(target.footerLine).toBe('thinking...');
    expect(target.frozenTailIndex).toBe(2);
    expect(target.filterQuery).toBe('error');
    expect(target.filterHint).toBe('/log filter');
    expect(target.searchQuery).toBe('err');
    expect(target.searchCursor).toEqual({ current: 2, total: 5 });
  });

  test('normalizes omitted optional fields to null', () => {
    const target = state();
    applyLogSurfaceState(target, {
      lines: ['x'],
      scrollOffset: -1,
      focused: false,
      footerLine: null,
    });
    expect(target.frozenTailIndex).toBeNull();
    expect(target.filterQuery).toBeNull();
    expect(target.filterHint).toBeNull();
    expect(target.searchQuery).toBeNull();
    expect(target.searchCursor).toBeNull();
    expect(target.clickDeps).toBeNull();
  });
});
