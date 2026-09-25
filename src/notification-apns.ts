// Phase 0.5 · APNs (Apple Push Notification service) production transport.
//
// W7 cascade-zyu land 된 `src/showroom/outbound/channels/ios-push.ts` 의
// `ApnsTransport` interface 의 production 구현. Node 의 builtin
// `node:http2` + ES256 JWT 서명 으로 Apple HTTP/2 endpoint
// (api{,.sandbox}.push.apple.com) 에 POST.
//
// 사용 예 (intent-prediction push 또는 OutboundRouter):
//   import { createApnsTransport } from '../notification-apns.js';
//   const transport = createApnsTransport({
//     keyId, teamId, bundleId, keyPem,            // user-config 또는 env
//     environment: 'production',                  // 'sandbox' = dev
//   });
//   const channel = createIosPushChannel({ tokenStore, transport });
//
// Cross-ref:
//   내부 문서 `PLAN-ios-companion-app-2026-05-08` §7.1 (notification-apns.ts 의 위치)
//   내부 문서 `PLAN-ios-companion-app-2026-05-08` §7.4 (APNs payload format)
//   src/showroom/outbound/channels/ios-push.ts (channel + payload builder)
//
// APNs spec 핵심:
//   - Endpoint: api.push.apple.com / api.sandbox.push.apple.com (port 443)
//   - Path: /3/device/<hex device token>
//   - Auth: `authorization: bearer <JWT>` (Provider Authentication Token)
//   - JWT alg = ES256 (ECDSA-P256 + SHA-256), signed with .p8 private key
//   - JWT header `kid` = Auth Key ID, payload `iss` = Team ID, `iat` = unix
//   - Topic: `apns-topic: <bundle id>` (or extended for VoIP / complications)
//   - Tokens may be refreshed up to 60min, must refresh after 20min for new
//     sends. We cache + lazy-refresh inside `getOrRefreshToken()`.

import { connect } from 'node:http2';
import { createSign, createPrivateKey, type KeyObject } from 'node:crypto';
import type { ApnsPayload, ApnsTransport } from './showroom/outbound/channels/ios-push.js';

const APNS_PRODUCTION_HOST = 'api.push.apple.com';
const APNS_SANDBOX_HOST    = 'api.sandbox.push.apple.com';
const APNS_PORT            = 443;
// Apple refreshes are valid 20-60 min. We refresh at the 50-min mark so
// in-flight requests always have a fresh-enough token. Tests inject
// `now()` to advance the clock without sleeping.
const TOKEN_REFRESH_MS     = 50 * 60 * 1000;

export interface ApnsTransportOpts {
  /** Auth Key ID (`kid` JWT header field). 10-char Apple identifier
   *  shown next to the .p8 file on developer.apple.com. */
  keyId: string;
  /** Apple Team ID (`iss` JWT payload field). 10-char Apple identifier. */
  teamId: string;
  /** App bundle id (`apns-topic` header). */
  bundleId: string;
  /** P-256 private key in PEM form. Read from the .p8 file once at
   *  boot. Pass the file content directly; we never read disk so
   *  callers control secret lifetime + redaction. */
  keyPem: string;
  /** 'production' = `api.push.apple.com`, 'sandbox' = TestFlight /
   *  dev builds. Defaults to 'production' so a misconfigured caller
   *  fails loudly on the dev/prod mismatch rather than silently
   *  delivering to the wrong fleet. */
  environment?: 'production' | 'sandbox';
  /** `apns-push-type` default. Alerts use 'alert'; silent / background
   *  updates use 'background'; Live Activity uses 'liveactivity'. The
   *  payload builder can override per-send via the `pushType` arg. */
  defaultPushType?: 'alert' | 'background' | 'liveactivity' | 'voip' | 'complication';
  /** Test seam — defaults to Date.now. */
  now?: () => number;
  /** Test seam — defaults to opening a real http/2 session. Tests
   *  inject a fake to assert payload shape without network. */
  http2Connect?: (host: string, port: number) => Http2SessionLike;
}

/** Subset of `node:http2` ClientHttp2Session that the transport uses.
 *  Tests inject a fake satisfying this surface; production passes the
 *  real `node:http2.connect()` return. */
export interface Http2SessionLike {
  request(headers: Record<string, string | number>): Http2StreamLike;
  close?(): void;
  destroyed?: boolean;
}

export interface Http2StreamLike {
  end(body?: string | Buffer): void;
  on(event: 'response', listener: (headers: Record<string, string | number | undefined>) => void): this;
  on(event: 'data', listener: (chunk: Buffer | string) => void): this;
  on(event: 'end', listener: () => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
  setEncoding?(enc: string): void;
}

/** Cached, lazy-refreshed JWT bearer token. */
interface TokenState {
  jwt: string;
  issuedAt: number;
}

/** Encode bytes / string as base64url (RFC 4648 §5 · no padding). */
function base64url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf.toString('base64')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

/** Convert the ASN.1 DER signature emitted by node:crypto to the raw
 *  r||s JOSE encoding expected by JWT (ES256 = 32-byte r + 32-byte s).
 *
 *  DER shape (P-256):
 *    SEQUENCE { INTEGER r ; INTEGER s }
 *      0x30 <len> 0x02 <rLen> <r…> 0x02 <sLen> <s…>
 *  ASN.1 INTEGER is signed two's complement so r/s may be 33 bytes
 *  with a leading 0x00. We trim leading zeros or left-pad to 32. */
export function derToJoseEs256(der: Buffer): Buffer {
  if (der[0] !== 0x30) throw new Error('apns: DER signature missing SEQUENCE tag');
  // Length can be 1-byte or 2-byte (0x81 <len>) for long form.
  let cursor = 2;
  if ((der[1]! & 0x80) !== 0) {
    cursor = 2 + (der[1]! & 0x7f);
  }
  if (der[cursor] !== 0x02) throw new Error('apns: DER missing INTEGER r');
  const rLen = der[cursor + 1]!;
  let r = der.subarray(cursor + 2, cursor + 2 + rLen);
  cursor = cursor + 2 + rLen;
  if (der[cursor] !== 0x02) throw new Error('apns: DER missing INTEGER s');
  const sLen = der[cursor + 1]!;
  let s = der.subarray(cursor + 2, cursor + 2 + sLen);
  // Strip leading 0x00 (sign byte) or left-pad to 32 bytes.
  if (r.length > 32 && r[0] === 0x00) r = r.subarray(r.length - 32);
  if (s.length > 32 && s[0] === 0x00) s = s.subarray(s.length - 32);
  const padded = Buffer.alloc(64);
  r.copy(padded, 32 - r.length);
  s.copy(padded, 64 - s.length);
  return padded;
}

/** Sign an APNs Provider Authentication Token JWT.
 *  Exported for unit testing the signing path independently of the
 *  transport (the http2 client is harder to inject than the signer). */
export function signApnsJwt(opts: {
  keyId: string;
  teamId: string;
  privateKey: KeyObject;
  iat: number;
}): string {
  const header  = base64url(JSON.stringify({ alg: 'ES256', kid: opts.keyId, typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ iss: opts.teamId, iat: opts.iat }));
  const signingInput = `${header}.${payload}`;
  const der = createSign('SHA256').update(signingInput).sign(opts.privateKey);
  const sig = derToJoseEs256(der);
  return `${signingInput}.${base64url(sig)}`;
}

/** Production `ApnsTransport`. The token cache is per-instance so a
 *  caller can hold one transport for the daemon's lifetime + share
 *  across all push attempts. Failures surface via `{ ok: false, reason }`
 *  in the same shape the existing showroom channel expects. */
export function createApnsTransport(opts: ApnsTransportOpts): ApnsTransport {
  const env = opts.environment ?? 'production';
  const host = env === 'sandbox' ? APNS_SANDBOX_HOST : APNS_PRODUCTION_HOST;
  const now = opts.now ?? (() => Date.now());
  // Parse PEM once (createPrivateKey accepts pkcs8 PEM, which is the
  // shape Apple's .p8 files use).
  const privateKey = createPrivateKey(opts.keyPem);
  const defaultPushType = opts.defaultPushType ?? 'alert';
  const http2Connect = opts.http2Connect ?? defaultHttp2Connect;
  let cached: TokenState | null = null;
  let session: Http2SessionLike | null = null;

  function getOrRefreshToken(): string {
    const t = now();
    if (cached && t - cached.issuedAt < TOKEN_REFRESH_MS) return cached.jwt;
    const jwt = signApnsJwt({
      keyId: opts.keyId,
      teamId: opts.teamId,
      privateKey,
      iat: Math.floor(t / 1000),
    });
    cached = { jwt, issuedAt: t };
    return jwt;
  }

  function ensureSession(): Http2SessionLike {
    if (session && !session.destroyed) return session;
    session = http2Connect(host, APNS_PORT);
    return session;
  }

  return {
    async send(token, payload) {
      // APNs requires hex device tokens (no whitespace · no colons).
      if (!/^[0-9a-fA-F]+$/.test(token)) {
        return { ok: false, reason: `invalid device token shape: ${token.slice(0, 8)}…` };
      }
      const jwt = getOrRefreshToken();
      const body = JSON.stringify(payload satisfies ApnsPayload);
      const stream = ensureSession().request({
        ':method': 'POST',
        ':path': `/3/device/${token}`,
        authorization: `bearer ${jwt}`,
        'apns-topic': opts.bundleId,
        'apns-push-type': defaultPushType,
        'apns-priority': payload.aps['interruption-level'] === 'passive' ? 5 : 10,
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
      });
      return new Promise((resolve) => {
        let status = 0;
        let errorBody = '';
        stream.setEncoding?.('utf8');
        stream.on('response', (headers) => {
          const raw = headers[':status'];
          status = typeof raw === 'string' ? Number.parseInt(raw, 10) : Number(raw ?? 0);
        });
        stream.on('data', (chunk) => {
          errorBody += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        });
        stream.on('end', () => {
          if (status >= 200 && status < 300) {
            resolve({ ok: true });
            return;
          }
          // 410 = unregistered device · caller may evict the token.
          // 400/403/404 = malformed (key/topic/team) — surfaces as reason.
          resolve({ ok: false, reason: `apns-${status}: ${errorBody.slice(0, 200)}` });
        });
        stream.on('error', (err) => {
          resolve({ ok: false, reason: `apns-stream-error: ${err.message}` });
        });
        stream.end(body);
      });
    },
  };
}

function defaultHttp2Connect(host: string, port: number): Http2SessionLike {
  return connect(`https://${host}:${port}`) as unknown as Http2SessionLike;
}
