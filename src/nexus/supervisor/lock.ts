// NEXUS · single-instance lock (Phase N-1 PR α)
//
// One `monad nexus` process per host at a time. Reuses the
// telegram-lock primitive (LockMeta · acquire / safeRead / isAlive)
// so all monad locks (telegram / scheduler / daemon / nexus) share
// the same shape. The lock lives at `~/.monad/nexus/.lock` (dotfile
// per N1-3 decision · convention: file in dir, not sibling).
//
// Why dotfile: `find` / `ls` of the directory shows `.lock` clearly
// as a hidden file vs runtime.json; sibling `~/.monad/nexus.lock`
// would conflict with the future `nexus/` directory entry.

import {
  acquireTelegramLock,
  safeReadLock,
  isAliveLock,
  TelegramLockError,
  type AcquireOpts,
  type LockMeta,
} from '../../telegram-lock.js';
import { nexusLockPath, nexusRootDir, ensureNexusRootDir, getTestStateRoot } from '../paths.js';
import { readNexusRuntimeAt, type NexusRuntimeMeta } from '../runtime.js';
import { join as joinPath } from 'node:path';

export type NexusLockMeta = LockMeta;
export class NexusLockError extends TelegramLockError {}

export function acquireNexusLock(opts: AcquireOpts = {}): () => void {
  ensureNexusRootDir();
  try {
    return acquireTelegramLock(nexusLockPath(), opts);
  } catch (err) {
    if (err instanceof TelegramLockError) {
      throw Object.assign(
        new NexusLockError(err.existing, err.lockPath),
        { cause: err },
      );
    }
    throw err;
  }
}

export function readNexusLock(): NexusLockMeta | null {
  return safeReadLock(nexusLockPath());
}

export function isAliveNexusLock(meta: NexusLockMeta): boolean {
  return isAliveLock(meta);
}

export interface NexusLifecycleState {
  root: string;
  lock: NexusLockMeta;
  runtime: NexusRuntimeMeta | null;
}

/**
 * Resolve the daemon a lifecycle command may observe or stop. New state always
 * lives at the canonical root. During a test-layout upgrade, only a live legacy
 * lock paired with a valid same-PID runtime sidecar is eligible as a fallback.
 */
export function findNexusLifecycleState(): NexusLifecycleState | null {
  const canonicalRoot = nexusRootDir();
  const canonicalLock = readNexusLock();
  if (canonicalLock && isAliveNexusLock(canonicalLock)) {
    return {
      root: canonicalRoot,
      lock: canonicalLock,
      runtime: readNexusRuntimeAt(joinPath(canonicalRoot, 'runtime.json')),
    };
  }

  const testRoot = getTestStateRoot();
  if (!testRoot) return null;
  const legacyLock = safeReadLock(joinPath(testRoot, '.lock'));
  const legacyRuntime = readNexusRuntimeAt(joinPath(testRoot, 'runtime.json'));
  if (!legacyLock || !legacyRuntime || legacyRuntime.pid !== legacyLock.pid || !isAliveNexusLock(legacyLock)) {
    return null;
  }
  return { root: testRoot, lock: legacyLock, runtime: legacyRuntime };
}
