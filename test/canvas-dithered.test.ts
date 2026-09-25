// Dithered canvas renderer tests — Phase 4c-Q3.

import { describe, expect, test } from 'bun:test';
import { createDitheredCanvas, canvasFactory } from '../src/canvas/index.js';

describe('createDitheredCanvas construction', () => {
  test('rejects sub-1 sizes', () => {
    expect(() => createDitheredCanvas(0, 1)).toThrow();
    expect(() => createDitheredCanvas(1, 0)).toThrow();
  });

  test('1×1 subcells — cell dims == pixel dims', () => {
    const c = createDitheredCanvas(8, 3);
    expect(c.cellWidth).toBe(8);
    expect(c.cellHeight).toBe(3);
    expect(c.width).toBe(8);
    expect(c.height).toBe(3);
    expect(c.mode).toBe('dithered');
  });

  test('empty canvas renders as spaces', () => {
    const c = createDitheredCanvas(5, 2);
    expect(c.render()).toEqual(['     ', '     ']);
  });
});

describe('dithered level mapping', () => {
  test('level 0 renders as space', () => {
    const c = createDitheredCanvas(1, 1);
    c.setLevel(0, 0, 0);
    expect(c.render()[0]).toBe(' ');
  });

  test('level 25 maps to ░ (bucket 0, floor(25/52) = 0) — empty space actually', () => {
    // level > 0 but < 52 → floor(level/52) = 0 → SHADE_RAMP[0] = space.
    const c = createDitheredCanvas(1, 1);
    c.setLevel(0, 0, 25);
    expect(c.render()[0]).toBe(' ');
  });

  test('level 60 → ░ (bucket 1)', () => {
    const c = createDitheredCanvas(1, 1);
    c.setLevel(0, 0, 60);
    expect(c.render()[0]).toBe('\u2591');
  });

  test('level 110 → ▒ (bucket 2)', () => {
    const c = createDitheredCanvas(1, 1);
    c.setLevel(0, 0, 110);
    expect(c.render()[0]).toBe('\u2592');
  });

  test('level 170 → ▓ (bucket 3)', () => {
    const c = createDitheredCanvas(1, 1);
    c.setLevel(0, 0, 170);
    expect(c.render()[0]).toBe('\u2593');
  });

  test('level 255 → █ (bucket 4)', () => {
    const c = createDitheredCanvas(1, 1);
    c.setLevel(0, 0, 255);
    expect(c.render()[0]).toBe('\u2588');
  });

  test('negative level clamps to 0', () => {
    const c = createDitheredCanvas(1, 1);
    c.setLevel(0, 0, -50);
    expect(c.getLevel(0, 0)).toBe(0);
    expect(c.render()[0]).toBe(' ');
  });

  test('level > 255 clamps to 255', () => {
    const c = createDitheredCanvas(1, 1);
    c.setLevel(0, 0, 500);
    expect(c.getLevel(0, 0)).toBe(255);
    expect(c.render()[0]).toBe('\u2588');
  });

  test('NaN level becomes 0', () => {
    const c = createDitheredCanvas(1, 1);
    c.setLevel(0, 0, NaN);
    expect(c.getLevel(0, 0)).toBe(0);
  });
});

describe('Canvas-interface compatibility', () => {
  test('set(true) paints full level 255', () => {
    const c = createDitheredCanvas(1, 1);
    c.set(0, 0, true);
    expect(c.getLevel(0, 0)).toBe(255);
    expect(c.get(0, 0)).toBe(true);
  });

  test('set(false) clears to 0', () => {
    const c = createDitheredCanvas(1, 1);
    c.set(0, 0, true);
    c.set(0, 0, false);
    expect(c.getLevel(0, 0)).toBe(0);
  });

  test('toggle flips between 0 and 255', () => {
    const c = createDitheredCanvas(1, 1);
    c.toggle(0, 0);
    expect(c.getLevel(0, 0)).toBe(255);
    c.toggle(0, 0);
    expect(c.getLevel(0, 0)).toBe(0);
  });

  test('clear drops all', () => {
    const c = createDitheredCanvas(3, 2);
    c.setLevel(0, 0, 100);
    c.setLevel(2, 1, 200);
    c.clear();
    expect(c.getLevel(0, 0)).toBe(0);
    expect(c.getLevel(2, 1)).toBe(0);
  });

  test('out-of-bounds operations silent', () => {
    const c = createDitheredCanvas(2, 2);
    expect(() => c.set(-1, 0)).not.toThrow();
    expect(() => c.setLevel(10, 10, 50)).not.toThrow();
    expect(c.getLevel(-1, -1)).toBe(0);
  });

  test('line paints level 255', () => {
    const c = createDitheredCanvas(3, 1);
    c.line(0, 0, 2, 0);
    expect(c.getLevel(0, 0)).toBe(255);
    expect(c.getLevel(1, 0)).toBe(255);
    expect(c.getLevel(2, 0)).toBe(255);
  });

  test('rect paints level 255 on perimeter', () => {
    const c = createDitheredCanvas(4, 4);
    c.rect(0, 0, 4, 4);
    expect(c.getLevel(0, 0)).toBe(255);
    expect(c.getLevel(3, 3)).toBe(255);
    expect(c.getLevel(1, 1)).toBe(0); // interior unfilled
  });
});

describe('fillRect', () => {
  test('fills all pixels in range with level', () => {
    const c = createDitheredCanvas(4, 4);
    c.fillRect(1, 1, 2, 2, 100);
    expect(c.getLevel(1, 1)).toBe(100);
    expect(c.getLevel(2, 1)).toBe(100);
    expect(c.getLevel(1, 2)).toBe(100);
    expect(c.getLevel(2, 2)).toBe(100);
    expect(c.getLevel(0, 0)).toBe(0); // outside
  });

  test('fillRect with zero dim is no-op', () => {
    const c = createDitheredCanvas(3, 3);
    c.fillRect(0, 0, 0, 5, 200);
    for (let y = 0; y < 3; y++)
      for (let x = 0; x < 3; x++)
        expect(c.getLevel(x, y)).toBe(0);
  });

  test('fillRect clamps OOB inside bounds', () => {
    const c = createDitheredCanvas(3, 3);
    c.fillRect(1, 1, 10, 10, 128);
    // Only inside pixels should be set
    expect(c.getLevel(1, 1)).toBe(128);
    expect(c.getLevel(2, 2)).toBe(128);
  });
});

describe('canvasFactory dithered routing', () => {
  test('mode="dithered" returns DitheredCanvas', () => {
    const c = canvasFactory.create(4, 2, 'dithered');
    expect(c.mode).toBe('dithered');
    expect(c.width).toBe(4);
  });
});

describe('render gradient example', () => {
  test('left-to-right gradient spans all 5 shade buckets', () => {
    const c = createDitheredCanvas(5, 1);
    const levels = [0, 60, 110, 170, 255];
    for (let i = 0; i < 5; i++) c.setLevel(i, 0, levels[i]!);
    expect(c.render()[0]).toBe(' \u2591\u2592\u2593\u2588');
  });
});
