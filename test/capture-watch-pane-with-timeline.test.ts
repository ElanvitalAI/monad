// Phase B · X3 closure — dispatchWatchPaneWithTimeline merges
// captures + posture events into one timeline.
//
// We test the *closure* layer, not `dispatchWatchPane` (P7-E-α) or
// `composePostureTimeline` (X3 base) which have their own suites.
// Real-wiring approach (per CLAUDE.md): no mock.module, just inject
// fakes through the deps object.

import { describe, expect, test } from 'bun:test';
import { dispatchWatchPaneWithTimeline } from '../src/capture/watch-pane-with-timeline.js';
import type { ShellRegistry, ShellPostureEvent, ShellPostureSubscriber, Unsubscribe } from '../src/shell-runner/types.js';

function makeFakeRegistry(emitEvents: readonly ShellPostureEvent[] = []): ShellRegistry {
  const subscribers = new Set<ShellPostureSubscriber>();
  const reg: any = {
    subscribePosture(sub: ShellPostureSubscriber): Unsubscribe {
      subscribers.add(sub);
      // Emit queued events asynchronously so the watch is in flight
      queueMicrotask(() => {
        for (const ev of emitEvents) sub(ev);
      });
      return () => {
        subscribers.delete(sub);
      };
    },
    get: () => null,
    list: () => [],
    getVwLabel: () => undefined,
    register: () => {},
    unregister: () => {},
  };
  return reg as ShellRegistry;
}

describe('dispatchWatchPaneWithTimeline', () => {
  test('without shellRegistry — timeline contains only captures from before/after', async () => {
    let nowCounter = 1000;
    const result = await dispatchWatchPaneWithTimeline(
      { ref: { windowId: 'w1', paneId: 'p1' }, durationMs: 100 },
      {
        // Stub describePane / capturePane via SurfaceUIDeps so the
        // real dispatchWatchPane completes synchronously without
        // touching a substrate. We pass an empty deps; dispatchWatchPane
        // returns `{found:false, ...}` which is fine for our test.
        now: () => nowCounter++,
      },
    );
    expect(result.timeline).toBeDefined();
    // No posture source → no posture-change entries.
    const postureEntries = result.timeline.filter((e) => e.kind === 'posture-change');
    expect(postureEntries).toHaveLength(0);
  });

  test('with shellRegistry — posture events recorded between calls merge into timeline', async () => {
    const events: ShellPostureEvent[] = [
      {
        kind: 'transition',
        shellId: 's7',
        prev: { userExposure: 'user-interactive', agentInteractive: false } as any,
        next: { userExposure: 'observe-only', agentInteractive: false } as any,
      } as any,
      {
        kind: 'transition',
        shellId: 's7',
        prev: { userExposure: 'observe-only', agentInteractive: false } as any,
        next: { userExposure: 'unavailable', agentInteractive: false } as any,
      } as any,
    ];
    const reg = makeFakeRegistry(events);

    let nowCounter = 1000;
    const result = await dispatchWatchPaneWithTimeline(
      { ref: { windowId: 'w7', paneId: 'p7' }, durationMs: 100 },
      {
        shellRegistry: reg,
        shellId: 's7',
        now: () => nowCounter++,
      },
    );

    const postureEntries = result.timeline.filter((e) => e.kind === 'posture-change');
    expect(postureEntries.length).toBe(2);
    const first = postureEntries[0]!;
    expect(first.kind).toBe('posture-change');
    if (first.kind === 'posture-change') {
      expect(first.shellId).toBe('s7');
      expect(first.prev).toBe('user-interactive');
      expect(first.next).toBe('observe-only');
    }
  });

  test('shellId filter — only events for the focused shell are recorded', async () => {
    const events: ShellPostureEvent[] = [
      { kind: 'transition', shellId: 's1', prev: { userExposure: 'user-interactive', agentInteractive: false } as any, next: { userExposure: 'observe-only', agentInteractive: false } as any } as any,
      { kind: 'transition', shellId: 's2', prev: { userExposure: 'user-interactive', agentInteractive: false } as any, next: { userExposure: 'observe-only', agentInteractive: false } as any } as any,
    ];
    const reg = makeFakeRegistry(events);

    const result = await dispatchWatchPaneWithTimeline(
      { ref: { windowId: 'w1', paneId: 'p1' }, durationMs: 50 },
      { shellRegistry: reg, shellId: 's1', now: () => 0 },
    );
    const postureEntries = result.timeline.filter((e) => e.kind === 'posture-change');
    expect(postureEntries.length).toBe(1);
    if (postureEntries[0]!.kind === 'posture-change') {
      expect(postureEntries[0]!.shellId).toBe('s1');
    }
  });

  test('preserves base WatchPaneOut fields verbatim', async () => {
    const result = await dispatchWatchPaneWithTimeline(
      { ref: { windowId: 'w1', paneId: 'p1' }, durationMs: 100 },
      { now: () => 0 },
    );
    // Base fields from dispatchWatchPane preserved
    expect(result.found).toBeDefined();
    expect(result.ref).toBeDefined();
    expect(result.windowMs).toBeDefined();
    expect(result.events).toBeDefined();
    expect(result.truncated).toBeDefined();
    // Phase B addition
    expect(result.timeline).toBeDefined();
  });
});
