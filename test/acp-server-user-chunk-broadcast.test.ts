// Tier 1 Phase 3 양방향 sync · PR 3 · user_message_chunk broadcast tests.
//
// Reuses the bootFanoutServer harness pattern from acp-server-fanout
// (PR #831). Two clients attach to the same sessionId; client A
// sends a prompt; client B (and A) should receive a
// `user_message_chunk` notification with the prompt text in addition
// to the assistant's `agent_message_chunk` stream.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  ClientSideConnection,
  ndJsonStream,
} from '@agentclientprotocol/sdk';

import { runAcpServer } from '../src/acp/server.js';
import { createInProcessAcpBridge } from '../src/tui-client/acp-transport-local.js';
import type {
  AcpConnectionHandler,
  AcpTransportConnection,
  AcpTransportServer,
} from '../src/acp/transport/index.js';
import { DualRoleManager } from '../src/acp/dual-role-manager.js';

interface ClientChannel {
  conn: ClientSideConnection;
  updates: Array<{ sessionId: string; update: unknown }>;
  disconnect: () => Promise<void>;
}

interface FanoutHarness {
  shutdown(): Promise<void>;
  channels: ClientChannel[];
  initializeAndNewSession: (idx: number) => Promise<string>;
  initializeAndLoadSession: (idx: number, sessionId: string) => Promise<void>;
}

async function bootFanoutServer(opts: {
  numClients: number;
  runTurn: NonNullable<Parameters<typeof runAcpServer>[0]>['runTurn'];
}): Promise<FanoutHarness> {
  const bridges = Array.from({ length: opts.numClients }, () => createInProcessAcpBridge());
  const shutdownCtrl = new AbortController();
  const closes: Array<() => Promise<void>> = bridges.map((b) => async () => {
    try { await b.a.writable.close(); } catch { /* already */ }
  });

  const transportFactory = async (
    onConnection: AcpConnectionHandler,
  ): Promise<AcpTransportServer> => {
    for (let i = 0; i < bridges.length; i += 1) {
      const b = bridges[i]!;
      const conn: AcpTransportConnection = {
        readable: b.a.readable,
        writable: b.a.writable,
        peerId: `user-chunk-peer-${i}`,
        close: closes[i]!,
      };
      Promise.resolve(onConnection(conn)).catch(() => { /* swallow */ });
    }
    return {
      kind: 'in-process' as const,
      address: 'user-chunk-stub://',
      close: async () => {
        for (const c of closes) {
          try { await c(); } catch { /* ignore */ }
        }
      },
    };
  };

  const dualRole = new DualRoleManager();
  const acpDone = runAcpServer({
    transportFactory,
    shutdownSignal: shutdownCtrl.signal,
    dualRoleManager: dualRole,
    runTurn: opts.runTurn,
    hasSession: () => true,
  });
  acpDone.catch(() => { /* aborted */ });

  const channels: ClientChannel[] = bridges.map((b, i) => {
    const updates: ClientChannel['updates'] = [];
    const stream = ndJsonStream(b.b.writable, b.b.readable);
    const conn = new ClientSideConnection(() => ({
      async sessionUpdate(notification: { sessionId: string; update: unknown }) {
        updates.push({ sessionId: notification.sessionId, update: notification.update });
      },
      async requestPermission() {
        return { outcome: { outcome: 'cancelled' as const } };
      },
    }), stream);
    return {
      conn,
      updates,
      disconnect: async () => {
        try { await b.b.writable.close(); } catch { /* already */ }
        try { await b.a.writable.close(); } catch { /* already */ }
        closes[i] = async () => { /* already */ };
      },
    };
  });

  const initializeAndNewSession: FanoutHarness['initializeAndNewSession'] = async (idx) => {
    const ch = channels[idx]!;
    await ch.conn.initialize({ protocolVersion: 1, clientCapabilities: {} });
    const resp = await ch.conn.newSession({ cwd: process.cwd(), mcpServers: [] });
    return resp.sessionId;
  };

  const initializeAndLoadSession: FanoutHarness['initializeAndLoadSession'] = async (idx, sessionId) => {
    const ch = channels[idx]!;
    await ch.conn.initialize({ protocolVersion: 1, clientCapabilities: {} });
    await ch.conn.loadSession({ sessionId, cwd: process.cwd(), mcpServers: [] });
  };

  return {
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

function userChunksOf(channel: ClientChannel, sessionId: string): string[] {
  return channel.updates
    .filter((u) => u.sessionId === sessionId)
    .map((u) => u.update as { sessionUpdate: string; content?: { text?: string } })
    .filter((u) => u.sessionUpdate === 'user_message_chunk')
    .map((u) => u.content?.text ?? '');
}

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor timeout');
    }
    await new Promise((r) => setTimeout(r, 5));
  }
}

let harness: FanoutHarness | null = null;

beforeEach(() => { harness = null; });
afterEach(async () => {
  if (harness) {
    try { await harness.shutdown(); } catch { /* ignore */ }
    harness = null;
  }
});

describe('runAcpServer — user_message_chunk broadcast (Phase 3)', () => {
  test('both clients receive user_message_chunk for an inbound prompt', async () => {
    harness = await bootFanoutServer({
      numClients: 2,
      runTurn: async (turnCtx) => {
        await turnCtx.push(`echo ${turnCtx.userText}`);
      },
    });

    const sid = await harness.initializeAndNewSession(0);
    await harness.initializeAndLoadSession(1, sid);

    await harness.channels[0]!.conn.prompt({
      sessionId: sid,
      prompt: [{ type: 'text', text: 'what is 2+2?' }],
    });

    await waitFor(() =>
      userChunksOf(harness!.channels[0]!, sid).length > 0 &&
      userChunksOf(harness!.channels[1]!, sid).length > 0,
    );

    expect(userChunksOf(harness.channels[0]!, sid)).toContain('what is 2+2?');
    expect(userChunksOf(harness.channels[1]!, sid)).toContain('what is 2+2?');
  });

  test('user_message_chunk is sent BEFORE agent_message_chunk', async () => {
    harness = await bootFanoutServer({
      numClients: 1,
      runTurn: async (turnCtx) => {
        await turnCtx.push(`reply: ${turnCtx.userText}`);
      },
    });

    const sid = await harness.initializeAndNewSession(0);

    await harness.channels[0]!.conn.prompt({
      sessionId: sid,
      prompt: [{ type: 'text', text: 'hello' }],
    });

    // Wait for assistant chunk too.
    await waitFor(() =>
      harness!.channels[0]!.updates.some((u) =>
        (u.update as { sessionUpdate?: string }).sessionUpdate === 'agent_message_chunk',
      ),
    );

    const ordered = harness.channels[0]!.updates
      .filter((u) => u.sessionId === sid)
      .map((u) => (u.update as { sessionUpdate?: string }).sessionUpdate);
    const userIdx = ordered.indexOf('user_message_chunk');
    const agentIdx = ordered.indexOf('agent_message_chunk');
    expect(userIdx).toBeGreaterThanOrEqual(0);
    expect(agentIdx).toBeGreaterThanOrEqual(0);
    expect(userIdx).toBeLessThan(agentIdx);
  });

  test('empty prompt skips the user_message_chunk broadcast', async () => {
    harness = await bootFanoutServer({
      numClients: 1,
      runTurn: async (turnCtx) => {
        await turnCtx.push(`(empty: ${turnCtx.userText.length === 0})`);
      },
    });

    const sid = await harness.initializeAndNewSession(0);
    await harness.channels[0]!.conn.prompt({
      sessionId: sid,
      prompt: [],
    });

    await new Promise((r) => setTimeout(r, 30));
    expect(userChunksOf(harness.channels[0]!, sid)).toEqual([]);
  });
});
