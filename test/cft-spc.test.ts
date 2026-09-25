// ── PFC-S3.2 P1: SPC ring-buffer 2σ ──

import { beforeEach, describe, expect, test } from 'bun:test';
import {
  SPC_DEFAULT_CAPACITY,
  SPC_SIGMA_THRESHOLD,
  SPC_WARMUP_N,
  clearSpcForTest,
  getStats,
  listSeries,
  recordSample,
} from '../src/cft/spc';

beforeEach(() => {
  clearSpcForTest();
});

describe('SPC.recordSample — warm-up + stats', () => {
  test('first sample: n=1, stddev=0, outlierZ undefined', () => {
    const s = recordSample('latency', 100);
    expect(s.n).toBe(1);
    expect(s.mean).toBe(100);
    expect(s.stddev).toBe(0);
    expect(s.outlierZ).toBeUndefined();
  });

  test('under-warm-up (n<5) keeps outlierZ undefined even on spike', () => {
    // First 4 samples — still under warm-up; any spike gets no alert.
    for (const v of [10, 10, 10]) recordSample('answer-len', v);
    const s = recordSample('answer-len', 10_000);
    expect(s.n).toBe(4);
    expect(s.outlierZ).toBeUndefined();
  });

  test('five identical samples → stddev=0, outlierZ undefined', () => {
    for (let i = 0; i < 5; i++) recordSample('z', 42);
    const s = recordSample('z', 42);
    expect(s.stddev).toBe(0);
    expect(s.outlierZ).toBeUndefined();
  });

  test('varying window + outlier on next sample → outlierZ > 2', () => {
    for (const v of [100, 102, 98, 101, 99]) recordSample('latency', v);
    const s = recordSample('latency', 1000);
    expect(s.outlierZ).toBeDefined();
    expect(Math.abs(s.outlierZ!)).toBeGreaterThan(SPC_SIGMA_THRESHOLD);
    expect(s.sign).toBe('over');
  });

  test('under-2σ sample within normal range → outlierZ undefined', () => {
    for (const v of [100, 102, 98, 101, 99]) recordSample('latency', v);
    const s = recordSample('latency', 103);
    expect(s.outlierZ).toBeUndefined();
  });

  test('negative outlier → sign="under"', () => {
    for (const v of [100, 102, 98, 101, 99]) recordSample('latency', v);
    const s = recordSample('latency', -500);
    expect(s.outlierZ).toBeDefined();
    expect(s.sign).toBe('under');
    expect(s.outlierZ!).toBeLessThan(0);
  });
});

describe('SPC.ring buffer + getStats', () => {
  test('ring buffer wraps at capacity (20 by default)', () => {
    for (let i = 0; i < SPC_DEFAULT_CAPACITY + 5; i++) {
      recordSample('roll', i);
    }
    const snap = getStats('roll');
    expect(snap).not.toBeNull();
    expect(snap!.n).toBe(SPC_DEFAULT_CAPACITY);
    // Mean should shift to the newer window (last 20 samples: 5..24).
    expect(snap!.mean).toBeGreaterThan(SPC_DEFAULT_CAPACITY / 2);
  });

  test('listSeries is stable sorted', () => {
    recordSample('b', 1);
    recordSample('a', 2);
    recordSample('c', 3);
    expect(listSeries()).toEqual(['a', 'b', 'c']);
  });

  test('getStats returns null for unknown series', () => {
    expect(getStats('never-recorded')).toBeNull();
  });
});

describe('SPC.validation', () => {
  test('NaN value throws', () => {
    expect(() => recordSample('x', NaN)).toThrow();
  });
  test('Infinity value throws', () => {
    expect(() => recordSample('x', Infinity)).toThrow();
  });
  test('empty series name throws', () => {
    expect(() => recordSample('  ', 1)).toThrow();
  });
  test('warmupN constant is exposed', () => {
    expect(SPC_WARMUP_N).toBe(5);
  });
});

describe('SPC.clearSpcForTest', () => {
  test('clears state between tests', () => {
    recordSample('x', 1);
    expect(listSeries().length).toBe(1);
    clearSpcForTest();
    expect(listSeries().length).toBe(0);
    expect(getStats('x')).toBeNull();
  });
});
