// H6 P5 · ReplyCapture · mark/delta + idle-detect polling.

import { describe, test, expect } from 'bun:test';
import { ReplyCapture } from '../src/agent/reply-capture.js';

/** Minimal TransportObserver stub for the capture API we consume. */
class FakeObserver {
  private state: Record<string, string> = {};
  constructor(initial: Record<string, string> = {}) {
    this.state = { ...initial };
  }
  set(channel: string, value: string) {
    this.state[channel] = value;
  }
  append(channel: string, chunk: string) {
    this.state[channel] = (this.state[channel] ?? '') + chunk;
  }
  snapshotChannels() {
    return { ...this.state };
  }
}

function fakeClock(startAt = 1000) {
  let t = startAt;
  return {
    now: () => t,
    advance: (ms: number) => { t += ms; },
  };
}

function fakeSleep(clock: ReturnType<typeof fakeClock>, pollMs: number) {
  // Our sleep doesn't actually sleep — it advances the fake clock by
  // the poll interval so collectUntilIdle loops in deterministic steps.
  return (ms: number) => {
    clock.advance(ms || pollMs);
    return Promise.resolve();
  };
}

describe('ReplyCapture · mark + computeDelta', () => {
  test('mark records start lengths · delta returns new bytes only', () => {
    const observer = new FakeObserver({ message: 'pre' });
    const cap = new ReplyCapture();
    cap.mark(observer as never);
    observer.append('message', 'hello');
    const { delta, rolled } = cap.computeDelta(observer.snapshotChannels());
    expect(delta.message).toBe('hello');
    expect(rolled).toBe(false);
  });

  test('channel shorter than mark (rolling buffer) · flags rolled', () => {
    const observer = new FakeObserver({ message: 'aaaaaaaa' });
    const cap = new ReplyCapture();
    cap.mark(observer as never);
    // Simulate a rolling-buffer eviction: current buffer now shorter
    observer.set('message', 'xyz');
    const { delta, rolled } = cap.computeDelta(observer.snapshotChannels());
    expect(rolled).toBe(true);
    expect(delta.message).toBe('xyz');
  });

  test('channel unchanged since mark · not in delta', () => {
    const observer = new FakeObserver({ message: 'pre', reasoning: 'think' });
    const cap = new ReplyCapture();
    cap.mark(observer as never);
    observer.append('reasoning', ' more');
    const { delta } = cap.computeDelta(observer.snapshotChannels());
    expect(delta.message).toBeUndefined();
    expect(delta.reasoning).toBe(' more');
  });

  test('new channel appearing after mark · full body in delta', () => {
    const observer = new FakeObserver({ message: 'hello' });
    const cap = new ReplyCapture();
    cap.mark(observer as never);
    observer.set('tool-call', 'run ls');
    const { delta } = cap.computeDelta(observer.snapshotChannels());
    expect(delta['tool-call']).toBe('run ls');
  });
});

describe('ReplyCapture · collectUntilIdle', () => {
  test('idle detected after N poll ticks with no changes', async () => {
    const observer = new FakeObserver({ message: '' });
    const cap = new ReplyCapture();
    const clock = fakeClock(0);
    cap.mark(observer as never, clock.now);
    // Simulate content arriving then going idle.
    let tick = 0;
    const sleep = async (ms: number) => {
      clock.advance(ms);
      tick += 1;
      if (tick === 1) observer.append('message', 'hello');
      // No changes after tick 1 · idle window should fire once idleMs elapses
    };
    const result = await cap.collectUntilIdle(observer as never, {
      idleMs: 500,
      timeoutMs: 5000,
      now: clock.now,
      sleep,
      pollMs: 100,
    });
    expect(result.delta.message).toBe('hello');
    expect(result.warnings).not.toContain('timeout-truncated');
  });

  test('timeout fires · warnings include timeout-truncated', async () => {
    const observer = new FakeObserver({ message: '' });
    const cap = new ReplyCapture();
    const clock = fakeClock(0);
    cap.mark(observer as never, clock.now);
    // Keep appending each tick so idle never fires.
    const sleep = async (ms: number) => {
      clock.advance(ms);
      observer.append('message', '.');
    };
    const result = await cap.collectUntilIdle(observer as never, {
      idleMs: 1000,
      timeoutMs: 500,
      now: clock.now,
      sleep,
      pollMs: 100,
    });
    expect(result.warnings).toContain('timeout-truncated');
  });

  test('empty-delta warning when nothing arrived before idle', async () => {
    const observer = new FakeObserver({ message: 'pre' });
    const cap = new ReplyCapture();
    const clock = fakeClock(0);
    cap.mark(observer as never, clock.now);
    const result = await cap.collectUntilIdle(observer as never, {
      idleMs: 200,
      timeoutMs: 5000,
      now: clock.now,
      sleep: fakeSleep(clock, 100),
      pollMs: 100,
    });
    expect(result.warnings).toContain('empty-delta');
    expect(result.totalBytes).toBe(0);
  });
});
