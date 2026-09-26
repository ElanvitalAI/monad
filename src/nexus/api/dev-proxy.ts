// P-2B.1 — HTTP reverse-proxy for `/app/*` + `/_next/*` to a Next.js
// dev-server upstream.
//
// Production serves PWA UI via static export (apps/pwa/out → /app/*).
// During UI development the static export costs a 30s rebuild per
// change, killing iteration. P-2A added `elanous nexus pwa dev` which
// spawns `next dev` at a separate port (3210) but cross-origin to the
// daemon at :31415 — CORS preflight, ServiceWorker scope, cookie
// sameSite, and Tailscale Serve TLS termination all break.
//
// This module forwards HTTP requests from nexus's existing port to the
// dev upstream so single-origin holds during dev too:
//
//   browser → http://127.0.0.1:31415/app/foo  (or via Tailscale TLS)
//          → nexus.routeRequest detects devProxy mode
//          → fetch http://localhost:3210/app/foo
//          → response streams back unchanged
//
// HMR WebSocket forwarding (`/_next/webpack-hmr`) is **not** in this
// PR — see P-2B.2. Without it, code edits cause a full page reload
// instead of an HMR patch (Next.js's natural fallback when the HMR
// channel is unavailable). Single-origin holds; only the patching
// granularity is worse until P-2B.2 lands.
//
// Path scope handled here:
//   /app/*       — PWA pages (static export equivalent)
//   /_next/*     — bundle chunks, fonts, RSC payloads, etc. — these
//                  are produced by next-dev and must come from upstream
//                  rather than nexus's static handler.
//   /__nextjs_*  — Next.js dev RPCs (build error overlay, etc.)
//
// Anything outside that scope (e.g. `/v1/*`) keeps its current
// nexus-native handler.

// ⛔⭐ `/app` 은 «여기서 다시 적지 않는다» — 정적 핸들러가 그 접두로 갈리므로
//   한쪽만 바꾸면 dev 모드에서 «404 로만» 드러난다(`#11096` 이 접은 것과 같은 부류).
//   📏 자(`f12-sweep --bucket-b`)가 이 자리를 희소성 2위로 올려 줬다.
//   ⛔ 그렇다고 `rest-route-paths.ts` 잎에 넣지 «않는다» — 그 잎은 REST 계약이고
//     자가 그것을 단언으로 못 박고 있다(`expect(value).toMatch(/^\/v1\//)`).
//     `/app` 은 REST 라우트가 아니라 **PWA 마운트 접두**라 집이 다르다.
//   ⭐ 둘 다 데몬 «안»이라 직접 import 로 족하다(브라우저가 끌어올 그래프가 아니다).
import { STATIC_PATH_PREFIX } from './static-app.js';

const PROXY_PATH_PREFIXES = [STATIC_PATH_PREFIX, '/_next', '/__nextjs'] as const;

/** True when the request path should be forwarded to the dev upstream
 *  (HTTP-only here — WebSocket upgrades fall through to the caller). */
export function pathMatchesDevProxy(pathname: string): boolean {
  for (const prefix of PROXY_PATH_PREFIXES) {
    if (pathname === prefix) return true;
    if (pathname.startsWith(prefix + '/')) return true;
  }
  // Next.js dev RPCs use `/__nextjs_<name>` (underscore, not slash) —
  // e.g. `/__nextjs_font/...`, `/__nextjs_original-stack-frames`,
  // `/__nextjs_dev-data`. The plain `/__nextjs/` startsWith check
  // above misses them, so we forward the entire `/__nextjs_*` family
  // explicitly. Without this, font preloads + stack-frame RPC + build
  // overlay all 404 / 405 against nexus instead of reaching next-dev.
  if (pathname.startsWith('/__nextjs_')) return true;
  return false;
}

/** Paths that Next.js dev-server uses for the HMR WebSocket. We match
 *  conservatively (exact paths) rather than `/_next/*` so a stray
 *  upgrade attempt on an unrelated path doesn't go through the proxy. */
const DEV_PROXY_WS_PATHS = new Set<string>([
  '/_next/webpack-hmr',
  '/_next/turbopack-hmr',
  '/_next/HMR',
]);

/** True when this WebSocket upgrade request is the Next.js HMR channel.
 *  Caller (ws-bridge) treats matched paths as dev-proxy upgrades and
 *  wires them via `wireDevProxyWebSocket`. */
export function pathMatchesDevProxyWs(pathname: string): boolean {
  return DEV_PROXY_WS_PATHS.has(pathname);
}

/** Convert an HTTP upstream origin (e.g. `http://localhost:3210`) into
 *  the WebSocket equivalent for `pathname` + `search`. */
export function buildDevProxyWsUrl(
  upstream: string,
  pathname: string,
  search: string,
): string {
  const trimmed = upstream.replace(/\/+$/, '');
  const u = new URL(trimmed);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  u.pathname = pathname;
  u.search = search;
  return u.href;
}

export interface DevProxyOpts {
  /** Upstream origin, e.g. `http://localhost:3210`. No trailing slash. */
  upstream: string;
  /** Test seam — replace the global `fetch`. Default = global fetch. */
  fetchFn?: typeof fetch;
}

/** Hop-by-hop headers per RFC 7230 §6.1. We strip these so the upstream
 *  receives a clean request and the response we return doesn't repeat
 *  the connection-management headers (which `fetch` already handles). */
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

function stripHopByHop(headers: Headers): Headers {
  const out = new Headers(headers);
  for (const name of HOP_BY_HOP_HEADERS) out.delete(name);
  // The Host header is rebuilt by fetch from the upstream URL — drop
  // the inbound nexus host so upstream sees its own listen address.
  out.delete('host');
  return out;
}

/**
 * Forward an HTTP request to the Next.js dev upstream and return the
 * response (status, headers, body) verbatim.
 *
 * Caller is expected to have already matched the path via
 * `pathMatchesDevProxy(url.pathname)` and intercepted any WebSocket
 * upgrade (P-2B.2). Connection failures surface as `502 Bad Gateway`
 * with a JSON error body — gives the user a clear hint that
 * `elanous nexus pwa dev` (or `bun run dev`) hasn't been started.
 */
export async function handleDevProxyHttpRequest(
  req: Request,
  url: URL,
  opts: DevProxyOpts,
): Promise<Response> {
  const fetchFn = opts.fetchFn ?? fetch;
  const upstream = opts.upstream.replace(/\/+$/, '');
  const upstreamUrl = `${upstream}${url.pathname}${url.search}`;

  const headers = stripHopByHop(req.headers);
  // X-Forwarded-* gives the upstream visibility into the original
  // origin. Next.js's dev server uses these for absolute URL synthesis
  // in some build-error pages.
  const inboundHost = req.headers.get('host');
  if (inboundHost) headers.set('x-forwarded-host', inboundHost);
  const proto = url.protocol.replace(':', '') || 'http';
  headers.set('x-forwarded-proto', proto);

  const init: RequestInit & { duplex?: 'half' } = {
    method: req.method,
    headers,
    redirect: 'manual',
  };
  // Bun / undici require `duplex: 'half'` for streamed request bodies.
  if (req.body !== null && req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = req.body;
    init.duplex = 'half';
  }

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetchFn(upstreamUrl, init);
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: 'dev_proxy_upstream_unreachable',
        upstream,
        path: url.pathname,
        reason: err instanceof Error ? err.message : String(err),
        hint: 'Is `elanous nexus pwa dev` (or `cd apps/pwa && bun run dev`) running?',
      }),
      {
        status: 502,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      },
    );
  }

  // Strip hop-by-hop on the response too, so the body stream we return
  // doesn't disagree with our own connection management.
  const outHeaders = stripHopByHop(upstreamResponse.headers);
  // Bun's `fetch` auto-decompresses gzip / br / deflate upstream
  // responses (the `body` ReadableStream emits plain bytes), but
  // exposes the *original* `Content-Encoding` + `Content-Length`
  // headers — i.e. the compressed-byte length and the encoding label.
  // Forwarding those verbatim makes the browser try to decode plain
  // bytes as gzip, yielding `ERR_CONTENT_DECODING_FAILED 200` (the
  // 2026-05-07 webterm dogfood symptom). Drop both so the response
  // we emit is self-consistent: plain body + chunked transfer + no
  // encoding label. Re-compressing on our side would also work but
  // costs CPU for no benefit on a localhost dev proxy.
  outHeaders.delete('content-encoding');
  outHeaders.delete('content-length');
  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: outHeaders,
  });
}

// ---------------------------------------------------------------------------
// P-2B.2 — WebSocket forwarder for the Next.js HMR channel.
//
// ws-bridge owns the Bun.serve websocket handler (one per server). When
// it sees a path matched by `pathMatchesDevProxyWs`, it wires a
// `DevProxyWsState` with the upstream URL and asks this module to
// connect to upstream + plumb both directions.
// ---------------------------------------------------------------------------

export interface DevProxyWsClient {
  readyState: number;
  binaryType: BinaryType;
  send: (data: string | ArrayBufferLike | ArrayBufferView | Blob) => void;
  close: (code?: number, reason?: string) => void;
  addEventListener: (
    type: 'open' | 'message' | 'close' | 'error',
    listener: (event: { data?: unknown; code?: number; reason?: string }) => void,
  ) => void;
}

export interface DevProxyWsServerSide {
  send: (data: string | Uint8Array) => void;
  close: (code?: number, reason?: string) => void;
}

export interface DevProxyWsState {
  upstreamUrl: string;
  upstream: DevProxyWsClient | null;
  /** Frames received from the client before upstream `open` fires.
   *  Flushed in order on open. WebSocket frames are typically tiny
   *  (KiB) and burst is short — bounded queue not justified yet. */
  pending: Array<string | Uint8Array>;
  /** True after upstream open or after wireDevProxyWebSocket detected
   *  an immediate fail. Stops late connect attempts. */
  ready: boolean;
}

export interface DevProxyWsWireOpts {
  /** Test seam — replace the `WebSocket` constructor used to dial
   *  upstream. Default = global `WebSocket`. */
  webSocketCtor?: { new (url: string): DevProxyWsClient };
}

const NORMAL_CLOSURE = 1000;
const SERVER_ERROR_CLOSURE = 1011;

const READY_STATE_OPEN = 1; // WebSocket.OPEN

/** Connect to upstream + wire the two sockets together. Returns the
 *  upstream `DevProxyWsClient` for callers that want to call `close()`
 *  later (e.g. on the client `close` event). */
export function wireDevProxyWebSocket(
  serverSide: DevProxyWsServerSide,
  state: DevProxyWsState,
  opts: DevProxyWsWireOpts = {},
): DevProxyWsClient {
  const Ctor = opts.webSocketCtor ?? (globalThis as { WebSocket?: typeof WebSocket }).WebSocket as unknown as { new (url: string): DevProxyWsClient };
  if (!Ctor) {
    serverSide.close(SERVER_ERROR_CLOSURE, 'WebSocket unavailable');
    return {
      readyState: 3,
      binaryType: 'arraybuffer',
      send: () => {},
      close: () => {},
      addEventListener: () => {},
    };
  }
  const upstream = new Ctor(state.upstreamUrl);
  state.upstream = upstream;
  upstream.binaryType = 'arraybuffer';

  upstream.addEventListener('open', () => {
    state.ready = true;
    for (const msg of state.pending) {
      try { upstream.send(msg as unknown as ArrayBufferLike); } catch { /* upstream gone */ }
    }
    state.pending.length = 0;
  });

  upstream.addEventListener('message', (event) => {
    const data = event.data;
    if (typeof data === 'string') {
      try { serverSide.send(data); } catch { /* client gone */ }
      return;
    }
    if (data instanceof ArrayBuffer) {
      try { serverSide.send(new Uint8Array(data)); } catch { /* client gone */ }
      return;
    }
    if (data instanceof Uint8Array) {
      try { serverSide.send(data); } catch { /* client gone */ }
    }
  });

  upstream.addEventListener('close', (event) => {
    state.ready = false;
    try {
      serverSide.close(
        typeof event.code === 'number' ? event.code : NORMAL_CLOSURE,
        typeof event.reason === 'string' ? event.reason : '',
      );
    } catch { /* already closed */ }
  });

  upstream.addEventListener('error', () => {
    state.ready = false;
    try { serverSide.close(SERVER_ERROR_CLOSURE, 'upstream error'); } catch { /* swallow */ }
  });

  return upstream;
}

/** Forward a single inbound message from client → upstream, queueing
 *  if upstream isn't ready yet. */
export function relayDevProxyClientMessage(
  state: DevProxyWsState,
  msg: string | Uint8Array,
): void {
  if (state.upstream && state.upstream.readyState === READY_STATE_OPEN) {
    try { state.upstream.send(msg as unknown as ArrayBufferLike); }
    catch { /* upstream gone — drop */ }
    return;
  }
  state.pending.push(msg);
}

/** Close the upstream side. Idempotent. */
export function closeDevProxyUpstream(state: DevProxyWsState): void {
  if (!state.upstream) return;
  try { state.upstream.close(NORMAL_CLOSURE); } catch { /* swallow */ }
  state.upstream = null;
}
