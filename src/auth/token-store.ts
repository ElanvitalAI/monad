// Step 5 PR δ — token rotation + envelope store.
//
// PLAN-step5-sdk-zero-env.md §1 D-Phase3-E: explicit `elanous token
// rotate` + 24h grace period. The legacy raw file
// `~/.elanous/acp-token` is migrated to an envelope at
// `~/.elanous/acp-token.json` on first rotate or scoped mint. Both
// files coexist so old tooling that reads the raw file keeps
// working — the envelope is canonical, the raw file is a mirror of
// the active token.
//
// Envelope shape:
//   {
//     active: string,            // current admin token
//     prev?: string,             // grace-period predecessor
//     prevExpiresAt?: string,    // ISO8601
//     scopedTokens?: Record<token, { scope, sessionId?, expiresAt? }>
//   }
//
// Mint chain: a fresh install has neither file. The first call to
// `ensureAdminToken()` mints a random 32-byte hex string + writes
// both files. Subsequent calls return the existing token.

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join as joinPath, dirname } from 'node:path';

import { debug } from '../debug/log.js';
import { mintRandomToken, type ScopedToken, type TokenScope } from './scope.js';

export const ACP_TOKEN_FILE = 'acp-token';
export const ACP_TOKEN_ENVELOPE_FILE = 'acp-token.json';
export const DEFAULT_GRACE_PERIOD_MS = 24 * 60 * 60 * 1000; // 24h

interface ScopedTokenStored {
  scope: TokenScope;
  sessionId?: string;
  expiresAt?: string;
}

export interface TokenStoreEnvelope {
  active: string;
  prev?: string;
  prevExpiresAt?: string;
  scopedTokens?: Record<string, ScopedTokenStored>;
}

export interface TokenStorePaths {
  /** Resolved elanous config root, e.g. from `--config-dir`. */
  configDir?: string;
  /** Test-only home-directory override; token files remain under `.elanous`. */
  homedirOverride?: string;
}

function tokenStoreDir(p?: TokenStorePaths): string {
  return p?.configDir ?? joinPath(p?.homedirOverride ?? homedir(), '.elanous');
}

function rawTokenPath(p?: TokenStorePaths): string {
  return joinPath(tokenStoreDir(p), ACP_TOKEN_FILE);
}

function envelopePath(p?: TokenStorePaths): string {
  return joinPath(tokenStoreDir(p), ACP_TOKEN_ENVELOPE_FILE);
}

function readEnvelope(path: string): TokenStoreEnvelope | null {
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<TokenStoreEnvelope>;
    if (typeof parsed.active !== 'string' || parsed.active.length === 0) return null;
    return parsed as TokenStoreEnvelope;
  } catch (err) {
    debug.log('auth.token-store.envelope.read.error', path, {
      err: (err as Error).message,
    }, { level: 'error' });
    return null;
  }
}

function readRawToken(path: string): string | null {
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, 'utf-8').trim();
    return raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

function atomicWriteJson(path: string, body: unknown, mode = 0o600): void {
  try { mkdirSync(dirname(path), { recursive: true }); } catch { /* ignore */ }
  const tmp = `${path}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  writeFileSync(tmp, JSON.stringify(body, null, 2), { mode });
  renameSync(tmp, path);
}

function atomicWriteText(path: string, text: string, mode = 0o600): void {
  try { mkdirSync(dirname(path), { recursive: true }); } catch { /* ignore */ }
  const tmp = `${path}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  writeFileSync(tmp, text, { mode });
  renameSync(tmp, path);
}

function writeBoth(env: TokenStoreEnvelope, p?: TokenStorePaths): void {
  atomicWriteJson(envelopePath(p), env);
  atomicWriteText(rawTokenPath(p), env.active);
}

/** Read the current envelope, migrating from raw file when needed.
 *  Returns null only when truly absent (fresh install). */
export function loadEnvelope(p?: TokenStorePaths): TokenStoreEnvelope | null {
  const env = readEnvelope(envelopePath(p));
  if (env) return env;
  const raw = readRawToken(rawTokenPath(p));
  if (raw) {
    // Idempotent migration: convert raw → envelope on first call so
    // PR δ tooling can rotate / mint scoped tokens without forcing
    // the user to re-run `elanous serve --http-port`.
    const migrated: TokenStoreEnvelope = { active: raw };
    writeBoth(migrated, p);
    debug.log('auth.token-store.migrated', envelopePath(p));
    return migrated;
  }
  return null;
}

/** Convenience — ensure an admin token exists, mint if not. */
export function ensureAdminToken(p?: TokenStorePaths): string {
  const env = loadEnvelope(p);
  if (env) return env.active;
  const fresh: TokenStoreEnvelope = { active: mintRandomToken() };
  writeBoth(fresh, p);
  if (debug.enabled) debug.log('auth.token-store.first-mint', envelopePath(p));
  return fresh.active;
}

export interface RotateResult {
  newActive: string;
  prev: string;
  prevExpiresAt: string;
}

/** Rotate the admin token. Mints a fresh `active`, demotes the old
 *  `active` to `prev` with a 24h expiry. The control plane checks
 *  both during the grace period so surfaces have time to refresh
 *  their cached token without forced reconnect. */
export function rotateAdminToken(
  p?: TokenStorePaths & { gracePeriodMs?: number },
): RotateResult {
  const grace = p?.gracePeriodMs ?? DEFAULT_GRACE_PERIOD_MS;
  let env = loadEnvelope(p);
  if (!env) {
    // No existing token — initial mint, no rotation semantics.
    const fresh = ensureAdminToken(p);
    return { newActive: fresh, prev: '', prevExpiresAt: new Date(0).toISOString() };
  }
  const prev = env.active;
  const newActive = mintRandomToken();
  const prevExpiresAt = new Date(Date.now() + grace).toISOString();
  env = { ...env, active: newActive, prev, prevExpiresAt };
  writeBoth(env, p);
  return { newActive, prev, prevExpiresAt };
}

export interface MintScopedOpts {
  scope: TokenScope;
  sessionId?: string;
  expiresAt?: string;
}

/** Mint a scoped token (per-session ACL — BACKLOG #6 close). The
 *  caller (CLI / surface attach flow) gets the token string back +
 *  a copy is persisted in the envelope so the server can validate
 *  it. Scoped tokens never enter the raw-file mirror — that file
 *  always reflects the admin token only. */
export function mintScopedToken(
  opts: MintScopedOpts,
  p?: TokenStorePaths,
): string {
  if (opts.scope === 'session' && !opts.sessionId) {
    throw new Error('mintScopedToken: session scope requires sessionId');
  }
  let env = loadEnvelope(p);
  if (!env) {
    // Surface the chicken-and-egg explicitly — a scoped token
    // without an underlying admin token has no signing chain.
    throw new Error(
      'mintScopedToken: no admin token exists. Run `elanous serve --http-port` once or `elanous token rotate` first.',
    );
  }
  const tok = mintRandomToken();
  const stored: ScopedTokenStored = { scope: opts.scope };
  if (opts.sessionId) stored.sessionId = opts.sessionId;
  if (opts.expiresAt) stored.expiresAt = opts.expiresAt;
  env = {
    ...env,
    scopedTokens: { ...(env.scopedTokens ?? {}), [tok]: stored },
  };
  writeBoth(env, p);
  return tok;
}

/** Revoke a scoped token. Returns true when the token existed. */
export function revokeScopedToken(token: string, p?: TokenStorePaths): boolean {
  let env = loadEnvelope(p);
  if (!env || !env.scopedTokens || !(token in env.scopedTokens)) return false;
  const next = { ...env.scopedTokens };
  delete next[token];
  env = { ...env, scopedTokens: next };
  writeBoth(env, p);
  return true;
}

/** Resolve a presented token string into a `ScopedToken` record (or
 *  null when unknown). Used by the control plane HTTP server. */
export function resolveToken(token: string, p?: TokenStorePaths): ScopedToken | null {
  const env = loadEnvelope(p);
  if (!env) return null;

  if (token === env.active) {
    return { token, scope: 'admin' };
  }
  if (env.prev && token === env.prev && env.prevExpiresAt) {
    const t = Date.parse(env.prevExpiresAt);
    if (Number.isFinite(t) && t > Date.now()) {
      return { token, scope: 'admin' };
    }
    return null; // expired
  }
  const stored = env.scopedTokens?.[token];
  if (stored) {
    const out: ScopedToken = { token, scope: stored.scope };
    if (stored.sessionId !== undefined) out.sessionId = stored.sessionId;
    if (stored.expiresAt !== undefined) out.expiresAt = stored.expiresAt;
    return out;
  }
  return null;
}

/** Forget every token (test cleanup). */
export function clearTokenStore(p?: TokenStorePaths): void {
  for (const path of [envelopePath(p), rawTokenPath(p)]) {
    try { if (existsSync(path)) unlinkSync(path); } catch { /* ignore */ }
  }
}
