// MVP M1.4 — Daemon survives TUI detach.
//
// Two scenarios this test proves:
//   1. Client disconnects → daemon stays up + accepts a fresh client.
//   2. A long-running turn started by client A continues server-side
//      after client A disconnects (chunks pushed to a closed
//      connection are absorbed; the turn completes).
//
// Together: "잠깐 외출" use case is sound — the daemon doesn't die
// when its only TUI exits.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';

import { bootAcpServer } from '../src/boot/acp-server.js';
import {
  connectUnixSocket,
  isUnixSocketAlive,
} from '../src/tui-client/acp-transport-unix-client.js';
import { DashboardSession } from '../src/tui-client/dashboard-session.js';
import { waitForSocket } from './helpers/wait-for-socket.js';

let tmp: string;
let sockPath: string;

beforeEach(() => {
  tmp = mkdtempSync(joinPath(tmpdir(), 'monad-detach-test-'));
  sockPath = joinPath(tmp, 'monad.sock');
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('daemon survives client detach', () => {
  test('a fresh client can attach after the previous one disconnects', async () => {
    const shutdownCtrl = new AbortController();
    const stubRunTurn = async (turnCtx: {
      userText: string;
      push: (text: string) => Promise<void>;
    }): Promise<void> => {
      await turnCtx.push(`echo: ${turnCtx.userText}`);
    };
    const serverPromise = bootAcpServer(
      { transport: 'unix-socket', socketPath: sockPath },
      { shutdownSignal: shutdownCtrl.signal, runTurn: stubRunTurn },
    );

    await waitForSocket(sockPath);

    // Client 1 — attach + send + disconnect.
    {
      const conn = await connectUnixSocket({ path: sockPath });
      const session = await DashboardSession.attach({ conn, cwd: tmp });
      const chunks: string[] = [];
      const r = await session.send({
        userText: 'hello',
        onText: (d: string) => { chunks.push(d); },
      });
      expect(r.stopReason).toBe('end_turn');
      expect(chunks.join('')).toBe('echo: hello');
      await session.close();
    }

    // Daemon should still be alive — probe + connect again.
    expect(await isUnixSocketAlive(sockPath)).toBe(true);

    // Client 2 — fresh attach + new session id.
    {
      const conn = await connectUnixSocket({ path: sockPath });
      const session = await DashboardSession.attach({ conn, cwd: tmp });
      const chunks: string[] = [];
      const r = await session.send({
        userText: 'world',
        onText: (d: string) => { chunks.push(d); },
      });
      expect(r.stopReason).toBe('end_turn');
      expect(chunks.join('')).toBe('echo: world');
      await session.close();
    }

    shutdownCtrl.abort();
    try { await serverPromise; } catch { /* ignore */ }
  });

  test('an in-flight turn completes server-side even after client disconnects mid-turn', async () => {
    let turnCompleted = false;
    const turnCompletedSignal = new Promise<void>((resolve) => {
      // Set in stubRunTurn below.
      const interval = setInterval(() => {
        if (turnCompleted) {
          clearInterval(interval);
          resolve();
        }
      }, 10);
    });

    const shutdownCtrl = new AbortController();
    const stubRunTurn = async (turnCtx: {
      userText: string;
      push: (text: string) => Promise<void>;
    }): Promise<void> => {
      // Simulate a slow turn — 4 chunks with a gap.
      for (let i = 0; i < 4; i += 1) {
        // Some pushes may fire after the client disconnects; the ACP
        // server must absorb them silently.
        try {
          await turnCtx.push(`chunk-${i};`);
        } catch {
          // Even if the push throws, the test cares that the turn
          // body keeps running. Catch-and-continue.
        }
        await new Promise((r) => setTimeout(r, 30));
      }
      turnCompleted = true;
    };
    const serverPromise = bootAcpServer(
      { transport: 'unix-socket', socketPath: sockPath },
      { shutdownSignal: shutdownCtrl.signal, runTurn: stubRunTurn },
    );

    await waitForSocket(sockPath);

    const conn = await connectUnixSocket({ path: sockPath });
    const session = await DashboardSession.attach({ conn, cwd: tmp });

    // Start the turn but DON'T await — disconnect mid-stream.
    let firstChunk = '';
    let resolveFirst!: () => void;
    const gotFirst = new Promise<void>((r) => { resolveFirst = r; });
    const sendPromise = session.send({
      userText: 'long task',
      onText: (d: string) => {
        if (firstChunk === '') {
          firstChunk = d;
          resolveFirst();
        }
      },
    });

    await gotFirst;
    expect(firstChunk).toContain('chunk-0');

    // Forcefully disconnect mid-turn.
    await session.close();
    // The send promise will reject because the connection is gone.
    sendPromise.catch(() => { /* expected */ });

    // The daemon's runTurn keeps running. Wait for completion flag.
    await turnCompletedSignal;
    expect(turnCompleted).toBe(true);

    // Daemon still healthy.
    expect(await isUnixSocketAlive(sockPath)).toBe(true);

    shutdownCtrl.abort();
    try { await serverPromise; } catch { /* ignore */ }
  });
});
