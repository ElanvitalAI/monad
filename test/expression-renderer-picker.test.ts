import { describe, expect, test } from 'bun:test';
import { renderPicker, filterPickerRanked, wrapPickerText } from '../src/expression/index.js';
import type { PickerSpec } from '../src/expression/index.js';

const stripAnsi = (s: string) => s.replace(/\x1b\[[\d;]*m/g, '');

const baseItems = [
  { id: 'a', label: 'Apple' },
  { id: 'b', label: 'Banana' },
  { id: 'c', label: 'Cherry' },
];

describe('expression/renderer/picker · cursor + filter', () => {
  test('basic 3-row list with cursor at 0', () => {
    const spec: PickerSpec = { kind: 'picker', id: 'p', items: baseItems };
    const out = stripAnsi(renderPicker(spec, 'mono'));
    const lines = out.split('\n');
    expect(lines[0]).toContain('▸ Apple');
    expect(lines[1]).toContain('  Banana');
    expect(lines[2]).toContain('  Cherry');
  });

  test('opts.cursor moves the marker', () => {
    const spec: PickerSpec = { kind: 'picker', id: 'p', items: baseItems };
    const out = stripAnsi(renderPicker(spec, 'mono', { cursor: 2 }));
    const lines = out.split('\n');
    expect(lines[0]).toContain('  Apple');
    expect(lines[1]).toContain('  Banana');
    expect(lines[2]).toContain('▸ Cherry');
  });

  test('cursor clamps to bounds (negative + over-length)', () => {
    const spec: PickerSpec = { kind: 'picker', id: 'p', items: baseItems };
    const negOut = stripAnsi(renderPicker(spec, 'mono', { cursor: -5 }));
    const overOut = stripAnsi(renderPicker(spec, 'mono', { cursor: 99 }));
    expect(negOut.split('\n')[0]).toContain('▸ Apple');
    expect(overOut.split('\n')[2]).toContain('▸ Cherry');
  });

  test('query filters and re-ranks items', () => {
    const items = [
      { id: 'a', label: 'apple pie' },
      { id: 'p', label: 'pineapple' },
      { id: 'b', label: 'banana bread' },
    ];
    const spec: PickerSpec = { kind: 'picker', id: 'p', items, query: 'apple' };
    const out = stripAnsi(renderPicker(spec, 'mono'));
    expect(out).toContain('apple pie');
    expect(out).toContain('pineapple');
    expect(out).not.toContain('banana');
  });

  test('empty filter result shows hint with query', () => {
    const spec: PickerSpec = {
      kind: 'picker',
      id: 'p',
      items: baseItems,
      query: 'zzz',
    };
    const out = stripAnsi(renderPicker(spec, 'mono'));
    expect(out).toContain('No results for "zzz"');
  });

  test('empty items shows "No items." hint', () => {
    const spec: PickerSpec = { kind: 'picker', id: 'p', items: [] };
    const out = stripAnsi(renderPicker(spec, 'mono'));
    expect(out).toContain('No items');
  });

  test('title prefix renders before items', () => {
    const spec: PickerSpec = {
      kind: 'picker',
      id: 'p',
      title: 'Choose flavor',
      items: baseItems,
    };
    const out = stripAnsi(renderPicker(spec, 'mono'));
    const lines = out.split('\n');
    expect(lines[0]).toContain('Choose flavor');
    expect(lines[1]).toContain('Apple');
  });
});

describe('expression/renderer/picker · descriptions + hints', () => {
  test('description renders on indented line below the row', () => {
    const items = [
      { id: 'a', label: 'Apple', description: 'A red round fruit.' },
      { id: 'b', label: 'Banana' },
    ];
    const spec: PickerSpec = { kind: 'picker', id: 'p', items };
    const out = stripAnsi(renderPicker(spec, 'mono'));
    const lines = out.split('\n');
    expect(lines[0]).toContain('Apple');
    expect(lines[1]).toContain('A red round fruit');
    // Description starts with 4-space indent.
    expect(lines[1]).toMatch(/^    /);
    expect(lines[2]).toContain('Banana');
  });

  test('long descriptions wrap at width', () => {
    const items = [
      {
        id: 'a',
        label: 'A',
        description:
          'This is a fairly long description that should wrap at the requested width budget.',
      },
    ];
    const spec: PickerSpec = { kind: 'picker', id: 'p', items };
    const out = stripAnsi(renderPicker(spec, 'mono', { width: 30 }));
    const descLines = out.split('\n').filter((l) => l.trim().length > 0).slice(1);
    expect(descLines.length).toBeGreaterThan(1);
  });

  test('hint renders inline after label', () => {
    const items = [{ id: 'a', label: 'Apple', hint: 'most popular' }];
    const spec: PickerSpec = { kind: 'picker', id: 'p', items };
    const out = stripAnsi(renderPicker(spec, 'mono'));
    expect(out).toContain('Apple');
    expect(out).toContain('most popular');
  });

  test('disabled items render struck-through with reason', () => {
    const items = [
      {
        id: 'a',
        label: 'Beta API',
        disabled: true,
        disabled_reason: 'requires opt-in',
      },
    ];
    const spec: PickerSpec = { kind: 'picker', id: 'p', items };
    const out = stripAnsi(renderPicker(spec, 'mono'));
    expect(out).toContain('Beta API');
    expect(out).toContain('requires opt-in');
  });
});

describe('expression/renderer/picker · multi-select', () => {
  test('multi=true with selected set renders [x] / [ ] checkboxes', () => {
    const spec: PickerSpec = {
      kind: 'picker',
      id: 'p',
      multi: true,
      items: baseItems,
    };
    const selected = new Set(['a', 'c']);
    const out = stripAnsi(renderPicker(spec, 'mono', { selected }));
    expect(out).toContain('[x] Apple');
    expect(out).toContain('[ ] Banana');
    expect(out).toContain('[x] Cherry');
  });

  test('multi=false omits checkboxes even when selected provided', () => {
    const spec: PickerSpec = { kind: 'picker', id: 'p', items: baseItems };
    const out = stripAnsi(renderPicker(spec, 'mono', { selected: new Set(['a']) }));
    expect(out).not.toContain('[x]');
    expect(out).not.toContain('[ ]');
  });
});

describe('expression/renderer/picker · ANSI emission', () => {
  test('mono profile emits zero CSI', () => {
    const spec: PickerSpec = {
      kind: 'picker',
      id: 'p',
      title: 'Pick',
      items: baseItems,
    };
    const out = renderPicker(spec, 'mono');
    expect(out).not.toContain('\x1b[');
  });

  test('truecolor profile emits SGR for cursor row', () => {
    const spec: PickerSpec = { kind: 'picker', id: 'p', items: baseItems };
    const out = renderPicker(spec, 'truecolor');
    expect(out).toContain('\x1b[38;2;');
    expect(out).toContain('\x1b[1m'); // cursor row is bold
  });

  test('highlightMatches=true wraps matched chars with accent SGR', () => {
    const items = [{ id: 'a', label: 'apple' }];
    const spec: PickerSpec = { kind: 'picker', id: 'p', items, query: 'pl' };
    const plain = renderPicker(spec, 'truecolor');
    const lit = renderPicker(spec, 'truecolor', { highlightMatches: true });
    expect(plain).not.toBe(lit);
    expect(lit).toContain('\x1b[38;2;');
  });
});

describe('expression/renderer/picker · purity', () => {
  test('same input → same output', () => {
    const spec: PickerSpec = {
      kind: 'picker',
      id: 'p',
      items: baseItems,
      query: 'a',
    };
    const a = renderPicker(spec, 'truecolor', { cursor: 1 });
    const b = renderPicker(spec, 'truecolor', { cursor: 1 });
    expect(a).toBe(b);
  });
});

describe('expression/renderer/picker · helpers', () => {
  test('filterPickerRanked exposes the ranked list', () => {
    const spec: PickerSpec = {
      kind: 'picker',
      id: 'p',
      items: baseItems,
      query: 'an',
    };
    const ranked = filterPickerRanked(spec);
    expect(ranked.length).toBe(1);
    expect(ranked[0]!.item.id).toBe('b');
  });

  test('wrapPickerText breaks on whitespace within budget', () => {
    expect(wrapPickerText('one two three four', 10)).toEqual([
      'one two',
      'three four',
    ]);
  });

  test('wrapPickerText returns single line when text fits', () => {
    expect(wrapPickerText('short', 100)).toEqual(['short']);
  });

  test('wrapPickerText handles zero/negative width by returning original', () => {
    expect(wrapPickerText('something', 0)).toEqual(['something']);
    expect(wrapPickerText('something', -1)).toEqual(['something']);
  });
});
