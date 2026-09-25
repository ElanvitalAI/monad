/**
 * computeBoard — 4-column kanban layout builder.
 *
 * Origin: 내부 문서 `PLAN-session-tox-board-layout` · TOX-4.
 *
 * Pure function. Takes the task list + viewport + filter, returns a
 * `BoardLayout` with ordered cards per column and overflow counts so
 * widgets can paint "+N more" affordances.
 */
import {
  projectTaskToCard,
  type BoardCard,
} from './card.js';
import type {
  Task,
  TaskStatus,
  TaskSurfaceKind,
  TaskPriority,
} from '../types.js';

// ───────────────────────── Types ──────────────────────────────────

export type BoardColumnKey = 'BACKLOG' | 'IN_PROGRESS' | 'REVIEW' | 'DONE';
export type BoardMode = 'wide' | 'grid' | 'compact';

export interface BoardColumn {
  key: BoardColumnKey;
  title: string;
  cards: readonly BoardCard[];
  total: number;
}

export interface BoardLayout {
  viewport: { width: number; height: number };
  mode: BoardMode;
  columns: readonly BoardColumn[];
  overflow: Record<BoardColumnKey, number>;
  stats: { total: number; ageOldestMs: number | null };
}

export interface BoardFilter {
  goalSlug?: string;
  surfaceKind?: TaskSurfaceKind;
  /** Case-insensitive substring match against task title. */
  text?: string;
}

export interface BoardOptions {
  tasks: readonly Task[];
  viewport: { width: number; height: number };
  filter?: BoardFilter;
  now?: number;
  /** DONE column age cutoff in ms. Default 24h. */
  doneCutoffMs?: number;
  /** Per-column max cards in compact mode. Default 10. */
  compactPerColumn?: number;
  /** Per-column max in wide/grid. Default = column total (no cap). */
  wideMaxPerColumn?: number;
  titleMaxLen?: number;
}

const COLUMN_KEYS: readonly BoardColumnKey[] = [
  'BACKLOG',
  'IN_PROGRESS',
  'REVIEW',
  'DONE',
] as const;

const COLUMN_TITLES: Record<BoardColumnKey, string> = {
  BACKLOG: 'Backlog',
  IN_PROGRESS: 'In Progress',
  REVIEW: 'Review',
  DONE: 'Done',
};

const PRIORITY_WEIGHT: Record<TaskPriority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const DEFAULT_DONE_CUTOFF_MS = 24 * 60 * 60 * 1000;
const DEFAULT_COMPACT_PER_COLUMN = 10;

// ───────────────────────── Public entry ───────────────────────────

export function computeBoard(opts: BoardOptions): BoardLayout {
  const now = opts.now ?? Date.now();
  const doneCutoffMs = opts.doneCutoffMs ?? DEFAULT_DONE_CUTOFF_MS;
  const mode = pickMode(opts.viewport.width);
  const perColumn = pickPerColumn(mode, opts);

  // 1. Filter.
  const filtered = opts.tasks.filter((t) => includeTask(t, opts.filter, now, doneCutoffMs));

  // 2. Bucket by column.
  const bucketed: Record<BoardColumnKey, Task[]> = {
    BACKLOG: [],
    IN_PROGRESS: [],
    REVIEW: [],
    DONE: [],
  };
  for (const t of filtered) {
    const key = bucketOf(t.status);
    if (!key) continue;
    bucketed[key].push(t);
  }

  // 3. Sort within column by priority then createdAt.
  for (const key of COLUMN_KEYS) {
    bucketed[key].sort((a, b) => {
      const pa = PRIORITY_WEIGHT[a.priority] ?? 2;
      const pb = PRIORITY_WEIGHT[b.priority] ?? 2;
      if (pa !== pb) return pa - pb;
      // newer first for DONE; older first elsewhere (FIFO)
      if (key === 'DONE') return b.createdAt - a.createdAt;
      return a.createdAt - b.createdAt;
    });
  }

  // 4. Per-column cap + overflow count.
  const overflow: Record<BoardColumnKey, number> = {
    BACKLOG: 0,
    IN_PROGRESS: 0,
    REVIEW: 0,
    DONE: 0,
  };
  const columns: BoardColumn[] = [];
  for (const key of COLUMN_KEYS) {
    const full = bucketed[key];
    const total = full.length;
    const cap = perColumn ?? total;
    const sliced = full.slice(0, cap);
    overflow[key] = Math.max(0, total - sliced.length);
    const cards = sliced.map((t) =>
      projectTaskToCard(t, { now, titleMaxLen: opts.titleMaxLen }),
    );
    columns.push({
      key,
      title: COLUMN_TITLES[key],
      cards: Object.freeze(cards),
      total,
    });
  }

  // 5. Stats.
  const totalTasks = filtered.length;
  const ageOldestMs =
    filtered.length === 0
      ? null
      : Math.max(
          0,
          now - Math.min(...filtered.map((t) => t.createdAt)),
        );

  return {
    viewport: { ...opts.viewport },
    mode,
    columns: Object.freeze(columns),
    overflow,
    stats: { total: totalTasks, ageOldestMs },
  };
}

// ───────────────────────── helpers ────────────────────────────────

function pickMode(width: number): BoardMode {
  if (width >= 120) return 'wide';
  if (width >= 60) return 'grid';
  return 'compact';
}

function pickPerColumn(
  mode: BoardMode,
  opts: BoardOptions,
): number | null {
  if (mode === 'compact') {
    return opts.compactPerColumn ?? DEFAULT_COMPACT_PER_COLUMN;
  }
  return opts.wideMaxPerColumn ?? null;
}

function bucketOf(status: TaskStatus): BoardColumnKey | null {
  switch (status) {
    case 'backlog':
    case 'blocked':
    case 'scheduled':
    case 'ready':
      return 'BACKLOG';
    case 'running':
      return 'IN_PROGRESS';
    case 'review':
    case 'failed':
      return 'REVIEW';
    case 'done':
      return 'DONE';
    case 'cancelled':
    case 'superseded':
      return null; // archived — not shown
  }
}

function includeTask(
  task: Task,
  filter: BoardFilter | undefined,
  now: number,
  doneCutoffMs: number,
): boolean {
  const bucket = bucketOf(task.status);
  if (!bucket) return false;
  // DONE cutoff — older than doneCutoffMs → archive (skip).
  if (bucket === 'DONE' && now - task.createdAt > doneCutoffMs) return false;
  if (!filter) return true;
  if (filter.goalSlug !== undefined && task.goalSlug !== filter.goalSlug) return false;
  if (filter.surfaceKind !== undefined && task.surface.kind !== filter.surfaceKind) return false;
  if (filter.text !== undefined) {
    const needle = filter.text.toLowerCase();
    if (!task.title.toLowerCase().includes(needle)) return false;
  }
  return true;
}
