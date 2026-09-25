// ── PFC-S4 P1: goal directory path resolver ──
//
// Single source of truth for `<vault.root>/goals/<slug>/` layout. All
// S4 tools (ResearchPlan, QuestionQueue, Budget, TerminationCheck,
// EnterAutoMode) resolve file paths through here so the layout stays
// consistent and future restructures land in one place.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ObsidianVault } from './obsidian-bridge.js';

export interface GoalPaths {
  vault: ObsidianVault;
  goalSlug: string;
  goalRoot: string;
  plan: string;
  queue: string;
  wins: string;
  sources: string;
  failures: string;
  nowPath: string;
  active: string;
  summary: string;
  budgetFile: string;
}

const GOAL_SLUG_RE = /^[a-z0-9][a-z0-9_-]*$/;

export function isValidGoalSlug(slug: string): boolean {
  return GOAL_SLUG_RE.test(slug) && slug.length <= 80;
}

export function resolveGoalPaths(vault: ObsidianVault, slug: string): GoalPaths {
  if (!isValidGoalSlug(slug)) {
    throw new Error(`invalid goal_slug '${slug}' — must match ${GOAL_SLUG_RE} (lowercase, digits, hyphen, underscore)`);
  }
  const goalRoot = join(vault.root, 'goals', slug);
  return {
    vault,
    goalSlug: slug,
    goalRoot,
    plan: join(goalRoot, 'plan.md'),
    queue: join(goalRoot, 'question-queue.md'),
    wins: join(goalRoot, 'knowledge', 'wins.md'),
    sources: join(goalRoot, 'knowledge', 'sources.md'),
    failures: join(goalRoot, 'knowledge', 'failures.md'),
    nowPath: join(goalRoot, 'NOW.md'),
    active: join(goalRoot, 'ACTIVE.md'),
    summary: join(goalRoot, 'executive-summary.md'),
    budgetFile: join(goalRoot, 'budget.json'),
  };
}

/** Create goalRoot + knowledge/ + snapshots/ (via experiment-ledger
 *  convention). Callers should invoke before any write. Idempotent. */
export function ensureGoalDir(paths: GoalPaths): void {
  ensureDir(paths.goalRoot);
  ensureDir(join(paths.goalRoot, 'knowledge'));
  ensureDir(join(paths.goalRoot, 'snapshots'));
}

/** Seed empty knowledge files so the termination DSL's per-line
 *  counters (min_sources) have something to read. Touch-only — does
 *  not overwrite existing content. */
export function seedGoalKnowledgeFiles(paths: GoalPaths): void {
  for (const p of [paths.wins, paths.sources, paths.failures]) {
    if (!existsSync(p)) {
      ensureDir(dirname(p));
      writeFileSync(p, '', 'utf-8');
    }
  }
}

function ensureDir(path: string): void {
  if (existsSync(path)) return;
  mkdirSync(path, { recursive: true });
}
