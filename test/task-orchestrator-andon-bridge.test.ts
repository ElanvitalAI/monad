import { describe, expect, test } from 'bun:test';
import { TaskGraph } from '../src/task-orchestrator/graph.ts';
import { SurfaceRegistry } from '../src/task-orchestrator/surface-registry.ts';
import { TaskDispatcher } from '../src/task-orchestrator/dispatcher.ts';
import { TaskEventBus } from '../src/task-orchestrator/events.ts';
import { TaskFeedbackLoop } from '../src/task-orchestrator/feedback-loop.ts';
import {
  startAndonBridge,
  type AndonSignalLike,
  type AndonSubscriberKind,
} from '../src/task-orchestrator/andon-bridge.ts';

function mkLoop(): TaskFeedbackLoop {
  const graph = new TaskGraph();
  const registry = new SurfaceRegistry();
  const dispatcher = new TaskDispatcher({ graph, registry, bus: new TaskEventBus() });
  return new TaskFeedbackLoop({ graph, dispatcher });
}

function mkSubscribeSeam() {
  let handler:
    | ((s: AndonSignalLike, k: AndonSubscriberKind) => void)
    | null = null;
  const subscribe = (fn: (s: AndonSignalLike, k: AndonSubscriberKind) => void) => {
    handler = fn;
    return () => {
      handler = null;
    };
  };
  return {
    subscribe,
    fire: (s: AndonSignalLike, k: AndonSubscriberKind) => {
      if (!handler) throw new Error('no subscriber');
      handler(s, k);
    },
    get handler() {
      return handler;
    },
  };
}

describe('startAndonBridge', () => {
  test('AB1: emit CRITICAL → loop.pause(andon)', () => {
    const loop = mkLoop();
    const seam = mkSubscribeSeam();
    const dispose = startAndonBridge({ loop, subscribe: seam.subscribe });
    seam.fire({ severity: 'CRITICAL' }, 'emit');
    expect(loop.isPaused()).toBe(true);
    expect(loop.stats().pausedReason).toBe('andon');
    dispose();
  });

  test('AB2: emit HIGH → pause', () => {
    const loop = mkLoop();
    const seam = mkSubscribeSeam();
    const dispose = startAndonBridge({ loop, subscribe: seam.subscribe });
    seam.fire({ severity: 'HIGH' }, 'emit');
    expect(loop.isPaused()).toBe(true);
    dispose();
  });

  test('AB3: emit MED / LOW → loop unchanged', () => {
    const loop = mkLoop();
    const seam = mkSubscribeSeam();
    const dispose = startAndonBridge({ loop, subscribe: seam.subscribe });
    seam.fire({ severity: 'MED' }, 'emit');
    seam.fire({ severity: 'LOW' }, 'emit');
    expect(loop.isPaused()).toBe(false);
    dispose();
  });

  test('AB4: resolve with no pending critical → resume', () => {
    const loop = mkLoop();
    const seam = mkSubscribeSeam();
    let pending = true;
    const dispose = startAndonBridge({
      loop,
      subscribe: seam.subscribe,
      hasPendingCritical: () => pending,
    });
    seam.fire({ severity: 'CRITICAL' }, 'emit');
    expect(loop.isPaused()).toBe(true);
    pending = false;
    seam.fire({ severity: 'CRITICAL' }, 'resolve');
    expect(loop.isPaused()).toBe(false);
    dispose();
  });

  test('AB5: resolve while still pending → keep paused', () => {
    const loop = mkLoop();
    const seam = mkSubscribeSeam();
    let pending = true;
    const dispose = startAndonBridge({
      loop,
      subscribe: seam.subscribe,
      hasPendingCritical: () => pending,
    });
    seam.fire({ severity: 'CRITICAL' }, 'emit');
    seam.fire({ severity: 'HIGH' }, 'resolve'); // pending still true
    expect(loop.isPaused()).toBe(true);
    dispose();
  });

  test('AB6: dispose detaches listener', () => {
    const loop = mkLoop();
    const seam = mkSubscribeSeam();
    const dispose = startAndonBridge({ loop, subscribe: seam.subscribe });
    expect(seam.handler).not.toBeNull();
    dispose();
    expect(seam.handler).toBeNull();
  });

  test('AB7: resolve preserves non-andon pause reasons', () => {
    const loop = mkLoop();
    loop.pause('budget'); // unrelated pause reason
    const seam = mkSubscribeSeam();
    const dispose = startAndonBridge({
      loop,
      subscribe: seam.subscribe,
      hasPendingCritical: () => false,
    });
    seam.fire({ severity: 'CRITICAL' }, 'resolve');
    expect(loop.isPaused()).toBe(true);
    expect(loop.stats().pausedReason).toBe('budget');
    dispose();
  });
});
