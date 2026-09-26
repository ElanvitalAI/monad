// MVP M1.1 — Unix-socket ACP **client** transport.
//
// Mirror of `src/acp/transport/unix-socket-server.ts`'s
// `socketToConnection` for the client side. Lets a TUI / Telegram bot
// / web client connect to a headless Elanous daemon listening on
// `~/.elanous/elanous.sock` and obtain the same `{ readable, writable }`
// shape `ndJsonStream(...)` consumes.
//
// The server enforces `chmod 0600` so loopback identity check is the
// kernel's job — no token here. Token / Tailscale identity belongs to
// the WebSocket transport.
//
// Used by:
//   - `monad-agent` TUI auto-attach (M1.3)
//   - `elanous telegram run` daemon attach (M2.1)
//
// Pairs with `listenUnixSocket()` in src/acp/transport/.

import {
  createConnection,
  type Socket as NetSocket,
} from 'node:net';
import { existsSync } from 'node:fs';

import {
  AcpTransportError,
  type AcpTransportConnection,
} from '../acp/transport/index.js';

export interface ConnectUnixSocketOpts {
  /** Filesystem path of the listening socket. */
  path: string;
  /** Abort the in-flight connect attempt. Once connected, use
   *  `bridge.close()` to disconnect. */
  signal?: AbortSignal;
  /** Best-effort tag for debug log; defaults to `unix:<path>`. */
  peerLabel?: string;
}

/** Convert a connected `net.Socket` into the paired Web-stream shape
 *  the ACP SDK consumes. Mirror of the server-side helper in
 *  unix-socket-server.ts. */
function socketToConnection(
  socket: NetSocket,
  peerId: string,
): AcpTransportConnection {
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      socket.on('data', (chunk: Buffer) => {
        controller.enqueue(new Uint8Array(chunk));
      });
      socket.on('end', () => {
        try { controller.close(); } catch { /* already closed */ }
      });
      socket.on('error', () => {
        try { controller.close(); } catch { /* already closed */ }
      });
    },
  });
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      return new Promise<void>((res, rej) => {
        socket.write(chunk, (err) => (err ? rej(err) : res()));
      });
    },
    close() { socket.end(); },
    abort() { socket.destroy(); },
  });
  return {
    readable,
    writable,
    peerId,
    async close() {
      socket.destroy();
    },
  };
}

/** Connect to a Elanous daemon over its Unix domain socket. Resolves
 *  with the bidirectional stream pair once the socket is connected;
 *  rejects with `AcpTransportError` on connect failure (stale path,
 *  permission denied, no daemon listening). */
export async function connectUnixSocket(
  opts: ConnectUnixSocketOpts,
): Promise<AcpTransportConnection> {
  const peerId = opts.peerLabel ?? `unix:${opts.path}`;
  // Pre-flight abort — avoid touching the socket layer at all.
  if (opts.signal?.aborted) {
    throw new AcpTransportError('unix-socket-client', 'aborted');
  }
  return new Promise<AcpTransportConnection>((resolve, reject) => {
    const socket = createConnection(opts.path);
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(new AcpTransportError('unix-socket-client', 'aborted'));
    };
    if (opts.signal) {
      opts.signal.addEventListener('abort', onAbort, { once: true });
    }
    socket.once('connect', () => {
      if (settled) return;
      settled = true;
      opts.signal?.removeEventListener('abort', onAbort);
      resolve(socketToConnection(socket, peerId));
    });
    socket.once('error', (err) => {
      if (settled) return;
      settled = true;
      opts.signal?.removeEventListener('abort', onAbort);
      reject(new AcpTransportError('unix-socket-client', (err as Error).message));
    });
  });
}

/** Probe: is a daemon currently listening at this path? Returns
 *  `true` when a connect succeeds (alive), `false` on ECONNREFUSED /
 *  ENOENT (stale or absent), and `false` when the probe does not
 *  resolve either way within `timeoutMs`.
 *
 *  ⚠️ The probe MUST be bounded. It previously listened only for
 *  `connect` and `error`, so a socket that did neither — a path whose
 *  listener accepts the connection into its backlog but never completes
 *  it, or a peer that closes without raising — left this promise
 *  unsettled forever AND left the socket handle open, which keeps the
 *  event loop alive. Callers are boot-path deciders (attach vs spawn a
 *  daemon), so an unsettled probe freezes TUI boot; under `bun test` the
 *  live handle stops the whole run from ever exiting. A probe answering
 *  "not alive" late is always safe — the caller then spawns — so the
 *  timeout resolves `false` rather than rejecting. */
export async function isUnixSocketAlive(
  path: string,
  timeoutMs = 1_000,
  /** Test seam. A unix socket cannot be made to hang on demand — the kernel
   *  completes `connect` as soon as the listener accepts, regardless of whether
   *  the application ever answers — so the timeout arm is unreachable from a
   *  real socket. Injecting the connector is the only way to actually exercise
   *  it; asserting against a real listener would pass whether or not the
   *  timeout exists. Production callers never pass this. */
  connect: (p: string) => Pick<NetSocket, 'on' | 'once' | 'destroy'> = createConnection,
): Promise<boolean> {
  // ⚠️ Answer "absent" WITHOUT opening a socket. A unix socket must exist
  // as a path to be connectable, so a missing path is already the answer —
  // and attempting the connect anyway is what produces the ENOENT the
  // caller then has to survive. That error is emitted, not thrown, so a
  // `try/catch` around `createConnection` cannot contain it; if it lands
  // before a listener is attached it is re-thrown as uncaught and fails
  // whatever happens to be running. Not creating the socket removes the
  // whole class rather than racing it. This is also the overwhelmingly
  // common case on the boot path: no daemon yet.
  // ⚠️ TOCTOU is accepted here, deliberately. The path can appear between this
  // check and a caller's next action, so a daemon that binds in that window is
  // reported absent and the caller spawns a second one. That race already
  // existed — the connect could equally lose it — and this probe is advisory:
  // "not alive" is always a safe answer because the caller's own bind/attach
  // is what actually resolves the contention. What is NOT acceptable, and is
  // what this line prevents, is a probe that never answers at all.
  if (!existsSync(path)) return false;
  return new Promise<boolean>((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let probe: Pick<NetSocket, 'on' | 'once' | 'destroy'> | undefined;
    // ⚠️ `finish` is defined BEFORE the socket exists on purpose. An
    // `'error'` emitted with no listener attached is re-thrown as an
    // uncaught exception, so the gap between the connect and the error
    // listener must stay as small as possible — nothing may be declared
    // between them.
    const finish = (alive: boolean): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try { probe?.destroy(); } catch { /* already gone */ }
      resolve(alive);
    };
    try {
      probe = connect(path);
    } catch {
      finish(false); // a synchronous throw is just "not alive"
      return;
    }
    // ⚠️ `on`, not `once`. A consumed one-shot listener leaves the socket
    // with no 'error' handler, and the `destroy()` inside `finish` can
    // raise a second error on an already-failed connect — which is then
    // thrown as uncaught and fails whatever test happens to be running.
    // The absorber must outlive the first error.
    probe.on('error', () => finish(false));
    probe.once('connect', () => finish(true));
    // A close without connect/error is "not alive", not "wait forever".
    probe.once('close', () => finish(false));
    timer = setTimeout(() => finish(false), timeoutMs);
    // Never let the probe's own timer hold the process open.
    (timer as { unref?: () => void }).unref?.();
  });
}
