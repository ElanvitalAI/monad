/**
 * I10 (2026-05-12) — Phase 1 dogfood metrics writer.
 *
 * Every `/v1/intake/pipeline-preview` and `/v1/intake/pipeline-commit`
 * call appends one row to `~/.monad/intake/pipeline-runs.jsonl`. The
 * payload captures everything the I10 dogfood gate (RESEARCH §11.3 ·
 * 90% auto decomposition · 2분 안) needs to measure without bouncing
 * back through the LLM:
 *
 *   - identity   : intakeId · kind (preview/commit) · timestamp
 *   - toggles    : useRealLlm · useRealEnrich · refined (hint set)
 *   - per phase  : fallback flags · counts · durations
 *   - register   : commit result summary (when applicable)
 *
 * The file is the source-of-truth for the dogfood retrospective —
 * users (or a follow-up PWA dashboard) read it raw or via the GET
 * `/v1/intake/runs` endpoint that ships alongside this module.
 *
 * Path resolution mirrors `task-orchestrator/paths.ts`:
 *   1. env `MONAD_INTAKE_DIR` (absolute · CI / test override)
 *   2. `<homedir>/.monad/intake`
 *
 * Test seam: `recordPipelineRun()` takes optional `fs`/`now` deps so
 * unit tests can run without touching the user's home.
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
} from 'node:fs';
import { monadStateRoot } from '../autopilot/state-paths.js';
import { join } from 'node:path';

// ──────────────────── Path resolution ───────────────────────────────

/** Intake dir override env. Tests + CI flip this to a tmpdir. */
const INTAKE_DIR_ENV = 'MONAD_INTAKE_DIR';
const RUNS_FILE = 'pipeline-runs.jsonl';

export function intakeDir(): string {
  const env = process.env[INTAKE_DIR_ENV];
  if (env && env.length > 0) return env;
  return join(monadStateRoot(), 'intake');
}

export function pipelineRunsPath(): string {
  return join(intakeDir(), RUNS_FILE);
}

// ──────────────────── Record schema ─────────────────────────────────

export interface PipelineRunRecord {
  /** ISO timestamp (millisecond precision). */
  at: string;
  intakeId: string;
  /** Which endpoint emitted this row. */
  kind: 'preview' | 'commit';
  /** Body toggle state — captures whether real LLM / real enrich
   *  fired. Useful for splitting metrics by mode in the retro. */
  useRealLlm: boolean;
  useRealEnrich: boolean;
  /** FU-I7e — was a refinement hint applied this run. */
  refined: boolean;
  /** Wall-clock duration from request body parse to response shape. */
  durationMs: number;
  decomposition: {
    fallback: boolean;
    missionCount: number;
    taskCount: number;
  };
  enrichment: {
    diagnosticOnly: number;
    withSummary: number;
  };
  categorize: {
    fallback: boolean;
    workflowEligible: number;
    total: number;
  };
  align: {
    fallback: boolean;
    priorities: { high: number; medium: number; low: number };
    dependencyCount: number;
  };
  synth: {
    ok: number;
    skeleton: number;
    failed: number;
    skipped: number;
  };
  /** Commit-only — preview rows omit this. */
  register?: {
    missionCount: number;
    taskCount: number;
    workflowCount: number;
    errorCount: number;
    skippedTaskCount: number;
  };
}

// ──────────────────── Writer ────────────────────────────────────────

export interface RecordRunDeps {
  /** Test seam — overrides `appendFileSync` so unit tests don't write
   *  to disk. Defaults to the real fs. */
  appendLine?: (path: string, line: string) => void;
  /** Test seam — overrides `intakeDir()` to point at a tmpdir.
   *  Defaults to the env-aware resolver. */
  resolveDir?: () => string;
}

/** Append one JSONL row to the runs log. Fire-and-forget — surfacing
 *  the write to the endpoint response would slow the user without
 *  buying anything. Failures are swallowed (the dogfood log is best-
 *  effort, never load-bearing). */
export function recordPipelineRun(
  record: PipelineRunRecord,
  deps: RecordRunDeps = {},
): void {
  try {
    const dir = (deps.resolveDir ?? intakeDir)();
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const path = join(dir, RUNS_FILE);
    const line = JSON.stringify(record) + '\n';
    if (deps.appendLine) deps.appendLine(path, line);
    else appendFileSync(path, line, 'utf8');
  } catch {
    // Swallow — metrics emission is best-effort.
  }
}

// ──────────────────── Reader + aggregates ───────────────────────────

export interface PipelineRunAggregates {
  total: number;
  fallbackRate: {
    decompose: number;
    categorize: number;
    align: number;
  };
  realLlmRate: number;
  realEnrichRate: number;
  refineRate: number;
  avgDurationMs: number;
  byKind: { preview: number; commit: number };
}

const EMPTY_AGGREGATES: PipelineRunAggregates = {
  total: 0,
  fallbackRate: { decompose: 0, categorize: 0, align: 0 },
  realLlmRate: 0,
  realEnrichRate: 0,
  refineRate: 0,
  avgDurationMs: 0,
  byKind: { preview: 0, commit: 0 },
};

/** Parse one JSONL line into a PipelineRunRecord. Returns null when
 *  the line is malformed (corrupted by partial writes / older schema)
 *  so the reader can skip without aborting the whole stream. */
export function parsePipelineRunLine(line: string): PipelineRunRecord | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const obj = JSON.parse(trimmed) as PipelineRunRecord;
    if (!obj || typeof obj.intakeId !== 'string' || typeof obj.at !== 'string') {
      return null;
    }
    if (obj.kind !== 'preview' && obj.kind !== 'commit') return null;
    return obj;
  } catch {
    return null;
  }
}

export function aggregatePipelineRuns(
  rows: readonly PipelineRunRecord[],
): PipelineRunAggregates {
  if (rows.length === 0) return EMPTY_AGGREGATES;
  let decFallback = 0;
  let catFallback = 0;
  let alignFallback = 0;
  let realLlm = 0;
  let realEnrich = 0;
  let refined = 0;
  let durationSum = 0;
  const byKind = { preview: 0, commit: 0 };
  for (const r of rows) {
    if (r.decomposition.fallback) decFallback += 1;
    if (r.categorize.fallback) catFallback += 1;
    if (r.align.fallback) alignFallback += 1;
    if (r.useRealLlm) realLlm += 1;
    if (r.useRealEnrich) realEnrich += 1;
    if (r.refined) refined += 1;
    durationSum += r.durationMs;
    byKind[r.kind] += 1;
  }
  const n = rows.length;
  return {
    total: n,
    fallbackRate: {
      decompose: decFallback / n,
      categorize: catFallback / n,
      align: alignFallback / n,
    },
    realLlmRate: realLlm / n,
    realEnrichRate: realEnrich / n,
    refineRate: refined / n,
    avgDurationMs: Math.round(durationSum / n),
    byKind,
  };
}

export interface ListRunsDeps {
  /** Test seam — overrides `readFileSync` so unit tests can feed
   *  synthetic JSONL. */
  readFile?: (path: string) => string;
  /** Test seam — overrides the dir resolver. */
  resolveDir?: () => string;
}

export interface ListRunsResult {
  total: number;
  rows: PipelineRunRecord[];
  aggregates: PipelineRunAggregates;
}

/** Read the JSONL log + return the most recent `limit` rows along
 *  with aggregates computed across the FULL file (not just the
 *  limit slice — aggregates are dogfood-truth, the slice is just
 *  for surfacing the last N rows to the UI). */
export function listPipelineRuns(
  limit: number,
  deps: ListRunsDeps = {},
): ListRunsResult {
  const dir = (deps.resolveDir ?? intakeDir)();
  const path = join(dir, RUNS_FILE);
  let text: string;
  try {
    text = deps.readFile ? deps.readFile(path) : readFileSync(path, 'utf8');
  } catch {
    return { total: 0, rows: [], aggregates: EMPTY_AGGREGATES };
  }
  const rows: PipelineRunRecord[] = [];
  for (const line of text.split('\n')) {
    const row = parsePipelineRunLine(line);
    if (row) rows.push(row);
  }
  const cap = Math.max(1, Math.min(limit, 1000));
  const recent = rows.slice(-cap).reverse();
  return {
    total: rows.length,
    rows: recent,
    aggregates: aggregatePipelineRuns(rows),
  };
}

// Exported for tests that need to manually construct a runs file.
export { RUNS_FILE };
