// SessionStore facade entry point (UI-Core arc Phase U1).
//
// Public surface: `getSessionStore()` returns a process-wide singleton
// wired to the five underlying ACP singletons. Dashboard panes +
// status-bar pill + notification bell subscribe here; the store
// aggregates mutations into `SessionStoreEvent`s and recomputes the
// snapshot on demand.

import { globalAcpAgentManager } from '../acp/agent-manager.js';
import { globalDualRoleManager } from '../acp/dual-role-manager.js';
import { globalAcpSessionPersistence } from '../acp/session-persistence.js';
import { globalAcpSessionStore } from '../acp/session-store.js';

import type { BackgroundManager } from '../acp/background-manager.js';
import {
  createSessionStore,
  type SessionStore,
  type SessionStoreDeps,
} from './facade.js';

export * from './events.js';
export * from './shape.js';
export type {
  SessionStore,
  SessionStoreDeps,
  SessionStoreSelector,
  SessionStoreSubscriber,
  SessionStoreRawSubscriber,
  SessionStoreDispatchAction,
} from './facade.js';
export { createSessionStore } from './facade.js';

/** Pluggable BackgroundManager getter · resolved lazily so tests can
 *  install a fake before first snapshot. The production dashboard wires
 *  `setSessionStoreBackgroundManager(globalBackgroundManager())` during
 *  boot — we keep the binding explicit rather than import-time to avoid
 *  the circular between dashboard boot and ACP background plumbing. */
let _backgroundManager: BackgroundManager | null = null;
export function setSessionStoreBackgroundManager(bm: BackgroundManager | null): void {
  _backgroundManager = bm;
  _store = null; // invalidate — next getSessionStore() rebuilds deps
}

let _store: (SessionStore & { detach(): void }) | null = null;

function defaultDeps(): SessionStoreDeps {
  return {
    dualRole: () => globalDualRoleManager(),
    chatMappings: () => globalAcpSessionStore(),
    persistence: () => globalAcpSessionPersistence(),
    agents: () => globalAcpAgentManager(),
    background: () => {
      if (!_backgroundManager) {
        throw new Error(
          'SessionStore: backgroundManager not wired. Call setSessionStoreBackgroundManager() during boot.',
        );
      }
      return _backgroundManager;
    },
  };
}

/** Process-wide SessionStore singleton. Rebuilds on first access after
 *  `_resetSessionStoreForTests()` (or BG manager swap). */
export function getSessionStore(): SessionStore {
  if (!_store) _store = createSessionStore(defaultDeps());
  return _store;
}

/** Test-only — drop listeners + cached singleton. */
export function _resetSessionStoreForTests(): void {
  if (_store) _store.detach();
  _store = null;
  _backgroundManager = null;
}
