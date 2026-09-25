// P-2D.1 — `monad nexus pwa dev --bg` self-detach + `--status` + `--stop`.
//
// User report (2026-05-07): "지금처럼 foreground 도는 것을 BG 에서
// 돌아가고 명령어 셋트도 단순화…좀더 심플하게 가는 방법이 있을까요?"
//
// We already have a self-detach pattern in src/cli/bg-launch.ts for
// `monad nexus --bg` — same shape works here. The PWA dev child is
// just `monad nexus pwa dev` (foreground) re-spawned with stdio piped
// to a log file and the parent exiting. P-2B.γ's auto-config + auto-
// restart cleanup runs in the child's `finally`, so SIGTERM (via
// `--stop`) still unsets devProxyUpstream and flips nexus back to
// static — no extra wiring needed in the foreground path.
//
// Files we own:
//   ~/.monad/nexus/.pwa-dev.lock       JSON: { pid, host, startedAt, port, logPath }
//   ~/.monad/nexus/logs/pwa-dev-<stamp>.log
//
// Lifecycle:
//   pwa dev --bg     → spawn detached + write lock + parent exits (0)
//   pwa dev --status → read lock + report alive / log path / port
//   pwa dev --stop   → SIGTERM lock.pid + poll until cleared

import { execSync, spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { hostname } from 'node:os';
import { join as joinPath } from 'node:path';

import { debug } from '../debug/log.js';
import { isPidAlive } from '../process/pid-liveness.js';
import {
  nexusLogsDir,
  nexusPwaDevLockPath,
} from '../nexus/paths.js';

type BgChildHandle = Pick<ChildProcess, 'pid' | 'unref'>;

export interface PwaDevLockMeta {
  pid: number;
  host: string;
  startedAt: string;
  port: number;
  logPath: string;
}

export interface PwaDevBgLaunchOpts {
  port?: number;
  /** Bind interface for next-dev. Forwarded to the foreground re-entry
   *  via `--host`. Default (omit) lets `runPwaDev` pick `0.0.0.0`. */
  host?: string;
  /** Override argv[1] for the self-spawn target. Defaults to
   *  `process.argv[1]`. */
  argvBin?: string;
  /** Test seam — replace child_process.spawn. */
  spawnFn?: (cmd: string, args: string[], opts: SpawnOptions) => BgChildHandle;
  /** Test seam — produce the log path for a given stamp. */
  logPathFn?: (stamp: string) => string;
  /** Test seam — replace the lock-file writer. */
  writeLockFn?: (meta: PwaDevLockMeta) => void;
  /** Test seam — replace existing-lock probe. */
  readLockFn?: () => PwaDevLockMeta | null;
  /** Test seam — replace alive check. Default = `process.kill(pid, 0)`. */
  isAliveFn?: (pid: number) => boolean;
  out?: { log: (s: string) => void; error: (s: string) => void };
  now?: () => number;
}

export interface PwaDevBgLaunchResult {
  exitCode: number;
  pid?: number;
  logPath?: string;
}

function defaultLogPath(stamp: string): string {
  mkdirSync(nexusLogsDir(), { recursive: true });
  return joinPath(nexusLogsDir(), `pwa-dev-${stamp}.log`);
}

function defaultIsAlive(pid: number): boolean {
  // ⛔ EPERM 은 「죽음」이 아니다 — 공용 판정으로 모았다(2026-09-20 전수: 15곳 중 10곳이 접고 있었다)
    return isPidAlive(pid);
}

function defaultReadLock(): PwaDevLockMeta | null {
  const path = nexusPwaDevLockPath();
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw) as PwaDevLockMeta;
    if (typeof parsed.pid !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

function defaultWriteLock(meta: PwaDevLockMeta): void {
  const path = nexusPwaDevLockPath();
  mkdirSync(joinPath(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(meta, null, 2), { mode: 0o600 });
}

/** Launch `monad nexus pwa dev` in the background. Caller should
 *  `process.exit` with the returned exitCode. */
export async function runPwaDevBgLaunch(
  opts: PwaDevBgLaunchOpts = {},
): Promise<PwaDevBgLaunchResult> {
  const out = opts.out ?? console;
  const port = opts.port ?? 3210;
  const argvBin = opts.argvBin ?? process.argv[1] ?? '';
  if (!argvBin) {
    out.error('monad nexus pwa dev --bg: could not determine argv[1] for self-detach.');
    return { exitCode: 1 };
  }
  const readLockFn = opts.readLockFn ?? defaultReadLock;
  const isAliveFn = opts.isAliveFn ?? defaultIsAlive;
  const writeLockFn = opts.writeLockFn ?? defaultWriteLock;
  const spawnFn = opts.spawnFn ?? ((cmd, childArgs, spawnOpts) => spawn(cmd, childArgs, spawnOpts));

  const existing = readLockFn();
  if (existing && isAliveFn(existing.pid)) {
    out.error('monad nexus pwa dev --bg: already running');
    out.error(`  pid       ${existing.pid}`);
    out.error(`  host      ${existing.host}`);
    out.error(`  startedAt ${existing.startedAt}`);
    out.error(`  log       ${existing.logPath}`);
    out.error('');
    out.error('Use `monad nexus pwa dev --stop` to terminate.');
    return { exitCode: 1 };
  }

  const stamp = String((opts.now ?? Date.now)());
  const logPath = (opts.logPathFn ?? defaultLogPath)(stamp);
  mkdirSync(joinPath(logPath, '..'), { recursive: true });
  const logFd = openSync(logPath, 'a', 0o644);
  // Args fed to the foreground re-entry — `--bg` is intentionally NOT
  // forwarded so the child runs the standard `runPwaDev` flow.
  const args = [
    argvBin,
    'nexus',
    'pwa',
    'dev',
    '--port',
    String(port),
    ...(opts.host ? ['--host', opts.host] : []),
  ];
  let child: BgChildHandle | null = null;
  try {
    child = spawnFn(process.execPath, args, {
      detached: true,
      stdio: ['ignore', logFd, logFd],
      env: { ...process.env, MONAD_PWA_DEV_BG_PARENT: '1' },
    });
    if (!child.pid) {
      out.error('monad nexus pwa dev --bg: spawn returned no pid');
      return { exitCode: 1 };
    }
    child.unref();
    const meta: PwaDevLockMeta = {
      pid: child.pid,
      host: hostname(),
      startedAt: new Date().toISOString(),
      port,
      logPath,
    };
    writeLockFn(meta);
    out.log('monad nexus pwa dev: started in background');
    out.log(`  pid       ${meta.pid}`);
    out.log(`  port      ${meta.port}  (Next.js dev server)`);
    out.log(`  log       ${meta.logPath}`);
    out.log('  status    monad nexus pwa dev --status');
    out.log('  stop      monad nexus pwa dev --stop');
    return { exitCode: 0, pid: meta.pid, logPath: meta.logPath };
  } catch (err) {
    out.error(`monad nexus pwa dev --bg: spawn failed — ${(err as Error).message}`);
    return { exitCode: 1 };
  } finally {
    try { closeSync(logFd); } catch { /* best-effort */ }
  }
}

export interface PwaDevStatusOpts {
  readLockFn?: () => PwaDevLockMeta | null;
  isAliveFn?: (pid: number) => boolean;
  out?: { log: (s: string) => void; error: (s: string) => void };
}

export interface PwaDevStatusResult {
  exitCode: number;
  alive: boolean;
  meta?: PwaDevLockMeta;
}

/** `monad nexus pwa dev --status` — report whether the BG child is
 *  alive. Returns exitCode 0 when alive, 1 when stopped or stale. */
export function runPwaDevStatus(opts: PwaDevStatusOpts = {}): PwaDevStatusResult {
  const out = opts.out ?? console;
  const readLockFn = opts.readLockFn ?? defaultReadLock;
  const isAliveFn = opts.isAliveFn ?? defaultIsAlive;
  const meta = readLockFn();
  if (!meta) {
    out.log('monad nexus pwa dev: not running (no lock).');
    return { exitCode: 1, alive: false };
  }
  const alive = isAliveFn(meta.pid);
  if (!alive) {
    out.log('monad nexus pwa dev: stale lock (pid is gone).');
    out.log(`  pid       ${meta.pid}`);
    out.log(`  startedAt ${meta.startedAt}`);
    out.log(`  log       ${meta.logPath}`);
    return { exitCode: 1, alive: false, meta };
  }
  out.log('monad nexus pwa dev: running');
  out.log(`  pid       ${meta.pid}`);
  out.log(`  host      ${meta.host}`);
  out.log(`  startedAt ${meta.startedAt}`);
  out.log(`  port      ${meta.port}`);
  out.log(`  log       ${meta.logPath}`);
  return { exitCode: 0, alive: true, meta };
}

export interface PwaDevStopOpts {
  readLockFn?: () => PwaDevLockMeta | null;
  isAliveFn?: (pid: number) => boolean;
  /** Sends `signal` to `pid`. Negative pid targets a process group
   *  (POSIX `kill(-pgid, sig)`). Default = `process.kill`. */
  killFn?: (pid: number, signal: NodeJS.Signals) => void;
  removeLockFn?: () => void;
  sleepFn?: (ms: number) => Promise<void>;
  /** Maximum time to wait for the process group to clear after SIGTERM
   *  before escalating to SIGKILL. */
  maxWaitMs?: number;
  /** Extra time after SIGKILL to verify the group is gone. */
  killGraceMs?: number;
  /** Poll interval. */
  pollMs?: number;
  /** Test seam — return the list of pids whose PGID matches `leaderPid`,
   *  EXCLUDING the leader itself. Default scans `ps -A -o pid=,pgid=`.
   *  Used to verify graceful reap of `bun run dev` + `next dev` +
   *  `next-server` after SIGTERM hits the leader's group. */
  listGroupSurvivorsFn?: (leaderPid: number) => number[];
  out?: { log: (s: string) => void; error: (s: string) => void };
}

export interface PwaDevStopResult {
  exitCode: number;
  killed: boolean;
  /** Pids that survived SIGTERM grace and required SIGKILL escalation
   *  (empty when SIGTERM was sufficient). Surfaces structurally so the
   *  caller can decide whether to file a bug report. */
  escalated?: number[];
}

function defaultRemoveLock(): void {
  const path = nexusPwaDevLockPath();
  try { unlinkSync(path); } catch { /* missing OK */ }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Scan `ps -A -o pid=,pgid=` and return the pids whose PGID matches
 *  `leaderPid`, excluding the leader itself. Empty list = the BG
 *  process group has been fully reaped.
 *
 *  Why this exists: `pwa-dev-bg` spawns the foreground re-entry with
 *  `detached: true`, which makes that child the PGID leader. All its
 *  descendants (`bun run dev` → `next dev` → `next-server`) inherit
 *  PGID = leader.pid. If we only check `isAlive(leader.pid)` we can
 *  declare "stopped" while a `bun run` middle-hop has died but its
 *  `next dev` grandchild has been reparented to init (PPID=1, orphan).
 *  Scanning the group catches that case. */
function defaultListGroupSurvivors(leaderPid: number): number[] {
  try {
    const out = execSync('ps -A -o pid=,pgid=', { encoding: 'utf8', timeout: 2000 });
    const survivors: number[] = [];
    for (const line of out.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parts = trimmed.split(/\s+/);
      if (parts.length < 2) continue;
      const pid = Number(parts[0]);
      const pgid = Number(parts[1]);
      if (!Number.isFinite(pid) || !Number.isFinite(pgid)) continue;
      if (pgid === leaderPid && pid !== leaderPid) survivors.push(pid);
    }
    return survivors;
  } catch (err) {
    if (debug.enabled) {
      debug.log('pwa.dev.stop.psError', `${(err as Error).message}`, { leaderPid });
    }
    return [];
  }
}

/** `monad nexus pwa dev --stop` — graceful process-group reap.
 *
 *  Sequence:
 *    1. SIGTERM to the WHOLE process group (`kill(-leader, SIGTERM)`).
 *       Catches every descendant directly; doesn't rely on the
 *       `bun run` → `next dev` signal-forwarding chain.
 *    2. Poll until both: leader gone AND `listGroupSurvivors` empty.
 *    3. On grace expiry: SIGKILL the group + leader, brief verify.
 *    4. Always reap the lock file when the group is empty. */
export async function runPwaDevStop(opts: PwaDevStopOpts = {}): Promise<PwaDevStopResult> {
  const out = opts.out ?? console;
  const readLockFn = opts.readLockFn ?? defaultReadLock;
  const isAliveFn = opts.isAliveFn ?? defaultIsAlive;
  const killFn = opts.killFn ?? process.kill.bind(process);
  const removeLockFn = opts.removeLockFn ?? defaultRemoveLock;
  const sleepFn = opts.sleepFn ?? defaultSleep;
  const maxWaitMs = opts.maxWaitMs ?? 5000;
  const killGraceMs = opts.killGraceMs ?? 500;
  const pollMs = opts.pollMs ?? 50;
  const listGroupSurvivorsFn = opts.listGroupSurvivorsFn ?? defaultListGroupSurvivors;

  const meta = readLockFn();
  if (!meta) {
    out.log('monad nexus pwa dev --stop: nothing to stop (no lock).');
    return { exitCode: 0, killed: false };
  }
  if (!isAliveFn(meta.pid)) {
    const survivors = listGroupSurvivorsFn(meta.pid);
    if (survivors.length > 0) {
      // Leader died but children were reparented to init — pre-existing
      // orphans from a previous botched stop. Reap them now.
      out.log(`monad nexus pwa dev --stop: stale lock + ${survivors.length} orphan(s) from PGID ${meta.pid} — reaping`);
      if (debug.enabled) debug.log('pwa.dev.stop.orphans', `pgid=${meta.pid}`, { survivors });
      try { killFn(-meta.pid, 'SIGKILL'); } catch { /* group might already be dissolved */ }
      for (const pid of survivors) { try { killFn(pid, 'SIGKILL'); } catch { /* gone */ } }
    } else {
      out.log('monad nexus pwa dev --stop: stale lock — clearing.');
    }
    removeLockFn();
    return { exitCode: 0, killed: false, escalated: survivors };
  }

  // Step 1: SIGTERM the whole group.
  try {
    killFn(-meta.pid, 'SIGTERM');
    out.log(`monad nexus pwa dev --stop: SIGTERM → process group ${meta.pid}`);
    if (debug.enabled) debug.log('pwa.dev.stop.sigterm', `pgid=${meta.pid}`, { target: 'group' });
  } catch (err) {
    // Group target failed (rare — leader might have just exited). Try
    // leader-only as fallback so we don't bail without trying.
    try {
      killFn(meta.pid, 'SIGTERM');
      out.log(`monad nexus pwa dev --stop: SIGTERM → leader pid ${meta.pid} (group target failed: ${(err as Error).message})`);
    } catch (err2) {
      out.error(`monad nexus pwa dev --stop: kill failed — ${(err2 as Error).message}`);
      if (debug.enabled) debug.log('pwa.dev.stop.killFailed', `${(err2 as Error).message}`, { pid: meta.pid });
      return { exitCode: 1, killed: false };
    }
  }

  // Step 2: poll for leader-gone AND group-empty.
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const leaderAlive = isAliveFn(meta.pid);
    if (!leaderAlive) {
      const survivors = listGroupSurvivorsFn(meta.pid);
      if (survivors.length === 0) {
        removeLockFn();
        out.log('✓ stopped (process group reaped).');
        if (debug.enabled) debug.log('pwa.dev.stop.ok', `pgid=${meta.pid}`, { phase: 'sigterm' });
        return { exitCode: 0, killed: true };
      }
      // Leader exited but descendants linger — keep waiting; SIGTERM
      // is still propagating through their own shutdown.
    }
    await sleepFn(pollMs);
  }

  // Step 3: SIGKILL escalation. SIGTERM grace expired with the group
  // (leader and/or descendants) still alive.
  const survivorsAtEscalation = listGroupSurvivorsFn(meta.pid);
  const leaderStillAlive = isAliveFn(meta.pid);
  out.error(`monad nexus pwa dev --stop: SIGTERM grace ${maxWaitMs}ms expired — escalating to SIGKILL`);
  out.error(`  leader pid ${meta.pid}: ${leaderStillAlive ? 'alive' : 'gone'}`);
  out.error(`  group survivors: ${survivorsAtEscalation.length === 0 ? '(none)' : survivorsAtEscalation.join(', ')}`);
  if (debug.enabled) {
    debug.log('pwa.dev.stop.escalate', `pgid=${meta.pid}`, {
      leaderStillAlive,
      survivors: survivorsAtEscalation,
    });
  }
  try { killFn(-meta.pid, 'SIGKILL'); } catch { /* group target may fail */ }
  if (leaderStillAlive) {
    try { killFn(meta.pid, 'SIGKILL'); } catch { /* leader may have just exited */ }
  }
  for (const pid of survivorsAtEscalation) {
    try { killFn(pid, 'SIGKILL'); } catch { /* descendant may be gone */ }
  }

  // Step 4: brief verify.
  await sleepFn(killGraceMs);
  const finalSurvivors = listGroupSurvivorsFn(meta.pid);
  const finalLeaderAlive = isAliveFn(meta.pid);
  if (!finalLeaderAlive && finalSurvivors.length === 0) {
    removeLockFn();
    out.log('✓ stopped (after SIGKILL).');
    if (debug.enabled) debug.log('pwa.dev.stop.ok', `pgid=${meta.pid}`, { phase: 'sigkill' });
    return { exitCode: 0, killed: true, escalated: survivorsAtEscalation };
  }
  out.error(`✗ giving up — leader=${finalLeaderAlive ? 'alive' : 'gone'} survivors=${finalSurvivors.join(', ') || '(none)'}`);
  if (debug.enabled) {
    debug.log('pwa.dev.stop.failed', `pgid=${meta.pid}`, {
      finalLeaderAlive,
      finalSurvivors,
    }, { level: 'error' });
  }
  return { exitCode: 1, killed: false, escalated: survivorsAtEscalation };
}
