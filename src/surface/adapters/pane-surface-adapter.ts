// ── IUL Phase S·a — pane-surface adapter ──
//
// PaneFactory cache → SurfaceRegistry. Unlike modal-stack which has a
// push/pop event flow (modal-identity), the pane substrate is a
// **demand-resolved cache** — panes appear in the factory's map
// whenever a consumer (VW composer, capture engine) asks for them.
//
// The adapter offers two complementary entry shapes:
//
//   1. **Snapshot import**: `importFactorySnapshot(registry, factory?)`
//      walks the factory's currently-cached panes and registers each.
//      Useful at boot or "refresh registry now" moments.
//
//   2. **Manual register/update**: `registerPaneSurface(registry, pane)`
//      / `unregisterPaneSurface(registry, ref)` — call sites that
//      know they just resolved or invalidated a pane drive registry
//      sync directly.
//
// PaneFactory does NOT emit cache-mutation events (see panes/factory.ts
// — pure cache, no observer). Adding mutation events is a Phase R task.
// Until then, the dashboard's existing PaneFactory consumers can call
// the manual helpers; missed updates are tolerable because Phase L
// tools snapshot-walk on demand.

import type { Pane } from '../../panes/types.js';
import type { PaneFactory } from '../../panes/factory.js';
import type { SurfaceAddress } from '../address.js';
import type { SurfaceRegistry } from '../registry.js';
import { getSurfaceRegistry } from '../registry.js';
import { getDefaultPaneFactory } from '../../panes/factory.js';

function paneAddr(pane: Pane): SurfaceAddress {
  return { kind: 'pane', ref: pane.ref };
}

function paneTier(pane: Pane): string {
  // VW host surfaces all live in the 'vw' tier per MODAL_TIER.
  return 'vw';
}

function paneTitle(pane: Pane): string {
  try {
    return pane.describe().title;
  } catch {
    return `${pane.kind.kind}-pane`;
  }
}

function paneKindTag(pane: Pane): string {
  return pane.kind.kind;
}

export function registerPaneSurface(
  registry: SurfaceRegistry,
  pane: Pane,
): void {
  registry.register({
    addr: paneAddr(pane),
    kindTag: paneKindTag(pane),
    tier: paneTier(pane),
    title: paneTitle(pane),
    visible: true,
  });
}

export function unregisterPaneSurface(
  registry: SurfaceRegistry,
  ref: Pane['ref'],
): boolean {
  return registry.unregister({ kind: 'pane', ref });
}

export interface ImportSnapshotOpts {
  readonly factory?: PaneFactory;
  readonly registry?: SurfaceRegistry;
  /** Which refs to import. Defaults to all currently-cached refs the
   *  factory exposes through `peekAll()`. Phase 2 of S·a will add
   *  `peekAll` to PaneFactory; until then the caller passes refs
   *  explicitly. */
  readonly refs?: readonly Pane['ref'][];
}

/** Walks `opts.refs` (or empty without refs — until PaneFactory grows
 *  a `peekAll` API) and registers each cached pane in the registry.
 *  Refs whose `factory.peek()` returns undefined are silently skipped. */
export function importFactorySnapshot(opts: ImportSnapshotOpts = {}): number {
  const factory = opts.factory ?? getDefaultPaneFactory();
  const registry = opts.registry ?? getSurfaceRegistry();
  const refs = opts.refs ?? [];
  let registered = 0;
  for (const ref of refs) {
    const pane = factory.peek(ref);
    if (pane) {
      registerPaneSurface(registry, pane);
      registered++;
    }
  }
  return registered;
}
