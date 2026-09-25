// U-0 · dashboard-side ViewMode integration.
//
// Bridges the dashboard's ad-hoc mode-flag bag to the pure
// `ViewMode` type in `src/input-core/view-mode.ts`. Dashboard owns
// the flags (streamingInFlight, chord, terminalModalRouter, etc.)
// and exposes a single closure that derives the unified view mode
// on demand. Consumers (audit snapshots now; dispatch logic in
// U-2) read `computeDashboardViewMode(signals)` instead of
// re-implementing the priority chain.
//
// Why not auto-sync to ContextKeys on every compute call: the
// `bridgeViewModeToContextKeys` bridge in `state/bridges/view-mode.ts`
// handles that once the state store is wired at dashboard boot
// (follow-up after U-0). Until then the singleton-direct wire is
// the `syncDashboardViewModeToContextKeys()` helper below — callers
// invoke it explicitly after flag-change junctions (or at the top
// of each draw) so CKS consumers see the same view as the module.
//
// Additive only for U-0. Flag-driven branches in dashboard.ts stay
// intact; this module layers alongside them.

import {
  deriveViewMode,
  sameViewMode,
  type ViewMode,
  type ViewModeSignals,
} from '../../input-core/view-mode.js';
import { updateDashboardContextKeys } from '../context/keys.js';

/** Signal sources the dashboard exposes to the ViewMode derivation.
 *  Each is a zero-arg getter so the closure can be built once and
 *  re-queried without captures going stale. `inputFocused` is the
 *  only slightly-indirect signal — maps the pane-slot focus check
 *  (`workingDir.focus === 'input'`) into a boolean. */
export interface DashboardViewModeSignals {
  terminalModalId(): string | null;
  modalTopId(): string | null;
  pluginActive(): { id: string; slot?: string } | null;
  chordLeader(): string | null;
  streaming(): boolean;
  inputFocused(): boolean;
}

/** Take a point-in-time snapshot of the signals and derive the current
 *  ViewMode. Pure · no CKS write, no state mutation. Callers that want
 *  to push the result to CKS should use
 *  `syncDashboardViewModeToContextKeys()` instead. */
export function computeDashboardViewMode(
  signals: DashboardViewModeSignals,
): ViewMode {
  const snapshot: ViewModeSignals = {
    terminalModalId: signals.terminalModalId(),
    modalTopId: signals.modalTopId(),
    pluginActive: signals.pluginActive(),
    chordLeader: signals.chordLeader(),
    streaming: signals.streaming(),
    inputFocused: signals.inputFocused(),
  };
  return deriveViewMode(snapshot);
}

/** Derive the ViewMode from `signals` and push the result's `kind`
 *  into the dashboard ContextKeyService singleton. Returns the
 *  derived ViewMode so callers can keep a local snapshot without
 *  computing twice.
 *
 *  Idempotent · CKS.update() is a no-op when the stored value already
 *  matches, so multiple calls per frame cost nothing. Safe to call
 *  from draw() or from individual flag-mutation sites. */
export function syncDashboardViewModeToContextKeys(
  signals: DashboardViewModeSignals,
  prev?: ViewMode,
): ViewMode {
  const next = computeDashboardViewMode(signals);
  if (prev && sameViewMode(prev, next)) return next;
  updateDashboardContextKeys({ viewModeKind: next.kind });
  return next;
}
