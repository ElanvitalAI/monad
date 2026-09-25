import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadRunLedger, runLedgerDir, type RunLedgerEntry } from '../src/self-implement/run-ledger.js';
import { normalizeRunId } from '../src/harness/harness-space.js';
import {
  buildReworkDriftRecommendation,
  detectReworkDrift,
  type ReworkDriftVerdictResult,
  type ReworkVerdictReview,
} from './rework-drift-verdict.js';

interface DriftSignalRow {
  readonly round: number;
  readonly mustFixCount: number | null;
  readonly cumulativeMustFixCount: number;
  readonly budgetIncreaseCount: number;
  readonly refuteNotSubmittedCount: number;
  readonly refutableNotSubmittedCount: number;
}

interface RunDriftSignals {
  readonly runId: string;
  readonly outcome: string | null;
  readonly status: 'measured' | 'no-review-rounds';
  readonly rows: readonly DriftSignalRow[];
  readonly warnings: readonly string[];
  readonly verdict: ReworkDriftVerdictResult;
  readonly recommendation: string;
}

interface DriftSignalScan {
  readonly ledgerDirectory: string;
  readonly readableRunCount: number;
  readonly unreadableRunCount: number;
  readonly runs: readonly RunDriftSignals[];
  readonly unreadable: readonly { runId: string; error: string }[];
}

interface DriftSignalScanDependencies {
  readonly list?: (directory: string) => string[];
  readonly load?: (runId: string, directory: string) => RunLedgerEntry[] | null;
}

function roundOf(entry: RunLedgerEntry): number | null {
  const value = entry.data.round;
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function mustFixCount(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value;
  if (Array.isArray(value)) return value.length;
  return null;
}

function terminalOutcome(entry: RunLedgerEntry): string | null {
  if (entry.event !== 'run-status' && entry.event !== 'run-rollup') return null;
  return typeof entry.data.runStatus === 'string' ? entry.data.runStatus : null;
}

/** Analyze one canonical ledger without assigning a risk verdict or changing the ledger. */
export function analyzeRunDriftSignals(runId: string, entries: readonly RunLedgerEntry[]): RunDriftSignals {
  const warnings: string[] = [];
  const reviews = new Map<number, number>();
  const verdictReviews = new Map<number, ReworkVerdictReview>();
  const budgetIncreases = new Map<number, number>();
  const refutations = new Map<number, { events: number; refutable: number }>();
  const rounds = new Set<number>();
  let lastRound = -1;
  let outcome: string | null = null;

  for (const entry of entries) {
    outcome = terminalOutcome(entry) ?? outcome;
    const relevant = entry.event === 'reviewed' || entry.event === 'rework-budget' || entry.event === 'refute-not-submitted';
    if (!relevant) continue;
    const round = roundOf(entry);
    if (round === null) {
      warnings.push(`invalid round event=${entry.event}`);
      continue;
    }
    if (round < lastRound) warnings.push(`out-of-order round=${round} after=${lastRound}`);
    lastRound = Math.max(lastRound, round);
    rounds.add(round);

    if (entry.event === 'reviewed') {
      const count = mustFixCount(entry.data.mustFix);
      if (count === null) warnings.push(`invalid mustFix round=${round}`);
      else {
        if (reviews.has(round)) warnings.push(`duplicate reviewed round=${round}`);
        reviews.set(round, count);
        const findingIds = Array.isArray(entry.data.findingIds) && entry.data.findingIds.every((value) => typeof value === 'string')
          ? entry.data.findingIds
          : null;
        const reviewVerdict = typeof entry.data.verdict === 'string' ? entry.data.verdict : null;
        verdictReviews.set(round, { round, mustFixCount: count, findingIds, reviewVerdict });
      }
    } else if (entry.event === 'rework-budget') {
      const { effectiveMaxBefore: before, effectiveMaxAfter: after, verdict } = entry.data;
      if (typeof before !== 'number' || typeof after !== 'number' || typeof verdict !== 'string') warnings.push(`invalid budget round=${round}`);
      else if (verdict === 'EXTEND' && after > before) budgetIncreases.set(round, (budgetIncreases.get(round) ?? 0) + 1);
    } else {
      const refutableCount = entry.data.refutableCount;
      if (typeof refutableCount !== 'number' || !Number.isInteger(refutableCount) || refutableCount < 0) warnings.push(`invalid refutableCount round=${round}`);
      else {
        const previous = refutations.get(round) ?? { events: 0, refutable: 0 };
        refutations.set(round, { events: previous.events + 1, refutable: previous.refutable + refutableCount });
      }
    }
  }

  const rows: DriftSignalRow[] = [];
  let cumulativeMustFixCount = 0;
  let budgetIncreaseCount = 0;
  let refuteNotSubmittedCount = 0;
  let refutableNotSubmittedCount = 0;
  for (const round of [...rounds].sort((left, right) => left - right)) {
    const review = reviews.get(round);
    if (review !== undefined) cumulativeMustFixCount += review;
    budgetIncreaseCount += budgetIncreases.get(round) ?? 0;
    const refutation = refutations.get(round);
    if (refutation) {
      refuteNotSubmittedCount += refutation.events;
      refutableNotSubmittedCount += refutation.refutable;
    }
    rows.push({ round, mustFixCount: review ?? null, cumulativeMustFixCount, budgetIncreaseCount, refuteNotSubmittedCount, refutableNotSubmittedCount });
  }

  const verdict = detectReworkDrift([...verdictReviews.values()]);
  return {
    runId,
    outcome,
    status: reviews.size ? 'measured' : 'no-review-rounds',
    rows,
    warnings,
    verdict,
    recommendation: buildReworkDriftRecommendation(verdict),
  };
}

/** Read every discoverable canonical ledger in a directory and preserve unreadable or vanished files as explicit results. */
export function scanReworkDriftSignals(directory = runLedgerDir(), dependencies: DriftSignalScanDependencies = {}): DriftSignalScan {
  const ledgerDirectory = resolve(directory);
  const list = dependencies.list ?? readdirSync;
  const load = dependencies.load ?? loadRunLedger;
  let names: string[];
  try {
    names = list(ledgerDirectory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ledgerDirectory, readableRunCount: 0, unreadableRunCount: 0, runs: [], unreadable: [] };
    throw new Error(`unable to list run ledger directory ${ledgerDirectory}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const runs: RunDriftSignals[] = [];
  const unreadable: { runId: string; error: string }[] = [];
  for (const name of names.sort()) {
    if (!name.endsWith('.jsonl')) continue;
    const runId = name.slice(0, -'.jsonl'.length);
    // ⛔ 비정규 이름을 «로더 호출 전»에 자체 거부하지 않는다 — 그러면 「이 자가 무엇을 못 읽나」가
    //   로더의 계약이 아니라 이 자의 «우회 규칙»이 되고, 검사가 그 우회를 계약으로 굳힌다(리뷰 must-fix).
    //   ⇒ 이름이 이상해도 «로더에게 물어본다». 로더가 거부하면 그 사유를 그대로 싣는다.
    try {
      const entries = load(runId, ledgerDirectory);
      if (entries === null) unreadable.push({ runId, error: 'ledger missing after discovery' });
      else runs.push(analyzeRunDriftSignals(runId, entries));
    } catch (error) {
      unreadable.push({ runId, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { ledgerDirectory, readableRunCount: runs.length, unreadableRunCount: unreadable.length, runs, unreadable };
}

/** Single-run output exposes every causal round; scan output exposes only each run's last signal and stored outcome. */
export function renderReworkDriftSignals(scan: DriftSignalScan, runId?: string): string {
  if (runId !== undefined) {
    const run = scan.runs.find((candidate) => candidate.runId === runId);
    if (run) return run.rows.length
      ? run.rows.map((row) => JSON.stringify({ runId: run.runId, outcome: run.outcome, status: run.status, verdict: run.verdict, recommendation: run.recommendation, ...row })).join('\n')
      : JSON.stringify({ runId: run.runId, outcome: run.outcome, status: run.status, verdict: run.verdict, recommendation: run.recommendation });
    const failure = scan.unreadable.find((candidate) => candidate.runId === runId);
    return JSON.stringify({ runId, status: 'unreadable', error: failure?.error ?? 'ledger not discovered' });
  }
  const runs = scan.runs.map((run) => JSON.stringify({ runId: run.runId, outcome: run.outcome, status: run.status, verdict: run.verdict, recommendation: run.recommendation, lastSignal: run.rows.at(-1) ?? null }));
  const failures = scan.unreadable.map((failure) => JSON.stringify({ runId: failure.runId, status: 'unreadable', error: failure.error }));
  return [...runs, ...failures, JSON.stringify({ type: 'summary', readableRunCount: scan.readableRunCount, unreadableRunCount: scan.unreadableRunCount })].join('\n');
}

export function runReworkDriftSignals(argv: readonly string[]): { stdout: string; exitCode: number; scan: DriftSignalScan } {
  const directoryFlag = argv.indexOf('--dir');
  const runFlag = argv.indexOf('--run');
  if (directoryFlag !== -1 && !argv[directoryFlag + 1]) throw new Error('--dir requires a path');
  if (runFlag !== -1 && !argv[runFlag + 1]) throw new Error('--run requires a runId');
  const runId = runFlag === -1 ? undefined : argv[runFlag + 1]!;
  if (runId !== undefined && normalizeRunId(runId) !== runId) throw new Error(`invalid runId: ${runId}`);
  const scan = scanReworkDriftSignals(directoryFlag === -1 ? undefined : argv[directoryFlag + 1]);
  // ⛔ 종료 코드는 «이 호출이 물은 것»을 답해야 한다(리뷰 must-fix).
  //   --run 은 「그 런 하나」를 물었으므로 다른 원장이 깨진 것으로 1 을 내면 안 되고,
  //   그 런을 «못 읽었으면» 0 을 내면 안 된다. 전체 모드일 때만 전체 실패 수가 종료 코드를 정한다.
  const exitCode = runId === undefined
    ? (scan.unreadableRunCount > 0 ? 1 : 0)
    : (scan.runs.some((run) => run.runId === runId) ? 0 : 1);
  return { stdout: renderReworkDriftSignals(scan, runId), exitCode, scan };
}

if (import.meta.main) {
  const result = runReworkDriftSignals(process.argv.slice(2));
  console.log(result.stdout);
  if (result.exitCode !== 0) process.exit(result.exitCode);
}
