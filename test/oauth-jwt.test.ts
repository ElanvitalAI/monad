// ── JWT decode + ChatGPT claim extraction tests ──
//
// We don't verify signatures, so these tests only check that valid
// base64url payloads round-trip and that defensive paths (malformed,
// wrong segment count, missing claim path, missing account id) all
// return null rather than throwing.

import { describe, test, expect } from 'bun:test';
import {
  decodeJWTPayload, extractChatGPTClaims, JWT_CLAIM_PATH,
} from '../src/oauth/jwt';

/** Produce a JWT with the given payload object. Header/signature
 *  segments are decorative — the decoder ignores them. */
function makeJWT(payload: unknown): string {
  const b64url = (s: string) =>
    Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const sig = 'signature-placeholder';
  return `${header}.${body}.${sig}`;
}

describe('decodeJWTPayload', () => {
  test('round-trips a well-formed payload', () => {
    const token = makeJWT({ sub: 'u-1', foo: 'bar', n: 42 });
    const decoded = decodeJWTPayload(token);
    expect(decoded).not.toBeNull();
    expect(decoded!.sub).toBe('u-1');
    expect(decoded!.foo).toBe('bar');
    expect(decoded!.n).toBe(42);
  });

  test('tolerates missing base64url padding', () => {
    // Payload length hand-picked so base64 encoding needs '==' padding
    // that the base64url form strips. Decoder must re-pad.
    const token = makeJWT({ x: 'a' });
    // Ensure the middle segment has no '=' chars (base64url).
    const mid = token.split('.')[1]!;
    expect(mid.includes('=')).toBe(false);
    expect(decodeJWTPayload(token)).not.toBeNull();
  });

  test('returns null on wrong segment count', () => {
    expect(decodeJWTPayload('a.b')).toBeNull();
    expect(decodeJWTPayload('a.b.c.d')).toBeNull();
    expect(decodeJWTPayload('')).toBeNull();
  });

  test('returns null when middle segment is not valid JSON', () => {
    const bad = `header.${Buffer.from('not-json').toString('base64url')}.sig`;
    expect(decodeJWTPayload(bad)).toBeNull();
  });

  test('returns null when middle segment is JSON but not an object', () => {
    const arrJwt = makeJWT([1, 2, 3] as unknown as object);
    const numJwt = `h.${Buffer.from('42').toString('base64url')}.s`;
    expect(decodeJWTPayload(arrJwt)).toBeNull();
    expect(decodeJWTPayload(numJwt)).toBeNull();
  });

  test('returns null for non-string inputs', () => {
    // @ts-expect-error intentionally wrong type
    expect(decodeJWTPayload(null)).toBeNull();
    // @ts-expect-error intentionally wrong type
    expect(decodeJWTPayload(undefined)).toBeNull();
  });
});

describe('extractChatGPTClaims', () => {
  test('extracts account/plan/user ids from the nested claim path', () => {
    const token = makeJWT({
      sub: 'u-1',
      [JWT_CLAIM_PATH]: {
        chatgpt_account_id: 'acct-uuid-1',
        chatgpt_plan_type: 'pro',
        chatgpt_user_id: 'user-uuid-1',
      },
    });
    const claims = extractChatGPTClaims(token);
    expect(claims).toEqual({
      accountId: 'acct-uuid-1',
      planType: 'pro',
      userId: 'user-uuid-1',
    });
  });

  test('accountId alone is enough — plan/user fields are optional', () => {
    const token = makeJWT({
      [JWT_CLAIM_PATH]: { chatgpt_account_id: 'acct-only' },
    });
    const claims = extractChatGPTClaims(token);
    expect(claims).toEqual({ accountId: 'acct-only' });
  });

  test('returns null when claim path is absent', () => {
    const token = makeJWT({ sub: 'u-1' });
    expect(extractChatGPTClaims(token)).toBeNull();
  });

  test('returns null when accountId is missing inside the claim path', () => {
    const token = makeJWT({
      [JWT_CLAIM_PATH]: { chatgpt_plan_type: 'plus' },
    });
    expect(extractChatGPTClaims(token)).toBeNull();
  });

  test('returns null when claim path is not an object', () => {
    const token = makeJWT({
      [JWT_CLAIM_PATH]: 'acct-as-string',
    });
    expect(extractChatGPTClaims(token)).toBeNull();
  });

  test('returns null for garbage tokens without throwing', () => {
    expect(extractChatGPTClaims('')).toBeNull();
    expect(extractChatGPTClaims('not-a-jwt')).toBeNull();
    expect(extractChatGPTClaims('only.two')).toBeNull();
  });
});
