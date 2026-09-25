// MVP M1.5 A.2 — Read tool tests.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';

import {
  buildReadTool,
  dispatchRead,
  READ_MAX_BYTES,
} from '../src/boot/daemon-tools/read.js';
import { ToolSafetyError } from '../src/boot/daemon-tools/types.js';

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(joinPath(tmpdir(), 'monad-read-'));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

const ctx = (): { cwd: string; signal: AbortSignal } => ({
  cwd,
  signal: new AbortController().signal,
});

describe('buildReadTool', () => {
  test('returns a JSONSchema-shaped LLMToolSpec', () => {
    const spec = buildReadTool();
    expect(spec.name).toBe('Read');
    expect(typeof spec.description).toBe('string');
    expect(spec.parameters).toMatchObject({
      type: 'object',
      properties: { file_path: { type: 'string' }, path: { type: 'string' } },
      required: ['file_path'],
    });
  });
});

describe('dispatchRead — happy paths', () => {
  test('returns content for a small text file', async () => {
    writeFileSync(joinPath(cwd, 'note.txt'), 'hello\nworld\n');
    const result = await dispatchRead({ path: 'note.txt' }, ctx());
    expect(result.content).toBe('hello\nworld\n');
    expect(result.size).toBe(12);
    expect(result.truncated).toBe(false);
  });

  test('reads UTF-8 content (Korean)', async () => {
    writeFileSync(joinPath(cwd, 'k.txt'), '안녕하세요\n');
    const result = await dispatchRead({ path: 'k.txt' }, ctx());
    expect(result.content).toBe('안녕하세요\n');
  });

  test('reads nested file', async () => {
    mkdirSync(joinPath(cwd, 'sub'));
    writeFileSync(joinPath(cwd, 'sub', 'inner.txt'), 'inner');
    const r = await dispatchRead({ path: 'sub/inner.txt' }, ctx());
    expect(r.content).toBe('inner');
  });
});

describe('dispatchRead — safety', () => {
  test('rejects path traversal', async () => {
    await expect(dispatchRead({ path: '../escape' }, ctx())).rejects.toThrow(ToolSafetyError);
  });

  test('rejects sensitive deny-list paths (.env)', async () => {
    writeFileSync(joinPath(cwd, '.env'), 'SECRET=1');
    await expect(dispatchRead({ path: '.env' }, ctx())).rejects.toThrow(ToolSafetyError);
  });

  test('rejects sensitive (id_rsa)', async () => {
    writeFileSync(joinPath(cwd, 'id_rsa'), 'fake');
    await expect(dispatchRead({ path: 'id_rsa' }, ctx())).rejects.toThrow(ToolSafetyError);
  });

  test('rejects binary file', async () => {
    const binaryBuf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x00]);
    writeFileSync(joinPath(cwd, 'bin.png'), binaryBuf);
    await expect(dispatchRead({ path: 'bin.png' }, ctx())).rejects.toThrow(ToolSafetyError);
  });

  test('rejects when path arg is not a string', async () => {
    await expect(dispatchRead({ path: 42 } as never, ctx())).rejects.toThrow(ToolSafetyError);
  });

  test('rejects when target is a directory', async () => {
    mkdirSync(joinPath(cwd, 'a-dir'));
    await expect(dispatchRead({ path: 'a-dir' }, ctx())).rejects.toThrow(ToolSafetyError);
  });
});

describe('dispatchRead — truncation', () => {
  test('truncates files larger than READ_MAX_BYTES', async () => {
    // Generate 11 MB of ASCII so it's text but too big.
    const big = Buffer.alloc(READ_MAX_BYTES + 1024, 'A'.charCodeAt(0));
    writeFileSync(joinPath(cwd, 'big.txt'), big);
    const result = await dispatchRead({ path: 'big.txt' }, ctx());
    expect(result.truncated).toBe(true);
    expect(result.size).toBe(big.length);
    expect(result.content.length).toBe(READ_MAX_BYTES);
  });
});
