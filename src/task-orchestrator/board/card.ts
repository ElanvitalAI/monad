/**
 * Task → BoardCard projection.
 *
 * Origin: 내부 문서 `PLAN-session-tox-board-layout` · TOX-4.
 *
 * Pure data transform: takes a full Task + an optional now-clock and
 * returns a trimmed shape that widget impls render. No IO, no DOM,
 * no terminal escape sequences — those belong to the widget layer.
 */
import {
  surfaceGlyph,
  type Task,
  type TaskStatus,
  type TaskSurfaceKind,
  type TaskPriority,
} from '../types.js';

export type CardBadgeKind =
  | 'goal'
  | 'retry'
  | 'estimate'
  | 'feature'
  | 'generated'
  | 'paused'
  | 'blocked-by';

export interface CardBadge {
  kind: CardBadgeKind;
  text: string;
}

export interface BoardCard {
  id: string;
  title: string;
  status: TaskStatus;
  surfaceKind: TaskSurfaceKind;
  surfaceGlyph: string;
  priority: TaskPriority;
  /** Optional 0..1 hint — for running tasks we map attempt/maxRetries
   *  as a rough "how deep into the retry budget are we". */
  progress: number | undefined;
  badges: readonly CardBadge[];
  ageMs: number;
  goalSlug: string | undefined;
  hasAcceptance: boolean;
}

export interface ProjectOptions {
  now?: number;
  titleMaxLen?: number;
}

const DEFAULT_TITLE_LEN = 40;

export function projectTaskToCard(task: Task, opts: ProjectOptions = {}): BoardCard {
  const now = opts.now ?? Date.now();
  const titleMaxLen = opts.titleMaxLen ?? DEFAULT_TITLE_LEN;

  const badges: CardBadge[] = [];
  if (task.goalSlug) badges.push({ kind: 'goal', text: task.goalSlug });
  if (task.attempt > 0) {
    badges.push({
      kind: 'retry',
      text: `retry ${task.attempt}/${task.maxRetries}`,
    });
  }
  if (task.estimateUsd !== undefined && task.estimateUsd > 0) {
    badges.push({ kind: 'estimate', text: `$${task.estimateUsd.toFixed(2)}` });
  }
  if (task.featureName) badges.push({ kind: 'feature', text: task.featureName });
  if (task.generatedBy?.kind === 'llm' || task.generatedBy?.kind === 'regenerate') {
    badges.push({ kind: 'generated', text: task.generatedBy.kind });
  }
  if (task.status === 'blocked') {
    badges.push({ kind: 'blocked-by', text: `deps ${task.dependsOn.length}` });
  }

  const progress = computeProgress(task);
  const title = truncate(task.title, titleMaxLen);

  return {
    id: task.id,
    title,
    status: task.status,
    surfaceKind: task.surface.kind,
    surfaceGlyph: surfaceGlyph(task.surface.kind),
    priority: task.priority,
    progress,
    badges: Object.freeze(badges),
    ageMs: Math.max(0, now - task.createdAt),
    goalSlug: task.goalSlug,
    hasAcceptance: Boolean(task.acceptance?.checks && task.acceptance.checks.length > 0),
  };
}

function computeProgress(task: Task): number | undefined {
  if (task.status !== 'running') return undefined;
  if (task.maxRetries <= 0) return undefined;
  // Rough indicator: how much of the retry budget is used. Primary
  // value is "this task has eaten retries — proceed with caution",
  // not actual completion percent.
  const used = Math.min(task.attempt, task.maxRetries);
  return used / task.maxRetries;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  if (max <= 1) return s.slice(0, max);
  return s.slice(0, max - 1) + '…';
}
