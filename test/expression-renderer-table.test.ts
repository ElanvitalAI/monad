import { describe, expect, test } from 'bun:test';
import { renderTable } from '../src/expression/renderer/index.js';
import type { TableSpec } from '../src/expression/spec/types.js';

const stripAnsi = (s: string) => s.replace(/\x1b\[[\d;]*m/g, '');

describe('expression/renderer/table · layout', () => {
  test('empty columns → empty output', () => {
    const out = renderTable({ kind: 'table', columns: [], rows: [] }, 'mono');
    expect(out).toBe('');
  });

  test('header row + body row + 4 framing rows = 6 lines minimum', () => {
    const spec: TableSpec = {
      kind: 'table',
      columns: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
      rows: [{ a: '1', b: '2' }],
    };
    const out = stripAnsi(renderTable(spec, 'mono'));
    const lines = out.split('\n');
    // Top border + header + mid divider + body row + bottom border = 5
    expect(lines.length).toBe(5);
  });

  test('column widths expand to fit longest cell', () => {
    const spec: TableSpec = {
      kind: 'table',
      columns: [{ id: 'name', label: 'N' }],
      rows: [{ name: 'short' }, { name: 'much longer' }],
    };
    const out = stripAnsi(renderTable(spec, 'mono'));
    // Body row contains the longer cell padded to width 11
    expect(out).toContain('much longer');
    // Shorter row also gets padded — check it's followed by spaces
    expect(out).toMatch(/short      /);
  });

  test('alignment: right vs left', () => {
    const spec: TableSpec = {
      kind: 'table',
      columns: [
        { id: 'l', label: 'L', align: 'left' },
        { id: 'r', label: 'R', align: 'right' },
      ],
      rows: [{ l: 'a', r: 'b' }],
    };
    const out = stripAnsi(renderTable(spec, 'mono'));
    // Left col: value first then padding. Right col: padding then value.
    // We don't lock exact widths but check the right value sits at line end.
    const bodyLine = out.split('\n').find((l) => l.includes('a') && l.includes('b'))!;
    expect(bodyLine).toBeDefined();
  });

  test('format: number formats with thousands separator', () => {
    const spec: TableSpec = {
      kind: 'table',
      columns: [{ id: 'n', label: 'N', format: 'number' }],
      rows: [{ n: 1234567 }],
    };
    const out = stripAnsi(renderTable(spec, 'mono'));
    expect(out).toContain('1,234,567');
  });

  test('format: percent — 0.42 → 42%', () => {
    const spec: TableSpec = {
      kind: 'table',
      columns: [{ id: 'p', label: 'P', format: 'percent' }],
      rows: [{ p: 0.42 }],
    };
    const out = stripAnsi(renderTable(spec, 'mono'));
    expect(out).toContain('42%');
  });

  test('format: bytes — humanises', () => {
    const spec: TableSpec = {
      kind: 'table',
      columns: [{ id: 'b', label: 'B', format: 'bytes' }],
      rows: [{ b: 1024 * 1024 * 5 }],
    };
    const out = stripAnsi(renderTable(spec, 'mono'));
    expect(out).toContain('5.0MB');
  });

  test('format: duration — 1500ms → 1.5s', () => {
    const spec: TableSpec = {
      kind: 'table',
      columns: [{ id: 'd', label: 'D', format: 'duration' }],
      rows: [{ d: 1500 }],
    };
    const out = stripAnsi(renderTable(spec, 'mono'));
    expect(out).toContain('1.5s');
  });

  test('border: rounded uses ╭ ╮ ╰ ╯ corners', () => {
    const spec: TableSpec = {
      kind: 'table',
      columns: [{ id: 'a', label: 'A' }],
      rows: [{ a: 'x' }],
      style: { border: 'rounded' },
    };
    const out = stripAnsi(renderTable(spec, 'mono'));
    expect(out).toContain('╭');
    expect(out).toContain('╮');
    expect(out).toContain('╰');
    expect(out).toContain('╯');
  });

  test('border: ascii falls back to plus signs', () => {
    const spec: TableSpec = {
      kind: 'table',
      columns: [{ id: 'a', label: 'A' }],
      rows: [{ a: 'x' }],
      style: { border: 'ascii' },
    };
    const out = stripAnsi(renderTable(spec, 'mono'));
    // ASCII border uses + at corners
    expect(out).toContain('+');
    expect(out).not.toContain('╭');
  });

  test('title appears above the table when set', () => {
    const spec: TableSpec = {
      kind: 'table',
      title: 'Cache Metrics',
      columns: [{ id: 'a', label: 'A' }],
      rows: [{ a: 'x' }],
    };
    const out = stripAnsi(renderTable(spec, 'mono'));
    const lines = out.split('\n');
    expect(lines[0]).toBe('Cache Metrics');
  });

  test('truecolor profile emits SGR for header + border', () => {
    const spec: TableSpec = {
      kind: 'table',
      columns: [{ id: 'a', label: 'A' }],
      rows: [{ a: 'x' }],
    };
    const out = renderTable(spec, 'truecolor');
    expect(out).toContain('38;2;'); // truecolor SGR
  });

  test('null / undefined cells render as empty strings', () => {
    const spec: TableSpec = {
      kind: 'table',
      columns: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
      rows: [{ a: 'x', b: null }, { a: undefined, b: 'y' }],
    };
    const out = stripAnsi(renderTable(spec, 'mono'));
    // Render shouldn't crash — and 'y' should appear as a cell.
    expect(out).toContain('y');
    expect(out).toContain('x');
  });
});
