// BACKLOG #2.5 — session-level pub/sub fan-out unit tests.
//
// Covers the broadcast-on-sessionUpdate behavior added to
// `src/acp/server.ts`: when two clients hold the same sessionId
// (one via newSession, the other via loadSession), every
// sessionUpdate emitted from a turn — text chunks, tool calls,
// usage envelopes, relay notifies — must reach BOTH clients.
//
// Strategy: bring up a single `runAcpServer` with a custom
// transportFactory that mounts TWO in-process bridges. Each bridge's
// client side gets a ClientSideConnection so the test can observe
// sessionUpdate notifications independently. No bun mock — pure
// transport wiring keeps combined-test runs clean of process-wide
// mock leakage (BACKLOG #5).

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  ClientSideConnection,
  ndJsonStream,
  type ClientCapabilities,
} from '@agentclientprotocol/sdk';

import { runAcpServer, type AcpServerHandle } from '../src/acp/server.js';
import { createInProcessAcpBridge } from '../src/tui-client/acp-transport-local.js';
import type {
  AcpConnectionHandler,
  AcpTransportConnection,
  AcpTransportServer,
} from '../src/acp/transport/index.js';
import { DualRoleManager } from '../src/acp/dual-role-manager.js';

interface ClientChannel {
  conn: ClientSideConnection;
  /** Notifications received via sessionUpdate, in order. */
  updates: Array<{ sessionId: string; update: unknown }>;
  /** Close the underlying bridge writable so the server-side
   *  `agentConn.closed` fires and the peer registry cleans up. */
  disconnect: () => Promise<void>;
}

interface FanoutHarness {
  shutdown(): Promise<void>;
  /** Pending handles registered via opts.onHandle (1 per server-side
   *  AgentSideConnection, in arrival order). */
  serverHandles: AcpServerHandle[];
  /** Channels [0] and [1] for the two clients. */
  channels: ClientChannel[];
  /** Helper — issue an ACP `initialize` + `newSession` from a client
   *  channel. Returns the session id minted by the server. */
  initializeAndNewSession: (
    idx: number,
    caps?: Partial<ClientCapabilities>,
  ) => Promise<string>;
  /** Helper — issue ACP `initialize` + `loadSession` from a client
   *  channel. Caller supplies the existing sessionId. */
  initializeAndLoadSession: (
    idx: number,
    sessionId: string,
    caps?: Partial<ClientCapabilities>,
  ) => Promise<void>;
}

/** Build a `runAcpServer` boot that accepts up to N inbound
 *  connections through a single transportFactory. Each bridge is a
 *  separate in-process pair so ClientSideConnection can be attached
 *  independently per slot. */
async function bootFanoutServer(opts: {
  /** Number of client slots to expose. Each slot gets its own
   *  in-process bridge. */
  numClients: number;
  /** Stub turn handler — must invoke turnCtx.push to exercise
   *  fan-out. */
  runTurn: NonNullable<Parameters<typeof runAcpServer>[0]>['runTurn'];
  /** Mark every sessionId as known so loadSession succeeds. */
  hasSession?: (sessionId: string) => boolean;
  /** Selected model capability advertised by the server initialize response. */
  agentBrand?: NonNullable<Parameters<typeof runAcpServer>[0]>['agentBrand'];
  agentModel?: string;
}): Promise<FanoutHarness> {
  const bridges = Array.from({ length: opts.numClients }, () =>
    createInProcessAcpBridge(),
  );
  const shutdownCtrl = new AbortController();
  const serverHandles: AcpServerHandle[] = [];
  const closes: Array<() => Promise<void>> = bridges.map((b) => async () => {
    try { await b.a.writable.close(); } catch { /* already */ }
  });

  // Custom transport factory: hand each bridge.a to onConnection in
  // order. Mirrors `createInProcessTransportPair` but lifted to N.
  const transportFactory = async (
    onConnection: AcpConnectionHandler,
  ): Promise<AcpTransportServer> => {
    for (let i = 0; i < bridges.length; i += 1) {
      const b = bridges[i]!;
      const conn: AcpTransportConnection = {
        readable: b.a.readable,
        writable: b.a.writable,
        peerId: `fanout-peer-${i}`,
        close: closes[i]!,
      };
      // Fire-and-forget — runAcpServer's handler is a long-lived
      // loop awaiting the SDK's `agentConn.closed`.
      Promise.resolve(onConnection(conn)).catch(() => { /* swallow */ });
    }
    return {
      kind: 'in-process' as const,
      address: 'fanout-stub://',
      close: async () => {
        for (const c of closes) {
          try { await c(); } catch { /* ignore */ }
        }
      },
    };
  };

  // Use a fresh DualRoleManager so the test doesn't pollute the
  // process-wide singleton (or get polluted by previous runs).
  const dualRole = new DualRoleManager();
  const acpDone = runAcpServer({
    transportFactory,
    shutdownSignal: shutdownCtrl.signal,
    dualRoleManager: dualRole,
    runTurn: opts.runTurn,
    ...(opts.agentBrand ? { agentBrand: opts.agentBrand } : {}),
    ...(opts.agentModel ? { agentModel: opts.agentModel } : {}),
    ...(opts.hasSession ? { hasSession: opts.hasSession } : { hasSession: () => true }),
    onHandle: (h) => { serverHandles.push(h); },
  });
  acpDone.catch(() => { /* aborted shutdown is expected */ });

  // Build client channels on each bridge.b side.
  const channels: ClientChannel[] = bridges.map((b, i) => {
    const updates: ClientChannel['updates'] = [];
    const stream = ndJsonStream(b.b.writable, b.b.readable);
    const conn = new ClientSideConnection(() => ({
      async sessionUpdate(notification: { sessionId: string; update: unknown }) {
        updates.push({ sessionId: notification.sessionId, update: notification.update });
      },
      async requestPermission() {
        // Test stub — auto-cancel any approval prompt.
        return { outcome: { outcome: 'cancelled' as const } };
      },
      // writeTextFile / readTextFile are optional Client methods —
      // omit them since the test's runTurn never invokes filesystem
      // ops. Avoids type-shape duplication with @agentclientprotocol/sdk.
    }), stream);
    return {
      conn,
      updates,
      disconnect: async () => {
        // Close the client → server stream so the server-side
        // AgentSideConnection notices and fires `.closed`.
        try { await b.b.writable.close(); } catch { /* already */ }
        // Also close server → client so the SDK on this side stops.
        try { await b.a.writable.close(); } catch { /* already */ }
        // Bridge index i — strip from disposers so shutdown doesn't
        // double-close.
        closes[i] = async () => { /* already */ };
      },
    };
  });

  const initializeAndNewSession: FanoutHarness['initializeAndNewSession'] = async (
    idx,
    caps,
  ) => {
    const ch = channels[idx]!;
    await ch.conn.initialize({
      protocolVersion: 1,
      clientCapabilities: caps ?? {},
    });
    const resp = await ch.conn.newSession({
      cwd: process.cwd(),
      mcpServers: [],
    });
    return resp.sessionId;
  };

  const initializeAndLoadSession: FanoutHarness['initializeAndLoadSession'] = async (
    idx,
    sessionId,
    caps,
  ) => {
    const ch = channels[idx]!;
    await ch.conn.initialize({
      protocolVersion: 1,
      clientCapabilities: caps ?? {},
    });
    await ch.conn.loadSession({
      sessionId,
      cwd: process.cwd(),
      mcpServers: [],
    });
  };

  return {
    serverHandles,
    channels,
    initializeAndNewSession,
    initializeAndLoadSession,
    async shutdown() {
      shutdownCtrl.abort();
      for (const c of closes) {
        try { await c(); } catch { /* ignore */ }
      }
      try { await acpDone; } catch { /* aborted */ }
    },
  };
}

/** Pull all `agent_message_chunk` text segments out of a channel's
 *  recorded sessionUpdates, joined in order. */
function chunksOf(channel: ClientChannel, sessionId: string): string {
  return channel.updates
    .filter((u) => u.sessionId === sessionId)
    .map((u) => u.update as { sessionUpdate: string; content?: { text?: string } })
    .filter((u) => u.sessionUpdate === 'agent_message_chunk')
    .map((u) => u.content?.text ?? '')
    .join('');
}

/** Wait for `predicate()` to be true (sub-second polling) — used to
 *  give async sessionUpdate notifications a moment to arrive. */
async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor: predicate did not become true within timeout');
    }
    await new Promise((r) => setTimeout(r, 5));
  }
}

let harness: FanoutHarness | null = null;

beforeEach(() => {
  harness = null;
});

afterEach(async () => {
  if (harness) {
    try { await harness.shutdown(); } catch { /* ignore */ }
    harness = null;
  }
});

describe('runAcpServer — session-level pub/sub fan-out (BACKLOG #2.5)', () => {
  test('initialize advertises the selected model image capability', async () => {
    harness = await bootFanoutServer({
      numClients: 1,
      agentBrand: 'gemini',
      agentModel: 'gemini-3.1-pro',
      runTurn: async () => {},
    });

    const response = await harness.channels[0]!.conn.initialize({
      protocolVersion: 1,
      clientCapabilities: {},
    });
    expect(response.agentCapabilities?.promptCapabilities?.image).toBe(true);
  });

  test('two clients on the same sessionId both receive agent_message_chunk', async () => {
    harness = await bootFanoutServer({
      numClients: 2,
      runTurn: async (turnCtx) => {
        await turnCtx.push(`hello ${turnCtx.userText}`);
      },
    });

    const sid = await harness.initializeAndNewSession(0);
    await harness.initializeAndLoadSession(1, sid);

    await harness.channels[0]!.conn.prompt({
      sessionId: sid,
      prompt: [{ type: 'text', text: 'world' }],
    });

    await waitFor(() =>
      chunksOf(harness!.channels[0]!, sid) === 'hello world' &&
      chunksOf(harness!.channels[1]!, sid) === 'hello world',
    );

    expect(chunksOf(harness.channels[0]!, sid)).toBe('hello world');
    expect(chunksOf(harness.channels[1]!, sid)).toBe('hello world');
  });

  test('disconnecting a peer removes it from the broadcast set', async () => {
    harness = await bootFanoutServer({
      numClients: 2,
      runTurn: async (turnCtx) => {
        await turnCtx.push(`echo:${turnCtx.userText}`);
      },
    });

    const sid = await harness.initializeAndNewSession(0);
    await harness.initializeAndLoadSession(1, sid);

    // First turn — both should receive.
    await harness.channels[0]!.conn.prompt({
      sessionId: sid,
      prompt: [{ type: 'text', text: 'one' }],
    });
    await waitFor(() =>
      chunksOf(harness!.channels[1]!, sid).includes('echo:one'),
    );

    // Channel 1 disconnects.
    await harness.channels[1]!.disconnect();
    // Give the server a moment to observe `.closed` and clean up.
    await new Promise((r) => setTimeout(r, 30));

    // Second turn — only channel 0 receives.
    await harness.channels[0]!.conn.prompt({
      sessionId: sid,
      prompt: [{ type: 'text', text: 'two' }],
    });
    await waitFor(() =>
      chunksOf(harness!.channels[0]!, sid).includes('echo:two'),
    );

    const ch0 = chunksOf(harness.channels[0]!, sid);
    const ch1 = chunksOf(harness.channels[1]!, sid);
    expect(ch0).toContain('echo:one');
    expect(ch0).toContain('echo:two');
    expect(ch1).toContain('echo:one');
    expect(ch1).not.toContain('echo:two');
  });

  test('a peer that did not loadSession does not receive chunks', async () => {
    harness = await bootFanoutServer({
      numClients: 2,
      runTurn: async (turnCtx) => {
        await turnCtx.push(`x:${turnCtx.userText}`);
      },
    });

    const sid = await harness.initializeAndNewSession(0);
    // Channel 1 initializes but does NOT loadSession on `sid`.
    await harness.channels[1]!.conn.initialize({
      protocolVersion: 1,
      clientCapabilities: {},
    });

    await harness.channels[0]!.conn.prompt({
      sessionId: sid,
      prompt: [{ type: 'text', text: 'alone' }],
    });
    await waitFor(() => chunksOf(harness!.channels[0]!, sid) === 'x:alone');

    expect(chunksOf(harness.channels[0]!, sid)).toBe('x:alone');
    // Channel 1 must NOT have received any update for sid.
    expect(harness.channels[1]!.updates.filter((u) => u.sessionId === sid)).toHaveLength(0);
  });

  test('UI envelope handle.showToast respects per-peer caps gate', async () => {
    harness = await bootFanoutServer({
      numClients: 2,
      runTurn: async () => { /* turn does nothing — handle drives the test */ },
    });

    // Channel 0 declares the showToast UI extension; channel 1 does not.
    // The `_meta.elanous.ui` blob is parsed by `parseElanousUiCapabilities`
    // (src/acp/elanous-extensions.ts) — boolean flags per method.
    const capsWithToast = {
      _meta: { elanous: { ui: { showToast: true } } },
    } as unknown as Partial<ClientCapabilities>;
    const sid = await harness.initializeAndNewSession(0, capsWithToast);
    await harness.initializeAndLoadSession(1, sid /* default caps — no UI */);

    // Wait for both onHandle callbacks to have fired (one per
    // server-side AgentSideConnection).
    await waitFor(() => harness!.serverHandles.length === 2);

    // The connection that minted the session is at server-side index
    // 0; that handle is the one that owns this sessionId from the
    // server's POV. (Either handle would broadcast the same — all
    // handles share the registry.)
    const delivered = await harness.serverHandles[0]!.showToast(sid, {
      id: 'toast-1',
      tone: 'info',
      text: 'hello',
    });

    // Channel 0 had caps → received; channel 1 did not.
    expect(delivered).toBe(true);
    await waitFor(() =>
      harness!.channels[0]!.updates.some((u) =>
        u.sessionId === sid &&
        (u.update as { sessionUpdate: string }).sessionUpdate === 'agent_thought_chunk',
      ),
    );
    expect(
      harness.channels[0]!.updates.some(
        (u) => u.sessionId === sid &&
          (u.update as { sessionUpdate: string }).sessionUpdate === 'agent_thought_chunk',
      ),
    ).toBe(true);
    expect(
      harness.channels[1]!.updates.filter((u) => u.sessionId === sid),
    ).toHaveLength(0);
  });

  test('a single failing peer does not stop delivery to other peers', async () => {
    harness = await bootFanoutServer({
      numClients: 2,
      runTurn: async (turnCtx) => {
        await turnCtx.push('payload');
      },
    });

    const sid = await harness.initializeAndNewSession(0);
    await harness.initializeAndLoadSession(1, sid);

    // Wedge channel 1's sessionUpdate handler so it throws. Note: the
    // ClientSideConnection itself can't be re-bound after construction,
    // so the cleanest way to simulate "this peer's wire is broken" is
    // to abort its bridge mid-flight and observe channel 0 still
    // receives. We do that by closing channel 1's writable just
    // before firing the prompt.
    await harness.channels[1]!.disconnect();
    // Brief settle so the server observes channel 1's closure and
    // prunes it from sessionPeers — the registry now has a single
    // peer (channel 0). Even if cleanup were to lag, the broadcast
    // would call sessionUpdate on the dead peer — Promise.allSettled
    // swallows the rejection and channel 0's delivery still completes.
    await new Promise((r) => setTimeout(r, 20));

    const promptResult = await harness.channels[0]!.conn.prompt({
      sessionId: sid,
      prompt: [{ type: 'text', text: 'p' }],
    });
    expect(promptResult.stopReason).toBe('end_turn');

    await waitFor(() => chunksOf(harness!.channels[0]!, sid).includes('payload'));
    expect(chunksOf(harness.channels[0]!, sid)).toContain('payload');
  });
});
