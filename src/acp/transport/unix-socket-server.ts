// UI-Core arc Phase U4 — Unix domain socket transport.
//
// Loopback-only by construction — the kernel enforces `chmod 0600`
// so no token check is needed. A bound socket file at
// `~/.monad/monad.sock` is the canonical contact point for a local
// TUI/CLI that wants to talk to a headless Monad core running in
// another shell (or as a launchd/systemd daemon).
//
// On process exit we unlink the stale socket file so the next boot
// doesn't trip on `EADDRINUSE`. Crash scenarios still leave a stale
// file; `listenUnixSocket` detects that on startup and removes it
// **only** if nothing else is listening (a fresh connect attempt
// fails with ECONNREFUSED).

import {
  chmodSync,
  existsSync,
  mkdirSync,
  unlinkSync,
} from 'node:fs';
import {
  createConnection,
  createServer,
  type Server as NetServer,
  type Socket as NetSocket,
} from 'node:net';
import { dirname } from 'node:path';

import type {
  AcpConnectionHandler,
  AcpTransportConnection,
  AcpTransportServer,
} from './types.js';
import { AcpTransportError } from './types.js';

export interface UnixSocketServerOpts {
  /** Filesystem path for the socket. `~/.monad/monad.sock` by convention. */
  path: string;
  /** Called once per inbound connection. */
  onConnection: AcpConnectionHandler;
  /** Optional override for the probe-connect used to detect stale
   *  socket files. Tests inject a function that resolves to `false`
   *  so we don't race against a real connect. */
  probeStale?: (path: string) => Promise<boolean>;
}

/** Probe: is anything listening at this path? Returns `true` when a
 *  connect succeeds (live server), `false` when the kernel replies
 *  ECONNREFUSED (stale file). ENOENT → `false` (file is gone). */
async function probeStaleDefault(path: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const probe = createConnection(path);
    let settled = false;
    probe.once('connect', () => {
      if (settled) return;
      settled = true;
      probe.destroy();
      resolve(true);
    });
    probe.once('error', () => {
      if (settled) return;
      settled = true;
      resolve(false);
    });
  });
}

/** Convert a `net.Socket` into the paired Web-stream shape the ACP
 *  SDK expects. */
function socketToConnection(socket: NetSocket, peerId: string): AcpTransportConnection {
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      socket.on('data', (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
      socket.on('end', () => { try { controller.close(); } catch { /* already */ } });
      socket.on('error', () => { try { controller.close(); } catch { /* already */ } });
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

/** Start listening on a Unix domain socket. Returns a handle the
 *  caller uses to stop the server. Every inbound connection fires
 *  `opts.onConnection`. */
export async function listenUnixSocket(opts: UnixSocketServerOpts): Promise<AcpTransportServer> {
  // Ensure dir exists.
  const dir = dirname(opts.path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  // Stale-file handling.
  if (existsSync(opts.path)) {
    const alive = await (opts.probeStale ?? probeStaleDefault)(opts.path);
    if (alive) {
      throw new AcpTransportError('unix-socket', `another server already listening on ${opts.path}`);
    }
    try { unlinkSync(opts.path); } catch (err) {
      throw new AcpTransportError('unix-socket', `failed to unlink stale socket ${opts.path}: ${(err as Error).message}`);
    }
  }

  const server: NetServer = createServer((socket) => {
    const peerId = `unix:${opts.path}#${Math.random().toString(36).slice(2, 10)}`;
    const conn = socketToConnection(socket, peerId);
    Promise.resolve(opts.onConnection(conn)).catch(() => {
      // Handler errors must not bring the listener down.
    });
  });

  await new Promise<void>((res, rej) => {
    server.once('error', (err) => rej(new AcpTransportError('unix-socket', err.message)));
    server.listen(opts.path, () => res());
  });

  // Lock down permissions — owner only.
  try { chmodSync(opts.path, 0o600); } catch { /* best-effort */ }

  return {
    kind: 'unix-socket',
    address: opts.path,
    async close() {
      await new Promise<void>((res) => {
        server.close(() => res());
      });
      try { unlinkSync(opts.path); } catch { /* best-effort */ }
    },
  };
}
