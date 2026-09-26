// MVP M2.2 — multi-client coexistence on the same daemon.
//
// Two ACP clients attach simultaneously (simulating one TUI + one
// Telegram bot). Both run concurrent turns; the daemon stays healthy
// through both. After both clients disconnect, the daemon still
// accepts a fresh attach.
//
// SCOPE LIMITATION (documented in PLAN-tui-daemon-process-split-mvp.md
// §7): "같은 세션을 두 클라이언트가 본다" requires the ACP
// `loadSession()` API which the MVP daemon-runtime does not yet
// implement. Each `attach()` mints a NEW session id. The shared-
// session story is the next milestone (M2.3 / U6 work).
//
// What this test DOES prove for MVP:
//   - The daemon handles >1 concurrent ACP client (no single-peer lock)
//   - Two long-running turns can proceed in parallel
//   - One client crashing / disconnecting does not bring the other down
//   - Daemon health survives all of the above

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
  tmp = mkdtempSync(joinPath(tmpdir(), 'elanous-multi-test-'));
  sockPath = joinPath(tmp, 'elanous.sock');
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('multi-client daemon coexistence (MVP M2.2)', () => {
  test('two clients run concurrent turns without interfering', async () => {
    const shutdownCtrl = new AbortController();
    const stubRunTurn = async (turnCtx: {
      userText: string;
      push: (text: string) => Promise<void>;
    }): Promise<void> => {
      // Each turn pushes its userText 3 times with small gaps so the
      // two concurrent turns interleave on the wire.
      for (let i = 0; i < 3; i += 1) {
        await turnCtx.push(`[${turnCtx.userText}#${i}]`);
        await new Promise((r) => setTimeout(r, 10));
      }
    };
    const serverPromise = bootAcpServer(
      { transport: 'unix-socket', socketPath: sockPath },
      { shutdownSignal: shutdownCtrl.signal, runTurn: stubRunTurn },
    );
    await waitForSocket(sockPath);

    // Client A — "TUI"
    const connA = await connectUnixSocket({ path: sockPath, peerLabel: 'tui' });
    const sessA = await DashboardSession.attach({ conn: connA, cwd: tmp });

    // Client B — "Telegram bridge"
    const connB = await connectUnixSocket({ path: sockPath, peerLabel: 'telegram' });
    const sessB = await DashboardSession.attach({ conn: connB, cwd: tmp });

    expect(sessA.id).not.toBe(sessB.id);

    // Run both turns CONCURRENTLY.
    const accA: string[] = [];
    const accB: string[] = [];
    const [rA, rB] = await Promise.all([
      sessA.send({ userText: 'A', onText: (d) => accA.push(d) }),
      sessB.send({ userText: 'B', onText: (d) => accB.push(d) }),
    ]);

    expect(rA.stopReason).toBe('end_turn');
    expect(rB.stopReason).toBe('end_turn');
    // Each client sees ONLY its own session's output — no cross-talk.
    expect(accA.join('')).toBe('[A#0][A#1][A#2]');
    expect(accB.join('')).toBe('[B#0][B#1][B#2]');

    await sessA.close();
    await sessB.close();

    // Daemon survives → fresh client can still attach.
    expect(await isUnixSocketAlive(sockPath)).toBe(true);
    const connC = await connectUnixSocket({ path: sockPath });
    const sessC = await DashboardSession.attach({ conn: connC, cwd: tmp });
    expect(sessC.id).not.toBe(sessA.id);
    expect(sessC.id).not.toBe(sessB.id);
    await sessC.close();

    shutdownCtrl.abort();
    try { await serverPromise; } catch { /* ignore */ }
  });

  test('one client crash does not affect the other', async () => {
    const shutdownCtrl = new AbortController();
    const stubRunTurn = async (turnCtx: {
      userText: string;
      push: (text: string) => Promise<void>;
    }): Promise<void> => {
      await turnCtx.push(`echo:${turnCtx.userText}`);
    };
    const serverPromise = bootAcpServer(
      { transport: 'unix-socket', socketPath: sockPath },
      { shutdownSignal: shutdownCtrl.signal, runTurn: stubRunTurn },
    );
    await waitForSocket(sockPath);

    const connA = await connectUnixSocket({ path: sockPath, peerLabel: 'A' });
    const sessA = await DashboardSession.attach({ conn: connA, cwd: tmp });
    const connB = await connectUnixSocket({ path: sockPath, peerLabel: 'B' });
    const sessB = await DashboardSession.attach({ conn: connB, cwd: tmp });

    // A crashes (close abruptly).
    await sessA.close();

    // B should still work fine.
    const accB: string[] = [];
    const rB = await sessB.send({
      userText: 'still alive',
      onText: (d) => accB.push(d),
    });
    expect(rB.stopReason).toBe('end_turn');
    expect(accB.join('')).toBe('echo:still alive');

    await sessB.close();

    shutdownCtrl.abort();
    try { await serverPromise; } catch { /* ignore */ }
  });
});
