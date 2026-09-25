// AnimationController — Phase 4b frame-sampled tween tests.

import { describe, expect, test } from 'bun:test';
import { AnimationController, lerp, lerpInt } from '../src/animation/animation-context.js';

function withClock(ctrl: AnimationController, initial: number = 0): {
  now: number;
  advance(ms: number): void;
} {
  const clock = { now: initial };
  ctrl._setNowForTesting(() => clock.now);
  return {
    get now() { return clock.now; },
    advance(ms: number) { clock.now += ms; },
  };
}

describe('AnimationController basic lifecycle', () => {
  test('unknown key returns 0', () => {
    const ctrl = new AnimationController();
    expect(ctrl.progress('nope')).toBe(0);
  });

  test('linear tween over duration', () => {
    const ctrl = new AnimationController();
    const clock = withClock(ctrl, 1000);
    ctrl.tween({ key: 'fade', durationMs: 100, curve: 'linear' });

    expect(ctrl.progress('fade')).toBe(0);
    clock.advance(25);
    expect(ctrl.progress('fade')).toBeCloseTo(0.25, 5);
    clock.advance(25);
    expect(ctrl.progress('fade')).toBeCloseTo(0.5, 5);
    clock.advance(50);
    expect(ctrl.progress('fade')).toBe(1);
  });

  test('before startAt → 0', () => {
    const ctrl = new AnimationController();
    const clock = withClock(ctrl, 1000);
    ctrl.tween({ key: 'delay', durationMs: 100, startAt: 2000 });
    expect(ctrl.progress('delay')).toBe(0);
    clock.advance(500);
    expect(ctrl.progress('delay')).toBe(0);
    clock.advance(500);
    expect(ctrl.progress('delay')).toBeCloseTo(0, 5);
    clock.advance(50);
    expect(ctrl.progress('delay')).toBeCloseTo(0.5, 5);
  });

  test('onDone fires exactly once at first sample past end', () => {
    const ctrl = new AnimationController();
    const clock = withClock(ctrl, 1000);
    let doneCount = 0;
    ctrl.tween({ key: 'once', durationMs: 50, onDone: () => { doneCount++; } });

    expect(doneCount).toBe(0);
    clock.advance(49);
    ctrl.progress('once');
    expect(doneCount).toBe(0);
    clock.advance(5);
    ctrl.progress('once');
    expect(doneCount).toBe(1);
    clock.advance(100);
    ctrl.progress('once');
    expect(doneCount).toBe(1);   // still 1 — not re-fired
  });

  test('isDone mirrors onDone flag', () => {
    const ctrl = new AnimationController();
    const clock = withClock(ctrl, 1000);
    ctrl.tween({ key: 'x', durationMs: 20 });
    expect(ctrl.isDone('x')).toBe(false);
    clock.advance(30);
    ctrl.progress('x');
    expect(ctrl.isDone('x')).toBe(true);
  });

  test('tween with same key replaces prior spec', () => {
    const ctrl = new AnimationController();
    const clock = withClock(ctrl, 1000);
    ctrl.tween({ key: 'k', durationMs: 100 });
    clock.advance(50);
    expect(ctrl.progress('k')).toBeCloseTo(0.5, 5);

    // Replace — new tween starts fresh from current time.
    ctrl.tween({ key: 'k', durationMs: 100 });
    expect(ctrl.progress('k')).toBe(0);
    clock.advance(25);
    expect(ctrl.progress('k')).toBeCloseTo(0.25, 5);
  });

  test('cancel removes tween', () => {
    const ctrl = new AnimationController();
    withClock(ctrl, 1000);
    ctrl.tween({ key: 'k', durationMs: 100 });
    ctrl.cancel('k');
    expect(ctrl.progress('k')).toBe(0);
    expect(ctrl.hasActive()).toBe(false);
  });

  test('clear wipes all', () => {
    const ctrl = new AnimationController();
    withClock(ctrl, 1000);
    ctrl.tween({ key: 'a', durationMs: 100 });
    ctrl.tween({ key: 'b', durationMs: 100 });
    ctrl.clear();
    expect(ctrl.progress('a')).toBe(0);
    expect(ctrl.progress('b')).toBe(0);
    expect(ctrl.hasActive()).toBe(false);
  });

  test('hasActive flips false when all tweens complete', () => {
    const ctrl = new AnimationController();
    const clock = withClock(ctrl, 1000);
    ctrl.tween({ key: 'a', durationMs: 50 });
    ctrl.tween({ key: 'b', durationMs: 100 });
    expect(ctrl.hasActive()).toBe(true);
    clock.advance(120);
    expect(ctrl.hasActive()).toBe(false);
  });

  test('duration is clamped to ≥ 1ms', () => {
    const ctrl = new AnimationController();
    const clock = withClock(ctrl, 1000);
    ctrl.tween({ key: 'zero', durationMs: 0 });
    clock.advance(1);
    expect(ctrl.progress('zero')).toBe(1);
  });

  test('onDone errors are swallowed (must not throw from progress())', () => {
    const ctrl = new AnimationController();
    const clock = withClock(ctrl, 1000);
    ctrl.tween({ key: 'oops', durationMs: 10, onDone: () => { throw new Error('nope'); } });
    clock.advance(20);
    expect(() => ctrl.progress('oops')).not.toThrow();
  });
});

describe('lerp helpers', () => {
  test('lerp identity at t=0 and t=1', () => {
    expect(lerp(10, 20, 0)).toBe(10);
    expect(lerp(10, 20, 1)).toBe(20);
    expect(lerp(10, 20, 0.5)).toBe(15);
  });

  test('lerpInt rounds to nearest integer', () => {
    expect(lerpInt(0, 10, 0.37)).toBe(4);
    expect(lerpInt(0, 10, 0.5)).toBe(5);
    expect(lerpInt(0, 10, 0.77)).toBe(8);
  });

  test('lerp works negative → positive', () => {
    expect(lerp(-10, 10, 0.5)).toBe(0);
  });
});
