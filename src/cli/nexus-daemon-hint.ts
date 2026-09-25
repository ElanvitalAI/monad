// CLI · NEXUS daemon liveness hint for the bare-`monad` boot banner.
//
// History (why this file is so small): bare `monad` used to route
// through an entry-mode switch (`global.entry.defaultMode` · N-1
// cleanup PR f/g) that could send it to the headless NEXUS daemon
// instead of the dashboard. T3/T4 (PLAN-tui-redundancy-cleanup,
// 2026-05-16) deleted the NEXUS interactive TUI, which made every
// non-dashboard route a dead-end. The switch, `resolveEntryMode`, the
// `monad legacy` escape hatch, and the whole enum were removed
// (2026-07-24) once it was clear bare `monad` has exactly one sensible
// destination: the dashboard. The daemon's canonical entry is
// `monad nexus run`.
//
// What survives is only the useful half: telling the user, when they
// land on the dashboard, that a NEXUS daemon is ALSO live on this host
// (serving PWA / meta-api) — the "multi-window UX" of dashboard +
// daemon coexisting. Liveness is a query, never a router.
//
// Root-cause writeup: 내부 문서 `REPORT-tui-observation-methodology-2026-07-24` §12.

import { hostname } from 'node:os';
import { readNexusLock, isAliveNexusLock } from '../nexus/supervisor/lock.js';

export interface NexusDaemonHintOpts {
  /** Test seam — production omits and we read the live lock; tests
   *  pass a synthetic probe to drive liveness deterministically. */
  lockProbe?: () => { alive: boolean; sameHost: boolean };
}

/** Is a NEXUS daemon actually running on this host?
 *
 *  ⚠️ Checks the holder pid, not just the lock file's existence — a
 *  stale file left behind by a killed daemon must not report a live
 *  NEXUS. (`isAliveNexusLock` sat next to `readNexusLock` unused before
 *  2026-07-24; this is the only caller.) */
export function isNexusDaemonLive(opts: NexusDaemonHintOpts = {}): boolean {
  const probe = opts.lockProbe ?? defaultLockProbe;
  const lock = probe();
  return lock.alive && lock.sameHost;
}

/** One-line boot banner shown when the dashboard launches while a NEXUS
 *  daemon is live on this host. Pure formatter; never thrown. */
export function nexusDaemonLiveHint(): string {
  return '[monad] entry: dashboard (a NEXUS daemon is live — `monad nexus pwa show`)';
}

/** Production lock probe — reads the NEXUS lock, verifies the holder
 *  process is alive, and matches the current hostname against the lock
 *  holder's. */
function defaultLockProbe(): { alive: boolean; sameHost: boolean } {
  try {
    const lock = readNexusLock();
    if (!lock) return { alive: false, sameHost: false };
    if (!isAliveNexusLock(lock)) return { alive: false, sameHost: false };
    return { alive: true, sameHost: lock.host === hostname() };
  } catch {
    return { alive: false, sameHost: false };
  }
}
