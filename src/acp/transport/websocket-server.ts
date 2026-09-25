// UI-Core arc Phase U4 — WebSocket transport.
//
// Bun's built-in `Bun.serve({ websocket })` wraps this — no extra
// dependency. The first message the client sends must be an
// `AcpAuthHandshake` JSON line; the server replies
// `{ok: true|false, ...}` before any ACP JSON-RPC flows. This keeps
// the auth check cheap and off the JSON-RPC parser.
//
// TLS: we don't terminate TLS here — Tailscale's on-net transport
// already provides a private, encrypted channel. When running over
// public IP, wrap this with a reverse proxy (caddy / nginx / Bun's
// `tls` option). Self-signed dev certs are out of scope for this
// module; callers pass `Bun.serve` the `tls` field directly via
// `serveOptions`.

import type {
  AcpAuthVerifier,
} from './auth.js';
import type {
  AcpConnectionHandler,
  AcpTransportConnection,
  AcpTransportServer,
} from './types.js';
import { AcpTransportError } from './types.js';

export interface WebSocketServerOpts {
  port: number;
  /** Optional bind host · defaults to `127.0.0.1` for safety. Tailscale
   *  mesh deployments set this to the Tailscale IP explicitly. */
  hostname?: string;
  /** Optional path. Default `/acp`. */
  path?: string;
  /** Called once per authed inbound connection. */
  onConnection: AcpConnectionHandler;
  /** Optional · enforce auth on handshake. When omitted, every
   *  connection is accepted (loopback + firewall must guarantee
   *  safety). */
  authVerifier?: AcpAuthVerifier;
  /** Passthrough for Bun.serve options (e.g. `tls`). Callers own TLS. */
  serveOptions?: Record<string, unknown>;
}

interface PerSocketState {
  authed: boolean;
  controller?: ReadableStreamDefaultController<Uint8Array>;
}

type BunServeOpts = {
  port: number;
  hostname?: string;
  fetch: (req: Request, server: unknown) => Response | undefined;
  websocket: {
    open?: (ws: unknown) => void;
    message: (ws: unknown, msg: string | Uint8Array) => void;
    close?: (ws: unknown, code: number, reason: string) => void;
  };
  [k: string]: unknown;
};

/** Start a Bun.serve WebSocket server. Returns a handle you can use
 *  to shut it down. Test-only transports can pass a stubbed
 *  `bunServe` fn so unit tests don't bind a real port. */
export async function listenWebSocket(
  opts: WebSocketServerOpts,
  bunServe?: (serveOpts: BunServeOpts) => { port: number; hostname: string; stop(): void },
): Promise<AcpTransportServer> {
  const path = opts.path ?? '/acp';
  const hostname = opts.hostname ?? '127.0.0.1';

  const states = new WeakMap<object, PerSocketState>();
  const writers = new WeakMap<object, WritableStreamDefaultWriter<Uint8Array>>();

  const serve = bunServe ?? ((serveOpts: BunServeOpts) => {
    const B = globalThis as unknown as { Bun?: { serve: (o: BunServeOpts) => { port: number; hostname: string; stop(): void } } };
    if (!B.Bun) throw new AcpTransportError('websocket', 'Bun runtime required for websocket transport');
    return B.Bun.serve(serveOpts);
  });

  const serveOpts: BunServeOpts = {
    port: opts.port,
    hostname,
    ...opts.serveOptions,
    fetch(req, server) {
      const url = new URL(req.url);
      if (url.pathname !== path) return new Response('not found', { status: 404 });
      const upgraded = (server as { upgrade: (r: Request) => boolean }).upgrade(req);
      if (!upgraded) return new Response('upgrade required', { status: 426 });
      return undefined;
    },
    websocket: {
      open(ws) {
        const key = ws as object;
        states.set(key, { authed: !opts.authVerifier });
      },
      message(ws, raw) {
        const key = ws as object;
        const state = states.get(key);
        if (!state) return;
        const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);

        if (!state.authed) {
          // First-line auth handshake.
          let handshake: unknown;
          try { handshake = JSON.parse(text); } catch {
            (ws as { send: (s: string) => void }).send(JSON.stringify({ ok: false, reason: 'malformed' }));
            (ws as { close: (code?: number) => void }).close(1008);
            return;
          }
          const result = opts.authVerifier!.verify(handshake);
          if (!result.ok) {
            (ws as { send: (s: string) => void }).send(JSON.stringify(result));
            (ws as { close: (code?: number) => void }).close(1008);
            return;
          }
          state.authed = true;
          (ws as { send: (s: string) => void }).send(JSON.stringify({ ok: true }));

          // Hand off to consumer.
          const readable = new ReadableStream<Uint8Array>({
            start(controller) { state.controller = controller; },
          });
          const writable = new WritableStream<Uint8Array>({
            write(chunk) {
              (ws as { send: (s: Uint8Array) => void }).send(chunk);
            },
            close() { (ws as { close: (code?: number) => void }).close(1000); },
            abort() { (ws as { close: (code?: number) => void }).close(1011); },
          });
          writers.set(key, writable.getWriter());
          const conn: AcpTransportConnection = {
            readable,
            writable,
            peerId: `ws:${hostname}:${opts.port}#${Math.random().toString(36).slice(2, 10)}`,
            async close() { (ws as { close: (code?: number) => void }).close(1000); },
          };
          Promise.resolve(opts.onConnection(conn)).catch(() => { /* swallow */ });
          return;
        }

        // Authenticated: pipe through to consumer's ReadableStream.
        if (!state.controller) return;
        state.controller.enqueue(new TextEncoder().encode(text));
      },
      close(ws) {
        const key = ws as object;
        const state = states.get(key);
        if (state?.controller) {
          try { state.controller.close(); } catch { /* already */ }
        }
      },
    },
  };

  const handle = serve(serveOpts);

  return {
    kind: 'websocket',
    address: `${handle.hostname}:${handle.port}${path}`,
    async close() {
      try { handle.stop(); } catch { /* best-effort */ }
    },
  };
}
