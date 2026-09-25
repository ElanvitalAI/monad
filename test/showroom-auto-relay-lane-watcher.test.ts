// Showroom v2 Arc 4 · lane-watcher tests.
//
// Verifies:
//   - IDLE→ACTIVE transition on first byte change (no event)
//   - ACTIVE→IDLE transition after idleMs (event fires once)
//   - re-arm: ACTIVE again → idle again → fires again
//   - self-stop on session.state().status === 'done'/'error'
//   - listener exception doesn't crash the loop
//
// Time stub pattern: caller-controlled clock (`now()` returns synthetic
// ms · `sleep()` advances the clock + yields). The watcher's loop
// awaits `sleep(pollMs)` each tick — we drive ticks by calling
// `tickClock(pollMs * N)` between assertions.

import { describe, test, expect } from 'bun:test';
import {
  startLaneWatcher,
  type LaneIdleEvent,
} from '../src/showroom/auto-relay/lane-watcher.js';
import type { TransportObserver } from '../src/agent/transport-observer.js';

interface FakeObserver {
  snapshotChannels(): { [k: string]: string };
  setBytes(n: number): void;
}

function fakeObserver(initialBytes = 0): FakeObserver {
  let body = 'x'.repeat(initialBytes);
  return {
    snapshotChannels(): { [k: string]: string } {
      return body.length > 0 ? { stream: body } : {};
    },
    setBytes(n: number) {
      body = 'x'.repeat(n);
    },
  };
}

interface ClockHarness {
  now(): number;
  advance(ms: number): void;
  sleep(_ms: number): Promise<void>;
  awaitTick(): Promise<void>;
}

/** Clock harness: caller advances time via `advance(ms)`; the
 *  watcher's `sleep(pollMs)` resolves on the *next* awaited promise so
 *  we can assert state between ticks. */
function makeClock(): ClockHarness {
  let t = 1_000_000;
  const pending: Array<() => void> = [];
  return {
    now: () => t,
    advance(ms: number) { t += ms; },
    sleep: () => new Promise<void>((resolve) => { pending.push(resolve); }),
    async awaitTick() {
      const r = pending.shift();
      if (r) r();
      // Yield to the watcher loop so it can read the clock + observer.
      await new Promise<void>((resolve) => queueMicrotask(resolve));
      await new Promise<void>((resolve) => queueMicrotask(resolve));
    },
  };
}

describe('startLaneWatcher · state transitions', () => {
  test('IDLE → ACTIVE on byte change · no event', async () => {
    const obs = fakeObserver(0);
    const clock = makeClock();
    const events: LaneIdleEvent[] = [];

    const watcher = startLaneWatcher({
      sessionId: 's1',
      observer: obs as unknown as TransportObserver,
      onIdle: (e) => { events.push(e); },
      idleMs: 1000, pollMs: 100,
      now: clock.now, sleep: clock.sleep,
    });

    // First tick · still 0 bytes · still IDLE.
    await clock.awaitTick();
    expect(watcher.state()).toBe('idle');
    expect(events.length).toBe(0);

    // Bytes appear · advance time so the next poll sees the change.
    obs.setBytes(50);
    clock.advance(100);
    await clock.awaitTick();
    expect(watcher.state()).toBe('active');
    expect(events.length).toBe(0);

    await watcher.stop();
  });

  test('ACTIVE → IDLE after idleMs · event fires once', async () => {
    const obs = fakeObserver(0);
    const clock = makeClock();
    const events: LaneIdleEvent[] = [];

    const watcher = startLaneWatcher({
      sessionId: 's1',
      observer: obs as unknown as TransportObserver,
      onIdle: (e) => { events.push(e); },
      idleMs: 500, pollMs: 100,
      now: clock.now, sleep: clock.sleep,
    });

    // Tick 1 · IDLE (no bytes).
    await clock.awaitTick();
    // Tick 2 · activity → ACTIVE.
    obs.setBytes(50);
    clock.advance(100);
    await clock.awaitTick();
    expect(watcher.state()).toBe('active');

    // Tick 3 · still 50 bytes · 100ms passed but < idleMs (500).
    clock.advance(100);
    await clock.awaitTick();
    expect(watcher.state()).toBe('active');
    expect(events.length).toBe(0);

    // Tick 4 · 200ms more · total no-change = 300 < 500 still.
    clock.advance(200);
    await clock.awaitTick();
    expect(events.length).toBe(0);

    // Tick 5 · 200ms more · no-change = 500 → idle event.
    clock.advance(200);
    await clock.awaitTick();
    expect(watcher.state()).toBe('idle');
    expect(events.length).toBe(1);
    expect(events[0]?.totalBytes).toBe(50);
    expect(events[0]?.idleMs).toBeGreaterThanOrEqual(500);

    await watcher.stop();
  });

  test('re-arm: ACTIVE again → IDLE again · fires twice', async () => {
    const obs = fakeObserver(0);
    const clock = makeClock();
    const events: LaneIdleEvent[] = [];

    const watcher = startLaneWatcher({
      sessionId: 's1',
      observer: obs as unknown as TransportObserver,
      onIdle: (e) => { events.push(e); },
      idleMs: 200, pollMs: 100,
      now: clock.now, sleep: clock.sleep,
    });

    // First active→idle.
    await clock.awaitTick();
    obs.setBytes(10); clock.advance(100); await clock.awaitTick();
    clock.advance(200); await clock.awaitTick();
    expect(events.length).toBe(1);

    // No event when already idle (additional time passes but no change).
    clock.advance(500); await clock.awaitTick();
    expect(events.length).toBe(1);

    // Second activity → ACTIVE → second idle event.
    obs.setBytes(20); clock.advance(100); await clock.awaitTick();
    expect(watcher.state()).toBe('active');
    clock.advance(200); await clock.awaitTick();
    expect(watcher.state()).toBe('idle');
    expect(events.length).toBe(2);

    await watcher.stop();
  });
});

describe('startLaneWatcher · self-stop on session done', () => {
  test('session.state().status === "done" stops watcher', async () => {
    const obs = fakeObserver(0);
    const clock = makeClock();
    const events: LaneIdleEvent[] = [];

    let status: 'running' | 'done' | 'error' = 'running';
    const session = {
      id: 's1',
      launchSpec: { brand: 'stub' },
      transports: [{ kind: 'pty' as const, id: 'pty-1' }],
      state: () => ({ status }),
      send: async () => {},
      interrupt: async () => {},
      snapshot: async () => '',
      dispose: async () => {},
    };

    const watcher = startLaneWatcher({
      sessionId: 's1',
      observer: obs as unknown as TransportObserver,
      session,
      onIdle: (e) => { events.push(e); },
      idleMs: 200, pollMs: 100,
      now: clock.now, sleep: clock.sleep,
    });

    await clock.awaitTick();
    expect(watcher.state()).toBe('idle');

    status = 'done';
    clock.advance(100);
    await clock.awaitTick();
    expect(watcher.state()).toBe('done');

    await watcher.stop();
  });

  test('listener exception is isolated', async () => {
    const obs = fakeObserver(0);
    const clock = makeClock();

    const watcher = startLaneWatcher({
      sessionId: 's1',
      observer: obs as unknown as TransportObserver,
      onIdle: () => { throw new Error('listener fail'); },
      idleMs: 200, pollMs: 100,
      now: clock.now, sleep: clock.sleep,
    });

    // Drive to idle event · listener throws but watcher must continue.
    await clock.awaitTick();
    obs.setBytes(5); clock.advance(100); await clock.awaitTick();
    clock.advance(200); await clock.awaitTick();

    // Still alive · re-arm and fire again.
    obs.setBytes(10); clock.advance(100); await clock.awaitTick();
    expect(watcher.state()).toBe('active');

    await watcher.stop();
  });
});

describe('startLaneWatcher · stop is idempotent', () => {
  test('multiple stops are safe', async () => {
    const obs = fakeObserver(0);
    const clock = makeClock();

    const watcher = startLaneWatcher({
      sessionId: 's1',
      observer: obs as unknown as TransportObserver,
      onIdle: () => {},
      idleMs: 200, pollMs: 100,
      now: clock.now, sleep: clock.sleep,
    });

    await clock.awaitTick();

    // First stop awaits the loop.
    const stopP = watcher.stop();
    // Resolve the pending sleep so the loop can exit.
    await clock.awaitTick();
    await stopP;

    // Second stop is no-op.
    await watcher.stop();
  });
});
