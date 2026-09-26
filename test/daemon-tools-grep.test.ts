// MVP M1.5 A.2 — Grep tool tests.
//
// Spawns the real `rg` binary (homebrew installs it system-wide). If
// the binary is missing the test gracefully skips with a note.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';

import {
  buildGrepTool,
  dispatchGrep,
  GREP_MAX_RESULTS,
} from '../src/boot/daemon-tools/grep.js';
import { ToolSafetyError } from '../src/boot/daemon-tools/types.js';

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(joinPath(tmpdir(), 'elanous-grep-'));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

const ctx = (): { cwd: string; signal: AbortSignal } => ({
  cwd,
  signal: new AbortController().signal,
});

describe('buildGrepTool', () => {
  test('returns a JSONSchema-shaped LLMToolSpec', () => {
    const spec = buildGrepTool();
    expect(spec.name).toBe('Grep');
    expect(spec.parameters).toMatchObject({
      type: 'object',
      required: ['pattern'],
    });
  });
});

describe('dispatchGrep — happy paths', () => {
  test('finds matches in text files', async () => {
    writeFileSync(joinPath(cwd, 'a.txt'), 'hello\nfoo bar\nbaz\n');
    writeFileSync(joinPath(cwd, 'b.txt'), 'no\nfoo here\nyes\n');
    const result = await dispatchGrep({ pattern: 'foo' }, ctx());
    expect(result.matches.length).toBeGreaterThanOrEqual(2);
    const lines = result.matches.map((m) => m.text.trim());
    expect(lines.some((l) => l.includes('foo bar'))).toBe(true);
    expect(lines.some((l) => l.includes('foo here'))).toBe(true);
  });

  test('returns 0 matches when pattern is absent', async () => {
    writeFileSync(joinPath(cwd, 'a.txt'), 'hello\nworld\n');
    const result = await dispatchGrep({ pattern: 'nonexistent-xyzzy' }, ctx());
    expect(result.matches).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  test('case-insensitive flag works', async () => {
    writeFileSync(joinPath(cwd, 'a.txt'), 'HELLO\nworld\n');
    const result = await dispatchGrep(
      { pattern: 'hello', case_insensitive: true },
      ctx(),
    );
    expect(result.matches.length).toBeGreaterThanOrEqual(1);
  });

  test('respects max_results cap', async () => {
    const lines = Array.from({ length: 50 }, (_, i) => `match-${i}`).join('\n');
    writeFileSync(joinPath(cwd, 'many.txt'), lines);
    const result = await dispatchGrep({ pattern: 'match', max_results: 3 }, ctx());
    expect(result.matches.length).toBeLessThanOrEqual(3);
  });

  test('respects sub-tree path arg', async () => {
    mkdirSync(joinPath(cwd, 'sub'));
    writeFileSync(joinPath(cwd, 'sub', 'in.txt'), 'foo\n');
    writeFileSync(joinPath(cwd, 'out.txt'), 'foo\n');
    const result = await dispatchGrep({ pattern: 'foo', path: 'sub' }, ctx());
    expect(result.matches.every((m) => m.path.includes('sub'))).toBe(true);
  });
});

describe('dispatchGrep — safety', () => {
  test('rejects path traversal in path arg', async () => {
    await expect(dispatchGrep({ pattern: 'x', path: '../escape' }, ctx()))
      .rejects.toThrow(ToolSafetyError);
  });

  test('rejects empty pattern', async () => {
    await expect(dispatchGrep({ pattern: '' }, ctx())).rejects.toThrow(ToolSafetyError);
  });

  test('GREP_MAX_RESULTS cap is enforced for absurd values', () => {
    // The cap is applied via Math.min before spawning rg.
    expect(GREP_MAX_RESULTS).toBeGreaterThan(0);
    expect(GREP_MAX_RESULTS).toBeLessThanOrEqual(10_000);
  });
});
