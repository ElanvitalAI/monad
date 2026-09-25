// MVP M1.2 — Monad daemon paths + lock helpers.
//
// Mirrors `src/scheduler/lock.ts` + `src/scheduler/paths.ts`. The
// daemon (= ACP server with unix-socket transport) writes a single
// pid lock so `monad serve --status` / `--stop` can find it without
// scanning the process list.
//
// Paths (all under `~/.monad/`):
//   monad.sock — Unix domain socket bound by `bootAcpServer({ transport: 'unix-socket' })`
//   monad.pid  — single-instance lock (pid + start ts + label · 0600)
//   monad.log  — stdout/stderr capture for detached mode
//
// The lock module reuses telegram-lock's primitives so future tooling
// can read all three locks (telegram / scheduler / daemon) with the
// same shape.

import { join as joinPath } from 'node:path';
import { getMonadConfigDir } from './monad-config-dir.js';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';

import {
  acquireTelegramLock,
  safeReadLock,
  isAliveLock,
  TelegramLockError,
  type AcquireOpts,
  type LockMeta,
} from './telegram-lock.js';

import { defaultUnixSocketPath } from './boot/acp-server.js';

export type MonadDaemonLockMeta = LockMeta;
export class MonadDaemonLockError extends TelegramLockError {}

export function monadDaemonDir(): string {
  // Delegates to the central resolver (src/monad-config-dir.ts).
  // The `--config-dir <dir>` CLI flag and `setMonadConfigDir()`
  // test helper both populate the same source. Legacy
  // `MONAD_DAEMON_DIR` env var is still honoured by the resolver
  // for backwards-compatibility but emits a one-shot deprecation
  // nudge on stderr.
  return getMonadConfigDir();
}

export function monadDaemonLockPath(): string {
  return joinPath(monadDaemonDir(), 'monad.pid');
}

export function monadDaemonLogPath(): string {
  return joinPath(monadDaemonDir(), 'monad.log');
}

/** Default unix socket path the daemon binds. Re-exported from
 *  `boot/acp-server.ts` so callers don't have to chase the source. */
export function monadDaemonSocketPath(): string {
  return defaultUnixSocketPath();
}

/** Ensure `~/.monad/` exists. Idempotent. */
export function ensureMonadDaemonDir(): void {
  mkdirSync(monadDaemonDir(), { recursive: true });
}

export function acquireMonadDaemonLock(opts: AcquireOpts = {}): () => void {
  ensureMonadDaemonDir();
  try {
    return acquireTelegramLock(monadDaemonLockPath(), opts);
  } catch (err) {
    if (err instanceof TelegramLockError) {
      throw Object.assign(
        new MonadDaemonLockError(err.existing, err.lockPath),
        { cause: err },
      );
    }
    throw err;
  }
}

export function readMonadDaemonLock(): MonadDaemonLockMeta | null {
  return safeReadLock(monadDaemonLockPath());
}

export function isAliveMonadDaemonLock(meta: MonadDaemonLockMeta): boolean {
  return isAliveLock(meta);
}

/** Sidecar JSON beside the lock file. Captures runtime metadata
 *  beyond what the basic lock format carries (pid + startedAt +
 *  label). C4 uses it so `monad serve --status` can echo the http
 *  port, host, and auth mode the daemon was started with. */
export interface MonadDaemonRuntimeMeta {
  pid: number;
  startedAt: string;
  socketPath: string;
  httpPort?: number;
  httpHost?: string;
  httpAuth?: 'on' | 'off';
  /** M1.5 A.1 — disk-backed history directory the daemon was started
   *  with. `undefined` (or absent) means in-memory only. Surfaced by
   *  `monad serve --status` so users can verify their `MONAD_HISTORY_DIR`
   *  env was picked up. */
  historyDir?: string;
  /** M1.5 A.2 — active tool surface ('none' default, 'readonly' adds
   *  Read · Grep · WebSearch, 'webterm' adds the WT-L-1 web-terminal
   *  tools — List · Snapshot · Input — for PWA-only mode). Surfaced
   *  by `--status`. */
  tools?: 'none' | 'readonly' | 'webterm';
  /** M1.5 A.2 — tool-cwd for fs-bound tools (Read · Grep). Only
   *  meaningful when `tools !== 'none'`. */
  toolCwd?: string;
  /** Step 3 PR β — uuid the daemon registered itself under in
   *  `~/.monad/registry/daemons/<id>.json`. Lets `--status` echo
   *  both the legacy runtime sidecar + the new registry record so
   *  users (and the Phase 2 migration helper) can correlate them. */
  daemonId?: string;
}

export function monadDaemonRuntimePath(): string {
  return joinPath(monadDaemonDir(), 'monad.runtime.json');
}

export function writeMonadDaemonRuntime(meta: MonadDaemonRuntimeMeta): void {
  ensureMonadDaemonDir();
  writeFileSync(
    monadDaemonRuntimePath(),
    JSON.stringify(meta, null, 2),
    { mode: 0o600 },
  );
}

export function readMonadDaemonRuntime(): MonadDaemonRuntimeMeta | null {
  const path = monadDaemonRuntimePath();
  if (!existsSync(path)) return null;
  try {
    const body = readFileSync(path, 'utf-8');
    return JSON.parse(body) as MonadDaemonRuntimeMeta;
  } catch {
    return null;
  }
}

export function deleteMonadDaemonRuntime(): void {
  const path = monadDaemonRuntimePath();
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch { /* best-effort */ }
}
