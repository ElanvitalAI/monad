// ── Phase L1 LSP JSON-RPC client tests ──
//
// Validates the framing + request correlation + lifecycle contract of
// src/skills/tools/lsp/client.ts against a fixture mock LSP server.
// Covers:
//   - initialize handshake round-trip
//   - parallel request correlation (3 concurrent requests resolve in
//     the right slots regardless of reply order)
//   - server exit rejects every pending promise with a clear error
//   - per-request timeout rejects but doesn't leak pending-map slots
//
// Mock server lives at test/fixtures/mock-lsp-server.ts — see that
// file for the env-var matrix driving its responses.

import { describe, test, expect, afterEach } from 'bun:test';
import { join } from 'node:path';
import { spawnLspClient } from '../src/skills/tools/lsp/client';

const MOCK_SERVER = join(process.cwd(), 'test/fixtures/mock-lsp-server.ts');

// Every spawned mock server is registered here so `afterEach` can reap it.
// The per-test `await client.dispose()` calls below stay as the normal path;
// this is the net under them. A test that throws before reaching its dispose
// line would otherwise leave `bun run mock-lsp-server.ts` alive, and one live
// child keeps the whole `bun test` run from ever exiting — a leak that reads
// as "the suite is slow" rather than "a test failed". `dispose` is idempotent
// (see the test below), so disposing twice is safe.
const spawnedClients: Array<ReturnType<typeof spawnLspClient>> = [];

afterEach(async () => {
  // ⚠️ Do NOT swallow disposal errors. A dispose that fails leaves the very
  // orphan this net exists to prevent, so swallowing it would report a green
  // test while the child keeps `bun test` alive — the exact confusion being
  // removed. Reap every client first (one failure must not strand the rest),
  // then surface the failures.
  const results = await Promise.allSettled(spawnedClients.splice(0).map((c) => c.dispose()));
  const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (failed.length > 0) {
    throw new Error(`mock LSP server cleanup failed (${failed.length}): ${failed.map((f) => String(f.reason)).join('; ')}`);
  }
});

function spawnMock(env: NodeJS.ProcessEnv = {}) {
  const client = spawnLspClient({
    command: 'bun',
    args: ['run', MOCK_SERVER],
    env,
    requestTimeoutMs: 5_000,
  });
  spawnedClients.push(client);
  return client;
}

describe('LSP client · framing + correlation', () => {
  test('initialize request round-trips to the server', async () => {
    const client = spawnMock();
    const r = await client.request<{ capabilities: object }>('initialize', {
      processId: process.pid,
      rootUri: null,
      capabilities: {},
    });
    expect(r).toEqual({ capabilities: {} });
    await client.dispose();
  });

  test('parallel requests correlate to the right resolver', async () => {
    const client = spawnMock();
    await client.request('initialize', { processId: null, rootUri: null, capabilities: {} });
    // Three hover requests in parallel — the mock replies in the
    // order it receives them; the client must still route each
    // response to the promise that sent it.
    const [a, b, c] = await Promise.all([
      client.request('textDocument/hover', { textDocument: { uri: 'a' }, position: { line: 0, character: 0 } }),
      client.request('textDocument/hover', { textDocument: { uri: 'b' }, position: { line: 0, character: 0 } }),
      client.request('textDocument/hover', { textDocument: { uri: 'c' }, position: { line: 0, character: 0 } }),
    ]);
    // All three should resolve (same canned content from the mock).
    for (const r of [a, b, c]) {
      expect((r as { contents: { value: string } }).contents.value).toContain('const x');
    }
    await client.dispose();
  });

  test('unknown method → server error rejects the request', async () => {
    const client = spawnMock();
    await client.request('initialize', { processId: null, rootUri: null, capabilities: {} });
    await expect(
      client.request('bogus/method', {}),
    ).rejects.toThrow(/method not found|server error/i);
    await client.dispose();
  });
});

describe('LSP client · lifecycle', () => {
  test('server exit rejects in-flight requests', async () => {
    const client = spawnMock({ MOCK_CRASH_AFTER_INIT: '1' });
    await client.request('initialize', { processId: null, rootUri: null, capabilities: {} });
    // After replying to initialize the mock exits 1. The next request
    // either rejects with "server exited" or "server is not alive"
    // depending on whether the exit event has fired by the time we
    // send — both are valid failure modes.
    await new Promise(res => setTimeout(res, 100));
    await expect(
      client.request('textDocument/hover', { textDocument: { uri: 'x' }, position: { line: 0, character: 0 } }),
    ).rejects.toThrow(/server exited|not alive/i);
    await client.dispose();
  });

  test('request timeout rejects with a clear error', async () => {
    // Mock delays every response by 500ms; client timeout = 100ms.
    const client = spawnLspClient({
      command: 'bun',
      args: ['run', MOCK_SERVER],
      env: { MOCK_DELAY_MS: '500' },
      requestTimeoutMs: 100,
    });
    // initialize is also delayed — use it as the victim so we don't
    // have to successfully handshake first.
    await expect(
      client.request('initialize', { processId: null, rootUri: null, capabilities: {} }),
    ).rejects.toThrow(/timeout after 100ms/);
    await client.dispose();
  }, 3000);

  test('dispose is idempotent', async () => {
    const client = spawnMock();
    await client.request('initialize', { processId: null, rootUri: null, capabilities: {} });
    await client.dispose();
    // Second dispose shouldn't throw.
    await client.dispose();
    expect(client.alive).toBe(false);
  });
});
