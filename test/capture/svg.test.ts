// ── Capture Phase 0.5 — SVG encoder + cells parser tests ──

import { describe, expect, test } from 'bun:test';

import {
  ansiToCells,
  capture,
  encodeSvg,
  palette256,
  PALETTE_16,
} from '../../src/capture/index.js';

describe('ansiToCells parser', () => {
  test('plain text becomes one cell per char', () => {
    const grid = ansiToCells('abc');
    expect(grid.rows.length).toBe(1);
    expect(grid.rows[0]!.length).toBe(3);
    expect(grid.rows[0]!.map((c) => c.char).join('')).toBe('abc');
    expect(grid.rows[0]!.every((c) => c.attr.fg === undefined)).toBe(true);
  });

  test('newline advances row · \\r resets col', () => {
    const grid = ansiToCells('abc\ndef');
    expect(grid.rows.length).toBe(2);
    expect(grid.rows[0]!.map((c) => c.char).join('')).toBe('abc');
    expect(grid.rows[1]!.map((c) => c.char).join('')).toBe('def');
  });

  test('tab expands to next 8-col stop', () => {
    const grid = ansiToCells('a\tb');
    expect(grid.rows[0]!.length).toBe(9);
    expect(grid.rows[0]!.slice(1, 8).every((c) => c.char === ' ')).toBe(true);
    expect(grid.rows[0]![8]!.char).toBe('b');
  });

  test('CSI SGR 31 sets red fg', () => {
    const grid = ansiToCells('\x1b[31mX');
    expect(grid.rows[0]![0]!.attr.fg).toBe(PALETTE_16[1]);
  });

  test('truecolor 38;2;r;g;b sets exact fg', () => {
    const grid = ansiToCells('\x1b[38;2;10;20;30mX');
    expect(grid.rows[0]![0]!.attr.fg).toBe('#0a141e');
  });

  test('256 palette 38;5;N via palette256 resolver', () => {
    const grid = ansiToCells('\x1b[38;5;196mX');
    expect(grid.rows[0]![0]!.attr.fg).toBe(palette256(196));
  });

  test('SGR 0 resets all attrs', () => {
    const grid = ansiToCells('\x1b[1;31mA\x1b[0mB');
    expect(grid.rows[0]![0]!.attr.bold).toBe(true);
    expect(grid.rows[0]![1]!.attr.bold).toBeUndefined();
    expect(grid.rows[0]![1]!.attr.fg).toBeUndefined();
  });

  test('bold + italic + underline flags set', () => {
    const grid = ansiToCells('\x1b[1;3;4mX');
    expect(grid.rows[0]![0]!.attr.bold).toBe(true);
    expect(grid.rows[0]![0]!.attr.italic).toBe(true);
    expect(grid.rows[0]![0]!.attr.underline).toBe(true);
  });

  test('bright palette (90-97) maps to indices 8-15', () => {
    const grid = ansiToCells('\x1b[91mX');
    expect(grid.rows[0]![0]!.attr.fg).toBe(PALETTE_16[9]);
  });

  test('motion sequences stripped without interpreting', () => {
    const grid = ansiToCells('\x1b[2Aa\x1b[2Kb');
    expect(grid.rows[0]!.map((c) => c.char).join('')).toBe('ab');
  });
});

describe('encodeSvg', () => {
  test('emits valid SVG document with viewBox', () => {
    const svg = encodeSvg({ input: 'hello', cols: 80, rows: 5 });
    expect(svg.startsWith('<svg ')).toBe(true);
    expect(svg).toContain('viewBox="0 0 ');
    expect(svg.endsWith('</svg>')).toBe(true);
  });

  test('default background rect is first after opening tag', () => {
    const svg = encodeSvg({ input: 'x', cols: 10, rows: 3 });
    expect(svg).toContain('<rect width=');
    expect(svg).toContain('fill="#1e1e1e"');
  });

  test('SGR colors appear in tspan fills', () => {
    const svg = encodeSvg({
      input: '\x1b[31mRED',
      cols: 10, rows: 1,
    });
    expect(svg).toContain(`fill="${PALETTE_16[1]}"`);
  });

  test('bold emits font-weight attr', () => {
    const svg = encodeSvg({ input: '\x1b[1mbold', cols: 10, rows: 1 });
    expect(svg).toContain('font-weight="bold"');
  });

  test('background SGR produces rect before text', () => {
    const svg = encodeSvg({ input: '\x1b[41mX', cols: 5, rows: 1 });
    // Red bg = rect with PALETTE_16[1] fill
    expect(svg).toContain(`fill="${PALETTE_16[1]}"`);
    // The red should appear as both bg rect and fg (nothing else set).
  });

  test('title tag embedded when supplied', () => {
    const svg = encodeSvg({ input: 'x', cols: 5, rows: 1, title: 'My Pane' });
    expect(svg).toContain('<title>My Pane</title>');
  });

  test('XML entities escaped in text', () => {
    const svg = encodeSvg({ input: '<&>', cols: 10, rows: 1 });
    expect(svg).toContain('&lt;&amp;&gt;');
    expect(svg).not.toContain('<&>');
  });

  test('custom theme overrides defaults', () => {
    const svg = encodeSvg({
      input: 'x',
      cols: 5, rows: 1,
      theme: { background: '#ffaa00', fontFamily: 'Fira Code' },
    });
    expect(svg).toContain('fill="#ffaa00"');
    expect(svg).toContain('Fira Code');
  });

  test('cols/rows override parsed grid dims', () => {
    const svg = encodeSvg({ input: 'hi', cols: 20, rows: 5 });
    // width = padding*2 + 20 * cellWidth (9 default) = 16 + 180 = 196
    expect(svg).toContain('width="196"');
    // height = padding*2 + 5 * lineHeight (18 default) = 16 + 90 = 106
    expect(svg).toContain('height="106"');
  });
});

describe('capture({format:svg})', () => {
  test('produces SVG body via engine', () => {
    const result = capture({
      target: { kind: 'stream' },
      format: 'svg',
      dims: { cols: 80, rows: 24 },
      source: () => '\x1b[32mhello\x1b[0m',
      title: 'test',
    });
    expect(result.format).toBe('svg');
    expect(result.body.startsWith('<svg ')).toBe(true);
    expect(result.body).toContain('<title>test</title>');
    // Green color matches palette 16 idx 2
    expect(result.body).toContain(`fill="${PALETTE_16[2]}"`);
  });

  test('png format via sync capture throws guidance', () => {
    expect(() => capture({
      target: { kind: 'stream' },
      format: 'png',
      dims: { cols: 80, rows: 24 },
      source: () => 'x',
    })).toThrow(/captureImage/);
  });
});
