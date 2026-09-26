// `elanous nexus pwa restart` — one-shot stop + start.
//
// Composes `runPwaStop` (cascade: dev BG → nexus daemon) and `runPwaStart`
// (default mode = dev hot-live with admin dev-proxy). Mode is auto-detected
// from the live PWA dev lock so a user who was on dev stays on dev, and a
// prod-mode session restarts in prod. Explicit `--mode` overrides.
//
// Build is intentionally NOT part of restart. The static export at
// `apps/pwa/out` is owned by `elanous nexus pwa build` and dev mode never
// reads it (admin POST flips nexus to reverse-proxy next-dev). Folding a
// 30s `next build` into every restart was a holdover from the prod-only
// era and made the dev iteration loop expensive without buying any
// freshness guarantee — the build/restart pair was already split for
// users who edited source without restarting. Prod users who want the
// old "build + relaunch" behavior pass `--rebuild`.
//
// Lock semantics match the legacy implementation: a remote-host nexus
// lock aborts (we can't kill someone else's daemon), and a stale local
// lock is cleared by runPwaStop's cascade before runPwaStart launches.

import { runPwaBuild, type PwaBuildResult } from './pwa-build.js';
import { runPwaStart, type PwaStartOpts, type PwaStartResult } from './pwa-start.js';
import { runPwaStop, type PwaStopOpts, type PwaStopResult } from './pwa-stop.js';
import {
  isAliveNexusLock,
  readNexusLock,
  type NexusLockMeta,
} from '../nexus/supervisor/lock.js';
import { nexusPwaDevLockPath } from '../nexus/paths.js';
import { existsSync, readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { isPidAlive } from '../process/pid-liveness.js';

export type PwaRestartMode = 'auto' | 'static' | 'hmr';

export interface PwaRestartOpts {
  /** `'auto'` (default) follows whatever the running service is on — a
   *  live PWA dev lock means HMR is active, so we restart into HMR;
   *  no live dev lock means static-export mode, so we restart there.
   *  `'static'` / `'hmr'` skip detection and force the named mode. */
  mode?: PwaRestartMode;
  /** Run `elanous nexus pwa build` before stop/start. Off by default —
   *  HMR mode never reads `apps/pwa/out`, and static-mode users
   *  typically build via the standalone command. Opt in when you've
   *  changed source and want a single command to ship the new bundle
   *  for the static-export path. */
  rebuild?: boolean;
  /** apps/pwa cwd override for the build step. Ignored when rebuild=false. */
  cwd?: string;
  /** argv[1] override for the build step's cwd resolution. */
  argvBin?: string;
  // ─── start passthrough ────────────────────────────────────────────
  devPort?: number;
  loopback?: boolean;
  force?: boolean;
  toolCwd?: string;
  historyDir?: string;
  httpHost?: string;
  httpPort?: number;
  out?: { log: (s: string) => void; error: (s: string) => void };
  // ─── test seams ───────────────────────────────────────────────────
  buildFn?: (opts: {
    cwd?: string;
    argvBin?: string;
    out?: { log: (s: string) => void; error: (s: string) => void };
  }) => Promise<PwaBuildResult>;
  stopFn?: (opts: PwaStopOpts) => Promise<PwaStopResult>;
  startFn?: (opts: PwaStartOpts) => Promise<PwaStartResult>;
  /** Read the nexus daemon lock — used for the remote-host abort guard. */
  readNexusLockFn?: () => NexusLockMeta | null;
  isAliveNexusLockFn?: (meta: NexusLockMeta) => boolean;
  /** Read the PWA dev lock for auto-mode detection. */
  readDevLockFn?: () => { pid: number } | null;
  isAliveDevPidFn?: (pid: number) => boolean;
}

export interface PwaRestartResult {
  exitCode: number;
  /** Mode actually used after auto-detection. */
  mode: 'static' | 'hmr';
}

function defaultReadDevLock(): { pid: number } | null {
  const path = nexusPwaDevLockPath();
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as { pid?: number };
    return typeof parsed.pid === 'number' ? { pid: parsed.pid } : null;
  } catch {
    return null;
  }
}

function defaultIsAlivePid(pid: number): boolean {
  // ⛔ EPERM 은 「죽음」이 아니다 — 공용 판정으로 모았다(2026-09-20 전수: 15곳 중 10곳이 접고 있었다)
    return isPidAlive(pid);
}

function detectMode(opts: PwaRestartOpts): 'static' | 'hmr' {
  if (opts.mode === 'static' || opts.mode === 'hmr') return opts.mode;
  const readDev = opts.readDevLockFn ?? defaultReadDevLock;
  const isAlive = opts.isAliveDevPidFn ?? defaultIsAlivePid;
  const lock = readDev();
  if (lock && isAlive(lock.pid)) return 'hmr';
  return 'static';
}

/** Block restart when the nexus daemon is held by a different host. We
 *  can't SIGINT a remote pid, and silently no-op-ing would leave the user
 *  with an unrestarted daemon they thought we touched. */
function remoteNexusLockHolder(opts: PwaRestartOpts): string | null {
  const read = opts.readNexusLockFn ?? readNexusLock;
  const isAlive = opts.isAliveNexusLockFn ?? isAliveNexusLock;
  const lock = read();
  if (!lock || !isAlive(lock)) return null;
  if (lock.host !== hostname()) return lock.host;
  return null;
}

function buildStartOpts(opts: PwaRestartOpts, mode: 'static' | 'hmr', out: PwaRestartOpts['out']): PwaStartOpts {
  const startOpts: PwaStartOpts = { mode };
  if (opts.devPort !== undefined) startOpts.devPort = opts.devPort;
  if (opts.loopback) startOpts.loopback = true;
  if (opts.force) startOpts.force = true;
  if (opts.toolCwd) startOpts.toolCwd = opts.toolCwd;
  if (opts.historyDir) startOpts.historyDir = opts.historyDir;
  if (opts.httpHost) startOpts.httpHost = opts.httpHost;
  if (opts.httpPort !== undefined) startOpts.httpPort = opts.httpPort;
  if (out) startOpts.out = out;
  return startOpts;
}

export async function runPwaRestart(opts: PwaRestartOpts = {}): Promise<PwaRestartResult> {
  const out = opts.out ?? console;
  const mode = detectMode(opts);

  const remoteHost = remoteNexusLockHolder(opts);
  if (remoteHost) {
    out.error(`elanous nexus pwa restart: nexus lock held by remote host ${remoteHost}; cannot restart from here`);
    return { exitCode: 1, mode };
  }

  if (opts.rebuild) {
    const buildFn = opts.buildFn ?? runPwaBuild;
    const build = await buildFn({
      ...(opts.cwd ? { cwd: opts.cwd } : {}),
      ...(opts.argvBin ? { argvBin: opts.argvBin } : {}),
      out,
    });
    if (build.exitCode !== 0) return { exitCode: build.exitCode, mode };
  }

  out.log(`elanous nexus pwa restart: mode=${mode}${opts.mode === 'auto' || opts.mode === undefined ? ' (auto-detected)' : ''}`);

  const stopFn = opts.stopFn ?? runPwaStop;
  const stop = await stopFn({ out });
  if (stop.exitCode !== 0) {
    out.error('elanous nexus pwa restart: stop cascade reported failure; aborting before start');
    return { exitCode: stop.exitCode, mode };
  }

  const startFn = opts.startFn ?? runPwaStart;
  const start = await startFn(buildStartOpts(opts, mode, out));
  return { exitCode: start.exitCode, mode };
}
