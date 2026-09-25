// ASCII canvas renderer tests — Phase 4c-Q1.

import { describe, expect, test } from 'bun:test';
import { createAsciiCanvas, canvasFactory } from '../src/canvas/index.js';

describe('createAsciiCanvas construction', () => {
  test('rejects sub-1 sizes', () => {
    expect(() => createAsciiCanvas(0, 1)).toThrow();
    expect(() => createAsciiCanvas(1, 0)).toThrow();
  });

  test('dims match cell dims (1×1 subcells)', () => {
    const c = createAsciiCanvas(8, 3);
    expect(c.cellWidth).toBe(8);
    expect(c.cellHeight).toBe(3);
    expect(c.width).toBe(8);
    expect(c.height).toBe(3);
    expect(c.mode).toBe('ascii');
  });

  test('default onChar="*" offChar=" "', () => {
    const c = createAsciiCanvas(3, 1);
    c.set(1, 0);
    expect(c.render()[0]).toBe(' * ');
  });

  test('custom onChar / offChar', () => {
    const c = createAsciiCanvas(4, 1, { onChar: '█', offChar: '·' });
    c.set(0, 0);
    c.set(2, 0);
    expect(c.render()[0]).toBe('█·█·');
  });

  test('rejects multi-char onChar / offChar', () => {
    expect(() => createAsciiCanvas(1, 1, { onChar: 'XX' })).toThrow();
    expect(() => createAsciiCanvas(1, 1, { offChar: '  ' })).toThrow();
  });
});

describe('ASCII set / get / toggle', () => {
  test('round trip', () => {
    const c = createAsciiCanvas(3, 2);
    c.set(1, 1);
    expect(c.get(1, 1)).toBe(true);
    expect(c.get(0, 0)).toBe(false);
  });

  test('out-of-bounds silent', () => {
    const c = createAsciiCanvas(1, 1);
    expect(() => c.set(5, 5)).not.toThrow();
    expect(c.get(-1, 0)).toBe(false);
  });

  test('toggle flips', () => {
    const c = createAsciiCanvas(1, 1);
    c.toggle(0, 0);
    expect(c.get(0, 0)).toBe(true);
    c.toggle(0, 0);
    expect(c.get(0, 0)).toBe(false);
  });

  test('clear drops all', () => {
    const c = createAsciiCanvas(3, 3);
    c.set(0, 0); c.set(2, 2);
    c.clear();
    for (let y = 0; y < 3; y++)
      for (let x = 0; x < 3; x++)
        expect(c.get(x, y)).toBe(false);
  });
});

describe('ASCII line / rect', () => {
  test('horizontal line', () => {
    const c = createAsciiCanvas(5, 1, { onChar: '#' });
    c.line(0, 0, 4, 0);
    expect(c.render()[0]).toBe('#####');
  });

  test('diagonal line touches endpoints', () => {
    const c = createAsciiCanvas(5, 5);
    c.line(0, 0, 4, 4);
    expect(c.get(0, 0)).toBe(true);
    expect(c.get(4, 4)).toBe(true);
    expect(c.get(2, 2)).toBe(true); // midpoint usually lit
  });

  test('rect outline', () => {
    const c = createAsciiCanvas(5, 4, { onChar: '#' });
    c.rect(0, 0, 5, 4);
    const lines = c.render();
    expect(lines[0]).toBe('#####');
    expect(lines[3]).toBe('#####');
    expect(lines[1]).toBe('#   #');
  });
});

describe('canvasFactory ascii routing', () => {
  test('mode="ascii" returns AsciiCanvas', () => {
    const c = canvasFactory.create(4, 2, 'ascii');
    expect(c.mode).toBe('ascii');
    expect(c.width).toBe(4);
  });

  test('mode="braille" still returns braille', () => {
    const c = canvasFactory.create(4, 2, 'braille');
    expect(c.mode).toBe('braille');
    expect(c.width).toBe(8);
  });
});

describe('ASCII render consistency', () => {
  test('row count == cellHeight', () => {
    const c = createAsciiCanvas(6, 5);
    expect(c.render()).toHaveLength(5);
  });

  test('row length == cellWidth', () => {
    const c = createAsciiCanvas(7, 2);
    for (const row of c.render()) expect(row.length).toBe(7);
  });
});
