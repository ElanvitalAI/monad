// PLAN §4.7 · Arc 2.3 — UndoTurn time-travel slider bridge.
//
// Pure-logic layer between the existing `undo-turn` primitive (orphan
// commit ring, restore via `git restore --source <sha>`) and a
// time-travel UI surface — TUI widget, web slider, chat dump. Holds
// no DOM / TUI knowledge; every consumer can build its own renderer
// on top of `buildSliderState()` + the cursor-movement helpers.
//
// Why a bridge instead of inlining into a widget?
//   • Tests stay pure — no Widget host setup, no terminal mocks.
//   • Multiple surfaces can consume the same view (TUI widget today,
//     web component in Horizon 3, `/turn-slider` slash inline).
//   • The actual restore call is delegated through an injectable
//     function so unit tests can verify the bridge dispatches the
//     correct snapshot without touching git.

import type { Snapshot, RestoreResult } from './types.js';
import { listSnapshots, findSnapshotById } from './store.js';
import { restoreSnapshot } from './restore.js';

export interface SliderEntry {
  id: string;
  sha: string;
  shaShort: string;
  capturedAt: number;
  ageSec: number;
  description?: string;
}

export interface TurnSliderState {
  /** All snapshots, oldest-first. The slider visual reads
   *  left-to-right in the same order. */
  entries: SliderEntry[];
  /** Index of the currently-selected entry. -1 when no snapshots. */
  cursor: number;
  /** Absolute Date.now() when this state was built — feeds the
   *  age-second column in the visual. */
  builtAt: number;
}

/** Build a fresh slider state from the live snapshot store. The
 *  cursor defaults to the most recent entry (rightmost) so a fresh
 *  open lands the user on "now". */
export function buildSliderState(now: number = Date.now()): TurnSliderState {
  const snaps = listSnapshots();
  // listSnapshots returns oldest-first per store.ts contract, but
  // we re-sort defensively in case the store rewrites that later.
  const sorted = [...snaps].sort((a, b) => a.capturedAt - b.capturedAt);
  const entries: SliderEntry[] = sorted.map((s) => ({
    id: s.id,
    sha: s.sha,
    shaShort: s.sha.slice(0, 7),
    capturedAt: s.capturedAt,
    ageSec: Math.max(0, Math.round((now - s.capturedAt) / 1000)),
    ...(s.description ? { description: s.description } : {}),
  }));
  return {
    entries,
    cursor: entries.length === 0 ? -1 : entries.length - 1,
    builtAt: now,
  };
}

/** Pure cursor movement — bounded to `[0, entries.length - 1]`. */
export function moveSliderCursor(state: TurnSliderState, delta: number): TurnSliderState {
  if (state.entries.length === 0) return state;
  const next = Math.max(0, Math.min(state.entries.length - 1, state.cursor + delta));
  if (next === state.cursor) return state;
  return { ...state, cursor: next };
}

export function setSliderCursor(state: TurnSliderState, index: number): TurnSliderState {
  if (state.entries.length === 0) return state;
  const next = Math.max(0, Math.min(state.entries.length - 1, index));
  if (next === state.cursor) return state;
  return { ...state, cursor: next };
}

/** ASCII render — left-to-right bar, `●` for unselected, `◉` for the
 *  cursor, `○` for the head/end marker when cursor is not at the head.
 *  Suitable for chat dump or as the substrate any future TUI widget
 *  layers ANSI color over. */
export function renderSliderBar(state: TurnSliderState, opts: { width?: number } = {}): string {
  if (state.entries.length === 0) return '(no snapshots)';
  const widthCap = Math.max(state.entries.length, opts.width ?? state.entries.length);
  // We always render one marker per snapshot — the width cap only
  // matters when callers pad the bar beyond the marker count.
  const out: string[] = [];
  for (let i = 0; i < state.entries.length; i++) {
    out.push(i === state.cursor ? '◉' : '●');
  }
  // Pad with ─ to match `widthCap` if the caller asked for a wider
  // bar (pre-allocated alignment for fixed-column layouts).
  while (out.length < widthCap) out.push('─');
  return out.join('─');
}

/** Multi-line text rendering — bar + a key-value detail line for
 *  the selected entry. Caller-renderer adds color. */
export function renderSliderDetail(state: TurnSliderState): string[] {
  const lines: string[] = [];
  if (state.entries.length === 0) {
    lines.push('(no snapshots — no Edit/Write fired in this session yet)');
    return lines;
  }
  const sel = state.entries[state.cursor];
  if (!sel) return lines;
  lines.push(renderSliderBar(state));
  lines.push(`turn ${state.cursor + 1} / ${state.entries.length} · ${sel.id} · ${sel.shaShort} · ${sel.ageSec}s ago`);
  if (sel.description) {
    lines.push(`  description: ${sel.description.slice(0, 100)}`);
  }
  return lines;
}

export type SliderRestoreFn = (snap: Snapshot) => RestoreResult;

/** Restore the working tree to the entry the cursor is on. Pure
 *  dispatch: looks the snapshot up via `findSnapshotById` (so
 *  re-builds of the slider don't break stale references) and calls
 *  the injectable restore function. Default = the live
 *  `restoreSnapshot` from undo-turn. */
export function restoreToCursor(
  state: TurnSliderState,
  restoreFn: SliderRestoreFn = restoreSnapshot,
): RestoreResult {
  if (state.entries.length === 0 || state.cursor < 0) {
    return {
      ok: false,
      untrackedRemoved: 0,
      summary: 'no snapshot selected',
      error: 'slider has no snapshots to restore',
    };
  }
  const entry = state.entries[state.cursor]!;
  const snap = findSnapshotById(entry.id);
  if (!snap) {
    return {
      ok: false,
      untrackedRemoved: 0,
      summary: `snapshot ${entry.id} not found in store`,
      error: 'snapshot was removed from the ring after slider build — rebuild and try again',
    };
  }
  return restoreFn(snap);
}
