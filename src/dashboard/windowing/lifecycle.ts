// VW lifecycle wiring — bus subscribers that clean up bindings and
// kill orphan VW-placed terminals when a pane or whole VW closes.
//
// Extracted from dashboard.ts so the wiring can be integration-tested
// with a fake bus + fake terminalMatrix. The inline block inside
// showDashboard() grew subtle (suppression Set + double-subscribe +
// asymmetric event payloads) and needed a regression guard.
//
// See: src/terminal-matrix/vw-lifecycle.ts for the pure helpers this
// module composes.

import {
  findBindingsForPaneClose,
  findLiveVwTerminalIdsForBindings,
  findLiveVwTerminalIdsForWindow,
  type VwPlacedTerminalLike,
} from '../../terminal-matrix/vw-lifecycle.js';
import type { TerminalPlacement } from '../../terminal-matrix/types.js';
import type { PaneId } from '../../virtual-windows/addressing.js';
import { debug } from '../../debug/log.js';

/** Shape of the VW event bus we consume. We only need `subscribe` and
 *  only for `pane:close` + `window:close` types. Re-declared here
 *  (vs importing `VWEventBus`) so tests can stub a two-method object
 *  without pulling in the full addressing graph. */
export interface VwLifecycleBus {
  subscribe(
    filter: { types?: string[] },
    cb: (ev: VwLifecycleEvent) => void,
  ): () => void;
}

export type VwLifecycleEvent =
  | { type: 'pane:close'; addr: string; at?: number }
  | { type: 'window:close'; windowId: number | string; at?: number }
  | { type: string; [k: string]: unknown };

/** Shape of the terminal matrix we consume. `list` must expose placement
 *  + exitCode + id; `kill` must be best-effort (we wrap in try/catch). */
export interface VwLifecycleTerminalMatrix {
  list(opts: { includeExited: true }): Iterable<VwPlacedTerminalLike>;
  kill(id: string): void;
}

export interface VwLifecycleDeps {
  bus: VwLifecycleBus;
  terminalMatrix: VwLifecycleTerminalMatrix;
  /** `${windowId}/${slotId}` → paneId. Mutated by handler (stale
   *  bindings dropped on pane:close / window:close). */
  bindings: Map<string, PaneId>;
  /** Pane IDs whose kill has already been executed by the matrix-
   *  driven removal path (VwPlacementAdapter.removeSlot). Handler
   *  consumes (deletes) the entry and skips the extra kill. */
  suppressedKills: Set<PaneId>;
}

/** Install the two subscribers. Returns a disposer that removes both.
 *  Idempotent: calling the disposer twice is a no-op (bus subscribers
 *  already handle repeated dispose). */
export function installVwLifecycleHandlers(deps: VwLifecycleDeps): () => void {
  const disposers: Array<() => void> = [];

  disposers.push(deps.bus.subscribe({ types: ['pane:close'] }, (ev) => {
    if (ev.type !== 'pane:close') return;
    const addr = typeof ev.addr === 'string' ? ev.addr : '';
    const paneId = addr.replace(/^pane:/, '');
    const bindings = findBindingsForPaneClose(deps.bindings, paneId);
    for (const b of bindings) {
      deps.bindings.delete(b.bindingKey);
    }
    const wasSuppressed = deps.suppressedKills.delete(paneId);
    if (debug.enabled) {
      debug.log('vw.lifecycle.paneClose', paneId, {
        paneId,
        bindingsDropped: bindings.length,
        suppressed: wasSuppressed,
      });
    }
    if (wasSuppressed) return;
    const victims = findLiveVwTerminalIdsForBindings(
      deps.terminalMatrix.list({ includeExited: true }),
      bindings,
    );
    if (debug.enabled && victims.length > 0) {
      debug.log('vw.lifecycle.kill', 'pane', { paneId, victims });
    }
    for (const id of victims) {
      try { deps.terminalMatrix.kill(id); } catch { /* already gone */ }
    }
  }));

  disposers.push(deps.bus.subscribe({ types: ['window:close'] }, (ev) => {
    if (ev.type !== 'window:close') return;
    const windowId = String((ev as { windowId: number | string }).windowId);
    const victims = findLiveVwTerminalIdsForWindow(
      deps.terminalMatrix.list({ includeExited: true }),
      windowId,
    );
    let bindingsDropped = 0;
    for (const key of [...deps.bindings.keys()]) {
      if (key.startsWith(`${windowId}/`)) {
        deps.bindings.delete(key);
        bindingsDropped++;
      }
    }
    if (debug.enabled) {
      debug.log('vw.lifecycle.windowClose', windowId, {
        windowId,
        victims,
        bindingsDropped,
      });
    }
    for (const id of victims) {
      try { deps.terminalMatrix.kill(id); } catch { /* already gone */ }
    }
  }));

  return () => {
    for (const d of disposers) {
      try { d(); } catch { /* ignore */ }
    }
  };
}

// ── VW pane auto-close on terminal exit ───────────────────────────
//
// Symmetric counterpart to installVwLifecycleHandlers: when a VW-placed
// terminal exits (user types `exit`) or is killed externally, the VW
// pane that was hosting it should close too — otherwise the user is
// left staring at a dead shell pane with stale history and no keyboard
// input. closePaneAt → emits `pane:close` → the regular handler drops
// the binding. The kill side-effect is a no-op because the terminal
// already has exitCode !== null (findLiveVwTerminalIdsForBindings
// skips it).
//
// Extracted so the decision can be unit-tested with a fake vw registry
// + fake bindings map. No visible dashboard import required.

export interface VwRegistryHandle {
  closePaneAt(paneId: PaneId): boolean;
}

export interface VwExitPaneCloserDeps {
  /** Look up a VirtualWindow by numeric id. Returns null if the window
   *  no longer exists (already closed via window:close). */
  getVirtualWindow: (id: number) => VwRegistryHandle | null | undefined;
  /** Read-only view of `${windowId}/${slotId}` → paneId. Used to
   *  resolve the paneId when the matrix-driven chord path stashed a
   *  non-slotId paneId at spawn time. Fallback: slotId === paneId. */
  bindings: ReadonlyMap<string, PaneId>;
}

export interface VwExitPaneCloseResult {
  closed: boolean;
  reason?: 'not-vw' | 'bad-window-id' | 'no-window' | 'no-op' | 'threw';
}

/** Returns a function that closes the VW pane hosting the given
 *  placement (if any). Safe to call with any TerminalPlacement; only
 *  `kind:'vw'` triggers work. */
export function createVwExitPaneCloser(
  deps: VwExitPaneCloserDeps,
): (placement: TerminalPlacement, originEvent: 'exited' | 'killed') => VwExitPaneCloseResult {
  return (placement, originEvent) => {
    if (placement.kind !== 'vw') return { closed: false, reason: 'not-vw' };
    const { windowId, slotId } = placement;
    const winNum = Number(windowId);
    if (!Number.isFinite(winNum)) return { closed: false, reason: 'bad-window-id' };
    const w = deps.getVirtualWindow(winNum);
    if (!w) return { closed: false, reason: 'no-window' };
    const paneId = deps.bindings.get(`${windowId}/${slotId}`) ?? slotId;
    let did = false;
    let threw = false;
    try {
      did = w.closePaneAt(paneId);
    } catch { threw = true; }
    if (debug.enabled) {
      debug.log('vw.lifecycle.exitClose', originEvent, {
        windowId, slotId, paneId, closed: did, threw,
      });
    }
    if (threw) return { closed: false, reason: 'threw' };
    return { closed: did, reason: did ? undefined : 'no-op' };
  };
}
