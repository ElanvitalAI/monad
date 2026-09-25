import { describe, expect, test } from 'bun:test';

import { createTerminalMouseIntentRuntime } from '../src/dashboard/terminal-mouse-intent-runtime.js';
import { describeTerminalPosture, interactiveTerminalExposure } from '../src/dashboard/terminal-exposure.js';

const interactivePosture = describeTerminalPosture(interactiveTerminalExposure());

describe('terminal mouse intent runtime', () => {
  test('mirrors discrete click and capture events when debug is enabled', () => {
    const seen: Array<unknown> = [];
    const runtime = createTerminalMouseIntentRuntime({
      isDebugEnabled: () => true,
      isKeyTraceEnabled: () => false,
      logDebug: (category, event, data) => { seen.push({ category, event, data }); },
    });

    runtime.onDisplayEvent({
      type: 'terminal:mouse-intent',
      surfaceId: 'pane:1',
      paneKind: 'terminal',
      mouseType: 'double-click',
      row: 4,
      col: 8,
      transport: 'host-only',
      ...interactivePosture,
    });
    runtime.onDisplayEvent({
      type: 'terminal:mouse-intent',
      surfaceId: 'pane:1',
      paneKind: 'terminal',
      mouseType: 'drag',
      row: 5,
      col: 9,
      transport: 'pty-forward',
      ...interactivePosture,
    });

    // PR-2 — runtime now also dispatches to consumer chain. With no
    // consumers registered, an `intent.unhandled` log follows each
    // mirror. Filter to the original mirror category to keep this
    // test focused on PR #1333's mirror semantics.
    const mirrors = (seen as Array<{ category: string; event: string; data: unknown }>)
      .filter((e) => e.category === 'terminal.mouse-intent');
    expect(mirrors).toEqual([
      {
        category: 'terminal.mouse-intent',
        event: 'double-click',
        data: {
          surfaceId: 'pane:1',
          paneKind: 'terminal',
          hostInterpretation: 'word-select',
          row: 4,
          col: 8,
          transport: 'host-only',
          userExposure: 'user-interactive',
          keyboardParticipation: 'full',
          mouseTransport: 'full',
        },
      },
      {
        category: 'terminal.mouse-intent',
        event: 'drag',
        data: {
          surfaceId: 'pane:1',
          paneKind: 'terminal',
          hostInterpretation: 'range-select-update',
          row: 5,
          col: 9,
          transport: 'pty-forward',
          userExposure: 'user-interactive',
          keyboardParticipation: 'full',
          mouseTransport: 'full',
        },
      },
    ]);
  });

  test('suppresses motion unless keytrace is enabled', () => {
    const seen: Array<string> = [];
    const runtime = createTerminalMouseIntentRuntime({
      isDebugEnabled: () => true,
      isKeyTraceEnabled: () => false,
      logDebug: (_category, event) => { seen.push(event); },
    });

    runtime.onDisplayEvent({
      type: 'terminal:mouse-intent',
      surfaceId: 'pane:1',
      paneKind: 'terminal',
      mouseType: 'motion',
      row: 4,
      col: 8,
      transport: 'host-only',
      ...interactivePosture,
    });

    expect(seen).toEqual([]);
  });

  test('allows motion when keytrace is enabled', () => {
    const seen: Array<string> = [];
    const runtime = createTerminalMouseIntentRuntime({
      isDebugEnabled: () => true,
      isKeyTraceEnabled: () => true,
      logDebug: (_category, event) => { seen.push(event); },
    });

    runtime.onDisplayEvent({
      type: 'terminal:mouse-intent',
      surfaceId: 'pane:1',
      paneKind: 'terminal',
      mouseType: 'motion',
      row: 4,
      col: 8,
      transport: 'host-only',
      ...interactivePosture,
    });

    expect(seen).toEqual(['motion']);
  });

  test('stays silent when debug is disabled', () => {
    const seen: Array<string> = [];
    const runtime = createTerminalMouseIntentRuntime({
      isDebugEnabled: () => false,
      isKeyTraceEnabled: () => true,
      logDebug: (_category, event) => { seen.push(event); },
    });

    runtime.onDisplayEvent({
      type: 'terminal:mouse-intent',
      surfaceId: 'pane:1',
      paneKind: 'terminal',
      mouseType: 'click',
      row: 1,
      col: 2,
      transport: 'pty-forward',
      ...interactivePosture,
    });

    expect(seen).toEqual([]);
  });
});

// PR-2 of multi-platform substrate ROADMAP.
describe('terminal mouse intent runtime · consumer chain (PR-2)', () => {
  test('registered consumer receives semantic intent (kind + capability)', () => {
    const calls: Array<{ kind: string; canRead: boolean }> = [];
    const runtime = createTerminalMouseIntentRuntime({
      isDebugEnabled: () => false,
      isKeyTraceEnabled: () => false,
      logDebug: () => {},
    });
    runtime.registerConsumer({
      id: 'test-consumer',
      handle(intent) {
        calls.push({ kind: intent.kind, canRead: intent.capability.canRead });
        return { handled: true };
      },
    });

    runtime.onDisplayEvent({
      type: 'terminal:mouse-intent',
      surfaceId: 'pane:1',
      paneKind: 'terminal',
      mouseType: 'click',
      row: 1,
      col: 2,
      transport: 'pty-forward',
      ...interactivePosture,
    });

    expect(calls).toEqual([{ kind: 'caret-focus', canRead: true }]);
  });

  test('motion event does not enter consumer chain (G3)', () => {
    const calls: string[] = [];
    const runtime = createTerminalMouseIntentRuntime({
      isDebugEnabled: () => true,
      isKeyTraceEnabled: () => true,
      logDebug: () => {},
    });
    runtime.registerConsumer({
      id: 'spy',
      handle(intent) { calls.push(intent.kind); return { handled: true }; },
    });

    runtime.onDisplayEvent({
      type: 'terminal:mouse-intent',
      surfaceId: 'pane:1',
      paneKind: 'terminal',
      mouseType: 'motion',
      row: 1,
      col: 2,
      transport: 'host-only',
      ...interactivePosture,
    });

    expect(calls).toEqual([]); // motion → null intent → consumer skipped
  });

  test('chain stops at first handled=true (priority order)', () => {
    const order: string[] = [];
    const runtime = createTerminalMouseIntentRuntime({
      isDebugEnabled: () => false,
      isKeyTraceEnabled: () => false,
      logDebug: () => {},
    });
    runtime.registerConsumer({
      id: 'c-late',
      priority: 100,
      handle() { order.push('late'); return { handled: true }; },
    });
    runtime.registerConsumer({
      id: 'c-early',
      priority: 50,
      handle() { order.push('early'); return { handled: true }; },
    });

    runtime.onDisplayEvent({
      type: 'terminal:mouse-intent',
      surfaceId: 'pane:1',
      paneKind: 'terminal',
      mouseType: 'click',
      row: 1,
      col: 2,
      transport: 'pty-forward',
      ...interactivePosture,
    });

    expect(order).toEqual(['early']);
  });

  test('handled=false passes to next consumer with reason logged', () => {
    const order: string[] = [];
    const seenLogs: Array<{ category: string; event: string }> = [];
    const runtime = createTerminalMouseIntentRuntime({
      isDebugEnabled: () => true,
      isKeyTraceEnabled: () => false,
      logDebug: (category, event) => { seenLogs.push({ category, event }); },
    });
    runtime.registerConsumer({
      id: 'c-reject',
      priority: 50,
      handle() { order.push('reject'); return { handled: false, reason: 'not-mine' }; },
    });
    runtime.registerConsumer({
      id: 'c-accept',
      priority: 60,
      handle() { order.push('accept'); return { handled: true }; },
    });

    runtime.onDisplayEvent({
      type: 'terminal:mouse-intent',
      surfaceId: 'pane:1',
      paneKind: 'terminal',
      mouseType: 'click',
      row: 1,
      col: 2,
      transport: 'pty-forward',
      ...interactivePosture,
    });

    expect(order).toEqual(['reject', 'accept']);
    const gateBlocked = seenLogs.find(l => l.category === 'terminal.intent.gate-blocked');
    expect(gateBlocked?.event).toBe('c-reject');
    const consumed = seenLogs.find(l => l.category === 'terminal.intent.consumed');
    expect(consumed?.event).toBe('c-accept');
  });

  test('throwing consumer is isolated; chain continues', () => {
    const seenLogs: Array<{ category: string; event: string }> = [];
    const runtime = createTerminalMouseIntentRuntime({
      isDebugEnabled: () => true,
      isKeyTraceEnabled: () => false,
      logDebug: (category, event) => { seenLogs.push({ category, event }); },
    });
    runtime.registerConsumer({
      id: 'c-throw',
      priority: 50,
      handle() { throw new Error('boom'); },
    });
    let downstream = false;
    runtime.registerConsumer({
      id: 'c-after',
      priority: 60,
      handle() { downstream = true; return { handled: true }; },
    });

    runtime.onDisplayEvent({
      type: 'terminal:mouse-intent',
      surfaceId: 'pane:1',
      paneKind: 'terminal',
      mouseType: 'click',
      row: 1,
      col: 2,
      transport: 'pty-forward',
      ...interactivePosture,
    });

    expect(downstream).toBe(true);
    expect(seenLogs.find(l => l.category === 'terminal.intent.consumer-throw')?.event).toBe('c-throw');
  });

  test('unregister removes consumer from chain', () => {
    const calls: string[] = [];
    const runtime = createTerminalMouseIntentRuntime({
      isDebugEnabled: () => false,
      isKeyTraceEnabled: () => false,
      logDebug: () => {},
    });
    const unsub = runtime.registerConsumer({
      id: 'c-once',
      handle() { calls.push('hit'); return { handled: true }; },
    });

    runtime.onDisplayEvent({
      type: 'terminal:mouse-intent',
      surfaceId: 'pane:1',
      paneKind: 'terminal',
      mouseType: 'click',
      row: 1,
      col: 2,
      transport: 'pty-forward',
      ...interactivePosture,
    });
    unsub();
    runtime.onDisplayEvent({
      type: 'terminal:mouse-intent',
      surfaceId: 'pane:1',
      paneKind: 'terminal',
      mouseType: 'click',
      row: 1,
      col: 2,
      transport: 'pty-forward',
      ...interactivePosture,
    });

    expect(calls).toEqual(['hit']);
    expect(runtime.listConsumers()).toEqual([]);
  });

  test('recentIntents ring buffer reflects dispatched intents (G3 motion excluded)', () => {
    const runtime = createTerminalMouseIntentRuntime({
      isDebugEnabled: () => false,
      isKeyTraceEnabled: () => false,
      logDebug: () => {},
      ringSize: 3,
    });

    const emit = (mouseType: 'click' | 'motion' | 'double-click' | 'right-click') => {
      runtime.onDisplayEvent({
        type: 'terminal:mouse-intent',
        surfaceId: 'pane:r',
        paneKind: 'terminal',
        mouseType,
        row: 0,
        col: 0,
        transport: 'pty-forward',
        ...interactivePosture,
      });
    };

    emit('click');
    emit('motion');     // G3 excluded
    emit('double-click');
    emit('right-click');
    emit('click');      // ring overflows → first 'click' evicted

    const kinds = runtime.recentIntents().map(i => i.kind);
    expect(kinds).toEqual(['word-select', 'context-menu', 'caret-focus']);
  });
});
