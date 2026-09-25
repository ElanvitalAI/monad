// P-2D.2 — `/v1/nexus/admin/pwa-dev-proxy` runtime hot-swap.
//
// User insight (2026-05-07): the dev-proxy upstream is a per-session
// toggle, not a long-lived preference. Persisting it in UserConfig was
// a workaround for "the only way to change a running nexus is to
// restart it" — which is fixed by adding an in-memory mutable ref
// that admin HTTP calls can flip live. No restart, no UserConfig field.
//
// Surface (loopback-only — same auth posture as the rest of /v1/*):
//   GET    /v1/nexus/admin/pwa-dev-proxy        → { upstream: string|null }
//   POST   /v1/nexus/admin/pwa-dev-proxy        body { upstream }  → 200 { upstream }
//   DELETE /v1/nexus/admin/pwa-dev-proxy        → 200 { upstream: null }
//
// Wire site:
//   - http-server.ts owns a `DevProxyRuntimeRef` (created at boot).
//   - routeRequest reads `ref.get()` per request → proxies when set.
//   - This module mutates the ref + returns the snapshot.
//
// Hot-swap semantics: HTTP routing reads the ref every request, so the
// flip is effective on the *next* HTTP request. In-flight requests
// already inside `handleDevProxyHttpRequest` complete against the
// upstream they were dispatched to. WebSocket upgrades are likewise
// matched at upgrade time; existing HMR sockets stay attached to the
// upstream they connected to (graceful) — DELETE simply prevents new
// upgrades from going through.

export interface DevProxyRuntimeRef {
  /** Read-only snapshot of the current upstream. `null` when not active. */
  get(): { upstream: string } | null;
  /** Replace the upstream (or clear it with `null`). Idempotent. */
  set(value: { upstream: string } | null): void;
}

/** Standalone factory so callers (boot + tests) get an isolated ref. */
export function createDevProxyRuntimeRef(): DevProxyRuntimeRef {
  let value: { upstream: string } | null = null;
  return {
    get: () => value,
    set: (v) => {
      value = v;
    },
  };
}

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

function isValidUpstream(value: unknown): value is string {
  if (typeof value !== 'string' || !value.length) return false;
  try {
    const u = new URL(value);
    return ALLOWED_PROTOCOLS.has(u.protocol);
  } catch {
    return false;
  }
}

export interface AdminDevProxyDeps {
  ref: DevProxyRuntimeRef;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

/** Dispatch one request. Returns `undefined` when the path doesn't
 *  match (caller continues HTTP routing). */
export async function tryHandleAdminDevProxy(
  req: Request,
  url: URL,
  deps: AdminDevProxyDeps,
): Promise<Response | undefined> {
  if (url.pathname !== '/v1/nexus/admin/pwa-dev-proxy') return undefined;
  const method = req.method.toUpperCase();
  if (method === 'GET') {
    const cur = deps.ref.get();
    return jsonResponse({ upstream: cur?.upstream ?? null });
  }
  if (method === 'DELETE') {
    deps.ref.set(null);
    return jsonResponse({ upstream: null });
  }
  if (method === 'POST') {
    let parsed: unknown;
    try {
      parsed = await req.json();
    } catch {
      return jsonResponse({ error: 'invalid_json' }, 400);
    }
    const upstream = (parsed as { upstream?: unknown } | null)?.upstream;
    if (!isValidUpstream(upstream)) {
      return jsonResponse(
        {
          error: 'invalid_upstream',
          hint: 'Body must be {"upstream":"http://host:port"} or {"upstream":"https://..."}.',
        },
        400,
      );
    }
    deps.ref.set({ upstream });
    return jsonResponse({ upstream });
  }
  return jsonResponse({ error: 'method-not-allowed', method }, 405);
}
