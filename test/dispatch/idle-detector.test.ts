// Phase 2 D3 — IdleDetector unit tests.

import { describe, expect, test } from 'bun:test';

import {
  DEFAULT_IDLE_THRESHOLD_MS,
  IdleDetector,
} from '../../src/dispatch/idle-detector.ts';

class MockClock {
  constructor(public t = 1_000_000) {}
  now = (): number => this.t;
  advance(ms: number): void { this.t += ms; }
}

describe('IdleDetector.status', () => {
  test('empty detector reports idle=true · idleMs=Infinity', () => {
    const c = new MockClock();
    const d = new IdleDetector({ now: c.now });
    const s = d.status();
    expect(s.idle).toBe(true);
    expect(s.idleMs).toBe(Infinity);
    expect(s.lastSurface).toBeNull();
  });

  test('after a fresh notify, idle=false', () => {
    const c = new MockClock();
    const d = new IdleDetector({ now: c.now });
    d.notifyActivity('dashboard');
    const s = d.status();
    expect(s.idle).toBe(false);
    expect(s.idleMs).toBe(0);
    expect(s.lastSurface).toBe('dashboard');
  });

  test('idle flips true past the threshold', () => {
    const c = new MockClock();
    const d = new IdleDetector({ thresholdMs: 1000, now: c.now });
    d.notifyActivity('chat');
    c.advance(999);
    expect(d.isIdle()).toBe(false);
    c.advance(2);
    expect(d.isIdle()).toBe(true);
  });

  test('takes the most-recent activity across surfaces', () => {
    const c = new MockClock();
    const d = new IdleDetector({ thresholdMs: 500, now: c.now });
    d.notifyActivity('terminal');
    c.advance(300);
    d.notifyActivity('chat');
    c.advance(400); // 700ms since terminal, 400ms since chat
    expect(d.isIdle()).toBe(false);
    expect(d.status().lastSurface).toBe('chat');
  });

  test('default threshold is 15 minutes', () => {
    const c = new MockClock();
    const d = new IdleDetector({ now: c.now });
    expect(d.threshold()).toBe(DEFAULT_IDLE_THRESHOLD_MS);
    d.notifyActivity('voice');
    c.advance(DEFAULT_IDLE_THRESHOLD_MS - 1);
    expect(d.isIdle()).toBe(false);
    c.advance(2);
    expect(d.isIdle()).toBe(true);
  });
});

describe('IdleDetector lifecycle helpers', () => {
  test('lastActivityAt reflects the latest notify', () => {
    const c = new MockClock();
    const d = new IdleDetector({ now: c.now });
    expect(d.lastActivityAt()).toBeNull();
    d.notifyActivity('a');
    const tA = c.t;
    c.advance(50);
    d.notifyActivity('b');
    expect(d.lastActivityAt()).toBe(c.t);
    expect(d.lastActivityAt()).not.toBe(tA);
  });

  test('reset wipes state', () => {
    const d = new IdleDetector();
    d.notifyActivity('a');
    d.reset();
    expect(d.lastActivityAt()).toBeNull();
    expect(d.isIdle()).toBe(true);
  });

  test('zero threshold means activity is "live" only at the exact instant', () => {
    const c = new MockClock();
    const d = new IdleDetector({ thresholdMs: 0, now: c.now });
    d.notifyActivity('s');
    expect(d.isIdle()).toBe(true); // diff (0) >= threshold (0)
  });
});
