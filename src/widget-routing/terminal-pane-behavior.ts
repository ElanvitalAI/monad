// ── VW-term-infra W2 — TerminalPaneBehavior Widget mixin ──
//
// Bridges a TerminalPane (substrate) into the Widget<S> contract
// (Widget Arch Phase 1). Lets widget-host / plugin surfaces treat
// terminal panes uniformly with other widgets — useful for:
//   • Phase 5 symmetry bridge: `describe()` pulls chord+tool info
//     from Widget metadata registries
//   • Future generic widget-host registration of substrate panes
//   • Plugin authors who want to present a terminal as just another
//     widget type in their composition tree
//
// The mixin is strictly structural: it does NOT own the TerminalPane's
// lifecycle (the VW / matrix already does that). It exposes the pane
// through a stable Widget<TerminalPaneState> shape so downstream code
// doesn't need to discriminate on pane kind.
//
// See: 내부 문서 `PLAN-session-vw-term-infra-wiring` §5 (W2)
//      내부 문서 `ROADMAP-vw-term-infra` Phase 5 symmetry bridge

import type { Action, KeyEvent, RenderCtx } from '../plugins/core/types.js';
import type { Widget } from '../widgets/types.js';
import type { TerminalPane } from '../panes/terminal-pane.js';
import type { PaneDispatchResult, PaneKeyEvent, PaneRef } from '../panes/types.js';

/** Minimal state the mixin owns. The TerminalPane itself is the
 *  source of truth for everything else — this state just carries
 *  the pointer + the ref so widget-host callers can inspect it. */
export interface TerminalPaneState {
  readonly paneRef: PaneRef;
  readonly terminalId: string;
}

/** Create a `Widget<TerminalPaneState>` that forwards render / onKey
 *  / lifecycle to the wrapped TerminalPane. */
export function createTerminalPaneWidget(
  pane: TerminalPane,
): Widget<TerminalPaneState> {
  return {
    type: 'pane:terminal',
    description: 'Terminal pane — substrate-backed bridge',

    initialState(): TerminalPaneState {
      return {
        paneRef: pane.ref,
        terminalId:
          pane.kind.kind === 'terminal' ? pane.kind.terminalId : '',
      };
    },

    render(_state: TerminalPaneState, ctx: RenderCtx, _character: string): string[] {
      // Substrate panes do not paint through widget-host — the VW
      // composer renders the real terminal grid. The mixin provides
      // a headline + summary line so widget-host frame builders have
      // something meaningful if this widget is ever rendered outside
      // the VW pipeline (e.g. in a picker preview).
      const desc = pane.describe();
      const lines = [desc.title, desc.summary];
      if (ctx.height >= 2) return lines.slice(0, ctx.height);
      return lines.slice(0, 1);
    },

    onKey(ev: KeyEvent, _state: TerminalPaneState): Action {
      const paneEvt: PaneKeyEvent = {
        key: ev.name,
        raw: ev.sequence,
        ctrl: ev.ctrl,
        alt: ev.alt,
        shift: ev.shift,
      };
      const result = pane.onKey(paneEvt);
      return paneDispatchToAction(result);
    },

    onMount(_state: TerminalPaneState): void {
      // The TerminalPane's mount is driven by the VW composer, not by
      // widget-host. We skip double-mounting here intentionally —
      // widget-host can still inspect .describe() and onKey without
      // owning lifecycle.
    },

    onUnmount(_state: TerminalPaneState): void {
      // Same rationale as onMount.
    },

    behaviors: [],
    children: [],
  };
}

/** Convert a PaneDispatchResult into a widget Action. Async path
 *  collapses to `{type:'none'}` for the Phase 1 synchronous widget
 *  contract — a Phase-later extension can introduce an async Action
 *  envelope. */
export function paneDispatchToAction(
  result: PaneDispatchResult | Promise<PaneDispatchResult>,
): Action {
  if (typeof (result as Promise<PaneDispatchResult>).then === 'function') {
    // Async handlers: fire-and-forget · widget-host refreshes on next
    // key event anyway.
    return { type: 'none' };
  }
  switch (result as PaneDispatchResult) {
    case 'consumed':
      return { type: 'refresh' };
    case 'passthrough':
      return { type: 'none' };
    case 'quit':
      // Widget-host has no direct 'quit' action; we signal deactivate
      // so the plugin that holds this widget can tear down gracefully.
      return { type: 'deactivate' };
    default:
      return { type: 'none' };
  }
}
