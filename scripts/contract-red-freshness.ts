#!/usr/bin/env bun
import { access, readFile } from 'node:fs/promises';
import { parseTestSummary, runBunTest, type FileRunner, type FileResult } from './contract-red-sweep.js';

export type FreshnessStatus = 'still-red' | 'now-green' | 'unmeasurable';
export type UnmeasurableReason = 'missing-target' | 'remeasurement-failed' | 'missing-report-timestamp' | 'invalid-report-timestamp' | 'future-report-timestamp' | 'malformed-stored-red';

export type StoredRedReport = { createdAt?: unknown; files?: unknown };
export type FreshnessRecord = {
  file: string;
  status: FreshnessStatus;
  storedFail: number | null;
  currentFail: number | null;
  pass: number | null;
  reason?: UnmeasurableReason;
  error?: string;
};
export type ContractRedFreshnessReport = {
  status: 'ok' | 'unmeasurable';
  createdAt: string | null;
  files: FreshnessRecord[];
  candidates: number;
  stillRed: number;
  nowGreen: number;
  unmeasurable: number;
};

type Dependencies = { exists?: (file: string) => Promise<boolean>; access?: (file: string) => Promise<void>; run?: FileRunner; now?: () => Date };

type AccessError = { code?: unknown };

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function parseStoredRedReport(value: unknown): StoredRedReport | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as StoredRedReport : null;
}

export function reportTimestampProblem(report: StoredRedReport, now: Date): UnmeasurableReason | null {
  if (typeof report.createdAt !== 'string' || report.createdAt.length === 0) return 'missing-report-timestamp';
  const timestamp = new Date(report.createdAt);
  if (Number.isNaN(timestamp.getTime())) return 'invalid-report-timestamp';
  return timestamp.getTime() > now.getTime() ? 'future-report-timestamp' : null;
}

function storedRecordProblem(value: unknown): string | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return 'stored record is not an object';
  const record = value as Partial<FileResult>;
  if (record.status !== 'green' && record.status !== 'red' && record.status !== 'unmeasurable') return 'stored record status is invalid';
  if (typeof record.file !== 'string' || record.file.length === 0) return 'stored record file is missing';
  if (record.exitCode !== null && (typeof record.exitCode !== 'number' || !Number.isInteger(record.exitCode))) return 'stored exit code is invalid';
  if (record.error !== undefined && typeof record.error !== 'string') return 'stored record error is invalid';
  if (record.status === 'unmeasurable') {
    return record.pass === null && record.fail === null ? null : 'stored unmeasurable counts are invalid';
  }
  if (typeof record.pass !== 'number' || !Number.isInteger(record.pass) || record.pass < 0) return 'stored measured pass count is invalid';
  if (typeof record.fail !== 'number' || !Number.isInteger(record.fail) || record.fail < 0) return 'stored measured fail count is invalid';
  if (record.status === 'green' && record.fail !== 0) return 'stored green fail count is invalid';
  if (record.status === 'red' && record.fail === 0) return 'stored red fail count is invalid';
  return null;
}

function recordsFromStored(report: StoredRedReport): FileResult[] {
  return (report.files as FileResult[]).filter((record) => record.status === 'red');
}

function unmeasurable(file: string, storedFail: number | null, reason: UnmeasurableReason, error?: string): FreshnessRecord {
  return { file, status: 'unmeasurable', storedFail, currentFail: null, pass: null, reason, ...(error ? { error } : {}) };
}

export async function remeasureStoredReds(report: StoredRedReport, dependencies: Dependencies = {}): Promise<ContractRedFreshnessReport> {
  const createdAt = typeof report.createdAt === 'string' ? report.createdAt : null;
  const timestampProblem = reportTimestampProblem(report, dependencies.now?.() ?? new Date());
  if (timestampProblem) {
    return { status: 'unmeasurable', createdAt, files: [unmeasurable('<report>', null, timestampProblem)], candidates: 0, stillRed: 0, nowGreen: 0, unmeasurable: 1 };
  }
  if (!Array.isArray(report.files)) {
    return { status: 'unmeasurable', createdAt, files: [unmeasurable('<report>', null, 'malformed-stored-red', 'stored report files is missing')], candidates: 1, stillRed: 0, nowGreen: 0, unmeasurable: 1 };
  }
  const invalidStoredRecord = report.files.map(storedRecordProblem).find((problem) => problem !== null);
  if (invalidStoredRecord) {
    return { status: 'unmeasurable', createdAt, files: [unmeasurable('<report>', null, 'malformed-stored-red', invalidStoredRecord)], candidates: 1, stillRed: 0, nowGreen: 0, unmeasurable: 1 };
  }
  const candidates = recordsFromStored(report).sort((left, right) => left.file.localeCompare(right.file));
  const exists = dependencies.exists;
  const accessFile = dependencies.access ?? access;
  const run = dependencies.run ?? runBunTest;
  const files: FreshnessRecord[] = [];
  for (const record of candidates) {
    const file = record.file;
    const storedFail = record.fail;
    try {
      if (exists) {
        if (!await exists(file)) { files.push(unmeasurable(file, storedFail, 'missing-target')); continue; }
      } else {
        try {
          await accessFile(file);
        } catch (error) {
          if ((error as AccessError).code === 'ENOENT') { files.push(unmeasurable(file, storedFail, 'missing-target')); continue; }
          files.push(unmeasurable(file, storedFail, 'remeasurement-failed', message(error)));
          continue;
        }
      }
    } catch (error) {
      files.push(unmeasurable(file, storedFail, 'remeasurement-failed', message(error)));
      continue;
    }
    try {
      const result = await run(file);
      const summary = result.signal || result.exitCode === null ? null : parseTestSummary(`${result.stdout}${result.stderr}`);
      if (!summary) {
        const error = result.signal ? `runner terminated by ${result.signal}` : 'test summary unavailable or ambiguous';
        files.push(unmeasurable(file, storedFail, 'remeasurement-failed', error));
      } else {
        files.push({ file, status: summary.fail === 0 ? 'now-green' : 'still-red', storedFail, currentFail: summary.fail, pass: summary.pass });
      }
    } catch (error) {
      files.push(unmeasurable(file, storedFail, 'remeasurement-failed', message(error)));
    }
  }
  return {
    status: files.some((file) => file.status === 'unmeasurable') ? 'unmeasurable' : 'ok',
    createdAt,
    files,
    candidates: files.length,
    stillRed: files.filter((file) => file.status === 'still-red').length,
    nowGreen: files.filter((file) => file.status === 'now-green').length,
    unmeasurable: files.filter((file) => file.status === 'unmeasurable').length,
  };
}

export async function readAndRemeasureStoredReds(path: string, dependencies: Dependencies = {}): Promise<ContractRedFreshnessReport> {
  try {
    const parsed = parseStoredRedReport(JSON.parse(await readFile(path, 'utf8')));
    if (!parsed) throw new Error('stored report is not an object');
    return remeasureStoredReds(parsed, dependencies);
  } catch (error) {
    return { status: 'unmeasurable', createdAt: null, files: [unmeasurable('<report>', null, 'malformed-stored-red', message(error))], candidates: 1, stillRed: 0, nowGreen: 0, unmeasurable: 1 };
  }
}

export async function runContractRedFreshnessCli(path: string | undefined = process.argv[2]): Promise<ContractRedFreshnessReport> {
  if (!path) throw new Error('stored report path is required');
  const report = await readAndRemeasureStoredReds(path);
  console.log(JSON.stringify(report));
  return report;
}

if (import.meta.main) await runContractRedFreshnessCli();
