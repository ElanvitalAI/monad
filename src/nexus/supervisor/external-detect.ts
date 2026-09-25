// NEXUS · external-process detection helper (Phase N-2 PR θ)
//
// Generic shape for: "another process holds a shared lock — flip the tab
// to status='external' and skip auto-spawn". Used by daemon (PR ζ via its
// own bespoke wrapper) and channel-bot (telegram + discord locks · this PR).
//
// Why a helper instead of inlining: PR θ adds 2 more lock kinds (telegram +
// discord), each with the same {readLock, isAlive, ownPid?} → outcome
// decision. Sharing the dispatch keeps the per-kind module thin.

import type { TabRegistry } from '../state/tab-registry.js';
import type { NexusState } from '../state/state.js';
import { pushEvent } from '../state/state.js';
import type { LockMeta } from '../../telegram-lock.js';
import { isAliveLock as defaultIsAlive, safeReadLock } from '../../telegram-lock.js';
import { debug } from '../../debug/log.js';

export interface DetectExternalLockOpts {
  state: NexusState;
  registry: TabRegistry;
  tabId: string;
  /** Path to the shared lock file (telegram.lock / discord.lock / monad.pid). */
  lockPath: string;
  /** Override for tests. Defaults to safeReadLock(lockPath). */
  readLock?: () => LockMeta | null;
  /** Override for tests. Defaults to telegram-lock's isAliveLock. */
  isAlive?: (meta: LockMeta) => boolean;
  /** Reason label embedded in events (default = 'external-detected'). */
  reasonLabel?: string;
}

export type DetectExternalLockOutcome =
  | 'external'
  | 'available'
  | 'reclaimed'
  | 'no-tab';

export interface DetectExternalLockResult {
  outcome: DetectExternalLockOutcome;
  externalPid?: number;
}

/** Inspect a shared lock and decide tab disposition. Returns the
 *  outcome so the caller (runNexus / supervisor) can skip auto-start
 *  for `external`. */
export function detectExternalLock(opts: DetectExternalLockOpts): DetectExternalLockResult {
  const tab = opts.registry.get(opts.tabId);
  if (!tab) return { outcome: 'no-tab' };

  const readLock = opts.readLock ?? (() => safeReadLock(opts.lockPath));
  const isAlive = opts.isAlive ?? defaultIsAlive;
  const reason = opts.reasonLabel ?? 'external-detected';

  const meta = readLock();
  if (!meta || !isAlive(meta)) {
    if (tab.status === 'external') {
      opts.registry.patch(opts.tabId, { status: 'idle', pid: undefined });
      pushEvent(opts.state, {
        kind: 'tab.down',
        tabId: opts.tabId,
        detail: { reason: `${reason}-cleared` },
      });
      return { outcome: 'reclaimed' };
    }
    return { outcome: 'available' };
  }

  // Lock is held + holder is alive. If it's our own child, no-op.
  if (tab.pid !== undefined && tab.pid === meta.pid) {
    return { outcome: 'available' };
  }

  opts.registry.patch(opts.tabId, { status: 'external', pid: meta.pid });
  pushEvent(opts.state, {
    kind: 'tab.down',
    tabId: opts.tabId,
    detail: { reason, externalPid: meta.pid, host: meta.host, lockPath: opts.lockPath },
  });
  if (debug.enabled) {
    debug.log('nexus.external-detect', opts.tabId, { pid: meta.pid, lockPath: opts.lockPath });
  }
  return { outcome: 'external', externalPid: meta.pid };
}
