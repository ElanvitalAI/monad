// Step 2 partial — plain dispatch settle sink unit tests.
//
// Mirrors the assertions we'd want at the chat-main-acp-dispatch.ts
// sink site (its in-place IIFE is currently inline; future Step 2
// follow-up could share this helper for both paths).

import { describe, expect, it } from 'bun:test';
import { runDashboardPlainTurnSettleSink } from '../src/dashboard/input/dashboard-plain-turn-settle-sink';
import { createControlSignalBus } from '../src/input/control-signal.js';

interface SinkSpyState {
  commitCalls: number;
  cancelCalls: number;
  notifyCalls: number;
  ordering: string[];
  notifyAt?: number;
  commitSettleAt?: number;
}

function makeSpy(opts: {
  commitImpl?: () => void | Promise<void>;
  cancelImpl?: () => void | Promise<void>;
  notifyImpl?: () => void;
} = {}) {
  const state: SinkSpyState = { commitCalls: 0, cancelCalls: 0, notifyCalls: 0, ordering: [] };
  return {
    state,
    async commit() {
      state.commitCalls += 1;
      state.ordering.push('commit');
      if (opts.commitImpl) await opts.commitImpl();
      state.commitSettleAt = Date.now();
    },
    async cancel() {
      state.cancelCalls += 1;
      state.ordering.push('cancel');
      if (opts.cancelImpl) await opts.cancelImpl();
    },
    notifyResponseDone() {
      state.notifyCalls += 1;
      state.ordering.push('notify');
      state.notifyAt = Date.now();
      if (opts.notifyImpl) opts.notifyImpl();
    },
  };
}

describe('runDashboardPlainTurnSettleSink', () => {
  it("settled='end_turn' — calls commit then notifyResponseDone (no cooldown)", async () => {
    const spy = makeSpy();
    await runDashboardPlainTurnSettleSink({
      settled: 'end_turn',
      accumulatedChars: 12,
      cooldownMs: 0,
      commit: spy.commit,
      cancel: spy.cancel,
      notifyResponseDone: spy.notifyResponseDone,
    });
    expect(spy.state.ordering).toEqual(['commit', 'notify']);
    expect(spy.state.commitCalls).toBe(1);
    expect(spy.state.cancelCalls).toBe(0);
    expect(spy.state.notifyCalls).toBe(1);
  });

  it("settled='cancelled' — calls cancel then notifyResponseDone", async () => {
    const spy = makeSpy();
    await runDashboardPlainTurnSettleSink({
      settled: 'cancelled',
      accumulatedChars: 0,
      cooldownMs: 0,
      commit: spy.commit,
      cancel: spy.cancel,
      notifyResponseDone: spy.notifyResponseDone,
    });
    expect(spy.state.ordering).toEqual(['cancel', 'notify']);
    expect(spy.state.cancelCalls).toBe(1);
    expect(spy.state.commitCalls).toBe(0);
  });

  it("settled='error' — calls cancel then notifyResponseDone", async () => {
    const spy = makeSpy();
    await runDashboardPlainTurnSettleSink({
      settled: 'error',
      accumulatedChars: 0,
      cooldownMs: 0,
      commit: spy.commit,
      cancel: spy.cancel,
      notifyResponseDone: spy.notifyResponseDone,
    });
    expect(spy.state.ordering).toEqual(['cancel', 'notify']);
    expect(spy.state.cancelCalls).toBe(1);
  });

  it('cooldownMs > 0 → notify happens after the cooldown', async () => {
    const spy = makeSpy();
    const cooldown = 50;
    const startedAt = Date.now();
    await runDashboardPlainTurnSettleSink({
      settled: 'end_turn',
      accumulatedChars: 0,
      cooldownMs: cooldown,
      commit: spy.commit,
      cancel: spy.cancel,
      notifyResponseDone: spy.notifyResponseDone,
    });
    expect(spy.state.notifyAt).toBeDefined();
    expect((spy.state.notifyAt as number) - startedAt).toBeGreaterThanOrEqual(cooldown - 5);
  });

  it('commit exception swallowed — notifyResponseDone still called', async () => {
    const spy = makeSpy({
      commitImpl: () => { throw new Error('commit boom'); },
    });
    await runDashboardPlainTurnSettleSink({
      settled: 'end_turn',
      accumulatedChars: 0,
      cooldownMs: 0,
      commit: spy.commit,
      cancel: spy.cancel,
      notifyResponseDone: spy.notifyResponseDone,
    });
    expect(spy.state.notifyCalls).toBe(1);
  });

  it('cancel exception swallowed — notifyResponseDone still called', async () => {
    const spy = makeSpy({
      cancelImpl: () => { throw new Error('cancel boom'); },
    });
    await runDashboardPlainTurnSettleSink({
      settled: 'cancelled',
      accumulatedChars: 0,
      cooldownMs: 0,
      commit: spy.commit,
      cancel: spy.cancel,
      notifyResponseDone: spy.notifyResponseDone,
    });
    expect(spy.state.notifyCalls).toBe(1);
  });

  it('notifyResponseDone exception swallowed — no rethrow', async () => {
    const spy = makeSpy({
      notifyImpl: () => { throw new Error('notify boom'); },
    });
    // Should not reject
    await runDashboardPlainTurnSettleSink({
      settled: 'end_turn',
      accumulatedChars: 0,
      cooldownMs: 0,
      commit: spy.commit,
      cancel: spy.cancel,
      notifyResponseDone: spy.notifyResponseDone,
    });
    expect(spy.state.notifyCalls).toBe(1);
  });

  it('cooldown sleep happens even when commit throws', async () => {
    const spy = makeSpy({
      commitImpl: () => { throw new Error('commit boom'); },
    });
    const cooldown = 30;
    const startedAt = Date.now();
    await runDashboardPlainTurnSettleSink({
      settled: 'end_turn',
      accumulatedChars: 0,
      cooldownMs: cooldown,
      commit: spy.commit,
      cancel: spy.cancel,
      notifyResponseDone: spy.notifyResponseDone,
    });
    expect((spy.state.notifyAt as number) - startedAt).toBeGreaterThanOrEqual(cooldown - 5);
  });

  it('recent quick-pass downgrades end_turn to cancel before commit', async () => {
    const spy = makeSpy();
    const bus = createControlSignalBus(() => new Date().toISOString());
    bus.emit({
      kind: 'voice-chat-stop',
      urgency: 'quick-pass',
      source: 'sensor',
      mayPreempt: true,
      scope: { surface: 'voice-chat', channel: 'dashboard' },
    });
    await runDashboardPlainTurnSettleSink({
      settled: 'end_turn',
      accumulatedChars: 0,
      cooldownMs: 0,
      commit: spy.commit,
      cancel: spy.cancel,
      notifyResponseDone: spy.notifyResponseDone,
      preSettleQuickPass: {
        signalBus: bus,
        scope: { surface: 'voice-chat', channel: 'dashboard' },
        signalKinds: ['voice-chat-stop'],
      },
    });
    expect(spy.state.ordering).toEqual(['cancel', 'notify']);
    expect(spy.state.cancelCalls).toBe(1);
    expect(spy.state.commitCalls).toBe(0);
  });
});
