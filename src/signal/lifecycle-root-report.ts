import { linkSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { elanousStateRoot } from '../autopilot/state-paths.js';

export const LIFECYCLE_ROOT_REPORT_ENV = 'ELANOUS_LIFECYCLE_ROOT_REPORT';
export const LIFECYCLE_ROOT_REPORT_NONCE_ENV = 'ELANOUS_LIFECYCLE_ROOT_REPORT_NONCE';

interface LifecycleRootReport {
  readonly executionId: string;
  readonly nonce: string;
  readonly stateDir: string;
}

export function lifecycleRootReportPath(executionId: string, nonce: string): string {
  return join(tmpdir(), 'elanous-lifecycle-root-reports', `${executionId}-${nonce}.json`);
}

export function lifecycleRootReportEnv(reportPath: string, nonce: string): Record<string, string> {
  return {
    [LIFECYCLE_ROOT_REPORT_ENV]: reportPath,
    [LIFECYCLE_ROOT_REPORT_NONCE_ENV]: nonce,
  };
}

/** Child reports the exact state root selected by its own resolver to its parent-owned handoff file. */
export function publishLifecycleRootReport(): void {
  const reportPath = process.env[LIFECYCLE_ROOT_REPORT_ENV]?.trim();
  const executionId = process.env.ELANOUS_PTY_ID?.trim();
  const nonce = process.env[LIFECYCLE_ROOT_REPORT_NONCE_ENV]?.trim();
  delete process.env[LIFECYCLE_ROOT_REPORT_ENV];
  delete process.env[LIFECYCLE_ROOT_REPORT_NONCE_ENV];
  if (!reportPath || !executionId || !nonce) return;
  const temporaryPath = `${reportPath}.${randomUUID()}.tmp`;
  try {
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(
      temporaryPath,
      JSON.stringify({ executionId, nonce, stateDir: elanousStateRoot() } satisfies LifecycleRootReport),
      { encoding: 'utf8', flag: 'wx' },
    );
    try {
      linkSync(temporaryPath, reportPath);
    } finally {
      rmSync(temporaryPath, { force: true });
    }
  } catch {
    try { rmSync(temporaryPath, { force: true }); } catch { /* reporting cleanup is fail-soft */ }
    // Reporting must not prevent lifecycle persistence.
  }
}

/** Parent removes one execution's accepted report and any interrupted write remnants. */
export function removeLifecycleRootReport(reportPath: string): void {
  try {
    rmSync(reportPath, { force: true });
    const prefix = `${basename(reportPath)}.`;
    for (const entry of readdirSync(dirname(reportPath))) {
      if (entry.startsWith(prefix) && entry.endsWith('.tmp')) {
        rmSync(join(dirname(reportPath), entry), { force: true });
      }
    }
  } catch {
    // Cleanup must not affect the child-run result.
  }
}

/** Parent accepts only the report written by its current execution identity and nonce. */
export function readLifecycleRootReport(reportPath: string, executionId: string, nonce: string): string | undefined {
  try {
    const candidate = JSON.parse(readFileSync(reportPath, 'utf8')) as Partial<LifecycleRootReport>;
    return candidate.executionId === executionId
      && candidate.nonce === nonce
      && typeof candidate.stateDir === 'string'
      && candidate.stateDir.trim()
      ? candidate.stateDir.trim()
      : undefined;
  } catch {
    return undefined;
  }
}
