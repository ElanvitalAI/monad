// ── Phase L1/L2 LSP dispatch tests ──
//
// Focused unit tests for:
//   - buildLspTool() shape (operations enum, required params,
//     description advertises the five ops without phase leaks)
//   - dispatchLsp input validation (missing params, bad operations,
//     unknown operations)
//   - formatHoverResult: empty / string / MarkedString[] / MarkupContent
//     shapes all flattened to the expected output format
//
// End-to-end dispatch (client + ts-server + ops) is exercised by
// lsp-client.test.ts + lsp-operations-dispatch.test.ts against the
// mock server; this file stays pure / in-memory so it runs in <50ms.

import { describe, test, expect } from 'bun:test';
import {
  buildLspTool, dispatchLsp, formatHoverResult,
} from '../src/skills/tools/lsp/index';

describe('buildLspTool', () => {
  test('shape matches the documented L2 contract', () => {
    const spec = buildLspTool();
    expect(spec.name).toBe('Lsp');
    const params = spec.parameters as {
      properties: Record<string, { enum?: string[] }>;
      required: string[];
    };
    // L2 ships all five ops; L1's hover-only wording is retired.
    expect(params.properties.operation!.enum).toEqual([
      'hover', 'goToDefinition', 'findReferences', 'documentSymbol', 'workspaceSymbol',
    ]);
    // Only `operation` is universally required now — each op has its
    // own required-param set validated at dispatch time.
    expect(params.required).toEqual(['operation']);
    expect(spec.description).toContain('hover');
    expect(spec.description).toContain('goToDefinition');
    expect(spec.description).toContain('findReferences');
    expect(spec.description).toContain('documentSymbol');
    expect(spec.description).toContain('workspaceSymbol');
  });
});

describe('dispatchLsp · input validation', () => {
  test('unknown operation → "not supported" error lists valid ops', async () => {
    await expect(dispatchLsp({ operation: 'mystery' })).rejects.toThrow(
      /not supported.*hover.*workspaceSymbol/s,
    );
  });

  test('missing filePath on hover → clear error', async () => {
    await expect(dispatchLsp({ operation: 'hover', line: 1, character: 1 })).rejects.toThrow(
      /filePath is required/,
    );
  });

  test('missing filePath on goToDefinition → clear error', async () => {
    await expect(dispatchLsp({ operation: 'goToDefinition', line: 1, character: 1 })).rejects.toThrow(
      /filePath is required/,
    );
  });

  test('missing filePath on documentSymbol → clear error', async () => {
    await expect(dispatchLsp({ operation: 'documentSymbol' })).rejects.toThrow(
      /filePath is required/,
    );
  });

  test('missing query on workspaceSymbol → clear error', async () => {
    await expect(dispatchLsp({ operation: 'workspaceSymbol' })).rejects.toThrow(
      /query is required/,
    );
  });

  test('non-numeric line/character → clear error', async () => {
    await expect(
      dispatchLsp({ operation: 'hover', filePath: 'x.ts', line: 'one', character: 1 }),
    ).rejects.toThrow(/must be numeric/);
  });

  test('0-indexed position → 1-indexed error (catches common LLM mistake)', async () => {
    await expect(
      dispatchLsp({ operation: 'hover', filePath: 'x.ts', line: 0, character: 0 }),
    ).rejects.toThrow(/1-indexed/);
  });
});

describe('formatHoverResult', () => {
  const path = '/abs/foo.ts';

  test('null response → "(no info)" marker', () => {
    const r = formatHoverResult(null, path, 10, 20);
    expect(r.output).toContain('/abs/foo.ts:10:20');
    expect(r.output).toContain('(no info)');
    expect(r.numResults).toBe(0);
  });

  test('empty contents → "(no info)" marker', () => {
    const r = formatHoverResult({ contents: '' }, path, 1, 1);
    expect(r.output).toContain('(no info)');
    expect(r.numResults).toBe(0);
  });

  test('string contents flatten to body', () => {
    const r = formatHoverResult({ contents: 'const x: number' }, path, 1, 1);
    expect(r.output).toContain('Hover · /abs/foo.ts:1:1');
    expect(r.output).toContain('const x: number');
    expect(r.numResults).toBe(1);
  });

  test('MarkupContent → value extracted', () => {
    const r = formatHoverResult(
      { contents: { kind: 'markdown', value: '```ts\nfoo()\n```' } },
      path, 5, 3,
    );
    expect(r.output).toContain('foo()');
    expect(r.numResults).toBe(1);
  });

  test('MarkedString[] → joined with blank lines', () => {
    const r = formatHoverResult(
      {
        contents: [
          { language: 'typescript', value: 'function foo(): void' },
          'Does the thing.',
        ],
      },
      path, 2, 4,
    );
    expect(r.output).toContain('function foo(): void');
    expect(r.output).toContain('Does the thing.');
    expect(r.numResults).toBe(1);
  });
});
