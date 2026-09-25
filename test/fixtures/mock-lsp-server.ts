#!/usr/bin/env bun
// ── Mock LSP server for Phase L1 tests ──
//
// Reads LSP-framed JSON-RPC messages on stdin, writes framed responses
// to stdout. Covers the subset L1's `dispatchLsp` exercises:
//   - initialize  → empty capabilities result (server has no features
//                   declared; L1's client doesn't inspect them)
//   - initialized → no response (notification)
//   - textDocument/didOpen → no response (notification)
//   - textDocument/hover → canned result matching the URI/position the
//                          test sets up (see MOCK_RESPONSES below)
//   - shutdown    → null result
//   - exit        → process.exit(0)
//
// Driven via environment variables so a single fixture covers many
// test scenarios:
//   MOCK_HOVER_MARKDOWN = 'string' → MarkupContent shape, given value
//   MOCK_HOVER_EMPTY    = '1'      → return null (no info at position)
//   MOCK_DELAY_MS       = '<ms>'   → delay every response by N ms
//                                    (exercises client-side timeouts)
//   MOCK_CRASH_AFTER_INIT = '1'   → exit 1 right after initialize
//                                   reply (exercises in-flight reject)

import { Buffer } from 'node:buffer';

const hoverMarkdown = process.env.MOCK_HOVER_MARKDOWN;
const hoverEmpty = process.env.MOCK_HOVER_EMPTY === '1';
const delayMs = Number(process.env.MOCK_DELAY_MS || '0');
const crashAfterInit = process.env.MOCK_CRASH_AFTER_INIT === '1';

// L2 — operation-specific knobs.
// MOCK_DEFINITION_LOC — URI of the single Location to return from
//   textDocument/definition; omit → null.
const definitionTargetUri = process.env.MOCK_DEFINITION_LOC;
// MOCK_REFERENCE_COUNT — how many Location[] rows to fabricate for
//   textDocument/references. 0 / absent → empty array.
const referenceCount = Number(process.env.MOCK_REFERENCE_COUNT || '0');
// MOCK_SYMBOL_NAMES — comma-separated symbol names to return from
//   documentSymbol as top-level Functions at line N (1-indexed).
const symbolNames = (process.env.MOCK_SYMBOL_NAMES || '').split(',').filter(Boolean);
// MOCK_WORKSPACE_SYMBOLS — "name1|uri1,name2|uri2" tuples returned
//   from workspace/symbol regardless of query (caller filters).
const workspaceSymbolsRaw = process.env.MOCK_WORKSPACE_SYMBOLS || '';

let buf = Buffer.alloc(0);

function send(id: number | string | null, body: unknown): void {
  const msg = JSON.stringify(
    id === undefined ? body : { jsonrpc: '2.0', id, ...(body as object) },
  );
  const framed = `Content-Length: ${Buffer.byteLength(msg, 'utf-8')}\r\n\r\n${msg}`;
  process.stdout.write(framed);
}

async function respond(id: number | string | null, payload: unknown): Promise<void> {
  if (delayMs > 0) {
    await new Promise(res => setTimeout(res, delayMs));
  }
  send(id, payload);
}

async function handle(msg: { id?: number | string; method?: string; params?: unknown }): Promise<void> {
  switch (msg.method) {
    case 'initialize':
      await respond(msg.id ?? null, { result: { capabilities: {} } });
      if (crashAfterInit) process.exit(1);
      return;
    case 'initialized':
    case 'textDocument/didOpen':
    case 'textDocument/didClose':
    case 'exit':
      if (msg.method === 'exit') process.exit(0);
      return;
    case 'textDocument/hover':
      if (hoverEmpty) {
        await respond(msg.id ?? null, { result: null });
      } else {
        await respond(msg.id ?? null, {
          result: {
            contents: {
              kind: 'markdown',
              value: hoverMarkdown ?? '```ts\nconst x: number\n```',
            },
          },
        });
      }
      return;
    case 'textDocument/definition': {
      if (!definitionTargetUri) {
        await respond(msg.id ?? null, { result: null });
      } else {
        await respond(msg.id ?? null, {
          result: {
            uri: definitionTargetUri,
            range: { start: { line: 42, character: 0 }, end: { line: 42, character: 10 } },
          },
        });
      }
      return;
    }
    case 'textDocument/references': {
      const refs = Array.from({ length: referenceCount }, (_, i) => ({
        uri: `file:///mock/ref-${i + 1}.ts`,
        range: { start: { line: i, character: 0 }, end: { line: i, character: 5 } },
      }));
      await respond(msg.id ?? null, { result: refs });
      return;
    }
    case 'textDocument/documentSymbol': {
      // Hierarchical DocumentSymbol[] — one top-level Class containing
      // each name as a Method.
      const children = symbolNames.map((name, i) => ({
        name, kind: 6 /* Method */,
        range: { start: { line: i * 2, character: 0 }, end: { line: i * 2 + 1, character: 0 } },
        selectionRange: { start: { line: i * 2, character: 2 }, end: { line: i * 2, character: 2 + name.length } },
      }));
      const result = symbolNames.length > 0 ? [{
        name: 'MockClass', kind: 5 /* Class */,
        range: { start: { line: 0, character: 0 }, end: { line: symbolNames.length * 2, character: 0 } },
        selectionRange: { start: { line: 0, character: 6 }, end: { line: 0, character: 15 } },
        children,
      }] : [];
      await respond(msg.id ?? null, { result });
      return;
    }
    case 'workspace/symbol': {
      const tuples = workspaceSymbolsRaw.split(',').filter(Boolean);
      const qp = msg.params as { query?: string } | undefined;
      const query = (qp?.query ?? '').toLowerCase();
      const matches = tuples
        .map((t) => {
          const [name, uri] = t.split('|');
          return { name: name!, uri: uri! };
        })
        .filter(({ name }) => !query || name.toLowerCase().includes(query))
        .map(({ name, uri }) => ({
          name, kind: 12 /* Function */,
          location: {
            uri,
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: name.length } },
          },
        }));
      await respond(msg.id ?? null, { result: matches });
      return;
    }
    case 'shutdown':
      await respond(msg.id ?? null, { result: null });
      return;
    default:
      // Unknown method — respond with an error so client.request rejects.
      if (msg.id !== undefined) {
        await respond(msg.id, { error: { code: -32601, message: `method not found: ${msg.method}` } });
      }
  }
}

process.stdin.on('data', (chunk: Buffer) => {
  buf = buf.length === 0 ? chunk : Buffer.concat([buf, chunk]);
  for (;;) {
    const sep = buf.indexOf('\r\n\r\n');
    if (sep < 0) return;
    const header = buf.slice(0, sep).toString('utf-8');
    const cl = /Content-Length:\s*(\d+)/i.exec(header);
    if (!cl) { buf = buf.slice(sep + 4); continue; }
    const bodyLen = Number(cl[1]);
    const frameEnd = sep + 4 + bodyLen;
    if (buf.length < frameEnd) return;
    const bodyStr = buf.slice(sep + 4, frameEnd).toString('utf-8');
    buf = buf.slice(frameEnd);
    try {
      const parsed = JSON.parse(bodyStr);
      void handle(parsed);
    } catch {
      // swallow — a malformed frame is the test's problem, not ours
    }
  }
});

process.stdin.on('end', () => process.exit(0));
