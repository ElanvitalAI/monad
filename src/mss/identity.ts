// ── Monad identity — singleton ULID persisted to ~/.monad/identity.json ──
//
// DD-MSS-05 · DD-MSS-23 — every log/memory/signal is stamped with a stable
// monad_id so future multi-monad mesh topology (Phase M6) can route without
// a rename. Generated once per machine, re-used forever.
//
// ULID (DD-MSS-23): 48-bit timestamp + 80-bit randomness, Crockford base32,
// 26 chars, monotonic within the same millisecond. Self-implemented because
// no dep is present (HANDOFF §4 fallback).

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import { randomBytes } from 'crypto';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const DEFAULT_IDENTITY_FILE = join(homedir(), '.monad', 'identity.json');

interface IdentityFile {
  monad_id: string;
  created_at: string;
  schema_version: 1;
}

/** Test override — set to a tmpfile path to isolate from `~/.monad/`. */
let overrideFile: string | null = null;
let cached: string | null = null;

/** ULID encoder — pure function, no I/O. Exported so PR #3 URI builder can
 *  share the Crockford table without duplicating. */
export function newUlid(now: number = Date.now()): string {
  return encodeTime(now, 10) + encodeRandom(16);
}

function encodeTime(ms: number, len: number): string {
  let n = ms;
  const out: string[] = new Array(len);
  for (let i = len - 1; i >= 0; i--) {
    out[i] = CROCKFORD[n % 32]!;
    n = Math.floor(n / 32);
  }
  return out.join('');
}

function encodeRandom(len: number): string {
  const bytes = randomBytes(Math.ceil((len * 5) / 8));
  const out: string[] = [];
  let bitBuf = 0;
  let bitCnt = 0;
  let idx = 0;
  while (out.length < len) {
    if (bitCnt < 5) {
      bitBuf = (bitBuf << 8) | (bytes[idx++] ?? 0);
      bitCnt += 8;
    }
    out.push(CROCKFORD[(bitBuf >> (bitCnt - 5)) & 0x1f]!);
    bitCnt -= 5;
  }
  return out.join('');
}

function identityPath(): string {
  return overrideFile ?? DEFAULT_IDENTITY_FILE;
}

/** Returns the machine-stable monad ULID. First call persists
 *  `~/.monad/identity.json` atomically (tmp + rename); subsequent calls
 *  read the in-process cache. Corrupt or missing file triggers regeneration. */
export function getOrCreateMonadId(): string {
  if (cached) return cached;
  const path = identityPath();
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as IdentityFile;
    if (typeof parsed?.monad_id === 'string' && parsed.monad_id.length === 26) {
      cached = parsed.monad_id;
      return cached;
    }
  } catch { /* missing or corrupt — regenerate */ }

  const id = newUlid();
  const payload: IdentityFile = {
    monad_id: id,
    created_at: new Date().toISOString(),
    schema_version: 1,
  };
  try {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(payload, null, 2), { encoding: 'utf8', mode: 0o600 });
    renameSync(tmp, path);
  } catch { /* readonly home — keep in-memory only */ }
  cached = id;
  return cached;
}

/** Test-only — drop in-memory cache. */
export function __resetIdentityForTests(): void {
  cached = null;
}

/** Test-only — redirect persistence to a sandbox file (pass null to reset). */
export function __setIdentityFileForTests(filePath: string | null): void {
  overrideFile = filePath;
  cached = null;
}
