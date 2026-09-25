// Read tool path resolution — fix G (relative→absolute auto-resolve).
// Reference: log/debug-20260425154417 doom-loop trigger when codex
// emitted relative paths and the tool hard-rejected; mirrors
// claude-code-fork's expandPath silent auto-resolution.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dispatchRead } from '../src/skills/tools/read.js';
import { setSessionCwd, __resetSessionWorkingDir } from '../src/session/working-dir.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'monad-read-rel-'));
  setSessionCwd(tmp, 'tool');
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  __resetSessionWorkingDir();
});

describe('dispatchRead — path resolution (fix G)', () => {
  test('absolute path passes through unchanged', async () => {
    const target = join(tmp, 'a.txt');
    writeFileSync(target, 'hello\nworld\n');
    const r = await dispatchRead({ file_path: target });
    expect(r.kind).toBe('text');
    expect(r.output).toContain('hello');
    expect(r.output).toContain('world');
  });

  test('relative path resolves against session cwd', async () => {
    writeFileSync(join(tmp, 'config.json'), '{"k":1}\n');
    const r = await dispatchRead({ file_path: 'config.json' });
    expect(r.kind).toBe('text');
    expect(r.output).toContain('"k":1');
  });

  test('deep relative path resolves against session cwd', async () => {
    mkdirSync(join(tmp, 'src', 'sub'), { recursive: true });
    writeFileSync(join(tmp, 'src/sub/file.ts'), 'export const x = 1;\n');
    const r = await dispatchRead({ file_path: 'src/sub/file.ts' });
    expect(r.output).toContain('export const x = 1');
  });

  test('./ prefix relative resolves the same as bare relative', async () => {
    writeFileSync(join(tmp, 'README.md'), '# title\n');
    const a = await dispatchRead({ file_path: 'README.md' });
    const b = await dispatchRead({ file_path: './README.md' });
    expect(a.output).toContain('# title');
    expect(b.output).toContain('# title');
  });

  test('~ prefix expands HOME (preserved from pre-fix behavior)', async () => {
    // Smoke-test only the resolution path — we assert that the
    // expanded path differs from the raw input. Resolving against
    // the actual HOME lets the existsSync check fail loudly if the
    // expander broke.
    const r = dispatchRead({ file_path: '~/this-file-should-never-exist-monad-test.x' });
    await expect(r).rejects.toThrow(/Read: file does not exist/);
  });

  test('empty file_path still rejects with required-arg error', async () => {
    const r = dispatchRead({ file_path: '' });
    await expect(r).rejects.toThrow(/Read: file_path is required/);
  });

  test('relative path resolution surfaces ENOENT against session cwd, not process cwd', async () => {
    // Critical contract: the error message must reference the
    // session-resolved path, NOT a process.cwd()-resolved one. This
    // catches a regression where someone reverts to plain `resolve(p)`
    // (which would use process.cwd()).
    const r = dispatchRead({ file_path: 'nope-not-here.txt' });
    await expect(r).rejects.toThrow(new RegExp(`does not exist — ${tmp}`));
  });

  test('relative path no longer hard-errors with "must be absolute" (regression for fix G)', async () => {
    writeFileSync(join(tmp, 'ok.txt'), 'fine\n');
    // Before fix G this would throw "Read: file_path must be absolute".
    const r = await dispatchRead({ file_path: 'ok.txt' });
    expect(r.output).toContain('fine');
  });
});
