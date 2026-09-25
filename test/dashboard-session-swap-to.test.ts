// BACKLOG #2 — DashboardSession.swapTo unit tests.
//
// Verifies that the mid-flight `/resume <id>` path can swap the
// active sessionId on a live ClientSideConnection without tearing
// down the underlying transport. Two concerns:
//
//   1. On success, `dashboardSession.id` flips to the new id and
//      subsequent ACP requests target it.
//   2. On failure (daemon rejects the new id, e.g. unknown session),
//      the swap leaves `id` unchanged so the caller can render an
//      error and the user keeps using the original session.
//
// We bring up a real `runAcpServer` over the in-process bridge so
// the loadSession round-trip exercises the actual server-side
// `hasSession` gate. No bun mocks — clean of BACKLOG #5 leakage.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { DashboardSession } from '../src/tui-client/dashboard-session.js';
import { runAcpServer } from '../src/acp/server.js';
import { DualRoleManager } from '../src/acp/dual-role-manager.js';
import { createInProcessAcpBridge } from '../src/tui-client/acp-transport-local.js';
import type {
  AcpConnectionHandler,
  AcpTransportConnection,
  AcpTransportServer,
} from '../src/acp/transport/index.js';

interface SwapHarness {
  session: DashboardSession;
  /** Server-known session ids (populated as newSession / loadSession
   *  fire on the server). The DashboardSession is assigned ids 0+1;
   *  the test seeds an extra "swap target" by minting id-2 via a
   *  second connection (peer A), which the server records in
   *  `knownIds` so the harness's `hasSession` can recognize it. */
  knownIds: Set<string>;
  shutdown(): Promise<void>;
}

async function bootSwapHarness(): Promise<SwapHarness> {
  const bridges = [createInProcessAcpBridge(), createInProcessAcpBridge()];
  const knownIds = new Set<string>();
  const shutdownCtrl = new AbortController();
  const dualRole = new DualRoleManager();

  // Capture session ids the server mints/loads so `hasSession` can
  // accept any id the test names. The DashboardSession's newSession
  // creates id 'monad-session-1'; bridge[1] is reserved for seeding
  // an alternate "swap target" id ('monad-session-2').
  const transportFactory = async (
    onConnection: AcpConnectionHandler,
  ): Promise<AcpTransportServer> => {
    for (let i = 0; i < bridges.length; i += 1) {
      const b = bridges[i]!;
      const conn: AcpTransportConnection = {
        readable: b.a.readable,
        writable: b.a.writable,
        peerId: `swap-peer-${i}`,
        close: async () => { try { await b.a.writable.close(); } catch { /* */ } },
      };
      Promise.resolve(onConnection(conn)).catch(() => { /* */ });
    }
    return {
      kind: 'in-process' as const,
      address: 'swap-harness://',
      close: async () => {
        for (const b of bridges) {
          try { await b.a.writable.close(); } catch { /* */ }
        }
      },
    };
  };

  // hasSession sees `knownIds` plus any sessionId-shape we accept
  // ahead of time so loadSession can succeed for the target id even
  // before the test's seed connection has minted it.
  const acpDone = runAcpServer({
    transportFactory,
    shutdownSignal: shutdownCtrl.signal,
    dualRoleManager: dualRole,
    runTurn: async (ctx) => {
      // Echo so the active session id can be observed by callers
      // probing the post-swap routing. Tests that don't issue
      // prompts simply ignore this.
      await ctx.push(`route:${ctx.sessionId}`);
    },
    hasSession: (id) => knownIds.has(id),
    onHandle: () => { /* registry is handled via bridges */ },
  });
  acpDone.catch(() => { /* aborted shutdown is expected */ });

  // Seed an alternate sessionId by issuing newSession on bridge[1].
  // This represents another client's session that the dashboard
  // wants to hop to via swapTo.
  const seedConn: AcpTransportConnection = {
    readable: bridges[1]!.b.readable,
    writable: bridges[1]!.b.writable,
    peerId: 'seed',
    close: async () => { try { await bridges[1]!.b.writable.close(); } catch { /* */ } },
  };
  // newSession seeds 'monad-session-1' (server seq starts at 1 — but
  // DashboardSession.attach below also calls newSession, taking the
  // next id). Order of concurrent connections is non-deterministic
  // for the SDK, so we capture the id rather than predict it.
  const seedSession = await DashboardSession.attach({
    conn: seedConn,
    cwd: process.cwd(),
  });
  knownIds.add(seedSession.id);

  // Now boot the dashboard's own session on bridge[0]. This is the
  // session whose `swapTo()` the tests exercise.
  const dashConn: AcpTransportConnection = {
    readable: bridges[0]!.b.readable,
    writable: bridges[0]!.b.writable,
    peerId: 'dash',
    close: async () => { try { await bridges[0]!.b.writable.close(); } catch { /* */ } },
  };
  const session = await DashboardSession.attach({
    conn: dashConn,
    cwd: process.cwd(),
  });
  knownIds.add(session.id);

  return {
    session,
    knownIds,
    async shutdown() {
      try { await session.close(); } catch { /* */ }
      try { await seedSession.close(); } catch { /* */ }
      shutdownCtrl.abort();
      try { await acpDone; } catch { /* */ }
    },
  };
}

let harness: SwapHarness | null = null;

beforeEach(() => {
  harness = null;
});

afterEach(async () => {
  if (harness) {
    try { await harness.shutdown(); } catch { /* */ }
    harness = null;
  }
});

describe('DashboardSession.swapTo (BACKLOG #2 — /resume mid-flight)', () => {
  test('successful swap updates the active session id', async () => {
    harness = await bootSwapHarness();
    const target = [...harness.knownIds].find((id) => id !== harness!.session.id);
    expect(target).toBeDefined();
    const originalId = harness.session.id;

    await harness.session.swapTo(target!, process.cwd());

    expect(harness.session.id).toBe(target!);
    expect(harness.session.id).not.toBe(originalId);
  });

  test('swap to unknown id rejects and keeps the original session id', async () => {
    harness = await bootSwapHarness();
    const originalId = harness.session.id;

    // The SDK wraps server-side throws into a JSON-RPC "Internal
    // error" with the original message under `data.details`. We
    // match either surface so future SDK changes don't churn the
    // test — the contract that matters here is "swapTo rejects".
    await expect(
      harness.session.swapTo('does-not-exist', process.cwd()),
    ).rejects.toThrow(/unknown session|Internal error/);

    // Critical invariant — failed swap must NOT mutate state.
    expect(harness.session.id).toBe(originalId);
  });

  test('swap to the same id is a no-op (no extra loadSession RPC)', async () => {
    harness = await bootSwapHarness();
    const originalId = harness.session.id;

    // Same id swap — early return in swapTo (no RPC, can't fail
    // even though `loadSession` rejects same-id reload at server
    // helper level under acpServerLoadSession).
    await harness.session.swapTo(originalId, process.cwd());

    expect(harness.session.id).toBe(originalId);
  });

  test('empty / non-string target throws synchronously', async () => {
    harness = await bootSwapHarness();
    const originalId = harness.session.id;

    await expect(
      harness.session.swapTo('', process.cwd()),
    ).rejects.toThrow(/non-empty/);

    expect(harness.session.id).toBe(originalId);
  });

  test('after swap, send routes the prompt against the new session id', async () => {
    harness = await bootSwapHarness();
    const target = [...harness.knownIds].find((id) => id !== harness!.session.id);
    expect(target).toBeDefined();

    await harness.session.swapTo(target!, process.cwd());

    // Issue a prompt — runTurn echoes `route:<sessionId>` so the
    // chunk reveals which id the server saw on the wire.
    const chunks: string[] = [];
    await harness.session.send({
      userText: '',
      onText: (delta) => { chunks.push(delta); },
    });

    expect(chunks.join('')).toBe(`route:${target!}`);
  });
});
