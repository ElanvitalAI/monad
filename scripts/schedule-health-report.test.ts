import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formatHealthReport, type StandaloneSinkCoverage } from '../src/domains/schedule-health-report.js';
import type { ScheduleHealth } from '../src/domains/schedule-registry.js';
import { measureStandaloneSinkCoverage, renderScheduleHealthReport } from './schedule-health-report.js';

const clean: ScheduleHealth = {
  elanousTotal: 3, excludedRunVia: 0, excludedUnwrappedCrontab: 0, excludedDisabled: 0, excludedMissingCron: 0,
  errored: [], stale: [], noncanonical: [], unmeasured: [], generatedAt: '2026-09-24T00:00:00Z',
};

describe('measureStandaloneSinkCoverage', () => {
  test('a.ts 는 닿고 b.ts 는 sinkLoss, c.sh 는 unmeasurable', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sink-coverage-'));
    try {
      await writeFile(join(dir, 'a.ts'), 'import { registerStandaloneLogSink } from "../src/domains/standalone-log-sink.js";\nawait registerStandaloneLogSink("a");\n');
      await writeFile(join(dir, 'b.ts'), 'console.log("no sink");\n');
      await writeFile(join(dir, 'c.sh'), '#!/bin/sh\necho shell\n');
      const coverage = measureStandaloneSinkCoverage([
        { name: 'a', command: `cd ${dir} && bun scripts/cron-run.ts ${join(dir, 'a.ts')}` },
        { name: 'b', command: `bun ${join(dir, 'b.ts')}` },
        { name: 'c', command: `bash ${join(dir, 'c.sh')}` },
      ], { repo: dir });
      expect(coverage.sinkLoss.map((t) => t.name)).toEqual(['b']);
      expect(coverage.unmeasurable.map((t) => t.name)).toEqual(['c']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('대상 파일이 없으면 unmeasurable — 잃는 것으로 접지 않는다', () => {
    const coverage = measureStandaloneSinkCoverage([
      { name: 'gone', command: 'bun scripts/missing-job.ts' },
    ], {
      repo: '/tmp/schedule-health-absent',
      readFile: () => null,
    });
    expect(coverage.sinkLoss).toEqual([]);
    expect(coverage.unmeasurable.map((t) => t.name)).toEqual(['gone']);
  });
});

describe('renderScheduleHealthReport', () => {
  test('잰 StandaloneSinkCoverage 를 formatHealthReport 의 sinkCoverage 로 그대로 넘긴다', () => {
    const measured: StandaloneSinkCoverage = {
      sinkLoss: [{ name: 'b' }],
      unmeasurable: [{ name: 'c' }],
    };
    const viaReport = renderScheduleHealthReport(clean, {
      mode: 'digest',
      nowLabel: '09-24 08:00',
      sinkCoverage: measured,
    });
    const viaFormatter = formatHealthReport(clean, {
      mode: 'digest',
      nowLabel: '09-24 08:00',
      sinkCoverage: measured,
    });
    expect(viaReport).toBe(viaFormatter);
    expect(viaReport).toContain('b');
    expect(viaReport).toContain('c');
    expect(viaReport).toContain('싱크 유실 1');
    expect(viaReport).not.toContain(' · a');
  });

  test('sinkLoss 가 있으면 digest 본문에 관측을 잃는 잡 이름 줄이 있다', () => {
    const msg = renderScheduleHealthReport(clean, {
      mode: 'digest',
      nowLabel: '09-24 08:00',
      sinkCoverage: { sinkLoss: [{ name: 'b' }], unmeasurable: [] },
    })!;
    expect(msg).toContain('관측을 잃는');
    expect(msg.split('\n').some((line) => line.includes('관측을 잃는') && line.includes('b'))).toBe(true);
  });
});
