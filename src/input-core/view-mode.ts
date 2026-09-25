// ── U-0 · ViewMode — discriminated union over dashboard view states ──
//
// Prior art (TECH-DEBT-input-dispatch-fragmentation §1): "view mode" at
// the dashboard was implicit — inferred from an ad-hoc combination of
// `streamingInFlight`, `chord.armed`, `terminalModalRouter.current()`,
// `pluginHost.active()`, `display.modalStack()`, and `workingDir.focus`.
// Each dispatcher had its own branching tree that could drift from the
// others, which is the root cause of the 5-site duplication chronicled
// in TECH-DEBT §2.
//
// This module introduces an explicit `ViewMode` type + a pure derivation
// function (`deriveViewMode`) + a context-key projection
// (`viewModeContextKeys`). The goal is to give every downstream
// consumer ONE answer to "which mode is the dashboard in right now?"
// that is structurally guaranteed to be consistent across callers.
//
// Phase positioning:
//   - U-0 (this module) · additive only · original flags coexist.
//   - U-2 · unified dispatcher consumes ViewMode instead of individual
//           flag reads.
//   - Legacy flag deletion happens in cleanup PRs after U-2 stabilizes.
//
// See ROADMAP-input-widget-unification §2 + §8 metric table.

export type ViewModeKind =
  | 'terminal-modal'
  | 'modal'
  | 'plugin'
  | 'chord-armed'
  | 'streaming'
  | 'input'
  | 'idle';

/** Discriminated union — every consumer `switch(mode.kind)`.
 *
 *  Ordering of the arms mirrors the priority used by `deriveViewMode`
 *  (first match wins). Priority rationale (TECH-DEBT + audit findings):
 *
 *  1. `terminal-modal` — full-screen PTY · exclusive of everything else.
 *  2. `modal` — overlay on top of chord/streaming/plugin; focus stacks.
 *  3. `plugin` — plugin owns the dashboard layout + pane slots; pre-
 *                empts chord/streaming/input.
 *  4. `chord-armed` — prefix key consumed; next key routed to chord
 *                    body table. Blocks normal dispatch even while
 *                    streaming / input mode.
 *  5. `streaming` — LLM response in flight; scroll keys reinterpret,
 *                  input hands focus to the log pane.
 *  6. `input` — explicit input-prompt focus. Baseline active state.
 *  7. `idle` — default when none of the above signals are live.
 */
export type ViewMode =
  | { readonly kind: 'terminal-modal'; readonly terminalId: string }
  | { readonly kind: 'modal';          readonly modalId: string }
  | { readonly kind: 'plugin';         readonly pluginId: string; readonly slot?: string }
  | { readonly kind: 'chord-armed';    readonly leader: string }
  | { readonly kind: 'streaming' }
  | { readonly kind: 'input' }
  | { readonly kind: 'idle' };

/** Input signals for `deriveViewMode`. Shape is intentionally the
 *  smallest thing that derives a mode — no live-object handles, only
 *  the facts already computable from dashboard state. Callers pass
 *  `null`/`false` for inactive signals.
 *
 *  `modalTop` refers to the topmost modal on the display stack (if
 *  any) — it's what a mode consumer would need to identify the modal
 *  (for when-clause matching / logging). Use `null` when stack empty.
 *
 *  `inputFocused` signals "the input prompt owns keyboard focus right
 *  now" — in the current dashboard, this is `workingDir.focus === 'input'`. */
export interface ViewModeSignals {
  readonly terminalModalId: string | null;
  readonly modalTopId: string | null;
  readonly pluginActive: { readonly id: string; readonly slot?: string } | null;
  readonly chordLeader: string | null;
  readonly streaming: boolean;
  readonly inputFocused: boolean;
}

/** Pure derivation — first-match priority ordering. Never throws; any
 *  combination of signals resolves to exactly one `ViewMode`. */
export function deriveViewMode(s: ViewModeSignals): ViewMode {
  if (s.terminalModalId !== null) {
    return { kind: 'terminal-modal', terminalId: s.terminalModalId };
  }
  if (s.modalTopId !== null) {
    return { kind: 'modal', modalId: s.modalTopId };
  }
  if (s.pluginActive !== null) {
    const base: { kind: 'plugin'; pluginId: string; slot?: string } = {
      kind: 'plugin',
      pluginId: s.pluginActive.id,
    };
    if (s.pluginActive.slot !== undefined) base.slot = s.pluginActive.slot;
    return base;
  }
  if (s.chordLeader !== null) {
    return { kind: 'chord-armed', leader: s.chordLeader };
  }
  if (s.streaming) {
    return { kind: 'streaming' };
  }
  if (s.inputFocused) {
    return { kind: 'input' };
  }
  return { kind: 'idle' };
}

/** Structural equality — cheaper than JSON round-trip, enough for the
 *  bailout check inside the context-keys bridge. Shallow compare of
 *  `kind` + the one or two extra discriminator fields per arm. */
export function sameViewMode(a: ViewMode, b: ViewMode): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'terminal-modal':
      return a.terminalId === (b as { terminalId: string }).terminalId;
    case 'modal':
      return a.modalId === (b as { modalId: string }).modalId;
    case 'plugin':
      return a.pluginId === (b as { pluginId: string }).pluginId
        && a.slot === (b as { slot?: string }).slot;
    case 'chord-armed':
      return a.leader === (b as { leader: string }).leader;
    case 'streaming':
    case 'input':
    case 'idle':
      return true;
  }
}

/** Keys a when-clause (`viewMode.isStreaming`, `viewMode.isChordArmed`,
 *  …) can match against the ContextKeyService. Every kind gets a
 *  `viewMode.is<PascalKind>` key so when-clauses read naturally;
 *  additionally the active kind's key is `true` and every other kind's
 *  key is `false` so a when-clause author can assert negation too. */
export function viewModeContextKeys(mode: ViewMode): Readonly<Record<string, boolean>> {
  const out: Record<string, boolean> = {
    'viewMode.isTerminalModal': false,
    'viewMode.isModal':         false,
    'viewMode.isPlugin':        false,
    'viewMode.isChordArmed':    false,
    'viewMode.isStreaming':     false,
    'viewMode.isInput':         false,
    'viewMode.isIdle':          false,
  };
  switch (mode.kind) {
    case 'terminal-modal': out['viewMode.isTerminalModal'] = true; break;
    case 'modal':          out['viewMode.isModal']         = true; break;
    case 'plugin':         out['viewMode.isPlugin']        = true; break;
    case 'chord-armed':    out['viewMode.isChordArmed']    = true; break;
    case 'streaming':      out['viewMode.isStreaming']     = true; break;
    case 'input':          out['viewMode.isInput']         = true; break;
    case 'idle':           out['viewMode.isIdle']          = true; break;
  }
  return out;
}

/** Convenience · `deriveViewMode` + equality-check + (caller-supplied)
 *  commit. Useful for bridges that need to short-circuit when the
 *  newly-derived mode equals the previous one. Returns the new mode
 *  regardless — callers decide whether to act on equality. */
export function deriveAndDiffViewMode(
  signals: ViewModeSignals,
  prev: ViewMode,
): { readonly next: ViewMode; readonly changed: boolean } {
  const next = deriveViewMode(signals);
  return { next, changed: !sameViewMode(prev, next) };
}

/** The canonical 'idle' sentinel — useful as an initial value for
 *  state slices (`ui.viewMode` defaults to this) so consumers don't
 *  have to null-check. Frozen so accidental mutation is loud. */
export const IDLE_VIEW_MODE: ViewMode = Object.freeze({ kind: 'idle' as const });
