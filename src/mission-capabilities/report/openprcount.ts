import { execFileSync } from 'node:child_process';
import type { CapabilityProbeContext, CapabilityProbeResult, CapabilityProvider } from '../registry.js';

type ProbeResult = CapabilityProbeResult;
type ExecFile = typeof execFileSync;
export type ReadOpenPullRequestSnapshot = (authorityRoot: string) => string;
type OpenPullRequest = { number: number; state: 'OPEN' };

export const openPullRequestListLimit = 200;

export function readOpenPullRequestSnapshot(authorityRoot: string, execFile: ExecFile = execFileSync): string {
  return execFile('gh', ['pr', 'list', '--state', 'open', '--limit', String(openPullRequestListLimit), '--json', 'number,state'], {
    cwd: authorityRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export function parseOpenPullRequestSnapshot(snapshot: string): OpenPullRequest[] | null {
  let rows: unknown;
  try {
    rows = JSON.parse(snapshot);
  } catch {
    return null;
  }
  if (!Array.isArray(rows) || rows.length >= openPullRequestListLimit) return null;
  const pullRequests: OpenPullRequest[] = [];
  for (const row of rows) {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) return null;
    const { number, state } = row as { number?: unknown; state?: unknown };
    if (typeof number !== 'number' || !Number.isInteger(number) || typeof state !== 'string' || state !== 'OPEN') return null;
    pullRequests.push({ number, state });
  }
  return pullRequests;
}

function unavailableOpenPullRequestCount(reason: string, authorityRoot?: string): ProbeResult {
  return {
    ok: false,
    reason: authorityRoot === undefined ? reason : `${reason} (잰 트리: ${authorityRoot})`,
    repairHint: {
      paths: ['src/mission-capabilities/report/openprcount.ts'],
      what: 'Restore an untruncated `gh pr list --state open` JSON snapshot that contains open pull-request number and state fields.',
    },
  };
}

export function probeOpenPullRequestCount(readSnapshot: ReadOpenPullRequestSnapshot = readOpenPullRequestSnapshot, authorityRoot?: string): ProbeResult {
  const measuredRoot = authorityRoot ?? process.cwd();
  try {
    const pullRequests = parseOpenPullRequestSnapshot(readSnapshot(measuredRoot));
    if (pullRequests === null) return unavailableOpenPullRequestCount('Open pull-request snapshot is missing, malformed, or truncated.', authorityRoot);
    return { ok: true };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return unavailableOpenPullRequestCount(`Open pull-request snapshot could not be read: ${detail}`, authorityRoot);
  }
}

export function createOpenPullRequestCountProvider(readSnapshot: ReadOpenPullRequestSnapshot = readOpenPullRequestSnapshot): CapabilityProvider {
  return {
    id: 'report.openprcount',
    async probe(context?: CapabilityProbeContext): Promise<ProbeResult> {
      return probeOpenPullRequestCount(readSnapshot, context?.authorityRoot);
    },
  };
}

export default createOpenPullRequestCountProvider();
