// ── B 트랙 Post-Closure — MCP `tools/call` PFC capture seam ──
//
// `handleMcpRequest` must emit a `system.mcp.proxy_call` user-intent
// event for every dispatch when the caller supplies an `origin` tag.
// Mirrors the dispatch-emit DI test pattern (`test/dispatch/dispatch-emit.test.ts`).

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { handleMcpRequest, emitProxyCallIntent } from '../src/mcp/server';
import { registerAllDefaultToolRuntimes } from '../src/tool-runtime/index';
import { _resetToolRuntimeRegistryForTest } from '../src/tool-runtime/registry';
import { setPtyAdapterForTesting, resetForTesting } from '../src/pty-shell/registry';
import { _resetUserIntentLogger } from '../src/user-intent/logger';
import type { UserIntentEvent } from '../src/user-intent/types';

function fakePtyAdapter() {
  setPtyAdapterForTesting(() => ({
    pid: 1, write: () => {}, kill: () => {},
    onData: () => ({ dispose: () => {} }),
    onExit: () => ({ dispose: () => {} }),
  }));
}

let intentEvents: UserIntentEvent[];

beforeEach(() => {
  _resetToolRuntimeRegistryForTest();
  resetForTesting();
  fakePtyAdapter();
  registerAllDefaultToolRuntimes();
  const intent = _resetUserIntentLogger();
  intentEvents = [];
  intent.setSinks([{
    name: 'capture',
    write: (ev) => { intentEvents.push(ev); },
  }]);
});

afterEach(() => {
  _resetToolRuntimeRegistryForTest();
  resetForTesting();
  setPtyAdapterForTesting(null);
  _resetUserIntentLogger();
});

describe('handleMcpRequest tools/call · PFC capture seam', () => {
  test('emits system.mcp.proxy_call on success with origin tag', async () => {
    await handleMcpRequest({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'GetDashboardState', arguments: {} },
    }, { origin: 'mcp-http' });
    expect(intentEvents).toHaveLength(1);
    const ev = intentEvents[0]!;
    expect(ev.intent.kind).toBe('system.mcp.proxy_call');
    expect(ev.intent.layer).toBe('system');
    expect(ev.intent.target).toEqual({ kind: 'tool', id: 'GetDashboardState' });
    expect((ev.intent.value as { origin: string }).origin).toBe('mcp-http');
    expect(ev.outcome?.success).toBe(true);
    expect(ev.outcome?.error_kind).toBeUndefined();
  });

  test('emits success:false with error_kind=unknown_tool when name missing', async () => {
    await handleMcpRequest({
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'NoSuchTool', arguments: {} },
    }, { origin: 'mcp-stdio' });
    expect(intentEvents).toHaveLength(1);
    const ev = intentEvents[0]!;
    expect(ev.intent.target).toEqual({ kind: 'tool', id: 'NoSuchTool' });
    expect((ev.intent.value as { origin: string }).origin).toBe('mcp-stdio');
    expect(ev.outcome?.success).toBe(false);
    expect(ev.outcome?.error_kind).toBe('unknown_tool');
  });

  test('skips emit when origin is absent (backward compat)', async () => {
    await handleMcpRequest({
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: 'GetDashboardState', arguments: {} },
    });
    expect(intentEvents).toHaveLength(0);
  });

  test('all three transport origins are accepted by emitter', () => {
    emitProxyCallIntent('a.b', 'mcp-http', true);
    emitProxyCallIntent('a.b', 'mcp-stdio', true);
    emitProxyCallIntent('a.b', 'rest', true);
    expect(intentEvents).toHaveLength(3);
    expect(intentEvents.map((e) => (e.intent.value as { origin: string }).origin))
      .toEqual(['mcp-http', 'mcp-stdio', 'rest']);
  });

  test('tools/list does NOT emit (only tools/call instruments)', async () => {
    await handleMcpRequest({
      jsonrpc: '2.0', id: 4, method: 'tools/list',
    }, { origin: 'mcp-http' });
    expect(intentEvents).toHaveLength(0);
  });
});
