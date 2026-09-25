/**
 * Acceptance evaluator — 5-kind deterministic check runner.
 *
 * Origin: 내부 문서 `PLAN-session-tox-resilience` · TOX-6.
 *
 * Called after a task's surface execution completes but before the
 * graph transitions it to `done`. allPass=true → caller should flip
 * `review → done`; allPass=false → `review → failed` so RetryPolicy
 * can take over.
 *
 * All IO (fs, subprocess) is injected via the `AcceptanceContext`
 * callables so the module stays testable with fully synchronous
 * in-memory stubs.
 */
import type { Task, TaskExecution, TaskDeterministicCheck } from './types.js';

// ─────────────────────────── Types ────────────────────────────────

/** A pseudo-check representing one `acceptance.criteria` entry going
 *  through LLM review (TOX-6 FU-2). */
export interface LlmReviewCheck {
  kind: 'llm-review';
  criterion: string;
}

/** Union used inside `CheckResult.check`. Deterministic kinds are the
 *  canonical surface; `llm-review` is synthetic (produced here, not
 *  in TaskDeterministicCheck). */
export type AcceptanceCheck = TaskDeterministicCheck | LlmReviewCheck;

export interface LlmJudgeInput {
  criterion: string;
  task: Task;
  exec: TaskExecution;
}

export interface LlmJudgeResult {
  passed: boolean;
  reason: string;
}

export interface AcceptanceIo {
  existsSync?: (p: string) => boolean;
  readFileSync?: (p: string) => string;
  /** Runs a shell command; resolves with the exit code (0 = success).
   *  Must respect `timeoutMs` — treat timeout as non-zero exit. */
  spawnZero?: (cmd: string, timeoutMs?: number) => Promise<{ exitCode: number }>;
  /** Optional LLM judge for `acceptance.criteria[]` natural-language
   *  evaluation. When omitted, criteria are skipped (no-op pass) so
   *  existing tasks aren't accidentally failed. */
  llmJudge?: (input: LlmJudgeInput) => Promise<LlmJudgeResult>;
}

export interface AcceptanceContext {
  task: Task;
  exec: TaskExecution;
  io?: AcceptanceIo;
}

export interface CheckResult {
  check: AcceptanceCheck;
  passed: boolean;
  reason: string;
}

export interface AcceptanceReport {
  allPass: boolean;
  passed: CheckResult[];
  failed: CheckResult[];
  /** Convenience — count of checks total. */
  total: number;
}

// ─────────────────────────── Public entry ─────────────────────────

export async function evaluateAcceptance(
  ctx: AcceptanceContext,
): Promise<AcceptanceReport> {
  const checks = ctx.task.acceptance?.checks ?? [];
  const criteria = ctx.task.acceptance?.criteria ?? [];
  if (checks.length === 0 && criteria.length === 0) {
    return { allPass: true, passed: [], failed: [], total: 0 };
  }
  const results: CheckResult[] = [];
  // Deterministic checks first — cheap, deterministic.
  for (const check of checks) {
    results.push(await runCheck(check, ctx));
  }
  // LLM-review criteria — only when judge is wired.
  if (criteria.length > 0 && ctx.io?.llmJudge) {
    for (const criterion of criteria) {
      results.push(await runLlmReview(criterion, ctx));
    }
  }
  const passed = results.filter((r) => r.passed);
  const failed = results.filter((r) => !r.passed);
  return {
    allPass: failed.length === 0,
    passed,
    failed,
    total: results.length,
  };
}

// ─────────────────────────── Per-kind runners ─────────────────────

async function runCheck(
  check: TaskDeterministicCheck,
  ctx: AcceptanceContext,
): Promise<CheckResult> {
  switch (check.kind) {
    case 'exit-code':
      return runExitCode(check, ctx);
    case 'file-exists':
      return runFileExists(check, ctx);
    case 'file-contains':
      return runFileContains(check, ctx);
    case 'output-matches':
      return runOutputMatches(check, ctx);
    case 'shell-zero':
      return runShellZero(check, ctx);
  }
}

function runExitCode(
  check: Extract<TaskDeterministicCheck, { kind: 'exit-code' }>,
  ctx: AcceptanceContext,
): CheckResult {
  const actual = extractExitCode(ctx.exec);
  if (actual === null) {
    return {
      check,
      passed: false,
      reason: `exit-code: no EXIT_N code in execution`,
    };
  }
  if (actual === check.expected) {
    return { check, passed: true, reason: `exit-code ${actual} == ${check.expected}` };
  }
  return { check, passed: false, reason: `exit-code ${actual} != ${check.expected}` };
}

function runFileExists(
  check: Extract<TaskDeterministicCheck, { kind: 'file-exists' }>,
  ctx: AcceptanceContext,
): CheckResult {
  const io = ctx.io?.existsSync ?? (() => false);
  if (io(check.path)) {
    return { check, passed: true, reason: `${check.path} exists` };
  }
  return { check, passed: false, reason: `${check.path} missing` };
}

function runFileContains(
  check: Extract<TaskDeterministicCheck, { kind: 'file-contains' }>,
  ctx: AcceptanceContext,
): CheckResult {
  const exists = ctx.io?.existsSync?.(check.path) ?? false;
  if (!exists) {
    return { check, passed: false, reason: `${check.path} missing` };
  }
  const read = ctx.io?.readFileSync;
  if (!read) {
    return { check, passed: false, reason: 'no readFileSync io injected' };
  }
  let text: string;
  try {
    text = read(check.path);
  } catch (err) {
    return {
      check,
      passed: false,
      reason: `read failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const re = tryRegex(check.pattern);
  const hit = re ? re.test(text) : text.includes(check.pattern);
  return hit
    ? { check, passed: true, reason: `${check.path} matches '${check.pattern}'` }
    : { check, passed: false, reason: `${check.path} lacks '${check.pattern}'` };
}

function runOutputMatches(
  check: Extract<TaskDeterministicCheck, { kind: 'output-matches' }>,
  ctx: AcceptanceContext,
): CheckResult {
  const output = ctx.exec.output ?? '';
  const re = tryRegex(check.pattern);
  const hit = re ? re.test(output) : output.includes(check.pattern);
  return hit
    ? { check, passed: true, reason: `output matches '${check.pattern}'` }
    : { check, passed: false, reason: `output lacks '${check.pattern}'` };
}

async function runShellZero(
  check: Extract<TaskDeterministicCheck, { kind: 'shell-zero' }>,
  ctx: AcceptanceContext,
): Promise<CheckResult> {
  const spawn = ctx.io?.spawnZero;
  if (!spawn) {
    return { check, passed: false, reason: 'no spawnZero io injected' };
  }
  try {
    const res = await spawn(check.command, check.timeoutMs);
    if (res.exitCode === 0) {
      return { check, passed: true, reason: `'${check.command}' → exit 0` };
    }
    return {
      check,
      passed: false,
      reason: `'${check.command}' → exit ${res.exitCode}`,
    };
  } catch (err) {
    return {
      check,
      passed: false,
      reason: `'${check.command}' threw: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function runLlmReview(
  criterion: string,
  ctx: AcceptanceContext,
): Promise<CheckResult> {
  const check: LlmReviewCheck = { kind: 'llm-review', criterion };
  const judge = ctx.io?.llmJudge;
  if (!judge) {
    return { check, passed: false, reason: 'no llmJudge io injected' };
  }
  try {
    const r = await judge({ criterion, task: ctx.task, exec: ctx.exec });
    return {
      check,
      passed: r.passed,
      reason: r.reason || (r.passed ? 'llm-review passed' : 'llm-review failed'),
    };
  } catch (err) {
    return {
      check,
      passed: false,
      reason: `llm-review threw: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ─────────────────────────── Helpers ──────────────────────────────

function extractExitCode(exec: TaskExecution): number | null {
  // Adapters encode non-zero exits as { error: {code:'EXIT_<N>', ...} }
  // and zero exits as status='completed' (no error object).
  if (exec.status === 'completed' && !exec.error) return 0;
  const code = exec.error?.code ?? '';
  const m = code.match(/^EXIT_(-?\d+)$/);
  if (m) {
    const n = Number.parseInt(m[1]!, 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function tryRegex(pattern: string): RegExp | null {
  // A pattern with regex metachars gets the full regex treatment; plain
  // strings fall through to .includes() — matches PLAN expectation that
  // authors can write "foo" without escaping, but can also anchor with
  // ^Error:.* when they want real regex.
  if (!/[.*+?^${}()|[\]\\]/.test(pattern)) return null;
  try {
    return new RegExp(pattern);
  } catch {
    return null;
  }
}
