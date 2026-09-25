// Wave C (presentation) · A3-1 follow-up — chat-pill row click cascade.
//
// The background-pill is rendered as a single chatLines string row
// (see background-pill-runtime.ts), not as a View, so it doesn't
// flow through the per-frame ClickRegistry hit-test. Instead, mouse
// routing reaches `tryAttachmentHitAtBodyRow`, which already maps a
// click → absolute chatLines index. This helper plugs into that
// existing pipeline as an "is this row the pill?" cascade.
//
// Design parity with `attachment-row-map`: pure absolute-index
// equality. The runtime (background-pill-runtime) exposes
// `getPillRow()` returning the splice anchor, and the dispatch
// helper compares it against the absIdx the click resolved to.
//
// On hit, `onPillClick()` typically opens the unified `/bg` popup
// (widget-modal-popup) — same surface the slash command produces,
// so chat clicks and slash typing share one entry point.

export interface PillClickDispatchDeps {
  /** Pill's current absolute chatLines index, or null when not
   *  rendered. */
  pillRowGetter: () => number | null;
  /** Action callback fired when the click matches the pill row.
   *  Implementations open the /bg popup or any equivalent surface. */
  onPillClick: () => void;
  /** Optional debug logger — when present, the cascade emits a
   *  `log-pane.pill-click` entry on hit for triage. */
  debug?: {
    readonly enabled: boolean;
    log(category: string, msg: string, snap?: Record<string, unknown>): void;
  };
}

export type PillHitOutcome = 'opened' | 'no-pill';

export function tryPillHitAtLineIndex(
  absIdx: number,
  deps: PillClickDispatchDeps,
): PillHitOutcome {
  const pillRow = deps.pillRowGetter();
  if (pillRow === null || absIdx !== pillRow) return 'no-pill';
  if (deps.debug?.enabled) {
    deps.debug.log('log-pane.pill-click', `absIdx=${absIdx}`, { pillRow });
  }
  deps.onPillClick();
  return 'opened';
}
