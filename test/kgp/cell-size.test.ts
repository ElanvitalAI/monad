import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { cellSize, cellsToPixels, _resetForTest } from '../../src/kgp/cell-size.js';

let snap: { w?: string; h?: string };

beforeEach(() => {
  snap = { w: process.env.ELANOUS_KGP_CELL_W, h: process.env.ELANOUS_KGP_CELL_H };
  delete process.env.ELANOUS_KGP_CELL_W;
  delete process.env.ELANOUS_KGP_CELL_H;
  _resetForTest();
});

afterEach(() => {
  if (snap.w === undefined) delete process.env.ELANOUS_KGP_CELL_W; else process.env.ELANOUS_KGP_CELL_W = snap.w;
  if (snap.h === undefined) delete process.env.ELANOUS_KGP_CELL_H; else process.env.ELANOUS_KGP_CELL_H = snap.h;
  _resetForTest();
});

describe('cell-size', () => {
  test('defaults sensibly for Ghostty-on-retina', () => {
    const { cellW, cellH } = cellSize();
    expect(cellW).toBeGreaterThan(0);
    expect(cellH).toBeGreaterThan(0);
    // Document the current default so a regression surfaces as a test
    // failure rather than a silently wrong image aspect ratio.
    expect(cellW).toBe(9);
    expect(cellH).toBe(18);
  });

  test('env override wins over default', () => {
    process.env.ELANOUS_KGP_CELL_W = '10';
    process.env.ELANOUS_KGP_CELL_H = '20';
    expect(cellSize()).toEqual({ cellW: 10, cellH: 20 });
  });

  test('bogus env values fall back to default', () => {
    process.env.ELANOUS_KGP_CELL_W = 'NaN';
    expect(cellSize().cellW).toBe(9); // default
  });

  test('cellsToPixels multiplies cells by cell size', () => {
    expect(cellsToPixels(80, 24)).toEqual({ w: 80 * 9, h: 24 * 18 });
  });

  test('cellsToPixels never returns zero dims', () => {
    expect(cellsToPixels(0, 0)).toEqual({ w: 1, h: 1 });
  });
});
