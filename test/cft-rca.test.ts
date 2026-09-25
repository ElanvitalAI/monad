// ── PFC-S3.6 tests: 5-Why + Fishbone + Pareto ──

import { describe, expect, test } from 'bun:test';
import {
  buildFishbone,
  buildWhyChain,
  computePareto,
  FISHBONE_CATEGORIES,
  renderFishbone,
  renderPareto,
  renderWhyChain,
} from '../src/cft/rca';
import { dispatchRootCauseAnalyze } from '../src/cft/tools/root-cause-analyze';
import { dispatchIshikawaAnalyze } from '../src/cft/tools/ishikawa-analyze';
import { dispatchParetoAnalyze } from '../src/cft/tools/pareto-analyze';

describe('buildWhyChain (5-Why)', () => {
  test('canonical 5-depth chain', () => {
    const c = buildWhyChain('production down', [
      'service crashed',
      'OOM killed',
      'memory leak in handler',
      'unbounded cache',
      'no eviction policy',
    ]);
    expect(c.depth).toBe(5);
    expect(c.rootCause).toBe('no eviction policy');
    expect(c.notices).toBeUndefined();
  });

  test('depth < 5 emits notice', () => {
    const c = buildWhyChain('x', ['a', 'b', 'c']);
    expect(c.depth).toBe(3);
    expect(c.notices?.[0]).toContain('canonical depth');
  });

  test('depth > 8 throws', () => {
    expect(() =>
      buildWhyChain('x', ['1', '2', '3', '4', '5', '6', '7', '8', '9']),
    ).toThrow(/at most 8/);
  });

  test('depth < 3 throws', () => {
    expect(() => buildWhyChain('x', ['a', 'b'])).toThrow(/at least 3/);
  });

  test('empty why entry throws', () => {
    expect(() => buildWhyChain('x', ['a', '  ', 'c'])).toThrow(/empty/);
  });

  test('missing problem throws', () => {
    expect(() => buildWhyChain('', ['a', 'b', 'c'])).toThrow(/problem/);
  });

  test('render shows chain + root', () => {
    const c = buildWhyChain('prod down', ['crashed', 'oom', 'leak', 'cache', 'policy']);
    const out = renderWhyChain(c);
    expect(out).toContain('Problem: prod down');
    expect(out).toContain('Why1?');
    expect(out).toContain('Why5?');
    expect(out).toContain('Root cause: policy');
  });
});

describe('buildFishbone (Ishikawa 6M)', () => {
  test('6M categories recognized', () => {
    expect(FISHBONE_CATEGORIES).toHaveLength(6);
    expect(FISHBONE_CATEGORIES).toContain('manpower');
    expect(FISHBONE_CATEGORIES).toContain('measurement');
  });

  test('totalCauses + dominantCategory', () => {
    const r = buildFishbone('slow API', {
      manpower: ['dev on-call tired'],
      method: ['no caching', 'N+1 queries', 'no index'],
      measurement: ['no metrics'],
    });
    expect(r.totalCauses).toBe(5);
    expect(r.dominantCategory).toBe('method');
    expect(r.emptyCategories.length).toBe(3);
    expect(r.notices?.[0]).toContain('empty');
  });

  test('no causes total throws', () => {
    expect(() => buildFishbone('x', {})).toThrow(/at least one cause/);
  });

  test('empty string causes filtered', () => {
    const r = buildFishbone('x', { method: ['valid', '', '  '] });
    expect(r.categories.method).toHaveLength(1);
  });

  test('render includes 6M grouping', () => {
    const r = buildFishbone('slow', {
      manpower: ['tired'],
      method: ['bad algo'],
    });
    const out = renderFishbone(r);
    expect(out).toContain('Fishbone');
    expect(out).toContain('manpower');
    expect(out).toContain('method');
    expect(out).toContain('(empty:');
  });
});

describe('computePareto', () => {
  test('80/20 band identification', () => {
    const r = computePareto('errors', [
      { label: 'timeout', count: 50 },
      { label: 'auth', count: 30 },
      { label: 'validation', count: 15 },
      { label: 'other', count: 5 },
    ]);
    expect(r.total).toBe(100);
    expect(r.ranked[0].label).toBe('timeout');
    expect(r.ranked[0].cumPct).toBeCloseTo(0.5, 2);
    expect(r.ranked[1].cumPct).toBeCloseTo(0.8, 2);
    expect(r.topN).toBe(2);
    expect(r.tailN).toBe(2);
  });

  test('desc sort by count', () => {
    const r = computePareto('x', [
      { label: 'a', count: 10 },
      { label: 'b', count: 100 },
      { label: 'c', count: 50 },
    ]);
    expect(r.ranked.map((i) => i.label)).toEqual(['b', 'c', 'a']);
  });

  test('flat distribution → topN == total (no Pareto effect)', () => {
    const r = computePareto('x', [
      { label: 'a', count: 10 },
      { label: 'b', count: 10 },
      { label: 'c', count: 10 },
    ]);
    expect(r.topN).toBe(3);
  });

  test('threshold configurable', () => {
    const r = computePareto(
      'x',
      [
        { label: 'a', count: 40 },
        { label: 'b', count: 30 },
        { label: 'c', count: 20 },
        { label: 'd', count: 10 },
      ],
      0.5,
    );
    expect(r.topN).toBe(2);
  });

  test('zero count items ok as long as total > 0', () => {
    const r = computePareto('x', [
      { label: 'real', count: 10 },
      { label: 'zero', count: 0 },
    ]);
    expect(r.total).toBe(10);
    expect(r.ranked[1].pct).toBe(0);
  });

  test('negative count rejected', () => {
    expect(() => computePareto('x', [{ label: 'a', count: -1 }])).toThrow(/non-negative/);
  });

  test('empty items rejected', () => {
    expect(() => computePareto('x', [])).toThrow(/non-empty/);
  });

  test('threshold out of range rejected', () => {
    expect(() => computePareto('x', [{ label: 'a', count: 1 }], 0)).toThrow(RangeError);
    expect(() => computePareto('x', [{ label: 'a', count: 1 }], 1)).toThrow(RangeError);
  });

  test('render shows rank table', () => {
    const r = computePareto('test', [{ label: 'a', count: 80 }, { label: 'b', count: 20 }]);
    const out = renderPareto(r);
    expect(out).toContain('test');
    expect(out).toContain('rank');
    expect(out).toContain('YES');
  });
});

describe('RCA trio LLM tool dispatch', () => {
  test('RootCauseAnalyze returns chain', async () => {
    const r = await dispatchRootCauseAnalyze({
      problem: 'deploy failed',
      whys: ['image pull error', 'registry unreachable', 'dns broken', 'coredns crashed', 'oomkilled'],
    });
    expect(r.chain.depth).toBe(5);
    expect(r.chain.rootCause).toBe('oomkilled');
    expect(r.output).toContain('Root cause');
  });

  test('IshikawaAnalyze returns 6M report', async () => {
    const r = await dispatchIshikawaAnalyze({
      problem: 'flaky test',
      categories: {
        method: ['relies on wall clock'],
        measurement: ['no retry count logged'],
      },
    });
    expect(r.report.totalCauses).toBe(2);
    expect(r.report.emptyCategories).toContain('manpower');
  });

  test('ParetoAnalyze emits concentration notice', async () => {
    const r = await dispatchParetoAnalyze({
      title: 'errors',
      items: [
        { label: 'main', count: 95 },
        { label: 'misc', count: 5 },
      ],
    });
    expect(r.report.topN).toBe(1);
    expect(r.notices?.[0]).toContain('Extreme concentration');
  });
});
