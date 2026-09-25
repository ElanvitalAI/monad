// Discord runtime lock — mirrors telegram-lock.ts. Only ONE
// `monad discord run` daemon should be connected to the Gateway
// for a given bot token at a time; Discord will terminate the
// older session on identify if two processes IDENTIFY with the
// same token, so unchecked double-starts cause flaps rather than
// silent data loss.
//
// The underlying lock primitives live in telegram-lock.ts and are
// already path-parameterized — we just supply a different default
// path here. Keeping the two as sibling modules (rather than one
// generic `bot-lock.ts`) preserves the existing telegram-lock
// tests + imports without a rename churn.

import {
  acquireTelegramLock,
  isAliveLock,
  safeReadLock,
  TelegramLockError,
  type AcquireOpts,
  type LockMeta,
} from './telegram-lock.js';

export type DiscordLockMeta = LockMeta;
export type DiscordAcquireOpts = AcquireOpts;

/** Thrown when another process holds the Discord lock. Re-exported
 *  as an alias so catch-sites reading the error type see the
 *  service-correct name even though the underlying class is shared
 *  with the Telegram lock. */
export class DiscordLockError extends TelegramLockError {}

export function defaultDiscordLockPath(configDir: string): string {
  return `${configDir.replace(/\/$/, '')}/discord.lock`;
}

export function acquireDiscordLock(lockPath: string, opts: DiscordAcquireOpts = {}): () => void {
  try {
    return acquireTelegramLock(lockPath, opts);
  } catch (err) {
    // Rewrap so callers pattern-match against DiscordLockError.
    if (err instanceof TelegramLockError) {
      throw Object.assign(new DiscordLockError(err.existing, err.lockPath), { cause: err });
    }
    throw err;
  }
}

export function safeReadDiscordLock(lockPath: string): DiscordLockMeta | null {
  return safeReadLock(lockPath);
}

export function isAliveDiscordLock(meta: DiscordLockMeta): boolean {
  return isAliveLock(meta);
}
