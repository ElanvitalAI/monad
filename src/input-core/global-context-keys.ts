// ── IDX-2a consumer: module-level ContextKeys singleton ──
//
// IDX-2a shipped `createContextKeyService(...)` as a pure factory. To
// let multiple parallel tracks (PFC / TOX / display) publish onto the
// *same* snapshot, we expose a shared singleton + an owner-gated
// `publishContextKey` helper.
//
// Owner gate: each ContextKey name belongs to exactly one owner
// (OWNER_KEY_MAP). Publishing a key with the wrong owner throws — a
// dev-time guard against cross-track collisions (PLAN-session-
// prefrontal-cortex.md §20.3 naming rules).

import {
  createContextKeyService,
  type ContextKeyName,
  type ContextKeys,
  type ContextKeyService,
} from './context-keys.js';

export type ContextKeyOwner = 'pfc' | 'task' | 'display' | 'input' | 'test';

/** Static ownership map. Mirrors PLAN §20.3. Update together with the
 *  `ContextKeys` interface when a new key is added. */
export const OWNER_KEY_MAP: Record<ContextKeyOwner, readonly ContextKeyName[]> = {
  input: ['focusMode', 'activePaneId', 'planModeActive', 'syncModeActive', 'controlModeActive'],
  display: ['modalTopTier', 'pickerOpen', 'popupOpen', 'dialogOpen', 'terminalModalActive'],
  pfc: ['autoModeActive', 'budgetWarningActive', 'escalationPending'],
  task: [],   // reserved for TOX track; empty until TOX adds keys
  test: [],   // sentinel — bypasses ownership checks
};

let service: ContextKeyService = createContextKeyService();

/** Exposed as a getter so tests can swap via resetGlobalContextKeysForTest. */
export function getGlobalContextKeyService(): ContextKeyService {
  return service;
}

/** Back-compat alias — most callers use the function form so a test
 *  reset is observed. */
export const globalContextKeyService = new Proxy({} as ContextKeyService, {
  get(_t, prop) {
    return (service as unknown as Record<string | symbol, unknown>)[prop];
  },
});

/** Publish a single key under a declared owner. Throws when:
 *   - owner is unknown
 *   - owner isn't listed as the key's owner in OWNER_KEY_MAP (unless
 *     owner==='test', which bypasses checks).
 *  The actual value update still goes through the underlying service's
 *  equality check — repeated identical values do NOT fire subscribers. */
export function publishContextKey<K extends ContextKeyName>(
  key: K,
  value: ContextKeys[K],
  owner: ContextKeyOwner,
): void {
  if (!(owner in OWNER_KEY_MAP)) {
    throw new Error(`publishContextKey: unknown owner "${owner}"`);
  }
  if (owner !== 'test') {
    const allowed = OWNER_KEY_MAP[owner];
    if (!allowed.includes(key)) {
      throw new Error(
        `publishContextKey: owner "${owner}" cannot write key "${key}" `
        + `(allowed: ${allowed.length === 0 ? '(none)' : allowed.join(', ')})`,
      );
    }
  }
  service.update({ [key]: value } as Partial<ContextKeys>);
}

/** Test seam — rebuild the singleton with initial state. Call in
 *  beforeEach. Does NOT affect ContextKeys interface or OWNER_KEY_MAP. */
export function resetGlobalContextKeysForTest(): void {
  service = createContextKeyService();
}
