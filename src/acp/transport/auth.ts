// UI-Core arc Phase U4 — transport-level authentication.
//
// Unix sockets use filesystem permissions + owner uid (the kernel
// guarantees only the owner can read/write a 0600 socket, so no
// token needed for loopback). Network transports (WebSocket · SSH
// stdin relayed) use a random token that the client sends in a
// handshake message before any ACP JSON-RPC starts.
//
// Tokens are issued per-elanous-instance and written to a 0600 file
// at `~/.elanous/acp-tokens.json` so a paired client can read it
// without us shipping a credential out-of-band. Rotation is coarse —
// the whole file gets rewritten with a fresh token on demand; there
// is no long-lived refresh flow (mesh identity via Tailscale / SSH
// cert is the better long-term path, and that's handled by the
// underlying transport, not this module).

import { randomBytes } from 'node:crypto';

/** Opaque token string — 256 bits of entropy encoded base64url. */
export type AcpAuthToken = string;

export interface AcpAuthTokenRecord {
  token: AcpAuthToken;
  issuedAt: number;
  /** Optional label so multiple clients on one machine can be
   *  identified in debug logs. */
  label?: string;
}

/** Generate a fresh, cryptographically-random token. */
export function generateAuthToken(): AcpAuthToken {
  return randomBytes(32).toString('base64url');
}

/** Constant-time comparison — avoids timing leaks when an attacker
 *  can observe round-trip timings. Both strings must be the same
 *  byte length for the check to succeed. */
export function compareTokenConstTime(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** Handshake envelope: the first line a network-transport client
 *  sends. JSON on a single line so we can parse it without pulling
 *  in a wire-format dependency. The server replies with either
 *  `{ok: true}` or `{ok: false, reason}` on its own line before
 *  handing off to the ACP SDK. */
export interface AcpAuthHandshake {
  kind: 'auth';
  token: AcpAuthToken;
  /** Optional client label — shown in server-side debug logs. */
  label?: string;
}

export type AcpAuthHandshakeResult =
  | { ok: true }
  | { ok: false; reason: 'bad-token' | 'malformed' | 'expired' };

export interface AcpAuthVerifier {
  verify(handshake: unknown): AcpAuthHandshakeResult;
}

/** Supplies the accepted set at verification time. Use this — not a fixed
 *  array — when the set can change while the server runs (token rotation).
 *  ⭐ A throwing supplier is treated as deny (fail-closed) — the verifier converts it,
 *  so a transient read error cannot crash the handshake. */
export type AcpAuthTokenSupplier = () => readonly AcpAuthTokenRecord[];

/** Build a verifier that accepts any token matching the given issued
 *  set (constant-time).
 *
 *  ⭐ `accepted` may be a **supplier** instead of a fixed array. A fixed array
 *  is captured once, so a server holding it cannot follow a token rotation
 *  without restarting; a supplier is consulted on every handshake.
 *
 *  ⛔ Comparison stays `compareTokenConstTime` in both shapes. Do NOT reach for
 *  `resolveToken()` here — it decides with `===`, which reintroduces the timing
 *  leak this module exists to avoid. Read the envelope to build the set, then
 *  compare here. */
export function createAuthVerifier(
  accepted: readonly AcpAuthTokenRecord[] | AcpAuthTokenSupplier,
): AcpAuthVerifier {
  const currentlyAccepted = typeof accepted === 'function' ? accepted : () => accepted;
  return {
    verify(raw): AcpAuthHandshakeResult {
      if (!raw || typeof raw !== 'object') return { ok: false, reason: 'malformed' };
      const h = raw as Partial<AcpAuthHandshake>;
      if (h.kind !== 'auth' || typeof h.token !== 'string') return { ok: false, reason: 'malformed' };
      // ⛔ 공급자가 던지면 «핸드셰이크 전체»가 예외로 죽는다. 인증은 fail-closed 여야 하므로
      //    던짐을 «거부»로 바꾼다 — 문서의 「던지지 마라」 계약에만 기대지 않는다.
      let accepted: readonly AcpAuthTokenRecord[];
      try {
        accepted = currentlyAccepted();
      } catch {
        return { ok: false, reason: 'bad-token' };
      }
      for (const rec of accepted) {
        if (compareTokenConstTime(rec.token, h.token)) return { ok: true };
      }
      return { ok: false, reason: 'bad-token' };
    },
  };
}
