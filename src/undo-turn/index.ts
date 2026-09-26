// ── undo-turn public API ──
//
// One tick-per-turn idempotent capture helper + the lower-level
// primitives. Dashboard calls `captureIfFirstMutationOfTurn(cwd)`
// from the apply.ts pre-write hook; slash / LLM tool paths use
// captureSnapshot / restoreSnapshot / popSnapshot directly.

import { captureSnapshot } from './snapshot.js';
import { restoreSnapshot } from './restore.js';
import {
  pushSnapshot,
  listSnapshots,
  peekSnapshot,
  popSnapshot,
  findSnapshotById,
  dropFromSnapshot,
  clearSnapshots,
  __resetSnapshotStore,
} from './store.js';
import type { Snapshot, CaptureOpts, RestoreResult } from './types.js';

export { captureSnapshot, restoreSnapshot };
export {
  pushSnapshot,
  listSnapshots,
  peekSnapshot,
  popSnapshot,
  findSnapshotById,
  dropFromSnapshot,
  clearSnapshots,
  __resetSnapshotStore,
};
export type { Snapshot, CaptureOpts, RestoreResult };
export {
  buildSliderState,
  moveSliderCursor,
  setSliderCursor,
  renderSliderBar,
  renderSliderDetail,
  restoreToCursor,
  type TurnSliderState,
  type SliderEntry,
  type SliderRestoreFn,
} from './widget-bridge.js';

/** Per-turn guard — identifies "first mutation of a turn" so we
 *  snapshot at most once per turn no matter how many Edits land.
 *  startTurn() flips a boolean that captureIfFirstMutationOfTurn()
 *  consumes and clears. endTurn() is a no-op today but reserved for
 *  future lifecycle hooks (e.g. turn-index tagging). */
let turnNeedsSnapshot = false;
let currentTurnDescription: string | undefined;
let undoDisabledForSession = false;

export function startTurn(description?: string): void {
  turnNeedsSnapshot = true;
  currentTurnDescription = description;
}

export function endTurn(): void {
  turnNeedsSnapshot = false;
  currentTurnDescription = undefined;
}

/** Disable snapshotting for the remainder of the session. Used by
 *  the `ELANOUS_UNDO=off` bootflag and the `/undo off` slash. */
export function setUndoDisabled(disabled: boolean): void {
  undoDisabledForSession = disabled;
}

export function isUndoDisabled(): boolean {
  if (undoDisabledForSession) return true;
  const v = (process.env.ELANOUS_UNDO ?? '').toLowerCase();
  return v === 'off' || v === '0' || v === 'false';
}

/** Called from apply.ts before the first write of each turn. No-op
 *  when undo is disabled, when startTurn wasn't called, or when
 *  a snapshot has already been captured for this turn. Captures
 *  silently and pushes onto the ring — failure is surfaced only
 *  via the return value (dashboard chat log may log on null). */
export function captureIfFirstMutationOfTurn(cwd: string): Snapshot | null {
  if (isUndoDisabled()) return null;
  if (!turnNeedsSnapshot) return null;
  const snap = captureSnapshot(cwd, { description: currentTurnDescription });
  turnNeedsSnapshot = false; // even if snap is null we only try once per turn
  if (!snap) return null;
  pushSnapshot(snap);
  return snap;
}

/** Test helper — flip back to pre-turn state. */
export function __resetTurnState(): void {
  turnNeedsSnapshot = false;
  currentTurnDescription = undefined;
  undoDisabledForSession = false;
}
