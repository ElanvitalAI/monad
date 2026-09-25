import { describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runArchive } from '../src/preview/handlers/archive.js';
import { runFolder } from '../src/preview/handlers/folder.js';
import type { HandlerDeps } from '../src/preview/handlers/common.js';

interface SpawnRecord { cmd: string; args: string[] }
function mkDeps(opts: {
  which: (cmd: string) => string | null;
  status?: number;
  stdout?: string;
  stderr?: string;
}): [Required<HandlerDeps>, SpawnRecord[]] {
  const calls: SpawnRecord[] = [];
  const deps = {
    which: opts.which,
    spawn: (cmd: string, args: string[]) => {
      calls.push({ cmd, args });
      return {
        status: opts.status ?? 0,
        stderr: opts.stderr ?? '',
        stdout: opts.stdout ?? '',
      };
    },
    exists: () => false,
  };
  return [deps, calls];
}

const tmp = mkdtempSync(join(tmpdir(), 'preview-archive-folder-'));

// ── Archive ──────────────────────────────────────────────────────
describe('runArchive', () => {
  const sampleFile = join(tmp, 'sample.zip');
  writeFileSync(sampleFile, 'x');

  test('missing 7zz/7z → install hint', () => {
    const [deps] = mkDeps({ which: () => null });
    const r = runArchive(sampleFile, {}, deps);
    expect(r.kind).toBe('lines');
    if (r.kind !== 'lines') throw new Error('unreachable');
    expect(r.lines.some(l => l.includes('brew install sevenzip'))).toBe(true);
  });

  test('prefers 7zz over 7z', () => {
    const [deps, calls] = mkDeps({
      which: (cmd) => cmd === '7zz' ? '/bin/7zz' : '/bin/7z',
      stdout: '',
    });
    runArchive(sampleFile, {}, deps);
    expect(calls[0]!.cmd).toBe('/bin/7zz');
    expect(calls[0]!.args).toEqual(['l', '-ba', sampleFile]);
  });

  test('parses 7zz l -ba output (path + size, dirs marked)', () => {
    const stdout = [
      '2026-04-01 21:17:48 .....           23           23  .gitignore',
      '2026-04-01 21:21:33 .....        16407         3378  package-lock.json',
      '2026-04-01 21:43:54 D....            0            0  scripts',
      '2026-04-01 21:43:54 .....        13208         4108  scripts/main.ts',
    ].join('\n');
    const [deps] = mkDeps({ which: () => '/bin/7zz', stdout });
    const r = runArchive(sampleFile, {}, deps);
    expect(r.kind).toBe('lines');
    if (r.kind !== 'lines') throw new Error('unreachable');
    const joined = r.lines.join('|');
    expect(joined).toContain('.gitignore');
    expect(joined).toContain('scripts/');  // dir marker
    expect(joined).toContain('scripts/main.ts');
    expect(joined).toContain('4 entries');
    expect(joined).toContain('1 dirs');
  });

  test('7zz failure → error lines', () => {
    const [deps] = mkDeps({
      which: () => '/bin/7zz',
      status: 2,
      stderr: 'Cannot open: Not a zip',
    });
    const r = runArchive(sampleFile, {}, deps);
    expect(r.kind).toBe('lines');
    if (r.kind !== 'lines') throw new Error('unreachable');
    expect(r.lines.some(l => l.includes('7zz list failed'))).toBe(true);
  });
});

// ── Folder ───────────────────────────────────────────────────────
describe('runFolder', () => {
  const sampleDir = (() => {
    const d = join(tmp, 'folder-sample');
    mkdirSync(d);
    mkdirSync(join(d, 'sub'));
    writeFileSync(join(d, 'a.ts'), 'x');
    writeFileSync(join(d, 'b.md'), 'y');
    writeFileSync(join(d, 'sub', 'nested.json'), '{}');
    return d;
  })();

  test('uses eza when available', () => {
    const fakeTree = [
      'folder-sample',
      '├── a.ts',
      '├── b.md',
      '└── sub',
      '    └── nested.json',
    ].join('\n');
    const [deps, calls] = mkDeps({
      which: (cmd) => cmd === 'eza' ? '/bin/eza' : null,
      stdout: fakeTree,
    });
    const r = runFolder(sampleDir, {}, deps);
    expect(r.kind).toBe('lines');
    if (r.kind !== 'lines') throw new Error('unreachable');
    expect(calls[0]!.cmd).toBe('/bin/eza');
    expect(calls[0]!.args).toContain('--tree');
    expect(calls[0]!.args).toContain('-L');
    expect(r.lines.some(l => l.includes('nested.json'))).toBe(true);
  });

  test('falls back to native readdir when eza missing', () => {
    const [deps, calls] = mkDeps({ which: () => null });
    const r = runFolder(sampleDir, {}, deps);
    expect(r.kind).toBe('lines');
    if (r.kind !== 'lines') throw new Error('unreachable');
    expect(calls).toHaveLength(0);
    const joined = r.lines.join('|');
    expect(joined).toContain('a.ts');
    expect(joined).toContain('b.md');
    expect(joined).toContain('sub/');
    // Directories sort before files in native fallback.
    const subIdx = r.lines.findIndex(l => l.includes('sub/'));
    const aIdx = r.lines.findIndex(l => l.includes('a.ts'));
    expect(subIdx).toBeLessThan(aIdx);
  });

  test('native fallback handles unreadable directory', () => {
    const [deps] = mkDeps({ which: () => null });
    const r = runFolder('/definitely/does/not/exist/xyzzy', {}, deps);
    expect(r.kind).toBe('lines');
    if (r.kind !== 'lines') throw new Error('unreachable');
    expect(r.lines.some(l => l.includes('unable to read'))).toBe(true);
  });

  test('eza failure surfaces stderr', () => {
    const [deps] = mkDeps({
      which: (cmd) => cmd === 'eza' ? '/bin/eza' : null,
      status: 1,
      stderr: 'eza: permission denied',
    });
    const r = runFolder(sampleDir, {}, deps);
    expect(r.kind).toBe('lines');
    if (r.kind !== 'lines') throw new Error('unreachable');
    expect(r.lines.some(l => l.includes('eza failed'))).toBe(true);
  });
});
