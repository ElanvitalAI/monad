// ── PFC-S3.10 tests: Escalation Ladder 4-tier routing ──

import { describe, expect, test } from 'bun:test';
import {
  escalateLadder,
  renderEscalateLadder,
  SEVERITY_INITIAL_TIER,
  TIER_RECIPIENTS,
  TIER_SLA_MINUTES,
} from '../src/cft/escalation-ladder';
import { dispatchEscalateLadder } from '../src/cft/tools/escalate-ladder';

describe('constants', () => {
  test('TIER_RECIPIENTS maps 1-4', () => {
    expect(TIER_RECIPIENTS[1]).toBe('peer');
    expect(TIER_RECIPIENTS[2]).toBe('lead');
    expect(TIER_RECIPIENTS[3]).toBe('manager');
    expect(TIER_RECIPIENTS[4]).toBe('director');
  });

  test('TIER_SLA_MINUTES ascending', () => {
    expect(TIER_SLA_MINUTES[1]).toBe(15);
    expect(TIER_SLA_MINUTES[2]).toBe(60);
    expect(TIER_SLA_MINUTES[3]).toBe(240);
    expect(TIER_SLA_MINUTES[4]).toBe(1440);
  });

  test('SEVERITY_INITIAL_TIER mapping', () => {
    expect(SEVERITY_INITIAL_TIER.LOW).toBe(1);
    expect(SEVERITY_INITIAL_TIER.MED).toBe(1);
    expect(SEVERITY_INITIAL_TIER.HIGH).toBe(2);
    expect(SEVERITY_INITIAL_TIER.CRITICAL).toBe(3);
  });
});

describe('escalateLadder — first notification', () => {
  test('LOW severity → tier 1, should_escalate=false', () => {
    const r = escalateLadder({
      incident_id: 'INC-1',
      severity: 'LOW',
      minutes_since_start: 0,
    });
    expect(r.next_tier).toBe(1);
    expect(r.recipient_role).toBe('peer');
    expect(r.should_escalate).toBe(false);
    expect(r.notices?.[0]).toContain('LOW severity');
  });

  test('MED severity → tier 1, should_escalate=true', () => {
    const r = escalateLadder({
      incident_id: 'INC-2',
      severity: 'MED',
      minutes_since_start: 0,
    });
    expect(r.next_tier).toBe(1);
    expect(r.should_escalate).toBe(true);
  });

  test('HIGH severity → tier 2', () => {
    const r = escalateLadder({
      incident_id: 'INC-3',
      severity: 'HIGH',
      minutes_since_start: 0,
    });
    expect(r.next_tier).toBe(2);
    expect(r.recipient_role).toBe('lead');
    expect(r.should_escalate).toBe(true);
  });

  test('CRITICAL severity → tier 3', () => {
    const r = escalateLadder({
      incident_id: 'INC-4',
      severity: 'CRITICAL',
      minutes_since_start: 0,
    });
    expect(r.next_tier).toBe(3);
    expect(r.recipient_role).toBe('manager');
    expect(r.should_escalate).toBe(true);
  });
});

describe('escalateLadder — SLA breach advancement', () => {
  test('tier 1 + 15m elapsed → advance to tier 2', () => {
    const r = escalateLadder({
      incident_id: 'INC-1',
      severity: 'MED',
      minutes_since_start: 15,
      current_tier: 1,
    });
    expect(r.next_tier).toBe(2);
    expect(r.should_escalate).toBe(true);
    expect(r.rationale).toContain('SLA breach');
  });

  test('tier 2 + 59m elapsed → stay at tier 2', () => {
    const r = escalateLadder({
      incident_id: 'INC-1',
      severity: 'HIGH',
      minutes_since_start: 59,
      current_tier: 2,
    });
    expect(r.next_tier).toBe(2);
    expect(r.should_escalate).toBe(false);
    expect(r.rationale).toContain('within tier');
  });

  test('tier 3 + 240m → advance to tier 4', () => {
    const r = escalateLadder({
      incident_id: 'INC-1',
      severity: 'HIGH',
      minutes_since_start: 240,
      current_tier: 3,
    });
    expect(r.next_tier).toBe(4);
    expect(r.recipient_role).toBe('director');
  });

  test('tier 4 + 1440m elapsed → stay but notice external escalation', () => {
    const r = escalateLadder({
      incident_id: 'INC-1',
      severity: 'HIGH',
      minutes_since_start: 1440,
      current_tier: 4,
    });
    expect(r.next_tier).toBe(4);
    expect(r.notices?.some((n) => n.includes('external'))).toBe(true);
  });
});

describe('escalateLadder — CRITICAL lock', () => {
  test('CRITICAL never deescalates below tier 3', () => {
    const r = escalateLadder({
      incident_id: 'INC-1',
      severity: 'CRITICAL',
      minutes_since_start: 5,
      current_tier: 1,
    });
    expect(r.next_tier).toBe(3);
    expect(r.notices?.some((n) => n.includes('cannot deescalate'))).toBe(true);
  });
});

describe('escalateLadder — validation', () => {
  test('missing incident_id throws', () => {
    expect(() =>
      escalateLadder({ incident_id: '', severity: 'LOW', minutes_since_start: 0 }),
    ).toThrow(/incident_id/);
  });

  test('invalid severity throws', () => {
    expect(() =>
      escalateLadder({ incident_id: 'x', severity: 'URGENT' as any, minutes_since_start: 0 }),
    ).toThrow(/invalid severity/);
  });

  test('negative elapsed throws', () => {
    expect(() =>
      escalateLadder({ incident_id: 'x', severity: 'LOW', minutes_since_start: -1 }),
    ).toThrow(/non-negative/);
  });

  test('invalid current_tier throws', () => {
    expect(() =>
      escalateLadder({ incident_id: 'x', severity: 'LOW', minutes_since_start: 0, current_tier: 5 as any }),
    ).toThrow(/invalid current_tier/);
  });

  test('render shows tier + rationale', () => {
    const r = escalateLadder({
      incident_id: 'INC-99',
      severity: 'HIGH',
      minutes_since_start: 0,
    });
    const out = renderEscalateLadder(r);
    expect(out).toContain('INC-99');
    expect(out).toContain('HIGH');
    expect(out).toContain('lead');
    expect(out).toContain('rationale');
  });
});

describe('dispatchEscalateLadder', () => {
  test('returns report + output', async () => {
    const r = await dispatchEscalateLadder({
      incident_id: 'INC-X',
      severity: 'MED',
      minutes_since_start: 20,
      current_tier: 1,
    });
    expect(r.report.next_tier).toBe(2);
    expect(r.output).toContain('INC-X');
  });
});
