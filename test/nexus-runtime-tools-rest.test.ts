// ── B 트랙 Post-Closure — REST shim for the ToolRuntime registry ──
//
// `GET /v1/tools/runtime` + `POST /v1/tools/<id>/call` expose the
// in-process ToolRuntime registry to non-MCP callers (iOS Shortcuts ·
// shell · n8n · webhook receivers). Both share the PFC capture seam
// with the JSON-RPC transport via `emitProxyCallIntent`.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  handleRuntimeToolsList,
  handleRuntimeToolCall,
  parseRuntimeToolCallPath,
  type MetaApiOpts,
} from '../src/nexus/api/meta-api';
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

const OPEN_OPTS: MetaApiOpts = { noAuth: true };

let intentEvents: UserIntentEvent[];

beforeEach(() => {
  _resetToolRuntimeRegistryForTest();
  resetForTesting();
  fakePtyAdapter();
  registerAllDefaultToolRuntimes();
  const intent = _resetUserIntentLogger();
  intentEvents = [];
  intent.setSinks([{ name: 'capture', write: (ev) => { intentEvents.push(ev); } }]);
});

afterEach(() => {
  _resetToolRuntimeRegistryForTest();
  resetForTesting();
  setPtyAdapterForTesting(null);
  _resetUserIntentLogger();
});

describe('parseRuntimeToolCallPath', () => {
  test('extracts id from /v1/tools/<id>/call', () => {
    expect(parseRuntimeToolCallPath('/v1/tools/GetDashboardState/call'))
      .toBe('GetDashboardState');
  });

  test('preserves dotted ids (proxy MCP tool naming)', () => {
    expect(parseRuntimeToolCallPath('/v1/tools/xcode.build_target/call'))
      .toBe('xcode.build_target');
  });

  test('returns null when /call suffix missing', () => {
    expect(parseRuntimeToolCallPath('/v1/tools/Foo')).toBeNull();
    expect(parseRuntimeToolCallPath('/v1/tools/Foo/list')).toBeNull();
  });

  test('returns null for /v1/tools and /v1/tools/runtime (siblings)', () => {
    expect(parseRuntimeToolCallPath('/v1/tools')).toBeNull();
    expect(parseRuntimeToolCallPath('/v1/tools/runtime')).toBeNull();
  });

  test('returns null when id contains slash (nested paths)', () => {
    expect(parseRuntimeToolCallPath('/v1/tools/a/b/call')).toBeNull();
  });
});

describe('handleRuntimeToolsList · GET /v1/tools/runtime', () => {
  test('returns full registry shaped with id/surfaces/description/inputSchema', async () => {
    const req = new Request('http://x/v1/tools/runtime');
    const url = new URL(req.url);
    const res = handleRuntimeToolsList(req, OPEN_OPTS, url);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tools: Array<Record<string, unknown>> };
    expect(Array.isArray(body.tools)).toBe(true);
    expect(body.tools.length).toBeGreaterThan(0);
    const first = body.tools[0]!;
    expect(typeof first.id).toBe('string');
    expect('inputSchema' in first).toBe(true);
  });

  test('?surface=mcp filters to mcp-surfaced runtimes', async () => {
    const req = new Request('http://x/v1/tools/runtime?surface=mcp');
    const url = new URL(req.url);
    const res = handleRuntimeToolsList(req, OPEN_OPTS, url);
    const body = (await res.json()) as { tools: Array<{ id: string }> };
    const ids = body.tools.map((t) => t.id);
    // Canonical registry ids are snake_case; the LLM-facing
    // PascalCase aliases (GetDashboardState · PtyShellList) resolve
    // via getToolRuntime when REST callers prefer them, but the
    // listing returns the canonical id.
    expect(ids).toContain('dashboard_state');
    expect(ids).toContain('pty_shell_list');
    // Mutating tools must not be surfaced on the mcp filter.
    expect(ids).not.toContain('bash');
    expect(ids).not.toContain('pty_shell_start');
  });

  test('rejects unauth when bearerToken set and Authorization missing', () => {
    const req = new Request('http://x/v1/tools/runtime');
    const url = new URL(req.url);
    const res = handleRuntimeToolsList(req, { bearerToken: 'secret' }, url);
    expect(res.status).toBe(401);
  });
});

describe('handleRuntimeToolCall · POST /v1/tools/<id>/call', () => {
  test('dispatches success and emits PFC intent with origin=rest', async () => {
    const req = new Request('http://x/v1/tools/GetDashboardState/call', {
      method: 'POST',
      body: JSON.stringify({ args: {} }),
      headers: { 'content-type': 'application/json' },
    });
    const res = await handleRuntimeToolCall(req, OPEN_OPTS, 'GetDashboardState');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; result: unknown };
    expect(body.ok).toBe(true);
    expect(body.result).toBeTruthy();
    expect(intentEvents).toHaveLength(1);
    expect(intentEvents[0]!.intent.kind).toBe('system.mcp.proxy_call');
    expect((intentEvents[0]!.intent.value as { origin: string }).origin).toBe('rest');
    expect(intentEvents[0]!.outcome?.success).toBe(true);
  });

  test('unknown tool → 404 with error_kind unknown_tool intent', async () => {
    const req = new Request('http://x/v1/tools/NoSuchTool/call', {
      method: 'POST', body: '{}', headers: { 'content-type': 'application/json' },
    });
    const res = await handleRuntimeToolCall(req, OPEN_OPTS, 'NoSuchTool');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(false);
    expect(intentEvents).toHaveLength(1);
    expect(intentEvents[0]!.outcome?.error_kind).toBe('unknown_tool');
  });

  test('malformed JSON body returns 400', async () => {
    const req = new Request('http://x/v1/tools/whatever/call', {
      method: 'POST', body: 'not json', headers: { 'content-type': 'application/json' },
    });
    const res = await handleRuntimeToolCall(req, OPEN_OPTS, 'whatever');
    expect(res.status).toBe(400);
  });

  test('body without args defaults to empty object (still dispatches)', async () => {
    const req = new Request('http://x/v1/tools/GetDashboardState/call', {
      method: 'POST', body: '{}', headers: { 'content-type': 'application/json' },
    });
    const res = await handleRuntimeToolCall(req, OPEN_OPTS, 'GetDashboardState');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  test('rejects unauth when bearer required', async () => {
    const req = new Request('http://x/v1/tools/GetDashboardState/call', {
      method: 'POST', body: '{}', headers: { 'content-type': 'application/json' },
    });
    const res = await handleRuntimeToolCall(req, { bearerToken: 'secret' }, 'GetDashboardState');
    expect(res.status).toBe(401);
    expect(intentEvents).toHaveLength(0);
  });
});
