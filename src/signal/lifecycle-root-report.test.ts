import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { LIFECYCLE_ROOT_REPORT_ENV, LIFECYCLE_ROOT_REPORT_NONCE_ENV, lifecycleRootReportPath, publishLifecycleRootReport, readLifecycleRootReport, removeLifecycleRootReport } from './lifecycle-root-report.js';

const originalStateDir = process.env.ELANOUS_STATE_DIR;
const originalPtyId = process.env.ELANOUS_PTY_ID;
const originalReportPath = process.env[LIFECYCLE_ROOT_REPORT_ENV];
const originalReportNonce = process.env[LIFECYCLE_ROOT_REPORT_NONCE_ENV];
const temporaryRoots: string[] = [];

afterEach(() => {
  if (originalStateDir === undefined) delete process.env.ELANOUS_STATE_DIR;
  else process.env.ELANOUS_STATE_DIR = originalStateDir;
  if (originalPtyId === undefined) delete process.env.ELANOUS_PTY_ID;
  else process.env.ELANOUS_PTY_ID = originalPtyId;
  if (originalReportPath === undefined) delete process.env[LIFECYCLE_ROOT_REPORT_ENV];
  else process.env[LIFECYCLE_ROOT_REPORT_ENV] = originalReportPath;
  if (originalReportNonce === undefined) delete process.env[LIFECYCLE_ROOT_REPORT_NONCE_ENV];
  else process.env[LIFECYCLE_ROOT_REPORT_NONCE_ENV] = originalReportNonce;
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('lifecycle root report', () => {
  test('child reports its resolved ELANOUS_STATE_DIR and parent accepts only the current execution nonce', () => {
    const root = mkdtempSync(join(tmpdir(), 'lifecycle-root-report-'));
    temporaryRoots.push(root);
    const stateDir = join(root, 'child-state');
    const reportPath = join(root, 'handoff.json');
    process.env.ELANOUS_STATE_DIR = stateDir;
    process.env.ELANOUS_PTY_ID = 'self_reported';
    process.env[LIFECYCLE_ROOT_REPORT_ENV] = reportPath;
    process.env[LIFECYCLE_ROOT_REPORT_NONCE_ENV] = 'run-nonce';

    publishLifecycleRootReport();

    expect(readLifecycleRootReport(reportPath, 'self_reported', 'run-nonce')).toBe(stateDir);
    expect(readLifecycleRootReport(reportPath, 'self_other', 'run-nonce')).toBeUndefined();
    expect(readLifecycleRootReport(reportPath, 'self_reported', 'old-nonce')).toBeUndefined();
    expect(process.env[LIFECYCLE_ROOT_REPORT_ENV]).toBeUndefined();
    expect(process.env[LIFECYCLE_ROOT_REPORT_NONCE_ENV]).toBeUndefined();
  });

  test('accepts only the first publisher report for an execution', () => {
    const root = mkdtempSync(join(tmpdir(), 'lifecycle-root-report-once-'));
    temporaryRoots.push(root);
    const reportPath = join(root, 'handoff.json');
    process.env.ELANOUS_PTY_ID = 'self_reported';
    process.env.ELANOUS_STATE_DIR = join(root, 'first-state');
    process.env[LIFECYCLE_ROOT_REPORT_ENV] = reportPath;
    process.env[LIFECYCLE_ROOT_REPORT_NONCE_ENV] = 'run-nonce';
    publishLifecycleRootReport();

    process.env.ELANOUS_STATE_DIR = join(root, 'second-state');
    process.env[LIFECYCLE_ROOT_REPORT_ENV] = reportPath;
    process.env[LIFECYCLE_ROOT_REPORT_NONCE_ENV] = 'run-nonce';
    publishLifecycleRootReport();

    expect(existsSync(reportPath)).toBe(true);
    expect(readLifecycleRootReport(reportPath, 'self_reported', 'run-nonce')).toBe(join(root, 'first-state'));
  });

  test('atomically publishes through a temporary file and cleanup removes an interrupted write remnant', () => {
    const reportPath = lifecycleRootReportPath(`self_cleanup_${Date.now()}`, 'run-nonce');
    const reportDirectory = dirname(reportPath);
    mkdirSync(reportDirectory, { recursive: true });
    const temporaryPath = `${reportPath}.interrupted.tmp`;
    try {
      process.env.ELANOUS_PTY_ID = 'self_cleanup';
      process.env.ELANOUS_STATE_DIR = join(tmpdir(), 'child-state');
      process.env[LIFECYCLE_ROOT_REPORT_ENV] = reportPath;
      process.env[LIFECYCLE_ROOT_REPORT_NONCE_ENV] = 'run-nonce';

      publishLifecycleRootReport();

      expect(readLifecycleRootReport(reportPath, 'self_cleanup', 'run-nonce')).toBe(join(tmpdir(), 'child-state'));
      expect(readdirSync(reportDirectory).some((entry) => entry.startsWith(`${basename(reportPath)}.`) && entry.endsWith('.tmp'))).toBe(false);
      writeFileSync(temporaryPath, 'interrupted', 'utf8');

      removeLifecycleRootReport(reportPath);

      expect(existsSync(reportPath)).toBe(false);
      expect(existsSync(temporaryPath)).toBe(false);
    } finally {
      removeLifecycleRootReport(reportPath);
    }
  });
});
