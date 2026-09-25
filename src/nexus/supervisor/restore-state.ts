// NEXUS · restore from restart-state.json (Phase N-5 PR χ)
//
// On boot, after the registry + supervisor exist, peek at the previous
// incarnation's restart-pending snapshot and re-spawn any spawn-able
// tabs that were active. The file is one-shot — cleared after read so a
// later crash that leaves no snapshot doesn't accidentally inherit a
// stale roster.
//
// Tabs missing from the current registry (e.g., template changed between
// runs) are reported in `unknown` for the caller to log; we do not
// attempt to register them, since the previous spec is gone.

import { readRestartState, clearRestartState, type RestartStateFile } from './graceful-exit.js';
import type { NexusState } from '../state/state.js';
import { pushEvent } from '../state/state.js';
import type { TabRegistry } from '../state/tab-registry.js';
import type { Supervisor } from './index.js';
import { debug } from '../../debug/log.js';

export interface RestoreFromPendingOpts {
  state: NexusState;
  registry: TabRegistry;
  supervisor?: Supervisor;
  /** Override startTab. Default = supervisor.startTab when supervisor is
   *  provided. View-only kinds (chat) are skipped silently because their
   *  spec.spawn is undefined. */
  startTab?: (id: string) => Promise<void>;
}

export interface RestoreOutcome {
  /** The parsed file when present, else null. */
  read: RestartStateFile | null;
  /** Tab ids we asked the supervisor to start. */
  started: string[];
  /** Tab ids that were in the file but not in the current registry. */
  unknown: string[];
  /** Tab ids skipped because no startTab path was available
   *  (no supervisor + no startTab override). */
  skipped: string[];
}

export async function restoreFromPending(opts: RestoreFromPendingOpts): Promise<RestoreOutcome> {
  const file = readRestartState();
  if (!file) {
    return { read: null, started: [], unknown: [], skipped: [] };
  }

  const started: string[] = [];
  const unknown: string[] = [];
  const skipped: string[] = [];

  const start =
    opts.startTab ??
    (opts.supervisor ? (id: string) => opts.supervisor!.startTab(id) : undefined);

  for (const entry of file.tabs) {
    if (!opts.registry.has(entry.id)) {
      unknown.push(entry.id);
      continue;
    }
    if (!start) {
      skipped.push(entry.id);
      continue;
    }
    try {
      await start(entry.id);
      started.push(entry.id);
    } catch {
      /* swallow — surface via tab status / events instead of blocking boot */
      skipped.push(entry.id);
    }
  }

  // One-shot: clear after read so a future plain crash (no graceful exit)
  // doesn't inherit this snapshot.
  clearRestartState();

  pushEvent(opts.state, {
    kind: 'nexus.boot',
    detail: {
      restoreFromPending: true,
      reason: file.reason,
      previousPid: file.previousPid,
      started,
      unknown,
      skipped,
    },
  });

  if (debug.enabled) {
    debug.log('nexus.graceful.restore', String(started.length), {
      started,
      unknown,
      skipped,
    });
  }

  return { read: file, started, unknown, skipped };
}
