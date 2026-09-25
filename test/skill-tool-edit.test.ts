// ── Edit tool tests ──

import { describe, test, expect } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildEditTool, dispatchEdit } from '../src/skills/tools/edit';

function tmp(): string { return mkdtempSync(join(tmpdir(), 'edit-tool-')); }

describe('buildEditTool — schema matches claude-code', () => {
  test('name is exactly "Edit"', () => {
    expect(buildEditTool().name).toBe('Edit');
  });

  test('required = [file_path, old_string, new_string]', () => {
    const schema = buildEditTool().parameters as any;
    expect(schema.required).toEqual(['file_path', 'old_string', 'new_string']);
    expect(schema.properties.replace_all.type).toBe('boolean');
  });
});

describe('dispatchEdit — happy path', () => {
  test('unique match → substitute + write + confirmation', async () => {
    const dir = tmp();
    try {
      const p = join(dir, 'a.txt');
      writeFileSync(p, 'alpha beta gamma');
      const r = await dispatchEdit({ file_path: p, old_string: 'beta', new_string: 'DELTA' });
      expect(r.replacements).toBe(1);
      expect(r.output).toContain('Edited');
      expect(r.output).toContain('Replaced 1 occurrence');
      expect(readFileSync(p, 'utf8')).toBe('alpha DELTA gamma');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('replace_all substitutes every occurrence', async () => {
    const dir = tmp();
    try {
      const p = join(dir, 'repeat.txt');
      writeFileSync(p, 'foo bar foo baz foo');
      const r = await dispatchEdit({
        file_path: p, old_string: 'foo', new_string: 'FOO', replace_all: true,
      });
      expect(r.replacements).toBe(3);
      expect(r.output).toContain('Replaced 3 occurrences');
      expect(readFileSync(p, 'utf8')).toBe('FOO bar FOO baz FOO');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('multi-line old_string works', async () => {
    const dir = tmp();
    try {
      const p = join(dir, 'ml.txt');
      writeFileSync(p, 'line1\nline2\nline3\n');
      const r = await dispatchEdit({
        file_path: p,
        old_string: 'line1\nline2',
        new_string: 'replaced-block',
      });
      expect(r.replacements).toBe(1);
      expect(readFileSync(p, 'utf8')).toBe('replaced-block\nline3\n');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('regex metacharacters in old_string treated as literals', async () => {
    // If Edit used regex under the hood, `.` would match any char and cause
    // wrong behavior. Verify literal semantics.
    const dir = tmp();
    try {
      const p = join(dir, 'regex.txt');
      writeFileSync(p, 'a.b AaB');
      const r = await dispatchEdit({ file_path: p, old_string: 'a.b', new_string: 'Z' });
      expect(r.replacements).toBe(1);
      // Only the literal "a.b" changed, "AaB" untouched.
      expect(readFileSync(p, 'utf8')).toBe('Z AaB');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('dispatchEdit — ambiguity protection (THE POINT of Edit vs sed)', () => {
  test('ambiguous match without replace_all rejected with helpful error', async () => {
    const dir = tmp();
    try {
      const p = join(dir, 'ambig.txt');
      writeFileSync(p, 'foo\nfoo\nfoo');
      await expect(
        dispatchEdit({ file_path: p, old_string: 'foo', new_string: 'X' })
      ).rejects.toThrow('matches 3 times');
      // File must NOT have been touched.
      expect(readFileSync(p, 'utf8')).toBe('foo\nfoo\nfoo');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('error message suggests replace_all or more context', async () => {
    const dir = tmp();
    try {
      const p = join(dir, 'a.txt');
      writeFileSync(p, 'x x x');
      try {
        await dispatchEdit({ file_path: p, old_string: 'x', new_string: 'Y' });
        throw new Error('should have thrown');
      } catch (err: any) {
        expect(err.message).toContain('replace_all');
        expect(err.message).toContain('surrounding context');
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('replace_all bypasses the ambiguity check', async () => {
    const dir = tmp();
    try {
      const p = join(dir, 'a.txt');
      writeFileSync(p, 'x x x');
      const r = await dispatchEdit({
        file_path: p, old_string: 'x', new_string: 'Y', replace_all: true,
      });
      expect(r.replacements).toBe(3);
      expect(readFileSync(p, 'utf8')).toBe('Y Y Y');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('dispatchEdit — error paths', () => {
  test('missing file_path throws', async () => {
    await expect(dispatchEdit({ old_string: 'a', new_string: 'b' }))
      .rejects.toThrow('file_path is required');
  });

  // C (RESEARCH-autonomous-runaway-discipline-2026-07-19 R3) — Edit used to
  // hard-reject relative paths ("must be absolute"); it now resolves them
  // against the session cwd, matching Read (read.ts) and Write (write.ts WD6).
  // codex/frontier models routinely emit relative paths; the old hard-reject
  // fed the doom-loop → HITL freeze.
  test('relative path resolves against session cwd (parity with Read/Write)', async () => {
    const { setSessionCwd, getSessionCwd } = await import('../src/session/working-dir');
    const dir = tmp();
    const prev = getSessionCwd();
    try {
      writeFileSync(join(dir, 'rel.txt'), 'alpha beta gamma');
      setSessionCwd(dir, 'tool');
      const r = await dispatchEdit({ file_path: 'rel.txt', old_string: 'beta', new_string: 'DELTA' });
      expect(r.replacements).toBe(1);
      expect(readFileSync(join(dir, 'rel.txt'), 'utf8')).toBe('alpha DELTA gamma');
    } finally {
      setSessionCwd(prev, 'tool');
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('empty old_string rejected (not a legit Edit operation)', async () => {
    const dir = tmp();
    try {
      const p = join(dir, 'a.txt');
      writeFileSync(p, 'hello');
      await expect(dispatchEdit({ file_path: p, old_string: '', new_string: 'X' }))
        .rejects.toThrow('cannot be empty');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('same-string no-op rejected', async () => {
    const dir = tmp();
    try {
      const p = join(dir, 'a.txt');
      writeFileSync(p, 'hello');
      await expect(dispatchEdit({ file_path: p, old_string: 'hi', new_string: 'hi' }))
        .rejects.toThrow('identical');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('old_string not present → descriptive error, file unchanged', async () => {
    const dir = tmp();
    try {
      const p = join(dir, 'a.txt');
      writeFileSync(p, 'hello world');
      await expect(dispatchEdit({ file_path: p, old_string: 'goodbye', new_string: 'X' }))
        .rejects.toThrow('not found');
      expect(readFileSync(p, 'utf8')).toBe('hello world');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('non-existent file throws', async () => {
    await expect(dispatchEdit({
      file_path: '/definitely/not/a/real/path.txt', old_string: 'a', new_string: 'b',
    })).rejects.toThrow('does not exist');
  });

  test('directory path rejected', async () => {
    const dir = tmp();
    try {
      await expect(dispatchEdit({ file_path: dir, old_string: 'a', new_string: 'b' }))
        .rejects.toThrow('not a regular file');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
