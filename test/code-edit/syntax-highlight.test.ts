import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import chalk from 'chalk';
import {
  detectLanguage, highlightCode, renderEditBlockAsync,
  _resetSyntaxHighlighterForTesting,
  type EditResult,
} from '../../src/code-edit/index.js';

beforeAll(() => { chalk.level = 3; });
afterEach(() => _resetSyntaxHighlighterForTesting());

describe('detectLanguage', () => {
  test('maps common extensions to shiki ids', () => {
    expect(detectLanguage('/a/foo.ts')).toBe('typescript');
    expect(detectLanguage('/a/foo.tsx')).toBe('tsx');
    expect(detectLanguage('/a/script.py')).toBe('python');
    expect(detectLanguage('/a/main.rs')).toBe('rust');
    expect(detectLanguage('/a/main.go')).toBe('go');
    expect(detectLanguage('/a/build.sh')).toBe('bash');
    expect(detectLanguage('/a/README.md')).toBe('markdown');
    expect(detectLanguage('/a/config.yaml')).toBe('yaml');
    expect(detectLanguage('/a/a.json')).toBe('json');
  });

  test('basename special cases: Dockerfile / Makefile', () => {
    expect(detectLanguage('/a/Dockerfile')).toBe('dockerfile');
    expect(detectLanguage('/a/Makefile')).toBe('makefile');
  });

  test('unknown extension → empty string', () => {
    expect(detectLanguage('/a/mystery.xyz')).toBe('');
    expect(detectLanguage('/a/NOEXT')).toBe('');
  });
});

describe('highlightCode', () => {
  test('returns tokens for a real language', async () => {
    const tokens = await highlightCode('const x = 1;', 'typescript');
    expect(tokens.length).toBeGreaterThan(0);
    // Each line is an array of tokens; first line should have more
    // than one token for "const x = 1;".
    expect(tokens[0]!.length).toBeGreaterThan(1);
    // Keyword tokens carry a colour string.
    const keyword = tokens[0]!.find((t) => t.content === 'const');
    expect(keyword?.color).toBeDefined();
  });

  test('empty language returns plain-token fallback', async () => {
    const tokens = await highlightCode('hello world', '');
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toEqual([{ content: 'hello world' }]);
  });

  test('unknown language returns plain fallback', async () => {
    const tokens = await highlightCode('data whatever', 'nonexistent-lang-xyz');
    // One line, one plain token.
    expect(tokens).toHaveLength(1);
    expect(tokens[0]![0]!.content).toBe('data whatever');
    expect(tokens[0]![0]!.color).toBeUndefined();
  });
});

describe('renderEditBlockAsync — syntax integration', () => {
  function mkResult(path: string): EditResult {
    return {
      ok: true,
      file_path: path,
      structuredPatch: [{
        oldStart: 1, oldLines: 1, newStart: 1, newLines: 1,
        lines: ['-const x = 1;', '+const x = 2;'],
      }],
      originalContent: 'const x = 1;\n',
      newContent: 'const x = 2;\n',
      edits: [{ old_string: 'const x = 1;', new_string: 'const x = 2;' }],
      linesAdded: 1,
      linesRemoved: 1,
    };
  }

  test('syntax:true on .ts file adds per-token fg colour escapes', async () => {
    const rows = await renderEditBlockAsync(mkResult('/abs/a.ts'), { syntax: true });
    const joined = rows.join('\n');
    // Plain run (no syntax) would only have the bg escape; syntax-
    // highlighted run additionally emits multiple fg 38;2;R;G;B codes.
    const fgCount = (joined.match(/\x1b\[38;2;/g) ?? []).length;
    expect(fgCount).toBeGreaterThan(0);
  });

  test('syntax:false bypasses the async path entirely', async () => {
    const rows = await renderEditBlockAsync(mkResult('/abs/a.ts'), { syntax: false });
    const joined = rows.join('\n');
    // Plain path should have ANSI escapes (colour level varies per
    // test env — chalk may collapse truecolor → 16-colour); just
    // verify something ANSI landed.
    expect(joined).toMatch(/\x1b\[/);
    // And the row content is readable.
    expect(joined).toContain('const x = 2;');
  });

  test('unknown-extension file falls back to plain rendering', async () => {
    const r = mkResult('/abs/mystery.xyz');
    const rows = await renderEditBlockAsync(r, { syntax: true });
    const joined = rows.join('\n');
    expect(joined).toMatch(/\x1b\[/);
    expect(joined).toContain('const x = 2;');
  });
});
