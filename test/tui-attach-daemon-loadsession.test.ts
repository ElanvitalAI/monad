// MVP M2.3 — DashboardSession.attachExisting + cross-client share e2e.
//
// Two scenarios:
//   1. attachExisting on a session id known to the daemon → succeeds
//      and lets the second client prompt with shared history.
//   2. attachExisting on an unknown id → "unknown session" error.
//
// Uses bootAcpServer({transport:'unix-socket'}) + a stub
// `DaemonSessionHistory.has` so we don't need a real LLM.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';

import { bootAcpServer } from '../src/boot/acp-server.js';
import { DaemonSessionHistory } from '../src/boot/daemon-runtime.js';
import {
  appendUserAndBuildMessages,
  appendAssistantMessages,
} from '../src/boot/daemon-history-helper.js';
import { connectUnixSocket } from '../src/tui-client/acp-transport-unix-client.js';
import { DashboardSession } from '../src/tui-client/dashboard-session.js';
import { waitForSocket } from './helpers/wait-for-socket.js';

let tmp: string;
let sockPath: string;

beforeEach(() => {
  tmp = mkdtempSync(joinPath(tmpdir(), 'elanous-loadsession-'));
  sockPath = joinPath(tmp, 'elanous.sock');
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('DashboardSession.attachExisting (cross-client share)', () => {
  test('client B attachExisting reads history from client A', async () => {
    const shutdownCtrl = new AbortController();
    const history = new DaemonSessionHistory();
    // Stub runTurn that surfaces the prior history length so we
    // can verify both clients see the same conversation state.
    const stubRunTurn = async (turnCtx: {
      sessionId: string;
      userText: string;
      push: (text: string) => Promise<void>;
    }): Promise<void> => {
      const msgs = appendUserAndBuildMessages(history, turnCtx.sessionId, turnCtx.userText);
      // Echo the prior message count so the test can verify
      // attachExisting rebuilds context.
      const prior = msgs.length - 1; // exclude the current user msg
      const reply = `seen=${prior}: ${turnCtx.userText}`;
      await turnCtx.push(reply);
      appendAssistantMessages(history, turnCtx.sessionId, [
        { role: 'assistant', content: reply },
      ]);
    };

    const serverPromise = bootAcpServer(
      { transport: 'unix-socket', socketPath: sockPath },
      {
        shutdownSignal: shutdownCtrl.signal,
        runTurn: stubRunTurn,
        hasSession: (id: string): boolean => history.has(id),
      },
    );
    await waitForSocket(sockPath);

    // Client A — newSession + 1 turn.
    const connA = await connectUnixSocket({ path: sockPath });
    const sessA = await DashboardSession.attach({ conn: connA, cwd: tmp });
    const sharedId = sessA.id;
    let aReply = '';
    await sessA.send({
      userText: 'first',
      onText: (delta) => { aReply += delta; },
    });
    expect(aReply).toBe('seen=0: first');
    expect(history.has(sharedId)).toBe(true);
    await sessA.close();

    // Client B — attachExisting(sharedId) + send another prompt.
    const connB = await connectUnixSocket({ path: sockPath });
    const sessB = await DashboardSession.attachExisting({
      sessionId: sharedId,
      conn: connB,
      cwd: tmp,
    });
    expect(sessB.id).toBe(sharedId);
    let bReply = '';
    await sessB.send({
      userText: 'second',
      onText: (delta) => { bReply += delta; },
    });
    // History BEFORE this turn = [user1, asst1] (from client A).
    // appendUserAndBuildMessages appends `second` then returns the
    // full list, so msgs = [user1, asst1, user2] (length 3) and
    // prior = 3 - 1 = 2 (excluding the just-appended user msg).
    expect(bReply).toBe('seen=2: second');

    await sessB.close();
    shutdownCtrl.abort();
    try { await serverPromise; } catch { /* aborted */ }
  });

  test('attachExisting with unknown session id rejects with typed error', async () => {
    const shutdownCtrl = new AbortController();
    const history = new DaemonSessionHistory();
    const serverPromise = bootAcpServer(
      { transport: 'unix-socket', socketPath: sockPath },
      {
        shutdownSignal: shutdownCtrl.signal,
        runTurn: async (ctx) => { await ctx.push(''); },
        hasSession: (id: string): boolean => history.has(id),
      },
    );
    await waitForSocket(sockPath);

    const conn = await connectUnixSocket({ path: sockPath });
    let err: unknown;
    try {
      await DashboardSession.attachExisting({
        sessionId: 'never-existed',
        conn,
        cwd: tmp,
      });
    } catch (e) { err = e; }
    expect(err).toBeDefined();
    // ACP SDK wraps server-side throws as JSON-RPC error responses
    // with shape `{code, message, data: {details}}`. The reason text
    // lives in data.details (or message for some builds).
    const errAny = err as { data?: { details?: string }; message?: string };
    const errText = errAny.data?.details ?? errAny.message ?? String(err);
    expect(errText).toMatch(/unknown session/i);

    shutdownCtrl.abort();
    try { await serverPromise; } catch { /* aborted */ }
  });
});
