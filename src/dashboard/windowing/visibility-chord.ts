// ── VW-term Bundle B-7-β · user-writable visibility chord ──
//
// `^B H` → toggles the currently focused pane's `visibility` in the
// PaneVisualStateStore between `visible` and `hidden`. Symmetric to
// the LLM-only input path (SetFocusPolicy tool landed in B-1) — now
// the user has a chord path into the same store. Continues the P7-A
// consumer-migration arc that B-7-α (Alt+N window skip) opened.
//
// Factory + deps-injection shape so unit tests can exercise the
// handler without spinning up a full dashboard (no VW registry, no
// xterm, no draw loop). The real dashboard wiring lives in dashboard.ts
// and just passes `virtualWindows.registry.current()` + the shared
// `paneVisualStateStore`.
//
// PLAN: 내부 문서 `PLAN-vw-term-bundle-b7-beta-visibility-user-toggle`

import type {
  PaneVisibility,
  PaneVisualStateStore,
} from '../../panes/visual-state.js';
import { debug } from '../../debug/log.js';

export interface VisibilityChordCurrentWindow {
  readonly id: number | string;
  readonly focused: string;
}

export interface VisibilityChordDeps {
  /** Resolve the foreground VW. Null when no window is open — handler
   *  surfaces a toast and exits without touching the store. */
  getCurrentWindow: () => VisibilityChordCurrentWindow | null;
  /** The shared PaneVisualStateStore instance (created once in
   *  showDashboard). Only `snapshot` + `setState` are called. */
  store: Pick<PaneVisualStateStore, 'snapshot' | 'setState'>;
  /** Optional toast surface for user-visible feedback. Called with
   *  (title, lines). Omit for tests that don't care about UX. */
  showToast?: (title: string, lines: string[]) => void;
}

/** Default toggle: `visible` → `hidden`, any other state → `visible`.
 *  Separated so tests can verify the mapping without reaching into
 *  the handler body. */
export function nextVisibility(current: PaneVisibility): PaneVisibility {
  return current === 'visible' ? 'hidden' : 'visible';
}

/** Build the chord handler. Returns a void-returning function ready
 *  to pass as `display.registerKeyBinding({handler: ...})`. */
export function createVisibilityChordHandler(
  deps: VisibilityChordDeps,
): () => void {
  return () => {
    const win = deps.getCurrentWindow();
    if (!win) {
      deps.showToast?.('visibility', ['no foreground window']);
      if (debug.enabled) {
        debug.log('vw.visibility.chord', '(no-window)', { accepted: false });
      }
      return;
    }
    const ref = { windowId: String(win.id), paneId: win.focused };
    const cur = deps.store.snapshot(ref);
    const next = nextVisibility(cur.visibility);
    const accepted = deps.store.setState(ref, { visibility: next });
    if (debug.enabled) {
      debug.log('vw.visibility.chord', win.focused, {
        windowId: ref.windowId,
        paneId: ref.paneId,
        from: cur.visibility,
        to: next,
        accepted,
      });
    }
    const tail = accepted ? '' : ' (rejected)';
    deps.showToast?.('visibility', [`${win.focused} → ${next}${tail}`]);
  };
}
