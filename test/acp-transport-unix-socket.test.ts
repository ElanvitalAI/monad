// UI-Core arc Phase U4 — Unix socket transport tests.
//
// We do actually bind a socket (inside a tmp dir so the test is
// hermetic) and connect from the test, sending/receiving one chunk.
// Stale-file detection is exercised via the `probeStale` seam.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createConnection, type Socket } from 'node:net';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';

import {
  listenUnixSocket,
  AcpTransportError,
  type AcpTransportConnection,
  type AcpTransportServer,
} from '../src/acp/transport/index.js';

let tmp: string;
let sockPath: string;

beforeEach(() => {
  tmp = mkdtempSync(joinPath(tmpdir(), 'elanous-sock-test-'));
  sockPath = joinPath(tmp, 'elanous.sock');
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

async function waitForConnection(server: AcpTransportServer): Promise<AcpTransportConnection> {
  // test harness wires `onConnection` that resolves the promise.
  // Callers construct their own via makeHarness below.
  return new Promise<AcpTransportConnection>((_res, _rej) => {
    void server; // unused
  });
}
void waitForConnection;

describe('listenUnixSocket', () => {
  test('binds + accepts + forwards bytes', async () => {
    let resolveConn!: (conn: AcpTransportConnection) => void;
    const connP = new Promise<AcpTransportConnection>((res) => { resolveConn = res; });

    const server = await listenUnixSocket({
      path: sockPath,
      onConnection: (c) => { resolveConn(c); },
    });

    try {
      const client = createConnection(sockPath);
      await new Promise<void>((res, rej) => {
        client.once('connect', () => res());
        client.once('error', rej);
      });

      client.write('hello');
      const conn = await connP;
      const reader = conn.readable.getReader();
      const { value } = await reader.read();
      reader.releaseLock();
      expect(new TextDecoder().decode(value!)).toBe('hello');

      await new Promise<void>((res) => { client.end(() => res()); });
    } finally {
      await server.close();
    }
  });

  test('rejects when another server is already listening', async () => {
    const first = await listenUnixSocket({
      path: sockPath,
      onConnection: () => {},
    });
    try {
      await expect(
        listenUnixSocket({ path: sockPath, onConnection: () => {} }),
      ).rejects.toBeInstanceOf(AcpTransportError);
    } finally {
      await first.close();
    }
  });

  test('removes stale socket file when nothing alive', async () => {
    // Pre-create a stale file to simulate a prior crash.
    writeFileSync(sockPath, '');
    expect(existsSync(sockPath)).toBe(true);

    const server = await listenUnixSocket({
      path: sockPath,
      onConnection: () => {},
      probeStale: async () => false,
    });
    try {
      expect(existsSync(sockPath)).toBe(true); // re-created by listen
    } finally {
      await server.close();
    }
  });

  test('close() unlinks socket file', async () => {
    const server = await listenUnixSocket({
      path: sockPath,
      onConnection: () => {},
    });
    expect(existsSync(sockPath)).toBe(true);
    await server.close();
    expect(existsSync(sockPath)).toBe(false);
  });

  test('handler errors do not crash the listener', async () => {
    const connections: Socket[] = [];
    let sawFirst = false;
    const server = await listenUnixSocket({
      path: sockPath,
      onConnection: () => {
        if (!sawFirst) {
          sawFirst = true;
          throw new Error('handler boom');
        }
      },
    });
    try {
      // First connection — handler throws.
      const c1 = createConnection(sockPath);
      await new Promise<void>((res, rej) => {
        c1.once('connect', () => res());
        c1.once('error', rej);
      });
      connections.push(c1);

      // Second connection — listener must still be healthy.
      const c2 = createConnection(sockPath);
      await new Promise<void>((res, rej) => {
        c2.once('connect', () => res());
        c2.once('error', rej);
      });
      connections.push(c2);

      expect(sawFirst).toBe(true);
    } finally {
      for (const c of connections) c.destroy();
      await server.close();
    }
  });
});
