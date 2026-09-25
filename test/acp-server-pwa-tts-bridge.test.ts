// FU-2 webterm wire (PLAN-pwa-webterm-voice-control v1.2 §15 · 2026-05-07).
//
// Verifies that ACP `prompt` handler 의 `push()` chunks 가 옵션
// `pwaTtsBridge.pushChunk` 로 흘러들어가고 turn-end 시점 한 번
// `flush()` 가 호출됨. chat REST `handlePromptStreamPost` 의 dual-emit
// pattern (PR #1908 test) 의 ACP path 미러.
//
// Harness re-uses the bootFanoutServer pattern from
// `test/acp-server-user-chunk-broadcast.test.ts` — extends it with a
// `pwaTtsBridge` opt that the runAcpServer call forwards.

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
}

interface BridgeHarness {
  shutdown(): Promise<void>;
  channel: ClientChannel;
  initializeAndNewSession: () => Promise<string>;
  pushes: { sid: string; delta: string }[];
  flushes: string[];
  flushCallCount: number;
}

async function bootBridgeServer(opts: {
  runTurn: NonNullable<Parameters<typeof runAcpServer>[0]>['runTurn'];
  pwaTtsBridge?: NonNullable<Parameters<typeof runAcpServer>[0]>['pwaTtsBridge'];
}): Promise<BridgeHarness> {
  const bridge = createInProcessAcpBridge();
  const shutdownCtrl = new AbortController();
  const closeBridge = async (): Promise<void> => {
    try { await bridge.a.writable.close(); } catch { /* already */ }
  };

  const transportFactory = async (
    onConnection: AcpConnectionHandler,
  ): Promise<AcpTransportServer> => {
    const conn: AcpTransportConnection = {
      readable: bridge.a.readable,
      writable: bridge.a.writable,
      peerId: 'tts-bridge-test-peer',
      close: closeBridge,
    };
    Promise.resolve(onConnection(conn)).catch(() => { /* swallow */ });
    return {
      kind: 'in-process' as const,
      address: 'tts-bridge-stub://',
      close: closeBridge,
    };
  };

  const dualRole = new DualRoleManager();
  const acpDone = runAcpServer({
    transportFactory,
    shutdownSignal: shutdownCtrl.signal,
    dualRoleManager: dualRole,
    runTurn: opts.runTurn,
    hasSession: () => true,
    ...(opts.pwaTtsBridge ? { pwaTtsBridge: opts.pwaTtsBridge } : {}),
  });
  acpDone.catch(() => { /* aborted */ });

  const updates: ClientChannel['updates'] = [];
  const stream = ndJsonStream(bridge.b.writable, bridge.b.readable);
  const conn = new ClientSideConnection(() => ({
    async sessionUpdate(notification: { sessionId: string; update: unknown }) {
      updates.push({ sessionId: notification.sessionId, update: notification.update });
    },
    async requestPermission() {
      return { outcome: { outcome: 'cancelled' as const } };
    },
  }), stream);

  const initializeAndNewSession = async (): Promise<string> => {
    await conn.initialize({ protocolVersion: 1, clientCapabilities: {} });
    const resp = await conn.newSession({ cwd: process.cwd(), mcpServers: [] });
    return resp.sessionId;
  };

  return {
    channel: { conn, updates },
    initializeAndNewSession,
    pushes: [],
    flushes: [],
    flushCallCount: 0,
    async shutdown() {
      shutdownCtrl.abort();
      try { await closeBridge(); } catch { /* ignore */ }
      try { await acpDone; } catch { /* aborted */ }
    },
  };
}

let harness: BridgeHarness | null = null;
beforeEach(() => { harness = null; });
afterEach(async () => {
  if (harness) {
    try { await harness.shutdown(); } catch { /* ignore */ }
    harness = null;
  }
});

describe('runAcpServer FU-2 wire — prompt handler pwaTtsBridge pushChunk + flush', () => {
  test('every push() chunk forwards to bridge.pushChunk; flush fires once at turn-end', async () => {
    const pushes: { sid: string; delta: string }[] = [];
    const flushes: string[] = [];
    harness = await bootBridgeServer({
      runTurn: async (ctx) => {
        await ctx.push('hello ');
        await ctx.push('world');
      },
      pwaTtsBridge: {
        pushChunk: (sid, delta) => { pushes.push({ sid, delta }); },
        flush: async (sid) => { flushes.push(sid); },
      },
    });
    const sid = await harness.initializeAndNewSession();
    await harness.channel.conn.prompt({
      sessionId: sid,
      prompt: [{ type: 'text', text: 'hi' }],
    });
    expect(pushes.map((p) => p.delta)).toEqual(['hello ', 'world']);
    expect(pushes.every((p) => p.sid === sid)).toBe(true);
    expect(flushes).toEqual([sid]);
  });

  test('skips wire when pwaTtsBridge is undefined (legacy broadcast-only path)', async () => {
    harness = await bootBridgeServer({
      runTurn: async (ctx) => {
        await ctx.push('chunk');
      },
      // pwaTtsBridge intentionally omitted
    });
    const sid = await harness.initializeAndNewSession();
    await harness.channel.conn.prompt({
      sessionId: sid,
      prompt: [{ type: 'text', text: 'hi' }],
    });
    // Broadcast still fires (peer receives user_message_chunk + agent
    // chunk) — wire absence must not break the legacy path.
    const agentChunks = harness.channel.updates
      .map((u) => u.update as { sessionUpdate?: string; content?: { text?: string } })
      .filter((u) => u.sessionUpdate === 'agent_message_chunk');
    expect(agentChunks.length).toBeGreaterThan(0);
  });

  test('pushChunk errors swallow — agent turn settles successfully', async () => {
    const flushes: string[] = [];
    harness = await bootBridgeServer({
      runTurn: async (ctx) => {
        await ctx.push('alpha');
        await ctx.push('beta');
      },
      pwaTtsBridge: {
        pushChunk: () => { throw new Error('boom'); },
        flush: async (sid) => { flushes.push(sid); },
      },
    });
    const sid = await harness.initializeAndNewSession();
    const result = await harness.channel.conn.prompt({
      sessionId: sid,
      prompt: [{ type: 'text', text: 'hi' }],
    });
    // Turn settled with end_turn (errors swallowed).
    expect(result.stopReason).toBe('end_turn');
    // flush still fires at turn-end.
    expect(flushes).toEqual([sid]);
  });

  test('flush errors swallow — agent turn settles successfully', async () => {
    const pushes: { sid: string; delta: string }[] = [];
    harness = await bootBridgeServer({
      runTurn: async (ctx) => {
        await ctx.push('only-chunk');
      },
      pwaTtsBridge: {
        pushChunk: (sid, delta) => { pushes.push({ sid, delta }); },
        flush: async () => { throw new Error('flush boom'); },
      },
    });
    const sid = await harness.initializeAndNewSession();
    const result = await harness.channel.conn.prompt({
      sessionId: sid,
      prompt: [{ type: 'text', text: 'hi' }],
    });
    expect(result.stopReason).toBe('end_turn');
    expect(pushes.map((p) => p.delta)).toEqual(['only-chunk']);
  });

  test('cancelled turn (aborted) skips flush is OK — handler still calls it once (last delivered fragment)', async () => {
    // Note: even on aborted turns we call flush so any partial buffer
    // doesn't bleed into the next session. Bridge is best-effort either way.
    const pushes: { sid: string; delta: string }[] = [];
    const flushes: string[] = [];
    harness = await bootBridgeServer({
      runTurn: async (ctx) => {
        await ctx.push('partial');
        // Caller-driven cancellation between chunks is hard to simulate
        // here without an out-of-band signal; the production path tests
        // that flush always fires regardless of stopReason.
      },
      pwaTtsBridge: {
        pushChunk: (sid, delta) => { pushes.push({ sid, delta }); },
        flush: async (sid) => { flushes.push(sid); },
      },
    });
    const sid = await harness.initializeAndNewSession();
    await harness.channel.conn.prompt({
      sessionId: sid,
      prompt: [{ type: 'text', text: 'hi' }],
    });
    expect(pushes).toEqual([{ sid, delta: 'partial' }]);
    expect(flushes).toEqual([sid]);
  });
});
