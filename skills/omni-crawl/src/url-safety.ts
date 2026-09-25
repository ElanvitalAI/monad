/**
 * SSRF 가드 — server-side 웹 페치/스크린샷 전 URL 검증
 *
 * deer-flow `community/url_safety.py` + brave 툴 `_decode_ipv4` 포팅 (TS·dep-free).
 * 목적: 무료 티어의 로컬 직접 페치(free.ts)·스크린샷(capture.ts)이
 *       localhost·RFC1918·클라우드 메타데이터(169.254.169.254)·난독화 IP로
 *       내부망을 훑지 못하게 차단. Firecrawl/Tavily는 원격 처리라 자체 방어가 있으나,
 *       로컬 페치 경로가 생기는 순간 이 가드가 필수.
 *
 * 사용: const err = await validatePublicHttpUrl(url); if (err) throw new Error(err);
 *       allowPrivate=true 로 명시 opt-out (내부 타깃 의도 시).
 */

import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

const BLOCKED_HOSTNAMES = new Set(['localhost', 'metadata.google.internal']);

/** 32-bit 정수 → "a.b.c.d" */
function intToIpv4(n: number): string | null {
  if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) return null;
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff].join('.');
}

/**
 * 난독화 IPv4 디코드 → 정규 점표기. net.isIP 가 못 잡는 형태 처리:
 *   - 단일 10진 (2130706433 → 127.0.0.1)
 *   - 단일 16진 (0x7f000001)
 *   - 단일 8진 (017700000001)
 *   - 점표기 내 16진/8진 옥텟 (0x7f.0.0.1, 0177.0.0.1)
 * 유효한 정규 dotted-quad 는 그대로 반환. 실패 시 null.
 */
function decodeObfuscatedIpv4(host: string): string | null {
  const h = host.trim();
  if (!h) return null;

  const parsePart = (p: string): number | null => {
    if (p === '') return null;
    let v: number;
    if (/^0x[0-9a-f]+$/i.test(p)) v = parseInt(p, 16);
    else if (/^0[0-7]+$/.test(p)) v = parseInt(p, 8);
    else if (/^0$/.test(p)) v = 0;
    else if (/^[1-9][0-9]*$/.test(p)) v = parseInt(p, 10);
    else return null;
    return Number.isNaN(v) ? null : v;
  };

  const parts = h.split('.');

  // 단일 값 형태 (dotless): 32-bit 정수로 취급
  if (parts.length === 1) {
    const v = parsePart(parts[0]);
    if (v === null) return null;
    return intToIpv4(v);
  }

  // 점표기: 각 옥텟을 10/16/8진으로 파싱. 표준 4-옥텟만 인정.
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const p of parts) {
    const v = parsePart(p);
    if (v === null || v < 0 || v > 0xff) return null;
    octets.push(v);
  }
  return octets.join('.');
}

/** IPv4 문자열이 차단 대역인가 (private/loopback/link-local/reserved/multicast/unspecified). */
function isBlockedIpv4(ip: string): boolean {
  const o = ip.split('.').map(Number);
  if (o.length !== 4 || o.some(n => Number.isNaN(n) || n < 0 || n > 255)) return true; // 파싱 실패 = 보수적 차단
  const [a, b] = o;
  if (a === 0) return true;                              // 0.0.0.0/8 unspecified/current-net
  if (a === 10) return true;                             // 10/8 private
  if (a === 127) return true;                            // 127/8 loopback
  if (a === 169 && b === 254) return true;              // 169.254/16 link-local (+ 메타데이터 169.254.169.254)
  if (a === 172 && b >= 16 && b <= 31) return true;    // 172.16/12 private
  if (a === 192 && b === 168) return true;             // 192.168/16 private
  if (a === 100 && b >= 64 && b <= 127) return true;   // 100.64/10 CGNAT
  if (a === 192 && b === 0 && o[2] === 0) return true; // 192.0.0/24 IETF
  if (a >= 224) return true;                            // 224/4 multicast + 240/4 reserved + 255.255.255.255
  return false;
}

/** IPv6 문자열이 차단 대역인가 (loopback/unspecified/ULA/link-local/multicast + v4-mapped 위임). */
function isBlockedIpv6(ip: string): boolean {
  const lower = ip.toLowerCase().replace(/^\[|\]$/g, '');
  if (lower === '::1' || lower === '::') return true;   // loopback / unspecified
  // IPv4-mapped/embedded (::ffff:a.b.c.d, ::a.b.c.d, 64:ff9b::a.b.c.d) → 내장 v4로 검사
  const embedded = lower.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (embedded) return isBlockedIpv4(embedded[1]);
  const hexEmbed = lower.match(/::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hexEmbed) {
    const hi = parseInt(hexEmbed[1], 16), lo = parseInt(hexEmbed[2], 16);
    return isBlockedIpv4([(hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff].join('.'));
  }
  if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true; // fe80::/10 link-local
  if (/^f[cd][0-9a-f]{2}:/.test(lower) || lower.startsWith('fc') || lower.startsWith('fd')) return true; // fc00::/7 ULA
  if (lower.startsWith('ff')) return true;              // ff00::/8 multicast
  return false;
}

/** 리터럴 IP(정규/난독화) 문자열이면 차단여부 반환, IP가 아니면 null. */
function classifyLiteralIp(host: string): boolean | null {
  const kind = isIP(host);
  if (kind === 4) return isBlockedIpv4(host);
  if (kind === 6) return isBlockedIpv6(host);
  // net.isIP 실패 → 난독화 IPv4 시도
  const decoded = decodeObfuscatedIpv4(host);
  if (decoded && isIP(decoded) === 4) return isBlockedIpv4(decoded);
  return null; // 진짜 호스트명
}

export interface UrlSafetyOpts {
  allowPrivate?: boolean;
  action?: string;         // 'fetch' | 'capture' | 'crawl' — 에러 메시지용
  resolveDns?: boolean;    // 호스트명 DNS 조회 후 IP 검사 (기본 true)
}

/**
 * http(s) URL을 server-side 페치 전 검증.
 * @returns 거부 시 "Error: ..." 문자열, 통과 시 null.
 */
export async function validatePublicHttpUrl(url: string, opts?: UrlSafetyOpts): Promise<string | null> {
  const action = opts?.action ?? 'fetch';
  let parsed: URL;
  try { parsed = new URL(url); } catch { return 'Error: URL 파싱 실패'; }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return 'Error: http:// 또는 https:// URL만 지원';
  }
  if (opts?.allowPrivate) return null;

  const hostname = parsed.hostname;
  if (!hostname) return 'Error: URL 호스트를 파싱할 수 없음';

  const normalized = hostname.trim().replace(/\.+$/, '').toLowerCase().replace(/^\[|\]$/g, '');
  if (BLOCKED_HOSTNAMES.has(normalized)) {
    return `Error: private/loopback 주소는 ${action} 거부`;
  }

  // 리터럴 IP (난독화 포함)
  const literal = classifyLiteralIp(normalized);
  if (literal === true) return `Error: private/loopback/metadata 주소는 ${action} 거부`;
  if (literal === false) return null;

  // 호스트명 → DNS 조회 후 모든 IP 검사 (DNS rebinding/내부 도메인 방어)
  if (opts?.resolveDns === false) return null;
  try {
    const addrs = await lookup(hostname, { all: true });
    if (!addrs.length) return 'Error: URL 호스트를 해석할 수 없음';
    for (const a of addrs) {
      const blocked = a.family === 6 ? isBlockedIpv6(a.address) : isBlockedIpv4(a.address);
      if (blocked) return `Error: private/loopback/metadata 주소는 ${action} 거부`;
    }
  } catch {
    return 'Error: URL 호스트를 해석할 수 없음';
  }
  return null;
}

/** 동기 최소 검사 (DNS 없이 스킴+리터럴 IP만) — 대량 프리필터용. */
export function quickBlocked(url: string): boolean {
  try {
    const p = new URL(url);
    if (p.protocol !== 'http:' && p.protocol !== 'https:') return true;
    const host = p.hostname.trim().replace(/\.+$/, '').toLowerCase().replace(/^\[|\]$/g, '');
    if (BLOCKED_HOSTNAMES.has(host)) return true;
    return classifyLiteralIp(host) === true;
  } catch { return true; }
}
