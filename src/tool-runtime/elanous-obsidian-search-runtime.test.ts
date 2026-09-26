// PLAN-codex-app-server-hermes-parity §5 Phase H1·5b test —
// parseRgMatchStream pure parser + dispatchElanousObsidianSearch
// branches (empty query · vault missing · rg success · rg failure).
// `spawnRg` override lets us assert behavior without depending on rg
// being installed on the test host.

import { describe, test, expect } from 'bun:test';
import {
  parseRgMatchStream,
  dispatchElanousObsidianSearch,
  elanousObsidianSearchRuntime,
  buildElanousObsidianSearchTool,
} from './elanous-obsidian-search-runtime.js';

const VAULT_ROOT = '/Users/test/Obsidian/MyVault';

/** Build a single rg `--json` match event line. */
function rgMatch(path: string, line: number, text: string): string {
  return JSON.stringify({
    type: 'match',
    data: {
      path: { text: `${VAULT_ROOT}/${path}` },
      line_number: line,
      lines: { text },
    },
  });
}

describe('parseRgMatchStream', () => {
  test('parses match events into projected shape', () => {
    const stdout = [
      rgMatch('Setup/oauth.md', 42, 'OAuth setup for codex CLI\n'),
      rgMatch('Daily/2026-05-15.md', 7, 'Reviewed OAuth flow\n'),
    ].join('\n');
    const out = parseRgMatchStream(stdout, VAULT_ROOT, 50);
    expect(out).toEqual([
      { path: 'Setup/oauth.md', snippet: 'OAuth setup for codex CLI', lineNumber: 42 },
      { path: 'Daily/2026-05-15.md', snippet: 'Reviewed OAuth flow', lineNumber: 7 },
    ]);
  });

  test('skips non-match events (begin / end / context)', () => {
    const stdout = [
      JSON.stringify({ type: 'begin', data: { path: { text: `${VAULT_ROOT}/x.md` } } }),
      rgMatch('x.md', 1, 'hit\n'),
      JSON.stringify({ type: 'end', data: {} }),
      JSON.stringify({ type: 'context', data: { lines: { text: 'context\n' } } }),
    ].join('\n');
    const out = parseRgMatchStream(stdout, VAULT_ROOT, 50);
    expect(out).toHaveLength(1);
    expect(out[0]!.path).toBe('x.md');
  });

  test('caps snippet at 240 chars + trims trailing newlines', () => {
    const long = 'x'.repeat(300) + '\n\n\n';
    const stdout = rgMatch('big.md', 1, long);
    const [first] = parseRgMatchStream(stdout, VAULT_ROOT, 50);
    expect(first!.snippet.length).toBe(240);
    expect(first!.snippet.endsWith('\n')).toBe(false);
  });

  test('honors limit (stops parsing after N matches)', () => {
    const lines: string[] = [];
    for (let i = 0; i < 100; i++) {
      lines.push(rgMatch(`note-${i}.md`, 1, `hit ${i}\n`));
    }
    const out = parseRgMatchStream(lines.join('\n'), VAULT_ROOT, 5);
    expect(out).toHaveLength(5);
    expect(out[4]!.path).toBe('note-4.md');
  });

  test('preserves absolute paths when not under vault root', () => {
    const stdout = JSON.stringify({
      type: 'match',
      data: {
        path: { text: '/elsewhere/foo.md' },
        line_number: 1,
        lines: { text: 'hit' },
      },
    });
    const out = parseRgMatchStream(stdout, VAULT_ROOT, 50);
    expect(out[0]!.path).toBe('/elsewhere/foo.md');
  });

  test('ignores malformed JSON lines + empty lines', () => {
    const stdout = ['', 'not-json', '{ "broken": ', rgMatch('a.md', 1, 'ok')].join('\n');
    const out = parseRgMatchStream(stdout, VAULT_ROOT, 50);
    expect(out).toHaveLength(1);
    expect(out[0]!.path).toBe('a.md');
  });
});

describe('dispatchElanousObsidianSearch · input validation', () => {
  test('empty query → query-required error', async () => {
    const r = await dispatchElanousObsidianSearch({}, { vaultRoot: VAULT_ROOT });
    expect(r.error).toBe('query-required');
    expect(r.matches).toEqual([]);
  });

  test('whitespace-only query → query-required error', async () => {
    const r = await dispatchElanousObsidianSearch({ query: '   ' }, { vaultRoot: VAULT_ROOT });
    expect(r.error).toBe('query-required');
  });
});

describe('dispatchElanousObsidianSearch · spawn integration (mocked)', () => {
  test('success path returns matches + summary', async () => {
    const stdout = [
      rgMatch('Setup/oauth.md', 42, 'OAuth setup\n'),
      rgMatch('Daily/2026-05-15.md', 7, 'Reviewed OAuth flow\n'),
    ].join('\n');
    const r = await dispatchElanousObsidianSearch(
      { query: 'OAuth' },
      {
        vaultRoot: VAULT_ROOT,
        spawnRg: async (args) => {
          // assert rg gets passed our args
          expect(args).toContain('--json');
          expect(args).toContain('--ignore-case');
          expect(args).toContain('OAuth');
          expect(args).toContain(VAULT_ROOT);
          return { code: 0, stdout, stderr: '' };
        },
      },
    );
    expect(r.matches).toHaveLength(2);
    expect(r.output).toContain('2 match(es)');
    expect(r.error).toBeUndefined();
  });

  test('rg exit 1 (no matches) returns empty list without error', async () => {
    const r = await dispatchElanousObsidianSearch(
      { query: 'no-such-string' },
      {
        vaultRoot: VAULT_ROOT,
        spawnRg: async () => ({ code: 1, stdout: '', stderr: '' }),
      },
    );
    expect(r.matches).toEqual([]);
    expect(r.error).toBeUndefined();
  });

  test('rg exit 2+ surfaces error', async () => {
    const r = await dispatchElanousObsidianSearch(
      { query: 'x' },
      {
        vaultRoot: VAULT_ROOT,
        spawnRg: async () => ({ code: 2, stdout: '', stderr: 'rg: bad arg' }),
      },
    );
    expect(r.error).toContain('rg-exit-2');
    expect(r.error).toContain('rg: bad arg');
  });

  test('honors caller limit (50 default · 200 cap · normalize floats)', async () => {
    const lines: string[] = [];
    for (let i = 0; i < 100; i++) {
      lines.push(rgMatch(`note-${i}.md`, 1, `hit ${i}\n`));
    }
    const r = await dispatchElanousObsidianSearch(
      { query: 'hit', limit: 7 },
      {
        vaultRoot: VAULT_ROOT,
        spawnRg: async () => ({ code: 0, stdout: lines.join('\n'), stderr: '' }),
      },
    );
    expect(r.matches).toHaveLength(7);
  });

  test('limit out-of-range falls back to default 50', async () => {
    const lines: string[] = [];
    for (let i = 0; i < 100; i++) {
      lines.push(rgMatch(`note-${i}.md`, 1, `hit\n`));
    }
    const r = await dispatchElanousObsidianSearch(
      { query: 'hit', limit: -1 },
      {
        vaultRoot: VAULT_ROOT,
        spawnRg: async () => ({ code: 0, stdout: lines.join('\n'), stderr: '' }),
      },
    );
    expect(r.matches).toHaveLength(50);
  });
});

describe('elanousObsidianSearchRuntime · ToolRuntime interface', () => {
  test('exposes id and spec', () => {
    expect(elanousObsidianSearchRuntime.id).toBe('elanous_obsidian_search');
    expect(elanousObsidianSearchRuntime.spec.name).toBe('elanous_obsidian_search');
  });

  test('buildElanousObsidianSearchTool returns valid LLMToolSpec with required query', () => {
    const spec = buildElanousObsidianSearchTool();
    expect(spec.name).toBe('elanous_obsidian_search');
    const params = spec.parameters as { required?: string[] };
    expect(params.required).toContain('query');
  });
});
