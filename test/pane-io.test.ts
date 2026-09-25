// ── Phase E: pane I/O tests ──
//
// Covers listPanes / readPane / writePane for every supported widget
// type + the @pane:<id> token resolver. Works on plain WidgetInstance
// values — no dashboard / widget-host dependency.

import { describe, test, expect } from 'bun:test';
import {
  listPanes, readPane, writePane, widgetCaps, resolvePaneTokens,
} from '../src/agent/pane-io';
import type { WidgetInstance } from '../src/widgets/types';

// ── Helpers ──

function markdown(id: string, text = 'hello'): WidgetInstance {
  return { id, type: 'markdown', character: 'Detail', state: { text, scroll: 0, focused: false } };
}
function list(id: string, items: string[]): WidgetInstance {
  return { id, type: 'list', character: 'List', state: { items, cursor: 0, offset: 0, selected: new Set<string>(), focused: false } };
}
function table(id: string, rows: Record<string, string | number>[], columns: any[] = [{ key: 'a', header: 'A' }, { key: 'b', header: 'B' }]): WidgetInstance {
  return { id, type: 'table', character: 'Table', state: { columns, rows, cursor: -1, offset: 0, focused: false } };
}
function chartLine(id: string, series: number[]): WidgetInstance {
  return { id, type: 'chart-line', character: 'Chart', state: { series, unit: '$', color: 'accent' } };
}
function log(id: string, lines: string[]): WidgetInstance {
  return { id, type: 'log', character: 'Log', state: { lines, scrollOffset: -1, focused: false } };
}
function weird(id: string, type: string): WidgetInstance {
  return { id, type, character: 'weird', state: {} };
}
function declarativeMarkdown(id: string, text = 'hello', title = 'Declarative Note'): WidgetInstance {
  return {
    id,
    type: 'markdown',
    character: 'Detail',
    state: { text, scroll: 0, focused: false },
    meta: {
      declarativeSpec: {
        type: 'markdown',
        chrome: { title },
      },
    },
  };
}

// ═══════════════════════════════════════════
// 1. widgetCaps
// ═══════════════════════════════════════════

describe('widgetCaps', () => {
  test('knows the built-in widget types', () => {
    expect(widgetCaps('markdown').writable).toBe(true);
    expect(widgetCaps('list').readable).toBe(true);
    expect(widgetCaps('table').role).toBe('both');
    expect(widgetCaps('log').role).toBe('sink');
  });

  test('unknown type → all caps false', () => {
    const c = widgetCaps('unknown-type');
    expect(c.readable).toBe(false);
    expect(c.writable).toBe(false);
    expect(c.role).toBe('unknown');
  });
});

// ═══════════════════════════════════════════
// 2. listPanes
// ═══════════════════════════════════════════

describe('listPanes', () => {
  test('returns descriptor per instance with summary + caps', () => {
    const panes = listPanes([
      markdown('m1', 'abc'),
      list('l1', ['a', 'b', 'c']),
      table('t1', [{ a: 1, b: 2 }]),
      chartLine('c1', [1, 2, 3]),
      log('lg1', ['line 1', 'line 2']),
    ]);
    expect(panes).toHaveLength(5);
    expect(panes[0]).toMatchObject({ id: 'm1', type: 'markdown', readable: true, writable: true });
    expect(panes[0]!.summary).toContain('3 chars');
    expect(panes[1]!.summary).toContain('3 items');
    expect(panes[2]!.summary).toContain('1 rows');
    expect(panes[3]!.summary).toContain('3 points');
    expect(panes[4]!.summary).toContain('2 lines');
  });

  test('unknown widget type surfaces with readable=false', () => {
    const panes = listPanes([weird('w1', 'mystery')]);
    expect(panes[0]!.readable).toBe(false);
    expect(panes[0]!.writable).toBe(false);
    expect(panes[0]!.role).toBe('unknown');
  });

  test('declarative chrome title is reflected in pane summaries', () => {
    const panes = listPanes([declarativeMarkdown('m2', 'abc', 'Declarative Detail')]);
    expect(panes[0]!.summary).toContain('Declarative Detail');
  });
});

// ═══════════════════════════════════════════
// 3. readPane
// ═══════════════════════════════════════════

describe('readPane', () => {
  test('markdown → raw text', () => {
    const r = readPane(markdown('m', '## Hello\nworld'));
    expect(r.ok).toBe(true);
    expect(r.text).toBe('## Hello\nworld');
  });

  test('list → newline-joined items + data block', () => {
    const r = readPane(list('l', ['alpha', 'beta']));
    expect(r.ok).toBe(true);
    expect(r.text).toBe('alpha\nbeta');
    expect((r.data as any).items).toEqual(['alpha', 'beta']);
    expect((r.data as any).cursor).toBe(0);
  });

  test('table → header + tab-separated rows', () => {
    const r = readPane(table('t', [{ a: 1, b: 2 }, { a: 3, b: 4 }]));
    expect(r.ok).toBe(true);
    const lines = r.text!.split('\n');
    expect(lines[0]).toBe('A\tB');
    expect(lines[1]).toBe('1\t2');
    expect(lines[2]).toBe('3\t4');
  });

  test('chart-line → comma series + data', () => {
    const r = readPane(chartLine('c', [10, 20, 30]));
    expect(r.text).toBe('10, 20, 30');
    expect((r.data as any).unit).toBe('$');
  });

  test('log → newline-joined lines', () => {
    const r = readPane(log('lg', ['a', 'b']));
    expect(r.text).toBe('a\nb');
  });

  test('unknown type → ok:false with error', () => {
    const r = readPane(weird('w', 'mystery'));
    expect(r.ok).toBe(false);
    expect(r.error).toContain('not readable');
  });
});

// ═══════════════════════════════════════════
// 4. writePane
// ═══════════════════════════════════════════

describe('writePane', () => {
  test('markdown: { text } replaces, { appendText } appends', () => {
    const m = markdown('m', 'orig');
    expect(writePane(m, { text: 'new' }).ok).toBe(true);
    expect((m.state as any).text).toBe('new');
    expect(writePane(m, { appendText: '!' }).ok).toBe(true);
    expect((m.state as any).text).toBe('new!');
  });

  test('markdown: missing both fields returns an error', () => {
    const m = markdown('m');
    const r = writePane(m, {} as any);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('text');
  });

  test('list: { items } replaces, clamps cursor when shrinking', () => {
    const l = list('l', ['a', 'b', 'c']);
    (l.state as any).cursor = 2;
    writePane(l, { items: ['x'] });
    expect((l.state as any).items).toEqual(['x']);
    expect((l.state as any).cursor).toBe(0);
  });

  test('list: { items, selected } accepts Set via array', () => {
    const l = list('l', ['a', 'b']);
    writePane(l, { items: ['a', 'b'], selected: ['a'] });
    const sel = (l.state as any).selected as Set<string>;
    expect(sel.has('a')).toBe(true);
    expect(sel.has('b')).toBe(false);
  });

  test('table: { rows } replaces and clamps cursor', () => {
    const t = table('t', [{ a: 1, b: 2 }, { a: 3, b: 4 }]);
    (t.state as any).cursor = 1;
    writePane(t, { rows: [{ a: 5, b: 6 }] });
    expect((t.state as any).rows).toHaveLength(1);
    expect((t.state as any).cursor).toBe(0);

    writePane(t, { rows: [] });
    expect((t.state as any).cursor).toBe(-1);
  });

  test('chart-line: { series, unit } updates both', () => {
    const c = chartLine('c', [1, 2]);
    writePane(c, { series: [3, 4, 5], unit: '%' });
    expect((c.state as any).series).toEqual([3, 4, 5]);
    expect((c.state as any).unit).toBe('%');
  });

  test('log: { append } pushes one line, { lines } replaces', () => {
    const g = log('lg', ['x']);
    writePane(g, { append: 'y' });
    expect((g.state as any).lines).toEqual(['x', 'y']);
    writePane(g, { lines: ['fresh'] });
    expect((g.state as any).lines).toEqual(['fresh']);
  });

  test('unknown widget type → ok:false', () => {
    const w = weird('w', 'mystery');
    const r = writePane(w, { text: 'x' } as any);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('not writable');
  });

  test('wrong payload shape for a type returns an error', () => {
    const l = list('l', []);
    const r = writePane(l, { text: 'nope' } as any);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('items');
  });
});

// ═══════════════════════════════════════════
// 5. resolvePaneTokens
// ═══════════════════════════════════════════

describe('resolvePaneTokens', () => {
  const panes = new Map<string, WidgetInstance>([
    ['wd-browser', list('wd-browser', ['src/', 'tests/'])],
    ['scratch',    markdown('scratch', 'scratch contents')],
  ]);
  const lookup = (id: string) => panes.get(id) ?? null;

  test('text without tokens passes through unchanged', () => {
    const out = resolvePaneTokens('hi there', lookup);
    expect(out.text).toBe('hi there');
    expect(out.resolved).toEqual([]);
    expect(out.missing).toEqual([]);
  });

  test('single token expands to an inline code-fenced block', () => {
    const out = resolvePaneTokens('list @pane:wd-browser please', lookup);
    expect(out.resolved).toEqual(['wd-browser']);
    expect(out.missing).toEqual([]);
    expect(out.text).toContain('[pane:wd-browser (list)]');
    expect(out.text).toContain('src/');
    expect(out.text).toContain('tests/');
  });

  test('multiple tokens — each resolves independently', () => {
    const out = resolvePaneTokens(
      '@pane:wd-browser and @pane:scratch',
      lookup,
    );
    expect(out.resolved).toEqual(['wd-browser', 'scratch']);
    expect(out.text).toContain('[pane:wd-browser (list)]');
    expect(out.text).toContain('[pane:scratch (markdown)]');
    expect(out.text).toContain('scratch contents');
  });

  test('unknown id → left as literal, reported in missing[]', () => {
    const out = resolvePaneTokens('@pane:ghost right here', lookup);
    expect(out.resolved).toEqual([]);
    expect(out.missing).toEqual(['ghost']);
    expect(out.text).toContain('@pane:ghost');
  });

  test('non-readable widget type → treated as missing', () => {
    const oddMap = new Map<string, WidgetInstance>([
      ['x', weird('x', 'mystery')],
    ]);
    const out = resolvePaneTokens('see @pane:x', (id) => oddMap.get(id) ?? null);
    expect(out.missing).toEqual(['x']);
    expect(out.text).toContain('@pane:x');
  });

  test('id with dots / colons / dashes is recognised', () => {
    const map = new Map<string, WidgetInstance>([
      ['ct-results', table('ct-results', [{ a: 1, b: 2 }])],
    ]);
    const out = resolvePaneTokens('check @pane:ct-results', (id) => map.get(id) ?? null);
    expect(out.resolved).toEqual(['ct-results']);
  });
});
