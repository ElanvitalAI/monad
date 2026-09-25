// NEXUS · supervisor health loop (Phase N-2 PR ε)
//
// One health loop per tab. Each TabKindSpec carries a HealthCheckSpec
// (kind: 'http' | 'socket' | 'file-mtime' | 'ipc-ping' | 'process-alive'
// | 'never') describing how to probe; this module dispatches the probe
// on `setInterval(intervalMs)` and transitions the tab to `unhealthy`
// after `staleAfterMs` of consecutive failures.
//
// Probes are injectable: the default backend uses `fetch` / `net.connect`
// / `fs.statSync` / `process.kill(pid, 0)`, but tests can pass a mock
// backend so the loop is exercised without real I/O.
//
// `ipc-ping` lands properly in PR θ (channel-bot) — for now the default
// backend treats it as "alive iff pid is alive" so the supervisor can
// still bring up channel-bot tabs without an IPC roundtrip.

import { connect } from 'node:net';
import { statSync } from 'node:fs';
import type { HealthCheckSpec, TabState } from '../kinds/types.js';
import type { NexusState } from '../state/state.js';
import { pushEvent } from '../state/state.js';
import type { TabRegistry } from '../state/tab-registry.js';
import { debug } from '../../debug/log.js';
import { isPidAlive } from '../../process/pid-liveness.js';

// ---------------------------------------------------------------------------
// Probe backend
// ---------------------------------------------------------------------------

export interface HealthProbeBackend {
  http(spec: { url: string }, timeoutMs: number): Promise<boolean>;
  socket(spec: { host?: string; port: number; path?: string }, timeoutMs: number): Promise<boolean>;
  fileMtime(spec: { path: string }, staleAfterMs: number): Promise<boolean>;
  ipcPing(tab: TabState, timeoutMs: number): Promise<boolean>;
  processAlive(pid: number | undefined): Promise<boolean>;
}

export function createDefaultHealthProbeBackend(): HealthProbeBackend {
  return {
    async http(spec, timeoutMs) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetch(spec.url, { signal: ctrl.signal });
        return res.ok;
      } catch {
        return false;
      } finally {
        clearTimeout(t);
      }
    },
    socket(spec, timeoutMs) {
      return new Promise<boolean>((resolve) => {
        let settled = false;
        const finish = (ok: boolean): void => {
          if (settled) return;
          settled = true;
          try { sock.destroy(); } catch { /* ignore */ }
          resolve(ok);
        };
        const sock = spec.path
          ? connect({ path: spec.path })
          : connect({ host: spec.host ?? '127.0.0.1', port: spec.port });
        sock.once('connect', () => finish(true));
        sock.once('error', () => finish(false));
        setTimeout(() => finish(false), timeoutMs);
      });
    },
    async fileMtime(spec, staleAfterMs) {
      try {
        const st = statSync(spec.path);
        return Date.now() - st.mtimeMs <= staleAfterMs;
      } catch {
        return false;
      }
    },
    async ipcPing(tab) {
      // Placeholder — real IPC roundtrip lands in PR θ via channel-bot.
      // For now treat as "alive iff pid is alive" so the supervisor's
      // health loop is wired end-to-end.
      return tab.pid != null && isProcessAlive(tab.pid);
    },
    async processAlive(pid) {
      return pid != null && isProcessAlive(pid);
    },
  };
}

function isProcessAlive(pid: number): boolean {
  // ⛔ EPERM 은 「죽음」이 아니다 — 공용 판정으로 모았다(2026-09-20 전수: 15곳 중 10곳이 접고 있었다)
    return isPidAlive(pid);
}

// ---------------------------------------------------------------------------
// Loop API
// ---------------------------------------------------------------------------

export interface HealthLoopHandle {
  /** Stop the interval + clear listeners. Idempotent. */
  stop(): void;
  /** Force one probe immediately (test entry point). */
  probeOnce(): Promise<boolean>;
}

export interface StartHealthLoopOpts {
  state: NexusState;
  registry: TabRegistry;
  tabId: string;
  /** Probe backend — defaults to `createDefaultHealthProbeBackend()`. */
  probes?: HealthProbeBackend;
  /** Called when a probe transitions tab → unhealthy. PR ε internal:
   *  the restart layer registers this to schedule a restart. */
  onUnhealthy?: (tabId: string, reason: string) => void;
  /** Override interval (test seam · default = spec.health.intervalMs). */
  intervalMsOverride?: number;
  /** Override staleAfterMs (test seam · default = spec.health.staleAfterMs ?? 30000). */
  staleAfterMsOverride?: number;
}

const DEFAULT_TIMEOUTS: Record<HealthCheckSpec['kind'], number> = {
  http: 3000,
  socket: 1500,
  'file-mtime': 1000,
  'ipc-ping': 2000,
  'process-alive': 500,
  never: 0,
};

export function startHealthLoop(opts: StartHealthLoopOpts): HealthLoopHandle {
  const tab = opts.registry.get(opts.tabId);
  if (!tab) throw new Error(`startHealthLoop: tab not found: ${opts.tabId}`);
  const check = tab.spec.health;
  if (!check || check.kind === 'never') {
    return { stop() { /* noop */ }, async probeOnce() { return true; } };
  }
  const probes = opts.probes ?? createDefaultHealthProbeBackend();
  const intervalMs = opts.intervalMsOverride ?? check.intervalMs;
  const staleAfterMs = opts.staleAfterMsOverride ?? check.staleAfterMs ?? 30_000;
  let firstFailAt: number | null = null;
  let stopped = false;

  const probeOnce = async (): Promise<boolean> => {
    const ok = await runHealthCheck(probes, check, tab);
    if (stopped) return ok;
    const cur = opts.registry.get(opts.tabId);
    if (!cur) return ok;
    opts.registry.patch(opts.tabId, { lastHealthAt: Date.now(), lastHealthOk: ok });
    if (ok) {
      firstFailAt = null;
      return true;
    }
    firstFailAt = firstFailAt ?? Date.now();
    if (Date.now() - firstFailAt >= staleAfterMs && cur.status !== 'unhealthy') {
      opts.registry.patch(opts.tabId, { status: 'unhealthy' });
      const reason = `${check.kind}-stale`;
      pushEvent(opts.state, { kind: 'tab.unhealthy', tabId: opts.tabId, detail: { reason } });
      if (debug.enabled) {
        debug.log('nexus.supervisor.unhealthy', opts.tabId, { reason, kind: check.kind });
      }
      try { opts.onUnhealthy?.(opts.tabId, reason); } catch { /* swallow */ }
    }
    return false;
  };

  const interval = setInterval(() => { void probeOnce(); }, intervalMs);

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(interval);
    },
    probeOnce,
  };
}

export async function runHealthCheck(
  probes: HealthProbeBackend,
  check: HealthCheckSpec,
  tab: TabState,
): Promise<boolean> {
  const timeoutMs = check.timeoutMs ?? DEFAULT_TIMEOUTS[check.kind];
  const spec = check.spec ?? {};
  switch (check.kind) {
    case 'http':       return probes.http(spec as { url: string }, timeoutMs);
    case 'socket':     return probes.socket(spec as { host?: string; port: number; path?: string }, timeoutMs);
    case 'file-mtime': return probes.fileMtime(spec as { path: string }, check.staleAfterMs ?? 60_000);
    case 'ipc-ping':   return probes.ipcPing(tab, timeoutMs);
    case 'process-alive': return probes.processAlive(tab.pid);
    case 'never':      return true;
  }
}
