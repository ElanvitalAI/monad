// W6 Y4 · trigger matrix.

import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_THINKER_THRESHOLDS,
  ThinkerTrigger,
  type ThinkerTriggerState,
} from '../../src/background-reasoning/thinker-trigger';
import type { SignalEnvelope } from '../../src/signal-bus/types';

function state(over: Partial<ThinkerTriggerState> = {}): ThinkerTriggerState {
  return {
    kgsNewCardsSinceLast: 0,
    kgsNewEntitiesSinceLast: 0,
    daysSinceLast: 0,
    lastFiredAt: 1_000_000,
    ...over,
  };
}

function env(over: Partial<SignalEnvelope> = {}): SignalEnvelope {
  return {
    schema_version: 1,
    id: 's',
    source: 'test',
    tier: 'info',
    ts: '2026-05-12T00:00:00.000Z',
    message: '',
    ...over,
  };
}

describe('ThinkerTrigger', () => {
  test('emergency overrides all gates', () => {
    const t = new ThinkerTrigger({ now: () => 1_000_001 });
    const v = t.evaluate(state(), [env({ tier: 'emergency' })]);
    expect(v.fire).toBe(true);
    expect(v.reason).toBe('emergency');
  });

  test('kgs threshold fires (cards)', () => {
    const t = new ThinkerTrigger({ now: () => 1_000_001 });
    const v = t.evaluate(state({ kgsNewCardsSinceLast: DEFAULT_THINKER_THRESHOLDS.kgsNewCardsMax }), []);
    expect(v.fire).toBe(true);
    expect(v.reason).toBe('kgs-threshold');
  });

  test('kgs threshold fires (days)', () => {
    const t = new ThinkerTrigger({ now: () => 1_000_001 });
    const v = t.evaluate(state({ daysSinceLast: DEFAULT_THINKER_THRESHOLDS.daysSinceLastMax + 1 }), []);
    expect(v.fire).toBe(true);
    expect(v.reason).toBe('kgs-threshold');
  });

  test('hourly scheduled fires when interval elapsed', () => {
    const t = new ThinkerTrigger({ now: () => 1_000_000 + 2 * 60 * 60 * 1000 });
    const v = t.evaluate(state({ lastFiredAt: 1_000_000 }), []);
    expect(v.fire).toBe(true);
    expect(v.reason).toBe('scheduled-hourly');
  });

  test('does not fire when nothing met', () => {
    const t = new ThinkerTrigger({ now: () => 1_000_001 });
    expect(t.evaluate(state(), []).fire).toBe(false);
  });

  test('explicit-request fires below threshold', () => {
    const t = new ThinkerTrigger({ now: () => 1_000_001 });
    const v = t.evaluate(state(), [env({ source: 'user.explicit.thinker' })]);
    expect(v.fire).toBe(true);
    expect(v.reason).toBe('explicit-request');
  });

  test('routine-disrupt fires below threshold', () => {
    const t = new ThinkerTrigger({ now: () => 1_000_001 });
    const v = t.evaluate(state(), [env({ source: 'self.pattern_disruption' })]);
    expect(v.fire).toBe(true);
    expect(v.reason).toBe('routine-disrupt');
  });
});
