// ── LSP JSON-RPC client (stdio) ──
//
// Minimal Language Server Protocol client — spawns a server subprocess,
// frames messages per the `Content-Length: N\r\n\r\n<json>` contract,
// correlates request IDs to response promises, and tears the server
// down on dispose. No vendor SDK dependency; everything is implemented
// against `child_process.spawn`.
//
// L1 surface only — see 내부 문서 `PLAN-lsp-phase-1` for the contract and
// 내부 문서 `ROADMAP-lsp-integration` for how subsequent phases plug in.

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { debug } from '../../../debug/log.js';
import type { JsonRpcResponse } from './types.js';

export interface LspClient {
  /** Send an LSP request and await the response. Rejects on server
   *  error, exit, or timeout. `TRes = null` is allowed — LSP returns
   *  null for "no result" (empty hover at a whitespace position, etc). */
  request<TRes = unknown>(method: string, params: unknown): Promise<TRes>;

  /** Send an LSP notification (no response expected). */
  notify(method: string, params: unknown): void;

  /** Tear down the server: LSP `shutdown` + `exit` notifications,
   *  then SIGTERM fallback, then SIGKILL if it's still alive.
   *  Idempotent. */
  dispose(): Promise<void>;

  /** True iff the server process is still running and the client
   *  hasn't been disposed. */
  readonly alive: boolean;
}

export interface SpawnLspClientOpts {
  command: string;
  args?: readonly string[];
  cwd?: string;
  /** Extra environment variables merged into the child's inherited
   *  process.env. Used by tests to drive mock-server scenarios
   *  (MOCK_DELAY_MS, MOCK_HOVER_EMPTY, etc.) and by L4's config
   *  section to inject language-server-specific variables. */
  env?: NodeJS.ProcessEnv;
  /** Per-request timeout in ms. Default 15_000. */
  requestTimeoutMs?: number;
  /** Post-dispose forced-kill timeout in ms. If the server doesn't
   *  exit within this window after we send `shutdown`+`exit`, we
   *  SIGTERM; if it's still alive 500ms later we SIGKILL. Default
   *  2_000 (total worst-case reap ~2.5s). */
  shutdownTimeoutMs?: number;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 2_000;

/** Spawn a language server and return a ready LspClient. The caller
 *  is responsible for sending `initialize` + `initialized` through
 *  `client.request` / `client.notify` before using it — different
 *  servers need different capabilities, and this module stays
 *  server-agnostic. */
export function spawnLspClient(opts: SpawnLspClientOpts): LspClient {
  const requestTimeoutMs = opts.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const shutdownTimeoutMs = opts.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;

  const proc = spawn(opts.command, [...(opts.args ?? [])], {
    stdio: ['pipe', 'pipe', 'pipe'],
    ...(opts.cwd ? { cwd: opts.cwd } : {}),
    ...(opts.env ? { env: { ...process.env, ...opts.env } } : {}),
  }) as ChildProcessWithoutNullStreams;

  if (debug.enabled) {
    debug.log('lsp.client.spawn', opts.command, {
      pid: proc.pid,
      args: opts.args,
      cwd: opts.cwd,
    });
  }

  let nextId = 1;
  let alive = true;
  let disposed = false;
  /** Pending requests awaiting response. Keyed by JSON-RPC id. */
  const pending = new Map<number, {
    resolve: (v: unknown) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
    method: string;
  }>();
  /** Incoming-message buffer. LSP frames can arrive as partial
   *  chunks; we accumulate until a complete message is extractable.
   *  Typed as the broader `Buffer` (not `Buffer<ArrayBuffer>` inferred
   *  from Buffer.alloc) so assignments of incoming chunks (which have
   *  `Buffer<ArrayBufferLike>`) don't trip tsc under strict Node 20+
   *  type defs. */
  let inBuf: Buffer = Buffer.alloc(0);

  const parseFrames = (): void => {
    // Each frame: `Content-Length: N\r\n[headers]\r\n\r\n<body of length N>`.
    for (;;) {
      const sep = inBuf.indexOf('\r\n\r\n');
      if (sep < 0) return;
      const headerStr = inBuf.slice(0, sep).toString('utf-8');
      const match = /Content-Length:\s*(\d+)/i.exec(headerStr);
      if (!match) {
        // Malformed header — drop everything up to and including the
        // separator and keep going; the server shouldn't be sending
        // garbage but we don't want a bad byte to wedge the parser
        // forever.
        inBuf = inBuf.slice(sep + 4);
        continue;
      }
      const bodyLen = Number(match[1]);
      const frameEnd = sep + 4 + bodyLen;
      if (inBuf.length < frameEnd) return;   // wait for more data
      const bodyStr = inBuf.slice(sep + 4, frameEnd).toString('utf-8');
      inBuf = inBuf.slice(frameEnd);
      handleMessage(bodyStr);
    }
  };

  const handleMessage = (bodyStr: string): void => {
    let msg: JsonRpcResponse | Record<string, unknown>;
    try {
      msg = JSON.parse(bodyStr) as JsonRpcResponse;
    } catch (err) {
      if (debug.enabled) {
        debug.log('lsp.client.parse-error', 'body', {
          error: err instanceof Error ? err.message : String(err),
          preview: bodyStr.slice(0, 200),
        }, { level: 'error' });
      }
      return;
    }

    // Responses correlate by id; notifications / server-initiated
    // requests have no id or an id we never issued. We ignore the
    // latter in L1 — L3 adds handling for `window/showMessage` etc.
    const resp = msg as JsonRpcResponse;
    if (typeof resp.id !== 'number' || !pending.has(resp.id)) return;

    const slot = pending.get(resp.id)!;
    pending.delete(resp.id);
    clearTimeout(slot.timer);

    if (resp.error) {
      if (debug.enabled) {
        debug.log('lsp.client.error', slot.method, {
          id: resp.id,
          code: resp.error.code,
          message: resp.error.message,
        }, { level: 'error' });
      }
      slot.reject(new Error(`Lsp client: server error: ${resp.error.message}`));
      return;
    }
    if (debug.enabled) {
      debug.log('lsp.client.response', slot.method, { id: resp.id });
    }
    slot.resolve(resp.result);
  };

  proc.stdout.on('data', (chunk: Buffer) => {
    inBuf = inBuf.length === 0 ? chunk : Buffer.concat([inBuf, chunk]);
    try { parseFrames(); }
    catch (err) {
      if (debug.enabled) {
        debug.log('lsp.client.frame-parse-error', 'stdout', {
          error: err instanceof Error ? err.message : String(err),
        }, { level: 'error' });
      }
    }
  });

  // Servers chatter on stderr (startup progress, warnings). We swallow
  // by default and only surface it in debug.log so a verbose server
  // doesn't bleed into the user's pane.
  proc.stderr.on('data', (chunk: Buffer) => {
    if (debug.enabled) {
      debug.log('lsp.client.stderr', 'chunk', {
        text: chunk.toString('utf-8').slice(0, 500),
      });
    }
  });

  const handleExit = (code: number | null, signal: NodeJS.Signals | null): void => {
    alive = false;
    if (debug.enabled) {
      debug.log('lsp.client.exit', opts.command, {
        code, signal, pendingCount: pending.size,
      });
    }
    // Reject every pending request — the server can no longer answer.
    const err = new Error(
      `Lsp client: server exited (code=${code ?? 'null'}, signal=${signal ?? 'null'})`,
    );
    for (const slot of pending.values()) {
      clearTimeout(slot.timer);
      slot.reject(err);
    }
    pending.clear();
  };
  proc.once('exit', handleExit);
  proc.once('error', (err) => {
    if (debug.enabled) {
      debug.log('lsp.client.spawn-error', opts.command, {
        message: err.message,
      }, { level: 'error' });
    }
    handleExit(null, null);
  });

  const writeFrame = (body: string): void => {
    if (!alive) throw new Error('Lsp client: server is not alive');
    const header = `Content-Length: ${Buffer.byteLength(body, 'utf-8')}\r\n\r\n`;
    proc.stdin.write(header + body, 'utf-8');
  };

  const request = <TRes = unknown>(method: string, params: unknown): Promise<TRes> => {
    if (!alive) {
      return Promise.reject(new Error('Lsp client: server is not alive'));
    }
    const id = nextId++;
    if (debug.enabled) {
      debug.log('lsp.client.request', method, { id });
    }
    const body = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    return new Promise<TRes>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        if (debug.enabled) {
          debug.log('lsp.client.timeout', method, { id, timeoutMs: requestTimeoutMs }, { level: 'warn' });
        }
        reject(new Error(
          `Lsp client: request timeout after ${requestTimeoutMs}ms (method=${method})`,
        ));
      }, requestTimeoutMs);
      pending.set(id, {
        resolve: (v) => resolve(v as TRes),
        reject, timer, method,
      });
      try {
        writeFrame(body);
      } catch (err) {
        // Remove the slot we just inserted so the timer doesn't fire
        // after rejection.
        const slot = pending.get(id);
        if (slot) {
          clearTimeout(slot.timer);
          pending.delete(id);
        }
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  };

  const notify = (method: string, params: unknown): void => {
    if (!alive) return;
    const body = JSON.stringify({ jsonrpc: '2.0', method, params });
    try { writeFrame(body); }
    catch (err) {
      if (debug.enabled) {
        debug.log('lsp.client.notify-error', method, {
          error: err instanceof Error ? err.message : String(err),
        }, { level: 'error' });
      }
    }
  };

  const dispose = async (): Promise<void> => {
    if (disposed) return;
    disposed = true;
    // Best-effort graceful shutdown: LSP `shutdown` request, then
    // `exit` notification. Ignore errors — the server might already
    // be unhealthy. Caller shouldn't await longer than shutdownTimeoutMs.
    if (alive) {
      try { await Promise.race([
        request('shutdown', null).catch(() => undefined),
        new Promise(res => setTimeout(res, shutdownTimeoutMs)),
      ]); }
      catch { /* swallow */ }
      try { notify('exit', null); }
      catch { /* swallow */ }
    }
    // If the server still hasn't exited on its own within another
    // short window, escalate to SIGTERM → SIGKILL.
    if (alive) {
      await new Promise<void>(res => {
        const kt = setTimeout(() => {
          try { proc.kill('SIGTERM'); } catch { /* swallow */ }
          setTimeout(() => {
            if (alive) { try { proc.kill('SIGKILL'); } catch { /* swallow */ } }
            res();
          }, 500);
        }, shutdownTimeoutMs);
        proc.once('exit', () => { clearTimeout(kt); res(); });
      });
    }
  };

  return {
    request,
    notify,
    dispose,
    get alive() { return alive; },
  };
}
