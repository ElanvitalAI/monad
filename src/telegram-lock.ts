// ── Telegram runtime lock ────────────────────────────────────────
//
// Only ONE `monad telegram run` daemon (or dashboard-embedded poller)
// should be polling a given bot token at a time. Two pollers split
// update deliveries via Telegram's `offset` contract — whichever hits
// /getUpdates first consumes the update and moves the offset, so the
// loser loses messages silently. Telegram also returns HTTP 409
// Conflict when two pollers overlap (see telegram.ts start loop) but
// detecting that mid-flight doesn't help us avoid corrupted state.
//
// Lock strategy: a JSON file at `~/.config/monad/telegram.lock` keyed
// on (pid, host, startedAt, label). Startup:
//   1. If no file → we acquire, write our meta, register cleanup.
//   2. If file exists:
//      a. Parse → if malformed, treat as stale and overwrite.
//      b. Same host AND `kill -0 pid` succeeds → still alive; refuse.
//      c. Different host → assume alive (can't verify remotely);
//         refuse unless the caller passes { force: true }.
//      d. Same host, `kill -0 pid` fails → stale, overwrite.
//
// Cleanup: release() on normal exit, SIGINT, and an explicit stop.
// Registered as a process.once('exit') listener so hard-kills via
// process.exit leave the lock for the next run to GC.

import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname } from 'node:path';
import { isPidAlive } from './process/pid-liveness.js';

export interface LockMeta {
  pid: number;
  host: string;
  /** ISO timestamp when the lock was acquired. */
  startedAt: string;
  /** Human-readable label — 'cli' | 'dashboard' | 'wizard' — so the
   *  "existing lock" error message tells the user what to kill. */
  label?: string;
}

export class TelegramLockError extends Error {
  constructor(public readonly existing: LockMeta, public readonly lockPath: string) {
    super(
      `telegram bot already running: pid=${existing.pid} host=${existing.host} ` +
      `since ${existing.startedAt}${existing.label ? ` (${existing.label})` : ''}`,
    );
    this.name = 'TelegramLockError';
  }
}

export interface AcquireOpts {
  /** When true, overwrite an existing lock even if the holder seems
   *  alive. Users pass --force after manually confirming the prior
   *  process is dead or stuck. */
  force?: boolean;
  /** Short label to identify this lock owner in error messages. */
  label?: string;
}

/** Try to acquire the lock. Returns a release callback on success;
 *  throws {@link TelegramLockError} when the lock is held by another
 *  live process. */
export function acquireTelegramLock(lockPath: string, opts: AcquireOpts = {}): () => void {
  mkdirSync(dirname(lockPath), { recursive: true });
  if (existsSync(lockPath)) {
    const existing = safeReadLock(lockPath);
    if (existing && !opts.force && isAliveLock(existing)) {
      throw new TelegramLockError(existing, lockPath);
    }
    // Either malformed, stale, or --force — clear and re-acquire.
    try { unlinkSync(lockPath); } catch { /* ignore */ }
  }
  const meta: LockMeta = {
    pid: process.pid,
    host: hostname(),
    startedAt: new Date().toISOString(),
    ...(opts.label ? { label: opts.label } : {}),
  };
  writeFileSync(lockPath, JSON.stringify(meta, null, 2));
  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    try {
      const current = safeReadLock(lockPath);
      // Only unlink when the lock still points to us — avoids
      // deleting a lock that was taken over after we mis-released.
      if (current && current.pid === process.pid && current.host === hostname()) {
        unlinkSync(lockPath);
      }
    } catch { /* ignore */ }
  };
  process.once('exit', release);
  process.once('SIGINT', () => { release(); });
  process.once('SIGTERM', () => { release(); });
  return release;
}

/** Read the lock file without throwing on missing / malformed content.
 *  Returns null when the file doesn't exist or JSON parse fails. */
export function safeReadLock(lockPath: string): LockMeta | null {
  try {
    if (!existsSync(lockPath)) return null;
    const body = readFileSync(lockPath, 'utf-8');
    const parsed = JSON.parse(body) as Partial<LockMeta>;
    if (typeof parsed.pid !== 'number') return null;
    if (typeof parsed.host !== 'string') return null;
    if (typeof parsed.startedAt !== 'string') return null;
    return parsed as LockMeta;
  } catch { return null; }
}

/** Decide if a recorded lock is still owned by a live process. When
 *  the host differs from ours, assume alive (we can't signal across
 *  hosts without extra infra). */
export function isAliveLock(meta: LockMeta): boolean {
  if (meta.host !== hostname()) return true;
  // ⛔ EPERM 은 「죽음」이 아니다 — 공용 판정으로 모았다(2026-09-20 전수: 15곳 중 10곳이 접고 있었다)
    return isPidAlive(meta.pid);
}

/** Default lock path under the user's monad config dir. Derived via
 *  a callback so the caller can substitute paths in tests. */
export function defaultLockPath(configDir: string): string {
  return `${configDir.replace(/\/$/, '')}/telegram.lock`;
}
