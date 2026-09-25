// R5 follow-up — session-decision → ACP forward subscriber contract.

import { describe, expect, test } from 'bun:test';

import { NexusEventBus } from '../src/nexus/api/event-bus.js';
import {
  startSessionDecisionForward,
  defaultDecisionPromptText,
  FORWARDABLE_DECISIONS,
} from '../src/nexus/api/session-decision-forward.js';
import type { NotificationActionLoopback } from '../src/web-push/notification-action-loopback.js';
import type { SessionDecision } from '../src/nexus/api/sessions-decision.js';

function makeFakeLoopback() {
  const calls: Array<{ sessionId: string; promptText: string }> = [];
  const loopback: NotificationActionLoopback = {
    run: async (input) => { calls.push(input); },
  };
  return { loopback, calls };
}

function publishDecision(bus: NexusEventBus, sessionId: string, decision: SessionDecision): void {
  bus.publish({
    ts: Date.now(),
    kind: 'session-decision',
    detail: { sessionId, decision },
  });
}

describe('defaultDecisionPromptText', () => {
  test('approve → forward prompt', () => {
    expect(defaultDecisionPromptText('approve')).toContain('승인');
  });
  test('expand → forward prompt', () => {
    expect(defaultDecisionPromptText('expand')).toContain('펼치기');
  });
  test('reject → null (no forward)', () => {
    expect(defaultDecisionPromptText('reject')).toBeNull();
  });
  test('pause → null (no forward)', () => {
    expect(defaultDecisionPromptText('pause')).toBeNull();
  });
  test('FORWARDABLE_DECISIONS lists exactly approve + expand', () => {
    expect([...FORWARDABLE_DECISIONS].sort()).toEqual(['approve', 'expand']);
  });
});

describe('startSessionDecisionForward · subscriber', () => {
  test('approve fires loopback with the canonical prompt + sessionId', async () => {
    const bus = new NexusEventBus();
    const { loopback, calls } = makeFakeLoopback();
    const handle = startSessionDecisionForward({ bus, loopback });
    publishDecision(bus, 'sess-1', 'approve');
    // run() is async but not awaited — give the microtask queue a
    // chance to drain.
    await Promise.resolve();
    expect(calls.length).toBe(1);
    expect(calls[0]!.sessionId).toBe('sess-1');
    expect(calls[0]!.promptText).toContain('승인');
    expect(handle.forwardCount()).toBe(1);
    handle.stop();
  });

  test('expand fires loopback with the expand prompt', async () => {
    const bus = new NexusEventBus();
    const { loopback, calls } = makeFakeLoopback();
    const handle = startSessionDecisionForward({ bus, loopback });
    publishDecision(bus, 'sess-2', 'expand');
    await Promise.resolve();
    expect(calls.length).toBe(1);
    expect(calls[0]!.promptText).toContain('펼치기');
    handle.stop();
  });

  test('reject does NOT fire loopback', async () => {
    const bus = new NexusEventBus();
    const { loopback, calls } = makeFakeLoopback();
    const handle = startSessionDecisionForward({ bus, loopback });
    publishDecision(bus, 'sess-3', 'reject');
    await Promise.resolve();
    expect(calls.length).toBe(0);
    expect(handle.forwardCount()).toBe(0);
    handle.stop();
  });

  test('pause does NOT fire loopback', async () => {
    const bus = new NexusEventBus();
    const { loopback, calls } = makeFakeLoopback();
    const handle = startSessionDecisionForward({ bus, loopback });
    publishDecision(bus, 'sess-4', 'pause');
    await Promise.resolve();
    expect(calls.length).toBe(0);
    handle.stop();
  });

  test('non session-decision events are ignored', async () => {
    const bus = new NexusEventBus();
    const { loopback, calls } = makeFakeLoopback();
    const handle = startSessionDecisionForward({ bus, loopback });
    bus.publish({
      ts: Date.now(),
      kind: 'intent-prediction.ranking',
      detail: { whatever: true },
    });
    await Promise.resolve();
    expect(calls.length).toBe(0);
    handle.stop();
  });

  test('missing sessionId in detail → no forward (defensive)', async () => {
    const bus = new NexusEventBus();
    const { loopback, calls } = makeFakeLoopback();
    const handle = startSessionDecisionForward({ bus, loopback });
    bus.publish({
      ts: Date.now(),
      kind: 'session-decision',
      detail: { decision: 'approve' },
    });
    await Promise.resolve();
    expect(calls.length).toBe(0);
    handle.stop();
  });

  test('stop() unsubscribes — further events do not fire loopback', async () => {
    const bus = new NexusEventBus();
    const { loopback, calls } = makeFakeLoopback();
    const handle = startSessionDecisionForward({ bus, loopback });
    publishDecision(bus, 'sess-5', 'approve');
    await Promise.resolve();
    expect(calls.length).toBe(1);
    handle.stop();
    publishDecision(bus, 'sess-5', 'approve');
    await Promise.resolve();
    expect(calls.length).toBe(1); // unchanged
  });

  test('stop() is idempotent', async () => {
    const bus = new NexusEventBus();
    const { loopback } = makeFakeLoopback();
    const handle = startSessionDecisionForward({ bus, loopback });
    handle.stop();
    handle.stop();
    expect(handle.forwardCount()).toBe(0);
  });

  test('custom promptFor overrides the default mapping', async () => {
    const bus = new NexusEventBus();
    const { loopback, calls } = makeFakeLoopback();
    const handle = startSessionDecisionForward({
      bus,
      loopback,
      promptFor: (d) => d === 'reject' ? 'custom reject prompt' : null,
    });
    publishDecision(bus, 'sess-6', 'reject');
    await Promise.resolve();
    expect(calls.length).toBe(1);
    expect(calls[0]!.promptText).toBe('custom reject prompt');
    // approve no longer forwards under the custom mapping.
    publishDecision(bus, 'sess-7', 'approve');
    await Promise.resolve();
    expect(calls.length).toBe(1);
    handle.stop();
  });
});
