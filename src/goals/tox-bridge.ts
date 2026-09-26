// TOX ↔ /goal bridge — FU-7.
//
// Thin adapter that reads/writes the link between a Goal and a TOX
// Task. elanous has both surfaces today (TOX for decomposed work, /goal
// for cross-turn drive); they're complementary but were not connected.
//
// The bridge is intentionally type-agnostic: it accepts a TaskStore-like
// interface so callers (slash dispatch, plan-exit handler, tests) can
// inject the real store or a stub. The real wiring lives in the
// dashboard at boot time — this module avoids importing
// `task-orchestrator/store.ts` directly so testability stays clean.
//
// Surfaced UX:
//   - `/goal status` appends "linked task: <id> · <title>" when goal
//     has linkedTaskId AND the task can be looked up.
//   - `/goal <obj>` (with `--task <id>` flag, P3 follow-up) sets
//     linkedTaskId at start time.
//   - `(G)oal-loop drive` from plan-exit modal can optionally search
//     by goal-slug to auto-link (deferred — slug derivation is a
//     separate scope).

import type { Goal } from './types.js';

export interface TaskLike {
  id: string;
  title: string;
  description?: string;
  goalSlug?: string;
  status: string;
}

export interface TaskStoreLike {
  getTask(id: string): TaskLike | null;
  listTasks(opts: { goalSlug?: string }): TaskLike[];
}

export interface LinkedTaskSummary {
  id: string;
  title: string;
  status: string;
  goalSlug?: string;
}

/** Return a human-readable summary of the linked task, or null if no
 *  link / link target missing. Pure — caller passes the store. */
export function summarizeLinkedTask(
  goal: Goal,
  store: TaskStoreLike,
): LinkedTaskSummary | null {
  if (!goal.linkedTaskId) return null;
  const task = store.getTask(goal.linkedTaskId);
  if (!task) return null;
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    ...(task.goalSlug ? { goalSlug: task.goalSlug } : {}),
  };
}

/** Search candidate TOX tasks for a goal objective. Used by future
 *  `/goal <obj> --link` flow to auto-suggest links. P1: simple title
 *  substring match (case-insensitive). */
export function findCandidateTasks(
  objective: string,
  store: TaskStoreLike,
  limit = 5,
): TaskLike[] {
  const needle = objective.trim().toLowerCase();
  if (!needle) return [];
  // First — any tasks whose goalSlug looks similar (slug prefix is
  // a stable identifier when the user creates a goal from /research).
  // Slug derivation: kebab-cased first 3 words.
  const slugCandidate = needle
    .split(/\s+/)
    .slice(0, 3)
    .join('-')
    .replace(/[^a-z0-9-]/g, '');
  let direct: TaskLike[] = [];
  if (slugCandidate) {
    direct = store.listTasks({ goalSlug: slugCandidate });
  }
  if (direct.length > 0) return direct.slice(0, limit);
  // Fallback — title substring match across all tasks. The store
  // doesn't expose listAll directly; we approximate by listing with
  // empty filter (the impl returns all rows when no filter set).
  const all = store.listTasks({});
  return all
    .filter((t) =>
      t.title.toLowerCase().includes(needle)
      || (t.description?.toLowerCase().includes(needle) ?? false),
    )
    .slice(0, limit);
}

/** Render a one-line summary line for use inside /goal status. */
export function formatLinkedTaskLine(summary: LinkedTaskSummary): string {
  const slug = summary.goalSlug ? ` · slug=${summary.goalSlug}` : '';
  return `  linked task: ${summary.id} · "${summary.title}" [${summary.status}]${slug}`;
}
