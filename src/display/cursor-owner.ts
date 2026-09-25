// IDX-F5d — Cursor ownership protocol.
//
// `deriveCursor` is the pure successor to `topModalCursor` — same
// job (walk the modal stack top-down, return the first owner's
// CursorState), but with tier-aware rules that match the
// ROADMAP-input-display §3 spec:
//
//   • **Terminal modal** — PTY emulator owns the cursor directly;
//     the coordinator should NOT emit its own CUP for terminal-tier
//     modals. Returns the sentinel "terminal-owned" so callers know
//     to leave the cursor alone rather than hide it.
//   • **Picker tier / focus !== 'owns'** — never claims the cursor;
//     the underlying input (chat prompt etc.) stays the owner so
//     typing during an open picker keeps a live caret.
//   • **Dialog / popup / menu / other tier** — the topmost modal
//     whose `cursor()` returns non-null wins. Falls through to the
//     coordinator's own setCursor state when no modal claims.
//
// The coordinator was already doing the "first non-null cursor()
// wins" walk via modal-stack.topModalCursor; this module upgrades
// that with the tier/focusable gating so the mental model matches
// the documented ownership hierarchy. Follows the existing "pure
// function + thin coordinator integration" pattern (see
// `src/display/hit-target.ts`, `src/display/coordinator-route-key.ts`).
//
// Integration plan: coordinator.flushCursor replaces its inline
// topModalCursor + this.cursor merge with a single `deriveCursor`
// call. This preserves behaviour for existing modals (none declare
// `tier:'terminal'` today) while adding a clean extension point for
// the terminal-tier migration.

import type { CursorState } from './cursor-state.js';
import {
  isModalSurface,
  type ModalSurface,
} from './modal-stack.js';
import type { DisplaySurface, SurfaceId } from './types.js';
import { isBlockingModalInteractionSurface } from './surface-interaction-policy.js';

export interface DeriveCursorInput {
  /** Surface registry (same shape coordinator carries). */
  surfaces: Map<SurfaceId, DisplaySurface>;
  /** Focus stack in bottom→top order — `deriveCursor` walks it
   *  top→bottom to find the first owner. */
  focusStack: readonly SurfaceId[];
  /** Coordinator's own `setCursor` state — used as the fallback when
   *  no modal claims the cursor. */
  coordinatorCursor: CursorState | null;
}

/** Outcome of `deriveCursor`. `owner` identifies which layer won:
 *  `'terminal'` means a terminal-tier modal is topmost and the
 *  coordinator should suppress its own ANSI emission entirely
 *  (pass-through to PTY). `'suppressed'` means a foreground blocking
 *  modal is active but does not claim the cursor, so background
 *  coordinator fallback should stay hidden. `'modal' | 'coordinator'
 *  | 'none'` describe the normal emit path. */
export interface CursorDecision {
  cursor: CursorState | null;
  owner: 'modal' | 'coordinator' | 'terminal' | 'suppressed' | 'none';
  /** For diagnostics — id of the modal that owned the cursor when
   *  `owner === 'modal'` or `'terminal'`. Null otherwise. */
  modalId: SurfaceId | null;
}

/** Iterate the focus stack top→bottom, returning the first owner's
 *  decision. Rules:
 *    1. Top modal with `tier === 'terminal'` → PTY owns; decision
 *       signals 'terminal' so the coordinator leaves the cursor
 *       alone. Lower modals don't override PTY.
 *    2. Modals with `focusable === false` OR `tier === 'picker'`
 *       don't claim the cursor regardless of their cursor() return.
 *    3. First modal whose `cursor()` returns a non-null state wins.
 *    4. Foreground blocking modal with no cursor claim suppresses the
 *       background coordinator fallback.
 *    5. Otherwise fallback to coordinatorCursor with owner
 *       'coordinator' (or 'none' when that is also null). */
export function deriveCursor(input: DeriveCursorInput): CursorDecision {
  const { surfaces, focusStack, coordinatorCursor } = input;
  let suppressingModalId: SurfaceId | null = null;
  for (let i = focusStack.length - 1; i >= 0; i--) {
    const id = focusStack[i]!;
    const s = surfaces.get(id);
    if (!s || !isModalSurface(s)) continue;
    if (suppressingModalId === null
      && isBlockingModalInteractionSurface(s)) {
      suppressingModalId = id;
    }
    if (s.tier === 'terminal') {
      return { cursor: null, owner: 'terminal', modalId: id };
    }
    if (s.focus !== 'owns' || s.tier === 'picker') {
      // Picker tier / paint-only modals never override — keep walking
      // down the stack. This matches the chat picker invariant: the
      // text input beneath retains cursor ownership so typing paints
      // a live caret even while the slash picker is open.
      continue;
    }
    const claim = claimCursor(s);
    if (claim) {
      return { cursor: claim, owner: 'modal', modalId: id };
    }
  }
  if (suppressingModalId !== null) {
    return { cursor: null, owner: 'suppressed', modalId: suppressingModalId };
  }
  if (coordinatorCursor) {
    return { cursor: coordinatorCursor, owner: 'coordinator', modalId: null };
  }
  return { cursor: null, owner: 'none', modalId: null };
}

function claimCursor(modal: ModalSurface): CursorState | null {
  if (typeof modal.cursor !== 'function') return null;
  try {
    return modal.cursor() ?? null;
  } catch {
    return null;
  }
}

/** Convenience — same call signature as legacy
 *  `modal-stack.topModalCursor` for code that just needs the
 *  CursorState and doesn't care about the ownership label. */
export function deriveCursorState(input: DeriveCursorInput): CursorState | null {
  return deriveCursor(input).cursor;
}
