import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';

import {
  DEFAULT_HEAD_BYTES,
  DEFAULT_INLINE_LIMIT,
  DEFAULT_TAIL_BYTES,
  listSpilledFilesForTesting,
  truncateOutput,
} from '../src/output-truncation.js';

let tmp: string;

beforeEach(() => {
  tmp = joinPath(tmpdir(), `mh-trunc-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmp, { recursive: true });
});

afterEach(() => {
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('truncateOutput — small body fast path', () => {
  test('returns body unchanged when ≤ inlineLimit', () => {
    const body = 'a'.repeat(100);
    const r = truncateOutput(body, { toolName: 'tester', outputDir: tmp });
    expect(r.output).toBe(body);
    expect(r.spilled).toBe(false);
    expect(r.savedPath).toBeUndefined();
    expect(r.originalBytes).toBe(100);
    expect(listSpilledFilesForTesting(tmp)).toEqual([]);
  });

  test('default inlineLimit is 8 KB', () => {
    expect(DEFAULT_INLINE_LIMIT).toBe(8 * 1024);
  });
});

describe('truncateOutput — large body spill', () => {
  test('writes file, returns head+footer+tail when over limit', () => {
    const body = 'X'.repeat(DEFAULT_INLINE_LIMIT + 1000);
    const r = truncateOutput(body, { toolName: 'tester', outputDir: tmp });
    expect(r.spilled).toBe(true);
    expect(r.savedPath).toBeDefined();
    expect(existsSync(r.savedPath!)).toBe(true);
    expect(readFileSync(r.savedPath!, 'utf-8')).toBe(body);
    expect(r.output).toContain('saved to');
    expect(r.output).toContain(r.savedPath!);
    // Output is much smaller than the body.
    expect(r.output.length).toBeLessThan(body.length);
    // Output has head + tail.
    expect(r.output.startsWith('X'.repeat(DEFAULT_HEAD_BYTES))).toBe(true);
    expect(r.output.endsWith('X'.repeat(DEFAULT_TAIL_BYTES))).toBe(true);
  });

  test('respects custom head/tail bytes', () => {
    const body = 'X'.repeat(20_000);
    const r = truncateOutput(body, {
      toolName: 'tester', outputDir: tmp,
      inlineLimit: 1000, headBytes: 200, tailBytes: 100,
    });
    expect(r.spilled).toBe(true);
    expect(r.output.startsWith('X'.repeat(200))).toBe(true);
    expect(r.output.endsWith('X'.repeat(100))).toBe(true);
  });

  test('honors ext for filename suffix', () => {
    const body = 'a'.repeat(10_000);
    const r = truncateOutput(body, { toolName: 'json_tool', outputDir: tmp, ext: 'json' });
    expect(r.savedPath?.endsWith('.json')).toBe(true);
  });

  test('strips leading dot from ext', () => {
    const body = 'a'.repeat(10_000);
    const r = truncateOutput(body, { toolName: 't', outputDir: tmp, ext: '.log' });
    expect(r.savedPath?.endsWith('.log')).toBe(true);
    expect(r.savedPath?.endsWith('..log')).toBe(false);
  });
});

describe('truncateOutput — deterministic hashing', () => {
  test('same toolName + body produces same path', () => {
    const body = 'X'.repeat(20_000);
    const a = truncateOutput(body, { toolName: 't', outputDir: tmp });
    const b = truncateOutput(body, { toolName: 't', outputDir: tmp });
    expect(a.savedPath).toBe(b.savedPath);
  });

  test('different toolName → different path', () => {
    const body = 'X'.repeat(20_000);
    const a = truncateOutput(body, { toolName: 'one', outputDir: tmp });
    const b = truncateOutput(body, { toolName: 'two', outputDir: tmp });
    expect(a.savedPath).not.toBe(b.savedPath);
  });

  test('different body → different path (even if same tool)', () => {
    const a = truncateOutput('X'.repeat(20_000), { toolName: 't', outputDir: tmp });
    const b = truncateOutput('Y'.repeat(20_000), { toolName: 't', outputDir: tmp });
    expect(a.savedPath).not.toBe(b.savedPath);
  });

  test('reusing identical body does not re-write file', () => {
    const body = 'X'.repeat(20_000);
    truncateOutput(body, { toolName: 't', outputDir: tmp });
    expect(listSpilledFilesForTesting(tmp).length).toBe(1);
    truncateOutput(body, { toolName: 't', outputDir: tmp });
    expect(listSpilledFilesForTesting(tmp).length).toBe(1);
  });
});

describe('truncateOutput — footer mentions Read tool path', () => {
  test('includes file_path= hint so the LLM knows how to fetch more', () => {
    const r = truncateOutput('X'.repeat(20_000), { toolName: 't', outputDir: tmp });
    expect(r.output).toMatch(/file_path="/);
    expect(r.output).toMatch(/bytes total/);
  });
});
