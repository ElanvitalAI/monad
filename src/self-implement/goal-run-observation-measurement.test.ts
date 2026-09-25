import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { insertGoalRunRecord, loadGoalRunRecordsByRunId } from './goal-run-store.js';
import type { GoalExecutionRecord } from './orchestrator.js';
import type { DevCliOpts } from '../self-dev/dev-cli.js';
import type { DevSelfOpts } from '../self-dev/dev-pipeline.js';
import type { SelfImplementOptions, SelfImplementSeams } from './orchestrator.js';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('optional correlation contracts', () => {
  test('accept matching optional correlation fields without requiring a runtime call site', () => {
    const cli: DevCliOpts = {
      correlation: 'corr-request',
      parentCorrelationId: 'corr-parent',
    };
    const pipeline: DevSelfOpts = {
      correlationId: 'corr-request',
      parentCorrelationId: 'corr-parent',
    };
    const options: SelfImplementOptions = {
      feature: 'contract only',
      seams: {} as SelfImplementSeams,
      correlationId: 'corr-request',
      parentCorrelationId: 'corr-parent',
    };
    const cliWithoutCorrelation: DevCliOpts = {};
    const pipelineWithoutCorrelation: DevSelfOpts = {};
    const optionsWithoutCorrelation: SelfImplementOptions = {
      feature: 'existing request',
      seams: {} as SelfImplementSeams,
    };

    expect(cli).toEqual({ correlation: 'corr-request', parentCorrelationId: 'corr-parent' });
    expect(pipeline).toEqual({ correlationId: 'corr-request', parentCorrelationId: 'corr-parent' });
    expect(options).toMatchObject({ correlationId: 'corr-request', parentCorrelationId: 'corr-parent' });
    expect(cliWithoutCorrelation).toEqual({});
    expect(pipelineWithoutCorrelation).toEqual({});
    expect(optionsWithoutCorrelation).not.toHaveProperty('correlationId');
    expect(optionsWithoutCorrelation).not.toHaveProperty('parentCorrelationId');
  });
});

describe('goal run observation measurement record', () => {
  test('round-trips the additive basis through the public writer without a schema migration', () => {
    const directory = mkdtempSync(join(tmpdir(), 'goal-run-observation-measurement-'));
    directories.push(directory);
    const goalFile = join(directory, 'GOAL.txt');
    const path = join(directory, 'goal-runs.db');
    writeFileSync(goalFile, '- GoalId: 0123456789abcdef\n');
    const record: GoalExecutionRecord = {
      runId: 'run-observation-basis',
      stage: 'pr-opened',
      outcome: 'completed',
      ok: true,
      observationMeasurementBasis: 'existing-observation-fields',
      correlationId: 'corr-record',
      parentCorrelationId: 'corr-parent',
    };

    insertGoalRunRecord(goalFile, record, undefined, path);

    const roundTrippedRecord = loadGoalRunRecordsByRunId(record.runId, path)[0]?.record;
    expect(roundTrippedRecord?.observationMeasurementBasis).toBe('existing-observation-fields');
    expect(roundTrippedRecord).toMatchObject({ correlationId: 'corr-record', parentCorrelationId: 'corr-parent' });

    const skippedRecord: GoalExecutionRecord = {
      runId: 'run-observation-skipped',
      stage: 'pr-opened',
      outcome: 'completed',
      ok: true,
      observationMeasurementSkipped: 'non-implement-goal-type',
    };
    insertGoalRunRecord(goalFile, skippedRecord, undefined, path);
    const roundTrippedSkippedRecord = loadGoalRunRecordsByRunId(skippedRecord.runId, path)[0]?.record;
    expect(roundTrippedSkippedRecord).toMatchObject({ observationMeasurementSkipped: 'non-implement-goal-type' });
    expect(roundTrippedSkippedRecord).not.toHaveProperty('observationMeasurementBasis');
    expect(roundTrippedSkippedRecord).not.toHaveProperty('correlationId');
    expect(roundTrippedSkippedRecord).not.toHaveProperty('parentCorrelationId');
  });
});
