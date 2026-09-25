// NEXUS · graceful exit (Phase N-5 PR χ)
//
// SIGTERM handler that lets the OS supervisor (launchd / systemd) restart
// nexus while preserving the previous incarnation's tab roster:
//   1. Snapshot active tab ids → ~/.monad/nexus/restart-state.json (0o600)
//   2. Drain supervisor (stop children with grace window)
//   3. Run the caller-supplied release (lock · runtime sidecar · http)
//   4. Exit with code 75 (hermes pattern — OS supervisor respawns on 75,
//      stays put on 0).
//
// Exit code policy (HANDOFF §3 D-1):
//   75 = graceful_restart_requested (OS supervisor restarts)
//    0 = explicit user stop          (OS supervisor leaves alone)
//   other = crash                    (OS supervisor's own restart policy)

import { writeFileSync, existsSync, readFileSync, unlinkSync } from 'node:fs';
import { ensureNexusRootDir, nexusRestartStatePath } from '../paths.js';
import type { NexusState } from '../state/state.js';
import type { TabRegistry } from '../state/tab-registry.js';
import type { Supervisor } from './index.js';
import type { TabStatus } from '../kinds/types.js';
import { debug } from '../../debug/log.js';

export const GRACEFUL_EXIT_CODE = 75;
export const CLEAN_EXIT_CODE = 0;

const ACTIVE_STATUSES: ReadonlySet<TabStatus> = new Set([
  'starting',
  'active',
  'unhealthy',
  'restarting',
]);

export interface RestartStateEntry {
  id: string;
  kind: string;
  status: TabStatus;
  pid?: number;
}

export interface RestartStateFile {
  serializedAt: string;
  previousPid: number;
  reason: 'sigterm' | 'manual';
  tabs: RestartStateEntry[];
}

export interface SerializeRestartStateOpts {
  state: NexusState;
  registry: TabRegistry;
  reason?: 'sigterm' | 'manual';
}

export function serializeRestartState(opts: SerializeRestartStateOpts): RestartStateFile {
  const tabs: RestartStateEntry[] = opts.registry
    .list()
    .filter((t) => ACTIVE_STATUSES.has(t.status))
    .map((t) => {
      const entry: RestartStateEntry = {
        id: t.spec.id,
        kind: t.spec.kind,
        status: t.status,
      };
      if (t.pid !== undefined) entry.pid = t.pid;
      return entry;
    });
  const file: RestartStateFile = {
    serializedAt: new Date().toISOString(),
    previousPid: process.pid,
    reason: opts.reason ?? 'sigterm',
    tabs,
  };
  ensureNexusRootDir();
  try {
    writeFileSync(nexusRestartStatePath(), JSON.stringify(file, null, 2), { mode: 0o600 });
    if (debug.enabled) {
      debug.log('nexus.graceful.serialize', String(tabs.length), {
        reason: file.reason,
        ids: tabs.map((t) => t.id),
      });
    }
  } catch {
    /* best-effort — never block exit */
  }
  return file;
}

export function readRestartState(): RestartStateFile | null {
  const path = nexusRestartStatePath();
  if (!existsSync(path)) return null;
  try {
    const body = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(body) as Partial<RestartStateFile>;
    if (typeof parsed.serializedAt !== 'string') return null;
    if (typeof parsed.previousPid !== 'number') return null;
    if (!Array.isArray(parsed.tabs)) return null;
    if (parsed.reason !== 'sigterm' && parsed.reason !== 'manual') return null;
    return parsed as RestartStateFile;
  } catch {
    return null;
  }
}

export function clearRestartState(): void {
  const path = nexusRestartStatePath();
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch {
    /* best-effort */
  }
}

export interface GracefulExitOpts {
  state: NexusState;
  registry: TabRegistry;
  supervisor?: Supervisor;
  /** Drain timeout for supervisor children. Defaults to 5_000 ms. */
  graceMs?: number;
  /** Called after serialize + supervisor drain, before exit. Used to
   *  release the nexus lock + http server + runtime sidecar. */
  release?: () => void | Promise<void>;
  /** Exit code. Defaults to 75 (OS supervisor restarts). Pass 0 for an
   *  explicit user stop that should not be auto-restarted. */
  exitCode?: number;
  /** Reason recorded in restart-state.json. Defaults to 'sigterm'. */
  reason?: 'sigterm' | 'manual';
  /** Override exit fn (tests pass a no-op + assertion capture). */
  exit?: (code: number) => void;
}

export async function gracefulExit(opts: GracefulExitOpts): Promise<void> {
  const reason = opts.reason ?? 'sigterm';
  serializeRestartState({ state: opts.state, registry: opts.registry, reason });
  if (opts.supervisor) {
    try {
      await opts.supervisor.shutdown({ graceMs: opts.graceMs ?? 5000 });
    } catch {
      /* swallow — exit must proceed */
    }
  }
  if (opts.release) {
    try {
      await opts.release();
    } catch {
      /* swallow */
    }
  }
  const exit = opts.exit ?? ((c: number) => process.exit(c));
  const code = opts.exitCode ?? GRACEFUL_EXIT_CODE;
  if (debug.enabled) {
    debug.log('nexus.graceful.exit', String(code), { reason });
  }
  exit(code);
}

/** Counterpart to gracefulExit — explicit user stop (Ctrl-C / monad nexus
 *  --stop). Clears any restart-state to keep the OS supervisor from
 *  respawning, drains supervisor, runs release, exits 0. */
export async function cleanExit(
  opts: Omit<GracefulExitOpts, 'reason' | 'exitCode'> & { exitCode?: number },
): Promise<void> {
  clearRestartState();
  if (opts.supervisor) {
    try {
      await opts.supervisor.shutdown({ graceMs: opts.graceMs ?? 0 });
    } catch {
      /* swallow */
    }
  }
  if (opts.release) {
    try {
      await opts.release();
    } catch {
      /* swallow */
    }
  }
  const exit = opts.exit ?? ((c: number) => process.exit(c));
  exit(opts.exitCode ?? CLEAN_EXIT_CODE);
}
