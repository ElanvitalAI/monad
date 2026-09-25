// Y2 budget-aware router · local / cloud / queue decision matrix.

import { describe, expect, test } from 'bun:test';
import {
  BudgetAwareRouter,
  type BudgetUsageProbe,
} from '../../src/background-reasoning/budget-aware-router';
import {
  DEFAULT_BACKGROUND_REASONING_CONFIG,
  type BackgroundReasoningConfig,
} from '../../src/background-reasoning/config';

function probe(usd: number): BudgetUsageProbe {
  return { monthlyCloudUsd: () => usd };
}

function cfg(over: Partial<BackgroundReasoningConfig> = {}): BackgroundReasoningConfig {
  return { ...DEFAULT_BACKGROUND_REASONING_CONFIG, ...over };
}

describe('BudgetAwareRouter', () => {
  test('local-available wins regardless of role', () => {
    const r = new BudgetAwareRouter({ config: cfg(), probe: probe(0) });
    expect(r.route({ role: 'patcher', localAvailable: true }).decision).toBe('local');
    expect(r.route({ role: 'thinker', localAvailable: true }).decision).toBe('local');
  });

  test('patcher cloud disabled by default → queue', () => {
    const r = new BudgetAwareRouter({ config: cfg(), probe: probe(0) });
    expect(r.route({ role: 'patcher', localAvailable: false }).decision).toBe('queue');
  });

  test('thinker cloud allowed by default → cloud', () => {
    const r = new BudgetAwareRouter({ config: cfg(), probe: probe(0) });
    const out = r.route({ role: 'thinker', localAvailable: false });
    expect(out.decision).toBe('cloud');
    expect(out.warn).toBeUndefined();
  });

  test('warn flag when usage crosses warn threshold', () => {
    const r = new BudgetAwareRouter({ config: cfg(), probe: probe(25) });
    const out = r.route({ role: 'thinker', localAvailable: false });
    expect(out.decision).toBe('cloud');
    expect(out.warn).toBe(true);
  });

  test('budget exhausted → queue', () => {
    const r = new BudgetAwareRouter({ config: cfg({ monthlyCloudMaxUsd: 10 }), probe: probe(10) });
    expect(r.route({ role: 'thinker', localAvailable: false }).decision).toBe('queue');
  });

  test('emergency bypasses exhausted budget', () => {
    const r = new BudgetAwareRouter({ config: cfg({ monthlyCloudMaxUsd: 10 }), probe: probe(20) });
    const out = r.route({ role: 'patcher', localAvailable: false, emergency: true });
    expect(out.decision).toBe('cloud');
    expect(out.reason).toMatch(/emergency-bypass/);
  });

  test('emergency_cloud_always=false suppresses bypass', () => {
    const r = new BudgetAwareRouter({
      config: cfg({ monthlyCloudMaxUsd: 10, emergencyCloudAlways: false }),
      probe: probe(20),
    });
    expect(r.route({ role: 'patcher', localAvailable: false, emergency: true }).decision).toBe('queue');
  });

  test('zero cap + emergency → cloud', () => {
    const r = new BudgetAwareRouter({ config: cfg({ monthlyCloudMaxUsd: 0 }), probe: probe(0) });
    expect(r.route({ role: 'thinker', localAvailable: false, emergency: true }).decision).toBe('cloud');
  });
});
