// ── Phase L2 LSP end-to-end dispatch tests ──
//
// Exercises the full client + mock-server path for each L2 operation.
// Spawns bun-run mock-lsp-server.ts via spawnLspClient and sends the
// LSP method directly — no typescript-language-server involved.
//
// We don't go through `dispatchLsp` here because that helper hard-
// wires the typescript-language-server adapter. Instead we invoke
// the LSP client with the mock and verify request/response shapes +
// formatter outputs in one sweep.

import { describe, test, expect, afterEach } from 'bun:test';
import { join } from 'node:path';
import { spawnLspClient } from '../src/skills/tools/lsp/client';
import {
  formatLocationList, formatSymbolOutline, formatWorkspaceSymbols,
  type LspLocation, type LspDocumentSymbol, type LspWorkspaceSymbol,
} from '../src/skills/tools/lsp/index';

const MOCK_SERVER = join(process.cwd(), 'test/fixtures/mock-lsp-server.ts');

// See the same net in test/lsp-client.test.ts: a mock server that outlives its
// test keeps `bun test` from exiting, so registration is not optional here.
const spawnedClients: Array<ReturnType<typeof spawnLspClient>> = [];

afterEach(async () => {
  // Same rule as lsp-client.test.ts: a failed dispose leaves the orphan this
  // net exists to prevent, so it must fail the run rather than pass quietly.
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

async function handshake(client: ReturnType<typeof spawnMock>): Promise<void> {
  await client.request('initialize', { processId: null, rootUri: null, capabilities: {} });
  client.notify('initialized', {});
}

describe('L2 · textDocument/definition', () => {
  test('returns Location → formatter renders single row', async () => {
    const client = spawnMock({ MOCK_DEFINITION_LOC: 'file:///abs/target.ts' });
    await handshake(client);
    const response = await client.request<LspLocation | LspLocation[] | null>(
      'textDocument/definition',
      { textDocument: { uri: 'file:///x.ts' }, position: { line: 0, character: 0 } },
    );
    const locs = response ? (Array.isArray(response) ? response : [response]) : [];
    const r = formatLocationList(locs, 'Definition · /x.ts:1:1', 'goToDefinition');
    expect(r.numResults).toBe(1);
    expect(r.output).toContain('/abs/target.ts:43:1');   // 42-0-indexed → 43:1 output
    await client.dispose();
  });

  test('missing → null → formatter shows (no results)', async () => {
    const client = spawnMock();
    await handshake(client);
    const response = await client.request<LspLocation | LspLocation[] | null>(
      'textDocument/definition',
      { textDocument: { uri: 'file:///x.ts' }, position: { line: 0, character: 0 } },
    );
    const locs = response ? (Array.isArray(response) ? response : [response]) : [];
    const r = formatLocationList(locs, 'Definition', 'goToDefinition');
    expect(r.output).toContain('(no results)');
    await client.dispose();
  });
});

describe('L2 · textDocument/references', () => {
  test('5 Location[] → formatter sorts + renders rows', async () => {
    const client = spawnMock({ MOCK_REFERENCE_COUNT: '5' });
    await handshake(client);
    const response = await client.request<LspLocation[] | null>(
      'textDocument/references',
      {
        textDocument: { uri: 'file:///x.ts' },
        position: { line: 0, character: 0 },
        context: { includeDeclaration: true },
      },
    );
    const locs = Array.isArray(response) ? response : [];
    expect(locs).toHaveLength(5);
    const r = formatLocationList(locs, 'References', 'findReferences');
    expect(r.numResults).toBe(5);
    expect(r.output).toContain('5 results');
    expect(r.output).toContain('/mock/ref-1.ts:1:1');
  });

  test('head_limit truncates across client+formatter', async () => {
    const client = spawnMock({ MOCK_REFERENCE_COUNT: '7' });
    await handshake(client);
    const response = await client.request<LspLocation[] | null>(
      'textDocument/references',
      {
        textDocument: { uri: 'file:///x.ts' },
        position: { line: 0, character: 0 },
        context: { includeDeclaration: true },
      },
    );
    const locs = Array.isArray(response) ? response : [];
    const r = formatLocationList(locs, 'References', 'findReferences', {
      headLimit: 3, offset: 0,
    });
    expect(r.output).toContain('showing 1-3');
    expect(r.output).toContain('4 more — offset:3');
    expect(r.truncated).toBe(true);
    await client.dispose();
  });
});

describe('L2 · textDocument/documentSymbol', () => {
  test('hierarchical response with class + methods', async () => {
    const client = spawnMock({ MOCK_SYMBOL_NAMES: 'parse,dispatch,format' });
    await handshake(client);
    const response = await client.request<LspDocumentSymbol[] | null>(
      'textDocument/documentSymbol', { textDocument: { uri: 'file:///x.ts' } },
    );
    const symbols = Array.isArray(response) ? response : [];
    const r = formatSymbolOutline(symbols, '/x.ts');
    expect(r.output).toContain('class MockClass');
    expect(r.output).toContain('method parse');
    expect(r.output).toContain('method dispatch');
    expect(r.output).toContain('method format');
    // Total count = 1 class + its 3 children = 4 symbols.
    expect(r.numResults).toBe(4);
    await client.dispose();
  });

  test('empty documentSymbol response', async () => {
    const client = spawnMock();   // no MOCK_SYMBOL_NAMES
    await handshake(client);
    const response = await client.request<LspDocumentSymbol[] | null>(
      'textDocument/documentSymbol', { textDocument: { uri: 'file:///x.ts' } },
    );
    const r = formatSymbolOutline(Array.isArray(response) ? response : [], '/x.ts');
    expect(r.output).toContain('(no symbols)');
    await client.dispose();
  });
});

describe('L2 · workspace/symbol', () => {
  test('query-filtered list comes through the mock + formatter', async () => {
    const client = spawnMock({
      MOCK_WORKSPACE_SYMBOLS:
        'streamLLM|file:///abs/llm.ts,streamLLMWithTools|file:///abs/llm.ts,unrelated|file:///abs/misc.ts',
    });
    await handshake(client);
    const response = await client.request<LspWorkspaceSymbol[] | null>(
      'workspace/symbol', { query: 'streamLLM' },
    );
    const matches = Array.isArray(response) ? response : [];
    const r = formatWorkspaceSymbols(matches, 'streamLLM');
    // Mock filters on substring; "unrelated" excluded.
    expect(r.numResults).toBe(2);
    expect(r.output).toContain('function streamLLM');
    expect(r.output).toContain('function streamLLMWithTools');
    expect(r.output).not.toContain('unrelated');
    await client.dispose();
  });
});
