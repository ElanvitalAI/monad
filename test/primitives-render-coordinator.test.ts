// ─────────────────────────────────────────────────────────────────
// RenderCoordinator primitive tests — H1.5 of
// PLAN-compositor-w2-render-coordinator.md
//
// 30+ cases covering:
//   - §5.1 Lifecycle · flush basics (7)
//   - §5.2 Dirty queue + regions (7)
//   - §5.3 Events (5)
//   - §5.4 requestFrame + schedule (5)
//   - §5.5 Subscription + error isolation (3)
//   - §5.6 Debug snapshot (3)
// ─────────────────────────────────────────────────────────────────

import { describe, expect, test } from 'bun:test';
import {
  createRenderCoordinator,
  type LayerId,
  type Rect,
  type RenderCoordinatorEvent,
} from '../src/primitives/render-coordinator/index.js';

const id = (s: string): LayerId => s as LayerId;
const rect = (row = 1, col = 1, width = 10, height = 4): Rect => ({ row, col, width, height });

// ── §5.1 Lifecycle · flush basics ──────────────────────────────

describe('W2 RenderCoordinator · lifecycle', () => {
  test('markNeedsPaint sets isDirty true', () => {
    const rc = createRenderCoordinator();
    expect(rc.isDirty()).toBe(false);
    rc.markNeedsPaint(id('l1'));
    expect(rc.isDirty()).toBe(true);
  });

  test('flush clears the dirty queue', () => {
    const rc = createRenderCoordinator();
    rc.markNeedsPaint(id('l1'));
    rc.flush();
    expect(rc.isDirty()).toBe(false);
  });

  test('flush is a no-op when not dirty · no event + no frame bump', () => {
    const rc = createRenderCoordinator();
    const fired: RenderCoordinatorEvent[] = [];
    rc.on('before-flush', (ev) => fired.push(ev));
    rc.on('after-flush', (ev) => fired.push(ev));
    rc.flush();
    expect(fired).toHaveLength(0);
    expect(rc.debug().frameCount).toBe(0);
  });

  test("flush emits 'before-flush' then 'after-flush' in order", () => {
    const rc = createRenderCoordinator();
    const order: string[] = [];
    rc.on('before-flush', () => order.push('before'));
    rc.on('after-flush', () => order.push('after'));
    rc.markNeedsPaint(id('l1'));
    rc.flush();
    expect(order).toEqual(['before', 'after']);
  });

  test('flush twice in a row · second is a no-op', () => {
    const rc = createRenderCoordinator();
    rc.markNeedsPaint(id('l1'));
    rc.flush();
    const fc = rc.debug().frameCount;
    rc.flush();
    expect(rc.debug().frameCount).toBe(fc);
  });

  test('flush after requestFrame (sync default) still works directly', () => {
    const rc = createRenderCoordinator();
    rc.markNeedsPaint(id('l1'));
    // Sync default: requestFrame runs flush immediately.
    rc.requestFrame();
    expect(rc.isDirty()).toBe(false);
    expect(rc.debug().frameCount).toBe(1);
  });

  test('frameCount is monotonic · bumped only on productive flush', () => {
    const rc = createRenderCoordinator();
    expect(rc.debug().frameCount).toBe(0);
    rc.flush();  // no-op
    expect(rc.debug().frameCount).toBe(0);
    rc.markNeedsPaint(id('a'));
    rc.flush();
    expect(rc.debug().frameCount).toBe(1);
    rc.markNeedsPaint(id('b'));
    rc.flush();
    expect(rc.debug().frameCount).toBe(2);
  });
});

// ── §5.2 Dirty queue + regions ─────────────────────────────────

describe('W2 RenderCoordinator · dirty queue + regions', () => {
  test('markNeedsPaint without region · regions empty', () => {
    const rc = createRenderCoordinator();
    rc.markNeedsPaint(id('l1'));
    expect(rc.getDirtyRegions(id('l1'))).toEqual([]);
  });

  test('markNeedsPaint with rect · regions contains it', () => {
    const rc = createRenderCoordinator();
    const r = rect(2, 3, 20, 10);
    rc.markNeedsPaint(id('l1'), r);
    expect(rc.getDirtyRegions(id('l1'))).toEqual([r]);
  });

  test('same (layer · rect) repeat · de-duped', () => {
    const rc = createRenderCoordinator();
    const r = rect();
    rc.markNeedsPaint(id('l1'), r);
    rc.markNeedsPaint(id('l1'), r);
    rc.markNeedsPaint(id('l1'), r);
    expect(rc.getDirtyRegions(id('l1'))).toEqual([r]);
  });

  test('different rects for same layer · appended in insertion order', () => {
    const rc = createRenderCoordinator();
    const r1 = rect(1, 1, 5, 5);
    const r2 = rect(10, 10, 3, 3);
    rc.markNeedsPaint(id('l1'), r1);
    rc.markNeedsPaint(id('l1'), r2);
    expect(rc.getDirtyRegions(id('l1'))).toEqual([r1, r2]);
  });

  test('multiple layers · independent dirty entries', () => {
    const rc = createRenderCoordinator();
    rc.markNeedsPaint(id('a'), rect(1, 1, 2, 2));
    rc.markNeedsPaint(id('b'), rect(3, 3, 2, 2));
    expect(rc.debug().dirtyLayerCount).toBe(2);
    expect(rc.getDirtyRegions(id('a'))).toHaveLength(1);
    expect(rc.getDirtyRegions(id('b'))).toHaveLength(1);
  });

  test('getDirtyRegions for unknown layer · undefined', () => {
    const rc = createRenderCoordinator();
    expect(rc.getDirtyRegions(id('ghost'))).toBeUndefined();
  });

  test('getDirtyRegions returns a fresh snapshot (mutation safe)', () => {
    const rc = createRenderCoordinator();
    rc.markNeedsPaint(id('l1'), rect());
    const snap1 = rc.getDirtyRegions(id('l1'))!;
    // Even if caller mutates the snapshot, internal state is untouched.
    (snap1 as Rect[]).push(rect(99, 99, 1, 1));
    const snap2 = rc.getDirtyRegions(id('l1'))!;
    expect(snap2).toHaveLength(1);
  });
});

// ── §5.3 Events ─────────────────────────────────────────────────

describe('W2 RenderCoordinator · events', () => {
  test("'dirty-added' fires on every markNeedsPaint", () => {
    const rc = createRenderCoordinator();
    let count = 0;
    rc.on('dirty-added', () => { count++; });
    rc.markNeedsPaint(id('a'));
    rc.markNeedsPaint(id('b'));
    rc.markNeedsPaint(id('c'));
    expect(count).toBe(3);
  });

  test("'before-flush' fires before subscribers' paint (subscriber order observed)", () => {
    const rc = createRenderCoordinator();
    const order: string[] = [];
    rc.on('before-flush', () => order.push('pre-1'));
    rc.on('before-flush', () => order.push('pre-2'));
    rc.on('after-flush', () => order.push('post'));
    rc.markNeedsPaint(id('l'));
    rc.flush();
    // Both pre-listeners fire before the post-listener.
    expect(order.indexOf('pre-1')).toBeLessThan(order.indexOf('post'));
    expect(order.indexOf('pre-2')).toBeLessThan(order.indexOf('post'));
  });

  test('event entries carry dirty snapshot at emit time', () => {
    const rc = createRenderCoordinator();
    const captured: RenderCoordinatorEvent[] = [];
    rc.on('before-flush', (ev) => captured.push(ev));
    rc.markNeedsPaint(id('a'), rect(1, 1, 5, 5));
    rc.markNeedsPaint(id('b'), rect(6, 6, 5, 5));
    rc.flush();
    expect(captured).toHaveLength(1);
    expect(captured[0]!.entries).toHaveLength(2);
    expect(captured[0]!.entries.map((e) => e.layerId).sort()).toEqual(['a' as LayerId, 'b' as LayerId].sort());
  });

  test('multiple subscribers per kind · all fire', () => {
    const rc = createRenderCoordinator();
    let a = 0, b = 0, c = 0;
    rc.on('dirty-added', () => { a++; });
    rc.on('dirty-added', () => { b++; });
    rc.on('dirty-added', () => { c++; });
    rc.markNeedsPaint(id('l'));
    expect(a).toBe(1);
    expect(b).toBe(1);
    expect(c).toBe(1);
  });

  test("event.frameCount reflects post-increment at 'before-flush'", () => {
    const rc = createRenderCoordinator();
    let beforeCount = -1;
    let afterCount = -1;
    rc.on('before-flush', (ev) => { beforeCount = ev.frameCount; });
    rc.on('after-flush', (ev) => { afterCount = ev.frameCount; });
    rc.markNeedsPaint(id('l'));
    rc.flush();
    // Both emits happen after the counter bumped — they see frame 1.
    expect(beforeCount).toBe(1);
    expect(afterCount).toBe(1);
  });
});

// ── §5.4 requestFrame + schedule ───────────────────────────────

describe('W2 RenderCoordinator · requestFrame + schedule', () => {
  test('requestFrame calls the caller-provided scheduleFn with flush', () => {
    let scheduledFn: (() => void) | null = null;
    const rc = createRenderCoordinator({
      schedule: (fn) => { scheduledFn = fn; },
    });
    rc.markNeedsPaint(id('l'));
    rc.requestFrame();
    expect(scheduledFn).not.toBeNull();
    scheduledFn!();
    expect(rc.isDirty()).toBe(false);
    expect(rc.debug().frameCount).toBe(1);
  });

  test('multiple requestFrame calls · scheduleFn invoked once (coalescing)', () => {
    let scheduleCount = 0;
    const rc = createRenderCoordinator({
      schedule: () => { scheduleCount++; },
    });
    rc.requestFrame();
    rc.requestFrame();
    rc.requestFrame();
    expect(scheduleCount).toBe(1);
  });

  test('requestFrame without scheduleFn · flushes synchronously', () => {
    const rc = createRenderCoordinator();
    rc.markNeedsPaint(id('l'));
    rc.requestFrame();
    // Default sync: flush ran inside requestFrame.
    expect(rc.isDirty()).toBe(false);
  });

  test('requestFrame after flush · fresh schedule happens', () => {
    let scheduleCount = 0;
    const rc = createRenderCoordinator({
      schedule: (fn) => { scheduleCount++; fn(); },
    });
    rc.markNeedsPaint(id('a'));
    rc.requestFrame();  // schedule #1 · flushes inside
    rc.markNeedsPaint(id('b'));
    rc.requestFrame();  // schedule #2 · flushes inside
    expect(scheduleCount).toBe(2);
  });

  test('debug.pendingRequestFrame toggles correctly', () => {
    let deferredRun: (() => void) | null = null;
    const rc = createRenderCoordinator({
      schedule: (fn) => { deferredRun = fn; },
    });
    expect(rc.debug().pendingRequestFrame).toBe(false);
    rc.requestFrame();
    expect(rc.debug().pendingRequestFrame).toBe(true);
    deferredRun!();
    expect(rc.debug().pendingRequestFrame).toBe(false);
  });
});

// ── §5.5 Subscription + error isolation ────────────────────────

describe('W2 RenderCoordinator · subscription + error isolation', () => {
  test('unsubscribe stops delivery', () => {
    const rc = createRenderCoordinator();
    let count = 0;
    const off = rc.on('dirty-added', () => { count++; });
    rc.markNeedsPaint(id('a'));
    off();
    rc.markNeedsPaint(id('b'));
    expect(count).toBe(1);
  });

  test('listener throw does not block siblings', () => {
    const rc = createRenderCoordinator();
    let siblingFired = false;
    rc.on('dirty-added', () => { throw new Error('boom'); });
    rc.on('dirty-added', () => { siblingFired = true; });
    rc.markNeedsPaint(id('l'));
    expect(siblingFired).toBe(true);
  });

  test('listener throw during flush does not break the frame', () => {
    const rc = createRenderCoordinator();
    rc.on('before-flush', () => { throw new Error('boom'); });
    rc.markNeedsPaint(id('l'));
    expect(() => rc.flush()).not.toThrow();
    expect(rc.isDirty()).toBe(false);  // queue cleared even after listener threw
  });
});

// ── §5.6 Debug snapshot ───────────────────────────────────────

describe('W2 RenderCoordinator · debug snapshot', () => {
  test('debug.dirtyLayerCount reflects queue size', () => {
    const rc = createRenderCoordinator();
    expect(rc.debug().dirtyLayerCount).toBe(0);
    rc.markNeedsPaint(id('a'));
    rc.markNeedsPaint(id('b'));
    expect(rc.debug().dirtyLayerCount).toBe(2);
    rc.flush();
    expect(rc.debug().dirtyLayerCount).toBe(0);
  });

  test('debug.listenerCount reflects subscriptions', () => {
    const rc = createRenderCoordinator();
    expect(rc.debug().listenerCount).toBe(0);
    const off1 = rc.on('dirty-added', () => {});
    rc.on('before-flush', () => {});
    expect(rc.debug().listenerCount).toBe(2);
    off1();
    expect(rc.debug().listenerCount).toBe(1);
  });

  test('two independent RenderCoordinator instances share no state', () => {
    const a = createRenderCoordinator();
    const b = createRenderCoordinator();
    a.markNeedsPaint(id('x'));
    expect(a.isDirty()).toBe(true);
    expect(b.isDirty()).toBe(false);
  });
});

// ── Re-entry semantics (invariant §3.5 #4) ─────────────────────

describe('W2 RenderCoordinator · re-entry behaviour', () => {
  test('markNeedsPaint inside a before-flush listener lands on next frame', () => {
    const rc = createRenderCoordinator();
    let beforeFlushSeen = -1;
    rc.on('before-flush', () => {
      // Subscriber marks a new layer during flush — must NOT appear
      // in this frame's snapshot (already snapshotted) AND should
      // survive the queue clear to be flushable next frame.
      rc.markNeedsPaint(id('new-during-flush'));
    });
    rc.on('after-flush', () => { beforeFlushSeen = rc.debug().dirtyLayerCount; });
    rc.markNeedsPaint(id('original'));
    rc.flush();
    // After flush: first frame cleared ('original'), but the new mark
    // from the subscriber landed on the fresh queue.
    expect(rc.isDirty()).toBe(true);
    expect(rc.getDirtyRegions(id('new-during-flush'))).toEqual([]);
    // The after-flush listener saw the new-during-flush entry.
    expect(beforeFlushSeen).toBe(1);
  });
});
