// turn/steer → /inject wiring (follow-up A).
//
// Two seams:
//  1. DualRoleManager.clientSessionSteer — routes to agent.steer for
//     steerable backends (codex), returns false otherwise.
//  2. handleAutopilotInject — prefers a live steer, falls back to the
//     FIFO queue when steer is absent / returns false / throws.

import { afterEach, describe, test, expect, beforeEach, mock, spyOn } from 'bun:test';
import { AgentSideConnection, ClientSideConnection, ndJsonStream } from '@agentclientprotocol/sdk';
import { AcpAgent } from '../src/acp/client.js';
import { DualRoleManager } from '../src/acp/dual-role-manager.js';
import { runAcpServer } from '../src/acp/server.js';
import { debug } from '../src/debug/log.js';
import { drainPendingUserInput } from '../src/session/pending-input.js';
import { createInProcessAcpBridge } from '../src/tui-client/acp-transport-local.js';
import type { AcpConnectionHandler, AcpTransportConnection, AcpTransportServer } from '../src/acp/transport/index.js';
import {
  handleAutopilotInject,
  _registerActiveRunForTest,
  _drainInjectionsForTest,
  _resetAutopilotRunsForTest,
} from '../src/nexus/api/autopilot-handler.js';

function makeFakeAgent(withSteer: boolean) {
  const agent: Record<string, unknown> = {
    newSession: mock(async () => `be-${Math.random().toString(36).slice(2, 8)}`),
    prompt: mock(async () => ({ stopReason: 'end_turn' })),
    cancel: mock(async () => {}),
  };
  if (withSteer) agent.steer = mock(async () => true);
  return agent;
}

describe('DualRoleManager · clientSessionSteer', () => {
  test('steerable backend → routes to agent.steer with backendSessionId + text blocks', async () => {
    const mgr = new DualRoleManager();
    const fake = makeFakeAgent(true);
    mgr.__setAgentFactoryForTest(async () => fake as never);
    const rec = await mgr.clientSessionCreate({ backendId: 'codex-app-server' });
    const steered = await mgr.clientSessionSteer({ sessionId: rec.id, message: 'also add tests' });
    expect(steered).toBe(true);
    const steer = fake.steer as ReturnType<typeof mock>;
    expect(steer).toHaveBeenCalledTimes(1);
    const [sid, blocks] = steer.mock.calls[0] as [string, unknown];
    expect(sid).toBe(rec.backendSessionId);
    expect(blocks).toEqual([{ type: 'text', text: 'also add tests' }]);
  });

  test('non-steerable backend (no agent.steer) → false', async () => {
    const mgr = new DualRoleManager();
    mgr.__setAgentFactoryForTest(async () => makeFakeAgent(false) as never);
    const rec = await mgr.clientSessionCreate({ backendId: 'claude' });
    expect(await mgr.clientSessionSteer({ sessionId: rec.id, message: 'x' })).toBe(false);
  });

  test('unknown session → throws', async () => {
    const mgr = new DualRoleManager();
    await expect(mgr.clientSessionSteer({ sessionId: 'acp-cli:nope', message: 'x' })).rejects.toThrow();
  });
});

interface SteerHarness {
  conn: ClientSideConnection;
  shutdown(): Promise<void>;
}

async function bootSteerHarness(): Promise<SteerHarness> {
  const bridge = createInProcessAcpBridge();
  const shutdownCtrl = new AbortController();
  let onConnection: AcpConnectionHandler | null = null;
  const serverDone = runAcpServer({
    transportFactory: async (handler): Promise<AcpTransportServer> => {
      onConnection = handler;
      return {
        kind: 'in-process',
        address: 'steer://test',
        close: async () => {
          try { await bridge.a.writable.close(); } catch { /* already closed */ }
          try { await bridge.b.writable.close(); } catch { /* already closed */ }
        },
      };
    },
    shutdownSignal: shutdownCtrl.signal,
  });
  serverDone.catch(() => { /* shutdown */ });
  const conn = new ClientSideConnection(() => ({
    async sessionUpdate() {},
    async requestPermission() { return { outcome: { outcome: 'cancelled' as const } }; },
  }), ndJsonStream(bridge.b.writable, bridge.b.readable));
  const transport: AcpTransportConnection = {
    readable: bridge.a.readable,
    writable: bridge.a.writable,
    peerId: 'steer-peer',
    close: async () => { try { await bridge.a.writable.close(); } catch { /* closed */ } },
  };
  const handler = onConnection as AcpConnectionHandler | null;
  if (!handler) throw new Error('transport handler was not registered');
  Promise.resolve(handler(transport)).catch(() => { /* shutdown */ });
  return {
    conn,
    async shutdown() {
      shutdownCtrl.abort();
      try { await bridge.b.writable.close(); } catch { /* closed */ }
      try { await serverDone; } catch { /* aborted */ }
    },
  };
}

describe('AcpAgent elanous/session/steer', () => {
  let harness: SteerHarness | null = null;
  let logSpy: ReturnType<typeof spyOn> | null = null;

  afterEach(async () => {
    logSpy?.mockRestore();
    logSpy = null;
    if (harness) await harness.shutdown();
    harness = null;
  });

  test('server accepts a known session, observes acceptance, and its exact key drains the inserted text', async () => {
    harness = await bootSteerHarness();
    const events: Array<{ category: string; event: string; data: unknown }> = [];
    logSpy = spyOn(debug, 'log').mockImplementation((category, event, data) => {
      events.push({ category, event, data });
    });
    await harness.conn.initialize({ protocolVersion: 1, clientCapabilities: {} });
    const { sessionId } = await harness.conn.newSession({ cwd: process.cwd(), mcpServers: [] });
    const response = await harness.conn.extMethod('elanous/session/steer', { sessionId, text: 'turn addition' }) as { accepted: boolean };
    expect(response).toEqual({ accepted: true });
    expect(drainPendingUserInput(sessionId)).toEqual(['turn addition']);
    expect(events).toContainEqual({ category: 'acp.steer', event: 'accepted', data: { sessionId } });
  });

  test('server rejects an unknown session and observes unknown-session', async () => {
    harness = await bootSteerHarness();
    const events: Array<{ category: string; event: string; data: unknown }> = [];
    logSpy = spyOn(debug, 'log').mockImplementation((category, event, data) => {
      events.push({ category, event, data });
    });
    await harness.conn.initialize({ protocolVersion: 1, clientCapabilities: {} });
    await expect(harness.conn.extMethod('elanous/session/steer', { sessionId: 'missing', text: 'x' }))
      .resolves.toEqual({ accepted: false });
    expect(events).toContainEqual({ category: 'acp.steer', event: 'unknown-session', data: { sessionId: 'missing' } });
  });

  test('AcpAgent sends text blocks to the extension and preserves their whitespace', async () => {
    const agent = new AcpAgent({ backendId: 'claude', cwd: process.cwd(), log: () => {} });
    let call: { method: string; params: unknown } | undefined;
    (agent as unknown as { connection: { extMethod(method: string, params: unknown): Promise<unknown> } }).connection = {
      async extMethod(method, params) {
        call = { method, params };
        return { accepted: true };
      },
    };
    await expect(agent.steer('session-a' as never, [{ type: 'text', text: '  first' }, { type: 'text', text: 'second  ' }])).resolves.toBe(true);
    expect(call).toEqual({ method: 'elanous/session/steer', params: { sessionId: 'session-a', text: '  first\nsecond  ' } });
  });

  test('AcpAgent returns false for a real ACP peer that does not register the extension', async () => {
    const bridge = createInProcessAcpBridge();
    const agent = new AcpAgent({ backendId: 'claude', cwd: process.cwd(), log: () => {} });
    (agent as unknown as { connection: ClientSideConnection }).connection = new ClientSideConnection(() => ({
      async sessionUpdate() {},
      async requestPermission() { return { outcome: { outcome: 'cancelled' as const } }; },
    }), ndJsonStream(bridge.a.writable, bridge.a.readable));
    new AgentSideConnection(() => ({
      async initialize() {
        return { protocolVersion: 1, agentCapabilities: {}, agentInfo: { name: 'unsupported-peer', version: '1' } };
      },
      async authenticate() { return {}; },
      async newSession() { return { sessionId: 'peer-session' }; },
      async prompt() { return { stopReason: 'end_turn' as const }; },
      async cancel() {},
    }), ndJsonStream(bridge.b.writable, bridge.b.readable));
    const events: Array<{ category: string; event: string; data: unknown }> = [];
    logSpy = spyOn(debug, 'log').mockImplementation((category, event, data) => {
      events.push({ category, event, data });
    });
    await expect(agent.steer('session-a' as never, [{ type: 'text', text: 'x' }])).resolves.toBe(false);
    expect(events).toContainEqual({ category: 'acp.steer', event: 'unsupported', data: { sessionId: 'session-a' } });
    await bridge.a.writable.close();
    await bridge.b.writable.close();
  });

  test('AcpAgent recognizes structured unknown-method errors but preserves other failures', async () => {
    const agent = new AcpAgent({ backendId: 'claude', cwd: process.cwd(), log: () => {} });
    (agent as unknown as { connection: { extMethod(): Promise<unknown> } }).connection = {
      async extMethod() { throw { code: -32603, message: 'Internal error', data: { details: 'Method not found: elanous/session/steer' } }; },
    };
    await expect(agent.steer('session-a' as never, [{ type: 'text', text: 'x' }])).resolves.toBe(false);
    (agent as unknown as { connection: { extMethod(): Promise<unknown> } }).connection = {
      async extMethod() { throw { code: -32603, message: 'Internal error', data: { details: 'database unavailable' } }; },
    };
    await expect(agent.steer('session-a' as never, [{ type: 'text', text: 'x' }])).rejects.toEqual({ code: -32603, message: 'Internal error', data: { details: 'database unavailable' } });
  });
});

describe('handleAutopilotInject · live steer vs queue', () => {
  beforeEach(() => { _resetAutopilotRunsForTest(); });

  const inject = (runId: string, instruction: string): Promise<Response> =>
    handleAutopilotInject(
      new Request('http://x/inject', { method: 'POST', body: JSON.stringify({ instruction }) }),
      runId,
    );

  test('steer hook succeeds → live-steered, NOT queued', async () => {
    const run = _registerActiveRunForTest('run-1');
    run.steer = async () => true;
    const res = await inject('run-1', 'add tests');
    const body = await res.json() as { steered: boolean };
    expect(body.steered).toBe(true);
    expect(_drainInjectionsForTest('run-1')).toEqual([]);
  });

  test('steer hook returns false → queued (fallback)', async () => {
    const run = _registerActiveRunForTest('run-2');
    run.steer = async () => false;
    const res = await inject('run-2', 'queued-instr');
    expect((await res.json() as { steered: boolean }).steered).toBe(false);
    expect(_drainInjectionsForTest('run-2')).toEqual(['queued-instr']);
  });

  test('no steer hook (generic ACP) → queued', async () => {
    _registerActiveRunForTest('run-3');
    await inject('run-3', 'z');
    expect(_drainInjectionsForTest('run-3')).toEqual(['z']);
  });

  test('steer hook throws → falls back to queue', async () => {
    const run = _registerActiveRunForTest('run-4');
    run.steer = async () => { throw new Error('boom'); };
    await inject('run-4', 'w');
    expect(_drainInjectionsForTest('run-4')).toEqual(['w']);
  });

  test('unknown run → 404', async () => {
    const res = await inject('nope', 'x');
    expect(res.status).toBe(404);
  });
});
