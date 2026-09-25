// ── PFC-S3.9 tests: Quick-Kill triage ──

import { describe, expect, test } from 'bun:test';
import { renderQuickKill, triageQuickKill } from '../src/cft/quick-kill';
import { dispatchQuickKillTriage } from '../src/cft/tools/quick-kill-triage';

describe('triageQuickKill — heuristic', () => {
  test('strong positive signal + high evidence + low pivot cost → go', () => {
    const r = triageQuickKill({
      subject: 'cache experiment',
      evidence_confidence: 8,
      remaining_runway: 7,
      pivot_cost: 2,
      current_signal: 'positive',
    });
    expect(r.decision).toBe('go');
    expect(r.score).toBeGreaterThan(3);
  });

  test('strong negative signal → kill', () => {
    const r = triageQuickKill({
      subject: 'x',
      evidence_confidence: 8,
      remaining_runway: 5,
      pivot_cost: 3,
      current_signal: 'negative',
    });
    expect(r.decision).toBe('kill');
    expect(r.score).toBeLessThan(-3);
  });

  test('neutral mid → hold', () => {
    const r = triageQuickKill({
      subject: 'x',
      evidence_confidence: 5,
      remaining_runway: 5,
      pivot_cost: 3,
      current_signal: 'neutral',
    });
    expect(r.decision).toBe('hold');
    expect(Math.abs(r.score)).toBeLessThan(3);
  });

  test('low runway amplifies pivot_cost penalty', () => {
    const highRunway = triageQuickKill({
      subject: 'x', evidence_confidence: 5, remaining_runway: 9, pivot_cost: 8, current_signal: 'positive',
    });
    const lowRunway = triageQuickKill({
      subject: 'x', evidence_confidence: 5, remaining_runway: 1, pivot_cost: 8, current_signal: 'positive',
    });
    expect(lowRunway.score).toBeLessThan(highRunway.score);
  });

  test('signal/score disagree → confidence halved', () => {
    // Positive signal but high pivot cost + low runway pulls score negative
    const r = triageQuickKill({
      subject: 'x',
      evidence_confidence: 3,
      remaining_runway: 1,
      pivot_cost: 10,
      current_signal: 'positive',
    });
    expect(r.score).toBeLessThan(0);   // disagreement
    expect(r.confidence).toBeLessThanOrEqual(0.5);
  });

  test('low confidence emits human-review notice', () => {
    const r = triageQuickKill({
      subject: 'x',
      evidence_confidence: 2,
      remaining_runway: 5,
      pivot_cost: 4,
      current_signal: 'neutral',
    });
    expect(r.confidence).toBeLessThan(0.5);
    expect(r.notices?.some((n) => n.includes('human review'))).toBe(true);
  });

  test('kill with ample runway emits double-check notice', () => {
    const r = triageQuickKill({
      subject: 'x',
      evidence_confidence: 8,
      remaining_runway: 9,
      pivot_cost: 1,
      current_signal: 'negative',
    });
    expect(r.decision).toBe('kill');
    expect(r.notices?.some((n) => n.includes('ample runway'))).toBe(true);
  });

  test('go with low evidence emits more-data notice', () => {
    const r = triageQuickKill({
      subject: 'x',
      evidence_confidence: 4,
      remaining_runway: 9,
      pivot_cost: 0,
      current_signal: 'positive',
    });
    expect(r.decision).toBe('go');
    expect(r.notices?.some((n) => n.includes('more data'))).toBe(true);
  });

  test('rationale shows math', () => {
    const r = triageQuickKill({
      subject: 'x',
      evidence_confidence: 7,
      remaining_runway: 8,
      pivot_cost: 3,
      current_signal: 'positive',
    });
    expect(r.rationale).toContain('signal=positive');
    expect(r.rationale).toContain('score=');
  });

  test('next_step differs per decision', () => {
    const go = triageQuickKill({
      subject: 'x', evidence_confidence: 9, remaining_runway: 9, pivot_cost: 1, current_signal: 'positive',
    });
    const kill = triageQuickKill({
      subject: 'x', evidence_confidence: 9, remaining_runway: 2, pivot_cost: 9, current_signal: 'negative',
    });
    const hold = triageQuickKill({
      subject: 'x', evidence_confidence: 4, remaining_runway: 5, pivot_cost: 3, current_signal: 'neutral',
    });
    expect(go.next_step).toContain('Continue');
    expect(kill.next_step).toContain('Stop');
    expect(hold.next_step).toContain('Pause');
  });

  test('out-of-range factor throws RangeError', () => {
    expect(() =>
      triageQuickKill({ subject: 'x', evidence_confidence: 11, remaining_runway: 5, pivot_cost: 3, current_signal: 'neutral' }),
    ).toThrow(RangeError);
    expect(() =>
      triageQuickKill({ subject: 'x', evidence_confidence: -1, remaining_runway: 5, pivot_cost: 3, current_signal: 'neutral' }),
    ).toThrow(RangeError);
  });

  test('invalid signal throws', () => {
    expect(() =>
      triageQuickKill({ subject: 'x', evidence_confidence: 5, remaining_runway: 5, pivot_cost: 3, current_signal: 'great' as any }),
    ).toThrow(/invalid current_signal/);
  });

  test('empty subject throws', () => {
    expect(() =>
      triageQuickKill({ subject: '', evidence_confidence: 5, remaining_runway: 5, pivot_cost: 3, current_signal: 'neutral' }),
    ).toThrow(/subject/);
  });

  test('render shows decision uppercase + rationale', () => {
    const r = triageQuickKill({
      subject: 'test', evidence_confidence: 9, remaining_runway: 9, pivot_cost: 1, current_signal: 'positive',
    });
    const out = renderQuickKill(r);
    expect(out).toContain('GO');
    expect(out).toContain('score=');
    expect(out).toContain('next_step');
  });
});

describe('dispatchQuickKillTriage', () => {
  test('returns report + output', async () => {
    const r = await dispatchQuickKillTriage({
      subject: 'new feature rollout',
      evidence_confidence: 8,
      remaining_runway: 9,
      pivot_cost: 2,
      current_signal: 'positive',
    });
    expect(r.report.decision).toBe('go');
    expect(r.output).toContain('GO');
  });
});
