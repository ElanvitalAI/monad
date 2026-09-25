// ── PFC-S3.4 P1 tests: FMEA core + RunFMEA tool ──

import { describe, expect, test } from 'bun:test';
import {
  buildReport,
  classifyRisk,
  computeRpn,
  rankRows,
  renderTopTable,
  type FMEARow,
} from '../src/cft/fmea';
import { dispatchRunFMEA } from '../src/cft/tools/run-fmea';

describe('computeRpn', () => {
  test('multiplies three factors', () => {
    expect(computeRpn({ severity: 5, occurrence: 4, detection: 3 })).toBe(60);
  });

  test('min all 1 = RPN 1', () => {
    expect(computeRpn({ severity: 1, occurrence: 1, detection: 1 })).toBe(1);
  });

  test('max all 10 = RPN 1000', () => {
    expect(computeRpn({ severity: 10, occurrence: 10, detection: 10 })).toBe(1000);
  });

  test('non-integer factor throws', () => {
    expect(() => computeRpn({ severity: 5.5 as any, occurrence: 4, detection: 3 })).toThrow(/integer/);
  });

  test('out-of-range factor throws RangeError', () => {
    expect(() => computeRpn({ severity: 0, occurrence: 4, detection: 3 })).toThrow(RangeError);
    expect(() => computeRpn({ severity: 11, occurrence: 4, detection: 3 })).toThrow(RangeError);
  });
});

describe('classifyRisk', () => {
  test('tier boundaries', () => {
    expect(classifyRisk(1)).toBe('low');
    expect(classifyRisk(49)).toBe('low');
    expect(classifyRisk(50)).toBe('medium');
    expect(classifyRisk(124)).toBe('medium');
    expect(classifyRisk(125)).toBe('high');
    expect(classifyRisk(299)).toBe('high');
    expect(classifyRisk(300)).toBe('critical');
    expect(classifyRisk(1000)).toBe('critical');
  });

  test('zero or negative RPN throws', () => {
    expect(() => classifyRisk(0)).toThrow(RangeError);
    expect(() => classifyRisk(-1)).toThrow(RangeError);
  });
});

describe('rankRows — stable desc sort', () => {
  test('sorts by RPN descending', () => {
    const rows: FMEARow[] = [
      { mode: 'a', effect: 'x', cause: 'y', severity: 2, occurrence: 2, detection: 2 }, // RPN 8
      { mode: 'b', effect: 'x', cause: 'y', severity: 5, occurrence: 5, detection: 5 }, // RPN 125
      { mode: 'c', effect: 'x', cause: 'y', severity: 3, occurrence: 3, detection: 3 }, // RPN 27
    ];
    const r = rankRows(rows);
    expect(r.map((x) => x.mode)).toEqual(['b', 'c', 'a']);
    expect(r[0].rpn).toBe(125);
    expect(r[0].risk).toBe('high');
  });

  test('tie preserves input order (stable)', () => {
    const rows: FMEARow[] = [
      { mode: 'first', effect: 'x', cause: 'y', severity: 2, occurrence: 3, detection: 5 }, // 30
      { mode: 'second', effect: 'x', cause: 'y', severity: 5, occurrence: 3, detection: 2 }, // 30
      { mode: 'third', effect: 'x', cause: 'y', severity: 3, occurrence: 2, detection: 5 },  // 30
    ];
    const r = rankRows(rows);
    expect(r.map((x) => x.mode)).toEqual(['first', 'second', 'third']);
  });
});

describe('buildReport', () => {
  test('summary counts risk tiers correctly', () => {
    const rows: FMEARow[] = [
      { mode: 'crit', effect: 'x', cause: 'y', severity: 10, occurrence: 10, detection: 5 }, // 500 critical
      { mode: 'high', effect: 'x', cause: 'y', severity: 5, occurrence: 5, detection: 6 },   // 150 high
      { mode: 'med', effect: 'x', cause: 'y', severity: 4, occurrence: 4, detection: 4 },    // 64 medium
      { mode: 'low', effect: 'x', cause: 'y', severity: 2, occurrence: 2, detection: 2 },    // 8 low
    ];
    const report = buildReport('test-system', rows, 2);
    expect(report.summary.total_items).toBe(4);
    expect(report.summary.critical_count).toBe(1);
    expect(report.summary.high_count).toBe(1);
    expect(report.summary.medium_count).toBe(1);
    expect(report.summary.low_count).toBe(1);
    expect(report.summary.max_rpn).toBe(500);
    expect(report.top).toHaveLength(2);
    expect(report.top[0].mode).toBe('crit');
  });

  test('empty rows throws', () => {
    expect(() => buildReport('x', [])).toThrow(/at least one row/);
  });

  test('missing system throws', () => {
    expect(() => buildReport('', [{ mode: 'a', effect: 'x', cause: 'y', severity: 1, occurrence: 1, detection: 1 }])).toThrow(/system/);
  });
});

describe('renderTopTable', () => {
  test('includes system name and summary counts', () => {
    const rows: FMEARow[] = [
      { mode: 'test-mode', effect: 'x', cause: 'y', severity: 10, occurrence: 10, detection: 10 },
    ];
    const out = renderTopTable(buildReport('my-system', rows));
    expect(out).toContain('my-system');
    expect(out).toContain('1000');
    expect(out).toContain('critical');
  });
});

describe('dispatchRunFMEA — LLM tool', () => {
  test('returns report + output', async () => {
    const r = await dispatchRunFMEA({
      system: 'slack-handler',
      items: [
        { mode: 'duplicate', effect: 'confusion', cause: 'no idempotency', severity: 7, occurrence: 6, detection: 4 },
        { mode: 'timeout', effect: 'retry storm', cause: 'slow API', severity: 4, occurrence: 3, detection: 2 },
      ],
    });
    expect(r.report.system).toBe('slack-handler');
    expect(r.report.ranked).toHaveLength(2);
    expect(r.report.top).toHaveLength(2);
    expect(r.output).toContain('duplicate');
  });

  test('notices on critical items', async () => {
    const r = await dispatchRunFMEA({
      system: 'x',
      items: [
        { mode: 'm', effect: 'e', cause: 'c', severity: 10, occurrence: 10, detection: 10 },
      ],
    });
    expect(r.notices).toBeDefined();
    expect(r.notices?.[0]).toContain('critical');
  });

  test('rejects empty items', async () => {
    await expect(
      dispatchRunFMEA({ system: 'x', items: [] as any }),
    ).rejects.toThrow(/non-empty/);
  });

  test('rejects missing system', async () => {
    await expect(
      dispatchRunFMEA({ system: '', items: [{ mode: 'a', effect: 'b', cause: 'c', severity: 1, occurrence: 1, detection: 1 }] }),
    ).rejects.toThrow(/system/);
  });
});
