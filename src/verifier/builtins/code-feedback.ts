// Arc G — `code-feedback` builtin verifier.
//
// Post-Edit/Write hook: spawns `bunx tsc --noEmit`, counts `error TS`
// occurrences, and compares against `HARNESS_TSC_BASELINE` (default 44).
// Regression → warn issue. Same baseline / decrease → ok. Timeout →
// info issue (streak 0 · LLM not blocked).
//
// **Default disabled** — opt in via `HARNESS_CODE_FEEDBACK_ENABLED=1`.
// Disabled state returns ok immediately so the dispatch path stays
// fast even when Edit/Write declares this verifier in its catalog
// entry. PLAN R1 (latency mitigation): tsc can take 30s, so the
// safe default is off until the operator explicitly opts in.
//
// Arc G follow-up (PLAN 내부 문서 `PLAN-harness-arc-g-follow-up`):
//   • Debounce — consecutive calls within DEBOUNCE_MS on the same cwd
//     skip the tsc spawn and emit a single `code-feedback.debounced`
//     info. Protects against edit-burst multiplication.
//   • Test heuristic — after tsc passes, derive related test paths and
//     spawn `bun test <matched>` so same-turn regressions surface.
//   • Background on timeout — instead of killing a slow tsc, stash the
//     Promise; the next invocation picks up its result (or reports
//     that it's still running) so the 30s wall doesn't waste CPU.
//
// PLAN: 내부 문서 `PLAN-harness-arc-g-code-feedback`

import { spawn } from 'child_process';
import type { VerifierBuiltin, VerifierIssue, VerifierReport } from '../types.js';
import { tscEnv } from '../../typecheck-ratchet.js';
import { deriveTestPaths, runRelatedTests } from './test-heuristic.js';

const TSC_ERROR_PATTERN = /error TS\d+:/g;
/** tsc exits 0 (clean), 1 (diagnostics), or 2 (config/usage). Anything else is not a measurement. */
const MEASURABLE_EXIT_CODES = new Set([0, 1, 2]);
const HEAP_OOM_TEXT = 'heap out of memory';

export type TscCloseGrade = 'measurable' | 'unmeasured';

export interface TscCloseClassification {
  grade: TscCloseGrade;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

/**
 * Pure close classifier. Unmeasured when the process was killed by a signal,
 * the exit code is not 0/1/2, or the combined output contains V8
 * `heap out of memory`. Exit 0 with no `error TS` lines, and exits 1 or 2
 * that have `error TS` lines, stay measurable so baseline comparison is unchanged.
 */
export function classifyTscClose(
  exitCode: number | null,
  signal: NodeJS.Signals | null,
  output: string,
): TscCloseClassification {
  const signalDeath = signal != null;
  const badCode = !MEASURABLE_EXIT_CODES.has(exitCode ?? -1);
  const heapOom = output.includes(HEAP_OOM_TEXT);
  const grade: TscCloseGrade = signalDeath || badCode || heapOom ? 'unmeasured' : 'measurable';
  return { grade, exitCode, signal };
}

interface TscRunResult {
  errorCount: number;
  sampleErrors: string[];
  /** When set, the run timed out before producing output. */
  timedOut: boolean;
  /** When set, spawn / process I/O failed before tsc could complete. */
  spawnError?: string;
  /** Set when close was not a measurable tsc finish (signal / bad code / heap OOM). */
  unmeasured?: { exitCode: number | null; signal: NodeJS.Signals | null };
}

/** Minimal child the spawn seam must return. Tests pass a fake EventEmitter. */
export interface TscSpawnChild {
  stdout?: { on(event: 'data', cb: (chunk: Buffer | string) => void): unknown } | null;
  stderr?: { on(event: 'data', cb: (chunk: Buffer | string) => void): unknown } | null;
  on(event: 'error', cb: (err: Error) => void): unknown;
  on(event: 'close', cb: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  kill(signal?: NodeJS.Signals | number): boolean;
}

export type TscSpawner = (
  command: string,
  args: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; stdio: ['ignore', 'pipe', 'pipe'] },
) => TscSpawnChild;

let tscSpawner: TscSpawner = (command, args, options) =>
  spawn(command, args as string[], options) as unknown as TscSpawnChild;

interface DebounceRecord {
  lastRunAt: number;
}

interface InFlightRun {
  startedAt: number;
  cwd: string;
  promise: Promise<TscRunResult>;
  child: TscSpawnChild;
  /** Set once the result has been delivered to an LLM turn so the
   *  same completed run doesn't get re-reported. */
  reported: boolean;
  /** Watchdog timer id — cleared when the run ends or is reported. */
  watchdog: ReturnType<typeof setTimeout> | null;
}

const debounceByCwd = new Map<string, DebounceRecord>();
const inFlightByCwd = new Map<string, InFlightRun>();

export const codeFeedbackBuiltin: VerifierBuiltin = async (
  args,
  _result,
  spec,
) => {
  if (spec.kind !== 'code-feedback') {
    return { ok: true, issues: [] };
  }
  if (process.env['HARNESS_CODE_FEEDBACK_ENABLED'] !== '1') {
    // Default disabled — skip silently. No latency, no LLM noise.
    return { ok: true, issues: [] };
  }

  const cwd = process.cwd();
  const now = Date.now();
  const baseline = parseBaseline();
  const tscTimeoutMs = parseTimeout();
  const debounceMs = parseDebounce();
  const bgEnabled = parseBgEnabled();
  const bgMaxMs = parseBgMax();

  // ─── Background in-flight pickup ─────────────────────────────
  // If a previous timeout detached a tsc run, check whether it has
  // settled. If yes, deliver that result now. If still running, skip.
  if (bgEnabled) {
    const existing = inFlightByCwd.get(cwd);
    if (existing && !existing.reported) {
      const settled = await peekSettled(existing.promise);
      if (settled) {
        existing.reported = true;
        if (existing.watchdog) clearTimeout(existing.watchdog);
        inFlightByCwd.delete(cwd);
        debounceByCwd.set(cwd, { lastRunAt: now });
        return finalReport(settled, baseline, args, cwd, bgEnabled, true);
      }
      return mkReport([{
        code: 'code-feedback.bg-still-running',
        severity: 'info',
        message: `background tsc from ${Math.round((now - existing.startedAt) / 1000)}s ago still running`,
        hint: 'Wait for it to finish, or raise HARNESS_CODE_FEEDBACK_BG_MAX_MS if your project legitimately needs longer runs.',
      }]);
    }
  }

  // ─── Debounce ────────────────────────────────────────────────
  const record = debounceByCwd.get(cwd);
  if (record && now - record.lastRunAt < debounceMs) {
    const elapsed = Math.round((now - record.lastRunAt) / 100) / 10; // 0.1s precision
    return mkReport([{
      code: 'code-feedback.debounced',
      severity: 'info',
      message: `skipped — last tsc ran ${elapsed}s ago (< ${debounceMs}ms debounce window)`,
      hint: 'The previous result still reflects the current state; another edit will re-trigger tsc after the debounce window clears.',
    }]);
  }

  // ─── Fresh tsc run ───────────────────────────────────────────
  debounceByCwd.set(cwd, { lastRunAt: now });
  const tscResult = await runTsc(cwd, tscTimeoutMs, bgEnabled, bgMaxMs);
  return finalReport(tscResult, baseline, args, cwd, bgEnabled, false);
};

// ─── env parsing ──────────────────────────────────────────────

function parseIntEnv(name: string, def: number, min = 0): number {
  const raw = process.env[name];
  if (!raw) return def;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= min ? n : def;
}

function parseBaseline(): number { return parseIntEnv('HARNESS_TSC_BASELINE', 44); }
function parseTimeout(): number { return parseIntEnv('HARNESS_CODE_FEEDBACK_TSC_TIMEOUT_MS', 30_000, 1); }
function parseDebounce(): number { return parseIntEnv('HARNESS_CODE_FEEDBACK_DEBOUNCE_MS', 2_000); }
function parseTestTimeout(): number { return parseIntEnv('HARNESS_CODE_FEEDBACK_TEST_TIMEOUT_MS', 60_000, 1); }
function parseBgMax(): number { return parseIntEnv('HARNESS_CODE_FEEDBACK_BG_MAX_MS', 300_000, 1); }

function parseBgEnabled(): boolean {
  const raw = process.env['HARNESS_CODE_FEEDBACK_BG_ENABLED'];
  return raw === undefined ? true : raw === '1';
}

function parseTestEnabled(): boolean {
  const raw = process.env['HARNESS_CODE_FEEDBACK_TEST_ENABLED'];
  return raw === undefined ? true : raw === '1';
}

// ─── tsc spawn with detach-on-timeout ─────────────────────────

async function runTsc(
  cwd: string,
  timeoutMs: number,
  bgEnabled: boolean,
  bgMaxMs: number,
): Promise<TscRunResult> {
  let resolveP!: (v: TscRunResult) => void;
  const promise = new Promise<TscRunResult>(r => { resolveP = r; });

  const child = tscSpawner('bunx', ['tsc', '--noEmit'], {
    cwd,
    env: tscEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const chunks: Buffer[] = [];
  const pushChunk = (c: Buffer | string) => {
    chunks.push(typeof c === 'string' ? Buffer.from(c) : c);
  };
  child.stdout?.on('data', pushChunk);
  child.stderr?.on('data', pushChunk);

  let timedOutSynchronously = false;
  let settledAlready = false;

  const settle = (v: TscRunResult) => {
    if (settledAlready) return;
    settledAlready = true;
    resolveP(v);
  };

  const timer = setTimeout(() => {
    // Background-on-timeout: detach (don't kill) when bgEnabled, so a
    // later invocation can pick up the result. The watchdog still
    // reaps the process after BG_MAX_MS to avoid orphan leaks.
    if (bgEnabled) {
      timedOutSynchronously = true;
      const extraBudget = Math.max(0, bgMaxMs - timeoutMs);
      const watchdog = setTimeout(() => {
        try { child.kill('SIGTERM'); } catch { /* ignore */ }
        inFlightByCwd.delete(cwd);
      }, extraBudget);
      const inflight: InFlightRun = {
        startedAt: Date.now() - timeoutMs,
        cwd,
        promise,
        child,
        reported: false,
        watchdog,
      };
      inFlightByCwd.set(cwd, inflight);
      settle({ errorCount: 0, sampleErrors: [], timedOut: true });
      return;
    }
    // bg disabled — original kill behaviour.
    try { child.kill('SIGTERM'); } catch { /* ignore */ }
    settle({ errorCount: 0, sampleErrors: [], timedOut: true });
  }, timeoutMs);

  child.on('error', (err) => {
    clearTimeout(timer);
    settle({
      errorCount: 0,
      sampleErrors: [],
      timedOut: false,
      spawnError: err.message,
    });
  });

  child.on('close', (code, signal) => {
    clearTimeout(timer);
    const out = Buffer.concat(chunks).toString('utf8');
    const classified = classifyTscClose(code, signal, out);
    const matches = out.match(TSC_ERROR_PATTERN);
    const errorCount = matches?.length ?? 0;
    const sampleErrors = out
      .split('\n')
      .filter(line => /error TS\d+:/.test(line))
      .slice(0, 5);
    const result: TscRunResult = classified.grade === 'unmeasured'
      ? {
          errorCount,
          sampleErrors,
          timedOut: false,
          unmeasured: { exitCode: classified.exitCode, signal: classified.signal },
        }
      : { errorCount, sampleErrors, timedOut: false };
    // If the caller already synthesised a timedOut response, keep the
    // detached Promise alive so the background-pickup path can deliver
    // the real result later.
    if (timedOutSynchronously) {
      // Patch the stashed Promise: chain so the next pickup gets this.
      // Resolve a fresh Promise via inFlight update.
      const existing = inFlightByCwd.get(cwd);
      if (existing && !existing.reported) {
        existing.promise = Promise.resolve(result);
      }
      return;
    }
    settle(result);
  });

  return promise;
}

/** Returns the resolved value if `p` is already settled, else null.
 *  Uses a race against `Promise.resolve(null)` — doesn't consume the
 *  Promise. A micro-task flush (`setImmediate`) may be required when
 *  the Promise is technically settled but queued — callers that care
 *  about that precision can await before calling. */
async function peekSettled<T>(p: Promise<T>): Promise<T | null> {
  // Let any settled micro-tasks drain before we race.
  await new Promise<void>(r => setImmediate(r));
  return Promise.race<T | null>([p, Promise.resolve(null)]);
}

// ─── post-tsc report shaping (incl. test heuristic) ───────────

async function finalReport(
  run: TscRunResult,
  baseline: number,
  args: Record<string, unknown>,
  cwd: string,
  bgEnabled: boolean,
  isBackgroundPickup: boolean,
): Promise<VerifierReport> {
  if (run.spawnError) {
    return mkReport([{
      code: 'code-feedback.spawn-error',
      severity: 'info',
      message: `tsc spawn failed: ${run.spawnError}`,
      hint: 'Ensure bunx + tsc are installed; falling back to no verification this turn.',
    }]);
  }
  if (run.unmeasured) {
    const codeText = run.unmeasured.exitCode === null ? 'null' : String(run.unmeasured.exitCode);
    const signalText = run.unmeasured.signal ?? 'none';
    // Same grade as spawnError/timedOut (info — not a type error) but never
    // ok/clean: zero `error TS` lines from a dead process are not a measurement.
    return {
      ok: false,
      issues: [{
        code: 'code-feedback.tsc-unmeasured',
        severity: 'info',
        message: `tsc did not finish measurably (exit ${codeText}, signal ${signalText}) — verification skipped this turn.`,
        hint: 'A signal death, an exit other than 0/1/2, or a V8 heap-out-of-memory crash is not a clean typecheck. Re-run tsc; do not treat zero error TS lines as clean.',
      }],
    };
  }
  if (run.timedOut) {
    if (bgEnabled && !isBackgroundPickup) {
      return mkReport([{
        code: 'code-feedback.tsc-detached',
        severity: 'info',
        message: `tsc exceeded HARNESS_CODE_FEEDBACK_TSC_TIMEOUT_MS — detached to background.`,
        hint: 'The next Edit/Write will pick up the result; no manual action needed unless HARNESS_CODE_FEEDBACK_BG_MAX_MS is also hit.',
      }]);
    }
    return mkReport([{
      code: 'code-feedback.tsc-timeout',
      severity: 'info',
      message: `tsc --noEmit exceeded HARNESS_CODE_FEEDBACK_TSC_TIMEOUT_MS — verification skipped this turn.`,
      hint: 'Re-run tsc manually to confirm baseline; consider raising the timeout if your project legitimately needs more.',
    }]);
  }
  if (run.errorCount > baseline) {
    const diff = run.errorCount - baseline;
    return mkReport([{
      code: 'code-feedback.tsc-regression',
      severity: 'warn',
      message: `tsc error count rose to ${run.errorCount} (+${diff} over baseline ${baseline}).`,
      hint: 'Inspect the sample errors below and fix or roll back the change. Set HARNESS_TSC_BASELINE to the new baseline if the increase is intentional.',
      path: run.sampleErrors,
    }]);
  }

  // tsc clean → optional related-test spawn.
  if (!parseTestEnabled()) {
    return { ok: true, issues: [] };
  }

  const filePath = typeof args.file_path === 'string' ? (args.file_path as string) : '';
  const testPaths = deriveTestPaths(filePath, cwd);
  if (testPaths.length === 0) {
    return { ok: true, issues: [] };
  }

  const testRun = await runRelatedTests(testPaths, cwd, parseTestTimeout());
  if (testRun.spawnError) {
    return mkReport([{
      code: 'code-feedback.test-spawn-error',
      severity: 'info',
      message: `bun test spawn failed: ${testRun.spawnError}`,
      hint: 'Verify `bun test` works locally; test heuristic will stay skipped until it does.',
    }]);
  }
  if (testRun.timedOut) {
    return mkReport([{
      code: 'code-feedback.test-timeout',
      severity: 'info',
      message: `bun test exceeded HARNESS_CODE_FEEDBACK_TEST_TIMEOUT_MS for ${testPaths.join(', ')}.`,
      hint: 'Run the matching tests manually, or raise HARNESS_CODE_FEEDBACK_TEST_TIMEOUT_MS.',
    }]);
  }
  if (testRun.failureCount > 0) {
    return mkReport([{
      code: 'code-feedback.test-failure',
      severity: 'warn',
      message: `bun test ${testPaths.join(' ')} — ${testRun.failureCount} failing test(s).`,
      hint: 'Inspect the sample failures below and fix before the next Edit so the error surface stays shallow.',
      path: testRun.sampleFailures,
    }]);
  }

  return { ok: true, issues: [] };
}

function mkReport(issues: VerifierIssue[]): VerifierReport {
  const consequential = issues.filter(i => i.severity !== 'info');
  return { ok: consequential.length === 0, issues };
}

// ─── test seam ────────────────────────────────────────────────

/** Reset module-level debounce + inFlight state. Kills any detached
 *  tsc child to avoid leaks between test runs. */
export function __resetCodeFeedbackStateForTests(): void {
  for (const run of inFlightByCwd.values()) {
    if (run.watchdog) clearTimeout(run.watchdog);
    try { run.child.kill('SIGTERM'); } catch { /* ignore */ }
  }
  debounceByCwd.clear();
  inFlightByCwd.clear();
  tscSpawner = (command, args, options) =>
    spawn(command, args as string[], options) as unknown as TscSpawnChild;
}

/** Test seam — inject the process that `runTsc` (called by `codeFeedbackBuiltin`) spawns.
 *  Default remains `node:child_process` spawn. Do not mock the module. */
export function __setTscSpawnerForTests(spawner: TscSpawner | null): void {
  tscSpawner = spawner ?? ((command, args, options) =>
    spawn(command, args as string[], options) as unknown as TscSpawnChild);
}

/** Test seam — seed an inFlight entry. Used to exercise the
 *  background-pickup path without spawning a real process. */
export function __seedInFlightForTests(cwd: string, run: {
  startedAt: number;
  promise: Promise<TscRunResult>;
  child?: TscSpawnChild;
}): void {
  inFlightByCwd.set(cwd, {
    startedAt: run.startedAt,
    cwd,
    promise: run.promise,
    child: run.child ?? ({ kill: () => true } as unknown as TscSpawnChild),
    reported: false,
    watchdog: null,
  });
}

/** Test seam — inspect current module state. */
export function __inspectCodeFeedbackStateForTests(): {
  debounceKeys: string[];
  inFlightKeys: string[];
} {
  return {
    debounceKeys: [...debounceByCwd.keys()],
    inFlightKeys: [...inFlightByCwd.keys()],
  };
}
