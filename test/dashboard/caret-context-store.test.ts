// ── T2 (Phase 1) — caret-context-store tests ──

import { describe, expect, test } from 'bun:test';
import {
  createCaretContextStore,
  formatCaretPromptFragment,
  type CaretContextEntry,
} from '../../src/dashboard/terminal/caret-context-store';

function entry(opts: Partial<CaretContextEntry> = {}): CaretContextEntry {
  return {
    surfaceId: opts.surfaceId ?? 's1',
    paneKind: opts.paneKind ?? 'preview-terminal',
    row: opts.row ?? 0,
    col: opts.col ?? 0,
    at: opts.at ?? 1000,
  };
}

describe('createCaretContextStore', () => {
  test('peek returns pushed entries in order', () => {
    const s = createCaretContextStore();
    s.push(entry({ row: 1 }));
    s.push(entry({ row: 2 }));
    expect(s.peek().map((e) => e.row)).toEqual([1, 2]);
  });

  test('drain returns + clears', () => {
    const s = createCaretContextStore();
    s.push(entry({ row: 1 }));
    s.push(entry({ row: 2 }));
    expect(s.drain().map((e) => e.row)).toEqual([1, 2]);
    expect(s.peek()).toEqual([]);
    expect(s.size()).toBe(0);
  });

  test('ring caps at default size 4', () => {
    const s = createCaretContextStore();
    for (let i = 0; i < 10; i += 1) s.push(entry({ row: i }));
    const peek = s.peek();
    expect(peek).toHaveLength(4);
    expect(peek.map((e) => e.row)).toEqual([6, 7, 8, 9]);
  });

  test('custom ring size honored', () => {
    const s = createCaretContextStore({ ringSize: 2 });
    for (let i = 0; i < 5; i += 1) s.push(entry({ row: i }));
    expect(s.peek().map((e) => e.row)).toEqual([3, 4]);
  });
});

describe('formatCaretPromptFragment', () => {
  test('null on empty', () => {
    expect(formatCaretPromptFragment([])).toBeNull();
  });

  test('single entry includes surface + row + col', () => {
    const text = formatCaretPromptFragment([entry({ row: 5, col: 7 })]);
    expect(text).toContain('row=5');
    expect(text).toContain('col=7');
    expect(text).toContain('<recent-mouse-context>');
    expect(text).toContain('</recent-mouse-context>');
  });

  test('multiple entries each on their own line', () => {
    const text = formatCaretPromptFragment([
      entry({ row: 1 }),
      entry({ row: 2 }),
    ]);
    const inner = text!.split('\n').filter((l) => l.includes('caret'));
    expect(inner).toHaveLength(2);
  });
});
