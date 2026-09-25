/**
 * Secure-context guard for voice / mic APIs (PLAN-pwa-webterm-voice-control
 * Phase 1 · 2026-05-07).
 *
 * Browser mic capture (`navigator.mediaDevices.getUserMedia`) requires a
 * **secure context** (HTTPS or localhost). This module classifies the
 * current origin so the UI can:
 * - allow mic UI when secure (no banner, mic toggle armed)
 * - show a Tailscale-aware guidance banner when insecure (mic toggle
 *   disabled, ts.net HTTPS setup link offered)
 *
 * Tailscale specifics — the most common monad-agent dogfood path:
 * - `100.x.x.x` (CGNAT IP for tailnet) over HTTP → **insecure**, even
 *   though the WireGuard tunnel itself is encrypted. Browsers don't
 *   know that and refuse mic access.
 * - `*.ts.net` (Tailscale serve / funnel with LetsEncrypt cert) over
 *   HTTPS → secure (this is what we steer users toward).
 *
 * SSR-safe: when `window` is undefined the status is `unknown`, isSecure
 * returns false (caller should treat as "wait for client mount").
 */

export type SecureContextReason =
  | 'localhost'        // 127.0.0.1 / ::1 / localhost — browsers exempt
  | 'https-tsnet'      // *.ts.net HTTPS — Tailscale serve recommended path
  | 'https-other'      // any other HTTPS origin
  | 'http-tailscale'   // 100.64.0.0/10 over HTTP — fixable via ts.net
  | 'http-other'       // any other plain HTTP — recommend HTTPS
  | 'unknown';         // SSR or non-browser environment

export interface SecureContextStatus {
  isSecure: boolean;
  reason: SecureContextReason;
  hostname: string;
  protocol: string;
  guidance?: string;
}

const TAILSCALE_CGNAT_RE = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./;

function isLocalhostHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
}

function isTsNetHostname(hostname: string): boolean {
  return /\.ts\.net$/i.test(hostname);
}

function isTailscaleCgnatIp(hostname: string): boolean {
  return TAILSCALE_CGNAT_RE.test(hostname);
}

/** Pure classifier — exported for unit testing without a `window` mock.
 *  `protocol` includes the trailing colon (`'https:'`), matching
 *  `window.location.protocol`. */
export function classifySecureContext(protocol: string, hostname: string): SecureContextStatus {
  const isHttps = protocol === 'https:';
  const isHttp = protocol === 'http:';

  if (isLocalhostHostname(hostname)) {
    return { isSecure: true, reason: 'localhost', hostname, protocol };
  }
  if (isHttps && isTsNetHostname(hostname)) {
    return { isSecure: true, reason: 'https-tsnet', hostname, protocol };
  }
  if (isHttps) {
    return { isSecure: true, reason: 'https-other', hostname, protocol };
  }
  if (isHttp && isTailscaleCgnatIp(hostname)) {
    return {
      isSecure: false,
      reason: 'http-tailscale',
      hostname,
      protocol,
      guidance:
        'Tailscale 100.x 주소는 HTTP라 마이크 권한이 차단됩니다. ' +
        '`tailscale serve` 또는 funnel 로 ts.net HTTPS 호스트를 노출하면 마이크가 동작합니다.',
    };
  }
  if (isHttp) {
    return {
      isSecure: false,
      reason: 'http-other',
      hostname,
      protocol,
      guidance:
        '브라우저는 HTTP origin 에서 마이크 접근을 차단합니다. HTTPS 로 접속하거나 localhost 로 옮기세요.',
    };
  }
  return { isSecure: false, reason: 'unknown', hostname, protocol };
}

/** Live check using `window.location` + `window.isSecureContext`. SSR-safe. */
export function checkSecureContext(): SecureContextStatus {
  if (typeof window === 'undefined' || !window.location) {
    return { isSecure: false, reason: 'unknown', hostname: '', protocol: '' };
  }
  const status = classifySecureContext(window.location.protocol, window.location.hostname);
  // Trust the browser's own `isSecureContext` over our classifier when it
  // disagrees — there are corner cases (file://, blob:, sandboxed iframes)
  // we don't enumerate. Browser says false → respect it.
  if (status.isSecure && window.isSecureContext === false) {
    return {
      ...status,
      isSecure: false,
      reason: 'unknown',
      guidance:
        '현재 origin 이 secure context 가 아닙니다 (브라우저 판정). HTTPS 로 접속하세요.',
    };
  }
  return status;
}
