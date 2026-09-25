// Quadrant canvas renderer tests — Phase 4c-Q2.

import { describe, expect, test } from 'bun:test';
import { createQuadrantCanvas, canvasFactory } from '../src/canvas/index.js';

describe('createQuadrantCanvas construction', () => {
  test('rejects sub-1 sizes', () => {
    expect(() => createQuadrantCanvas(0, 1)).toThrow();
    expect(() => createQuadrantCanvas(1, 0)).toThrow();
  });

  test('cell × 2 = pixel dims', () => {
    const c = createQuadrantCanvas(5, 3);
    expect(c.cellWidth).toBe(5);
    expect(c.cellHeight).toBe(3);
    expect(c.width).toBe(10);
    expect(c.height).toBe(6);
    expect(c.mode).toBe('quadrant');
  });

  test('empty canvas renders as spaces', () => {
    const c = createQuadrantCanvas(3, 2);
    const out = c.render();
    expect(out).toHaveLength(2);
    expect(out[0]).toBe('   ');
    expect(out[1]).toBe('   ');
  });
});

describe('quadrant glyph encoding', () => {
  test('TL only → ▘ (U+2598)', () => {
    const c = createQuadrantCanvas(1, 1);
    c.set(0, 0);
    expect(c.render()[0]).toBe('\u2598');
  });

  test('TR only → ▝ (U+259D)', () => {
    const c = createQuadrantCanvas(1, 1);
    c.set(1, 0);
    expect(c.render()[0]).toBe('\u259D');
  });

  test('BL only → ▖ (U+2596)', () => {
    const c = createQuadrantCanvas(1, 1);
    c.set(0, 1);
    expect(c.render()[0]).toBe('\u2596');
  });

  test('BR only → ▗ (U+2597)', () => {
    const c = createQuadrantCanvas(1, 1);
    c.set(1, 1);
    expect(c.render()[0]).toBe('\u2597');
  });

  test('top half (TL+TR) → ▀ (U+2580)', () => {
    const c = createQuadrantCanvas(1, 1);
    c.set(0, 0); c.set(1, 0);
    expect(c.render()[0]).toBe('\u2580');
  });

  test('bottom half (BL+BR) → ▄ (U+2584)', () => {
    const c = createQuadrantCanvas(1, 1);
    c.set(0, 1); c.set(1, 1);
    expect(c.render()[0]).toBe('\u2584');
  });

  test('left half (TL+BL) → ▌ (U+258C)', () => {
    const c = createQuadrantCanvas(1, 1);
    c.set(0, 0); c.set(0, 1);
    expect(c.render()[0]).toBe('\u258C');
  });

  test('right half (TR+BR) → ▐ (U+2590)', () => {
    const c = createQuadrantCanvas(1, 1);
    c.set(1, 0); c.set(1, 1);
    expect(c.render()[0]).toBe('\u2590');
  });

  test('all 4 lit → █ (U+2588)', () => {
    const c = createQuadrantCanvas(1, 1);
    c.set(0, 0); c.set(1, 0); c.set(0, 1); c.set(1, 1);
    expect(c.render()[0]).toBe('\u2588');
  });

  test('diagonal (TL+BR) → ▚ (U+259A)', () => {
    const c = createQuadrantCanvas(1, 1);
    c.set(0, 0); c.set(1, 1);
    expect(c.render()[0]).toBe('\u259A');
  });

  test('anti-diagonal (TR+BL) → ▞ (U+259E)', () => {
    const c = createQuadrantCanvas(1, 1);
    c.set(1, 0); c.set(0, 1);
    expect(c.render()[0]).toBe('\u259E');
  });
});

describe('quadrant line / rect', () => {
  test('full-width lit line on top row fills ▀ across cells', () => {
    const c = createQuadrantCanvas(3, 1);
    c.line(0, 0, 5, 0);
    expect(c.render()[0]).toBe('\u2580\u2580\u2580');
  });

  test('rect outline 4×4 lights corner pixels', () => {
    const c = createQuadrantCanvas(2, 2);
    c.rect(0, 0, 4, 4);
    expect(c.get(0, 0)).toBe(true);
    expect(c.get(3, 3)).toBe(true);
  });
});

describe('canvasFactory quadrant routing', () => {
  test('mode="quadrant" returns QuadrantCanvas', () => {
    const c = canvasFactory.create(4, 2, 'quadrant');
    expect(c.mode).toBe('quadrant');
    expect(c.width).toBe(8);
  });
});

describe('quadrant render consistency', () => {
  test('row count == cellHeight', () => {
    const c = createQuadrantCanvas(4, 6);
    expect(c.render()).toHaveLength(6);
  });

  test('row length == cellWidth (one char per cell)', () => {
    const c = createQuadrantCanvas(5, 3);
    c.set(0, 0);
    for (const row of c.render()) {
      // Count Unicode codepoints (each quadrant glyph is a single BMP char).
      expect([...row].length).toBe(5);
    }
  });

  test('clear drops all', () => {
    const c = createQuadrantCanvas(2, 2);
    c.set(0, 0); c.set(3, 3);
    c.clear();
    expect(c.render()[0]).toBe('  ');
  });

  test('out-of-bounds silent', () => {
    const c = createQuadrantCanvas(1, 1);
    expect(() => c.set(-1, -1)).not.toThrow();
    expect(c.get(5, 5)).toBe(false);
  });
});
