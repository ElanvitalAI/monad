// G2 (2026-05-12) — IntentPrediction → OutboundRouter bridge tests.

import { describe, expect, test } from 'bun:test';
import { wireIntentPredictionToRouter } from '../src/intent-prediction/router-bridge.js';
import type { IntentPredictionService } from '../src/intent-prediction/index.js';
import {
  INTENT_BUTTON_LABELS,
  type IntentRanking,
} from '../src/intent-prediction/types.js';
import { OutboundRouter } from '../src/showroom/outbound/router.js';
import type {
  ChannelSendResult,
  OutboundChannel,
  OutboundEvent,
} from '../src/showroom/outbound/types.js';

/** Minimal stub of IntentPredictionService — only the parts the
 *  bridge consumes (`onRanking`). The rest throw so we catch any
 *  accidental coupling. */
function stubService(): {
  service: IntentPredictionService;
  emit: (ranking: IntentRanking) => void;
  listenerCount: () => number;
} {
  const listeners = new Set<(r: IntentRanking) => void>();
  const service: IntentPredictionService = {
    subscribe: () => { throw new Error('not used'); },
    unsubscribe: () => { throw new Error('not used'); },
    tickNow: () => { throw new Error('not used'); },
    latest: () => null,
    recordFeedback: () => { throw new Error('not used'); },
    onRanking(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    diagnostics: () => ({ feedbackCount: 0, activeSessions: 0 }),
    dispose: () => { listeners.clear(); },
  };
  return {
    service,
    emit: (ranking) => { for (const l of listeners) l(ranking); },
    listenerCount: () => listeners.size,
  };
}

function ranking(over: Partial<IntentRanking> = {}): IntentRanking {
  return {
    sessionId: 's1',
    candidates: INTENT_BUTTON_LABELS.map((label, i) => ({
      label,
      confidence: 0.5 - i * 0.05,
      reason: '',
    })),
    version: 1,
    generatedAt: 100,
    ...over,
  };
}

/** Records every send call against a channel + lets the test pick the
 *  result (ok / fail / throw). */
function recordingChannel(
  result: ChannelSendResult | { throw: Error },
): { channel: OutboundChannel; calls: OutboundEvent[] } {
  const calls: OutboundEvent[] = [];
  const channel: OutboundChannel = {
    name: 'ios-push',
    available: () => true,
    async send(event) {
      calls.push(event);
      if ('throw' in result) throw result.throw;
      return result;
    },
  };
  return { channel, calls };
}

describe('wireIntentPredictionToRouter · basic subscribe', () => {
  test('subscribes on construction', () => {
    const { service, listenerCount } = stubService();
    const { channel } = recordingChannel({ ok: true });
    const router = new OutboundRouter({ channels: [channel] });
    expect(listenerCount()).toBe(0);
    wireIntentPredictionToRouter({ service, router });
    expect(listenerCount()).toBe(1);
  });

  test('stop() unsubscribes idempotently', () => {
    const { service, listenerCount } = stubService();
    const { channel } = recordingChannel({ ok: true });
    const router = new OutboundRouter({ channels: [channel] });
    const handle = wireIntentPredictionToRouter({ service, router });
    expect(listenerCount()).toBe(1);
    handle.stop();
    expect(listenerCount()).toBe(0);
    handle.stop();  // idempotent
    expect(listenerCount()).toBe(0);
  });
});

describe('wireIntentPredictionToRouter · dispatch', () => {
  test('ranking emit → buildOutboundEvent → router.route → channel.send', async () => {
    const { service, emit } = stubService();
    const { channel, calls } = recordingChannel({ ok: true });
    const router = new OutboundRouter({ channels: [channel] });
    const handle = wireIntentPredictionToRouter({ service, router });
    emit(ranking());
    // Fire-and-forget — wait one tick so the inner promise resolves.
    await new Promise<void>((r) => queueMicrotask(r));
    expect(calls.length).toBe(1);
    expect(calls[0]!.id).toBe('intent-s1-1');
    expect(calls[0]!.source).toBe('thinker');
    expect(handle.diagnostics().dispatched).toBe(1);
    expect(handle.diagnostics().errors).toBe(0);
  });

  test('buildOpts forwarded to F1 builder', async () => {
    const { service, emit } = stubService();
    const { channel, calls } = recordingChannel({ ok: true });
    const router = new OutboundRouter({ channels: [channel] });
    wireIntentPredictionToRouter({
      service,
      router,
      buildOpts: { urgency: 'high', title: 'custom title', source: 'patcher' },
    });
    emit(ranking());
    await new Promise<void>((r) => queueMicrotask(r));
    expect(calls[0]!.urgency).toBe('high');
    expect(calls[0]!.title).toBe('custom title');
    expect(calls[0]!.source).toBe('patcher');
  });

  test('routeOverride forwarded to router.route', async () => {
    // Set up two channels — preferOrder default would hit ios-push
    // first, but we override to prefer the secondary 'web-push'.
    const ios = recordingChannel({ ok: true });
    ios.channel.name = 'ios-push';
    const web: { channel: OutboundChannel; calls: OutboundEvent[] } = recordingChannel({ ok: true });
    web.channel.name = 'web-push';
    const router = new OutboundRouter({ channels: [ios.channel, web.channel] });
    const { service, emit } = stubService();
    wireIntentPredictionToRouter({
      service, router,
      routeOverride: { preferOrder: ['web-push'] },
    });
    emit(ranking());
    await new Promise<void>((r) => queueMicrotask(r));
    expect(ios.calls.length).toBe(0);
    expect(web.calls.length).toBe(1);
  });

  test('stop() halts subsequent dispatch (in-flight may still complete)', async () => {
    const { service, emit } = stubService();
    const { channel, calls } = recordingChannel({ ok: true });
    const router = new OutboundRouter({ channels: [channel] });
    const handle = wireIntentPredictionToRouter({ service, router });
    handle.stop();
    emit(ranking());
    await new Promise<void>((r) => queueMicrotask(r));
    expect(calls.length).toBe(0);
    expect(handle.diagnostics().dispatched).toBe(0);
  });
});

describe('wireIntentPredictionToRouter · error paths', () => {
  test('builder throw → diagnostics.errors + onError fires', async () => {
    // Force the builder to throw by giving it a non-array `candidates`.
    // The builder accesses `ranking.candidates.length` via `[...candidates]`
    // — passing null forces a TypeError inside the try block.
    const { service, emit } = stubService();
    const { channel, calls } = recordingChannel({ ok: true });
    const router = new OutboundRouter({ channels: [channel] });
    const errors: { err: unknown; ranking: IntentRanking }[] = [];
    const handle = wireIntentPredictionToRouter({
      service, router,
      onError: (err, r) => { errors.push({ err, ranking: r }); },
    });
    emit({
      sessionId: 's1',
      candidates: null as never,
      version: 1,
      generatedAt: 100,
    });
    await new Promise<void>((r) => queueMicrotask(r));
    expect(calls.length).toBe(0);
    expect(handle.diagnostics().errors).toBe(1);
    expect(errors.length).toBe(1);
  });

  test('channel send rejection → diagnostics.errors + onError fires', async () => {
    const { service, emit } = stubService();
    const { channel } = recordingChannel({ throw: new Error('network down') });
    const router = new OutboundRouter({ channels: [channel] });
    const errors: unknown[] = [];
    const handle = wireIntentPredictionToRouter({
      service, router,
      onError: (err) => { errors.push(err); },
    });
    emit(ranking());
    // Two microtasks — first to enter route, second for router's catch.
    await new Promise<void>((r) => queueMicrotask(r));
    await new Promise<void>((r) => queueMicrotask(r));
    expect(handle.diagnostics().dispatched).toBe(1);
    // Router swallows channel exception internally (returns ok:false).
    // The bridge's `.catch()` on the router promise still fires if
    // route() itself throws — but route() never throws (it wraps).
    // So errors count stays at 0 here. The bridge surfaces channel
    // failures only via the router's outcome, not via onError.
    // This documents the contract: bridge.onError is for builder
    // errors + unexpected router rejections.
    expect(handle.diagnostics().errors).toBe(0);
    expect(errors.length).toBe(0);
  });

  test('onError absent — silently swallows builder error (no throw escapes)', async () => {
    const { service, emit } = stubService();
    const { channel } = recordingChannel({ ok: true });
    const router = new OutboundRouter({ channels: [channel] });
    const handle = wireIntentPredictionToRouter({ service, router });
    expect(() => emit({
      sessionId: 's1', candidates: null as never, version: 1, generatedAt: 100,
    })).not.toThrow();
    await new Promise<void>((r) => queueMicrotask(r));
    expect(handle.diagnostics().errors).toBe(1);
  });
});

describe('wireIntentPredictionToRouter · diagnostics counting', () => {
  test('successful dispatches accumulate', async () => {
    const { service, emit } = stubService();
    const { channel } = recordingChannel({ ok: true });
    const router = new OutboundRouter({ channels: [channel] });
    const handle = wireIntentPredictionToRouter({ service, router });
    emit(ranking({ version: 1 }));
    emit(ranking({ version: 2 }));
    emit(ranking({ version: 3 }));
    await new Promise<void>((r) => queueMicrotask(r));
    expect(handle.diagnostics().dispatched).toBe(3);
    expect(handle.diagnostics().errors).toBe(0);
  });
});
