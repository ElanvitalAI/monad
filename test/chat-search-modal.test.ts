// P4.1 — search modal tests. Verifies the modal owns its own
// state (query, selectedIdx), refreshes items on each query
// change, paints a query line + filtered list, claims the cursor
// (caret on the query line), and routes accept/cancel to the
// caller.

import { describe, expect, test } from 'bun:test';
import { createSearchModal, type SearchItem } from '../src/chat/search/modal.js';
import { DEFAULT_THEME_TOKENS } from '../src/theme/tokens.js';
import type { DisplayMouseEvent } from '../src/display/types.js';

const items: SearchItem[] = [
  { label: 'alpha agent', payload: 'a1' },
  { label: 'beta agent',  payload: 'b1' },
  { label: 'gamma agent', payload: 'g1' },
  { label: 'delta task',  payload: 'd1' },
];

function spec(overrides?: Partial<Parameters<typeof createSearchModal>[0]>) {
  const accepted: Array<{ item: SearchItem; query: string }> = [];
  let cancels = 0;
  const handle = createSearchModal({
    id: 'test:search',
    bounds: { row: 3, col: 5, width: 40, height: 10 },
    title: 'Search',
    width: 40,
    maxVisible: 3,
    onQuery: (q) => items.filter(i => i.label.toLowerCase().includes(q.toLowerCase())),
    onAccept: (item, query) => { accepted.push({ item, query }); },
    onCancel: () => { cancels++; },
    ...overrides,
  });
  return { handle, accepted, get cancels() { return cancels; } };
}

function mouse(type: DisplayMouseEvent['type'], row: number, col: number): DisplayMouseEvent {
  return { type, row, col };
}

describe('createSearchModal — surface metadata', () => {
  test('returns kind:modal with bounds, focusable, paint, cursor', () => {
    const { handle } = spec();
    expect(handle.surface.kind).toBe('modal');
    expect(handle.surface.bounds).toEqual({ row: 3, col: 5, width: 40, height: 10 });
    expect(handle.surface.focus).toBe('owns');
    expect(typeof handle.surface.paint).toBe('function');
    expect(typeof handle.surface.cursor).toBe('function');
  });

  test('initial state — empty query, all items, selectedIdx 0', () => {
    const { handle } = spec();
    const s = handle.state();
    expect(s.query).toBe('');
    expect(s.items.length).toBe(items.length);
    expect(s.selectedIdx).toBe(0);
  });
});

describe('typing + filtering', () => {
  test('type narrows the candidate list', () => {
    const { handle } = spec();
    handle.type('a'); handle.type('l');
    const s = handle.state();
    expect(s.query).toBe('al');
    expect(s.items.length).toBe(1);
    expect(s.items[0]?.label).toBe('alpha agent');
  });

  test('type accepts space character (T7-L1 regression)', () => {
    const { handle } = spec({
      onQuery: (q) => items.filter(i => i.label.includes(q)),
    });
    handle.type('beta'); handle.type(' '); handle.type('agent');
    const s = handle.state();
    expect(s.query).toBe('beta agent');
    expect(s.items.length).toBe(1);
    expect(s.items[0]?.label).toBe('beta agent');
  });

  test('backspace pops one char + re-runs onQuery', () => {
    const { handle } = spec();
    handle.type('a'); handle.type('l'); handle.type('z');  // → 'alz' (no match)
    expect(handle.state().items.length).toBe(0);
    handle.backspace();                                    // → 'al' (matches alpha)
    const s = handle.state();
    expect(s.query).toBe('al');
    expect(s.items.length).toBe(1);
    expect(s.items[0]?.label).toBe('alpha agent');
  });

  test('selectedIdx clamps to items.length on filter shrink', () => {
    const { handle } = spec();
    handle.down(); handle.down();             // selectedIdx 2
    expect(handle.state().selectedIdx).toBe(2);
    handle.type('a');                          // 'a' filter → keeps all 4 (alpha/beta/gamma/delta all contain 'a')
    handle.type('l');                          // 'al' → only alpha
    expect(handle.state().items.length).toBe(1);
    expect(handle.state().selectedIdx).toBe(0);
  });
});

describe('navigation', () => {
  test('down increments, up decrements, clamped at bounds', () => {
    const { handle } = spec();
    expect(handle.state().selectedIdx).toBe(0);
    handle.up();                              // already at top
    expect(handle.state().selectedIdx).toBe(0);
    handle.down();
    expect(handle.state().selectedIdx).toBe(1);
    handle.down(); handle.down(); handle.down();
    expect(handle.state().selectedIdx).toBe(items.length - 1);
  });
});

describe('accept + cancel', () => {
  test('accept fires onAccept with current item + query', () => {
    const t = spec();
    t.handle.type('b');                       // → beta agent
    t.handle.accept();
    expect(t.accepted.length).toBe(1);
    expect(t.accepted[0]?.item.label).toBe('beta agent');
    expect(t.accepted[0]?.query).toBe('b');
  });

  test('accept on empty filter does nothing (no item to pick)', () => {
    const t = spec();
    t.handle.type('z');
    t.handle.accept();
    expect(t.accepted.length).toBe(0);
  });

  test('cancel fires onCancel', () => {
    const t = spec();
    t.handle.cancel();
    expect(t.cancels).toBe(1);
  });
});

describe('paint output', () => {
  test('paint includes title row + query row + visible items', () => {
    const { handle } = spec();
    const out = handle.surface.paint();
    expect(out).toContain('Search');
    // Query prompt char.
    expect(out).toContain('/');
    expect(out).toContain('alpha');
    expect(out).toContain('beta');
    expect(out).toContain('gamma');
    // 4 items but maxVisible=3 → delta NOT in the first window.
    expect(out).not.toContain('delta');
  });

  test('windowing — selecting beyond maxVisible shifts the window', () => {
    const { handle } = spec();
    handle.down(); handle.down(); handle.down();
    const out = handle.surface.paint();
    expect(out).toContain('delta');
  });

  test('empty match shows "(no matches)"', () => {
    const { handle } = spec();
    handle.type('z');
    const out = handle.surface.paint();
    expect(out).toContain('(no matches)');
  });

  test('theme-aware search modal paints static chrome close glyph', () => {
    const { handle } = spec({ theme: DEFAULT_THEME_TOKENS });
    const out = handle.surface.paint();
    expect(out).toContain('Search');
    expect(out).toContain('✕');
  });
});

describe('cursor() claim', () => {
  test('caret sits at end of query on the query row', () => {
    const { handle } = spec();
    const c1 = handle.surface.cursor!()!;
    expect(c1.visible).toBe(true);
    expect(c1.row).toBe(4);                   // bounds.row + 1
    handle.type('foo');
    const c2 = handle.surface.cursor!()!;
    expect(c2.col).toBeGreaterThan(c1.col);   // moved right
  });

  test('theme-aware chrome shifts caret right by border padding', () => {
    const plain = spec();
    const themed = spec({ theme: DEFAULT_THEME_TOKENS });
    expect(themed.handle.surface.cursor!()!.col).toBe(plain.handle.surface.cursor!()!.col);
    expect(themed.handle.surface.cursor!()!.row).toBe(plain.handle.surface.cursor!()!.row);
  });
});

describe('mouse support', () => {
  test('theme-aware modal routes click to select only in browse-mode shell', () => {
    const t = spec({ theme: DEFAULT_THEME_TOKENS });
    t.handle.surface.paint();
    const bounds = t.handle.surface.bounds;
    const itemRow = bounds.row + 3;
    const itemCol = bounds.col + 3;
    const res = t.handle.surface.onMouse?.(mouse('click', itemRow, itemCol));
    expect(res?.type).toBe('refresh');
    expect(t.accepted.length).toBe(0);
    expect(t.handle.state().selectedIdx).toBe(1);
  });

  test('theme-aware modal routes double-click to submit', () => {
    const t = spec({ theme: DEFAULT_THEME_TOKENS });
    t.handle.surface.paint();
    const bounds = t.handle.surface.bounds;
    const itemRow = bounds.row + 3;
    const itemCol = bounds.col + 3;
    const res = t.handle.surface.onMouse?.(mouse('double-click', itemRow, itemCol));
    expect(res?.type).toBe('refresh');
    expect(t.accepted.length).toBe(1);
  });

  test('outside click cancels the modal', () => {
    const t = spec({ theme: DEFAULT_THEME_TOKENS });
    t.handle.surface.paint();
    const res = t.handle.surface.onMouse?.(mouse('click', 1, 1));
    expect(res?.type).toBe('refresh');
    expect(t.cancels).toBe(1);
  });

  test('first outside release after mount is ignored', () => {
    const t = spec({ theme: DEFAULT_THEME_TOKENS });
    t.handle.surface.paint();
    const res = t.handle.surface.onMouse?.(mouse('release', 1, 1));
    expect(res?.type).toBe('refresh');
    expect(t.cancels).toBe(0);
  });

  test('close glyph click cancels the modal', () => {
    const t = spec({ theme: DEFAULT_THEME_TOKENS });
    t.handle.surface.paint();
    const b = t.handle.surface.bounds;
    const res = t.handle.surface.onMouse?.(mouse('click', b.row, b.col + b.width - 2));
    expect(res?.type).toBe('refresh');
    expect(t.cancels).toBe(1);
  });

  test('action buttons render and can be clicked', () => {
    const t = spec({ theme: DEFAULT_THEME_TOKENS, actionButtons: true });
    const out = t.handle.surface.paint();
    expect(out).toContain('Select');
    expect(out).toContain('Cancel');
    expect(out).not.toContain('[ Select ]');
    expect(out).not.toContain('[ Cancel ]');
    const b = t.handle.surface.bounds;
    const cancel = t.handle.surface.onMouse?.(mouse('click', b.row + b.height - 2, b.col + 24));
    expect(cancel?.type).toBe('refresh');
    expect(t.cancels).toBe(1);
  });
});

// ─── Phase E: onSelectionChange hook ──────────────────────────────

describe('onSelectionChange', () => {
  function specWithHover() {
    const hovered: Array<SearchItem | null> = [];
    const handle = createSearchModal({
      id: 'test:search-hover',
      bounds: { row: 3, col: 5, width: 40, height: 10 },
      title: 'Search',
      width: 40,
      maxVisible: 5,
      onQuery: (q) => items.filter(i => i.label.toLowerCase().includes(q.toLowerCase())),
      onAccept: () => {},
      onSelectionChange: (item) => { hovered.push(item); },
    });
    return { handle, hovered };
  }

  test('fires on initial mount with the primed selection', () => {
    const { hovered } = specWithHover();
    // The hook primes on construction — first entry is the head.
    expect(hovered).toHaveLength(1);
    expect(hovered[0]?.payload).toBe('a1');
  });

  test('fires on down() / up() when payload changes', () => {
    const { handle, hovered } = specWithHover();
    handle.down();
    handle.down();
    expect(hovered.map(h => h?.payload)).toEqual(['a1', 'b1', 'g1']);
    handle.up();
    expect(hovered.at(-1)?.payload).toBe('b1');
  });

  test('does NOT fire when selection would stay on same payload (clamp)', () => {
    const { handle, hovered } = specWithHover();
    handle.up(); // already at top → no change
    expect(hovered).toHaveLength(1);
  });

  test('fires on type() when filter shifts the highlighted item', () => {
    const { handle, hovered } = specWithHover();
    handle.type('delta'); // only "delta task" matches
    expect(hovered.at(-1)?.payload).toBe('d1');
  });

  test('emits null when refresh empties the list', () => {
    const { handle, hovered } = specWithHover();
    handle.type('zzzz'); // no match
    expect(hovered.at(-1)).toBeNull();
  });

  test('throwing hook does not break subsequent operations', () => {
    const handle = createSearchModal({
      id: 'test:search-hover-throw',
      bounds: { row: 3, col: 5, width: 40, height: 10 },
      title: 'Search',
      width: 40,
      maxVisible: 5,
      onQuery: (q) => items.filter(i => i.label.toLowerCase().includes(q.toLowerCase())),
      onAccept: () => {},
      onSelectionChange: () => { throw new Error('boom'); },
    });
    expect(() => handle.down()).not.toThrow();
    expect(handle.state().selectedIdx).toBe(1);
  });

  test('spec without onSelectionChange is still valid', () => {
    const handle = createSearchModal({
      id: 'test:search-no-hover',
      bounds: { row: 3, col: 5, width: 40, height: 10 },
      title: 'Search',
      width: 40,
      maxVisible: 5,
      onQuery: (q) => items.filter(i => i.label.toLowerCase().includes(q.toLowerCase())),
      onAccept: () => {},
    });
    expect(() => handle.down()).not.toThrow();
  });
});

describe('createSearchModal — surface.onKey (KX3)', () => {
  test('Enter → accept; Escape → cancel', () => {
    const t = spec();
    t.handle.surface.onKey!({ name: 'down' });
    const res1 = t.handle.surface.onKey!({ name: 'enter' });
    expect(res1).toBe('consumed');
    expect(t.accepted).toHaveLength(1);
    expect(t.accepted[0]!.item.payload).toBe('b1');

    const t2 = spec();
    const res2 = t2.handle.surface.onKey!({ name: 'escape' });
    expect(res2).toBe('consumed');
    expect(t2.cancels).toBe(1);
  });

  test('Up/Down + Ctrl+P/N + Korean ㅔ/ㅜ all navigate', () => {
    const t = spec();
    t.handle.surface.onKey!({ name: 'down' });
    t.handle.surface.onKey!({ name: 'n', ctrl: true });
    t.handle.surface.onKey!({ name: 'ㅜ', ctrl: true });
    expect(t.handle.state().selectedIdx).toBe(3);
    t.handle.surface.onKey!({ name: 'up' });
    t.handle.surface.onKey!({ name: 'p', ctrl: true });
    t.handle.surface.onKey!({ name: 'ㅔ', ctrl: true });
    expect(t.handle.state().selectedIdx).toBe(0);
  });

  test('printable chars + space + backspace edit the query', () => {
    const t = spec();
    t.handle.surface.onKey!({ name: 'a' });
    t.handle.surface.onKey!({ name: 'space' });
    t.handle.surface.onKey!({ name: '한' });
    expect(t.handle.state().query).toBe('a 한');
    t.handle.surface.onKey!({ name: 'backspace' });
    expect(t.handle.state().query).toBe('a ');
  });

  test('raw/sequence fallback types the char when name is symbolic', () => {
    const t = spec();
    t.handle.surface.onKey!({ name: 'exclamation', sequence: '!' } as unknown as import('../src/plugins/core/types.js').KeyEvent);
    expect(t.handle.state().query).toBe('!');
    // Key.raw path (dashboard runtime shape) also works.
    t.handle.surface.onKey!({ name: 'question', raw: '?' } as unknown as import('../src/plugins/core/types.js').KeyEvent);
    expect(t.handle.state().query).toBe('!?');
  });

  test('unsupported keys (F1, Ctrl+A, paste-start) consumed without mutation', () => {
    const t = spec();
    const before = t.handle.state();
    const r1 = t.handle.surface.onKey!({ name: 'f1' });
    const r2 = t.handle.surface.onKey!({ name: 'a', ctrl: true });
    const r3 = t.handle.surface.onKey!({ name: 'paste-start', sequence: '\x1b[200~' } as unknown as import('../src/plugins/core/types.js').KeyEvent);
    expect([r1, r2, r3]).toEqual(['consumed', 'consumed', 'consumed']);
    expect(t.handle.state()).toEqual(before);
  });
});
