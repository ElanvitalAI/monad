// ── Obsidian vault browser tests (Phase O3) ──
// Mirror the working-dir browser contract but with a vault-root clamp:
// navigation must stay inside `root` and `..` disappears at the root.

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  createObsidianDirState,
  refreshObsidianDir,
  enterObsidianDirectory,
  obsidianToggleSelection,
  obsidianToggleSelectAll,
  obsidianAttachTargets,
  obsidianFocusedEntry,
} from '../src/obsidian-dir.js';

let vaultRoot: string;
let notesDir: string;
let dailyDir: string;

beforeAll(() => {
  vaultRoot = mkdtempSync(join(tmpdir(), 'obsidian-test-'));
  notesDir = join(vaultRoot, 'notes');
  dailyDir = join(notesDir, 'daily');
  mkdirSync(notesDir);
  mkdirSync(dailyDir);
  writeFileSync(join(vaultRoot, 'README.md'), '# vault');
  writeFileSync(join(notesDir, 'idea.md'), '# idea');
  writeFileSync(join(notesDir, 'plan.md'), '# plan');
  writeFileSync(join(dailyDir, '2026-04-14.md'), 'today');
  writeFileSync(join(notesDir, '.hidden.md'), 'hidden');
});

afterAll(() => {
  rmSync(vaultRoot, { recursive: true, force: true });
});

describe('createObsidianDirState', () => {
  test('sets root = cwd and reports available=true for a real directory', () => {
    const s = createObsidianDirState(vaultRoot);
    expect(s.root).toBe(vaultRoot);
    expect(s.cwd).toBe(vaultRoot);
    expect(s.available).toBe(true);
    expect(s.entries).toEqual([]);
    expect(s.selected.size).toBe(0);
  });

  test('reports available=false for a missing directory', () => {
    const s = createObsidianDirState('/no/such/vault/here');
    expect(s.available).toBe(false);
  });
});

describe('refreshObsidianDir', () => {
  test('lists folders + files at the vault root without a `..` sentinel', () => {
    const s = createObsidianDirState(vaultRoot);
    refreshObsidianDir(s);
    const names = s.entries.map(e => e.name);
    expect(names).not.toContain('..');
    expect(names).toContain('notes');
    expect(names).toContain('README.md');
  });

  test('inserts `..` when below root and resolves it to the parent', () => {
    const s = createObsidianDirState(vaultRoot);
    enterObsidianDirectory(s, notesDir);
    refreshObsidianDir(s);
    expect(s.entries[0]?.name).toBe('..');
    expect(s.entries[0]?.absPath).toBe(vaultRoot);
  });

  test('filters hidden files by default, showHidden reveals them', () => {
    const s = createObsidianDirState(vaultRoot);
    enterObsidianDirectory(s, notesDir);
    refreshObsidianDir(s);
    expect(s.entries.find(e => e.name === '.hidden.md')).toBeUndefined();
    s.showHidden = true;
    refreshObsidianDir(s);
    expect(s.entries.find(e => e.name === '.hidden.md')).toBeDefined();
  });

  test('returns an empty list when available=false', () => {
    const s = createObsidianDirState('/no/such/vault');
    refreshObsidianDir(s);
    expect(s.entries).toEqual([]);
  });
});

describe('enterObsidianDirectory (vault clamp)', () => {
  test('descends into a subdirectory', () => {
    const s = createObsidianDirState(vaultRoot);
    enterObsidianDirectory(s, notesDir);
    expect(s.cwd).toBe(notesDir);
    expect(s.cursor).toBe(0);
    expect(s.selected.size).toBe(0);
  });

  test('ignores cd attempts above root', () => {
    const s = createObsidianDirState(vaultRoot);
    enterObsidianDirectory(s, '/etc');
    expect(s.cwd).toBe(vaultRoot); // unchanged
  });

  test('allows cd back to root', () => {
    const s = createObsidianDirState(vaultRoot);
    enterObsidianDirectory(s, notesDir);
    enterObsidianDirectory(s, vaultRoot);
    expect(s.cwd).toBe(vaultRoot);
  });
});

describe('selection helpers', () => {
  test('toggleSelection skips folders and the `..` sentinel', () => {
    const s = createObsidianDirState(vaultRoot);
    enterObsidianDirectory(s, notesDir);
    refreshObsidianDir(s);
    // entries[0] is `..`, entries[1] is the `daily/` folder
    obsidianToggleSelection(s, 0);
    obsidianToggleSelection(s, 1);
    expect(s.selected.size).toBe(0);
  });

  test('toggleSelectAll picks up every file and re-toggle clears', () => {
    const s = createObsidianDirState(vaultRoot);
    enterObsidianDirectory(s, notesDir);
    refreshObsidianDir(s);
    const fileCount = s.entries.filter(e => !e.isDir).length;
    obsidianToggleSelectAll(s);
    expect(s.selected.size).toBe(fileCount);
    obsidianToggleSelectAll(s);
    expect(s.selected.size).toBe(0);
  });

  test('attachTargets returns selection, or falls back to cursor file', () => {
    const s = createObsidianDirState(vaultRoot);
    refreshObsidianDir(s);
    const readmeIdx = s.entries.findIndex(e => e.name === 'README.md');
    s.cursor = readmeIdx;
    expect(obsidianAttachTargets(s)).toEqual([join(vaultRoot, 'README.md')]);
    obsidianToggleSelection(s);
    expect(obsidianAttachTargets(s)).toEqual([join(vaultRoot, 'README.md')]);
  });

  test('focusedEntry returns the entry at cursor or null', () => {
    const s = createObsidianDirState(vaultRoot);
    refreshObsidianDir(s);
    expect(obsidianFocusedEntry(s)?.name).toBe(s.entries[0]?.name);
    s.cursor = 999;
    expect(obsidianFocusedEntry(s)).toBeNull();
  });
});
