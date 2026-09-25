// ── PFC-S3.8 tests: PDCA cycle phase checker ──

import { describe, expect, test } from 'bun:test';
import {
  PDCA_PHASES,
  PDCA_REQUIRED,
  renderPdcaPhase,
  runPdcaPhase,
} from '../src/cft/pdca';
import { dispatchRunPDCA } from '../src/cft/tools/run-pdca';

describe('PDCA_PHASES + PDCA_REQUIRED', () => {
  test('4 phases in canonical order', () => {
    expect(PDCA_PHASES).toEqual(['plan', 'do', 'check', 'act']);
  });

  test('required activities per phase', () => {
    expect(PDCA_REQUIRED.plan).toContain('hypothesis');
    expect(PDCA_REQUIRED.do).toContain('owner');
    expect(PDCA_REQUIRED.check).toContain('result');
    expect(PDCA_REQUIRED.act).toContain('decision');
  });
});

describe('runPdcaPhase', () => {
  test('plan phase with full activities → 100% → next=do', () => {
    const r = runPdcaPhase({
      subject: 'reduce p99 latency',
      phase: 'plan',
      activities: [
        'hypothesis: caching reduces p99 by 40%',
        'metric: p99 latency (ms) tracked hourly',
        'duration: 1 week pilot',
      ],
    });
    expect(r.progressPct).toBe(100);
    expect(r.nextPhase).toBe('do');
    expect(r.cycleComplete).toBe(false);
  });

  test('partial activities emits pending notice', () => {
    const r = runPdcaPhase({
      subject: 'x',
      phase: 'plan',
      activities: ['hypothesis: foo'],
    });
    expect(r.progressPct).toBe(33);
    expect(r.pending).toContain('metric');
    expect(r.pending).toContain('duration');
    expect(r.notices?.[0]).toContain('pending');
  });

  test('act phase + decision=standardize → cycle complete', () => {
    const r = runPdcaPhase({
      subject: 'x',
      phase: 'act',
      activities: ['decision: adopt the change', 'next cycle: focus on auth'],
      decision: 'standardize',
    });
    expect(r.cycleComplete).toBe(true);
    expect(r.nextPhase).toBeNull();
    expect(r.decision).toBe('standardize');
    expect(r.notices?.some((n) => n.includes('cycle complete'))).toBe(true);
  });

  test('act phase complete but no decision → notice', () => {
    const r = runPdcaPhase({
      subject: 'x',
      phase: 'act',
      activities: ['decision: pick something', 'next cycle: tbd'],
    });
    expect(r.progressPct).toBe(100);
    expect(r.cycleComplete).toBe(false);
    expect(r.notices?.some((n) => n.includes('no decision'))).toBe(true);
  });

  test('decision in non-act phase → ignored notice', () => {
    const r = runPdcaPhase({
      subject: 'x',
      phase: 'plan',
      activities: ['hypothesis: h', 'metric: m', 'duration: d'],
      decision: 'standardize' as any,
    });
    expect(r.decision).toBeUndefined();
    expect(r.notices?.some((n) => n.includes("only honoured in 'act'"))).toBe(true);
  });

  test('act phase without decision → nextPhase wraps to plan', () => {
    const r = runPdcaPhase({
      subject: 'x',
      phase: 'act',
      activities: ['decision: foo', 'next cycle: bar'],
    });
    expect(r.nextPhase).toBe('plan');
    expect(r.cycleComplete).toBe(false);
  });

  test('fuzzy match case-insensitive', () => {
    const r = runPdcaPhase({
      subject: 'x',
      phase: 'plan',
      activities: ['HYPOTHESIS: cache works', 'METRIC = p99', 'DURATION 5 days'],
    });
    expect(r.progressPct).toBe(100);
  });

  test('invalid phase throws', () => {
    expect(() => runPdcaPhase({ subject: 'x', phase: 'nope' as any })).toThrow(/invalid phase/);
  });

  test('empty subject throws', () => {
    expect(() => runPdcaPhase({ subject: '', phase: 'plan' })).toThrow(/subject/);
  });

  test('render shows phase checklist', () => {
    const r = runPdcaPhase({
      subject: 'sub',
      phase: 'plan',
      activities: ['hypothesis: h'],
    });
    const out = renderPdcaPhase(r);
    expect(out).toContain('PDCA');
    expect(out).toContain('PLAN');
    expect(out).toContain('[x]');
    expect(out).toContain('[ ]');
  });

  test('render shows cycle complete with decision', () => {
    const r = runPdcaPhase({
      subject: 'sub',
      phase: 'act',
      activities: ['decision: keep it', 'next cycle: next sprint'],
      decision: 'standardize',
    });
    const out = renderPdcaPhase(r);
    expect(out).toContain('cycle complete');
    expect(out).toContain('standardize');
  });
});

describe('dispatchRunPDCA', () => {
  test('returns report + output', async () => {
    const r = await dispatchRunPDCA({
      subject: 'cache experiment',
      phase: 'check',
      activities: ['result: p99 down 35%', 'vs hypothesis: within 5% of 40% target'],
    });
    expect(r.report.progressPct).toBe(100);
    expect(r.report.nextPhase).toBe('act');
    expect(r.output).toContain('CHECK');
  });

  test('emits ready-to-archive signal on cycle complete', async () => {
    const r = await dispatchRunPDCA({
      subject: 'x',
      phase: 'act',
      activities: ['decision: adopt', 'next cycle: extend to prod'],
      decision: 'adjust',
    });
    expect(r.report.cycleComplete).toBe(true);
    expect(r.notices?.some((n) => n.includes('WriteA3'))).toBe(true);
  });
});
