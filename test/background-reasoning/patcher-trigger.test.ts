// W5 Y3 · trigger 3-tier OR matrix.

import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_THRESHOLDS,
  PatcherTrigger,
  type PatcherTriggerState,
} from '../../src/background-reasoning/patcher-trigger';
import type { SignalEnvelope } from '../../src/signal-bus/types';

function state(over: Partial<PatcherTriggerState> = {}): PatcherTriggerState {
  return {
    bytesAccumulated: 0,
    daysAccumulated: 0,
    skillRunsAccumulated: 0,
    userIdleMin: 0,
    systemSignals: [],
    ...over,
  };
}

function envelope(over: Partial<SignalEnvelope> = {}): SignalEnvelope {
  return {
    schema_version: 1,
    id: 'sig-1',
    source: 'test.source',
    tier: 'info',
    ts: '2026-05-12T00:00:00.000Z',
    message: 'm',
    ...over,
  };
}

describe('PatcherTrigger', () => {
  test('no fire when state empty and no signal', () => {
    const t = new PatcherTrigger();
    expect(t.evaluate(state(), []).fire).toBe(false);
  });

  test('threshold alone is not enough — idle also required', () => {
    const t = new PatcherTrigger();
    const s = state({ bytesAccumulated: DEFAULT_THRESHOLDS.bytesAccumulatedMax + 1 });
    expect(t.evaluate(s, []).fire).toBe(false);
  });

  test('idle alone is not enough — threshold also required', () => {
    const t = new PatcherTrigger();
    const s = state({ userIdleMin: 999 });
    expect(t.evaluate(s, []).fire).toBe(false);
  });

  test('threshold + idle → fire (reason=threshold-and-idle)', () => {
    const t = new PatcherTrigger();
    const s = state({
      skillRunsAccumulated: DEFAULT_THRESHOLDS.skillRunsMax + 5,
      userIdleMin: DEFAULT_THRESHOLDS.userIdleMin + 5,
    });
    const v = t.evaluate(s, []);
    expect(v.fire).toBe(true);
    expect(v.reason).toBe('threshold-and-idle');
  });

  test('system signal (sleep_started) counts as idle', () => {
    const t = new PatcherTrigger();
    const s = state({
      daysAccumulated: DEFAULT_THRESHOLDS.daysAccumulatedMax + 1,
      systemSignals: ['sleep_started'],
    });
    expect(t.evaluate(s, []).fire).toBe(true);
  });

  test('emergency tier fires immediately, bypassing threshold/idle', () => {
    const t = new PatcherTrigger();
    const v = t.evaluate(state(), [envelope({ tier: 'emergency' })]);
    expect(v.fire).toBe(true);
    expect(v.reason).toBe('emergency');
    expect(v.emergency).toBeDefined();
  });

  test('critical tier counts as emergency', () => {
    const t = new PatcherTrigger();
    expect(t.evaluate(state(), [envelope({ tier: 'critical' })]).fire).toBe(true);
  });

  test('pattern_disruption source forces emergency', () => {
    const t = new PatcherTrigger();
    const v = t.evaluate(state(), [envelope({ source: 'self.pattern_disruption', tier: 'info' })]);
    expect(v.fire).toBe(true);
    expect(v.reason).toBe('emergency');
  });

  test('custom isEmergency predicate overrides default', () => {
    const t = new PatcherTrigger({ isEmergency: (e) => e.source === 'custom.urgent' });
    expect(t.evaluate(state(), [envelope({ tier: 'critical' })]).fire).toBe(false);
    expect(t.evaluate(state(), [envelope({ source: 'custom.urgent' })]).fire).toBe(true);
  });
});
