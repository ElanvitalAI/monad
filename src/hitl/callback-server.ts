// HITL HTTP callback listener — T1-P3.
//
// **Permanent prod component for the Dashboard TUI surface.** Active
// whenever `showDashboard()` boots — i.e. `elanous legacy` (forced) or
// `elanous` (no-arg) when a NEXUS lock is alive on the same host (auto
// resolver fallback to legacy, see `src/cli/legacy.ts` line 73-78).
// NEXUS-mode (`elanous nexus`) hosts an equivalent path
// `/v1/hitl/callback/:requestId` at port 31415 via
// `src/nexus/api/http-server.ts` + `src/nexus/api/hitl-runtime.ts`
// and registers its own Pushcut producer (PR #2009) — but that's a
// **different process / different port / different surface** from
// this file. The two paths coexist permanently because Dashboard TUI
// and NEXUS TUI are two distinct user-facing surfaces.
//
// Cleanup ROADMAP 2026-05-08 audit history (do not re-litigate):
//   - Round 1 §8.2 (FEATURE doc) listed this file as a "future
//     deletion candidate · fixture migration".
//   - Round 2 §8.6 (PR #2002) corrected the premise: file has a
//     surviving prod consumer (`dashboard/runtime/hitl.ts:46`).
//   - Round 2 follow-up §8.6.5 considered deleting via `elanous legacy`
//     cutover. User confirmed they USE Dashboard TUI as the primary
//     interactive surface (NEXUS runs in background hosting HTTP API +
//     PWA; Dashboard TUI is the foreground TUI). Cutover deemed
//     infeasible without losing primary UX.
//   - **Decision**: file is permanently retained. Future autopilot
//     sessions: do not propose deletion unless the user's primary
//     surface migrates to NEXUS TUI (sidebar tabs).
//
// Completes the Pushcut round-trip: after the iOS Shortcut taps Yes
// or No on a notification, it POSTs to /hitl/callback/:requestId on
// this listener; the handler resolves the matching pending promise
// so requestConfirmation() can return the answer.
//
// Endpoints:
//
//   POST /hitl/callback/:requestId
//       body: {"answer": true|false}
//       headers: X-Elanous-Secret: <shared secret>   (optional when
//               opts.secret is unset — required otherwise)
//       responses:
//         200 OK          — accepted; resolver fired
//         404 not-found   — no pending request with this id
//         401 forbidden   — secret mismatch
//         400 bad-request — body missing or unparseable
//
//   GET  /healthz
//       200 "ok"           (liveness probe for the iOS Shortcut to
//                           check before firing)
//
// Kept deliberately small — no framework dep, just node:http. The
// dashboard starts one listener at init, injects awaitCallback()
// into createPushcutConfirmChannel, and stops it on shutdown.

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';

export interface HitlCallbackServerOpts {
  /** TCP port. 0 = OS-assigned (used by tests). Default 17645 — fixed
   *  in the 5-digit "unprivileged" range, memorable ("HITL on 4-5").
   *  On EADDRINUSE the starter scans forward up to `portScanRange`
   *  ports so a fresh elanous instance can come up even when a prior
   *  process still holds the default. Pass a concrete port without
   *  scanning by setting portScanRange: 1. */
  port?: number;
  /** How many consecutive ports to try starting at `port` before
   *  giving up. Default 20. Ignored when port is 0 (OS-assigned). */
  portScanRange?: number;
  /** Bind host. Default 127.0.0.1 — never expose to LAN. */
  host?: string;
  /** Optional shared secret. When set, POSTs must include the
   *  matching X-Elanous-Secret header. When unset (dev mode) all POSTs
   *  to known requestIds are accepted. */
  secret?: string;
  /** Tap into every accepted answer — used for audit logs. */
  onAnswer?: (req: { requestId: string; answer: boolean }) => void;
  /** Default timeout for awaitCallback when caller omits it. */
  defaultTimeoutMs?: number;
  /** Fired once when start() binds to a port other than the one
   *  requested. Used by the dashboard to notify the user that their
   *  Pushcut Shortcut URL needs updating. */
  onPortShift?: (info: { wanted: number; actual: number }) => void;
}

export interface HitlCallbackServer {
  /** URL the iOS Shortcut should POST to. Includes the computed
   *  port after start(); undefined before. */
  url(): string | null;
  port(): number | null;
  start(): Promise<void>;
  stop(): Promise<void>;
  awaitCallback(requestId: string, timeoutMs?: number): Promise<boolean | null>;
  /** Test-only: observe the pending request set. */
  pending(): string[];
}

interface PendingEntry {
  resolve: (answer: boolean | null) => void;
  timer: ReturnType<typeof setTimeout>;
}

export function createHitlCallbackServer(opts: HitlCallbackServerOpts = {}): HitlCallbackServer {
  const host = opts.host ?? '127.0.0.1';
  const wantPort = opts.port ?? 17645;
  const portScanRange = Math.max(1, opts.portScanRange ?? 20);
  const defaultTimeoutMs = opts.defaultTimeoutMs ?? 300_000;
  const pending = new Map<string, PendingEntry>();
  let server: Server | null = null;
  let actualPort: number | null = null;

  const resolvePending = (requestId: string, answer: boolean | null): boolean => {
    const entry = pending.get(requestId);
    if (!entry) return false;
    clearTimeout(entry.timer);
    pending.delete(requestId);
    try { entry.resolve(answer); } catch { /* ignore */ }
    return true;
  };

  const handleRequest = (req: IncomingMessage, res: ServerResponse): void => {
    const url = req.url ?? '';
    const method = req.method ?? 'GET';

    if (method === 'GET' && url === '/healthz') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
      return;
    }

    if (method === 'POST' && url.startsWith('/hitl/callback/')) {
      const requestId = decodeURIComponent(url.slice('/hitl/callback/'.length).split('?')[0]!);
      if (!requestId) {
        res.writeHead(400, { 'content-type': 'text/plain' });
        res.end('missing requestId');
        return;
      }
      if (opts.secret) {
        const got = req.headers['x-elanous-secret'];
        if (typeof got !== 'string' || got !== opts.secret) {
          res.writeHead(401, { 'content-type': 'text/plain' });
          res.end('forbidden');
          return;
        }
      }
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        let body: unknown;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        } catch {
          res.writeHead(400, { 'content-type': 'text/plain' });
          res.end('bad json');
          return;
        }
        const answer = (body as { answer?: unknown })?.answer;
        if (typeof answer !== 'boolean') {
          res.writeHead(400, { 'content-type': 'text/plain' });
          res.end('answer must be boolean');
          return;
        }
        const found = resolvePending(requestId, answer);
        if (!found) {
          res.writeHead(404, { 'content-type': 'text/plain' });
          res.end('no pending request');
          return;
        }
        try { opts.onAnswer?.({ requestId, answer }); } catch { /* ignore */ }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, requestId, answer }));
      });
      req.on('error', () => {
        res.writeHead(400, { 'content-type': 'text/plain' });
        res.end('request error');
      });
      return;
    }

    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  };

  const tryListen = (port: number): Promise<{ ok: true; bound: number } | { ok: false; err: NodeJS.ErrnoException }> => {
    return new Promise((resolve) => {
      const s = createServer(handleRequest);
      const onError = (err: NodeJS.ErrnoException): void => {
        s.removeAllListeners();
        s.close(() => resolve({ ok: false, err }));
      };
      s.once('error', onError);
      s.listen(port, host, () => {
        s.off('error', onError);
        const addr = s.address();
        const bound = typeof addr === 'object' && addr ? addr.port : port;
        server = s;
        resolve({ ok: true, bound });
      });
    });
  };

  const start = async (): Promise<void> => {
    if (server) return;
    // OS-assigned port (test mode) or scan-disabled — single attempt.
    if (wantPort === 0 || portScanRange === 1) {
      const r = await tryListen(wantPort);
      if (!r.ok) throw r.err;
      actualPort = r.bound;
      return;
    }
    let lastErr: NodeJS.ErrnoException | null = null;
    for (let i = 0; i < portScanRange; i++) {
      const candidate = wantPort + i;
      const r = await tryListen(candidate);
      if (r.ok) {
        actualPort = r.bound;
        if (candidate !== wantPort) {
          try { opts.onPortShift?.({ wanted: wantPort, actual: r.bound }); } catch { /* ignore */ }
        }
        return;
      }
      lastErr = r.err;
      if (r.err.code !== 'EADDRINUSE' && r.err.code !== 'EACCES') {
        // Non-port-conflict error — don't keep scanning.
        throw r.err;
      }
    }
    throw lastErr ?? new Error(`HITL callback-server: no free port in ${wantPort}..${wantPort + portScanRange - 1}`);
  };

  const stop = async (): Promise<void> => {
    if (!server) return;
    // Reject pending requests so awaiters unblock.
    for (const [id] of pending) resolvePending(id, null);
    const s = server;
    server = null;
    actualPort = null;
    await new Promise<void>((resolve) => {
      s.close(() => resolve());
      // s.close blocks on open keep-alives — force any sockets
      // closed so the dashboard can exit.
      s.closeAllConnections?.();
    });
  };

  const awaitCallback = (requestId: string, timeoutMs?: number): Promise<boolean | null> => {
    if (pending.has(requestId)) {
      return Promise.resolve(null);
    }
    return new Promise<boolean | null>((resolve) => {
      const limit = timeoutMs ?? defaultTimeoutMs;
      const timer = setTimeout(() => {
        if (pending.has(requestId)) {
          pending.delete(requestId);
          resolve(null);
        }
      }, limit);
      if (typeof (timer as { unref?: () => void }).unref === 'function') {
        (timer as unknown as { unref: () => void }).unref();
      }
      pending.set(requestId, { resolve, timer });
    });
  };

  return {
    url: () => actualPort === null ? null : `http://${host}:${actualPort}`,
    port: () => actualPort,
    start,
    stop,
    awaitCallback,
    pending: () => [...pending.keys()],
  };
}
