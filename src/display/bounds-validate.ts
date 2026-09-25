// IDX-F5d — Modal bounds vs input zone validation.
//
// `validateModalBounds` enforces the ROADMAP §3 input-zone rule:
// only picker-tier modals (which are paint-only, attached to the
// active text input) may occupy cells inside the input-prompt zone.
// Every other tier (dialog / popup / menu / terminal / overlay) must
// sit above the input zone. If a modal's requested bounds overlap
// the input zone, we shift it up by the overlap distance and emit a
// warning diagnostic so the caller can tighten its layout code.
//
// Picker tier specifically is expected to overlap — slash / arg / @
// pickers paint an upward-growing select-view stacked directly on
// top of the prompt with no gap. For pickers we return the bounds
// unchanged + no warning regardless of overlap.
//
// `PickerLayout` is the forward-declared contract F6/F7 picker
// evolution will use — every picker declares how many rows the
// input zone below it occupies so bounds validation stays
// deterministic even when prompt height changes. Not yet consumed
// by existing pickers in this landing (wire-up is incremental);
// introducing the type now lets downstream adopters reference a
// stable name.

import type { ModalBounds } from './modal-stack.js';
import type { ModalTier } from './types.js';

/** IDX-F5d — contract every picker implements so `validateModalBounds`
 *  (and F7's unified nested-menu host) can reason about the input zone
 *  beneath the picker. Today's pickers will adopt incrementally;
 *  validateModalBounds reads inputZoneHeight from the caller via the
 *  `ValidateInput.inputZoneHeight` field, not from the picker itself.
 *  The interface is declared here so F6/F7 can depend on a stable
 *  name. */
export interface PickerLayout {
  /** Number of terminal rows the input-prompt zone occupies directly
   *  below this picker. 0 signals no prompt below (rare — mostly for
   *  tests / headless paths). */
  inputZoneHeight(): number;
}

export interface ValidateInput {
  /** Requested bounds. 1-indexed row/col matching ModalBounds. */
  bounds: ModalBounds;
  /** Tier of the modal being mounted. Picker tier bypasses the
   *  shift-up rule; any other tier that overlaps the input zone is
   *  shifted. */
  tier: ModalTier;
  /** Terminal height (rows). 1-indexed meaning the last valid row
   *  index is `termRows`. */
  termRows: number;
  /** Rows the input prompt reserves at the bottom of the terminal.
   *  `0` disables the check (treated as "no input zone"). */
  inputZoneHeight: number;
}

export interface ValidateResult {
  /** Adjusted bounds — equal to input.bounds when no shift was
   *  needed, or shifted up by the overlap distance otherwise. */
  bounds: ModalBounds;
  /** True when the requested bounds overlapped the input zone AND
   *  the modal wasn't picker-tier. A warning is appropriate for the
   *  caller to log (dev-only; no prod-level assertion yet). */
  shifted: boolean;
  /** Human-readable reason when `shifted` is true; null otherwise.
   *  Format matches existing debug.log snapshot payload conventions
   *  so callers can drop it straight into a log call. */
  warning: string | null;
}

/** Return the row index (1-indexed) where the input zone starts. The
 *  input zone occupies rows `[inputZoneStart(termRows, h), termRows]`
 *  inclusive. Exported so tests + callers can reason about the
 *  boundary without replicating the arithmetic. */
export function inputZoneStart(termRows: number, inputZoneHeight: number): number {
  if (inputZoneHeight <= 0) return termRows + 1; // virtual "below the bottom" row
  return Math.max(1, termRows - inputZoneHeight + 1);
}

/** Validate modal bounds against the input-prompt zone.
 *
 *  Picker tier: returned unchanged; the contract is that pickers
 *  INTENTIONALLY paint above (and touching) the input zone.
 *
 *  Any other tier: if the requested `bounds.row + bounds.height - 1`
 *  intrudes past `inputZoneStart`, the bounds are shifted up by the
 *  overlap distance. Shifts never reduce height — a modal too tall
 *  for the screen minus the input zone gets clamped at `row = 1`
 *  and the caller should read the warning to know it may be
 *  truncated at the bottom as well. */
export function validateModalBounds(input: ValidateInput): ValidateResult {
  const { bounds, tier, termRows, inputZoneHeight } = input;
  if (tier === 'picker') {
    return { bounds, shifted: false, warning: null };
  }
  if (inputZoneHeight <= 0) {
    return { bounds, shifted: false, warning: null };
  }
  const zoneStart = inputZoneStart(termRows, inputZoneHeight);
  const modalEnd = bounds.row + bounds.height - 1;
  if (modalEnd < zoneStart) {
    return { bounds, shifted: false, warning: null };
  }
  const overlap = modalEnd - zoneStart + 1;
  const shiftedRow = Math.max(1, bounds.row - overlap);
  const warning =
    `modal tier=${tier} overlaps input zone by ${overlap} rows (bounds.row=${bounds.row}`
    + `, height=${bounds.height}, zoneStart=${zoneStart}); shifted to row=${shiftedRow}`;
  return {
    bounds: { ...bounds, row: shiftedRow },
    shifted: true,
    warning,
  };
}
