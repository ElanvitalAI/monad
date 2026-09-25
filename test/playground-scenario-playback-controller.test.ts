// F-B5a — Pure playback state machine tests.

import { beforeEach, describe, expect, test } from 'bun:test';

import {
  PlaybackController,
  type PlaybackTimer,
  type PlaybackState,
} from '../src/playground-scenario/index.js';

// ── Virtual timer for deterministic auto-advance tests ──────────

class VirtualTimer implements PlaybackTimer {
  private next = 1;
  private scheduled = new Map<number, { at: number; fn: () => void }>();
  public now = 0;

  setTimeout(fn: () => void, ms: number): unknown {
    const id = this.next++;
    this.scheduled.set(id, { at: this.now + ms, fn });
    return id;
  }
  clearTimeout(handle: unknown): void {
    this.scheduled.delete(handle as number);
  }
  /** Advance virtual clock — fires callbacks whose `at` passed. */
  advance(ms: number): void {
    this.now += ms;
    const due = [...this.scheduled.entries()]
      .filter(([, e]) => e.at <= this.now)
      .sort((a, b) => a[1].at - b[1].at);
    for (const [id, entry] of due) {
      this.scheduled.delete(id);
      entry.fn();
    }
  }
}

describe('PlaybackController — manual navigation', () => {
  let ctrl: PlaybackController;
  let timer: VirtualTimer;
  let events: PlaybackState[];

  beforeEach(() => {
    timer = new VirtualTimer();
    events = [];
    ctrl = new PlaybackController({ total: 5, timer });
    ctrl.onChange(s => events.push(s));
  });

  test('initial state is -1 / total=5 / not playing', () => {
    const s = ctrl.getState();
    expect(s.stepIndex).toBe(-1);
    expect(s.total).toBe(5);
    expect(s.playing).toBe(false);
  });

  test('next advances forward one step', () => {
    expect(ctrl.next()).toBe(true);
    expect(ctrl.getState().stepIndex).toBe(0);
    expect(ctrl.next()).toBe(true);
    expect(ctrl.getState().stepIndex).toBe(1);
  });

  test('next returns false at the end and does not advance', () => {
    for (let i = 0; i < 5; i++) ctrl.next();
    expect(ctrl.getState().stepIndex).toBe(4);
    expect(ctrl.next()).toBe(false);
    expect(ctrl.getState().stepIndex).toBe(4);
  });

  test('prev returns false at the start', () => {
    expect(ctrl.prev()).toBe(false);
    ctrl.next();
    ctrl.next();
    expect(ctrl.getState().stepIndex).toBe(1);
    expect(ctrl.prev()).toBe(true);
    expect(ctrl.getState().stepIndex).toBe(0);
    expect(ctrl.prev()).toBe(false);
  });

  test('reset returns to -1 + clears playing', () => {
    ctrl.next();
    ctrl.next();
    ctrl.play();
    ctrl.reset();
    const s = ctrl.getState();
    expect(s.stepIndex).toBe(-1);
    expect(s.playing).toBe(false);
  });

  test('onChange listener fires on every transition', () => {
    ctrl.next();
    ctrl.next();
    ctrl.prev();
    expect(events.length).toBe(3);
    expect(events[0]!.stepIndex).toBe(0);
    expect(events[1]!.stepIndex).toBe(1);
    expect(events[2]!.stepIndex).toBe(0);
  });
});

describe('PlaybackController — auto-advance', () => {
  test('play + advance 2000ms → stepIndex moves', () => {
    const timer = new VirtualTimer();
    const ctrl = new PlaybackController({ total: 3, timer, intervalMs: 2000 });
    ctrl.play();
    expect(ctrl.getState().playing).toBe(true);
    expect(ctrl.getState().stepIndex).toBe(-1);

    timer.advance(2000);
    expect(ctrl.getState().stepIndex).toBe(0);

    timer.advance(2000);
    expect(ctrl.getState().stepIndex).toBe(1);

    timer.advance(2000);
    expect(ctrl.getState().stepIndex).toBe(2);
    // Hit end — auto-pause.
    expect(ctrl.getState().playing).toBe(false);
  });

  test('pause cancels pending tick', () => {
    const timer = new VirtualTimer();
    const ctrl = new PlaybackController({ total: 3, timer, intervalMs: 1000 });
    ctrl.play();
    timer.advance(500);
    ctrl.pause();
    timer.advance(5000);
    expect(ctrl.getState().stepIndex).toBe(-1);
    expect(ctrl.getState().playing).toBe(false);
  });

  test('toggle flips playing state', () => {
    const timer = new VirtualTimer();
    const ctrl = new PlaybackController({ total: 3, timer });
    ctrl.toggle();
    expect(ctrl.getState().playing).toBe(true);
    ctrl.toggle();
    expect(ctrl.getState().playing).toBe(false);
  });

  test('play on empty scenario is a no-op', () => {
    const timer = new VirtualTimer();
    const ctrl = new PlaybackController({ total: 0, timer });
    ctrl.play();
    expect(ctrl.getState().playing).toBe(false);
  });
});

describe('PlaybackController — setTotal', () => {
  test('setTotal clamps stepIndex when shrinking past current', () => {
    const timer = new VirtualTimer();
    const ctrl = new PlaybackController({ total: 5, timer });
    ctrl.next(); ctrl.next(); ctrl.next(); ctrl.next();
    expect(ctrl.getState().stepIndex).toBe(3);
    ctrl.setTotal(2);
    expect(ctrl.getState().total).toBe(2);
    expect(ctrl.getState().stepIndex).toBe(1);
  });

  test('setTotal=0 clears index', () => {
    const timer = new VirtualTimer();
    const ctrl = new PlaybackController({ total: 3, timer });
    ctrl.next();
    ctrl.setTotal(0);
    expect(ctrl.getState().total).toBe(0);
    expect(ctrl.getState().stepIndex).toBe(-1);
  });
});

describe('PlaybackController — dispose', () => {
  test('dispose clears timers + listeners', () => {
    const timer = new VirtualTimer();
    const events: PlaybackState[] = [];
    const ctrl = new PlaybackController({ total: 3, timer });
    ctrl.onChange(s => events.push(s));
    ctrl.play();
    ctrl.dispose();
    timer.advance(10_000);
    // No new events after dispose.
    const countBefore = events.length;
    timer.advance(10_000);
    expect(events.length).toBe(countBefore);
  });
});
