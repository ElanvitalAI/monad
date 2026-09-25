import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  DEFAULT_HOVER_STABLE_MS,
  createHoverTracker,
  readHoverDelayMs,
  wireHoverToContextKeys,
  type HoverEvent,
  type HoverTarget,
} from '../src/ui/hover-tracker.js';
import {
  INITIAL_CONTEXT_KEYS,
  createContextKeyService,
} from '../src/input-core/context-keys.js';

/** Synchronous fake scheduler so tests can advance time without
 *  leaking setTimeout handles. Returns a tuple of [setTimer,
 *  clearTimer, advance] — `advance(ms)` fires any timers whose
 *  scheduled delay has elapsed. */
function makeFakeTimers(): {
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  advance: (ms: number) => void;
  pending: () => number;
} {
  interface Entry {
    id: number;
    at: number;
    fn: () => void;
    cancelled: boolean;
  }
  let now = 0;
  let nextId = 1;
  const queue: Entry[] = [];
  return {
    setTimer(fn, ms) {
      const e: Entry = { id: nextId++, at: now + ms, fn, cancelled: false };
      queue.push(e);
      return e;
    },
    clearTimer(handle) {
      const e = handle as Entry;
      e.cancelled = true;
    },
    advance(ms) {
      now += ms;
      // Fire every timer whose at <= now, in order, allowing newly
      // scheduled timers to either fire or be deferred.
      for (;;) {
        const next = queue
          .filter((e) => !e.cancelled && e.at <= now)
          .sort((a, b) => a.at - b.at)[0];
        if (!next) break;
        next.cancelled = true; // prevent double-fire
        next.fn();
      }
    },
    pending() {
      return queue.filter((e) => !e.cancelled).length;
    },
  };
}

const paneTitleTarget: HoverTarget = {
  id: 'pane-title:sidebar',
  kind: 'pane-title',
  tooltipText: 'Sidebar',
};

const pillTarget: HoverTarget = {
  id: 'pill:model',
  kind: 'pill',
  tooltipText: 'Active model',
};

describe('IDX-5 Phase 1 hover-tracker — delay resolution', () => {
  const origEnv = process.env.MONAD_HOVER_DELAY_MS;
  afterEach(() => {
    if (origEnv === undefined) delete process.env.MONAD_HOVER_DELAY_MS;
    else process.env.MONAD_HOVER_DELAY_MS = origEnv;
  });

  test('readHoverDelayMs defaults to 500', () => {
    delete process.env.MONAD_HOVER_DELAY_MS;
    expect(readHoverDelayMs()).toBe(DEFAULT_HOVER_STABLE_MS);
    expect(DEFAULT_HOVER_STABLE_MS).toBe(500);
  });

  test('MONAD_HOVER_DELAY_MS override is honored', () => {
    expect(readHoverDelayMs({ MONAD_HOVER_DELAY_MS: '250' })).toBe(250);
  });

  test('non-positive + garbage env values fall back to default', () => {
    expect(readHoverDelayMs({ MONAD_HOVER_DELAY_MS: '0' })).toBe(
      DEFAULT_HOVER_STABLE_MS,
    );
    expect(readHoverDelayMs({ MONAD_HOVER_DELAY_MS: '-5' })).toBe(
      DEFAULT_HOVER_STABLE_MS,
    );
    expect(readHoverDelayMs({ MONAD_HOVER_DELAY_MS: 'abc' })).toBe(
      DEFAULT_HOVER_STABLE_MS,
    );
  });
});

describe('IDX-5 Phase 1 hover-tracker — event emission', () => {
  let events: HoverEvent[] = [];
  let timers: ReturnType<typeof makeFakeTimers>;

  beforeEach(() => {
    events = [];
    timers = makeFakeTimers();
  });

  test('entering a new target fires hover-enter + hover-over', () => {
    const tr = createHoverTracker({ stableDelayMs: 200, ...timers });
    tr.subscribe((e) => events.push(e));
    tr.update({ x: 3, y: 2 }, paneTitleTarget);
    expect(events.map((e) => e.kind)).toEqual(['hover-enter', 'hover-over']);
    expect(tr.currentTarget).toEqual(paneTitleTarget);
    expect(tr.stableTarget).toBeNull();
  });

  test('same target on repeated update fires only hover-over', () => {
    const tr = createHoverTracker({ stableDelayMs: 200, ...timers });
    tr.subscribe((e) => events.push(e));
    tr.update({ x: 3, y: 2 }, paneTitleTarget);
    tr.update({ x: 4, y: 2 }, paneTitleTarget);
    tr.update({ x: 5, y: 2 }, paneTitleTarget);
    const kinds = events.map((e) => e.kind);
    expect(kinds).toEqual(['hover-enter', 'hover-over', 'hover-over', 'hover-over']);
  });

  test('moving to a different target fires leave + enter', () => {
    const tr = createHoverTracker({ stableDelayMs: 200, ...timers });
    tr.subscribe((e) => events.push(e));
    tr.update({ x: 1, y: 1 }, paneTitleTarget);
    tr.update({ x: 10, y: 5 }, pillTarget);
    const kinds = events.map((e) => e.kind);
    expect(kinds).toEqual([
      'hover-enter',
      'hover-over',
      'hover-leave',
      'hover-enter',
      'hover-over',
    ]);
  });

  test('null target clears the hover and fires hover-leave', () => {
    const tr = createHoverTracker({ stableDelayMs: 200, ...timers });
    tr.subscribe((e) => events.push(e));
    tr.update({ x: 1, y: 1 }, paneTitleTarget);
    tr.update(null, null);
    const kinds = events.map((e) => e.kind);
    expect(kinds).toEqual(['hover-enter', 'hover-over', 'hover-leave']);
    expect(tr.currentTarget).toBeNull();
  });

  test('null update with no current hover is a no-op', () => {
    const tr = createHoverTracker({ stableDelayMs: 200, ...timers });
    tr.subscribe((e) => events.push(e));
    tr.update(null, null);
    expect(events).toEqual([]);
  });

  test('hover-stable fires after delay when pointer stays put', () => {
    const tr = createHoverTracker({ stableDelayMs: 200, ...timers });
    tr.subscribe((e) => events.push(e));
    tr.update({ x: 1, y: 1 }, paneTitleTarget);
    expect(events.map((e) => e.kind)).toEqual(['hover-enter', 'hover-over']);
    timers.advance(199);
    expect(events.map((e) => e.kind)).toEqual(['hover-enter', 'hover-over']);
    timers.advance(1);
    const kinds = events.map((e) => e.kind);
    expect(kinds[kinds.length - 1]).toBe('hover-stable');
    expect(tr.stableTarget).toEqual(paneTitleTarget);
  });

  test('hover-stable does NOT fire when pointer moves before timer elapses', () => {
    const tr = createHoverTracker({ stableDelayMs: 200, ...timers });
    tr.subscribe((e) => events.push(e));
    tr.update({ x: 1, y: 1 }, paneTitleTarget);
    timers.advance(100); // t=100, pane-title hover for 100ms
    tr.update({ x: 10, y: 5 }, pillTarget);
    timers.advance(100); // t=200 — pane-title's original timer (at=200) was cancelled
    const kinds = events.map((e) => e.kind);
    expect(kinds).not.toContain('hover-stable');

    // Advance to t=300 so the pill's fresh timer (at=300) fires.
    timers.advance(100);
    const lastStable = events
      .filter((e) => e.kind === 'hover-stable')
      .at(-1) as { kind: 'hover-stable'; target: HoverTarget } | undefined;
    expect(lastStable?.target.id).toBe(pillTarget.id);
  });

  test('hover-leave cancels pending stable timer', () => {
    const tr = createHoverTracker({ stableDelayMs: 200, ...timers });
    tr.subscribe((e) => events.push(e));
    tr.update({ x: 1, y: 1 }, paneTitleTarget);
    tr.update(null, null);
    timers.advance(300);
    const kinds = events.map((e) => e.kind);
    expect(kinds).not.toContain('hover-stable');
    expect(tr.stableTarget).toBeNull();
  });

  test('throwing listener does not break other subscribers', () => {
    const tr = createHoverTracker({ stableDelayMs: 200, ...timers });
    tr.subscribe(() => {
      throw new Error('boom');
    });
    tr.subscribe((e) => events.push(e));
    tr.update({ x: 1, y: 1 }, paneTitleTarget);
    expect(events.length).toBeGreaterThan(0);
  });

  test('dispose cancels timer, clears state, drops listeners', () => {
    const tr = createHoverTracker({ stableDelayMs: 200, ...timers });
    tr.subscribe((e) => events.push(e));
    tr.update({ x: 1, y: 1 }, paneTitleTarget);
    expect(timers.pending()).toBe(1);
    tr.dispose();
    expect(timers.pending()).toBe(0);
    expect(tr.currentTarget).toBeNull();
    expect(tr.stableTarget).toBeNull();
    tr.update({ x: 2, y: 2 }, pillTarget); // should be ignored
    const kinds = events.map((e) => e.kind);
    expect(kinds).toEqual(['hover-enter', 'hover-over']);
  });

  test('unsubscribe removes the listener', () => {
    const tr = createHoverTracker({ stableDelayMs: 200, ...timers });
    const unsub = tr.subscribe((e) => events.push(e));
    tr.update({ x: 1, y: 1 }, paneTitleTarget);
    expect(events.length).toBe(2);
    unsub();
    tr.update(null, null);
    expect(events.length).toBe(2); // no new events
  });
});

describe('IDX-5 Phase 1 hover-tracker — context-keys bridge', () => {
  let timers: ReturnType<typeof makeFakeTimers>;
  beforeEach(() => {
    timers = makeFakeTimers();
  });

  test('hover-stable updates hoverTargetKind + hoverTooltip', () => {
    const ctx = createContextKeyService();
    const tr = createHoverTracker({ stableDelayMs: 200, ...timers });
    wireHoverToContextKeys(tr, ctx);

    tr.update({ x: 1, y: 1 }, paneTitleTarget);
    expect(ctx.keys.hoverTargetKind).toBeNull(); // not stable yet
    timers.advance(200);
    expect(ctx.keys.hoverTargetKind).toBe('pane-title');
    expect(ctx.keys.hoverTooltip).toBe('Sidebar');
  });

  test('hover-leave clears the context keys', () => {
    const ctx = createContextKeyService();
    const tr = createHoverTracker({ stableDelayMs: 100, ...timers });
    wireHoverToContextKeys(tr, ctx);

    tr.update({ x: 1, y: 1 }, paneTitleTarget);
    timers.advance(100);
    expect(ctx.keys.hoverTargetKind).toBe('pane-title');

    tr.update(null, null);
    expect(ctx.keys.hoverTargetKind).toBeNull();
    expect(ctx.keys.hoverTooltip).toBeNull();
  });

  test('initial context keys include hover fields as null', () => {
    expect(INITIAL_CONTEXT_KEYS.hoverTargetKind).toBeNull();
    expect(INITIAL_CONTEXT_KEYS.hoverTooltip).toBeNull();
  });

  test('target without tooltipText surfaces null tooltip', () => {
    const ctx = createContextKeyService();
    const tr = createHoverTracker({ stableDelayMs: 50, ...timers });
    wireHoverToContextKeys(tr, ctx);

    tr.update({ x: 1, y: 1 }, { id: 'x:y', kind: 'pill' });
    timers.advance(50);
    expect(ctx.keys.hoverTargetKind).toBe('pill');
    expect(ctx.keys.hoverTooltip).toBeNull();
  });

  test('rapid target switches leave context keys in the final stable state', () => {
    const ctx = createContextKeyService();
    const tr = createHoverTracker({ stableDelayMs: 100, ...timers });
    wireHoverToContextKeys(tr, ctx);

    tr.update({ x: 1, y: 1 }, paneTitleTarget);
    timers.advance(50);
    tr.update({ x: 10, y: 5 }, pillTarget);
    timers.advance(50);
    // pane-title timer was pre-empted; pill timer still has 50ms left
    expect(ctx.keys.hoverTargetKind).toBeNull();
    timers.advance(50);
    expect(ctx.keys.hoverTargetKind).toBe('pill');
    expect(ctx.keys.hoverTooltip).toBe('Active model');
  });
});
