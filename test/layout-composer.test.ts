import { describe, it, expect } from 'bun:test';
import {
  composeVertical,
  requireZone,
  zoneVisible,
  type LayoutZone,
} from '../src/layout/composer.js';

/** Helper — build a fixed-height zone that renders repeated tokens. */
function fixed(id: string, height: number, token: string = id): LayoutZone {
  return {
    id,
    height,
    render: (h) => Array.from({ length: h }, () => `${token}`),
  };
}

function grow(id: string, weight: number = 1, token: string = id): LayoutZone {
  return {
    id,
    height: weight === 1 ? 'grow' : { grow: weight },
    render: (h) => Array.from({ length: h }, () => `${token}`),
  };
}

describe('composeVertical', () => {
  it('returns empty result for empty zones', () => {
    const r = composeVertical([], { rows: 10, cols: 80 });
    expect(r.lines).toEqual([]);
    expect(r.zoneRows.size).toBe(0);
  });

  it('returns empty result for zero rows', () => {
    const r = composeVertical([fixed('a', 3)], { rows: 0, cols: 80 });
    expect(r.lines).toEqual([]);
  });

  it('allocates a single fixed zone', () => {
    const r = composeVertical([fixed('a', 3, 'A')], { rows: 3, cols: 80 });
    expect(r.lines).toEqual(['A', 'A', 'A']);
    expect(r.zoneRows.get('a')).toEqual({ start: 1, height: 3 });
  });

  it('stacks multiple fixed zones top-to-bottom with 1-indexed starts', () => {
    const r = composeVertical(
      [fixed('a', 2, 'A'), fixed('b', 3, 'B')],
      { rows: 5, cols: 80 },
    );
    expect(r.lines).toEqual(['A', 'A', 'B', 'B', 'B']);
    expect(r.zoneRows.get('a')).toEqual({ start: 1, height: 2 });
    expect(r.zoneRows.get('b')).toEqual({ start: 3, height: 3 });
  });

  it('expands a single grow zone to fill remaining rows', () => {
    const r = composeVertical(
      [fixed('hdr', 1, 'H'), grow('body', 1, 'B'), fixed('ftr', 1, 'F')],
      { rows: 10, cols: 80 },
    );
    expect(r.lines.length).toBe(10);
    expect(r.lines[0]).toBe('H');
    expect(r.lines[9]).toBe('F');
    expect(r.zoneRows.get('body')).toEqual({ start: 2, height: 8 });
  });

  it('splits two equal grow zones evenly', () => {
    const r = composeVertical([grow('a'), grow('b')], { rows: 10, cols: 80 });
    expect(r.zoneRows.get('a')!.height).toBe(5);
    expect(r.zoneRows.get('b')!.height).toBe(5);
    expect(r.lines.length).toBe(10);
  });

  it('splits grow zones by weight', () => {
    const r = composeVertical(
      [grow('a', 1, 'A'), grow('b', 3, 'B')],
      { rows: 12, cols: 80 },
    );
    // 1:3 split over 12 rows → 3:9
    expect(r.zoneRows.get('a')!.height).toBe(3);
    expect(r.zoneRows.get('b')!.height).toBe(9);
  });

  it('puts integer rounding remainder on the first grow zone', () => {
    // 10 rows, three equal grow zones → 10/3 = 3.33… → 4, 3, 3.
    const r = composeVertical(
      [grow('a'), grow('b'), grow('c')],
      { rows: 10, cols: 80 },
    );
    expect(r.zoneRows.get('a')!.height).toBe(4);
    expect(r.zoneRows.get('b')!.height).toBe(3);
    expect(r.zoneRows.get('c')!.height).toBe(3);
    expect(r.lines.length).toBe(10);
  });

  it('collapses grow zones to 0 when fixed zones consume all rows', () => {
    const r = composeVertical(
      [fixed('hdr', 5, 'H'), grow('body', 1, 'B'), fixed('ftr', 5, 'F')],
      { rows: 10, cols: 80 },
    );
    expect(r.zoneRows.get('body')!.height).toBe(0);
    expect(r.lines).toEqual(
      ['H', 'H', 'H', 'H', 'H', 'F', 'F', 'F', 'F', 'F'],
    );
  });

  it('truncates fixed zones (bottom-up) on overflow', () => {
    const r = composeVertical(
      [fixed('a', 4, 'A'), fixed('b', 4, 'B'), fixed('c', 4, 'C')],
      { rows: 6, cols: 80 },
    );
    // Earlier zones get full allocation until space runs out.
    expect(r.zoneRows.get('a')).toEqual({ start: 1, height: 4 });
    expect(r.zoneRows.get('b')).toEqual({ start: 5, height: 2 });
    expect(r.zoneRows.get('c')).toEqual({ start: 7, height: 0 });
    expect(r.lines.length).toBe(6);
  });

  it('treats height 0 as a hidden zone — records but skips render', () => {
    let called = 0;
    const r = composeVertical(
      [
        fixed('a', 2, 'A'),
        { id: 'hidden', height: 0, render: () => { called++; return ['X']; } },
        fixed('b', 2, 'B'),
      ],
      { rows: 10, cols: 80 },
    );
    expect(called).toBe(0);
    expect(r.zoneRows.get('hidden')).toEqual({ start: 3, height: 0 });
    expect(r.lines).toEqual(['A', 'A', 'B', 'B']);
  });

  it('pads zone renders that return fewer lines than allocated', () => {
    const r = composeVertical(
      [{ id: 'a', height: 4, render: () => ['one', 'two'] }],
      { rows: 4, cols: 80 },
    );
    expect(r.lines).toEqual(['one', 'two', '', '']);
  });

  it('truncates zone renders that return more lines than allocated', () => {
    const r = composeVertical(
      [{ id: 'a', height: 2, render: () => ['1', '2', '3', '4'] }],
      { rows: 2, cols: 80 },
    );
    expect(r.lines).toEqual(['1', '2']);
  });

  it('isolates a crashing zone — rest of layout still renders', () => {
    const r = composeVertical(
      [
        fixed('a', 2, 'A'),
        { id: 'crash', height: 2, render: () => { throw new Error('boom'); } },
        fixed('b', 2, 'B'),
      ],
      { rows: 6, cols: 80 },
    );
    expect(r.lines).toEqual(['A', 'A', '', '', 'B', 'B']);
    expect(r.zoneRows.get('crash')).toEqual({ start: 3, height: 2 });
  });

  it('forwards the cols hint to render()', () => {
    let seen = 0;
    composeVertical(
      [{ id: 'a', height: 1, render: (_h, c) => { seen = c; return ['']; } }],
      { rows: 1, cols: 42 },
    );
    expect(seen).toBe(42);
  });

  it('clamps negative rows to 0', () => {
    const r = composeVertical([fixed('a', 3)], { rows: -5, cols: 80 });
    expect(r.lines).toEqual([]);
  });

  it('floors fractional row/col counts', () => {
    const r = composeVertical([fixed('a', 2.8 as any, 'A')], { rows: 5.9, cols: 80 });
    // 2.8 fixed → 2; 5.9 rows → 5.
    expect(r.lines.length).toBe(2);
    expect(r.zoneRows.get('a')!.height).toBe(2);
  });

  it('grow weight 0 acts like fixed 0 (hidden)', () => {
    const r = composeVertical(
      [
        fixed('a', 2, 'A'),
        { id: 'empty', height: { grow: 0 }, render: () => ['x'] },
        grow('body', 1, 'B'),
      ],
      { rows: 6, cols: 80 },
    );
    expect(r.zoneRows.get('empty')!.height).toBe(0);
    expect(r.zoneRows.get('body')!.height).toBe(4);
  });

  it('handles a realistic dashboard shape', () => {
    // Mirrors the monad bottom zone: grid (grow) + log (grow weight 0.3?)
    // + input-deco rows + status rows. We just check zoneRows for a
    // representative mixed layout.
    const result = composeVertical(
      [
        { id: 'grid',          height: 'grow',         render: h => Array(h).fill('G') },
        { id: 'hud',           height: 1,              render: () => ['HUD'] },
        { id: 'log',           height: { grow: 2 },    render: h => Array(h).fill('L') },
        { id: 'sep-top',       height: 1,              render: () => ['──'] },
        { id: 'input',         height: 2,              render: () => ['❯', '·'] },
        { id: 'sep-bottom',    height: 1,              render: () => ['──'] },
        { id: 'status-gap',    height: 2,              render: () => ['', ''] },
        { id: 'primary',       height: 1,              render: () => ['PRI'] },
        { id: 'footer',        height: 1,              render: () => ['FOOT'] },
      ],
      { rows: 40, cols: 100 },
    );
    // Fixed total = 1 + 1 + 2 + 1 + 2 + 1 + 1 = 9 rows.
    // Leftover = 31, weight total = 3, perUnit = 10 → grid=10, log=20.
    // Remainder = 1 → to first grow zone (grid) → grid=11, log=20.
    expect(result.zoneRows.get('grid')!.height).toBe(11);
    expect(result.zoneRows.get('log')!.height).toBe(20);
    expect(result.zoneRows.get('input')!.start).toBe(11 + 1 + 20 + 1 + 1);
    expect(result.lines.length).toBe(40);
    expect(result.lines[result.lines.length - 1]).toBe('FOOT');
  });
});

describe('requireZone', () => {
  it('returns the zone record when present', () => {
    const r = composeVertical([fixed('x', 1)], { rows: 1, cols: 80 });
    expect(requireZone(r, 'x')).toEqual({ start: 1, height: 1 });
  });

  it('throws a descriptive error when missing', () => {
    const r = composeVertical([fixed('x', 1)], { rows: 1, cols: 80 });
    expect(() => requireZone(r, 'missing')).toThrow(/"missing"/);
  });
});

describe('zoneVisible', () => {
  it('true when zone has at least 1 row', () => {
    const r = composeVertical([fixed('x', 2)], { rows: 5, cols: 80 });
    expect(zoneVisible(r, 'x')).toBe(true);
  });

  it('false when zone was declared with height 0', () => {
    const r = composeVertical([fixed('x', 0)], { rows: 5, cols: 80 });
    expect(zoneVisible(r, 'x')).toBe(false);
  });

  it('false when zone collapsed to 0 on overflow', () => {
    const r = composeVertical(
      [fixed('a', 10, 'A'), grow('b')],
      { rows: 5, cols: 80 },
    );
    expect(zoneVisible(r, 'b')).toBe(false);
  });

  it('false for unknown zone id', () => {
    const r = composeVertical([fixed('x', 2)], { rows: 5, cols: 80 });
    expect(zoneVisible(r, 'missing')).toBe(false);
  });
});
