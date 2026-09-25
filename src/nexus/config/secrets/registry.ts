// NEXUS · SecretBackend registry (Phase N-3.5 PR σ)
//
// Singleton mapping `SecretBackendId → SecretBackend` plus a "current"
// pointer driven by `global.secrets.backend` SwitchRegistry value. The
// boot path (runNexus) calls `selectBackendFromConfig()` once after
// builtins load; tests can override directly via `useBackend(id)`.

import type { SecretBackend, SecretBackendId } from './types.js';
import { fileBackend } from './file-backend.js';
import { readUserConfig, readSwitchValue } from '../user-config.js';

const backends = new Map<SecretBackendId, SecretBackend>();
let currentId: SecretBackendId = 'file';

// Always register FileBackend (always available; default).
backends.set('file', fileBackend);

export function registerBackend(backend: SecretBackend): void {
  backends.set(backend.id, backend);
}

export function getBackend(id: SecretBackendId): SecretBackend | undefined {
  return backends.get(id);
}

export function listBackendIds(): SecretBackendId[] {
  return [...backends.keys()];
}

export function currentBackend(): SecretBackend {
  const b = backends.get(currentId);
  if (!b) throw new Error(`secret backend not registered: ${currentId}`);
  return b;
}

export function currentBackendId(): SecretBackendId {
  return currentId;
}

/** Tests + boot path use this to switch the active backend. Throws when
 *  the backend isn't registered (PR σ ships only 'file'; PR υ adds the
 *  rest). */
export function useBackend(id: SecretBackendId): void {
  if (!backends.has(id)) {
    throw new Error(`secret backend not registered: ${id} (registered: ${[...backends.keys()].join(',')})`);
  }
  currentId = id;
}

/** Reads `global.secrets.backend` from UserConfig and switches. Falls
 *  back to 'file' when unset / unknown. Returns the resolved id. */
export function selectBackendFromConfig(): SecretBackendId {
  const cfg = readUserConfig();
  const raw = readSwitchValue(cfg, 'global.secrets.backend');
  const id = typeof raw === 'string' && backends.has(raw as SecretBackendId)
    ? (raw as SecretBackendId)
    : 'file';
  currentId = id;
  return id;
}

/** Test seam — clears non-file backends and resets current to 'file'. */
export function resetBackendRegistry(): void {
  for (const id of [...backends.keys()]) {
    if (id !== 'file') backends.delete(id);
  }
  currentId = 'file';
}
