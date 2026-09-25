// ── PKCE primitive tests ──

import { describe, test, expect } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  base64url, generateCodeVerifier, generateCodeChallenge,
  generateState, generatePkcePair,
} from '../src/oauth/pkce';

describe('base64url', () => {
  test('no padding, - and _ instead of + /', () => {
    const buf = Buffer.from([0xff, 0xff, 0xff]);
    const encoded = base64url(buf);
    expect(encoded).not.toMatch(/=/);
    expect(encoded).not.toMatch(/[+/]/);
  });

  test('round-trip matches std base64 minus pad', () => {
    const buf = Buffer.from('hello world');
    const std = buf.toString('base64').replace(/=/g, '');
    // std for "hello world" = "aGVsbG8gd29ybGQ"  (no +/_)
    expect(base64url(buf)).toBe(std);
  });
});

describe('codeVerifier / codeChallenge', () => {
  test('verifier length is 43 (32 bytes base64url)', () => {
    expect(generateCodeVerifier().length).toBe(43);
  });

  test('challenge is SHA256(verifier) base64url', () => {
    const v = 'fixed-verifier-for-test';
    const expected = base64url(createHash('sha256').update(v).digest());
    expect(generateCodeChallenge(v)).toBe(expected);
  });

  test('two generated verifiers differ', () => {
    expect(generateCodeVerifier()).not.toBe(generateCodeVerifier());
  });

  test('generatePkcePair gives consistent challenge', () => {
    const p = generatePkcePair();
    expect(p.challenge).toBe(generateCodeChallenge(p.verifier));
    expect(p.state.length).toBeGreaterThan(32);
  });
});

describe('state', () => {
  test('unique per call', () => {
    expect(generateState()).not.toBe(generateState());
  });
});
