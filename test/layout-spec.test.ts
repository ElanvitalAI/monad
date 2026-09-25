// R2 — LayoutSpec resolver tests.

import { describe, expect, test } from 'bun:test';

import {
  resolveLayoutSpec,
  type LayoutEnv,
  type LayoutSpec,
} from '../src/display/layout-spec.js';

const TERM_24x80: LayoutEnv = { term: { rows: 24, cols: 80 } };

describe('LayoutSpec · absolute anchor', () => {
  test('returns the declared rect verbatim', () => {
    const spec: LayoutSpec = {
      anchor: { kind: 'absolute', rect: { row: 5, col: 10, width: 20, height: 6 } },
    };
    expect(resolveLayoutSpec(spec, TERM_24x80)).toEqual({
      row: 5, col: 10, width: 20, height: 6,
    });
  });

  test('clamps to terminal when rect overflows', () => {
    const spec: LayoutSpec = {
      anchor: { kind: 'absolute', rect: { row: 20, col: 70, width: 30, height: 10 } },
    };
    // rect goes to row 29 (> 24), col 99 (> 80). Clamp right=80, bottom=24.
    const r = resolveLayoutSpec(spec, TERM_24x80);
    expect(r.row).toBe(20);
    expect(r.col).toBe(70);
    expect(r.width).toBe(11);   // 80 - 70 + 1
    expect(r.height).toBe(5);   // 24 - 20 + 1
  });
});

describe('LayoutSpec · above-input anchor', () => {
  const env: LayoutEnv = {
    term: { rows: 24, cols: 80 },
    inputZone: { row: 22, col: 1, width: 80, height: 2 },
  };

  test('default height = term height - input height - 1 (room for prompt)', () => {
    const spec: LayoutSpec = {
      anchor: { kind: 'above-input' },
    };
    const r = resolveLayoutSpec(spec, env);
    // Default height = 24 - 2 - 0 - 1 = 21. row = max(1, 22 - 0 - 21) = 1.
    expect(r.row).toBe(1);
    expect(r.col).toBe(1);
    expect(r.width).toBe(80);
    expect(r.height).toBe(21);
  });

  test('preferredHeight honored; sits directly above input zone', () => {
    const spec: LayoutSpec = {
      anchor: { kind: 'above-input' },
      preferredHeight: 6,
    };
    const r = resolveLayoutSpec(spec, env);
    // row = 22 - 6 = 16
    expect(r.row).toBe(16);
    expect(r.height).toBe(6);
    expect(r.col).toBe(1);
    expect(r.width).toBe(80);
  });

  test('paddingRows adds gap between surface and input', () => {
    const spec: LayoutSpec = {
      anchor: { kind: 'above-input', paddingRows: 2 },
      preferredHeight: 5,
    };
    const r = resolveLayoutSpec(spec, env);
    // row = 22 - 2 - 5 = 15
    expect(r.row).toBe(15);
    expect(r.height).toBe(5);
  });

  test('width=number picks explicit width', () => {
    const spec: LayoutSpec = {
      anchor: { kind: 'above-input' },
      preferredWidth: 40,
      preferredHeight: 4,
    };
    const r = resolveLayoutSpec(spec, env);
    expect(r.width).toBe(40);
  });

  test('width="fill" matches input zone width', () => {
    const narrow: LayoutEnv = {
      ...env,
      inputZone: { row: 22, col: 10, width: 60, height: 2 },
    };
    const spec: LayoutSpec = {
      anchor: { kind: 'above-input' },
      preferredWidth: 'fill',
      preferredHeight: 4,
    };
    const r = resolveLayoutSpec(spec, narrow);
    expect(r.col).toBe(10);
    expect(r.width).toBe(60);
  });

  test('missing inputZone → empty rect (fail-closed)', () => {
    const spec: LayoutSpec = {
      anchor: { kind: 'above-input' },
      preferredHeight: 6,
    };
    const r = resolveLayoutSpec(spec, { term: { rows: 24, cols: 80 } });
    expect(r.width).toBe(0);
    expect(r.height).toBe(0);
  });
});

describe('LayoutSpec · overlay-center anchor', () => {
  test('centers in terminal with default padding', () => {
    const spec: LayoutSpec = {
      anchor: { kind: 'overlay-center' },
      preferredWidth: 40,
      preferredHeight: 10,
    };
    const r = resolveLayoutSpec(spec, TERM_24x80);
    // row = floor((24 - 10) / 2) + 1 = 8. col = floor((80 - 40) / 2) + 1 = 21.
    expect(r.row).toBe(8);
    expect(r.col).toBe(21);
    expect(r.width).toBe(40);
    expect(r.height).toBe(10);
  });

  test('explicit padding forces minimum margin', () => {
    const spec: LayoutSpec = {
      anchor: { kind: 'overlay-center', paddingRows: 5, paddingCols: 10 },
      preferredWidth: 'fill',
      preferredHeight: 'fill' as unknown as number, // TS: force 'fill' into height
    };
    const r = resolveLayoutSpec({ ...spec, preferredHeight: undefined }, TERM_24x80);
    // maxWidth = 80 - 20 = 60. maxHeight = 24 - 10 = 14.
    expect(r.width).toBe(60);
    expect(r.height).toBe(14);
  });

  test('minWidth / minHeight respected, recentered after clamp', () => {
    const spec: LayoutSpec = {
      anchor: { kind: 'overlay-center' },
      preferredWidth: 10,
      preferredHeight: 4,
      minWidth: 20,
      minHeight: 8,
    };
    const r = resolveLayoutSpec(spec, TERM_24x80);
    expect(r.width).toBe(20);
    expect(r.height).toBe(8);
    // Recentered: row = floor((24 - 8) / 2) + 1 = 9. col = floor((80 - 20) / 2) + 1 = 31.
    expect(r.row).toBe(9);
    expect(r.col).toBe(31);
  });

  test('maxWidth / maxHeight cap preferred size', () => {
    const spec: LayoutSpec = {
      anchor: { kind: 'overlay-center' },
      preferredWidth: 200,
      preferredHeight: 200,
      maxWidth: 50,
      maxHeight: 15,
    };
    const r = resolveLayoutSpec(spec, TERM_24x80);
    expect(r.width).toBe(50);
    expect(r.height).toBe(15);
  });
});

describe('LayoutSpec · bottom-right anchor', () => {
  test('pins to bottom-right with default margin', () => {
    const spec: LayoutSpec = {
      anchor: { kind: 'bottom-right' },
      preferredWidth: 20,
      preferredHeight: 5,
    };
    const r = resolveLayoutSpec(spec, TERM_24x80);
    // row = 24 - 1 - 5 + 1 = 19. col = 80 - 2 - 20 + 1 = 59.
    expect(r.row).toBe(19);
    expect(r.col).toBe(59);
    expect(r.width).toBe(20);
    expect(r.height).toBe(5);
  });

  test('custom margin shifts away from the corner', () => {
    const spec: LayoutSpec = {
      anchor: { kind: 'bottom-right', marginRows: 3, marginCols: 5 },
      preferredWidth: 20,
      preferredHeight: 5,
    };
    const r = resolveLayoutSpec(spec, TERM_24x80);
    // row = 24 - 3 - 5 + 1 = 17. col = 80 - 5 - 20 + 1 = 56.
    expect(r.row).toBe(17);
    expect(r.col).toBe(56);
  });
});

describe('LayoutSpec · opaque hint', () => {
  test('carried through the spec (metadata, not consumed by resolver)', () => {
    const spec: LayoutSpec = {
      anchor: { kind: 'absolute', rect: { row: 1, col: 1, width: 10, height: 5 } },
      opaque: true,
    };
    // Resolver doesn't touch opaque — it's advisory for the future
    // compositor. This test locks the shape so consumers can
    // depend on reading spec.opaque in their paint pipeline.
    expect(spec.opaque).toBe(true);
  });
});
