// VW-U2 — chord-free virtual-window fast-switch bindings.
//
// Alt+N/P/1..9 are registered as global keybindings on the
// DisplayCoordinator. Gated by a runtime `when` that checks whether
// there's more than one virtual window — if there's only one, the
// Alt+<digit> / Alt+N events pass through so pane content (shells
// using ESC escapes) stay unaffected. Alt+0 (window picker) is
// always on because an empty-list state still wants to show a hint.
//
// Separated from dashboard.ts so tests can exercise the binding
// logic without initialising the full dashboard.

import type { DisplayCoordinator } from '../../display/coordinator.js';
import type { WindowRegistry } from '../../virtual-windows/window-registry.js';
import type { DisplayDisposable } from '../../display/types.js';
import { selectNextFocusablePane } from '../../panes/pane-cycle.js';
import {
  isAltSkipEligible,
  type PaneVisualStateStore,
} from '../../panes/visual-state.js';
import { debug } from '../../debug/log.js';

export interface VwFastSwitchDeps {
  display: DisplayCoordinator;
  registry: WindowRegistry;
  /** Called when Alt+0 fires. Usually the dashboard's openWindowPicker. */
  openPicker: () => void;
  /** Whether Alt+N/P/1..9 window-switch bindings are registered. */
  enableWindowSwitchKeys?: boolean;
  /** Bundle B-7-δ — PaneVisualStateStore consulted when `Alt+o` /
   *  `Alt+O` cycle panes within the current window. Optional so
   *  hosts that don't expose a store can still wire Alt+N/P/digit
   *  bindings; when omitted the pane-cycle chord binding is not
   *  registered (no-op). */
  store?: PaneVisualStateStore;
}

/** Register Alt+N/P/1..9/0 against the given coordinator. Returns a
 *  dispose function that cleans up all bindings. */
export function registerVwFastSwitchBindings(deps: VwFastSwitchDeps): () => void {
  const { display, registry, openPicker } = deps;
  const disposables: DisplayDisposable[] = [];
  const hasMultiple = (): boolean => registry.list().length > 1;

  const register = (binding: Parameters<DisplayCoordinator['registerKeyBinding']>[0]): void => {
    disposables.push(display.registerKeyBinding(binding));
  };

  if (deps.enableWindowSwitchKeys !== false) {
    register({
      id: 'dashboard:vw-fast-next',
      key: 'A-n', // Q4 (substrate Occam): A-ㅜ resolves via KEY_ALIAS_TABLE
      scope: 'global',
      handler: () => { registry.next(); },
      when: () => hasMultiple(),
    });
    register({
      id: 'dashboard:vw-fast-prev',
      key: 'A-p', // Q4: A-ㅔ resolves via KEY_ALIAS_TABLE
      scope: 'global',
      handler: () => { registry.previous(); },
      when: () => hasMultiple(),
    });
    for (let n = 1; n <= 9; n++) {
      register({
        id: `dashboard:vw-fast-digit-${n}`,
        key: `A-${n}`,
        scope: 'global',
        handler: () => {
          const windows = registry.list().sort((a, b) => a.id - b.id);
          const target = windows[n - 1];
          if (target) registry.switchTo(target.id);
        },
        when: () => hasMultiple(),
      });
    }
  }
  register({
    id: 'dashboard:vw-fast-picker',
    key: 'A-0',
    scope: 'global',
    handler: () => { openPicker(); },
  });

  // Bundle B-7-δ — intra-window pane cycling. Only wired when the
  // host supplies a PaneVisualStateStore so the skip predicate
  // (`isAltSkipEligible(store.snapshot(ref))`) has a source. `Alt+o`
  // forward, `Alt+O` backward. `when` gate requires >1 pane in the
  // current window so single-pane windows pass Alt+o through to the
  // focused pane (shell, editor etc.).
  if (deps.store) {
    const store = deps.store;
    const cyclePane = (direction: 'forward' | 'backward'): void => {
      const w = registry.current();
      if (!w) return;
      const panes = w.listPanes().map((p) => p.id);
      if (panes.length <= 1) return;
      const from = w.focused;
      const to = selectNextFocusablePane({
        panes,
        currentFocus: from,
        direction,
        isSkipEligible: (paneId) =>
          isAltSkipEligible(store.snapshot({ windowId: String(w.id), paneId })),
      });
      if (debug.enabled) {
        debug.log('vw.pane.cycle', String(w.id), {
          windowId: String(w.id), from, to,
          direction, total: panes.length,
        });
      }
      if (to) w.setFocus(to);
    };
    const currentHasMultiplePanes = (): boolean => {
      const w = registry.current();
      return !!w && w.listPanes().length > 1;
    };
    register({
      id: 'dashboard:vw-fast-pane-cycle-next',
      key: 'A-o', // Q4: A-ㅐ resolves via KEY_ALIAS_TABLE
      scope: 'global',
      handler: () => cyclePane('forward'),
      when: currentHasMultiplePanes,
    });
    register({
      id: 'dashboard:vw-fast-pane-cycle-prev',
      key: 'A-S-o', // Q4: A-S-ㅐ resolves via KEY_ALIAS_TABLE
      scope: 'global',
      handler: () => cyclePane('backward'),
      when: currentHasMultiplePanes,
    });
  }

  return () => {
    for (const d of disposables) { try { d.dispose(); } catch { /* ignore */ } }
    disposables.length = 0;
  };
}
