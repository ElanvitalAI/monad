import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseStoredRedReport, readAndRemeasureStoredReds, remeasureStoredReds, reportTimestampProblem, runContractRedFreshnessCli } from './contract-red-freshness.js';

const summary = (pass: number, fail: number) => ` ${pass} pass\n ${fail} fail\n`;
const stored = (files: unknown[], createdAt = '2026-08-15T00:00:00.000Z') => ({ createdAt, files });
const red = (file: string, fail = 1) => ({ file, status: 'red', pass: 1, fail, exitCode: 1 });
const green = (file: string) => ({ file, status: 'green', pass: 1, fail: 0, exitCode: 0 });

describe('contract red freshness', () => {
  test('stored red is remeasured into literal now-green, still-red, and unmeasurable values', async () => {
    const report = await remeasureStoredReds(stored([red('z.test.ts', 8), red('a.test.ts', 3), red('missing.test.ts', 1), green('ignored.test.ts')]), {
      now: () => new Date('2026-08-16T00:00:00.000Z'),
      exists: async (file) => file !== 'missing.test.ts',
      run: async (file) => file === 'a.test.ts'
        ? { stdout: summary(4, 0), stderr: '', exitCode: 0 }
        : { stdout: summary(2, 5), stderr: '', exitCode: 1 },
    });
    expect(report).toMatchObject({ status: 'unmeasurable', candidates: 3, stillRed: 1, nowGreen: 1, unmeasurable: 1 });
    expect(report.files).toEqual([
      { file: 'a.test.ts', status: 'now-green', storedFail: 3, currentFail: 0, pass: 4 },
      { file: 'missing.test.ts', status: 'unmeasurable', storedFail: 1, currentFail: null, pass: null, reason: 'missing-target' },
      { file: 'z.test.ts', status: 'still-red', storedFail: 8, currentFail: 5, pass: 2 },
    ]);
  });

  test('runner failures and ambiguous summaries are literal remeasurement-failed, never a measured zero', async () => {
    const thrown = await remeasureStoredReds(stored([red('throw.test.ts')]), {
      now: () => new Date('2026-08-16T00:00:00.000Z'), exists: async () => true,
      run: async () => { throw new Error('spawn failed'); },
    });
    const ambiguous = await remeasureStoredReds(stored([red('ambiguous.test.ts')]), {
      now: () => new Date('2026-08-16T00:00:00.000Z'), exists: async () => true,
      run: async () => ({ stdout: 'crashed', stderr: '', exitCode: 1 }),
    });
    expect(thrown.files[0]).toEqual({ file: 'throw.test.ts', status: 'unmeasurable', storedFail: 1, currentFail: null, pass: null, reason: 'remeasurement-failed', error: 'spawn failed' });
    expect(ambiguous.files[0]).toEqual({ file: 'ambiguous.test.ts', status: 'unmeasurable', storedFail: 1, currentFail: null, pass: null, reason: 'remeasurement-failed', error: 'test summary unavailable or ambiguous' });
  });

  test('missing, invalid, and future report timestamps remain literal unmeasurable reasons', async () => {
    const now = new Date('2026-08-16T00:00:00.000Z');
    expect(reportTimestampProblem({ files: [red('a.test.ts')] }, now)).toBe('missing-report-timestamp');
    expect(reportTimestampProblem(stored([red('a.test.ts')], 'not-a-date'), now)).toBe('invalid-report-timestamp');
    expect(reportTimestampProblem(stored([red('a.test.ts')], '2026-08-17T00:00:00.000Z'), now)).toBe('future-report-timestamp');
    const future = await remeasureStoredReds(stored([red('a.test.ts')], '2026-08-17T00:00:00.000Z'), { now: () => now, exists: async () => true });
    expect(future).toEqual({ status: 'unmeasurable', createdAt: '2026-08-17T00:00:00.000Z', files: [{ file: '<report>', status: 'unmeasurable', storedFail: null, currentFail: null, pass: null, reason: 'future-report-timestamp' }], candidates: 0, stillRed: 0, nowGreen: 0, unmeasurable: 1 });
    const invalidEmpty = await remeasureStoredReds(stored([], 'not-a-date'), { now: () => now });
    const futureEmpty = await remeasureStoredReds(stored([], '2026-08-17T00:00:00.000Z'), { now: () => now });
    expect(invalidEmpty.files[0]).toEqual({ file: '<report>', status: 'unmeasurable', storedFail: null, currentFail: null, pass: null, reason: 'invalid-report-timestamp' });
    expect(futureEmpty.files[0]).toEqual({ file: '<report>', status: 'unmeasurable', storedFail: null, currentFail: null, pass: null, reason: 'future-report-timestamp' });
  });

  test('ENOENT is missing-target while access and injected existence failures are remeasurement-failed', async () => {
    const now = () => new Date('2026-08-16T00:00:00.000Z');
    const missing = await remeasureStoredReds(stored([red('gone.test.ts')]), {
      now,
      access: async () => { const error = Object.assign(new Error('gone'), { code: 'ENOENT' }); throw error; },
    });
    const denied = await remeasureStoredReds(stored([red('denied.test.ts')]), {
      now,
      access: async () => { const error = Object.assign(new Error('permission denied'), { code: 'EACCES' }); throw error; },
    });
    const existsThrown = await remeasureStoredReds(stored([red('probe.test.ts')]), {
      now,
      exists: async () => { throw new Error('probe failed'); },
    });
    expect(missing.files[0]).toEqual({ file: 'gone.test.ts', status: 'unmeasurable', storedFail: 1, currentFail: null, pass: null, reason: 'missing-target' });
    expect(denied.files[0]).toEqual({ file: 'denied.test.ts', status: 'unmeasurable', storedFail: 1, currentFail: null, pass: null, reason: 'remeasurement-failed', error: 'permission denied' });
    expect(existsThrown.files[0]).toEqual({ file: 'probe.test.ts', status: 'unmeasurable', storedFail: 1, currentFail: null, pass: null, reason: 'remeasurement-failed', error: 'probe failed' });
  });

  test('malformed stored red and malformed report are unmeasurable while an empty stored-red set is measured as zero candidates', async () => {
    const malformed = await remeasureStoredReds(stored([{ file: '', status: 'red', fail: 1 }]), { now: () => new Date('2026-08-16T00:00:00.000Z') });
    const invalidFiles = await remeasureStoredReds({ createdAt: '2026-08-15T00:00:00.000Z' }, { now: () => new Date('2026-08-16T00:00:00.000Z') });
    const empty = await remeasureStoredReds(stored([green('green.test.ts')]), { now: () => new Date('2026-08-16T00:00:00.000Z') });
    expect(malformed.files[0]).toMatchObject({ status: 'unmeasurable', reason: 'malformed-stored-red' });
    expect(invalidFiles.files[0]).toMatchObject({ status: 'unmeasurable', reason: 'malformed-stored-red' });
    const nonObject = await remeasureStoredReds(stored([null]), { now: () => new Date('2026-08-16T00:00:00.000Z') });
    const unknownStatus = await remeasureStoredReds(stored([{ status: 'RED', file: 'a.test.ts', fail: 1 }]), { now: () => new Date('2026-08-16T00:00:00.000Z') });
    expect(empty).toEqual({ status: 'ok', createdAt: '2026-08-15T00:00:00.000Z', files: [], candidates: 0, stillRed: 0, nowGreen: 0, unmeasurable: 0 });
    expect(nonObject).toEqual({ status: 'unmeasurable', createdAt: '2026-08-15T00:00:00.000Z', files: [{ file: '<report>', status: 'unmeasurable', storedFail: null, currentFail: null, pass: null, reason: 'malformed-stored-red', error: 'stored record is not an object' }], candidates: 1, stillRed: 0, nowGreen: 0, unmeasurable: 1 });
    expect(unknownStatus).toEqual({ status: 'unmeasurable', createdAt: '2026-08-15T00:00:00.000Z', files: [{ file: '<report>', status: 'unmeasurable', storedFail: null, currentFail: null, pass: null, reason: 'malformed-stored-red', error: 'stored record status is invalid' }], candidates: 1, stillRed: 0, nowGreen: 0, unmeasurable: 1 });
    let remeasurements = 0;
    const invalidExitCode = await remeasureStoredReds(stored([{ ...red('bad-exit-code.test.ts'), exitCode: 'bogus' }]), {
      now: () => new Date('2026-08-16T00:00:00.000Z'),
      run: async () => { remeasurements += 1; return { stdout: summary(1, 0), stderr: '', exitCode: 0 }; },
    });
    expect(invalidExitCode).toEqual({ status: 'unmeasurable', createdAt: '2026-08-15T00:00:00.000Z', files: [{ file: '<report>', status: 'unmeasurable', storedFail: null, currentFail: null, pass: null, reason: 'malformed-stored-red', error: 'stored exit code is invalid' }], candidates: 1, stillRed: 0, nowGreen: 0, unmeasurable: 1 });
    expect(remeasurements).toBe(0);
    expect(parseStoredRedReport([])).toBeNull();
  });

  test('CLI adapter reads only a temporary stored report and remeasures its red fixture', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'contract-red-freshness-'));
    const fixture = join(directory, 'fixture.test.ts');
    const reportPath = join(directory, 'stored-report.json');
    const lines: string[] = [];
    const originalLog = console.log;
    try {
      await writeFile(fixture, "import { test } from 'bun:test'; test('green now', () => {});\n");
      await writeFile(reportPath, JSON.stringify(stored([red(fixture, 9)])));
      const direct = await readAndRemeasureStoredReds(reportPath);
      console.log = (line: string) => { lines.push(line); };
      const cli = await runContractRedFreshnessCli(reportPath);
      expect(direct.files[0]).toMatchObject({ file: fixture, status: 'now-green', storedFail: 9, currentFail: 0 });
      expect(cli.files[0].status).toBe('now-green');
      expect(JSON.parse(lines[0]).files[0]).toMatchObject({ file: fixture, status: 'now-green' });
    } finally {
      console.log = originalLog;
      await rm(directory, { recursive: true, force: true });
    }
  });
});
