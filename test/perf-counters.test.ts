// Perf counters are the measurement spine for the perf-recovery
// work. Every increment must no-op when the singleton is disabled —
// that's the contract with every production call site. Tests focus
// on: gate behaviour, ring buffer roll, percentile math, and report
// formatting.

import { describe, test, expect, beforeEach } from 'bun:test';
import { perf } from '../src/perf-counters';

beforeEach(() => {
  // Each test owns a clean state. disable() retains stale histograms
  // but leaves the enabled flag off; enable() clears + arms them.
  perf.disable();
});

describe('perf counters — gate', () => {
  test('all mutators no-op when disabled', () => {
    perf.markDrawStart();
    perf.markDrawEnd();
    perf.bumpDebugCall('x');
    perf.recordStdoutWrite(100, false);
    perf.recordStdoutWrite(100, true);
    const r = perf.report();
    expect(r).toContain('enabled=false');
    expect(r).toContain('(no samples)');
    expect(r).toContain('direct=0');
    expect(r).toContain('total=0');
  });

  test('enable → disable keeps final snapshot readable', () => {
    perf.enable();
    perf.bumpDebugCall('x');
    perf.disable();
    // No new bumps should land after disable.
    perf.bumpDebugCall('y');
    const r = perf.report();
    expect(r).toContain('total=1');
    expect(r).toContain('x  1');
    expect(r).not.toContain('y  1');
  });

  test('toggle flips state and returns new value', () => {
    expect(perf.toggle()).toBe(true);
    expect(perf.enabled).toBe(true);
    expect(perf.toggle()).toBe(false);
    expect(perf.enabled).toBe(false);
  });
});

describe('perf counters — draw latency', () => {
  test('captures samples and computes p50/p90/p99', async () => {
    perf.enable();
    // Force a few samples. The ring buffer uses real timestamps, so
    // we sleep in small increments between mark pairs.
    for (let i = 0; i < 5; i++) {
      perf.markDrawStart();
      // tight busy loop (~0.5ms) — real timing, not faked
      const end = performance.now() + 0.5;
      while (performance.now() < end) { /* spin */ }
      perf.markDrawEnd();
    }
    const r = perf.report();
    expect(r).toContain('n=5');
    // p50/p90/p99 should all be defined numbers
    expect(r).toMatch(/p50=\d+(\.\d+)?ms/);
    expect(r).toMatch(/p90=\d+(\.\d+)?ms/);
    expect(r).toMatch(/p99=\d+(\.\d+)?ms/);
  });

  test('markEnd without markStart is a no-op (no NaN)', () => {
    perf.enable();
    perf.markDrawEnd(); // stray — should not crash or record
    const r = perf.report();
    expect(r).toContain('(no samples)');
  });
});

describe('perf counters — debug-call tracking', () => {
  test('top() returns categories sorted by count', () => {
    perf.enable();
    for (let i = 0; i < 10; i++) perf.bumpDebugCall('key.press');
    for (let i = 0; i < 3;  i++) perf.bumpDebugCall('agent.tool:call');
    for (let i = 0; i < 5;  i++) perf.bumpDebugCall('llm.request');
    const r = perf.report();
    // key.press should appear first (10), llm.request second (5),
    // agent.tool:call third (3).
    const keyIdx = r.indexOf('key.press  10');
    const llmIdx = r.indexOf('llm.request  5');
    const agIdx  = r.indexOf('agent.tool:call  3');
    expect(keyIdx).toBeGreaterThan(-1);
    expect(llmIdx).toBeGreaterThan(keyIdx);
    expect(agIdx).toBeGreaterThan(llmIdx);
  });
});

describe('perf counters — stdout split', () => {
  test('direct vs coordinator are tracked separately', () => {
    perf.enable();
    perf.recordStdoutWrite(10, false);
    perf.recordStdoutWrite(20, false);
    perf.recordStdoutWrite(100, true);
    const r = perf.report();
    expect(r).toContain('direct=2(30B)');
    expect(r).toContain('coordinator=1(100B)');
  });
});
