// PR-3 of multi-platform substrate ROADMAP · terminal host facade tests.

import { describe, expect, test } from 'bun:test';

import { createDisplayEventBus } from '../../src/display/events.js';
import { createTerminalHostFacade } from '../../src/shell-runner/terminal-host-facade.js';
import type { TerminalMouseIntentSpec } from '../../src/dashboard/terminal-surface-intent.js';
import { interactiveTerminalExposure } from '../../src/terminal/posture.js';

function spec(mouseType: 'click' | 'double-click' = 'click'): TerminalMouseIntentSpec {
  return {
    surfaceId: 'pane:1',
    paneKind: 'terminal',
    mouseType,
    row: 1,
    col: 2,
    exposure: interactiveTerminalExposure(),
  };
}

describe('terminal host facade (PR-3)', () => {
  test('emits canonical event onto displayEvents bus', () => {
    const bus = createDisplayEventBus();
    const seen: unknown[] = [];
    bus.subscribe('terminal:mouse-intent', (e) => seen.push(e));
    const facade = createTerminalHostFacade({ displayEvents: bus });

    facade.publishMouseIntent(spec('double-click'));

    expect(seen.length).toBe(1);
    expect((seen[0] as { type: string }).type).toBe('terminal:mouse-intent');
    // PR #1333 invariants preserved: transport derivation + posture metadata
    expect((seen[0] as { transport: string }).transport).toBe('host-only');
  });

  test('skips publish when nobody is subscribed (hot-path optimization)', () => {
    const bus = createDisplayEventBus();
    const facade = createTerminalHostFacade({ displayEvents: bus });
    let busEmits = 0;
    const original = bus.emit.bind(bus);
    bus.emit = (e) => { busEmits++; return original(e); };

    facade.publishMouseIntent(spec());
    expect(busEmits).toBe(0);
  });

  test('subscribePublish receives the same event the bus would', () => {
    const bus = createDisplayEventBus();
    bus.subscribe('terminal:mouse-intent', () => {}); // ensure bus has subs
    const facade = createTerminalHostFacade({ displayEvents: bus });
    const seen: Array<{ mouseType: string }> = [];
    facade.subscribePublish((e) => seen.push({ mouseType: e.mouseType }));

    facade.publishMouseIntent(spec('click'));
    facade.publishMouseIntent(spec('double-click'));

    expect(seen).toEqual([{ mouseType: 'click' }, { mouseType: 'double-click' }]);
  });

  test('subscribePublish triggers even when bus has no subscribers (G2 future host attach)', () => {
    const bus = createDisplayEventBus();
    const facade = createTerminalHostFacade({ displayEvents: bus });
    const seen: string[] = [];
    facade.subscribePublish((e) => seen.push(e.mouseType));

    facade.publishMouseIntent(spec('click'));

    expect(seen).toEqual(['click']);
  });

  test('subscribePublish unsubscribe stops further callbacks', () => {
    const bus = createDisplayEventBus();
    const facade = createTerminalHostFacade({ displayEvents: bus });
    const seen: string[] = [];
    const unsub = facade.subscribePublish((e) => seen.push(e.mouseType));

    facade.publishMouseIntent(spec('click'));
    unsub();
    facade.publishMouseIntent(spec('double-click'));

    expect(seen).toEqual(['click']);
    expect(facade.publishSubscriberCount()).toBe(0);
  });

  test('throwing subscriber is isolated; other subscribers still receive', () => {
    const bus = createDisplayEventBus();
    const seenLogs: Array<{ category: string; event: string }> = [];
    const facade = createTerminalHostFacade({
      displayEvents: bus,
      isDebugEnabled: () => true,
      logDebug: (category, event) => seenLogs.push({ category, event }),
    });
    const downstreamSeen: string[] = [];
    facade.subscribePublish(() => { throw new Error('boom'); });
    facade.subscribePublish((e) => downstreamSeen.push(e.mouseType));

    facade.publishMouseIntent(spec('click'));

    expect(downstreamSeen).toEqual(['click']);
    expect(seenLogs.find(l => l.category === 'terminal.host-facade.subscriber-throw')).toBeTruthy();
  });

  test('dispose clears subscribers and stops future publishes', () => {
    const bus = createDisplayEventBus();
    bus.subscribe('terminal:mouse-intent', () => {});
    const facade = createTerminalHostFacade({ displayEvents: bus });
    const seen: string[] = [];
    facade.subscribePublish((e) => seen.push(e.mouseType));

    facade.dispose();
    facade.publishMouseIntent(spec('click'));

    expect(seen).toEqual([]);
    expect(facade.publishSubscriberCount()).toBe(0);
  });

  test('preserves PR-1 / PR-2 event payload — exposure + interactionPolicy + transport', () => {
    const bus = createDisplayEventBus();
    const seen: Array<Record<string, unknown>> = [];
    bus.subscribe('terminal:mouse-intent', (e) => seen.push(e as Record<string, unknown>));
    const facade = createTerminalHostFacade({ displayEvents: bus });

    facade.publishMouseIntent(spec('double-click'));

    const event = seen[0];
    expect(event).toMatchObject({
      type: 'terminal:mouse-intent',
      surfaceId: 'pane:1',
      paneKind: 'terminal',
      mouseType: 'double-click',
      transport: 'host-only', // G4 invariant — double-click never PTY forwards
      exposure: { userExposure: 'user-interactive', agentInteractive: true },
    });
    expect(event.interactionPolicy).toBeDefined();
  });
});
