// NEXUS · supervisor orchestrator (Phase N-2 PR ε)
//
// Glues the 4 primitives (spawn / health / restart / reaper) into a
// single object that runNexus owns. PR ζ/η/θ kinds register specs with
// the registry; the supervisor turns those specs into running children
// and keeps them alive per kind-policy.
//
// Lifecycle:
//   - createSupervisor({state, registry, ...})      — pure construction
//   - sup.reclaim()                                  — boot-time orphan reaper
//   - sup.startTab(id)                                — spawn + health loop start
//   - sup.stopTab(id, {graceMs})                     — kill + health loop stop
//   - sup.shutdown()                                  — stop all + clear timers
//
// `startTab` is a no-op for view-only kinds (chat) — they have no
// `spec.spawn`. The supervisor only manages kinds that declare a spawn
// command + at least one health check.

import type { NexusState } from '../state/state.js';
import { pushEvent } from '../state/state.js';
import type { TabRegistry } from '../state/tab-registry.js';
import {
  createBunSpawnBackend,
  type SupervisorChild,
  type SupervisorSpawnBackend,
} from './spawn.js';
import {
  createDefaultHealthProbeBackend,
  startHealthLoop,
  type HealthLoopHandle,
  type HealthProbeBackend,
} from './health.js';
import { maybeScheduleRestart } from './restart.js';
import { reclaimOrphans, type ReclaimOutcome } from './reaper.js';
import { nexusLogsDir } from '../paths.js';
import { join as joinPath } from 'node:path';
import { debug } from '../../debug/log.js';
import { deriveChildEnv } from '../config/env-derive.js';
import { readUserConfig } from '../config/user-config.js';
import { readSecrets } from '../config/secrets.js';

export interface CreateSupervisorOpts {
  state: NexusState;
  registry: TabRegistry;
  /** Default = createBunSpawnBackend(). Tests inject. */
  spawnBackend?: SupervisorSpawnBackend;
  /** Default = createDefaultHealthProbeBackend(). Tests inject. */
  probes?: HealthProbeBackend;
  /** Override for restart's setTimer (tests). */
  setTimer?: (cb: () => void, delayMs: number) => () => void;
}

export interface Supervisor {
  reclaim(opts?: { isAlive?: (pid: number) => boolean }): ReclaimOutcome[];
  startTab(tabId: string): Promise<void>;
  stopTab(tabId: string, opts?: { graceMs?: number }): Promise<void>;
  shutdown(opts?: { graceMs?: number }): Promise<void>;
  /** Live snapshot of tabs the supervisor is actively managing. */
  managedIds(): string[];
}

interface ManagedEntry {
  child: SupervisorChild;
  health?: HealthLoopHandle;
  pendingRestartCancel?: () => void;
  stopOffExit: () => void;
}

export function createSupervisor(opts: CreateSupervisorOpts): Supervisor {
  const spawnBackend = opts.spawnBackend ?? createBunSpawnBackend();
  const probes = opts.probes ?? createDefaultHealthProbeBackend();
  const managed = new Map<string, ManagedEntry>();

  const scheduleRestart = (tabId: string, lastError?: string): void => {
    const result = maybeScheduleRestart({
      state: opts.state,
      registry: opts.registry,
      tabId,
      ...(lastError !== undefined ? { lastError } : {}),
      ...(opts.setTimer !== undefined ? { setTimer: opts.setTimer } : {}),
      callbacks: {
        async stop(id, stopOpts) { await stopTabImpl(id, stopOpts.graceMs); },
        async start(id) { await startTabImpl(id); },
      },
    });
    const entry = managed.get(tabId);
    if (entry && result.outcome === 'scheduled' && result.cancel) {
      entry.pendingRestartCancel = result.cancel;
    }
  };

  const startTabImpl = async (tabId: string): Promise<void> => {
    const tab = opts.registry.get(tabId);
    if (!tab) throw new Error(`supervisor.startTab: tab not found: ${tabId}`);
    if (!tab.spec.spawn) return; // view-only kind
    if (managed.has(tabId)) return; // already running

    opts.registry.patch(tabId, { status: 'starting' });
    const stdoutPath = joinPath(nexusLogsDir(tabId), 'stdout.log');
    const stderrPath = joinPath(nexusLogsDir(tabId), 'stderr.log');
    let lastHaltPattern: string | null = null;
    let lastHaltLine: string | null = null;

    // PR μ — env from SwitchRegistry takes precedence over the spec.spawn.env
    // baked at registration time. Spec env stays as a backstop for switches
    // that haven't been declared yet.
    const derivedEnv = (() => {
      try { return deriveChildEnv({ tab, config: readUserConfig(), secrets: readSecrets() }); }
      catch { return {}; }
    })();
    const finalEnv: Record<string, string> = { ...(tab.spec.spawn.env ?? {}), ...derivedEnv };

    const child = spawnBackend.spawn({
      command: tab.spec.spawn.command,
      ...(tab.spec.spawn.cwd !== undefined ? { cwd: tab.spec.spawn.cwd } : {}),
      env: finalEnv,
      stdoutPath,
      stderrPath,
      ...(tab.spec.restart?.haltPatterns
        ? {
            haltPatterns: tab.spec.restart.haltPatterns,
            onHaltMatch: (pattern, line) => {
              lastHaltPattern = pattern;
              lastHaltLine = line;
              if (debug.enabled) {
                debug.log('nexus.supervisor.halt-line', tabId, { pattern });
              }
            },
          }
        : {}),
    });

    opts.registry.patch(tabId, { pid: child.pid, status: 'active', startedAt: Date.now() });
    pushEvent(opts.state, { kind: 'tab.up', tabId, detail: { pid: child.pid } });

    const stopOffExit = child.onExit((info) => {
      const entry = managed.get(tabId);
      if (!entry) return;
      managed.delete(tabId);
      try { entry.health?.stop(); } catch { /* ignore */ }
      const exitReason = lastHaltPattern
        ? `halt:${lastHaltPattern}:${(lastHaltLine ?? '').slice(0, 200)}`
        : `exit:${info.exitCode}${info.signal ? `:${info.signal}` : ''}`;
      opts.registry.patch(tabId, { pid: undefined, lastError: exitReason });
      pushEvent(opts.state, {
        kind: 'tab.down',
        tabId,
        detail: { exitCode: info.exitCode, ...(info.signal ? { signal: info.signal } : {}) },
      });
      // Defer restart decision to the restart layer (handles halt-pattern + maxPerHour).
      scheduleRestart(tabId, exitReason);
    });

    let health: HealthLoopHandle | undefined;
    if (tab.spec.health && tab.spec.health.kind !== 'never') {
      health = startHealthLoop({
        state: opts.state,
        registry: opts.registry,
        tabId,
        probes,
        onUnhealthy: (id, reason) => {
          // unhealthy → schedule restart with the staleness reason as lastError
          scheduleRestart(id, `health:${reason}`);
        },
      });
    }

    managed.set(tabId, {
      child,
      ...(health ? { health } : {}),
      stopOffExit,
    });
  };

  const stopTabImpl = async (tabId: string, graceMs: number): Promise<void> => {
    const entry = managed.get(tabId);
    if (!entry) return;
    managed.delete(tabId);
    try { entry.health?.stop(); } catch { /* ignore */ }
    try { entry.pendingRestartCancel?.(); } catch { /* ignore */ }
    try { entry.stopOffExit(); } catch { /* ignore */ }
    try { entry.child.kill('SIGTERM'); } catch { /* ignore */ }

    // Grace window then force-kill if still alive (best-effort — the
    // child handle's `kill()` is idempotent in both backends).
    if (graceMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, graceMs));
    }
    try { entry.child.kill('SIGKILL'); } catch { /* already dead */ }
    try { entry.child.dispose(); } catch { /* ignore */ }
    opts.registry.patch(tabId, { pid: undefined, status: 'stopped' });
  };

  return {
    reclaim(reaperOpts) {
      return reclaimOrphans({
        state: opts.state,
        registry: opts.registry,
        ...(reaperOpts?.isAlive ? { isAlive: reaperOpts.isAlive } : {}),
      });
    },
    startTab: startTabImpl,
    stopTab(tabId, stopOpts) {
      return stopTabImpl(tabId, stopOpts?.graceMs ?? 2000);
    },
    async shutdown(shutdownOpts) {
      const ids = [...managed.keys()];
      const grace = shutdownOpts?.graceMs ?? 0; // shutdown is fast — no grace by default
      await Promise.all(ids.map((id) => stopTabImpl(id, grace)));
    },
    managedIds() { return [...managed.keys()]; },
  };
}
