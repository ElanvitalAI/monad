// ── X5 (Phase 4 Bundle 1) — region-screenshot tests ──

import { describe, expect, test } from 'bun:test';
import {
  cellRangeToRect,
  createRegionScreenshot,
} from '../../src/capture/region-screenshot';

describe('cellRangeToRect', () => {
  test('basic rect from start/end cells', () => {
    const rect = cellRangeToRect({
      startRow: 2, startCol: 3,
      endRow: 5, endCol: 7,
      cellWidth: 10, cellHeight: 20,
    });
    expect(rect).toEqual({
      x: 30,                        // 3 * 10
      y: 40,                        // 2 * 20
      width: (7 - 3 + 1) * 10,      // 50 (5 cols)
      height: (5 - 2 + 1) * 20,     // 80 (4 rows)
    });
  });

  test('reversed range normalized', () => {
    const a = cellRangeToRect({
      startRow: 5, startCol: 7,
      endRow: 2, endCol: 3,
      cellWidth: 10, cellHeight: 20,
    });
    const b = cellRangeToRect({
      startRow: 2, startCol: 3,
      endRow: 5, endCol: 7,
      cellWidth: 10, cellHeight: 20,
    });
    expect(a).toEqual(b);
  });

  test('single cell → 1xN dimensions', () => {
    const rect = cellRangeToRect({
      startRow: 0, startCol: 0,
      endRow: 0, endCol: 0,
      cellWidth: 12, cellHeight: 16,
    });
    expect(rect).toEqual({ x: 0, y: 0, width: 12, height: 16 });
  });
});

describe('createRegionScreenshot', () => {
  test('happy path → cropped result', async () => {
    let captureCalled: Record<string, unknown> | null = null;
    let cropCalled: { sourceBase64: string; rect: unknown } | null = null;
    const r = createRegionScreenshot({
      dispatchScreenshot: async (args) => {
        captureCalled = args;
        return { bodyBase64: 'FULLPNG', bytes: 1000 };
      },
      cropPng: async (input) => {
        cropCalled = input;
        return { bodyBase64: 'CROPPED', bytes: 100 };
      },
      now: () => 999,
    });
    const out = await r.capture({
      captureArgs: { paneId: 'p1' },
      region: { x: 10, y: 20, width: 100, height: 200 },
    });
    expect(out).not.toBeNull();
    expect(out!.bodyBase64).toBe('CROPPED');
    expect(out!.bytes).toBe(100);
    expect(out!.capturedAt).toBe(999);
    expect(captureCalled!.format).toBe('png');
    expect(cropCalled!.sourceBase64).toBe('FULLPNG');
  });

  test('capture returns no body → null', async () => {
    const r = createRegionScreenshot({
      dispatchScreenshot: async () => ({ bytes: 0 }),
      cropPng: async () => ({ bodyBase64: 'X', bytes: 1 }),
    });
    expect(await r.capture({
      captureArgs: {},
      region: { x: 0, y: 0, width: 10, height: 10 },
    })).toBeNull();
  });

  test('capture exceeds budget → null', async () => {
    const r = createRegionScreenshot({
      dispatchScreenshot: () => new Promise((res) => setTimeout(() => res({ bodyBase64: 'X' }), 200)),
      cropPng: async () => ({ bodyBase64: 'X', bytes: 1 }),
      captureBudgetMs: 50,
    });
    expect(await r.capture({
      captureArgs: {},
      region: { x: 0, y: 0, width: 10, height: 10 },
    })).toBeNull();
  });

  test('crop returns null → null', async () => {
    const r = createRegionScreenshot({
      dispatchScreenshot: async () => ({ bodyBase64: 'FULL' }),
      cropPng: async () => null,
    });
    expect(await r.capture({
      captureArgs: {},
      region: { x: 0, y: 0, width: 10, height: 10 },
    })).toBeNull();
  });

  test('crop exceeds budget → null', async () => {
    const r = createRegionScreenshot({
      dispatchScreenshot: async () => ({ bodyBase64: 'FULL' }),
      cropPng: () => new Promise((res) => setTimeout(() => res({ bodyBase64: 'X', bytes: 1 }), 200)),
      cropBudgetMs: 50,
    });
    expect(await r.capture({
      captureArgs: {},
      region: { x: 0, y: 0, width: 10, height: 10 },
    })).toBeNull();
  });

  test('clamped flag propagates', async () => {
    const r = createRegionScreenshot({
      dispatchScreenshot: async () => ({ bodyBase64: 'FULL' }),
      cropPng: async () => ({ bodyBase64: 'X', bytes: 1, clamped: true }),
    });
    const out = await r.capture({
      captureArgs: {},
      region: { x: 9999, y: 9999, width: 100, height: 100 },
    });
    expect(out!.clamped).toBe(true);
  });
});
