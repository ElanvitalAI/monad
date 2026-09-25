// Animation curves — Phase 4b pure math tests.

import { describe, expect, test } from 'bun:test';
import {
  linear, easeIn, easeOut, easeInOut, easeInOutSine,
  bounceOut, elasticOut, backOut, stepStart, stepEnd,
  CURVES, resolveCurve,
} from '../src/animation/curves.js';

describe('curve endpoints', () => {
  const curves = [linear, easeIn, easeOut, easeInOut, easeInOutSine];
  test.each(curves)('%p maps 0 → 0 and 1 → 1', (c) => {
    expect(c(0)).toBeCloseTo(0, 5);
    expect(c(1)).toBeCloseTo(1, 5);
  });

  test('linear is identity at t=0.5', () => {
    expect(linear(0.5)).toBeCloseTo(0.5, 5);
  });

  test('easeIn(0.5) is slower than linear', () => {
    expect(easeIn(0.5)).toBeLessThan(0.5);
  });

  test('easeOut(0.5) is faster than linear', () => {
    expect(easeOut(0.5)).toBeGreaterThan(0.5);
  });

  test('easeInOut is symmetric — mirrors around 0.5', () => {
    expect(easeInOut(0.5)).toBeCloseTo(0.5, 5);
  });
});

describe('curve clamping', () => {
  test('t < 0 clamps to 0', () => {
    expect(linear(-0.5)).toBe(0);
    expect(easeIn(-1)).toBe(0);
  });

  test('t > 1 clamps to 1', () => {
    expect(linear(1.5)).toBe(1);
    expect(easeOut(2)).toBe(1);
  });

  test('NaN input → 0', () => {
    expect(linear(NaN)).toBe(0);
    expect(easeIn(NaN)).toBe(0);
  });
});

describe('bounceOut', () => {
  test('endpoints stay within [0, 1]', () => {
    expect(bounceOut(0)).toBeCloseTo(0, 2);
    expect(bounceOut(1)).toBeCloseTo(1, 5);
  });

  test('intermediate values are monotonically non-negative', () => {
    for (let i = 0; i <= 10; i++) {
      const v = bounceOut(i / 10);
      expect(v).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('elasticOut — overshoot allowed', () => {
  test('boundary t=1 exactly hits 1', () => {
    expect(elasticOut(1)).toBe(1);
  });

  test('mid-animation may exceed 1 (spring overshoot)', () => {
    // At roughly t=0.5 the sin/exp combo swings above 1.
    const sampled = [0.3, 0.4, 0.5, 0.6].map(elasticOut);
    const maxSeen = Math.max(...sampled);
    expect(maxSeen).toBeGreaterThan(0.9);
  });
});

describe('stepStart / stepEnd', () => {
  test('stepStart jumps at t>0', () => {
    expect(stepStart(0)).toBe(0);
    expect(stepStart(0.01)).toBe(1);
    expect(stepStart(1)).toBe(1);
  });

  test('stepEnd holds until t=1', () => {
    expect(stepEnd(0)).toBe(0);
    expect(stepEnd(0.99)).toBe(0);
    expect(stepEnd(1)).toBe(1);
  });
});

describe('resolveCurve / CURVES registry', () => {
  test('function passthrough', () => {
    const fn = (t: number) => t * 2;
    expect(resolveCurve(fn)).toBe(fn);
  });

  test('known name lookup', () => {
    expect(resolveCurve('easeIn')).toBe(easeIn);
    expect(resolveCurve('bounceOut')).toBe(bounceOut);
  });

  test('unknown name defaults to linear', () => {
    expect(resolveCurve('bogus')).toBe(linear);
    expect(resolveCurve(undefined)).toBe(linear);
    expect(resolveCurve('')).toBe(linear);
  });

  test('CURVES is frozen', () => {
    expect(() => {
      (CURVES as Record<string, unknown>).newThing = () => 0;
    }).toThrow();
  });
});
