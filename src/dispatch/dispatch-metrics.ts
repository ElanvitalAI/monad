/**
 * D8 (2026-05-12) — Phase 2 dispatch dogfood metrics writer.
 *
 * Mirrors the I10 pipeline-metrics module but for the OpportunisticLauncher
 * tick loop. Each launch decision (success or rejection) appends one
 * JSONL row to `~/.elanous/dispatch/runs.jsonl`. The accompanying
 * `GET /v1/dispatch/runs` surface aggregates the file so the 7-day
 * dogfood gate (RESEARCH §11.3) has measurable inputs:
 *
 *   - launch success rate per 4-axes reason
 *   - sleep-window vs awake distribution
 *   - top reject reasons (resource budget · idle · priority)
 *   - tasks dispatched per night
 *
 * Path resolution: env `ELANOUS_DISPATCH_DIR` (test override) →
 * `<homedir>/.elanous/dispatch`.
 *
 * Cross-ref:
 *   src/intake-plane/pipeline-metrics.ts (I10 sibling)
 *   src/dispatch/opportunistic-launcher.ts (emission consumer)
 *   src/dispatch/morning-digest.ts (D7 — same data, different roll-up)
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
} from 'node:fs';
import { elanousStateRoot } from '../autopilot/state-paths.js';
import { join } from 'node:path';

// ──────────────────── Path resolution ───────────────────────────────

const DISPATCH_DIR_ENV = 'ELANOUS_DISPATCH_DIR';
const RUNS_FILE = 'runs.jsonl';

export function dispatchDir(): string {
  const env = process.env[DISPATCH_DIR_ENV];
  if (env && env.length > 0) return env;
  return join(elanousStateRoot(), 'dispatch');
}

export function dispatchRunsPath(): string {
  return join(dispatchDir(), RUNS_FILE);
}

// ──────────────────── Record schema ─────────────────────────────────

export interface DispatchRunRecord {
  /** ISO timestamp. */
  at: string;
  /** Either the TOX task id (launched) or the candidate id evaluated
   *  but rejected. Always present so retrospectives can join back. */
  taskId: string;
  /** Outcome category — direct mirror of LaunchOutcome.kind so the
   *  data shape matches the source-of-truth. */
  outcome: 'launched' | 'deferred' | 'rejected' | 'errored';
  /** Free-form reason string from the launcher. Examples:
   *   - launched               → 'ok' / 'priority-boost'
   *   - deferred (sleep-window) → 'sleep-window:<windowName>'
   *   - rejected (resource)    → 'resource-budget:<resourceKind>'
   *   - errored                → 'launch-threw:<message>'  */
  reason: string;
  /** 4-axes status snapshot at the moment of decision. Captured so
   *  the dogfood gate can split metrics by axis (time / resource /
   *  idle / priority). */
  axes: {
    inSleepWindow: boolean;
    idle: boolean;
    resourceOk: boolean;
    priorityBoosted: boolean;
  };
  /** Slot id that the candidate would have used (when resolved). */
  slotId?: string;
  /** Resource kind probed (when applicable). */
  resourceKind?: string;
}

// ──────────────────── Writer ────────────────────────────────────────

export interface RecordDispatchDeps {
  appendLine?: (path: string, line: string) => void;
  resolveDir?: () => string;
}

/** Append one JSONL row. Fire-and-forget — failures are swallowed
 *  because metrics emission is best-effort (the launcher tick must
 *  never block on a disk hiccup). */
export function recordDispatchOutcome(
  record: DispatchRunRecord,
  deps: RecordDispatchDeps = {},
): void {
  try {
    const dir = (deps.resolveDir ?? dispatchDir)();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const path = join(dir, RUNS_FILE);
    const line = JSON.stringify(record) + '\n';
    if (deps.appendLine) deps.appendLine(path, line);
    else appendFileSync(path, line, 'utf8');
  } catch {
    // Swallow.
  }
}

// ──────────────────── Reader + aggregates ───────────────────────────

export interface DispatchAggregates {
  total: number;
  successRate: number;
  byOutcome: Record<DispatchRunRecord['outcome'], number>;
  topRejectReasons: Array<{ reason: string; count: number }>;
  sleepWindowSplit: { inWindow: number; awake: number };
  idleSplit: { idle: number; busy: number };
}

const EMPTY_AGGREGATES: DispatchAggregates = {
  total: 0,
  successRate: 0,
  byOutcome: { launched: 0, deferred: 0, rejected: 0, errored: 0 },
  topRejectReasons: [],
  sleepWindowSplit: { inWindow: 0, awake: 0 },
  idleSplit: { idle: 0, busy: 0 },
};

export function parseDispatchRunLine(line: string): DispatchRunRecord | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const obj = JSON.parse(trimmed) as DispatchRunRecord;
    if (
      !obj
      || typeof obj.at !== 'string'
      || typeof obj.taskId !== 'string'
      || typeof obj.reason !== 'string'
    ) return null;
    if (!['launched', 'deferred', 'rejected', 'errored'].includes(obj.outcome)) {
      return null;
    }
    if (!obj.axes || typeof obj.axes !== 'object') return null;
    return obj;
  } catch {
    return null;
  }
}

export function aggregateDispatchRuns(
  rows: readonly DispatchRunRecord[],
): DispatchAggregates {
  if (rows.length === 0) return EMPTY_AGGREGATES;
  const byOutcome: Record<DispatchRunRecord['outcome'], number> = {
    launched: 0, deferred: 0, rejected: 0, errored: 0,
  };
  const sleepWindowSplit = { inWindow: 0, awake: 0 };
  const idleSplit = { idle: 0, busy: 0 };
  const rejectReasonCounts = new Map<string, number>();
  for (const r of rows) {
    byOutcome[r.outcome] += 1;
    if (r.axes.inSleepWindow) sleepWindowSplit.inWindow += 1;
    else sleepWindowSplit.awake += 1;
    if (r.axes.idle) idleSplit.idle += 1;
    else idleSplit.busy += 1;
    if (r.outcome === 'rejected') {
      rejectReasonCounts.set(r.reason, (rejectReasonCounts.get(r.reason) ?? 0) + 1);
    }
  }
  const topRejectReasons = Array.from(rejectReasonCounts.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
  return {
    total: rows.length,
    successRate: byOutcome.launched / rows.length,
    byOutcome,
    topRejectReasons,
    sleepWindowSplit,
    idleSplit,
  };
}

// ──────────────────── List endpoint helper ──────────────────────────

export interface ListDispatchDeps {
  readFile?: (path: string) => string;
  resolveDir?: () => string;
}

export interface ListDispatchResult {
  total: number;
  rows: DispatchRunRecord[];
  aggregates: DispatchAggregates;
}

export function listDispatchRuns(
  limit: number,
  deps: ListDispatchDeps = {},
): ListDispatchResult {
  const dir = (deps.resolveDir ?? dispatchDir)();
  const path = join(dir, RUNS_FILE);
  let text: string;
  try {
    text = deps.readFile ? deps.readFile(path) : readFileSync(path, 'utf8');
  } catch {
    return { total: 0, rows: [], aggregates: EMPTY_AGGREGATES };
  }
  const rows: DispatchRunRecord[] = [];
  for (const line of text.split('\n')) {
    const row = parseDispatchRunLine(line);
    if (row) rows.push(row);
  }
  const cap = Math.max(1, Math.min(limit, 1000));
  return {
    total: rows.length,
    rows: rows.slice(-cap).reverse(),
    aggregates: aggregateDispatchRuns(rows),
  };
}

export { RUNS_FILE };
