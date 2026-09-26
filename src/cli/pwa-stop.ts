// `elanous nexus pwa stop` — one command to take down everything that
// `elanous nexus pwa start` brought up.
//
// Cascade order (best-effort each step):
//   1. Per-port Tailscale Serve unmount — drop the tls-tcp forward we
//      set up for THIS port via the share lifecycle. Idempotent: if no
//      serve was active, the unmount is a no-op. Skipping when
//      tailscale is missing avoids the "command not found" noise on
//      hosts that never installed it. As of P1 mode unification
//      (2026-05-10) this is per-port (not global `serve reset`) so
//      concurrent multi-instance mounts on other ports survive.
//   2. PWA dev BG (apps/pwa next-dev) — `runPwaDevStop`
//      That stop also DELETEs the admin endpoint via the BG child's
//      `pwa-dev` cleanup `finally`, so nexus flips back to static.
//   3. Nexus daemon — same SIGINT path as `elanous nexus stop`.
//
// `pwa stop` works whether dev mode was ever active. When the dev lock
// is missing or stale we just clear it and proceed to the nexus stop.

import { unmountTailscaleServe } from './tailscale-serve.js';
import { runPwaDevStop, type PwaDevStopResult } from './pwa-dev-bg.js';
import { probeTailscale, type TailscaleProbe } from '../nexus/onboarding/tailscale-probe.js';
import { unregisterPwaInstance } from './pwa-registry.js';
import { readNexusLock } from '../nexus/supervisor/lock.js';
import { resolveNexusPwa, type NexusPwaResolution } from './nexus-show.js';

export interface PwaStopOpts {
  out?: { log: (s: string) => void; error: (s: string) => void };
  /** Test seam — replace the dev BG stop helper. */
  devStopFn?: () => Promise<PwaDevStopResult>;
  /** Test seam — replace the nexus stop trigger. Default = dynamic
   *  import of `runNexus({stop:true})`. */
  nexusStopFn?: () => Promise<{ exitCode: number }>;
  /** Test seam — probe tailscale presence (skip unmount on hosts without it). */
  shareProbeFn?: () => Promise<TailscaleProbe>;
  /** Test seam — unmount THIS port's tls-tcp serve. Default = unified
   *  `unmountTailscaleServe({ mode: { kind: 'tls-tcp', port } })`. */
  shareResetFn?: (binary: string, port: number) => Promise<{ exitCode: number }>;
  /** Port whose tls-tcp serve is unmounted. Explicit values override daemon resolution. */
  port?: number;
  /** Test seam — resolve the daemon PWA URL used to determine its live port. */
  resolveNexusPwaFn?: () => NexusPwaResolution;
  /** P4 — replace the registry unregister call. Default reads
   *  `~/.elanous/nexus/.lock` to get the daemon pid + drops that entry
   *  from `~/.elanous/pwa-registry.json`. */
  unregisterFn?: (pid: number) => void;
  /** P4 — read the nexus lock to recover daemon pid. Test seam. */
  readLockFn?: () => { pid: number } | null;
}

export type PwaStopShareUnmount =
  | { status: 'success'; port: number; source: 'explicit' | 'nexus' }
  | { status: 'failed'; port: number; source: 'explicit' | 'nexus'; exitCode?: number; error?: string }
  | { status: 'skipped'; reason: 'pwa-port-unknown' | 'pwa-query-failed' | 'tailscale-unavailable' };

export interface PwaStopResult {
  exitCode: number;
  /** True when the dev BG was actually killed (vs no-lock no-op). */
  devKilled: boolean;
  /** True when the nexus stop signal was sent. */
  nexusStopped: boolean;
  /** True when `tailscale serve reset` was issued (not skipped). */
  shareReset: boolean;
  /** Outcome of the port-specific Tailscale Serve unmount. */
  shareUnmount: PwaStopShareUnmount;
  /** P4 — pid removed from the registry (when a lock file existed). */
  unregisteredPid?: number;
}

async function defaultNexusStop(): Promise<{ exitCode: number }> {
  const { runNexus } = await import('../nexus/index.js');
  await runNexus({ stop: true });
  return { exitCode: 0 };
}

async function defaultShareReset(binary: string, port: number): Promise<{ exitCode: number }> {
  const r = await unmountTailscaleServe({
    mode: { kind: 'tls-tcp', port },
    upstreamPort: port,
    useSudo: true,
    probeFn: async () => ({
      installed: true,
      alive: true,
      hostname: 'localhost',
      magicDnsHost: 'localhost',
      binary,
    }),
  });
  if (r.ok) return { exitCode: 0 };
  if (r.reason === 'serve-cmd-failed' || r.reason === 'no-state') return { exitCode: 0 };
  return { exitCode: 1 };
}

function resolveShareUnmountPort(opts: PwaStopOpts):
  | { port: number; source: 'explicit' | 'nexus' }
  | { reason: 'pwa-port-unknown' | 'pwa-query-failed' } {
  if (opts.port !== undefined) return { port: opts.port, source: 'explicit' };
  try {
    const pwa = (opts.resolveNexusPwaFn ?? resolveNexusPwa)();
    if (!('loopback' in pwa)) return { reason: 'pwa-port-unknown' };
    const port = Number(new URL(pwa.loopback).port);
    return Number.isInteger(port) && port >= 1 && port <= 65_535
      ? { port, source: 'nexus' }
      : { reason: 'pwa-port-unknown' };
  } catch {
    return { reason: 'pwa-query-failed' };
  }
}

export async function runPwaStop(opts: PwaStopOpts = {}): Promise<PwaStopResult> {
  const out = opts.out ?? console;
  const portResolution = resolveShareUnmountPort(opts);
  const devStopFn = opts.devStopFn ?? (() => runPwaDevStop({ out }));
  const nexusStopFn = opts.nexusStopFn ?? defaultNexusStop;
  const shareProbeFn = opts.shareProbeFn ?? (() => probeTailscale());
  const shareResetFn = opts.shareResetFn ?? defaultShareReset;
  const unregisterFn = opts.unregisterFn ?? unregisterPwaInstance;
  const readLockFn = opts.readLockFn ?? (() => readNexusLock());

  out.log('elanous nexus pwa stop: cascade');

  // Per-port unmount first — release THIS port's tls-tcp forward
  // before nexus dies. Idempotent and unconditional: the user's
  // switch state is irrelevant to "drop the forward we may have left
  // running on this port"; if nothing is forwarded the unmount is a
  // no-op. Concurrent multi-instance mounts on OTHER ports survive
  // (P1 unification: per-port, not global `serve reset`).
  let shareReset = false;
  let shareUnmount: PwaStopShareUnmount = 'port' in portResolution
    ? { status: 'skipped', reason: 'tailscale-unavailable' }
    : { status: 'skipped', reason: portResolution.reason };
  if (!('port' in portResolution)) {
    out.log(`  (share unmount skipped — ${portResolution.reason})`);
  }
  if ('port' in portResolution) {
    let probe: TailscaleProbe | undefined;
    try {
      probe = await shareProbeFn();
    } catch { /* tailscale probe threw — preserve the existing skip behavior */ }
    if (probe?.installed) {
      try {
        const r = await shareResetFn(probe.binary ?? 'tailscale', portResolution.port);
        shareReset = true;
        shareUnmount = r.exitCode === 0
          ? { status: 'success', port: portResolution.port, source: portResolution.source }
          : { status: 'failed', port: portResolution.port, source: portResolution.source, exitCode: r.exitCode };
        if (r.exitCode !== 0) {
          out.log(`  (share unmount exit ${r.exitCode} — port :${portResolution.port} may still be forwarded)`);
        }
      } catch (error) {
        shareReset = true;
        const message = error instanceof Error ? error.message : String(error);
        shareUnmount = { status: 'failed', port: portResolution.port, source: portResolution.source, error: message };
        out.log(`  (share unmount failed — port :${portResolution.port} may still be forwarded: ${message})`);
      }
    }
  }

  // P4 registry unregister — read the lock for the daemon pid before
  // we send SIGINT (the lock is removed during stop). Best-effort: if
  // the lock is already gone or pid missing, just skip.
  let unregisteredPid: number | undefined;
  try {
    const lock = readLockFn();
    if (lock && typeof lock.pid === 'number') {
      unregisteredPid = lock.pid;
      unregisterFn(lock.pid);
    }
  } catch { /* lock read or unregister failure — non-fatal */ }

  const devR = await devStopFn();
  const nexusR = await nexusStopFn();
  const exitCode = devR.exitCode === 0 && nexusR.exitCode === 0 ? 0 : 1;
  return {
    exitCode,
    devKilled: devR.killed,
    nexusStopped: nexusR.exitCode === 0,
    shareReset,
    shareUnmount,
    ...(unregisteredPid !== undefined ? { unregisteredPid } : {}),
  };
}
