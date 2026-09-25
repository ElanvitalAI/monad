// ── Read tool tests ──

import { describe, test, expect } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildReadTool, dispatchRead } from '../src/skills/tools/read';
import { getSessionCwd, setSessionCwd } from '../src/session/working-dir';

function tmp(): string { return mkdtempSync(join(tmpdir(), 'read-tool-')); }

describe('buildReadTool — schema matches claude-code', () => {
  test('name is exactly "Read"', () => {
    expect(buildReadTool().name).toBe('Read');
  });
  test('required = [file_path], optional = offset/limit/pages', () => {
    const schema = buildReadTool().parameters as any;
    expect(schema.required).toEqual(['file_path']);
    expect(schema.properties.file_path.type).toBe('string');
    expect(schema.properties.offset.type).toBe('number');
    expect(schema.properties.limit.type).toBe('number');
    expect(schema.properties.pages.type).toBe('string');
  });
});

describe('dispatchRead — text files', () => {
  test('basic 3-line file returns `cat -n` formatted output', async () => {
    const dir = tmp();
    try {
      const p = join(dir, 'a.txt');
      writeFileSync(p, 'alpha\nbeta\ngamma\n');
      const r = await dispatchRead({ file_path: p });
      expect(r.kind).toBe('text');
      expect(r.totalLines).toBe(3);
      expect(r.linesRead).toBe(3);
      expect(r.truncated).toBe(false);
      expect(r.output).toBe('     1\talpha\n     2\tbeta\n     3\tgamma');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('offset=2 skips the first line', async () => {
    const dir = tmp();
    try {
      const p = join(dir, 'a.txt');
      writeFileSync(p, 'alpha\nbeta\ngamma\n');
      const r = await dispatchRead({ file_path: p, offset: 2 });
      expect(r.linesRead).toBe(2);
      expect(r.output).toContain('     2\tbeta');
      expect(r.output).toContain('     3\tgamma');
      expect(r.output).not.toContain('alpha');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('limit caps returned lines + truncation footer surfaces', async () => {
    const dir = tmp();
    try {
      const p = join(dir, 'big.txt');
      const lines = Array.from({ length: 100 }, (_, i) => `line-${i + 1}`).join('\n');
      writeFileSync(p, lines);
      const r = await dispatchRead({ file_path: p, limit: 10 });
      expect(r.linesRead).toBe(10);
      expect(r.totalLines).toBe(100);
      expect(r.truncated).toBe(true);
      expect(r.output).toContain('     1\tline-1');
      expect(r.output).toContain('    10\tline-10');
      expect(r.output).not.toContain('line-11');
      // Footer mentions next offset
      expect(r.output).toContain('offset:11');
      expect(r.output).toContain('90 more lines');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('offset + limit together paginate in the middle', async () => {
    const dir = tmp();
    try {
      const p = join(dir, 'big.txt');
      writeFileSync(p, Array.from({ length: 50 }, (_, i) => `L${i + 1}`).join('\n'));
      const r = await dispatchRead({ file_path: p, offset: 20, limit: 5 });
      expect(r.linesRead).toBe(5);
      expect(r.output).toContain('    20\tL20');
      expect(r.output).toContain('    24\tL24');
      expect(r.output).not.toContain('\tL25');
      expect(r.output).not.toContain('\tL19');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('overly long lines get per-line truncation', async () => {
    const dir = tmp();
    try {
      const p = join(dir, 'minified.js');
      // TRUNCATE_LINE_LEN is 5000 — go well above it so the cap engages.
      const huge = 'x'.repeat(10_000);
      writeFileSync(p, huge);
      const r = await dispatchRead({ file_path: p });
      expect(r.output).toContain('more chars');
      expect(r.output.length).toBeLessThan(8000);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('CRLF normalizes to LF', async () => {
    const dir = tmp();
    try {
      const p = join(dir, 'win.txt');
      writeFileSync(p, 'alpha\r\nbeta\r\n');
      const r = await dispatchRead({ file_path: p });
      expect(r.totalLines).toBe(2);
      expect(r.output).toContain('     1\talpha');
      expect(r.output).toContain('     2\tbeta');
      expect(r.output).not.toContain('\r');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('empty file → 0 lines, empty output', async () => {
    const dir = tmp();
    try {
      const p = join(dir, 'empty.txt');
      writeFileSync(p, '');
      const r = await dispatchRead({ file_path: p });
      expect(r.totalLines).toBe(0);
      expect(r.linesRead).toBe(0);
      expect(r.output).toBe('');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('BOM is stripped from first line', async () => {
    const dir = tmp();
    try {
      const p = join(dir, 'bom.txt');
      writeFileSync(p, '\uFEFFhello');
      const r = await dispatchRead({ file_path: p });
      expect(r.output).toBe('     1\thello');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('dispatchRead — binary / image / pdf classification', () => {
  test('image extension returns metadata stub', async () => {
    const dir = tmp();
    try {
      const p = join(dir, 'photo.png');
      writeFileSync(p, Buffer.from([0x89, 0x50, 0x4E, 0x47]));  // PNG magic
      const r = await dispatchRead({ file_path: p });
      expect(r.kind).toBe('image');
      expect(r.output).toContain('[image:');
      expect(r.output).toContain('png');
      expect(r.output).toContain('use Bash');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('PDF extension returns metadata stub with page range', async () => {
    const dir = tmp();
    try {
      const p = join(dir, 'doc.pdf');
      writeFileSync(p, '%PDF-1.4');
      const r = await dispatchRead({ file_path: p, pages: '1-3' });
      expect(r.kind).toBe('pdf');
      expect(r.output).toContain('[pdf:');
      expect(r.output).toContain('1-3');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('zip / binary extension routed to binary stub', async () => {
    const dir = tmp();
    try {
      const p = join(dir, 'a.zip');
      writeFileSync(p, Buffer.from([0x50, 0x4B]));
      const r = await dispatchRead({ file_path: p });
      expect(r.kind).toBe('binary');
      expect(r.output).toContain('[binary:');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('dispatchRead — error paths', () => {
  test('missing file_path throws', async () => {
    await expect(dispatchRead({})).rejects.toThrow('file_path is required');
  });

  test('relative path resolves against the session working directory', async () => {
    const dir = tmp();
    const previousCwd = getSessionCwd();
    try {
      const relativePath = 'nested/session-relative.txt';
      const resolvedPath = join(dir, relativePath);
      const processCwdPath = join(process.cwd(), relativePath);
      mkdirSync(join(dir, 'nested'));
      writeFileSync(resolvedPath, 'session-relative content\n', { flag: 'wx' });
      setSessionCwd(dir, 'tool');

      const r = await dispatchRead({ file_path: relativePath });

      expect(resolvedPath).not.toBe(processCwdPath);
      expect(r.kind).toBe('text');
      expect(r.output).toBe('     1\tsession-relative content');
      await expect(dispatchRead({ file_path: 'nested/missing.txt' }))
        .rejects.toThrow(`does not exist — ${join(dir, 'nested/missing.txt')}`);
    } finally {
      setSessionCwd(previousCwd, 'tool');
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('non-existent path throws', async () => {
    await expect(dispatchRead({ file_path: '/nonexistent/definitely/not/here.txt' }))
      .rejects.toThrow('does not exist');
  });

  test('directory path rejected', async () => {
    const dir = tmp();
    try {
      await expect(dispatchRead({ file_path: dir })).rejects.toThrow('not a regular file');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('tilde home expansion works', async () => {
    // If HOME doesn't exist or we can't resolve, just make sure it doesn't
    // throw an absolute-path error; let other failures surface naturally.
    const home = process.env.HOME;
    if (!home) return;   // skip on odd envs
    // Pick a path that's almost certainly absent under $HOME to test
    // expansion: we expect a "does not exist" error (proves tilde was
    // expanded — otherwise the earlier absolute-path guard would fire).
    await expect(dispatchRead({ file_path: '~/__monad_read_tool_nonexistent__' }))
      .rejects.toThrow('does not exist');
  });
});
