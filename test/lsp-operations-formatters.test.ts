// ── Phase L2 LSP formatter tests (in-memory) ──
//
// Unit-tests the output shapes of formatLocationList, formatSymbolOutline,
// and formatWorkspaceSymbols — purely structural, no server spawned.
// End-to-end dispatch is covered by lsp-operations-dispatch.test.ts.

import { describe, test, expect } from 'bun:test';
import {
  formatLocationList, formatSymbolOutline, formatWorkspaceSymbols,
  LspSymbolKind,
  type LspLocation, type LspDocumentSymbol, type LspSymbolInformation,
  type LspWorkspaceSymbol,
} from '../src/skills/tools/lsp/index';

const loc = (path: string, sl: number, sc: number, el = sl, ec = sc + 5): LspLocation => ({
  uri: `file://${path}`,
  range: {
    start: { line: sl - 1, character: sc - 1 },
    end:   { line: el - 1, character: ec - 1 },
  },
});

describe('formatLocationList (goToDefinition / findReferences)', () => {
  test('empty → (no results) marker', () => {
    const r = formatLocationList([], 'Definition · /x.ts:1:1', 'goToDefinition');
    expect(r.output).toContain('Definition · /x.ts:1:1');
    expect(r.output).toContain('(no results)');
    expect(r.numResults).toBe(0);
  });

  test('single result → path:line:col-line:col row', () => {
    const r = formatLocationList(
      [loc('/target.ts', 45, 1, 45, 30)],
      'Definition · /caller.ts:10:20',
      'goToDefinition',
    );
    expect(r.output).toContain('1 result');
    expect(r.output).toContain('/target.ts:45:1-45:30');
    expect(r.numResults).toBe(1);
  });

  test('multiple results sorted by uri then line', () => {
    const r = formatLocationList(
      [
        loc('/b.ts', 100, 1),
        loc('/a.ts', 50, 1),
        loc('/a.ts', 10, 1),
      ],
      'References',
      'findReferences',
    );
    const lines = r.output.split('\n').filter(Boolean);
    // First body row should be /a.ts:10, second /a.ts:50, third /b.ts:100
    const pathRows = lines.filter(l => l.startsWith('/'));
    expect(pathRows[0]).toContain('/a.ts:10:');
    expect(pathRows[1]).toContain('/a.ts:50:');
    expect(pathRows[2]).toContain('/b.ts:100:');
  });

  test('head_limit truncates + footer offers pagination', () => {
    const locations = Array.from({ length: 10 }, (_, i) => loc(`/f${i}.ts`, i + 1, 1));
    const r = formatLocationList(
      locations,
      'References',
      'findReferences',
      { headLimit: 3, offset: 0 },
    );
    expect(r.output).toContain('showing 1-3');
    expect(r.output).toContain('7 more — offset:3');
    expect(r.truncated).toBe(true);
    expect(r.numResults).toBe(10);
  });

  test('offset skips earlier rows', () => {
    const locations = Array.from({ length: 10 }, (_, i) => loc(`/f${i}.ts`, i + 1, 1));
    const r = formatLocationList(
      locations,
      'References',
      'findReferences',
      { headLimit: 3, offset: 5 },
    );
    expect(r.output).toContain('showing 6-8');
    expect(r.output).toContain('/f5.ts:');
    expect(r.output).not.toContain('/f0.ts:');
  });
});

describe('formatSymbolOutline (documentSymbol)', () => {
  test('empty → (no symbols) marker', () => {
    const r = formatSymbolOutline([], '/abs/file.ts');
    expect(r.output).toContain('Symbols in /abs/file.ts');
    expect(r.output).toContain('(no symbols)');
    expect(r.numResults).toBe(0);
  });

  test('hierarchical DocumentSymbol[] renders class + children', () => {
    const symbols: LspDocumentSymbol[] = [{
      name: 'Foo',
      kind: LspSymbolKind.Class,
      range: { start: { line: 4, character: 0 }, end: { line: 49, character: 0 } },
      selectionRange: { start: { line: 4, character: 6 }, end: { line: 4, character: 9 } },
      children: [
        {
          name: 'bar',
          kind: LspSymbolKind.Method,
          range: { start: { line: 7, character: 2 }, end: { line: 14, character: 2 } },
          selectionRange: { start: { line: 7, character: 2 }, end: { line: 7, character: 5 } },
        },
      ],
    }];
    const r = formatSymbolOutline(symbols, '/abs/foo.ts');
    expect(r.output).toContain('class Foo');
    expect(r.output).toContain('method bar');
    // Child indented by 2 spaces.
    expect(r.output).toMatch(/\n\s\smethod bar/);
  });

  test('flat SymbolInformation[] fallback shape also renders', () => {
    const symbols: LspSymbolInformation[] = [
      {
        name: 'helper', kind: LspSymbolKind.Function,
        location: loc('/abs/f.ts', 10, 1, 20, 1),
      },
      {
        name: 'Opts', kind: LspSymbolKind.Interface, containerName: 'api',
        location: loc('/abs/f.ts', 30, 1, 40, 1),
      },
    ];
    const r = formatSymbolOutline(symbols, '/abs/f.ts');
    expect(r.output).toContain('function helper');
    expect(r.output).toContain('interface api.Opts');
  });
});

describe('formatWorkspaceSymbols', () => {
  test('empty → (no results) marker', () => {
    const r = formatWorkspaceSymbols([], 'foo');
    expect(r.output).toContain('Workspace symbols matching "foo"');
    expect(r.output).toContain('(no results)');
    expect(r.numResults).toBe(0);
  });

  test('symbol rows include kind + name + containerName + path:line:col', () => {
    const symbols: LspSymbolInformation[] = [
      {
        name: 'streamLLM', kind: LspSymbolKind.Function,
        location: loc('/abs/llm.ts', 1038, 1),
      },
      {
        name: 'StreamLLMError', kind: LspSymbolKind.Class,
        containerName: 'errors', location: loc('/abs/llm.ts', 890, 1),
      },
    ];
    const r = formatWorkspaceSymbols(symbols, 'streamLLM');
    expect(r.output).toContain('function streamLLM');
    expect(r.output).toContain('/abs/llm.ts:1038:1');
    expect(r.output).toContain('class StreamLLMError');
    expect(r.output).toContain('(errors)');
  });

  test('lazy location (v3.17) renders uri only (no line/col)', () => {
    const symbols: LspWorkspaceSymbol[] = [
      {
        name: 'foo', kind: LspSymbolKind.Function,
        location: { uri: 'file:///abs/bar.ts' },
      },
    ];
    const r = formatWorkspaceSymbols(symbols, 'foo');
    expect(r.output).toContain('function foo');
    expect(r.output).toContain('/abs/bar.ts');
    expect(r.output).not.toMatch(/\/abs\/bar\.ts:\d/);
  });

  test('head_limit + offset paginate', () => {
    const symbols: LspSymbolInformation[] = Array.from({ length: 5 }, (_, i) => ({
      name: `s${i}`, kind: LspSymbolKind.Function,
      location: loc(`/f${i}.ts`, 1, 1),
    }));
    const r = formatWorkspaceSymbols(symbols, 's', { headLimit: 2, offset: 1 });
    expect(r.output).toContain('showing 2-3');
    expect(r.output).toContain('function s1');
    expect(r.output).toContain('function s2');
    expect(r.output).not.toContain('function s4');
    expect(r.truncated).toBe(true);
  });
});
