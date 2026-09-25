import { describe, expect, test } from 'bun:test';
import {
  scrollable, Scrollable, type ScrollableState,
  cursorable, Cursorable, type CursorableState,
  paneNavigable,
  filterable, Filterable, type FilterableState,
  selectable, type SelectableState,
} from '../src/widget-behaviors/index.js';
import type { KeyEvent, WidgetContext } from '../src/widgets/types.js';

// ── Helpers ────────────────────────────────────────────────────────

function mkKey(name: string, extra: Partial<KeyEvent> = {}): KeyEvent {
  return { name, ctrl: false, shift: false, ...extra } as KeyEvent;
}

function mkCtx<S>(state: S): WidgetContext<S> {
  return {
    widgetId: 'test',
    widgetType: 'test',
    character: 'T',
    state,
    setState: () => {},
    requestRender: () => {},
    dismiss: () => {},
    log: () => {},
  };
}

// ── Scrollable ─────────────────────────────────────────────────────

describe('scrollable', () => {
  test('j / down increments scroll', () => {
    const s: ScrollableState = { scroll: 0 };
    Scrollable.onKey!(mkKey('j'), s, mkCtx(s));
    expect(s.scroll).toBe(1);
    Scrollable.onKey!(mkKey('down'), s, mkCtx(s));
    expect(s.scroll).toBe(2);
  });

  test('k / up decrements scroll (clamped at 0)', () => {
    const s: ScrollableState = { scroll: 2 };
    Scrollable.onKey!(mkKey('k'), s, mkCtx(s));
    expect(s.scroll).toBe(1);
    Scrollable.onKey!(mkKey('up'), s, mkCtx(s));
    expect(s.scroll).toBe(0);
    Scrollable.onKey!(mkKey('k'), s, mkCtx(s));
    expect(s.scroll).toBe(0); // clamped
  });

  test('g / Home jumps to 0', () => {
    const s: ScrollableState = { scroll: 25 };
    Scrollable.onKey!(mkKey('g'), s, mkCtx(s));
    expect(s.scroll).toBe(0);
    s.scroll = 25;
    Scrollable.onKey!(mkKey('home'), s, mkCtx(s));
    expect(s.scroll).toBe(0);
  });

  test('G / End jumps to maxScroll (no-op without maxScroll)', () => {
    const noMax: ScrollableState = { scroll: 0 };
    Scrollable.onKey!(mkKey('G'), noMax, mkCtx(noMax));
    expect(noMax.scroll).toBe(0); // no-op without maxScroll

    const withMax: ScrollableState = { scroll: 0, maxScroll: 50 };
    Scrollable.onKey!(mkKey('G'), withMax, mkCtx(withMax));
    expect(withMax.scroll).toBe(50);
    withMax.scroll = 0;
    Scrollable.onKey!(mkKey('end'), withMax, mkCtx(withMax));
    expect(withMax.scroll).toBe(50);
  });

  test('scroll clamps to maxScroll on increment', () => {
    const s: ScrollableState = { scroll: 48, maxScroll: 50 };
    Scrollable.onKey!(mkKey('j'), s, mkCtx(s));
    expect(s.scroll).toBe(49);
    Scrollable.onKey!(mkKey('j'), s, mkCtx(s));
    expect(s.scroll).toBe(50);
    Scrollable.onKey!(mkKey('j'), s, mkCtx(s));
    expect(s.scroll).toBe(50); // clamped
  });

  test('PgDn / PgUp use default pageSize 10', () => {
    const s: ScrollableState = { scroll: 5 };
    Scrollable.onKey!(mkKey('pagedown'), s, mkCtx(s));
    expect(s.scroll).toBe(15);
    Scrollable.onKey!(mkKey('pageup'), s, mkCtx(s));
    expect(s.scroll).toBe(5);
  });

  test('Ctrl+d / Ctrl+u use default halfPageSize 5', () => {
    const s: ScrollableState = { scroll: 5 };
    Scrollable.onKey!(mkKey('d', { ctrl: true }), s, mkCtx(s));
    expect(s.scroll).toBe(10);
    Scrollable.onKey!(mkKey('u', { ctrl: true }), s, mkCtx(s));
    expect(s.scroll).toBe(5);
  });

  test('factory override — custom pageSize/halfPageSize', () => {
    const b = scrollable({ pageSize: 20, halfPageSize: 8 });
    const s: ScrollableState = { scroll: 0 };
    b.onKey!(mkKey('pagedown'), s, mkCtx(s));
    expect(s.scroll).toBe(20);
    b.onKey!(mkKey('d', { ctrl: true }), s, mkCtx(s));
    expect(s.scroll).toBe(28);
  });

  test('state-level pageSize overrides factory config', () => {
    const b = scrollable({ pageSize: 10 });
    const s: ScrollableState = { scroll: 0, pageSize: 3 };
    b.onKey!(mkKey('pagedown'), s, mkCtx(s));
    expect(s.scroll).toBe(3);
  });

  test('handlesKey claims scroll keys only', () => {
    expect(Scrollable.handlesKey!(mkKey('j'), { scroll: 0 })).toBe(true);
    expect(Scrollable.handlesKey!(mkKey('G'), { scroll: 0 })).toBe(true);
    expect(Scrollable.handlesKey!(mkKey('d', { ctrl: true }), { scroll: 0 })).toBe(true);
    expect(Scrollable.handlesKey!(mkKey('d'), { scroll: 0 })).toBe(false);
    expect(Scrollable.handlesKey!(mkKey('a'), { scroll: 0 })).toBe(false);
  });
});

// ── Cursorable ─────────────────────────────────────────────────────

describe('cursorable', () => {
  test('j / down increments cursor up to itemCount - 1', () => {
    const s: CursorableState = { cursor: 0, itemCount: 3 };
    Cursorable.onKey!(mkKey('j'), s, mkCtx(s));
    expect(s.cursor).toBe(1);
    Cursorable.onKey!(mkKey('j'), s, mkCtx(s));
    expect(s.cursor).toBe(2);
    Cursorable.onKey!(mkKey('j'), s, mkCtx(s));
    expect(s.cursor).toBe(2); // clamped at max
  });

  test('k / up decrements cursor down to 0', () => {
    const s: CursorableState = { cursor: 2, itemCount: 3 };
    Cursorable.onKey!(mkKey('k'), s, mkCtx(s));
    expect(s.cursor).toBe(1);
    Cursorable.onKey!(mkKey('k'), s, mkCtx(s));
    expect(s.cursor).toBe(0);
    Cursorable.onKey!(mkKey('k'), s, mkCtx(s));
    expect(s.cursor).toBe(0); // clamped
  });

  test('G / End jumps to itemCount - 1', () => {
    const s: CursorableState = { cursor: 0, itemCount: 5 };
    Cursorable.onKey!(mkKey('G'), s, mkCtx(s));
    expect(s.cursor).toBe(4);
  });

  test('empty itemCount returns none action', () => {
    const s: CursorableState = { cursor: 0, itemCount: 0 };
    const r = Cursorable.onKey!(mkKey('j'), s, mkCtx(s));
    expect(r).toEqual({ type: 'none' });
    expect(s.cursor).toBe(0);
  });

  test('getItemCount injector overrides state.itemCount', () => {
    let external = 5;
    const b = cursorable<CursorableState>({ getItemCount: () => external });
    const s: CursorableState = { cursor: 0, itemCount: 0 };
    b.onKey!(mkKey('G'), s, mkCtx(s));
    expect(s.cursor).toBe(4);
    external = 2;
    b.onKey!(mkKey('G'), s, mkCtx(s));
    expect(s.cursor).toBe(1);
  });
});

// ── PaneNavigable ──────────────────────────────────────────────────

describe('paneNavigable', () => {
  test('h calls onLeft, l calls onRight', () => {
    let leftCalled = 0;
    let rightCalled = 0;
    const b = paneNavigable({
      onLeft: () => { leftCalled++; },
      onRight: () => { rightCalled++; },
    });
    const ctx = mkCtx({});
    b.onKey!(mkKey('h'), {}, ctx);
    expect(leftCalled).toBe(1);
    expect(rightCalled).toBe(0);
    b.onKey!(mkKey('l'), {}, ctx);
    expect(leftCalled).toBe(1);
    expect(rightCalled).toBe(1);
  });

  test('missing handler makes the direction a no-op', () => {
    const b = paneNavigable({ onLeft: () => {} }); // no onRight
    const r = b.onKey!(mkKey('l'), {}, mkCtx({}));
    expect(r).toEqual({ type: 'none' });
  });

  test('handlesKey rejects ctrl/shift modifiers', () => {
    const b = paneNavigable({ onLeft: () => {} });
    expect(b.handlesKey!(mkKey('h'), {})).toBe(true);
    expect(b.handlesKey!(mkKey('h', { ctrl: true }), {})).toBe(false);
    expect(b.handlesKey!(mkKey('h', { shift: true }), {})).toBe(false);
  });

  test('arrowsAsNav routes ← / → through handlers', () => {
    let left = false;
    let right = false;
    const off = paneNavigable({ onLeft: () => { left = true; }, onRight: () => { right = true; } });
    expect(off.handlesKey!(mkKey('left'), {})).toBe(false);
    expect(off.handlesKey!(mkKey('right'), {})).toBe(false);

    const on = paneNavigable({
      onLeft: () => { left = true; },
      onRight: () => { right = true; },
      arrowsAsNav: true,
    });
    expect(on.handlesKey!(mkKey('left'), {})).toBe(true);
    on.onKey!(mkKey('left'), {}, mkCtx({}));
    expect(left).toBe(true);
    on.onKey!(mkKey('right'), {}, mkCtx({}));
    expect(right).toBe(true);
  });
});

// ── Filterable ─────────────────────────────────────────────────────

describe('filterable', () => {
  test('/ enters filter mode, Esc exits', () => {
    const s: FilterableState = { filter: 'stale', filtering: false };
    Filterable.onKey!(mkKey('/'), s, mkCtx(s));
    expect(s.filtering).toBe(true);
    expect(s.filter).toBe(''); // reset
    Filterable.onKey!(mkKey('escape'), s, mkCtx(s));
    expect(s.filtering).toBe(false);
    expect(s.filter).toBe('');
  });

  test('/ no-op while filtering', () => {
    const s: FilterableState = { filter: 'x', filtering: true };
    expect(Filterable.handlesKey!(mkKey('/'), s)).toBe(false);
  });

  test('Esc no-op while not filtering', () => {
    const s: FilterableState = { filter: '', filtering: false };
    expect(Filterable.handlesKey!(mkKey('escape'), s)).toBe(false);
  });

  test('onEnter / onExit callbacks fire', () => {
    let entered = 0;
    let exited = 0;
    const b = filterable<FilterableState>({
      onEnter: () => { entered++; },
      onExit: () => { exited++; },
    });
    const s: FilterableState = { filter: '', filtering: false };
    b.onKey!(mkKey('/'), s, mkCtx(s));
    expect(entered).toBe(1);
    b.onKey!(mkKey('escape'), s, mkCtx(s));
    expect(exited).toBe(1);
  });
});

// ── Selectable ─────────────────────────────────────────────────────

describe('selectable', () => {
  test('space toggles cursor item', () => {
    const s: SelectableState = { selected: new Set() };
    const b = selectable<SelectableState>({
      getItemIds: () => ['a', 'b', 'c'],
      getCursorId: () => 'b',
    });
    b.onKey!(mkKey('space'), s, mkCtx(s));
    expect(s.selected.has('b')).toBe(true);
    b.onKey!(mkKey('space'), s, mkCtx(s));
    expect(s.selected.has('b')).toBe(false);
  });

  test('A selects all when any unselected', () => {
    const s: SelectableState = { selected: new Set(['a']) };
    const b = selectable<SelectableState>({
      getItemIds: () => ['a', 'b', 'c'],
      getCursorId: () => 'a',
    });
    b.onKey!(mkKey('A'), s, mkCtx(s));
    expect(s.selected.size).toBe(3);
    expect([...s.selected].sort()).toEqual(['a', 'b', 'c']);
  });

  test('A clears when all selected', () => {
    const s: SelectableState = { selected: new Set(['a', 'b', 'c']) };
    const b = selectable<SelectableState>({
      getItemIds: () => ['a', 'b', 'c'],
      getCursorId: () => 'a',
    });
    b.onKey!(mkKey('A'), s, mkCtx(s));
    expect(s.selected.size).toBe(0);
  });

  test('space with undefined cursor id is no-op', () => {
    const s: SelectableState = { selected: new Set() };
    const b = selectable<SelectableState>({
      getItemIds: () => [],
      getCursorId: () => undefined,
    });
    const r = b.onKey!(mkKey('space'), s, mkCtx(s));
    expect(r).toEqual({ type: 'none' });
    expect(s.selected.size).toBe(0);
  });

  test('onToggle + onToggleAll callbacks', () => {
    const s: SelectableState = { selected: new Set() };
    let lastToggle: { id: string; selected: boolean } | null = null;
    let lastAll: { selected: boolean } | null = null;
    const b = selectable<SelectableState>({
      getItemIds: () => ['a', 'b'],
      getCursorId: () => 'a',
      onToggle: (id, nowSelected) => { lastToggle = { id, selected: nowSelected }; },
      onToggleAll: (nowSelected) => { lastAll = { selected: nowSelected }; },
    });
    b.onKey!(mkKey('space'), s, mkCtx(s));
    expect(lastToggle).toEqual({ id: 'a', selected: true });
    b.onKey!(mkKey('A'), s, mkCtx(s));
    expect(lastAll).toEqual({ selected: true });
  });
});
