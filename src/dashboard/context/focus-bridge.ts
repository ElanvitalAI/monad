// IDX-2c Phase 2 — focusMode + activePaneId ContextKeys bridge.
//
// The dashboard tracks focus via `workingDir.focus: PaneFocus` (a
// string union like 'input' | 'browser' | 'chat' | ...) + the modal
// stack in the coordinator. Neither exposes an observer today —
// focus is mutated by direct assignment from dozens of call-sites
// (keystroke handlers, mouse clicks, slash commands).
//
// Rather than retrofit an observer pattern on every assignment,
// this bridge offers a `publishFocusContextKeys()` function the
// dashboard calls at each draw tick. ContextKeyService is
// equality-gated internally, so repeat calls with unchanged state
// are cheap no-ops.
//
// Result:
//   - `focusMode` — 'input' | 'pane' | 'modal' | 'terminal'
//   - `activePaneId` — the PaneFocus value when focusMode === 'pane',
//     otherwise null
//
// Decision table (highest tier wins):
//   terminalModalActive   → focusMode = 'terminal'
//   any other modal open  → focusMode = 'modal'
//   focus === 'input'     → focusMode = 'input'
//   anything else         → focusMode = 'pane' + activePaneId = focus
//
// The caller supplies the current PaneFocus + the top modal tier
// (from ContextKeys or the coordinator); this module does not read
// globals beyond the context-key service itself.

import type { PaneFocus } from '../../workspace-types.js';
import type { ContextKeyService } from '../../input-core/context-keys.js';
import { getDashboardContextKeyService } from './keys.js';

export type FocusMode = 'input' | 'pane' | 'modal' | 'terminal';

export interface PublishFocusOpts {
  /** Current `workingDir.focus`. */
  focus: PaneFocus;
  /** True when a terminal-tier modal is active (PTY / interactive
   *  shell). Equivalent to `ContextKeys.terminalModalActive`; the
   *  caller passes it verbatim for clarity. */
  terminalModalActive: boolean;
  /** True when any other modal is open (picker/popup/dialog/approval/
   *  vw-picker). OR of the individual tier flags. */
  anyModalOpen: boolean;
  /** Override the service (tests). */
  service?: ContextKeyService;
}

/** Compute the (focusMode, activePaneId) tuple given raw state.
 *  Pure — exported for unit tests. */
export function deriveFocusContextKeys(opts: {
  focus: PaneFocus;
  terminalModalActive: boolean;
  anyModalOpen: boolean;
}): { focusMode: FocusMode; activePaneId: string | null } {
  if (opts.terminalModalActive) {
    return { focusMode: 'terminal', activePaneId: null };
  }
  if (opts.anyModalOpen) {
    return { focusMode: 'modal', activePaneId: null };
  }
  if (opts.focus === 'input') {
    return { focusMode: 'input', activePaneId: null };
  }
  return { focusMode: 'pane', activePaneId: opts.focus };
}

/** Publish the derived focus context keys. Safe to call on every
 *  draw tick — the underlying ContextKeyService short-circuits when
 *  values are unchanged. */
export function publishFocusContextKeys(opts: PublishFocusOpts): void {
  const svc = opts.service ?? getDashboardContextKeyService();
  const derived = deriveFocusContextKeys({
    focus: opts.focus,
    terminalModalActive: opts.terminalModalActive,
    anyModalOpen: opts.anyModalOpen,
  });
  svc.update(derived);
}

/** Convenience wrapper — reads the modal flags from a ContextKeys
 *  snapshot rather than taking them as individual args. The caller
 *  supplies `focus` + the service; flags come from the service's
 *  own key state (single source of truth for modal lifecycles). */
export function publishFocusContextKeysFromService(
  focus: PaneFocus,
  service?: ContextKeyService,
): void {
  const svc = service ?? getDashboardContextKeyService();
  const keys = svc.keys;
  const anyModalOpen =
    keys.pickerOpen
    || keys.popupOpen
    || keys.dialogOpen;
  publishFocusContextKeys({
    focus,
    terminalModalActive: keys.terminalModalActive,
    anyModalOpen,
    service: svc,
  });
}
