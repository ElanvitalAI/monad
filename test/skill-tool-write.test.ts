// file_write dispatcher tests. Real fs operations in a temp dir.

import { describe, test, expect, beforeEach, afterAll } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dispatchWrite, buildWriteTool } from '../src/skills/tools/write';

const tmpRoot = mkdtempSync(join(tmpdir(), 'monad-write-test-'));
let tmp: string;

beforeEach(() => {
  // Fresh subdir per test so one test's files don't leak.
  tmp = mkdtempSync(join(tmpRoot, 'run-'));
});

afterAll(() => {
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('Write tool — spec', () => {
  test('buildWriteTool returns a valid spec', () => {
    const spec = buildWriteTool();
    expect(spec.name).toBe('Write');
    expect(spec.parameters.required).toEqual(['file_path', 'content']);
    expect((spec.parameters.properties as any).overwrite.type).toBe('boolean');
  });
});

describe('Write tool — dispatch', () => {
  test('empty file_path throws', async () => {
    await expect(dispatchWrite({ file_path: '', content: '' })).rejects.toThrow(/file_path is required/);
  });

  test('non-string content throws', async () => {
    await expect(dispatchWrite({ file_path: join(tmp, 'a'), content: 42 as any }))
      .rejects.toThrow(/content must be a string/);
  });

  test('creates a new file + sets created=true', async () => {
    const p = join(tmp, 'new.txt');
    const r = await dispatchWrite({ file_path: p, content: 'hello' });
    expect(existsSync(p)).toBe(true);
    expect(readFileSync(p, 'utf8')).toBe('hello');
    expect(r.created).toBe(true);
    expect(r.bytesWritten).toBe(5);
    expect(r.overwrittenBytes).toBeUndefined();
    expect(r.output).toContain('new file');
  });

  test('auto-creates parent directories', async () => {
    const p = join(tmp, 'deep', 'nested', 'file.txt');
    const r = await dispatchWrite({ file_path: p, content: 'x' });
    expect(existsSync(p)).toBe(true);
    expect(r.created).toBe(true);
  });

  test('empty content is allowed (placeholder touch)', async () => {
    const p = join(tmp, 'empty.txt');
    const r = await dispatchWrite({ file_path: p, content: '' });
    expect(existsSync(p)).toBe(true);
    expect(r.bytesWritten).toBe(0);
    expect(statSync(p).size).toBe(0);
  });

  test('refuses to overwrite existing file by default', async () => {
    const p = join(tmp, 'exists.txt');
    writeFileSync(p, 'original');
    await expect(dispatchWrite({ file_path: p, content: 'new' }))
      .rejects.toThrow(/refusing to overwrite/);
    // Original preserved
    expect(readFileSync(p, 'utf8')).toBe('original');
  });

  test('overwrite=true replaces and reports previous size', async () => {
    const p = join(tmp, 'replace.txt');
    writeFileSync(p, 'abcdefg');  // 7 bytes
    const r = await dispatchWrite({ file_path: p, content: 'xy', overwrite: true });
    expect(readFileSync(p, 'utf8')).toBe('xy');
    expect(r.created).toBe(false);
    expect(r.overwrittenBytes).toBe(7);
    expect(r.bytesWritten).toBe(2);
    expect(r.output).toContain('overwritten, was 7 bytes');
  });

  test('utf-8 byte-length is correct for multi-byte content', async () => {
    const p = join(tmp, 'utf8.txt');
    const r = await dispatchWrite({ file_path: p, content: '한글' });  // 6 bytes in utf-8
    expect(r.bytesWritten).toBe(6);
  });

  test('content over MAX_CONTENT_BYTES throws', async () => {
    const huge = 'x'.repeat(10 * 1024 * 1024 + 1);
    await expect(dispatchWrite({ file_path: join(tmp, 'huge.txt'), content: huge }))
      .rejects.toThrow(/exceeds .* byte cap/);
  });
});
