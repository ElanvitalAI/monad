// ── Widget host — Arc F frame tickler ──
//
// Verifies that `scheduleNextFrameIfAnimating` only calls the host hook
// when at least one widget has an active tween, that the `animate.tween`
// handle triggers scheduling on fresh tween starts, and that hooks
// without `scheduleFrame` wired (or no animators registered) stay silent.

import { describe, test, expect, beforeEach } from 'bun:test';
import { WidgetHost, type WidgetHostHooks } from '../src/widgets/host.js';
import type { WidgetDef } from '../src/widgets/types.js';

interface HarnessHooks extends WidgetHostHooks {
  scheduled: number[];
  logs: string[];
}

function makeHooks(withSchedule = true): HarnessHooks {
  const scheduled: number[] = [];
  const logs: string[] = [];
  const h: HarnessHooks = {
    scheduled,
    logs,
    log: (l) => { logs.push(l); },
    requestRender: () => {},
  };
  if (withSchedule) {
    h.scheduleFrame = (ms) => { scheduled.push(ms); };
  }
  return h;
}

const tweenWidget: WidgetDef<{ label: string }> = {
  type: 'tween-test',
  description: 'arc-F test fixture',
  defaultCharacter: 'Tween',
  initialState: () => ({ label: '' }),
  render: (s) => [s.label],
};

describe('WidgetHost — Arc F frame tickler', () => {
  let host: WidgetHost;
  let hooks: HarnessHooks;

  beforeEach(() => {
    hooks = makeHooks();
    host = new WidgetHost(hooks);
    host.register(tweenWidget);
  });

  test('scheduleNextFrameIfAnimating is a no-op when no animators exist', () => {
    host.scheduleNextFrameIfAnimating();
    expect(hooks.scheduled).toEqual([]);
  });

  test('animate.tween schedules the next frame while animation is active', () => {
    host.spawn({ type: 'tween-test', id: 'w1' });
    const ctx = host.buildContext<{ label: string }>('w1')!;

    ctx.animate.tween({ key: 'opacity', durationMs: 200 });

    expect(hooks.scheduled).toHaveLength(1);
    expect(hooks.scheduled[0]).toBe(16);
    expect(host.anyActiveAnimation()).toBe(true);
  });

  test('repeated scheduleNextFrameIfAnimating calls each arm the hook (dedup lives in the host impl)', () => {
    host.spawn({ type: 'tween-test', id: 'w1' });
    const ctx = host.buildContext<{ label: string }>('w1')!;
    ctx.animate.tween({ key: 'opacity', durationMs: 200 });
    hooks.scheduled.length = 0; // reset after the tween start

    host.scheduleNextFrameIfAnimating();
    host.scheduleNextFrameIfAnimating();
    host.scheduleNextFrameIfAnimating();

    // The host itself does not dedup — the dashboard wrapper does via
    // `framePending`. WidgetHost just forwards when anyActiveAnimation.
    expect(hooks.scheduled).toHaveLength(3);
  });

  test('scheduleNextFrameIfAnimating stops firing once every tween completes', () => {
    host.spawn({ type: 'tween-test', id: 'w1' });
    const ctx = host.buildContext<{ label: string }>('w1')!;

    // Start a very short tween so it completes immediately after the
    // wall clock advances past durationMs. We use a past startAt to
    // simulate "time has moved on" without sleeping.
    ctx.animate.tween({ key: 'opacity', durationMs: 1, startAt: Date.now() - 1000 });
    hooks.scheduled.length = 0;

    host.scheduleNextFrameIfAnimating();

    expect(host.anyActiveAnimation()).toBe(false);
    expect(hooks.scheduled).toEqual([]);
  });

  test('host without scheduleFrame hook stays silent', () => {
    const bare = makeHooks(false);
    const bareHost = new WidgetHost(bare);
    bareHost.register(tweenWidget);
    bareHost.spawn({ type: 'tween-test', id: 'w1' });
    const ctx = bareHost.buildContext<{ label: string }>('w1')!;

    // Should not throw — tween still registers in the controller.
    ctx.animate.tween({ key: 'opacity', durationMs: 200 });

    expect(bareHost.anyActiveAnimation()).toBe(true);
    expect(bare.scheduled).toEqual([]);
  });

  test('multiple widgets animating — one active keeps the loop armed', () => {
    host.spawn({ type: 'tween-test', id: 'w1' });
    host.spawn({ type: 'tween-test', id: 'w2' });
    const c1 = host.buildContext<{ label: string }>('w1')!;
    const c2 = host.buildContext<{ label: string }>('w2')!;

    // w1 tween already done, w2 still active.
    c1.animate.tween({ key: 'k1', durationMs: 1, startAt: Date.now() - 500 });
    c2.animate.tween({ key: 'k2', durationMs: 500 });
    hooks.scheduled.length = 0;

    host.scheduleNextFrameIfAnimating();

    expect(hooks.scheduled).toHaveLength(1);
  });

  test('custom delayMs propagates through to the hook', () => {
    host.spawn({ type: 'tween-test', id: 'w1' });
    const ctx = host.buildContext<{ label: string }>('w1')!;
    ctx.animate.tween({ key: 'k', durationMs: 500 });
    hooks.scheduled.length = 0;

    host.scheduleNextFrameIfAnimating(33);

    expect(hooks.scheduled).toEqual([33]);
  });

  test('dispose clears the animator so the loop disarms even mid-tween', () => {
    host.spawn({ type: 'tween-test', id: 'w1' });
    const ctx = host.buildContext<{ label: string }>('w1')!;
    ctx.animate.tween({ key: 'k', durationMs: 60_000 });
    expect(host.anyActiveAnimation()).toBe(true);

    host.dispose('w1');
    hooks.scheduled.length = 0;
    host.scheduleNextFrameIfAnimating();

    expect(host.anyActiveAnimation()).toBe(false);
    expect(hooks.scheduled).toEqual([]);
  });
});
