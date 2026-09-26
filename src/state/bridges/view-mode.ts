// ── U-0 · view-mode bridge · store.ui.viewMode ↔ ContextKeys.viewModeKind ──
//
// Pairs with `src/input-core/view-mode.ts`. Dashboard (or any other
// owner) calls `store.setState({ ui: { ...ui, viewMode: derived }})`
// at each flag-change junction. This bridge observes that slot and
// mirrors the discriminator to `ContextKeys.viewModeKind` so every
// when-clause consumer (input-core binding resolver, when-clause
// evaluator, keybinding gate) sees one consistent signal.
//
// Direction: store → ContextKeys (one-way). Publishing is owned by
// the store — ContextKeys never writes viewModeKind itself.
//
// Loop prevention: single-direction write. `updateViewMode(...)` on
// CKS is idempotent (no-op when value already equal); the existing
// P1.5 ContextKeys bridge still syncs the CK update back into
// `store.ui.context.viewModeKind` → which is a different slot from
// `store.ui.viewMode`, so no cycle.
//
// Scope (U-0):
//   - Additive only · zero changes to existing mode-flag paths.
//   - Init-sync pushes the current `store.ui.viewMode.kind` (or null
//     when slot absent) into CKS once on attach.
//   - Disposer is idempotent.
//
// Debug junctions (CLAUDE.md 규율):
//   - state.bridge.view-mode.attach      · initial sync summary
//   - state.bridge.view-mode.store-to-ck · forward write
//   - state.bridge.view-mode.dispose     · teardown

import { debug } from '../../debug/log.js';
import type { ContextKeyService } from '../../input-core/context-keys.js';
import type { ViewMode } from '../../input-core/view-mode.js';
import type { ElanousState, Store } from '../types.js';

/** Attach one-way sync from `store.ui.viewMode` → `CKS.viewModeKind`.
 *
 *  Caller publishes viewMode changes via `store.setState` using
 *  `deriveViewMode(signals)` from `input-core/view-mode.ts`; this
 *  bridge propagates the `kind` to the context-keys service so
 *  when-clauses pick up the change without extra boilerplate.
 *
 *  Returns a disposer — idempotent. */
export function bridgeViewModeToContextKeys(
  store: Store<ElanousState>,
  contextKeys: ContextKeyService,
): () => void {
  // ── Initial sync ────────────────────────────────────────────────
  {
    const initial = readViewMode(store);
    const kind = initial?.kind ?? null;
    const curr = contextKeys.keys.viewModeKind;
    if (curr !== kind) {
      contextKeys.update({ viewModeKind: kind });
    }
    if (debug.enabled) {
      debug.log('state.bridge.view-mode.attach', 'init-sync', {
        initial: kind, prev: curr,
      });
    }
  }

  // ── Forward · store.ui.viewMode → CKS.viewModeKind ─────────────
  const unsub = store.subscribe(
    (s) => (s.ui as { viewMode?: ViewMode }).viewMode,
    (next, prev) => {
      const nextKind = next?.kind ?? null;
      const prevKind = prev?.kind ?? null;
      if (nextKind === prevKind) return; // shape changed but kind same
      const currCK = contextKeys.keys.viewModeKind;
      if (currCK === nextKind) return;   // CK already matches (unlikely here)
      contextKeys.update({ viewModeKind: nextKind });
      if (debug.enabled) {
        debug.log('state.bridge.view-mode.store-to-ck', 'forward', {
          prev: prevKind, next: nextKind,
        });
      }
    },
    { name: 'bridge.view-mode' },
  );

  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    unsub();
    if (debug.enabled) {
      debug.log('state.bridge.view-mode.dispose', 'detached', {});
    }
  };
}

/** Convenience publisher — writes a new `ViewMode` into
 *  `store.ui.viewMode`, preserving unrelated UI fields. Pair with the
 *  bridge so CKS stays in sync. Callers compute the ViewMode via
 *  `deriveViewMode(signals)` from `input-core/view-mode.ts` and pass
 *  it here.
 *
 *  When the newly published mode equals the current one (structural
 *  `sameViewMode`), the write is skipped to keep store subscribers
 *  from firing. Use `deriveAndDiffViewMode` at the call site when you
 *  want to short-circuit even earlier. */
export function publishViewMode(
  store: Store<ElanousState>,
  next: ViewMode,
): void {
  const prev = readViewMode(store);
  if (prev && sameShallow(prev, next)) return;
  store.setState((s) => ({
    ui: { ...s.ui, viewMode: next },
  }));
}

function readViewMode(store: Store<ElanousState>): ViewMode | undefined {
  return (store.getState().ui as { viewMode?: ViewMode }).viewMode;
}

/** Shallow structural compare — cheap enough to run on every publish.
 *  Returns false on kind mismatch. Full structural equality lives in
 *  `input-core/view-mode.ts::sameViewMode`; the publisher only needs
 *  to catch "same kind + same discriminator" to drop no-op writes. */
function sameShallow(a: ViewMode, b: ViewMode): boolean {
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
