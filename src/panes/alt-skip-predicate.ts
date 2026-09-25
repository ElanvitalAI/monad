// ── VW-term-infra Bundle B-7-α — A3 consumer migration (Alt+N) ──
//
// Store-driven predicate that tells WindowRegistry.next()/previous()
// to skip a VirtualWindow whose every pane is Alt+N-skip-eligible per
// the PaneVisualStateStore (Bundle A · A3).
//
// Compose (don't replace) with the existing
// `!w.hasInteractableFocus()` default in dashboard-virtual-windows.ts:
// a window is skipped if EITHER predicate says so. Explicit selection
// (`^B <digit>`, Alt+<digit>, picker, switchTo(id)) bypasses both.
//
// A window with zero panes returns false (don't skip — pathological
// empty windows shouldn't vanish from cycling). A window is skipped
// only when every pane is skip-eligible; mixed windows stay in the
// cycle so the user can still reach a usable pane inside.

import { isAltSkipEligible, type PaneVisualStateStore } from './visual-state.js';
import type { VirtualWindow } from '../virtual-windows/virtual-window.js';
import { debug } from '../debug/log.js';

export function skipWindowWhenStorePredicate(
  store: PaneVisualStateStore,
): (w: VirtualWindow) => boolean {
  return (window) => {
    const panes = window.listPanes();
    if (panes.length === 0) return false;
    const windowId = String(window.id);
    const skip = panes.every(({ id }) =>
      isAltSkipEligible(store.snapshot({ windowId, paneId: id })),
    );
    if (debug.enabled && skip) {
      debug.log('window.vw.altSkip.store', windowId, {
        paneCount: panes.length,
        reason: 'all-panes-skip-eligible',
      });
    }
    return skip;
  };
}
