// Step 5 PR δ — token scope check semantics.

import { describe, expect, test } from 'bun:test';

import { tokenScopeAllows, type ScopedToken } from '../src/auth/scope.js';

const ADMIN: ScopedToken = { token: 't', scope: 'admin' };
const READONLY: ScopedToken = { token: 't', scope: 'read-only' };
const SESSION_S1: ScopedToken = { token: 't', scope: 'session', sessionId: 's1' };

describe('tokenScopeAllows', () => {
  test('admin grants every method', () => {
    expect(tokenScopeAllows(ADMIN, { method: 'GET', pathname: 'registry/daemons' }).ok).toBe(true);
    expect(tokenScopeAllows(ADMIN, { method: 'POST', pathname: 'registry/daemons' }).ok).toBe(true);
    expect(tokenScopeAllows(ADMIN, { method: 'DELETE', pathname: 'registry/daemons/x' }).ok).toBe(true);
  });

  test('read-only grants GET/HEAD/OPTIONS only', () => {
    expect(tokenScopeAllows(READONLY, { method: 'GET', pathname: 'registry/daemons' }).ok).toBe(true);
    expect(tokenScopeAllows(READONLY, { method: 'HEAD', pathname: 'registry/daemons' }).ok).toBe(true);
    expect(tokenScopeAllows(READONLY, { method: 'POST', pathname: 'registry/daemons' }).ok).toBe(false);
    expect(tokenScopeAllows(READONLY, { method: 'PATCH', pathname: 'registry/daemons/x/heartbeat' }).ok).toBe(false);
  });

  test('session token grants reads regardless of target', () => {
    expect(tokenScopeAllows(SESSION_S1, { method: 'GET', pathname: 'registry/daemons' }).ok).toBe(true);
    expect(tokenScopeAllows(SESSION_S1, { method: 'GET', pathname: 'registry/active-session' }).ok).toBe(true);
  });

  test('session token rejects mutating without target', () => {
    const r = tokenScopeAllows(SESSION_S1, { method: 'POST', pathname: 'registry/daemons' });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('session_token_no_target');
  });

  test('session token grants mutation on matching target', () => {
    const r = tokenScopeAllows(SESSION_S1, {
      method: 'PUT',
      pathname: 'registry/active-session',
      targetSessionId: 's1',
    });
    expect(r.ok).toBe(true);
  });

  test('session token rejects mutation on non-matching target', () => {
    const r = tokenScopeAllows(SESSION_S1, {
      method: 'PUT',
      pathname: 'registry/active-session',
      targetSessionId: 's2',
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('session_mismatch');
  });

  test('expired token rejects every scope', () => {
    const past = new Date(Date.now() - 1000).toISOString();
    const expired: ScopedToken = { token: 't', scope: 'admin', expiresAt: past };
    const r = tokenScopeAllows(expired, { method: 'GET', pathname: 'registry/daemons' });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('token_expired');
  });

  test('non-expired admin token grants', () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const ok: ScopedToken = { token: 't', scope: 'admin', expiresAt: future };
    expect(tokenScopeAllows(ok, { method: 'GET', pathname: 'registry/daemons' }).ok).toBe(true);
  });
});
