// KX5-0 — SelectView extensions: controlled cursor/query, dynamic
// options getter, upward direction, icon field.
//
// Keeps the existing uncontrolled behaviour untouched (covered in
// ui-select-view.test.ts) and verifies the new opt-in surface.

import { describe, expect, test } from 'bun:test';
import { Printer } from '../src/ui/printer.js';
import { SelectView, type SelectOption } from '../src/ui/widgets/select-view.js';
import type { KeyEvent } from '../src/plugins/core/types.js';
import { stripAnsi } from '../src/tui.js';

function key(name: string, mods: Partial<KeyEvent> = {}): KeyEvent {
  return { name, ctrl: false, shift: false, alt: false, ...mods };
}

function render(view: SelectView<unknown>, w = 40, h = 10, focused = true): string[] {
  const p = Printer.create({ width: w, height: h, focused });
  view.draw(p);
  return p.lines().map(stripAnsi);
}

describe('SelectView — icon field', () => {
  test('renders icon before label in drawRow', () => {
    const options: SelectOption<string>[] = [
      { value: 'a', label: 'Alpha', icon: '📄' },
      { value: 'b', label: 'Beta',  icon: '📁' },
    ];
    const view = new SelectView<string>({ options, onSubmit: () => {} });
    const lines = render(view);
    expect(lines[0]).toContain('📄');
    expect(lines[0]).toContain('Alpha');
    expect(lines[1]).toContain('📁');
  });
});

describe('SelectView — dynamic options getter', () => {
  test('getter form is called each draw', () => {
    let callCount = 0;
    const items = ['x', 'y', 'z'];
    const view = new SelectView<string>({
      options: () => {
        callCount++;
        return items.map((v) => ({ value: v, label: v.toUpperCase() }));
      },
      onSubmit: () => {},
    });
    render(view);
    render(view);
    expect(callCount).toBeGreaterThanOrEqual(2);
  });

  test('swapping the underlying list between draws is reflected', () => {
    let pool: SelectOption<string>[] = [
      { value: 'a', label: 'Alpha' },
      { value: 'b', label: 'Beta' },
    ];
    const view = new SelectView<string>({
      options: () => pool,
      onSubmit: () => {},
    });
    let lines = render(view);
    expect(lines[0]).toContain('Alpha');
    pool = [{ value: 'c', label: 'Charlie' }, { value: 'd', label: 'Delta' }];
    lines = render(view);
    expect(lines[0]).toContain('Charlie');
    expect(lines[1]).toContain('Delta');
  });
});

describe('SelectView — controlled cursor', () => {
  test('cursor prop overrides internal state on draw', () => {
    const view = new SelectView<string>({
      options: [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B' },
        { value: 'c', label: 'C' },
      ],
      cursor: 2,
      onSubmit: () => {},
    });
    const lines = render(view);
    // IDX-F8 — pointer ▸ should be on row index 2 (the third list row)
    expect(lines[2]).toContain('▸');
    expect(lines[0]).not.toContain('▸');
  });

  test('onCursorChange fires when keys would move the cursor', () => {
    const changes: number[] = [];
    const view = new SelectView<string>({
      options: [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B' },
      ],
      cursor: 0,
      onCursorChange: (n) => changes.push(n),
      onSubmit: () => {},
    });
    view.onEvent(key('down'));
    view.onEvent(key('down'));
    expect(changes.length).toBe(2);
    // First move: wrap(0 + 1) = 1. Second move uses effectiveCursor (still 0
    // because the owner didn't push the new value back) + 1 = 1 again.
    expect(changes[0]).toBe(1);
    expect(changes[1]).toBe(1);
  });
});

describe('SelectView — controlled query', () => {
  test('typed chars produce onQueryChange and searchable renders the prop', () => {
    const queries: string[] = [];
    const view = new SelectView<string>({
      options: [
        { value: 'a', label: 'Apple' },
        { value: 'b', label: 'Banana' },
      ],
      searchable: true,
      query: 'ban',
      onQueryChange: (q) => queries.push(q),
      onSubmit: () => {},
    });
    const lines = render(view);
    // Query line = second row (title absent). Prop-driven query appears.
    expect(lines[0]).toContain('ban');
    view.onEvent(key('x'));
    // Owner would update the prop; the view itself also fires observer.
    expect(queries).toContain('banx');
  });
});

describe('SelectView — upward direction', () => {
  test('list paints top-anchored with separator below (legacy paintUpwardList layout)', () => {
    const view = new SelectView<string>({
      options: [
        { value: 'a', label: 'Alpha' },
        { value: 'b', label: 'Beta' },
        { value: 'c', label: 'Gamma' },
      ],
      direction: 'up',
      cursor: 0,
      visibleRows: 3,
      onSubmit: () => {},
    });
    const h = 10;
    const lines = render(view, 40, h);
    // visibleCount=3: rows at y=0,1,2; separator at y=3. The wrapper
    // is expected to shift these so the separator lands right above
    // the input prompt and the list sits above it.
    expect(lines[0]).toContain('Alpha');
    expect(lines[1]).toContain('Beta');
    expect(lines[2]).toContain('Gamma');
    expect(lines[3].trim()).toMatch(/─/);
  });

  test('upward separator uses full width with no side indent', () => {
    const width = 16;
    const view = new SelectView<string>({
      options: [
        { value: 'a', label: 'Alpha' },
        { value: 'b', label: 'Beta' },
      ],
      direction: 'up',
      visibleRows: 2,
      onSubmit: () => {},
    });
    const lines = render(view, width, 4);
    expect(lines[2]).toBe('─'.repeat(width));
  });

  test('empty filtered list → no render (no crash)', () => {
    const view = new SelectView<string>({
      options: [],
      direction: 'up',
      onSubmit: () => {},
    });
    const lines = render(view, 40, 5);
    for (const l of lines) expect(l.trim()).toBe('');
  });

  test('upward respects external cursor for highlight', () => {
    const view = new SelectView<string>({
      options: [
        { value: 'a', label: 'Alpha' },
        { value: 'b', label: 'Beta' },
      ],
      direction: 'up',
      cursor: 1,
      visibleRows: 2,
      onSubmit: () => {},
    });
    const lines = render(view, 40, 5);
    // rows at y=0 (Alpha) and y=1 (Beta). cursor=1 → Beta highlighted.
    expect(lines[1]).toContain('▸');
  });
});

// ── KX5-a additions ────────────────────────────────────────────────

describe('SelectView — externalFilter', () => {
  test('with externalFilter:true, non-empty query does NOT filter', () => {
    const view = new SelectView<string>({
      options: [
        { value: 'a', label: 'Alpha' },
        { value: 'b', label: 'Beta' },
      ],
      searchable: true,
      externalFilter: true,
      query: 'xyz', // would normally filter everything out
      onSubmit: () => {},
    });
    const lines = render(view);
    expect(lines.join('\n')).toContain('Alpha');
    expect(lines.join('\n')).toContain('Beta');
  });

  test('without externalFilter, non-matching query hides all', () => {
    const view = new SelectView<string>({
      options: [
        { value: 'a', label: 'Alpha' },
        { value: 'b', label: 'Beta' },
      ],
      searchable: true,
      query: 'xyz',
      onSubmit: () => {},
    });
    const lines = render(view);
    expect(lines.join('\n')).not.toContain('Alpha');
    expect(lines.join('\n')).not.toContain('Beta');
  });
});

describe('SelectView — emptyPlaceholder', () => {
  test('renders placeholder when filtered set is empty', () => {
    const view = new SelectView<string>({
      options: [],
      emptyPlaceholder: '(no matches)',
      onSubmit: () => {},
    });
    const lines = render(view);
    expect(lines.join('\n')).toContain('(no matches)');
  });

  test('placeholder skipped when filtered has rows', () => {
    const view = new SelectView<string>({
      options: [{ value: 'a', label: 'Alpha' }],
      emptyPlaceholder: '(no matches)',
      onSubmit: () => {},
    });
    const lines = render(view);
    expect(lines.join('\n')).toContain('Alpha');
    expect(lines.join('\n')).not.toContain('(no matches)');
  });
});

describe('SelectView — cursor/query as getter', () => {
  test('getter form is re-invoked across draws', () => {
    let cur = 0;
    const view = new SelectView<string>({
      options: [
        { value: 'a', label: 'Alpha' },
        { value: 'b', label: 'Beta' },
      ],
      cursor: () => cur,
      onSubmit: () => {},
    });
    let lines = render(view);
    expect(lines[0]).toContain('▸');
    expect(lines[0]).toContain('Alpha');
    cur = 1;
    lines = render(view);
    expect(lines[1]).toContain('▸');
    expect(lines[1]).toContain('Beta');
  });
});
