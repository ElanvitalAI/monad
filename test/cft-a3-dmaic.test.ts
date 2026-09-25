// ── PFC-S3.7 tests: A3 renderer + DMAIC phase checker ──

import { describe, expect, test } from 'bun:test';
import { renderA3 } from '../src/cft/a3';
import {
  DMAIC_PHASES,
  DMAIC_REQUIRED,
  renderDmaicPhase,
  runDmaicPhase,
} from '../src/cft/dmaic';
import { dispatchWriteA3 } from '../src/cft/tools/write-a3';
import { dispatchRunDMAIC } from '../src/cft/tools/run-dmaic';

describe('renderA3', () => {
  test('minimum required fields produces markdown', () => {
    const r = renderA3({
      title: 'Login latency',
      problem: 'p99 latency > 2s',
      owner: 'platform-team',
      countermeasures: ['add query index'],
    });
    expect(r.title).toBe('Login latency');
    expect(r.owner).toBe('platform-team');
    expect(r.markdown).toContain('# Login latency');
    expect(r.markdown).toContain('## Problem');
    expect(r.markdown).toContain('p99 latency > 2s');
    expect(r.markdown).toContain('- add query index');
    expect(r.frontmatter.kind).toBe('a3');
    expect(r.frontmatter.problem).toBe('p99 latency > 2s');
  });

  test('unfilled sections become _TBD_', () => {
    const r = renderA3({
      title: 't',
      problem: 'p',
      owner: 'o',
      countermeasures: ['c'],
    });
    expect(r.markdown).toContain('_TBD_');
    expect(r.placeholderCount).toBeGreaterThanOrEqual(3);
    expect(r.notices?.[0]).toContain('unfilled');
  });

  test('complete A3 has no placeholder notice', () => {
    const r = renderA3({
      title: 't',
      problem: 'p',
      background: 'we had N complaints',
      current: 'p99=2.1s',
      goal: 'p99 < 500ms',
      analysis: 'see 5-why',
      countermeasures: ['index', 'cache'],
      plan: 'sprint 23 · owner platform',
      followup: 'verify with SPC after 1 week',
      owner: 'platform',
    });
    expect(r.placeholderCount).toBe(0);
    expect(r.notices).toBeUndefined();
  });

  test('empty countermeasures throws', () => {
    expect(() => renderA3({ title: 't', problem: 'p', owner: 'o', countermeasures: [] })).toThrow(/countermeasure/);
  });

  test('all-whitespace countermeasures throws', () => {
    expect(() =>
      renderA3({ title: 't', problem: 'p', owner: 'o', countermeasures: ['  ', '   '] }),
    ).toThrow(/empty/);
  });

  test('missing title/problem/owner throws', () => {
    expect(() => renderA3({ title: '', problem: 'p', owner: 'o', countermeasures: ['c'] })).toThrow(/title/);
    expect(() => renderA3({ title: 't', problem: '', owner: 'o', countermeasures: ['c'] })).toThrow(/problem/);
    expect(() => renderA3({ title: 't', problem: 'p', owner: '', countermeasures: ['c'] })).toThrow(/owner/);
  });

  test('countermeasure joined into frontmatter', () => {
    const r = renderA3({
      title: 't',
      problem: 'p',
      owner: 'o',
      countermeasures: ['a', 'b'],
    });
    expect(r.frontmatter.countermeasure).toBe('a; b');
  });
});

describe('runDmaicPhase', () => {
  test('define phase with full activities → 100%', () => {
    const r = runDmaicPhase({
      problem: 'login slow',
      phase: 'define',
      activities: [
        'define the problem: p99 > 2s',
        'set goal: p99 < 500ms',
        'scope: auth + dashboard routes',
        'stakeholders: platform, SRE, product',
      ],
    });
    expect(r.progressPct).toBe(100);
    expect(r.completed).toHaveLength(4);
    expect(r.pending).toHaveLength(0);
    expect(r.nextPhase).toBe('measure');
    expect(r.notices?.some((n) => n.includes('measure'))).toBe(true);
  });

  test('partial activities emits pending notice', () => {
    const r = runDmaicPhase({
      problem: 'x',
      phase: 'define',
      activities: ['problem: foo', 'goal: bar'],
    });
    expect(r.progressPct).toBe(50);
    expect(r.pending).toContain('scope');
    expect(r.pending).toContain('stakeholders');
    expect(r.notices?.[0]).toContain('pending');
  });

  test('control phase has no next', () => {
    const r = runDmaicPhase({
      problem: 'x',
      phase: 'control',
      activities: ['monitor via SPC', 'standardize via runbook', 'handoff to SRE'],
    });
    expect(r.progressPct).toBe(100);
    expect(r.nextPhase).toBeNull();
    expect(r.notices?.some((n) => n.includes('WriteA3'))).toBe(true);
  });

  test('invalid phase throws', () => {
    expect(() => runDmaicPhase({ problem: 'x', phase: 'nope' as any })).toThrow(/invalid phase/);
  });

  test('empty problem throws', () => {
    expect(() => runDmaicPhase({ problem: '', phase: 'define' })).toThrow(/problem/);
  });

  test('fuzzy match is case-insensitive + substring', () => {
    const r = runDmaicPhase({
      problem: 'x',
      phase: 'measure',
      activities: ['set BASELINE to 2.1s', 'metric = p99', 'DATA SOURCE: prometheus'],
    });
    expect(r.progressPct).toBe(100);
  });

  test('DMAIC_PHASES has 5 entries', () => {
    expect(DMAIC_PHASES).toHaveLength(5);
    expect(DMAIC_PHASES[0]).toBe('define');
    expect(DMAIC_PHASES[4]).toBe('control');
  });

  test('render shows checklist marks', () => {
    const r = runDmaicPhase({
      problem: 'x',
      phase: 'define',
      activities: ['problem: foo'],
    });
    const out = renderDmaicPhase(r);
    expect(out).toContain('[x]');
    expect(out).toContain('[ ]');
    expect(out).toContain('DMAIC');
    expect(out).toContain('next phase');
  });
});

describe('WriteA3 / RunDMAIC LLM tool dispatch', () => {
  test('dispatchWriteA3 returns markdown + frontmatter', async () => {
    const r = await dispatchWriteA3({
      title: 't',
      problem: 'p99 slow',
      owner: 'platform',
      countermeasures: ['index'],
    });
    expect(r.markdown).toContain('# t');
    expect(r.frontmatter.kind).toBe('a3');
    expect(r.placeholderCount).toBeGreaterThanOrEqual(3);
    expect(r.output).toContain('WriteA3');
  });

  test('dispatchWriteA3 with rel_path returns wrote=false signal', async () => {
    const r = await dispatchWriteA3({
      title: 't',
      problem: 'p',
      owner: 'o',
      countermeasures: ['c'],
      rel_path: 'A3/test.md',
    });
    expect(r.rel_path).toBe('A3/test.md');
    expect(r.wrote).toBe(false);
  });

  test('dispatchRunDMAIC returns checklist', async () => {
    const r = await dispatchRunDMAIC({
      problem: 'x',
      phase: 'analyze',
      activities: ['identified root cause from 5-why', 'hypothesis: cache TTL'],
    });
    expect(r.report.progressPct).toBe(100);
    expect(r.report.nextPhase).toBe('improve');
  });
});
