// Goal registry — Plan-Mode UX P1.1.
//
// Single source of truth for the *current* goal (monad keeps at most one
// active goal per session — multiplexing is a P3+ follow-up). Exposes a
// tiny pub/sub so UI consumers (status pill, toast) can react to status
// transitions without the loop knowing about UI shape.
//
// Invariants (D2 in PLAN doc):
//   - Only one goal in the registry at a time. `start()` rejects if
//     another goal is active (use `clear()` first).
//   - State transitions are always emitted via setStatus() — direct
//     `state.status = …` mutations are forbidden because they skip
//     the listener fanout.
//   - History (completed goals) is *not* held here — KGS persistence
//     (P2.3) writes to `src/state/goals.ts`. This module is in-memory
//     only.

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { monadStateRoot } from '../autopilot/state-paths.js';
import { debug } from '../debug/log.js';
import { appendRunLedgerEntry, type RunLedgerWriter } from '../self-implement/run-ledger.js';
import {
  DEFAULT_GOAL_BUDGET,
  type Goal,
  type GoalBudget,
  type GoalCreateInput,
  type GoalBudgetDiagnostics,
  type GoalError,
  type GoalStatus,
} from './types.js';

let current: Goal | null = null;

let writeGoalTransitionLedger: RunLedgerWriter = appendRunLedgerEntry;

type Listener = (goal: Goal | null, prev: Goal | null) => void;
const listeners = new Set<Listener>();

function snapshotPath(): string {
  return join(monadStateRoot(), 'goals', 'current-goal.json');
}

function persistSnapshot(goal: Goal | null): void {
  const path = snapshotPath();
  try {
    if (!goal) { rmSync(path, { force: true }); return; }
    mkdirSync(dirname(path), { recursive: true });
    const temporary = `${path}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(goal), 'utf8');
    renameSync(temporary, path);
  } catch (error) {
    debug.log('goal', 'snapshot.write-failed', { error: String(error) }, { level: 'warn' });
  }
}

function isGoalSnapshot(value: unknown): value is Goal {
  if (!value || typeof value !== 'object') return false;
  const goal = value as Partial<Goal>;
  return typeof goal.id === 'string' && typeof goal.objective === 'string'
    && (goal.mode === 'judge' || goal.mode === 'spec')
    && ['active', 'paused', 'resume_required', 'budget-limited', 'complete'].includes(String(goal.status))
    && typeof goal.createdAt === 'number' && typeof goal.updatedAt === 'number'
    && !!goal.budget && !!goal.usage;
}

/** Hydrate the persisted goal exactly once after a process/session restart. */
export function hydrateGoalFromSnapshot(): Goal | null {
  if (current) return getCurrentGoal();
  const path = snapshotPath();
  try {
    if (!existsSync(path)) return null;
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (!isGoalSnapshot(parsed) || parsed.status === 'complete') {
      persistSnapshot(null);
      return null;
    }
    current = parsed;
    debug.log('goal', 'snapshot.hydrated', { id: current.id, status: current.status });
    notify(current, null);
    return getCurrentGoal();
  } catch (error) {
    debug.log('goal', 'snapshot.read-failed', { error: String(error) }, { level: 'warn' });
    return null;
  }
}

function notify(next: Goal | null, prev: Goal | null): void {
  for (const fn of listeners) {
    try { fn(next, prev); } catch { /* never break caller */ }
  }
}

/** Generate a short ULID-ish id — same shape as plan-mode session id
 *  (timestamp + 6 random chars). Not crypto-grade; just enough for
 *  one-per-session human-readable identity. */
export function generateGoalId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `g-${ts}-${rand}`;
}

export function getCurrentGoal(): Goal | null {
  if (!current) return null;
  // Refresh elapsed ms on read so callers don't see stale values.
  return {
    ...current,
    usage: { ...current.usage, elapsedMs: Date.now() - current.createdAt },
  };
}

export function isGoalActive(): boolean {
  return current !== null && current.status === 'active';
}

/**
 * Accept a user follow-up for a paused/interrupted goal.  The correction is
 * durably recorded in the status-transition ledger before the next turn is
 * driven, so an interrupted explanation cannot silently end the goal.
 */
export function requireGoalResumeFromFollowUp(followUp: string): { ok: true; goal: Goal } | { ok: false; error: GoalError } {
  if (!current) return { ok: false, error: { code: 'GoalNotFound', message: 'No active goal.' } };
  if (current.status !== 'paused' && current.status !== 'resume_required') {
    return { ok: false, error: { code: 'GoalNotActive', message: `Goal ${current.id} is not paused.`, activeId: current.id } };
  }
  const normalized = followUp.trim();
  if (!normalized) return { ok: false, error: { code: 'InvalidGoal', message: 'Follow-up must not be empty.' } };
  const pending = setStatus('resume_required', `user-follow-up: ${normalized}`);
  if (!pending.ok) return pending;
  return setStatus('active', 'follow-up-dispatch');
}

export function startGoal(input: GoalCreateInput): { ok: true; goal: Goal } | { ok: false; error: GoalError } {
  if (current && (current.status === 'active' || current.status === 'paused')) {
    return {
      ok: false,
      error: {
        code: 'GoalAlreadyActive',
        message: `Goal already exists (id=${current.id}, status=${current.status}). Use /goal clear first.`,
        activeId: current.id,
      },
    };
  }

  const budget: GoalBudget = {
    ...DEFAULT_GOAL_BUDGET,
    ...(input.budget ?? {}),
  };

  const now = Date.now();
  const goal: Goal = {
    id: generateGoalId(),
    objective: input.objective,
    mode: input.mode ?? 'judge',
    status: 'active',
    createdAt: now,
    updatedAt: now,
    budget,
    usage: { turnsUsed: 0, tokensUsed: 0, tokensMeasured: true, elapsedMs: 0 },
    linkedTaskId: input.linkedTaskId,
  };

  const prev = current;
  current = goal;
  debug.log('goal', 'start', { id: goal.id, mode: goal.mode, budget });
  persistSnapshot(goal);
  notify(goal, prev);
  return { ok: true, goal };
}

export function setStatus(next: GoalStatus, reason?: string): { ok: true; goal: Goal } | { ok: false; error: GoalError } {
  if (!current) {
    return { ok: false, error: { code: 'GoalNotFound', message: 'No active goal.' } };
  }
  const prev = { ...current };
  current = { ...current, status: next, updatedAt: Date.now() };
  debug.log('goal', 'status', { id: current.id, from: prev.status, to: next, reason: reason ?? '' });
  try {
    writeGoalTransitionLedger({
      timestamp: new Date().toISOString(),
      runId: current.id,
      goalId: current.id,
      event: 'goal-status',
      data: {
        producer: 'goal-loop',
        runIdSource: 'goal-self',
        from: prev.status,
        to: next,
        reason: reason ?? '',
      },
    });
  } catch (error) {
    debug.log('goal', 'status-ledger', {
      id: current.id,
      outcome: 'write-failed',
      error: String((error as { message?: unknown })?.message ?? error),
    }, { level: 'warn' });
  }
  persistSnapshot(current);
  notify(current, prev);
  return { ok: true, goal: current };
}

export function recordTurn(opts: { tokens?: number; verdict?: Goal['lastVerdict']; summary?: string }): void {
  if (!current) return;
  const prev = { ...current };
  current = {
    ...current,
    usage: {
      turnsUsed: current.usage.turnsUsed + 1,
      tokensUsed: current.usage.tokensUsed + (opts.tokens ?? 0),
      tokensMeasured: current.usage.tokensMeasured && opts.tokens !== undefined,
      elapsedMs: Date.now() - current.createdAt,
    },
    lastVerdict: opts.verdict ?? current.lastVerdict,
    lastSummary: opts.summary ?? current.lastSummary,
    updatedAt: Date.now(),
  };
  debug.log('goal', 'turn', {
    id: current.id,
    turnsUsed: current.usage.turnsUsed,
    verdict: opts.verdict ?? null,
  });
  persistSnapshot(current);
  notify(current, prev);
}

/** Update the judge verdict/summary on the active goal without
 *  bumping turnsUsed. The loop calls recordTurn() once per cycle
 *  for budget accounting, then this to layer in the judge result.
 *  Tolerates no-goal. */
export function setLastVerdict(verdict: Goal['lastVerdict'], summary: string): void {
  if (!current) return;
  const prev = { ...current };
  current = {
    ...current,
    lastVerdict: verdict ?? current.lastVerdict,
    lastSummary: summary,
    updatedAt: Date.now(),
  };
  notify(current, prev);
}

const NO_GOAL_BUDGET_DIAGNOSTICS: GoalBudgetDiagnostics = {
  isOverBudget: false,
  exceededAxes: [],
  tokenMeasurement: 'unmeasured',
};

/** Evaluates one goal snapshot at one caller-provided instant without reading registry state. */
export function evaluateGoalBudget(goal: Goal, now: number): GoalBudgetDiagnostics {
  const { turnsUsed, tokensUsed, elapsedMs, tokensMeasured } = goal.usage;
  const { maxTurns, tokenBudget, wallClockMaxMs } = goal.budget;
  const elapsedWallClockMs = Math.max(elapsedMs, now - goal.createdAt);
  const exceededAxes = [
    ...(turnsUsed >= maxTurns ? [{ axis: 'maxTurns' as const, used: turnsUsed, limit: maxTurns }] : []),
    ...(tokenBudget > 0 && tokensUsed >= tokenBudget
      ? [{ axis: 'tokenBudget' as const, used: tokensUsed, limit: tokenBudget }]
      : []),
    ...(elapsedWallClockMs >= wallClockMaxMs
      ? [{ axis: 'wallClockMaxMs' as const, used: elapsedWallClockMs, limit: wallClockMaxMs }]
      : []),
  ];

  return {
    isOverBudget: exceededAxes.length > 0,
    exceededAxes,
    tokenMeasurement: tokensMeasured ? 'measured' : 'unmeasured',
  };
}

/** Stateful compatibility adapter for slash and status consumers. */
export function evaluateBudget(): GoalBudgetDiagnostics {
  const goal = current;
  if (!goal) return NO_GOAL_BUDGET_DIAGNOSTICS;
  return evaluateGoalBudget(goal, Date.now());
}

export function isOverBudget(): boolean {
  return evaluateBudget().isOverBudget;
}

export function clearGoal(): Goal | null {
  if (!current) return null;
  const prev = current;
  current = null;
  persistSnapshot(null);
  debug.log('goal', 'clear', { id: prev.id, finalStatus: prev.status });
  notify(null, prev);
  return prev;
}

export function setBudget(partial: Partial<GoalBudget>): { ok: true; goal: Goal } | { ok: false; error: GoalError } {
  if (!current) {
    return { ok: false, error: { code: 'GoalNotFound', message: 'No active goal.' } };
  }
  const prev = { ...current };
  current = { ...current, budget: { ...current.budget, ...partial }, updatedAt: Date.now() };
  debug.log('goal', 'budget', { id: current.id, budget: current.budget });
  persistSnapshot(current);
  notify(current, prev);
  return { ok: true, goal: current };
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Test seam — replace the status-transition ledger writer. */
export function _setGoalTransitionLedgerWriterForTesting(writer?: RunLedgerWriter): void {
  writeGoalTransitionLedger = writer ?? appendRunLedgerEntry;
}

/** Test seam — drop the in-memory goal, listeners, and injected writer. */
export function _resetForTesting(): void {
  current = null;
  listeners.clear();
  writeGoalTransitionLedger = appendRunLedgerEntry;
}
