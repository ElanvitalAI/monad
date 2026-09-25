// ── Presentation track P1.5 · ContextKeys ↔ store.ui.context bridge ──
//
// Mirrors IDX-2a's `ContextKeyService` (src/input-core/context-keys.ts)
// into the P1 state store's `ui.context` slot (and back). Both sides
// stay authoritative for their existing consumers — the bridge only
// forwards diffs. Loop termination relies on equality skip: each
// direction checks the counterpart's current value before writing, so
// a cycle of writes collapses in one hop without sentinels or nonces.
//
// Scope per HANDOFF §2:
//   - Additive only — zero call-site changes to ContextKeys or store.
//   - Pure type import from `context-keys.ts` · core logic untouched.
//   - Install is opt-in · caller owns the dispose lifecycle (plugin-host
//     or dashboard wiring lands in a subsequent PR).
//
// Debug junctions (CLAUDE.md 규율):
//   - state.bridge.context-keys.attach     · initial sync summary
//   - state.bridge.context-keys.ck-to-store · forward write
//   - state.bridge.context-keys.store-to-ck · reverse write
//   - state.bridge.context-keys.dispose     · teardown

import { debug } from '../../debug/log.js';
import {
  INITIAL_CONTEXT_KEYS,
  type ContextKeyName,
  type ContextKeyService,
  type ContextKeys,
} from '../../input-core/context-keys.js';
import type { MonadState } from '../types.js';
import type { Store } from '../types.js';

type CKRecord = Record<string, unknown>;

/** Read the `ui.context` sub-object from a MonadState store. Returns an
 *  empty object when the slot is absent. */
function readStoreContext(store: Store<MonadState>): CKRecord {
  const ui = store.getState().ui as CKRecord;
  const ctx = ui.context;
  if (ctx && typeof ctx === 'object') return ctx as CKRecord;
  return {};
}

/** Write a key/value patch into `ui.context` via setState, preserving
 *  other ui fields and other context keys. Always produces a new
 *  `ui.context` reference so store subscribers re-select correctly. */
function writeStoreContext(store: Store<MonadState>, patch: CKRecord): void {
  store.setState((s) => {
    const prevUi = s.ui as CKRecord;
    const prevCtx = (prevUi.context as CKRecord | undefined) ?? {};
    return {
      ui: {
        ...s.ui,
        context: { ...prevCtx, ...patch },
      },
    };
  });
}

/** Attach bidirectional sync between a MonadState store's `ui.context`
 *  slice and a legacy `ContextKeyService`.
 *
 *  Semantics:
 *    - On attach, ContextKeys values are pushed into the store (CK is
 *      authoritative for pre-existing consumers · HANDOFF §6.2).
 *    - ContextKeys.update(...) → store.setState mirror write.
 *    - store.setState(ui.context = ...) → contextKeys.update() mirror.
 *    - Loop termination: both directions compare against the
 *      counterpart's current value before writing. A value already
 *      present on the other side is a no-op, so mirror-of-mirror
 *      collapses in one hop without sentinel flags.
 *    - Disposer is idempotent · calling twice is a no-op.
 *
 *  The bridge does NOT create `ui.context` in the store's type — it
 *  relies on UISlice's `[key: string]: unknown` index signature. The
 *  store and ContextKeys each own their read path; consumers pick
 *  whichever surface suits them. */
export function bridgeContextKeysToStore(
  store: Store<MonadState>,
  contextKeys: ContextKeyService,
): () => void {
  // Whitelist of keys the bridge is willing to mirror · derived from
  // INITIAL_CONTEXT_KEYS so unknown store-side keys (e.g. consumer
  // scratch) don't get force-fed back into ContextKeys.update().
  const KNOWN_KEYS = Object.keys(INITIAL_CONTEXT_KEYS) as ContextKeyName[];
  const KNOWN_SET = new Set<string>(KNOWN_KEYS);

  // ── Initial sync (CK → store, one-shot) ────────────────────────
  {
    const ckKeys = contextKeys.keys;
    const storeCtx = readStoreContext(store);
    const initPatch: CKRecord = {};
    for (const k of KNOWN_KEYS) {
      const ckVal = (ckKeys as unknown as CKRecord)[k];
      if (storeCtx[k] !== ckVal) initPatch[k] = ckVal;
    }
    const initCount = Object.keys(initPatch).length;
    if (initCount > 0) writeStoreContext(store, initPatch);
    if (debug.enabled) {
      debug.log('state.bridge.context-keys.attach', 'init-sync', {
        pushed: initCount,
        total: KNOWN_KEYS.length,
      });
    }
  }

  // ── Forward · ContextKeys → store ──────────────────────────────
  const unsubCK = contextKeys.subscribe((keys, changed) => {
    // `subscribe` primes with an empty change list so new subscribers
    // can self-initialise. Initial sync already handled that above.
    if (changed.length === 0) return;
    const storeCtx = readStoreContext(store);
    const patch: CKRecord = {};
    for (const k of changed) {
      const val = (keys as unknown as CKRecord)[k];
      if (storeCtx[k] === val) continue; // store already has it — we caused this
      patch[k] = val;
    }
    const count = Object.keys(patch).length;
    if (count === 0) return;
    writeStoreContext(store, patch);
    if (debug.enabled) {
      debug.log('state.bridge.context-keys.ck-to-store', 'forward', {
        keys: Object.keys(patch),
      });
    }
  });

  // ── Reverse · store.ui.context → ContextKeys ───────────────────
  const unsubStore = store.subscribe(
    (s) => (s.ui as CKRecord).context as CKRecord | undefined,
    (next) => {
      if (!next) return;
      const ckKeys = contextKeys.keys as unknown as CKRecord;
      const patch: Partial<ContextKeys> = {};
      for (const k of Object.keys(next)) {
        if (!KNOWN_SET.has(k)) continue;
        const val = next[k];
        if (val === undefined) continue; // CK.update skips undefined; no way to "delete"
        if (ckKeys[k] === val) continue; // CK already has it — we caused this
        (patch as CKRecord)[k] = val;
      }
      const count = Object.keys(patch).length;
      if (count === 0) return;
      contextKeys.update(patch);
      if (debug.enabled) {
        debug.log('state.bridge.context-keys.store-to-ck', 'reverse', {
          keys: Object.keys(patch),
        });
      }
    },
    { name: 'bridge.context-keys.ui-context' },
  );

  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    unsubCK();
    unsubStore();
    if (debug.enabled) {
      debug.log('state.bridge.context-keys.dispose', 'detached', {});
    }
  };
}
