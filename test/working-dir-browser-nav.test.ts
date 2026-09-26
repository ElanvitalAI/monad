// ── Browser pane keyboard navigation primitives ──
//
// Pure helpers shared by the dashboard's default browser pane handler
// and the tablet `Ctrl+M B` Browser+Preview modal. Tests confirm the
// helpers refresh `entries` after a cd so callers can re-render
// without an extra explicit refresh, and that `..`-cursor / file-row
// edge cases behave as documented.

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import {
  createWorkingDirState,
  refreshWorkingDir,
} from '../src/working-dir/index.js';
import {
  browserNavParent,
  browserNavInto,
  browserNavEnter,
} from '../src/working-dir/browser-nav.js';

const ROOT = join(tmpdir(), `elanous-wd-nav-test-${Date.now()}`);
const CHILD = join(ROOT, 'child');

beforeAll(() => {
  mkdirSync(CHILD, { recursive: true });
  writeFileSync(join(ROOT, 'a-file.txt'), 'A');
  writeFileSync(join(CHILD, 'inner.txt'), 'inner');
});

afterAll(() => {
  try { rmSync(ROOT, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('browserNavParent', () => {
  test('cd to parent and refresh entries', () => {
    const wd = createWorkingDirState(CHILD);
    refreshWorkingDir(wd);
    expect(wd.cwd).toBe(CHILD);

    const changed = browserNavParent(wd);
    expect(changed).toBe(true);
    expect(wd.cwd).toBe(ROOT);
    // entries refreshed for ROOT — should include `child` directory.
    expect(wd.entries.some(e => e.name === 'child' && e.isDir)).toBe(true);
  });

  test('returns false at filesystem root (no-op)', () => {
    const wd = createWorkingDirState('/');
    refreshWorkingDir(wd);
    const before = wd.cwd;
    expect(browserNavParent(wd)).toBe(false);
    expect(wd.cwd).toBe(before);
  });
});

describe('browserNavInto', () => {
  test('cd into a folder under the cursor', () => {
    const wd = createWorkingDirState(ROOT);
    refreshWorkingDir(wd);

    // Find the index of the `child` folder.
    const idx = wd.entries.findIndex(e => e.name === 'child' && e.isDir);
    expect(idx).toBeGreaterThanOrEqual(0);
    wd.cursor = idx;

    expect(browserNavInto(wd)).toBe(true);
    expect(wd.cwd).toBe(CHILD);
  });

  test('returns false on a file row (no-op)', () => {
    const wd = createWorkingDirState(ROOT);
    refreshWorkingDir(wd);
    const idx = wd.entries.findIndex(e => e.name === 'a-file.txt' && !e.isDir);
    expect(idx).toBeGreaterThanOrEqual(0);
    wd.cursor = idx;

    const before = wd.cwd;
    expect(browserNavInto(wd)).toBe(false);
    expect(wd.cwd).toBe(before);
  });

  test('returns false on the `..` sentinel (parent nav goes through Left, not Right)', () => {
    const wd = createWorkingDirState(CHILD);
    refreshWorkingDir(wd);
    const idx = wd.entries.findIndex(e => e.name === '..');
    expect(idx).toBeGreaterThanOrEqual(0);
    wd.cursor = idx;
    expect(browserNavInto(wd)).toBe(false);
    expect(wd.cwd).toBe(CHILD);
  });
});

describe('browserNavEnter', () => {
  test('cd outcome on a folder row', () => {
    const wd = createWorkingDirState(ROOT);
    refreshWorkingDir(wd);
    const idx = wd.entries.findIndex(e => e.name === 'child' && e.isDir);
    wd.cursor = idx;

    const outcome = browserNavEnter(wd);
    expect(outcome.kind).toBe('cd');
    expect(wd.cwd).toBe(CHILD);
  });

  test('file outcome on a file row — caller decides what to do', () => {
    const wd = createWorkingDirState(ROOT);
    refreshWorkingDir(wd);
    const idx = wd.entries.findIndex(e => e.name === 'a-file.txt');
    wd.cursor = idx;

    const outcome = browserNavEnter(wd);
    expect(outcome.kind).toBe('file');
    if (outcome.kind === 'file') {
      expect(outcome.entry.name).toBe('a-file.txt');
    }
    // cwd stays put — Enter on a file does NOT cd.
    expect(wd.cwd).toBe(ROOT);
  });

  test('noop outcome on empty entries', () => {
    const wd = createWorkingDirState(dirname(ROOT));
    wd.entries = [];
    wd.cursor = 0;
    expect(browserNavEnter(wd).kind).toBe('noop');
  });
});
