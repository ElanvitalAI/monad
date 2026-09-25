// Canvas braille renderer — Phase 4c tests.

import { describe, expect, test } from 'bun:test';
import { createBrailleCanvas, canvasFactory, SUBCELLS } from '../src/canvas/index.js';

describe('SUBCELLS', () => {
  test('braille is 2×4', () => {
    expect(SUBCELLS.braille).toEqual({ w: 2, h: 4 });
  });
  test('quadrant is 2×2', () => {
    expect(SUBCELLS.quadrant).toEqual({ w: 2, h: 2 });
  });
});

describe('createBrailleCanvas construction', () => {
  test('rejects sub-1 sizes', () => {
    expect(() => createBrailleCanvas(0, 1)).toThrow();
    expect(() => createBrailleCanvas(1, 0)).toThrow();
  });

  test('cell dims × subcell dims = pixel dims', () => {
    const c = createBrailleCanvas(5, 3);
    expect(c.cellWidth).toBe(5);
    expect(c.cellHeight).toBe(3);
    expect(c.width).toBe(10);
    expect(c.height).toBe(12);
    expect(c.mode).toBe('braille');
  });

  test('fresh canvas is empty — all render rows are spaces', () => {
    const c = createBrailleCanvas(3, 2);
    const out = c.render();
    expect(out).toHaveLength(2);
    expect(out[0]).toBe('   ');
    expect(out[1]).toBe('   ');
  });
});

describe('set / get / toggle', () => {
  test('set / get round trip', () => {
    const c = createBrailleCanvas(2, 1);
    c.set(0, 0, true);
    expect(c.get(0, 0)).toBe(true);
    expect(c.get(1, 0)).toBe(false);
    c.set(0, 0, false);
    expect(c.get(0, 0)).toBe(false);
  });

  test('out-of-bounds set is silently ignored', () => {
    const c = createBrailleCanvas(1, 1);
    expect(() => c.set(-1, 0)).not.toThrow();
    expect(() => c.set(100, 100)).not.toThrow();
  });

  test('toggle flips', () => {
    const c = createBrailleCanvas(1, 1);
    c.toggle(0, 0);
    expect(c.get(0, 0)).toBe(true);
    c.toggle(0, 0);
    expect(c.get(0, 0)).toBe(false);
  });

  test('clear drops all pixels', () => {
    const c = createBrailleCanvas(2, 1);
    c.set(0, 0);
    c.set(1, 3);
    c.clear();
    expect(c.get(0, 0)).toBe(false);
    expect(c.get(1, 3)).toBe(false);
  });
});

describe('braille codepoint encoding', () => {
  test('dot 1 (col=0 row=0) → U+2801', () => {
    const c = createBrailleCanvas(1, 1);
    c.set(0, 0);
    expect(c.render()[0]).toBe('\u2801');
  });

  test('dot 2 (col=0 row=1) → U+2802', () => {
    const c = createBrailleCanvas(1, 1);
    c.set(0, 1);
    expect(c.render()[0]).toBe('\u2802');
  });

  test('dot 8 (col=1 row=3) → U+2880', () => {
    const c = createBrailleCanvas(1, 1);
    c.set(1, 3);
    expect(c.render()[0]).toBe('\u2880');
  });

  test('all 8 dots set → U+28FF', () => {
    const c = createBrailleCanvas(1, 1);
    for (let x = 0; x < 2; x++) {
      for (let y = 0; y < 4; y++) c.set(x, y);
    }
    expect(c.render()[0]).toBe('\u28FF');
  });

  test('empty cell renders as ASCII space (width predictable)', () => {
    const c = createBrailleCanvas(2, 1);
    c.set(0, 0);
    const row = c.render()[0]!;
    expect(row.length).toBe(2);
    expect(row.charCodeAt(1)).toBe(32); // ' '
  });
});

describe('line / rect', () => {
  test('horizontal line lights every pixel along y', () => {
    const c = createBrailleCanvas(3, 1);
    c.line(0, 0, 5, 0);
    for (let x = 0; x < 6; x++) expect(c.get(x, 0)).toBe(true);
  });

  test('vertical line lights every pixel along x', () => {
    const c = createBrailleCanvas(1, 2);
    c.line(0, 0, 0, 7);
    for (let y = 0; y < 8; y++) expect(c.get(0, y)).toBe(true);
  });

  test('diagonal line touches endpoints and doesn\'t overshoot', () => {
    const c = createBrailleCanvas(3, 2);
    c.line(0, 0, 5, 7);
    expect(c.get(0, 0)).toBe(true);
    expect(c.get(5, 7)).toBe(true);
  });

  test('rect outlines a 4×4 pixel box', () => {
    const c = createBrailleCanvas(2, 1);
    c.rect(0, 0, 4, 4);
    // 4 corners + edges lit
    expect(c.get(0, 0)).toBe(true);
    expect(c.get(3, 0)).toBe(true);
    expect(c.get(0, 3)).toBe(true);
    expect(c.get(3, 3)).toBe(true);
    // Interior pixel not lit
    expect(c.get(1, 1)).toBe(false);
  });

  test('rect with zero dimension is a no-op', () => {
    const c = createBrailleCanvas(2, 1);
    c.rect(0, 0, 0, 5);
    for (let x = 0; x < c.width; x++) {
      for (let y = 0; y < c.height; y++) expect(c.get(x, y)).toBe(false);
    }
  });
});

describe('canvasFactory', () => {
  test('create(w, h) defaults to braille', () => {
    const c = canvasFactory.create(2, 1);
    expect(c.mode).toBe('braille');
    expect(c.width).toBe(4);
  });

  test('create(w, h, "ascii") routes to the ASCII renderer', () => {
    // Post-Q1 (PR #151) ascii is a real renderer, no longer a stub
    // falling back to braille. This test was updated when Q1 landed.
    const c = canvasFactory.create(2, 1, 'ascii');
    expect(c.mode).toBe('ascii');
  });
});

describe('Canvas render consistency', () => {
  test('render output row count matches cellHeight', () => {
    const c = createBrailleCanvas(3, 5);
    expect(c.render()).toHaveLength(5);
  });

  test('every row has exactly cellWidth characters when rows are ASCII-space-padded', () => {
    const c = createBrailleCanvas(4, 2);
    const out = c.render();
    expect(out[0]?.length).toBe(4);
    expect(out[1]?.length).toBe(4);
  });
});
