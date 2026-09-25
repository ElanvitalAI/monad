// Unit tests for ACP transport auth (UI-Core arc Phase U4).

import { describe, expect, test } from 'bun:test';

import {
  compareTokenConstTime,
  createAuthVerifier,
  generateAuthToken,
  type AcpAuthHandshake,
  type AcpAuthTokenRecord,
} from '../src/acp/transport/auth.js';

describe('generateAuthToken', () => {
  test('returns a base64url string of length ≥ 32', () => {
    const tok = generateAuthToken();
    expect(typeof tok).toBe('string');
    expect(tok.length).toBeGreaterThanOrEqual(32);
    // base64url alphabet only.
    expect(/^[A-Za-z0-9_-]+$/.test(tok)).toBe(true);
  });

  test('two calls return distinct tokens', () => {
    const a = generateAuthToken();
    const b = generateAuthToken();
    expect(a).not.toBe(b);
  });
});

describe('compareTokenConstTime', () => {
  test('equal strings → true', () => {
    expect(compareTokenConstTime('abc', 'abc')).toBe(true);
  });

  test('differing strings of same length → false', () => {
    expect(compareTokenConstTime('abc', 'abd')).toBe(false);
  });

  test('differing lengths → false', () => {
    expect(compareTokenConstTime('abc', 'abcd')).toBe(false);
  });

  test('empty strings → true', () => {
    expect(compareTokenConstTime('', '')).toBe(true);
  });
});

describe('createAuthVerifier', () => {
  const tok1 = generateAuthToken();
  const tok2 = generateAuthToken();
  const records: AcpAuthTokenRecord[] = [
    { token: tok1, issuedAt: Date.now() },
    { token: tok2, issuedAt: Date.now(), label: 'iphone' },
  ];
  const verifier = createAuthVerifier(records);

  test('accepts matching token', () => {
    const hs: AcpAuthHandshake = { kind: 'auth', token: tok1 };
    expect(verifier.verify(hs)).toEqual({ ok: true });
  });

  test('accepts second token', () => {
    const hs: AcpAuthHandshake = { kind: 'auth', token: tok2, label: 'iphone' };
    expect(verifier.verify(hs)).toEqual({ ok: true });
  });

  test('rejects wrong token', () => {
    const hs: AcpAuthHandshake = { kind: 'auth', token: 'wrong-token' };
    expect(verifier.verify(hs)).toEqual({ ok: false, reason: 'bad-token' });
  });

  test('rejects missing kind field', () => {
    expect(verifier.verify({ token: tok1 })).toEqual({ ok: false, reason: 'malformed' });
  });

  test('rejects non-object', () => {
    expect(verifier.verify('string')).toEqual({ ok: false, reason: 'malformed' });
    expect(verifier.verify(null)).toEqual({ ok: false, reason: 'malformed' });
    expect(verifier.verify(undefined)).toEqual({ ok: false, reason: 'malformed' });
  });

  test('rejects missing token', () => {
    expect(verifier.verify({ kind: 'auth' })).toEqual({ ok: false, reason: 'malformed' });
  });
});
