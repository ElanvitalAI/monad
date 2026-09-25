// BACKLOG #5 — pure helpers for the worktrees panel.
// Extracted from WorktreesPanel.tsx so the row-classification +
// summary math is unit-testable without React.

import type { WorktreeView } from '@/nexus/client';

export type WorktreeStatus = 'main' | 'active' | 'orphan' | 'detached' | 'idle';

/** Single-word status badge for the row. Order of precedence:
 *    1. orphan (owner pid dead)        — needs cleanup
 *    2. main (primary repo)
 *    3. detached (HEAD only, no branch) — exists but no working session
 *    4. active (owner pid alive)        — currently in use
 *    5. idle (worktree exists, no monad session)
 *
 *  The order encodes "what does the user need to know first" — a
 *  user scanning the table should spot orphans before anything
 *  else (cleanup work to do). */
export function classifyWorktree(w: WorktreeView): WorktreeStatus {
  if (w.orphan) return 'orphan';
  if (w.isMain) return 'main';
  if (w.isDetached) return 'detached';
  if (w.session && w.session.alive) return 'active';
  return 'idle';
}

/** Sort by precedence so the most-actionable rows appear first. */
const ORDER: Record<WorktreeStatus, number> = {
  orphan: 0,
  active: 1,
  detached: 2,
  idle: 3,
  main: 4,
};

export interface ClassifiedWorktree {
  view: WorktreeView;
  status: WorktreeStatus;
}

export function classifyAndSort(worktrees: WorktreeView[]): ClassifiedWorktree[] {
  return worktrees
    .map((view) => ({ view, status: classifyWorktree(view) }))
    .sort((a, b) => {
      const oa = ORDER[a.status] ?? 99;
      const ob = ORDER[b.status] ?? 99;
      if (oa !== ob) return oa - ob;
      // Tiebreak: branch name alphabetical
      const ba = a.view.branch ?? '~detached';
      const bb = b.view.branch ?? '~detached';
      return ba.localeCompare(bb);
    });
}

export interface WorktreeSummary {
  total: number;
  active: number;
  orphan: number;
  idle: number;
  detached: number;
  main: number;
}

export function summarize(rows: ClassifiedWorktree[]): WorktreeSummary {
  const out: WorktreeSummary = { total: rows.length, active: 0, orphan: 0, idle: 0, detached: 0, main: 0 };
  for (const r of rows) out[r.status] += 1;
  return out;
}

/** Human-readable "5 minutes ago" label for `enteredAt` timestamps. */
export function formatRelative(now: number, ts: number | undefined): string {
  if (ts === undefined) return '';
  const diff = Math.max(0, now - ts);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}
