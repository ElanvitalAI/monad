// Step 5 PR δ — token store envelope migration + rotation +
// scoped-token mint + resolveToken lookup.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';

import {
  ACP_TOKEN_ENVELOPE_FILE,
  ACP_TOKEN_FILE,
  clearTokenStore,
  ensureAdminToken,
  loadEnvelope,
  mintScopedToken,
  resolveToken,
  revokeScopedToken,
  rotateAdminToken,
} from '../src/auth/token-store.js';

let tmpHome = '';

beforeEach(() => {
  tmpHome = mkdtempSync(joinPath(tmpdir(), 'elanous-token-store-'));
  mkdirSync(joinPath(tmpHome, '.elanous'), { recursive: true });
});

afterEach(() => {
  if (tmpHome) rmSync(tmpHome, { recursive: true, force: true });
});

const opts = () => ({ homedirOverride: tmpHome });

describe('ensureAdminToken', () => {
  test('mints a fresh token when nothing exists', () => {
    const tok = ensureAdminToken(opts());
    expect(tok).toMatch(/^[0-9a-f]{64}$/);
    expect(existsSync(joinPath(tmpHome, '.elanous', ACP_TOKEN_FILE))).toBe(true);
    expect(existsSync(joinPath(tmpHome, '.elanous', ACP_TOKEN_ENVELOPE_FILE))).toBe(true);
  });

  test('idempotent — returns existing on subsequent calls', () => {
    const a = ensureAdminToken(opts());
    const b = ensureAdminToken(opts());
    expect(a).toBe(b);
  });

  test('migrates raw file to envelope', () => {
    writeFileSync(joinPath(tmpHome, '.elanous', ACP_TOKEN_FILE), 'legacy-raw-token', 'utf-8');
    const tok = ensureAdminToken(opts());
    expect(tok).toBe('legacy-raw-token');
    const envelope = JSON.parse(readFileSync(joinPath(tmpHome, '.elanous', ACP_TOKEN_ENVELOPE_FILE), 'utf-8'));
    expect(envelope.active).toBe('legacy-raw-token');
  });
});

describe('rotateAdminToken', () => {
  test('demotes active to prev with grace period', () => {
    const original = ensureAdminToken(opts());
    const result = rotateAdminToken(opts());
    expect(result.newActive).not.toBe(original);
    expect(result.prev).toBe(original);
    expect(Date.parse(result.prevExpiresAt)).toBeGreaterThan(Date.now());

    const env = loadEnvelope(opts());
    expect(env?.active).toBe(result.newActive);
    expect(env?.prev).toBe(original);
  });

  test('honors --grace-hours override', () => {
    ensureAdminToken(opts());
    const before = Date.now();
    rotateAdminToken({ ...opts(), gracePeriodMs: 1000 });
    const env = loadEnvelope(opts())!;
    const expiresAt = Date.parse(env.prevExpiresAt!);
    expect(expiresAt - before).toBeGreaterThanOrEqual(1000);
    expect(expiresAt - before).toBeLessThan(2000);
  });

  test('rotate without prior token initializes', () => {
    const result = rotateAdminToken(opts());
    expect(result.newActive).toMatch(/^[0-9a-f]{64}$/);
    expect(result.prev).toBe('');
  });
});

describe('mintScopedToken', () => {
  test('session-scope token persisted', () => {
    ensureAdminToken(opts());
    const tok = mintScopedToken({ scope: 'session', sessionId: 's1' }, opts());
    const env = loadEnvelope(opts())!;
    expect(env.scopedTokens?.[tok]).toEqual({ scope: 'session', sessionId: 's1' });
  });

  test('read-only scope token persisted', () => {
    ensureAdminToken(opts());
    const tok = mintScopedToken({ scope: 'read-only' }, opts());
    const env = loadEnvelope(opts())!;
    expect(env.scopedTokens?.[tok]).toEqual({ scope: 'read-only' });
  });

  test('rejects session scope without sessionId', () => {
    ensureAdminToken(opts());
    expect(() =>
      mintScopedToken({ scope: 'session' }, opts()),
    ).toThrow(/session scope requires sessionId/);
  });

  test('rejects when no admin token exists yet', () => {
    expect(() =>
      mintScopedToken({ scope: 'session', sessionId: 's1' }, opts()),
    ).toThrow(/no admin token exists/);
  });

  test('preserves existing scoped tokens on subsequent mint', () => {
    ensureAdminToken(opts());
    const t1 = mintScopedToken({ scope: 'session', sessionId: 's1' }, opts());
    const t2 = mintScopedToken({ scope: 'session', sessionId: 's2' }, opts());
    const env = loadEnvelope(opts())!;
    expect(Object.keys(env.scopedTokens ?? {})).toEqual(expect.arrayContaining([t1, t2]));
  });
});

describe('revokeScopedToken', () => {
  test('removes the token, returns true', () => {
    ensureAdminToken(opts());
    const tok = mintScopedToken({ scope: 'session', sessionId: 's1' }, opts());
    expect(revokeScopedToken(tok, opts())).toBe(true);
    expect(loadEnvelope(opts())?.scopedTokens?.[tok]).toBeUndefined();
  });

  test('returns false for unknown token', () => {
    ensureAdminToken(opts());
    expect(revokeScopedToken('does-not-exist', opts())).toBe(false);
  });
});

describe('resolveToken', () => {
  test('admin token → admin scope', () => {
    const tok = ensureAdminToken(opts());
    const r = resolveToken(tok, opts());
    expect(r?.scope).toBe('admin');
  });

  test('rotated prev token within grace → admin', () => {
    const original = ensureAdminToken(opts());
    rotateAdminToken(opts());
    const r = resolveToken(original, opts());
    expect(r?.scope).toBe('admin');
  });

  test('rotated prev token past grace → null', () => {
    ensureAdminToken(opts());
    const original = ensureAdminToken(opts()); // re-read
    rotateAdminToken({ ...opts(), gracePeriodMs: 10 });
    // Sleep past grace.
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        const r = resolveToken(original, opts());
        expect(r).toBeNull();
        resolve();
      }, 50);
    });
  });

  test('scoped token → its scope', () => {
    ensureAdminToken(opts());
    const tok = mintScopedToken({ scope: 'session', sessionId: 's1' }, opts());
    const r = resolveToken(tok, opts());
    expect(r?.scope).toBe('session');
    expect(r?.sessionId).toBe('s1');
  });

  test('unknown token → null', () => {
    ensureAdminToken(opts());
    expect(resolveToken('not-a-real-token', opts())).toBeNull();
  });

  test('null when no envelope exists', () => {
    expect(resolveToken('anything', opts())).toBeNull();
  });
});

describe('clearTokenStore', () => {
  test('removes both files', () => {
    ensureAdminToken(opts());
    expect(existsSync(joinPath(tmpHome, '.elanous', ACP_TOKEN_FILE))).toBe(true);
    expect(existsSync(joinPath(tmpHome, '.elanous', ACP_TOKEN_ENVELOPE_FILE))).toBe(true);
    clearTokenStore(opts());
    expect(existsSync(joinPath(tmpHome, '.elanous', ACP_TOKEN_FILE))).toBe(false);
    expect(existsSync(joinPath(tmpHome, '.elanous', ACP_TOKEN_ENVELOPE_FILE))).toBe(false);
  });
});
