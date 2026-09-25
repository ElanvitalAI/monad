// ── U-4.4 · wd-log describeSurface + snapshotHash tests ──
//
// Covers the LLM observability surface of the log widget: DescribeSurface
// tool forwards to WidgetHost.describeSurfaceFor → this widget's
// `describeSurface(state, ctx)`. The tests assert the projected string
// includes the fields an LLM agent would expect when asking "what's in
// the log right now?" — entry count, tail status, freeze, active
// search. snapshotHash tests cover the recorder's change detection:
// freeze/search transitions must produce distinct hashes so a recorder
// picks them up without a deep compare pass.

import { describe, test, expect } from 'bun:test';
import logWidget, { type LogWidgetState } from '../widgets/log/widget.js';

function state(overrides: Partial<LogWidgetState> = {}): LogWidgetState {
  return {
    lines: [],
    scrollOffset: -1,
    focused: false,
    scroll: 0,
    ...overrides,
  };
}

const ctx = { character: 'Log' } as Parameters<NonNullable<typeof logWidget.describeSurface>>[1];

const describeState = (s: LogWidgetState): string => {
  const fn = logWidget.describeSurface;
  if (!fn) throw new Error('wd-log must define describeSurface for U-4.4');
  return fn(s, ctx);
};

describe('wd-log · describeSurface (U-4.4)', () => {
  test('baseline empty log — character + 0 entries + tail', () => {
    const out = describeState(state({ lines: [] }));
    expect(out).toContain('Log');
    expect(out).toContain('0 entries');
    expect(out).toContain('tail');
  });

  test('entry count reflects lines.length', () => {
    const out = describeState(state({ lines: ['a', 'b', 'c'] }));
    expect(out).toContain('3 entries');
  });

  test('non-tail scroll shows scroll position', () => {
    const out = describeState(state({ lines: ['a', 'b'], scrollOffset: 5 }));
    expect(out).toContain('scroll 5');
    expect(out).not.toContain('tail');
  });

  test('frozen tail index surfaces in description', () => {
    const out = describeState(state({
      lines: ['a', 'b', 'c'],
      frozenTailIndex: 2,
    }));
    expect(out).toContain('frozen@2');
  });

  test('frozen at index 0 still shows', () => {
    // Explicit index 0 is valid; only null/undefined suppresses.
    const out = describeState(state({ lines: ['a'], frozenTailIndex: 0 }));
    expect(out).toContain('frozen@0');
  });

  test('null frozenTailIndex omits the bit', () => {
    const out = describeState(state({ lines: ['a'], frozenTailIndex: null }));
    expect(out).not.toContain('frozen');
  });

  test('active search — query + match counter', () => {
    const out = describeState(state({
      lines: ['a'],
      searchQuery: 'error',
      searchCursor: { current: 2, total: 7 },
    }));
    expect(out).toContain('search "error"');
    expect(out).toContain('(2/7)');
  });

  test('active filter surfaces in description', () => {
    const out = describeState(state({
      lines: ['a'],
      filterQuery: 'build',
    }));
    expect(out).toContain('filter "build"');
  });

  test('search without cursor — query alone, no counter', () => {
    const out = describeState(state({
      lines: ['a'],
      searchQuery: 'warn',
    }));
    expect(out).toContain('search "warn"');
    expect(out).not.toContain('(');
  });

  test('long search query is truncated to 24 chars + ellipsis', () => {
    const long = 'x'.repeat(40);
    const out = describeState(state({ lines: [], searchQuery: long }));
    expect(out).toContain('xxxxxxxxxxxxxxxxxxxxx...');  // 21 chars + ...
    expect(out).not.toContain(long);
  });

  test('footer-pinned indicator surfaces', () => {
    const out = describeState(state({
      lines: [],
      footerLine: 'streaming...',
    }));
    expect(out).toContain('footer-pinned');
  });

  test('focused flag surfaces', () => {
    const out = describeState(state({ focused: true }));
    expect(out).toContain('focused');
  });

  test('all fields together — composite description', () => {
    const out = describeState(state({
      lines: Array(128).fill('x'),
      scrollOffset: 20,
      focused: true,
      frozenTailIndex: 115,
      searchQuery: 'TODO',
      searchCursor: { current: 1, total: 3 },
      footerLine: 'thinking...',
    }));
    expect(out).toContain('128 entries');
    expect(out).toContain('scroll 20');
    expect(out).toContain('frozen@115');
    expect(out).toContain('search "TODO"');
    expect(out).toContain('(1/3)');
    expect(out).toContain('footer-pinned');
    expect(out).toContain('focused');
  });

  test('parts joined with middle-dot separator · (arc-wide convention)', () => {
    const out = describeState(state({ lines: ['a'] }));
    expect(out).toContain(' · ');
  });
});

describe('wd-log · snapshotHash (U-4.4 extensions)', () => {
  const hash = (s: LogWidgetState): string => {
    const fn = logWidget.snapshotHash;
    if (!fn) throw new Error('wd-log must define snapshotHash');
    return fn(s);
  };

  test('baseline tail state — stable hash', () => {
    const h1 = hash(state({ lines: ['a'] }));
    const h2 = hash(state({ lines: ['a'] }));
    expect(h1).toBe(h2);
  });

  test('freeze transition changes hash', () => {
    const noFreeze = hash(state({ lines: ['a', 'b'] }));
    const frozen = hash(state({ lines: ['a', 'b'], frozenTailIndex: 1 }));
    expect(noFreeze).not.toBe(frozen);
  });

  test('different freeze indices produce different hashes', () => {
    const h1 = hash(state({ lines: ['a'], frozenTailIndex: 1 }));
    const h2 = hash(state({ lines: ['a'], frozenTailIndex: 2 }));
    expect(h1).not.toBe(h2);
  });

  test('search query presence changes hash', () => {
    const noSearch = hash(state({ lines: ['a'] }));
    const withSearch = hash(state({ lines: ['a'], searchQuery: 'x' }));
    expect(noSearch).not.toBe(withSearch);
  });

  test('filter query presence changes hash', () => {
    const noFilter = hash(state({ lines: ['a'] }));
    const withFilter = hash(state({ lines: ['a'], filterQuery: 'x' }));
    expect(noFilter).not.toBe(withFilter);
  });

  test('search cursor transition changes hash', () => {
    const cur1 = hash(state({
      lines: ['a'],
      searchQuery: 'x',
      searchCursor: { current: 1, total: 3 },
    }));
    const cur2 = hash(state({
      lines: ['a'],
      searchQuery: 'x',
      searchCursor: { current: 2, total: 3 },
    }));
    expect(cur1).not.toBe(cur2);
  });

  test('focused transition still distinct (pre-U-4.4 invariant preserved)', () => {
    const unfocused = hash(state({ lines: ['a'] }));
    const focused = hash(state({ lines: ['a'], focused: true }));
    expect(unfocused).not.toBe(focused);
  });

  test('tail vs non-tail still distinct (pre-U-4.4 invariant preserved)', () => {
    const tail = hash(state({ lines: ['a'] }));
    const scrolled = hash(state({ lines: ['a'], scrollOffset: 0 }));
    expect(tail).not.toBe(scrolled);
  });

  test('line count growth changes hash (pre-U-4.4 invariant preserved)', () => {
    const h1 = hash(state({ lines: ['a'] }));
    const h2 = hash(state({ lines: ['a', 'b'] }));
    expect(h1).not.toBe(h2);
  });
});
