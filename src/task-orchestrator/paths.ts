/**
 * Task Orchestrator file-system layout helpers.
 *
 * `<config-dir>/tasks/` default root — the umbrella `--config-dir`
 * flag (`getElanousConfigDir()`) decides what `<config-dir>` is. Default
 * remains `~/.elanous/`, so `~/.elanous/tasks/tasks.db` is unchanged for
 * the daily-driver user. The legacy env vars (`ELANOUS_TASKS_DIR`,
 * `ELANOUS_TASKS_DB`) stay honoured as a back-compat fallback (per
 * `feedback_user_config_over_env`) but are no longer the documented
 * surface — new callers should pass `--config-dir <dir>` to redirect
 * the entire elanous root atomically.
 *
 * Never cross the boundary to `process.cwd()` or
 * `session-working-dir` — orchestrator state is *config-root-scoped*,
 * not project-scoped.
 */
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

import { getElanousConfigDir } from '../elanous-config-dir.js';

/**
 * Resolve the orchestrator root. Priority:
 *   1. env `ELANOUS_TASKS_DIR` (legacy fallback only · retired as a
 *      documented surface 2026-05-12 FU8 PR #4 · still honoured so
 *      pre-FU8 callers + hermetic tests keep working without churn).
 *   2. `<getElanousConfigDir()>/tasks` — routes through `--config-dir`.
 *      Default `~/.elanous/tasks` when no override.
 */
export function tasksRoot(): string {
  const env = process.env.ELANOUS_TASKS_DIR;
  if (env && env.length > 0) return env;
  return join(getElanousConfigDir(), 'tasks');
}

/**
 * SQLite db path — `<root>/tasks.db`.
 *
 * Priority:
 *   1. env `ELANOUS_TASKS_DB` (legacy fallback only · retired as a
 *      documented surface 2026-05-12 FU8 PR #4 · pre-FU8 callers
 *      that pin an explicit DB path still resolve here).
 *   2. `<tasksRoot()>/tasks.db` — which itself routes through
 *      `--config-dir` via `getElanousConfigDir()`.
 */
export function tasksDbPath(): string {
  const env = process.env.ELANOUS_TASKS_DB;
  if (env && env.length > 0) return env;
  return join(tasksRoot(), 'tasks.db');
}

/** Goal-scoped directory — `<root>/goal-<slug>/`. Caller must ensure
 *  slug sanitised (letters/digits/dash/underscore). */
export function goalDir(slug: string): string {
  if (!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(slug)) {
    throw new Error(`Invalid goal slug: ${slug}`);
  }
  return join(tasksRoot(), `goal-${slug}`);
}

/** Per-goal append-only events file. */
export function goalEventsPath(slug: string): string {
  return join(goalDir(slug), 'events.jsonl');
}

/** Per-goal crash-recovery snapshot (optional — DB is authoritative). */
export function goalGraphSnapshotPath(slug: string): string {
  return join(goalDir(slug), 'graph.json');
}

/** Ensure a directory exists (recursive). */
export function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}
