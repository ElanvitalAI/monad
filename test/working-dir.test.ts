// ── working-dir state + helpers (Phase 4a-v2: unified browser pane) ──

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  createWorkingDirState,
  readDirEntries,
  sortEntries,
  refreshWorkingDir,
  enterDirectory,
  toggleSelection,
  toggleSelectAll,
  attachTargets,
  focusedEntry,
  resolvePath,
  type FsEntry,
} from '../src/working-dir/index.js';

const ROOT = join(tmpdir(), `elanous-wd-test-${Date.now()}`);
const FILES = [
  ['a.txt',       'alpha'],
  ['b.md',        'bravo'],
  ['c.pdf',       'charlie'],
  ['.hidden.txt', 'secret'],
] as const;
const DIRS = ['sub-a', 'sub-b', '.hidden-dir'];

beforeAll(() => {
  mkdirSync(ROOT, { recursive: true });
  for (const d of DIRS) mkdirSync(join(ROOT, d), { recursive: true });
  for (const [name, body] of FILES) writeFileSync(join(ROOT, name), body);
});

afterAll(() => {
  try { rmSync(ROOT, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('readDirEntries', () => {
  test('createWorkingDirState starts with input focus', () => {
    expect(createWorkingDirState(ROOT).focus).toBe('input');
  });

  test('filters dotfiles when showHidden=false', () => {
    const { folders, files } = readDirEntries(ROOT, false);
    expect(folders.map(f => f.name).sort()).toEqual(['sub-a', 'sub-b']);
    expect(files.map(f => f.name).sort()).toEqual(['a.txt', 'b.md', 'c.pdf']);
  });

  test('includes dotfiles when showHidden=true', () => {
    const { folders, files } = readDirEntries(ROOT, true);
    expect(folders.map(f => f.name).sort()).toEqual(['.hidden-dir', 'sub-a', 'sub-b']);
    expect(files.map(f => f.name).sort()).toEqual(['.hidden.txt', 'a.txt', 'b.md', 'c.pdf']);
  });

  test('captures ext + size for files, 0 size + "" ext for dirs', () => {
    const { folders, files } = readDirEntries(ROOT, false);
    const md = files.find(f => f.name === 'b.md')!;
    expect(md.ext).toBe('md');
    expect(md.size).toBe(5); // 'bravo'
    const sub = folders.find(f => f.name === 'sub-a')!;
    expect(sub.isDir).toBe(true);
    expect(sub.ext).toBe('');
    expect(sub.size).toBe(0);
  });

  test('returns empty arrays for an unreadable dir instead of throwing', () => {
    const out = readDirEntries(join(ROOT, 'does-not-exist'), false);
    expect(out.folders).toEqual([]);
    expect(out.files).toEqual([]);
  });
});

describe('sortEntries', () => {
  const mk = (name: string, isDir: boolean, ext: string, size: number, mtime: number): FsEntry => ({
    name, absPath: `/${name}`, isDir, ext, size, mtime,
  });

  test('name sort puts dirs first then alphabetical', () => {
    const sorted = sortEntries([
      mk('zeta.txt', false, 'txt', 0, 0),
      mk('alpha', true, '', 0, 0),
      mk('beta.md', false, 'md', 0, 0),
      mk('gamma', true, '', 0, 0),
    ], 'name');
    expect(sorted.map(e => e.name)).toEqual(['alpha', 'gamma', 'beta.md', 'zeta.txt']);
  });

  test('mtime sort is descending', () => {
    const sorted = sortEntries([
      mk('old', false, '', 0, 100),
      mk('new', false, '', 0, 300),
      mk('mid', false, '', 0, 200),
    ], 'mtime');
    expect(sorted.map(e => e.name)).toEqual(['new', 'mid', 'old']);
  });

  test('size sort is descending and dirs (size 0) sink to the bottom', () => {
    const sorted = sortEntries([
      mk('small', false, '', 10, 0),
      mk('big', false, '', 1000, 0),
      mk('mid', false, '', 100, 0),
    ], 'size');
    expect(sorted.map(e => e.name)).toEqual(['big', 'mid', 'small']);
  });

  test('type sort groups by extension after dirs', () => {
    const sorted = sortEntries([
      mk('b.txt', false, 'txt', 0, 0),
      mk('a.md', false, 'md', 0, 0),
      mk('dir', true, '', 0, 0),
      mk('c.md', false, 'md', 0, 0),
    ], 'type');
    expect(sorted.map(e => e.name)).toEqual(['dir', 'a.md', 'c.md', 'b.txt']);
  });
});

describe('refreshWorkingDir (unified entries)', () => {
  test('builds entries with `..` first, then folders, then files', () => {
    const s = createWorkingDirState(ROOT);
    refreshWorkingDir(s);
    expect(s.entries[0]!.name).toBe('..');
    expect(s.entries[0]!.isDir).toBe(true);
    // After `..`: folders sub-a, sub-b, then files a.txt, b.md, c.pdf
    expect(s.entries.slice(1).map(e => e.name)).toEqual([
      'sub-a', 'sub-b', 'a.txt', 'b.md', 'c.pdf',
    ]);
  });

  test('showHidden=true adds dotfiles in both halves', () => {
    const s = createWorkingDirState(ROOT);
    s.showHidden = true;
    refreshWorkingDir(s);
    expect(s.entries.some(e => e.name === '.hidden-dir' && e.isDir)).toBe(true);
    expect(s.entries.some(e => e.name === '.hidden.txt' && !e.isDir)).toBe(true);
  });

  test('prunes selection entries that no longer exist', () => {
    const s = createWorkingDirState(ROOT);
    refreshWorkingDir(s);
    const firstFile = s.entries.find(e => !e.isDir)!;
    s.selected.add('/no/longer/here.txt');
    s.selected.add(firstFile.absPath);
    refreshWorkingDir(s);
    expect(s.selected.has('/no/longer/here.txt')).toBe(false);
    expect(s.selected.has(firstFile.absPath)).toBe(true);
  });
});

describe('enterDirectory + cursor', () => {
  test('changes cwd + resets cursor + clears selection', () => {
    const s = createWorkingDirState(ROOT);
    refreshWorkingDir(s);
    s.cursor = 2;
    const firstFile = s.entries.find(e => !e.isDir)!;
    s.selected.add(firstFile.absPath);
    enterDirectory(s, join(ROOT, 'sub-a'));
    expect(s.cwd).toBe(join(ROOT, 'sub-a'));
    expect(s.cursor).toBe(0);
    expect(s.selected.size).toBe(0);
  });
});

describe('toggleSelection / toggleSelectAll / attachTargets / focusedEntry', () => {
  test('Space toggle works on files and is a no-op on folders / `..`', () => {
    const s = createWorkingDirState(ROOT);
    refreshWorkingDir(s);

    // entries[0] is `..` (folder) → no-op
    toggleSelection(s, 0);
    expect(s.selected.size).toBe(0);

    // entries[1] is a folder (sub-a) → still no-op
    toggleSelection(s, 1);
    expect(s.selected.size).toBe(0);

    // First non-dir entry (a.txt at index 3 after `..`+sub-a+sub-b)
    const fileIdx = s.entries.findIndex(e => !e.isDir);
    expect(fileIdx).toBeGreaterThan(0);
    toggleSelection(s, fileIdx);
    expect(s.selected.has(s.entries[fileIdx]!.absPath)).toBe(true);

    // Toggle again clears
    toggleSelection(s, fileIdx);
    expect(s.selected.size).toBe(0);
  });

  test('attachTargets prefers selection over cursor, otherwise cursor file', () => {
    const s = createWorkingDirState(ROOT);
    refreshWorkingDir(s);
    const fileIdx = s.entries.findIndex(e => !e.isDir);
    s.cursor = fileIdx;
    expect(attachTargets(s)).toEqual([s.entries[fileIdx]!.absPath]);

    // Add a different file to selection — selection wins
    const otherFile = s.entries.findIndex((e, i) => i > fileIdx && !e.isDir);
    expect(otherFile).toBeGreaterThan(0);
    toggleSelection(s, otherFile);
    expect(attachTargets(s)).toEqual([s.entries[otherFile]!.absPath]);

    // Cursor on a folder + no selection → empty targets
    s.selected.clear();
    s.cursor = 0; // `..`
    expect(attachTargets(s)).toEqual([]);
  });

  test('toggleSelectAll selects only files, ignores folders, then clears', () => {
    const s = createWorkingDirState(ROOT);
    refreshWorkingDir(s);
    const fileCount = s.entries.filter(e => !e.isDir).length;

    toggleSelectAll(s);
    expect(s.selected.size).toBe(fileCount);
    // No folder absPath should be in the selection
    for (const e of s.entries) {
      if (e.isDir) expect(s.selected.has(e.absPath)).toBe(false);
    }

    // Second call clears
    toggleSelectAll(s);
    expect(s.selected.size).toBe(0);
  });

  test('focusedEntry returns the entry under the cursor or null', () => {
    const s = createWorkingDirState(ROOT);
    refreshWorkingDir(s);
    s.cursor = 0;
    expect(focusedEntry(s)?.name).toBe('..');
    s.cursor = s.entries.length - 1;
    expect(focusedEntry(s)?.isDir).toBe(false);
    s.cursor = 9999;
    expect(focusedEntry(s)).toBeNull();
  });
});

describe('resolvePath', () => {
  test('abs stays abs, ~/x → homedir, relative uses cwd', () => {
    expect(resolvePath('/abs/x.md')).toBe('/abs/x.md');
    expect(resolvePath('~/').endsWith('/')).toBe(false);       // returns homedir (no trailing /)
    expect(resolvePath('./foo', '/tmp')).toBe('/tmp/foo');
  });
});
