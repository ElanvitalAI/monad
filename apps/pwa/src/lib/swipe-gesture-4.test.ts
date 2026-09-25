// R5 — classifySwipe4 helper contract.
// 4-direction classification + tie-breaking rules.

import { describe, expect, test } from 'bun:test';

import { classifySwipe4 } from './swipe-gesture';

describe('classifySwipe4 — direction by dominant axis', () => {
  test('horizontal-dominant left swipe', () => {
    expect(classifySwipe4({ dx: -150, dy: 20, dt: 200 })).toBe('left');
  });

  test('horizontal-dominant right swipe', () => {
    expect(classifySwipe4({ dx: 150, dy: -20, dt: 200 })).toBe('right');
  });

  test('vertical-dominant up swipe', () => {
    expect(classifySwipe4({ dx: 20, dy: -150, dt: 200 })).toBe('up');
  });

  test('vertical-dominant down swipe', () => {
    expect(classifySwipe4({ dx: -20, dy: 150, dt: 200 })).toBe('down');
  });
});

describe('classifySwipe4 — threshold gates', () => {
  test('below distance threshold → null', () => {
    expect(classifySwipe4({ dx: 50, dy: 0, dt: 100 })).toBeNull();
  });

  test('below velocity threshold → null', () => {
    expect(classifySwipe4({ dx: 200, dy: 0, dt: 5_000 })).toBeNull();
  });

  test('custom thresholds honored', () => {
    expect(classifySwipe4({
      dx: 60, dy: 0, dt: 100,
      minDistance: 50, minVelocity: 0.1,
    })).toBe('right');
  });
});

describe('classifySwipe4 — tie-breaking', () => {
  test('equal magnitude (|dx|=|dy|) → horizontal wins (right)', () => {
    expect(classifySwipe4({ dx: 150, dy: -150, dt: 200 })).toBe('right');
  });

  test('equal magnitude (|dx|=|dy|) negative → horizontal wins (left)', () => {
    expect(classifySwipe4({ dx: -150, dy: 150, dt: 200 })).toBe('left');
  });

  test('horizontal-dominant by 1px → horizontal', () => {
    expect(classifySwipe4({ dx: 151, dy: -150, dt: 200 })).toBe('right');
  });

  test('vertical-dominant by 1px → vertical', () => {
    expect(classifySwipe4({ dx: 150, dy: -151, dt: 200 })).toBe('up');
  });
});

describe('classifySwipe4 — degenerate inputs', () => {
  test('zero motion → null', () => {
    expect(classifySwipe4({ dx: 0, dy: 0, dt: 200 })).toBeNull();
  });

  test('zero dt floored to 1 (still measures velocity)', () => {
    expect(classifySwipe4({ dx: 200, dy: 0, dt: 0 })).toBe('right');
  });
});
