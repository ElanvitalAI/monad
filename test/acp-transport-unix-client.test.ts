// MVP M1.1 — Unix-socket ACP client transport tests.
//
// Pair `connectUnixSocket` with the existing `listenUnixSocket` and
// drive a byte round-trip through both directions, plus error paths
// (no daemon listening, abort signal) and `isUnixSocketAlive` probe.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';

import {
  listenUnixSocket,
  type AcpTransportConnection,
  type AcpTransportServer,
} from '../src/acp/transport/index.js';
import {
  connectUnixSocket,
  isUnixSocketAlive,
} from '../src/tui-client/acp-transport-unix-client.js';
import { AcpTransportError } from '../src/acp/transport/index.js';

let tmp: string;
let sockPath: string;

beforeEach(() => {
  tmp = mkdtempSync(joinPath(tmpdir(), 'monad-sock-client-test-'));
  sockPath = joinPath(tmp, 'monad.sock');
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

async function readOneChunk(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const { value } = await reader.read();
  reader.releaseLock();
  return new TextDecoder().decode(value!);
}

async function writeOne(stream: WritableStream<Uint8Array>, payload: string): Promise<void> {
  const writer = stream.getWriter();
  await writer.write(new TextEncoder().encode(payload));
  writer.releaseLock();
}

describe('connectUnixSocket', () => {
  test('round-trips bytes both ways with listenUnixSocket', async () => {
    let resolveServerConn!: (c: AcpTransportConnection) => void;
    const serverConnP = new Promise<AcpTransportConnection>((res) => {
      resolveServerConn = res;
    });

    const server: AcpTransportServer = await listenUnixSocket({
      path: sockPath,
      onConnection: (c) => { resolveServerConn(c); },
    });

    try {
      const clientConn = await connectUnixSocket({ path: sockPath });
      const serverConn = await serverConnP;

      // client → server
      await writeOne(clientConn.writable, 'ping');
      const fromClient = await readOneChunk(serverConn.readable);
      expect(fromClient).toBe('ping');

      // server → client
      await writeOne(serverConn.writable, 'pong');
      const fromServer = await readOneChunk(clientConn.readable);
      expect(fromServer).toBe('pong');

      await clientConn.close();
      await serverConn.close();
    } finally {
      await server.close();
    }
  });

  test('rejects when no daemon is listening (ENOENT)', async () => {
    await expect(
      connectUnixSocket({ path: sockPath /* nothing bound */ }),
    ).rejects.toBeInstanceOf(AcpTransportError);
  });

  test('rejects when the abort signal fires pre-connect', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(
      connectUnixSocket({ path: sockPath, signal: ctrl.signal }),
    ).rejects.toBeInstanceOf(AcpTransportError);
  });

  test('peerId reflects the socket path by default', async () => {
    const server = await listenUnixSocket({
      path: sockPath,
      onConnection: () => {},
    });
    try {
      const conn = await connectUnixSocket({ path: sockPath });
      expect(conn.peerId).toBe(`unix:${sockPath}`);
      await conn.close();
    } finally {
      await server.close();
    }
  });

  test('custom peerLabel overrides the default', async () => {
    const server = await listenUnixSocket({
      path: sockPath,
      onConnection: () => {},
    });
    try {
      const conn = await connectUnixSocket({ path: sockPath, peerLabel: 'tui-1' });
      expect(conn.peerId).toBe('tui-1');
      await conn.close();
    } finally {
      await server.close();
    }
  });
});

describe('isUnixSocketAlive', () => {
  test('returns true when a daemon is listening', async () => {
    const server = await listenUnixSocket({
      path: sockPath,
      onConnection: () => {},
    });
    try {
      expect(await isUnixSocketAlive(sockPath)).toBe(true);
    } finally {
      await server.close();
    }
  });

  test('returns false when nothing is bound (ENOENT)', async () => {
    expect(await isUnixSocketAlive(sockPath)).toBe(false);
  });

  // The probe is a boot-path decider (attach an existing daemon vs spawn
  // one). Before it was bounded, a socket that neither connected nor
  // errored left the promise unsettled AND the handle open — TUI boot
  // hung, and under `bun test` the live handle kept the whole run from
  // exiting. These two pin that it always settles.
  // ⚠️ The timeout arm CANNOT be exercised with a real unix socket: the
  // kernel completes `connect` the moment the listener accepts, whether or
  // not the application ever answers. A test that stands up a silent
  // listener and asserts "it settled" passes identically with the timeout
  // deleted — it measures nothing. So the connector is injected, and the
  // fake socket emits no event at all: the only thing that can settle it
  // is the timeout.
  /** Bound a probe call from the TEST side.
   *
   *  Without this, deleting the timeout makes these tests hang into bun's
   *  5 s per-test limit: still a failure, but a slow and unhelpfully generic
   *  one. Racing here turns "the probe never settled" into a fast, named
   *  assertion failure — which is what a guard against never-settling should
   *  itself look like. */
  async function within<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
    let t: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        p,
        new Promise<never>((_, reject) => {
          t = setTimeout(() => reject(new Error(`${what} did not settle within ${ms}ms`)), ms);
        }),
      ]);
    } finally {
      if (t) clearTimeout(t);
    }
  }

  const silentSocket = () => ({
    on() { return this; },
    once() { return this; },
    destroy() { /* nothing to tear down */ },
  }) as unknown as Parameters<typeof isUnixSocketAlive>[2] extends undefined ? never : ReturnType<NonNullable<Parameters<typeof isUnixSocketAlive>[2]>>;

  test('a socket that never emits anything is settled by the timeout, not left pending', async () => {
    // The path must exist or the probe short-circuits before connecting.
    writeFileSync(sockPath, '');
    const started = Date.now();
    const alive = await within(isUnixSocketAlive(sockPath, 40, () => silentSocket()), 500, 'timeout-arm probe');
    // Not merely "settled" — it must settle FALSE, via the timeout arm.
    expect(alive).toBe(false);
    // And it must have actually waited for that budget rather than
    // falling through some other path that also returns false.
    expect(Date.now() - started).toBeGreaterThanOrEqual(35);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  test('the probe destroys its socket once it settles', async () => {
    writeFileSync(sockPath, '');
    let destroyed = 0;
    const spy = () => ({
      on() { return this; },
      once() { return this; },
      destroy() { destroyed += 1; },
    }) as unknown as ReturnType<NonNullable<Parameters<typeof isUnixSocketAlive>[2]>>;
    await within(isUnixSocketAlive(sockPath, 20, () => spy()), 500, 'destroy probe');
    // A probe that settles without destroying leaks the handle, which is
    // the whole failure this guards against.
    expect(destroyed).toBe(1);
  });

  test('settles within its own budget when the path is a directory (neither connect nor refuse)', async () => {
    const started = Date.now();
    // `tmp` is a directory, not a socket — a shape that does not produce
    // the tidy ECONNREFUSED the original probe assumed.
    expect(await isUnixSocketAlive(tmp, 200)).toBe(false);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  test('a missing path answers absent WITHOUT opening a socket', async () => {
    let connects = 0;
    const counted = () => { connects += 1; return silentSocket(); };
    expect(await isUnixSocketAlive(joinPath(tmp, 'nope.sock'), 20, counted)).toBe(false);
    // Opening a socket for a missing path is what emits the uncaught
    // ENOENT; not opening it is the fix, so pin that it is not opened.
    expect(connects).toBe(0);
  });
});

describe('multi-client', () => {
  test('two simultaneous clients each get their own server-side connection', async () => {
    const conns: AcpTransportConnection[] = [];
    const gotTwo = new Promise<void>((resolve) => {
      const onConn = (c: AcpTransportConnection) => {
        conns.push(c);
        if (conns.length === 2) resolve();
      };
      void onConn;
      // Wire onConnection in the listenUnixSocket call below.
      void onConn;
    });
    void gotTwo;

    let count = 0;
    let resolveTwo!: () => void;
    const twoSeen = new Promise<void>((res) => { resolveTwo = res; });

    const server = await listenUnixSocket({
      path: sockPath,
      onConnection: (c) => {
        conns.push(c);
        count += 1;
        if (count === 2) resolveTwo();
      },
    });

    try {
      const c1 = await connectUnixSocket({ path: sockPath });
      const c2 = await connectUnixSocket({ path: sockPath });
      await twoSeen;
      expect(conns.length).toBe(2);

      await c1.close();
      await c2.close();
      await Promise.all(conns.map((c) => c.close()));
    } finally {
      await server.close();
    }
  });
});
