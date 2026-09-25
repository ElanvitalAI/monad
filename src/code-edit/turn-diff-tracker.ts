// Turn-level diff tracker — Phase CE5.
//
// Adapted from codex-rs/core/src/turn_diff_tracker.rs (Apache 2.0).
// The core insight: when the LLM does a sequence of Edit/Write calls
// in one conversation turn, the user wants to see "total change in
// this turn" not "here are 7 separate diff blocks". We capture the
// baseline (pre-turn content) on first touch of each path and compute
// the consolidated diff at turn end.
//
// Per-Edit diff blocks still render live (CE3) — the tracker is
// additive, producing an after-the-fact summary once the turn ends.
//
// Lifecycle:
//   beginTurn()              — called when a new user-driven turn starts;
//                              clears all state.
//   onBeforeEdit(path, orig) — called by apply.ts BEFORE writing;
//                              records the original content only if
//                              this path hasn't been touched this turn.
//   turnSummary()            — returns per-file patches computed against
//                              the recorded baselines.
//   endTurn()                — calls turnSummary() then clears state.

import { computePatch, countPatchChanges } from './diff-compute.js';
import type { StructuredPatchHunk } from './types.js';

export interface TurnDiffEntry {
  path: string;
  /** Full unified-diff hunks from baseline → current. Empty when the
   *  file was touched then restored to baseline. */
  patch: StructuredPatchHunk[];
  added: number;
  removed: number;
  /** True when the baseline didn't exist on disk (this turn created
   *  the file). Rendering uses this to surface "Create" vs "Update". */
  created: boolean;
  /** True when the file existed at the start of the turn but doesn't
   *  anymore (rare — Edit/Write don't delete today, but tracker
   *  stays honest). */
  deleted: boolean;
}

interface Baseline {
  existed: boolean;
  content: string;
  /** Snapshot of the current content at tracker-record time. Used to
   *  detect net-unchanged paths ("touched then reverted"). */
}

export class TurnDiffTracker {
  private baseline = new Map<string, Baseline>();

  beginTurn(): void {
    this.baseline.clear();
  }

  /** Record a file's pre-edit state. Safe to call many times — only
   *  the first call per path lands, so a sequence of Edits on the
   *  same file still diffs against the true start-of-turn content. */
  onBeforeEdit(path: string, original: string | null): void {
    if (this.baseline.has(path)) return;
    this.baseline.set(path, {
      existed: original !== null,
      content: original ?? '',
    });
  }

  size(): number {
    return this.baseline.size;
  }

  hasBaseline(path: string): boolean {
    return this.baseline.has(path);
  }

  /** Compute the net diff for each tracked path using the current
   *  disk content. Reading is delegated to `readCurrent` so callers
   *  can inject fs or a fake. Entries with no net change are filtered
   *  out unless `includeUnchanged` is true. */
  async turnSummary(
    readCurrent: (path: string) => Promise<string | null>,
    opts: { includeUnchanged?: boolean } = {},
  ): Promise<TurnDiffEntry[]> {
    const out: TurnDiffEntry[] = [];
    for (const [path, base] of this.baseline) {
      const current = await readCurrent(path).catch(() => null);
      const existsNow = current !== null;
      const created = !base.existed && existsNow;
      const deleted = base.existed && !existsNow;
      const baseText = base.content;
      const currentText = current ?? '';
      if (baseText === currentText && !opts.includeUnchanged) continue;

      const patch = computePatch(path, baseText, currentText);
      const { added, removed } = countPatchChanges(patch);
      out.push({ path, patch, added, removed, created, deleted });
    }
    // Stable sort by path for deterministic rendering.
    out.sort((a, b) => a.path.localeCompare(b.path));
    return out;
  }

  endTurn(): void {
    this.baseline.clear();
  }
}

// ── Singleton for dashboard integration ───────────────────────────
//
// The dashboard owns one tracker per conversation; tests build their
// own. We keep a module-level default because every tool/runtime
// call goes through apply.ts, which can't thread a tracker ref down
// from the dashboard without touching every catalog entry.

let _tracker: TurnDiffTracker | null = null;

export function getTurnDiffTracker(): TurnDiffTracker {
  if (!_tracker) _tracker = new TurnDiffTracker();
  return _tracker;
}

export function _setTurnDiffTrackerForTesting(tracker: TurnDiffTracker | null): void {
  _tracker = tracker;
}

// ── Renderer ───────────────────────────────────────────────────────

import { C } from '../tui.js';

/** Summary lines appended to the chat tail at turn-end. Empty array
 *  when nothing changed — callers can skip the push. */
export function renderTurnSummary(entries: readonly TurnDiffEntry[]): string[] {
  if (entries.length === 0) return [];
  const totalAdded = entries.reduce((a, e) => a + e.added, 0);
  const totalRemoved = entries.reduce((a, e) => a + e.removed, 0);
  const title = `${C.accent('●')}  ${C.bold('Turn summary')} — ${entries.length} file${entries.length === 1 ? '' : 's'} changed, +${C.success(String(totalAdded))} / -${C.error(String(totalRemoved))}`;
  const rows: string[] = [title];
  for (const e of entries) {
    const verb = e.created ? C.success('create') : e.deleted ? C.error('delete') : C.accent('update');
    const delta = `+${e.added} / -${e.removed}`;
    rows.push(`  ${verb}  ${C.muted(e.path)}  ${C.muted(delta)}`);
  }
  return rows;
}
