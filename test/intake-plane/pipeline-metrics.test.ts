// I10 (2026-05-12) — Phase 1 dogfood metrics writer + reader.

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  aggregatePipelineRuns,
  intakeDir,
  listPipelineRuns,
  parsePipelineRunLine,
  pipelineRunsPath,
  recordPipelineRun,
  RUNS_FILE,
  type PipelineRunRecord,
} from '../../src/intake-plane/pipeline-metrics.ts';

const SAMPLE: PipelineRunRecord = {
  at: '2026-05-12T10:00:00.000Z',
  intakeId: 'sample-1',
  kind: 'preview',
  useRealLlm: false,
  useRealEnrich: false,
  refined: false,
  durationMs: 42,
  decomposition: { fallback: true, missionCount: 1, taskCount: 1 },
  enrichment: { diagnosticOnly: 0, withSummary: 0 },
  categorize: { fallback: true, workflowEligible: 0, total: 1 },
  align: {
    fallback: false,
    priorities: { high: 0, medium: 0, low: 1 },
    dependencyCount: 0,
  },
  synth: { ok: 0, skeleton: 0, failed: 0, skipped: 1 },
};

describe('intake-plane/pipeline-metrics · path resolution', () => {
  test('intakeDir honours ELANOUS_INTAKE_DIR env', () => {
    const prev = process.env.ELANOUS_INTAKE_DIR;
    process.env.ELANOUS_INTAKE_DIR = '/tmp/xyz-fake';
    try {
      expect(intakeDir()).toBe('/tmp/xyz-fake');
      expect(pipelineRunsPath()).toBe(`/tmp/xyz-fake/${RUNS_FILE}`);
    } finally {
      if (prev === undefined) delete process.env.ELANOUS_INTAKE_DIR;
      else process.env.ELANOUS_INTAKE_DIR = prev;
    }
  });
});

describe('parsePipelineRunLine', () => {
  test('valid line → record', () => {
    const line = JSON.stringify(SAMPLE);
    expect(parsePipelineRunLine(line)).toEqual(SAMPLE);
  });

  test('empty / whitespace → null', () => {
    expect(parsePipelineRunLine('')).toBeNull();
    expect(parsePipelineRunLine('   ')).toBeNull();
  });

  test('malformed JSON → null', () => {
    expect(parsePipelineRunLine('not json')).toBeNull();
  });

  test('missing required fields → null', () => {
    expect(parsePipelineRunLine(JSON.stringify({ at: '...' }))).toBeNull();
    expect(parsePipelineRunLine(JSON.stringify({ intakeId: '...' }))).toBeNull();
  });

  test('unknown kind → null', () => {
    const bad = { ...SAMPLE, kind: 'garbage' as unknown };
    expect(parsePipelineRunLine(JSON.stringify(bad))).toBeNull();
  });
});

describe('aggregatePipelineRuns', () => {
  test('empty list → zero aggregates', () => {
    const a = aggregatePipelineRuns([]);
    expect(a.total).toBe(0);
    expect(a.avgDurationMs).toBe(0);
    expect(a.fallbackRate.decompose).toBe(0);
  });

  test('rolls up fallback rates + averages + kind split', () => {
    const rows: PipelineRunRecord[] = [
      { ...SAMPLE, intakeId: 'a', durationMs: 100 },
      {
        ...SAMPLE,
        intakeId: 'b',
        kind: 'commit',
        durationMs: 200,
        useRealLlm: true,
        useRealEnrich: true,
        refined: true,
        decomposition: { fallback: false, missionCount: 2, taskCount: 3 },
        categorize: { fallback: false, workflowEligible: 2, total: 3 },
        align: { ...SAMPLE.align, fallback: false },
      },
      {
        ...SAMPLE,
        intakeId: 'c',
        useRealLlm: true,
        durationMs: 300,
        decomposition: { fallback: false, missionCount: 1, taskCount: 1 },
      },
    ];
    const a = aggregatePipelineRuns(rows);
    expect(a.total).toBe(3);
    // 1/3 fallback on decompose · 2/3 fallback on categorize.
    expect(a.fallbackRate.decompose).toBeCloseTo(1 / 3);
    expect(a.fallbackRate.categorize).toBeCloseTo(2 / 3);
    expect(a.realLlmRate).toBeCloseTo(2 / 3);
    expect(a.realEnrichRate).toBeCloseTo(1 / 3);
    expect(a.refineRate).toBeCloseTo(1 / 3);
    expect(a.avgDurationMs).toBe(200);
    expect(a.byKind).toEqual({ preview: 2, commit: 1 });
  });
});

describe('recordPipelineRun + listPipelineRuns (disk roundtrip)', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'i10-metrics-'));
  });
  afterEach(() => {
    try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  test('writes one JSONL line per recordPipelineRun call', () => {
    recordPipelineRun(SAMPLE, { resolveDir: () => tmp });
    recordPipelineRun({ ...SAMPLE, intakeId: 'sample-2' }, { resolveDir: () => tmp });
    const file = readFileSync(join(tmp, RUNS_FILE), 'utf8');
    const lines = file.trim().split('\n');
    expect(lines.length).toBe(2);
    const first = JSON.parse(lines[0]!) as PipelineRunRecord;
    const second = JSON.parse(lines[1]!) as PipelineRunRecord;
    expect(first.intakeId).toBe('sample-1');
    expect(second.intakeId).toBe('sample-2');
  });

  test('listPipelineRuns returns most-recent-first + aggregates over all rows', () => {
    recordPipelineRun(SAMPLE, { resolveDir: () => tmp });
    recordPipelineRun({ ...SAMPLE, intakeId: 'sample-2', useRealLlm: true }, { resolveDir: () => tmp });
    recordPipelineRun({ ...SAMPLE, intakeId: 'sample-3', kind: 'commit' }, { resolveDir: () => tmp });
    const res = listPipelineRuns(10, { resolveDir: () => tmp });
    expect(res.total).toBe(3);
    expect(res.rows.length).toBe(3);
    // Most recent first.
    expect(res.rows[0]!.intakeId).toBe('sample-3');
    expect(res.rows[2]!.intakeId).toBe('sample-1');
    // Aggregates pick up every row.
    expect(res.aggregates.realLlmRate).toBeCloseTo(1 / 3);
    expect(res.aggregates.byKind.commit).toBe(1);
  });

  test('limit caps the returned rows', () => {
    for (let i = 0; i < 5; i += 1) {
      recordPipelineRun({ ...SAMPLE, intakeId: `r-${i}` }, { resolveDir: () => tmp });
    }
    const res = listPipelineRuns(2, { resolveDir: () => tmp });
    expect(res.total).toBe(5);
    expect(res.rows.length).toBe(2);
    // Returns the LAST two, in reverse order.
    expect(res.rows[0]!.intakeId).toBe('r-4');
    expect(res.rows[1]!.intakeId).toBe('r-3');
  });

  test('missing log file → empty result (not an error)', () => {
    const res = listPipelineRuns(10, { resolveDir: () => tmp });
    expect(res.total).toBe(0);
    expect(res.rows).toEqual([]);
    expect(res.aggregates.total).toBe(0);
  });

  test('corrupt JSONL line skipped without aborting the stream', () => {
    recordPipelineRun(SAMPLE, { resolveDir: () => tmp });
    // Manually append a busted line.
    const dirText = readFileSync(join(tmp, RUNS_FILE), 'utf8');
    const corruptText = dirText + 'BUSTED LINE\n' + JSON.stringify({ ...SAMPLE, intakeId: 'after' }) + '\n';
    const { writeFileSync } = require('node:fs') as typeof import('node:fs');
    writeFileSync(join(tmp, RUNS_FILE), corruptText);
    const res = listPipelineRuns(10, { resolveDir: () => tmp });
    expect(res.total).toBe(2);            // 2 valid rows
    expect(res.rows[0]!.intakeId).toBe('after');
    expect(res.rows[1]!.intakeId).toBe('sample-1');
  });

  test('writer swallows errors silently (resolveDir throws)', () => {
    // Should not throw even when the dir resolver bombs.
    expect(() => {
      recordPipelineRun(SAMPLE, {
        resolveDir: () => { throw new Error('boom'); },
      });
    }).not.toThrow();
  });

  test('test seam appendLine is preferred over fs', () => {
    const lines: Array<{ path: string; line: string }> = [];
    recordPipelineRun(SAMPLE, {
      resolveDir: () => tmp,
      appendLine: (path, line) => { lines.push({ path, line }); },
    });
    expect(lines.length).toBe(1);
    expect(lines[0]!.path).toBe(join(tmp, RUNS_FILE));
    expect(JSON.parse(lines[0]!.line.trim()).intakeId).toBe('sample-1');
    // Real fs is untouched (we'd otherwise see a file here).
    const direct = listPipelineRuns(10, { resolveDir: () => tmp });
    expect(direct.total).toBe(0);
  });
});
