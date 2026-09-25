/**
 * Task priority scoring — pure function, no IO.
 *
 * Origin: `내부 문서 `PLAN-session-task-orchestrator-coevolution`` §3.2 +
 * Phase 2 (feat/tox-foundation-graph).
 *
 * Formula (from PLAN §3.2):
 *
 *   score(t) = W_PRIORITY_RANK   * priorityRank(t)
 *            + W_AGE_MINUTES     * ageMinutes(t)
 *            + W_DESCENDANTS     * descendantCount(t)
 *            + W_GOAL_URGENCY    * goalUrgency(t.goal)
 *            - W_ESTIMATE_USD    * estimateUsd(t)
 *
 * Rationale:
 * - urgent tasks dominate (high weight)
 * - old tasks drift up slowly (starvation protection)
 * - critical-path tasks (many descendants) jump the queue
 * - deadline-impending goals tilt the whole cohort
 * - expensive tasks get mild deprioritisation (budget awareness)
 *
 * The function is intentionally **total** — missing fields resolve to
 * 0 so the scheduler never crashes on partial data.
 */
import type { Task, TaskPriority } from './types.js';

export const PRIORITY_RANK: Record<TaskPriority, number> = {
  urgent: 4,
  high: 3,
  medium: 2,
  low: 1,
};

/** Default weight set — callers may override (tests, custom tuning). */
export const DEFAULT_WEIGHTS = Object.freeze({
  priorityRank: 10,
  ageMinutes: 0.1,
  descendants: 5,
  goalUrgency: 3,
  estimateUsd: 2,
});

export type PriorityWeights = typeof DEFAULT_WEIGHTS;

export interface PriorityContext {
  /** Clock — defaults to Date.now() at call time. */
  now?: number;
  /** task.id → descendant count (pre-computed by graph). */
  descendantCount?: Map<string, number>;
  /** goalSlug → urgency 0..1 (1 = deadline imminent). */
  goalUrgency?: Map<string, number>;
  /** Weight overrides (tests / tuning). */
  weights?: Partial<PriorityWeights>;
}

/**
 * Compute the priority score. Pure — same inputs always produce the
 * same output (when `ctx.now` is supplied).
 */
export function priorityScore(task: Task, ctx: PriorityContext = {}): number {
  const weights = { ...DEFAULT_WEIGHTS, ...(ctx.weights ?? {}) };
  const rank = PRIORITY_RANK[task.priority] ?? PRIORITY_RANK.medium;
  const now = ctx.now ?? Date.now();
  const ageMinutes = Math.max(0, (now - task.createdAt) / 60_000);
  const descendants = ctx.descendantCount?.get(task.id) ?? 0;
  const goalUrg = task.goalSlug ? (ctx.goalUrgency?.get(task.goalSlug) ?? 0) : 0;
  const estUsd = task.estimateUsd ?? 0;

  return (
    weights.priorityRank * rank +
    weights.ageMinutes * ageMinutes +
    weights.descendants * descendants +
    weights.goalUrgency * goalUrg -
    weights.estimateUsd * estUsd
  );
}

/**
 * Stable comparator — `higher score first`, tie-broken by createdAt
 * (older first) so the scheduler is deterministic under equal priority.
 */
export function compareByPriority(a: Task, b: Task, ctx: PriorityContext = {}): number {
  const diff = priorityScore(b, ctx) - priorityScore(a, ctx);
  if (diff !== 0) return diff;
  // tie — older createdAt wins (prevents starvation of the older task)
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  // still tied — fall back to id to get a total order (id includes hex randomness)
  return a.id.localeCompare(b.id);
}

/**
 * In-place sort; returns the same array for fluency. Used by graph's
 * readySet when the caller already holds an array.
 */
export function sortByPriority<T extends Task>(tasks: T[], ctx: PriorityContext = {}): T[] {
  tasks.sort((a, b) => compareByPriority(a, b, ctx));
  return tasks;
}
