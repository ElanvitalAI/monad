// NEXUS · Edit-in-PWA hand-off (Phase N-3 cleanup PR β')
//
// "TUI 에서 복잡한 switch 를 입력해야 할 때 PWA 로 hand-off" — sidebar
// settings tab 의 entries 중 multiline / secret-ref / 긴 string 등은
// TUI 입력이 불편하므로, sign 한 single-use token 을 만들고 PWA 의 edit
// surface URL 을 clipboard / QR 로 전달.
//
// PLAN §10 PR μ + §9 D-15 의 보안 모델 (선택 A):
//   - JWT-style: HMAC-SHA256 signed payload (audience · switchId · exp · nonce)
//   - 5-min TTL                                       (token 노출 시 노출 윈도 짧게)
//   - single-use nonce                                (replay 방지)
//   - localhost audience claim                        (URL 이 외부로 나가도 사용 불가)
//   - signing key 는 ~/.elanous/nexus/edit-in-pwa.key 에 0o600 으로 보관
//
// QR encoder 는 외부 의존성이 필요해 본 PR scope 외 — `/v1/nexus/edit-in-pwa`
// 가 plain url 을 반환하므로 PWA 측에서 QR 렌더링은 별도 (또는 향후 별 PR).

import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join as joinPath } from 'node:path';
import { ensureNexusRootDir, nexusRootDir } from '../paths.js';
import { runCli as defaultRunCli, type RunCli } from '../config/secrets/cli-helper.js';
import { debug } from '../../debug/log.js';

export const EDIT_IN_PWA_DEFAULT_TTL_MS = 5 * 60 * 1000;
export const EDIT_IN_PWA_KEY_FILE = 'edit-in-pwa.key';

export interface SigningKeyEnvelope {
  secretHex: string;
  createdAt: string;
}

export function signingKeyPath(): string {
  return joinPath(nexusRootDir(), EDIT_IN_PWA_KEY_FILE);
}

/** Load (or create) the per-host HMAC signing secret. The file is 0o600
 *  so leaks reveal a tab-edit flow but no broader trust. */
export function loadOrCreateSigningKey(): string {
  ensureNexusRootDir();
  const path = signingKeyPath();
  if (existsSync(path)) {
    try {
      const env = JSON.parse(readFileSync(path, 'utf-8')) as Partial<SigningKeyEnvelope>;
      if (typeof env.secretHex === 'string' && env.secretHex.length >= 32) {
        return env.secretHex;
      }
    } catch { /* fall through */ }
  }
  const secretHex = randomBytes(32).toString('hex');
  const env: SigningKeyEnvelope = { secretHex, createdAt: new Date().toISOString() };
  try {
    writeFileSync(path, JSON.stringify(env, null, 2), { mode: 0o600 });
  } catch { /* best-effort */ }
  return secretHex;
}

export interface EditInPwaPayload {
  /** Audience — host:port that the token is bound to. PWA must request
   *  the same origin, otherwise the verify path rejects. */
  aud: string;
  /** Switch id (literal · same shape as PUT /v1/config/switches/:id). */
  switchId: string;
  /** ms since epoch. */
  iat: number;
  exp: number;
  /** Random per-token nonce. Single-use via NonceStore. */
  nonce: string;
}

export interface SignTokenOpts {
  secret: string;
  audience: string;
  switchId: string;
  ttlMs?: number;
  now?: number;
  /** Test seam — fixes the nonce. Production uses crypto.randomBytes. */
  nonce?: string;
}

export interface SignedToken {
  payload: EditInPwaPayload;
  /** url-safe `<payload-b64>.<hmac-b64>`. */
  encoded: string;
}

export function signEditInPwaToken(opts: SignTokenOpts): SignedToken {
  const now = opts.now ?? Date.now();
  const ttl = opts.ttlMs ?? EDIT_IN_PWA_DEFAULT_TTL_MS;
  const payload: EditInPwaPayload = {
    aud: opts.audience,
    switchId: opts.switchId,
    iat: now,
    exp: now + ttl,
    nonce: opts.nonce ?? randomBytes(16).toString('hex'),
  };
  const payloadB64 = b64urlEncode(Buffer.from(JSON.stringify(payload), 'utf-8'));
  const sig = hmacSign(opts.secret, payloadB64);
  const encoded = `${payloadB64}.${sig}`;
  return { payload, encoded };
}

export type VerifyOutcome =
  | { valid: true; payload: EditInPwaPayload }
  | { valid: false; reason: 'malformed' | 'bad-signature' | 'expired' | 'audience-mismatch' };

export interface VerifyTokenOpts {
  secret: string;
  audience: string;
  encoded: string;
  now?: number;
}

export function verifyEditInPwaToken(opts: VerifyTokenOpts): VerifyOutcome {
  const parts = opts.encoded.split('.');
  if (parts.length !== 2) return { valid: false, reason: 'malformed' };
  const [payloadB64, sig] = parts as [string, string];
  const expected = hmacSign(opts.secret, payloadB64);
  if (!constantTimeStringEqual(sig, expected)) {
    return { valid: false, reason: 'bad-signature' };
  }
  let payload: EditInPwaPayload;
  try {
    payload = JSON.parse(b64urlDecode(payloadB64).toString('utf-8')) as EditInPwaPayload;
  } catch {
    return { valid: false, reason: 'malformed' };
  }
  if (typeof payload.aud !== 'string' || typeof payload.switchId !== 'string'
      || typeof payload.exp !== 'number' || typeof payload.nonce !== 'string') {
    return { valid: false, reason: 'malformed' };
  }
  if (payload.aud !== opts.audience) return { valid: false, reason: 'audience-mismatch' };
  const now = opts.now ?? Date.now();
  if (now > payload.exp) return { valid: false, reason: 'expired' };
  return { valid: true, payload };
}

function hmacSign(secret: string, message: string): string {
  return b64urlEncode(createHmac('sha256', Buffer.from(secret, 'hex')).update(message).digest());
}

function constantTimeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

function b64urlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Buffer {
  const pad = (4 - (s.length % 4)) % 4;
  const std = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(pad);
  return Buffer.from(std, 'base64');
}

/** Single-use nonce store. Production keeps this in-memory; nexus
 *  restart drops the set (acceptable since 5-min TTL means at most a
 *  short window of replay risk on an attacker who already has a copy
 *  of the token AND beat the user to the verify endpoint). */
export class NonceStore {
  private consumed = new Set<string>();

  /** Returns true on first use, false on replay. */
  consume(nonce: string): boolean {
    if (this.consumed.has(nonce)) return false;
    this.consumed.add(nonce);
    return true;
  }

  size(): number {
    return this.consumed.size;
  }

  clear(): void {
    this.consumed.clear();
  }
}

export interface BuildEditInPwaUrlOpts {
  /** Origin of the PWA (settings page). Default: same origin as nexus. */
  pwaOrigin?: string;
  /** Pathname inside PWA. Default: '/settings/edit'. */
  pathname?: string;
  /** When pwaOrigin is omitted, falls back to this nexus URL. */
  nexusOrigin: string;
  token: string;
  switchId: string;
}

export function buildEditInPwaUrl(opts: BuildEditInPwaUrlOpts): string {
  const origin = opts.pwaOrigin ?? opts.nexusOrigin;
  const u = new URL(opts.pathname ?? '/settings/edit', origin);
  u.searchParams.set('token', opts.token);
  u.searchParams.set('switchId', opts.switchId);
  return u.toString();
}

export interface ClipboardOutcome {
  ok: boolean;
  via: 'pbcopy' | 'wl-copy' | 'xclip' | 'xsel' | 'none';
  reason?: string;
}

/** Best-effort clipboard write. Tries platform-specific commands in
 *  preferred order and reports which one (if any) succeeded so callers
 *  can fall back to printing the URL when no clipboard is available. */
export async function copyToClipboard(
  text: string,
  opts?: { runCli?: RunCli; platformOverride?: NodeJS.Platform },
): Promise<ClipboardOutcome> {
  const cli = opts?.runCli ?? defaultRunCli;
  const platform = opts?.platformOverride ?? process.platform;
  const candidates: { tool: ClipboardOutcome['via']; cmd: string[] }[] =
    platform === 'darwin'
      ? [{ tool: 'pbcopy', cmd: ['pbcopy'] }]
      : [
          { tool: 'wl-copy', cmd: ['wl-copy'] },
          { tool: 'xclip', cmd: ['xclip', '-selection', 'clipboard'] },
          { tool: 'xsel', cmd: ['xsel', '--clipboard', '--input'] },
        ];

  for (const cand of candidates) {
    try {
      const result = await cli(cand.cmd, { stdin: text });
      if (result.exitCode === 0) {
        if (debug.enabled) {
          debug.log('nexus.edit-in-pwa.clipboard', cand.tool, { bytes: text.length });
        }
        return { ok: true, via: cand.tool };
      }
    } catch { /* fall through */ }
  }
  return { ok: false, via: 'none', reason: 'no clipboard tool available' };
}
