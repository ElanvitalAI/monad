// ── PKCE primitives (RFC 7636) ──
//
// Used by both the Anthropic authorization-code flow (where PKCE
// protects against auth-code interception) and, on the Codex side,
// for consistency with the server-provided verifier that comes back
// in the device-code poll response. The base64url encoding is the
// RFC 4648 §5 variant — `+` → `-`, `/` → `_`, no padding.

import { randomBytes, createHash } from 'node:crypto';

/** RFC 4648 §5 base64url encoding — no padding. */
export function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Cryptographically-random code_verifier. Length is 32 bytes → 43
 *  base64url chars (well within the 43-128 RFC range). */
export function generateCodeVerifier(): string {
  return base64url(randomBytes(32));
}

/** S256 challenge derived from the verifier. Matches the
 *  code_challenge_method=S256 parameter sent in the authorize URL. */
export function generateCodeChallenge(verifier: string): string {
  return base64url(createHash('sha256').update(verifier).digest());
}

/** CSRF token returned in the callback's `state` parameter. Not
 *  strictly part of PKCE but always paired with it in practice. */
export function generateState(): string {
  return base64url(randomBytes(32));
}

/** Convenience: verifier + challenge + state in one call. */
export interface PkcePair {
  verifier: string;
  challenge: string;
  state: string;
}

export function generatePkcePair(): PkcePair {
  const verifier = generateCodeVerifier();
  return {
    verifier,
    challenge: generateCodeChallenge(verifier),
    state: generateState(),
  };
}
