import { describe, expect, test } from 'bun:test';
import { isSameOriginRequest } from '../src/boot/check-same-origin';

function reqWithHeaders(headers: Record<string, string>): Request {
  return new Request('http://example.test/v1/tools', { headers });
}

// Contract decision: the seven positive paths below were stale after
// f4e5b94adc61e14f092c07658a38f595b64e4313 required a trusted peer for
// every header-based bypass. isTrustedSameOriginPeer enforces that boundary;
// this helper supplies the loopback peer received by the production HTTP path.
function trustedSameOriginRequest(headers: Record<string, string>): boolean {
  return isSameOriginRequest(reqWithHeaders(headers), '127.0.0.1');
}

describe('isSameOriginRequest', () => {
  test('Sec-Fetch-Site: same-origin → true', () => {
    expect(trustedSameOriginRequest({ 'sec-fetch-site': 'same-origin' })).toBe(true);
  });

  test('Sec-Fetch-Site: cross-site → false for a trusted peer (even with matching Origin)', () => {
    expect(trustedSameOriginRequest({
      'sec-fetch-site': 'cross-site',
      origin: 'http://100.64.0.2:31415',
      host: '100.64.0.2:31415',
    })).toBe(false);
  });

  test('Sec-Fetch-Site: same-site → false for a trusted peer (subdomain shenanigans)', () => {
    expect(trustedSameOriginRequest({ 'sec-fetch-site': 'same-site' })).toBe(false);
  });

  test('untrusted and absent peers → false before the header cascade', () => {
    const headers = { 'sec-fetch-site': 'same-origin' };
    expect(isSameOriginRequest(reqWithHeaders(headers), '192.168.1.20')).toBe(false);
    expect(isSameOriginRequest(reqWithHeaders(headers))).toBe(false);
  });

  test('Sec-Fetch-Site: none + matching Origin/Host → true (URL-bar same-origin)', () => {
    expect(trustedSameOriginRequest({
      'sec-fetch-site': 'none', origin: 'http://100.64.0.2:31415', host: '100.64.0.2:31415',
    })).toBe(true);
  });

  test('No Sec-Fetch-Site, Origin matches Host → true', () => {
    expect(trustedSameOriginRequest({ origin: 'http://127.0.0.1:31415', host: '127.0.0.1:31415' })).toBe(true);
  });

  test('No Sec-Fetch-Site, Origin host mismatches Host → false for a trusted peer', () => {
    expect(trustedSameOriginRequest({ origin: 'http://evil.example:80', host: '100.64.0.2:31415' })).toBe(false);
  });

  test('Curl-style trusted-peer request (no Origin, no Sec-Fetch-Site, no Referer) → false', () => {
    expect(trustedSameOriginRequest({ host: '100.64.0.2:31415' })).toBe(false);
  });

  test('Garbage Origin header → false for a trusted peer', () => {
    expect(trustedSameOriginRequest({ origin: '::: not-a-url :::', host: '100.64.0.2:31415' })).toBe(false);
  });

  test('Tailscale magic-DNS origin matches host', () => {
    expect(trustedSameOriginRequest({ origin: 'https://mbp.tailnet-example.ts.net', host: 'mbp.tailnet-example.ts.net' })).toBe(true);
  });

  // ── Tier 4 — Referer fallback (2026-05-07 fix) ────────────────────
  // iOS Safari (esp. PWA-as-installed-app) omits Sec-Fetch-Site AND
  // Origin on same-origin GETs but always sends Referer. Loopback
  // browsers don't hit this path because they pass on tier 1.

  test('iOS Safari pattern: no Sec-Fetch-Site, no Origin, Referer host matches Host → true', () => {
    expect(trustedSameOriginRequest({
      host: 'mbp.tailnet-example.ts.net:31415', referer: 'https://mbp.tailnet-example.ts.net:31415/app/sessions',
    })).toBe(true);
  });

  test('Tailscale IP pattern: Referer host matches Host → true', () => {
    expect(trustedSameOriginRequest({ host: '100.64.0.2:31415', referer: 'http://100.64.0.2:31415/app/' })).toBe(true);
  });

  test('Referer host mismatches Host → false for a trusted peer (cross-origin attempt)', () => {
    expect(trustedSameOriginRequest({ host: '100.64.0.2:31415', referer: 'http://attacker.example/' })).toBe(false);
  });

  test('Garbage Referer header → false for a trusted peer', () => {
    expect(trustedSameOriginRequest({ host: '100.64.0.2:31415', referer: '::: not-a-url :::' })).toBe(false);
  });

  test('Origin present + mismatched, Referer matches → still false for a trusted peer (Origin is authoritative)', () => {
    // An attacker shouldn't be able to bypass by setting a phony
    // Referer when the browser-set Origin disagrees. Only fall
    // through to Referer when Origin is absent.
    expect(trustedSameOriginRequest({
      host: '100.64.0.2:31415', origin: 'http://attacker.example', referer: 'http://100.64.0.2:31415/app/',
    })).toBe(false);
  });

  test('Sec-Fetch-Site: same-origin trumps a mismatched Referer', () => {
    expect(trustedSameOriginRequest({
      'sec-fetch-site': 'same-origin', host: '100.64.0.2:31415', referer: 'http://attacker.example/',
    })).toBe(true);
  });
});
