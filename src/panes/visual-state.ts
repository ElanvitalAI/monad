// ── VW-term-infra Bundle A · A3 — PaneVisualState contract + store ──
//
// 4-tuple `{focus, visibility, placement, focusPolicy}` per pane ref.
// Consumers (Alt+N skip, `^B !` toggle, visibility pill, Phase 5
// symmetry bridge tools) subscribe by ref; writers (focus changes,
// VW minimize, LLM `SetFocusPolicy` tool) update via `setState`.
//
// Scope (Bundle A · A3 — *contract + store only*):
//   - Types: 4 axis enums · `PaneVisualState` interface · default value
//   - Store: per-ref Map · subscribe/setState/snapshot · equality-
//     guarded emission (no redundant subscriber calls)
//   - Legal transition matrix: block illegal transitions silently ·
//     emit a debug.log event per mutation (CLAUDE.md §debug 규약)
//   - One demo consumer: `isAltSkipEligible(state)` — the helper that
//     Alt+N pane cycling will consult once Bundle B migrates the
//     consumer call sites
//
// Deferred (Bundle B+):
//   - Alt+N / `^B !` / visibility pill / focusPolicy LLM tool call-site
//     migration (this bundle leaves them on their existing flags)
//   - Coordinate system 0-indexed unification (absorbed by IUL Phase Z
//     for modal surfaces · pane-side work lands with the chord migration)
//   - Persistence across sessions (current store is in-memory only)
//
// PLAN: [`내부 문서 `PLAN-vw-term-bundle-a-closure-substrate``](../../내부 문서 `PLAN-vw-term-bundle-a-closure-substrate`) §3.A3

import { debug } from '../debug/log.js';
import type { PaneRef } from './types.js';

// ── Axis enums ──────────────────────────────────────────────────

export const PANE_FOCUS = {
  /** User keyboard focus is on this pane. Exactly one per window. */
  focused: 'focused',
  /** Pane is in the layout but not the focus target. */
  unfocused: 'unfocused',
} as const;
export type PaneFocus = typeof PANE_FOCUS[keyof typeof PANE_FOCUS];

export const PANE_VISIBILITY = {
  /** Normal on-screen pane painted in the grid. */
  visible: 'visible',
  /** Intentionally hidden via `^B !` toggle · still in layout tree. */
  hidden: 'hidden',
  /** VW minimized / off-screen but not destroyed — Alt+N skips these. */
  dormant: 'dormant',
  /** Pane exists only for LLM consumption (GetUIState shows it · user
   *  cycling/painting ignore it). */
  'llm-only': 'llm-only',
} as const;
export type PaneVisibility = typeof PANE_VISIBILITY[keyof typeof PANE_VISIBILITY];

export const PANE_PLACEMENT = {
  grid: 'grid',
  tab: 'tab',
  float: 'float',
  zoomed: 'zoomed',
} as const;
export type PanePlacement = typeof PANE_PLACEMENT[keyof typeof PANE_PLACEMENT];

export const PANE_FOCUS_POLICY = {
  /** Default — focus cycling visits this pane. */
  normal: 'normal',
  /** Alt+N + `^B o` skip · explicit `setFocus(ref)` still works. */
  skip: 'skip',
  /** Pane never receives focus — even explicit `setFocus` is a no-op. */
  'no-focus': 'no-focus',
} as const;
export type PaneFocusPolicy = typeof PANE_FOCUS_POLICY[keyof typeof PANE_FOCUS_POLICY];

// ── State tuple ─────────────────────────────────────────────────

export interface PaneVisualState {
  readonly focus: PaneFocus;
  readonly visibility: PaneVisibility;
  readonly placement: PanePlacement;
  readonly focusPolicy: PaneFocusPolicy;
}

export const DEFAULT_VISUAL_STATE: PaneVisualState = Object.freeze({
  focus: PANE_FOCUS.unfocused,
  visibility: PANE_VISIBILITY.visible,
  placement: PANE_PLACEMENT.grid,
  focusPolicy: PANE_FOCUS_POLICY.normal,
});

// ── Legal transitions ────────────────────────────────────────────

/** Minimum rule set. Expand in Bundle B once consumer call sites
 *  migrate and we learn which transitions the UX actually emits. */
const ILLEGAL_TRANSITIONS: ReadonlyArray<
  (prev: PaneVisualState, next: PaneVisualState) => string | null
> = [
  // Cannot focus a pane that's dormant or no-focus.
  (prev, next) => {
    if (prev.focus !== PANE_FOCUS.focused && next.focus === PANE_FOCUS.focused) {
      if (prev.visibility === PANE_VISIBILITY.dormant) {
        return 'cannot focus a dormant pane — raise visibility first';
      }
      if (prev.focusPolicy === PANE_FOCUS_POLICY['no-focus']) {
        return 'focusPolicy=no-focus blocks focus';
      }
    }
    return null;
  },
  // Cannot assign 'zoomed' while visibility=hidden.
  (_prev, next) => {
    if (next.placement === PANE_PLACEMENT.zoomed
        && next.visibility === PANE_VISIBILITY.hidden) {
      return 'zoomed + hidden is not a legal combination';
    }
    return null;
  },
];

function checkLegal(prev: PaneVisualState, next: PaneVisualState): string | null {
  for (const rule of ILLEGAL_TRANSITIONS) {
    const err = rule(prev, next);
    if (err) return err;
  }
  return null;
}

// ── Store ───────────────────────────────────────────────────────

export type PaneVisualStateSubscriber = (state: PaneVisualState) => void;

export interface PaneVisualStateStore {
  /** Snapshot the current state (or default when unknown). */
  snapshot(ref: PaneRef): PaneVisualState;
  /** Merge-set: partial payload · equality guarded · illegal
   *  transitions are rejected with a debug.log + no emission. */
  setState(ref: PaneRef, patch: Partial<PaneVisualState>): boolean;
  /** Subscribe to state changes for a specific ref. Returns
   *  unsubscribe. Fires once synchronously with the current state
   *  so consumers don't need to call snapshot. */
  subscribe(ref: PaneRef, cb: PaneVisualStateSubscriber): () => void;
  /** Drop stored state + subscribers for a ref (pane closed). */
  forget(ref: PaneRef): void;
  /** Enumerate ref keys (string-ified) for tests + diagnostics. */
  keys(): readonly string[];
}

export function createVisualStateStore(): PaneVisualStateStore {
  const states = new Map<string, PaneVisualState>();
  const subs = new Map<string, Set<PaneVisualStateSubscriber>>();

  const keyOf = (ref: PaneRef): string =>
    `${ref.windowId}::${ref.paneId}${ref.runnerLabel ? `::${ref.runnerLabel}` : ''}`;

  const equalStates = (a: PaneVisualState, b: PaneVisualState): boolean =>
    a.focus === b.focus
    && a.visibility === b.visibility
    && a.placement === b.placement
    && a.focusPolicy === b.focusPolicy;

  return {
    snapshot(ref) {
      return states.get(keyOf(ref)) ?? DEFAULT_VISUAL_STATE;
    },

    setState(ref, patch) {
      const k = keyOf(ref);
      const prev = states.get(k) ?? DEFAULT_VISUAL_STATE;
      const next: PaneVisualState = {
        focus: patch.focus ?? prev.focus,
        visibility: patch.visibility ?? prev.visibility,
        placement: patch.placement ?? prev.placement,
        focusPolicy: patch.focusPolicy ?? prev.focusPolicy,
      };
      if (equalStates(prev, next)) return false;
      const err = checkLegal(prev, next);
      if (err) {
        if (debug.enabled) {
          debug.log('pane.visual-state.illegal', k, { err, prev, next });
        }
        return false;
      }
      states.set(k, next);
      if (debug.enabled) {
        debug.log('pane.visual-state.transition', k, { prev, next });
      }
      const set = subs.get(k);
      if (set) {
        for (const cb of set) {
          try { cb(next); } catch { /* subscriber isolation */ }
        }
      }
      return true;
    },

    subscribe(ref, cb) {
      const k = keyOf(ref);
      let set = subs.get(k);
      if (!set) { set = new Set(); subs.set(k, set); }
      set.add(cb);
      // Prime with current state (Observer convention).
      try { cb(states.get(k) ?? DEFAULT_VISUAL_STATE); } catch { /* isolate */ }
      return () => {
        const s = subs.get(k);
        if (!s) return;
        s.delete(cb);
        if (s.size === 0) subs.delete(k);
      };
    },

    forget(ref) {
      const k = keyOf(ref);
      states.delete(k);
      subs.delete(k);
    },

    keys() {
      return [...states.keys()];
    },
  };
}

// ── Demo consumer: Alt+N skip eligibility ───────────────────────

/** True when Alt+N pane cycling should skip this pane. Collects the
 *  three conditions that Alt+N cares about (hidden · dormant ·
 *  focusPolicy=skip) so the cycling loop can filter with a single
 *  predicate after Bundle B migrates the call site. */
export function isAltSkipEligible(state: PaneVisualState): boolean {
  return state.visibility === PANE_VISIBILITY.hidden
    || state.visibility === PANE_VISIBILITY.dormant
    || state.focusPolicy === PANE_FOCUS_POLICY.skip
    || state.focusPolicy === PANE_FOCUS_POLICY['no-focus'];
}
