// Same-origin request detector for the auth bypass that lets the PWA
// (served by NEXUS at `/app/...`) call `/v1/tools` etc. on the same
// host without the user pasting a bearer token. Cross-origin / curl
// callers still hit the bearer gate.
//
// Rationale: when `elanous nexus pwa start` brings up daemon + PWA on
// the same origin, the browser's fetch is functionally equivalent to
// the daemon talking to itself — yet the bearer flow forced the user
// to mint + paste a token they never asked for. `Sec-Fetch-Site`
// (forbidden header, browser-controlled, cannot be spoofed by JS) +
// `Origin` / `Referer` host-match fallbacks close that gap without
// weakening the LAN/Tailscale-external posture.
//
// Detection cascade (any one signal proves same-origin):
//   1. `Sec-Fetch-Site: same-origin`             ← modern browsers
//   2. `Sec-Fetch-Site: none` + Origin matches   ← URL-bar nav
//   3. (no `Sec-Fetch-Site`)  + Origin matches   ← legacy fallback
//   4. (no `Sec-Fetch-Site`)  + Referer matches  ← iOS Safari /
//                                                  PWA-as-installed-app
//                                                  same-origin GETs
//      where browsers omit Origin entirely.
//
// Tier 4 was added (2026-05-07) after Tailscale-hosted PWA peers
// (mbp.tail*.ts.net + 100.x Tailscale IP) all returned 401: the
// underlying client (iOS Safari home-screen install) sends neither
// `Sec-Fetch-Site` nor `Origin` for same-origin GETs but always
// includes `Referer`. Loopback requests from the same Mac browser
// kept passing on tier 1 — the regression was Tailscale-only.

/**
 * Trust only local clients and the Tailscale CGNAT allocation for the
 * header-based bypass. We deliberately do not invoke `tailscale whois` per
 * request: authentication must remain available without the CLI/runtime and
 * must not turn an external process into the hot-path availability boundary.
 * An absent peer is untrusted, so unknown connections must present a bearer.
 */
export function isTrustedSameOriginPeer(peerAddress: string | undefined): boolean {
  if (!peerAddress) return false;
  if (peerAddress === '::1' || peerAddress === '0:0:0:0:0:0:0:1') return true;
  const ipv4 = peerAddress.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i)?.[1] ?? peerAddress;
  const octets = ipv4.split('.').map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return false;
  }
  return octets[0] === 127 || (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127);
}

export function isSameOriginRequest(req: Request, peerAddress?: string): boolean {
  if (!isTrustedSameOriginPeer(peerAddress)) return false;
  const sfs = req.headers.get('sec-fetch-site');
  if (sfs === 'same-origin') return true;
  if (sfs && sfs !== 'none') return false;

  const host = req.headers.get('host');
  if (!host) return false;

  // Tier 2 / 3 — Origin matches Host. Browsers send Origin for
  // non-GET, CORS, and (in modern Chrome) most same-origin GETs.
  const origin = req.headers.get('origin');
  if (origin) {
    try {
      if (new URL(origin).host === host) return true;
      // Origin present but mismatched — definitively cross-origin.
      // Don't fall through to Referer (would let an attacker spoof
      // a `Referer: http://victim/` while their real Origin is
      // recorded by the browser).
      return false;
    } catch {
      return false;
    }
  }

  // Tier 4 — Origin omitted (legacy / iOS Safari same-origin GET).
  // Referer is the last browser-originated signal we can match
  // against Host. Compromise note: Curl / postman without a manual
  // `--referer` won't pass this check; if they do spoof Referer
  // they could already spoof `Authorization: Bearer …`, so the
  // bearer-gate posture is unchanged.
  const referer = req.headers.get('referer');
  if (referer) {
    try {
      return new URL(referer).host === host;
    } catch {
      return false;
    }
  }

  return false;
}
