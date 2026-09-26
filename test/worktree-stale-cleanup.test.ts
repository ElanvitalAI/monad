// ── Stale worktree-session cleanup (GT6) ──

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  cleanupStaleWorktreeSessions,
  isPidAlive,
} from '../src/git-fs/worktree';

// Redirect HOME to a tmp dir so the cleanup hits a test sandbox
// instead of the real ~/.elanous/worktrees/.
const savedHome = process.env.HOME;
let tmpHome: string;
let worktreeDir: string;

function writeSessionFile(name: string, contents = '{}'): string {
  const p = join(worktreeDir, name);
  writeFileSync(p, contents, 'utf8');
  return p;
}

describe('cleanupStaleWorktreeSessions', () => {
  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'gt6-home-'));
    process.env.HOME = tmpHome;
    worktreeDir = join(tmpHome, '.elanous', 'worktrees');
    // Exercise the "dir doesn't exist yet" path by default.
  });

  afterEach(() => {
    if (savedHome === undefined) delete process.env.HOME;
    else process.env.HOME = savedHome;
    try { rmSync(tmpHome, { recursive: true, force: true }); } catch {}
  });

  test('dir does not exist → zero counts', () => {
    const r = cleanupStaleWorktreeSessions();
    expect(r).toEqual({ scanned: 0, removed: 0, kept: 0 });
  });

  // The "alive pid is kept" / "dead pid is removed" / mix cases
  // all need the worktrees dir to exist — handled in the nested
  // describe below.

  describe('with an existing dir', () => {
    beforeEach(() => {
      const dirPath = worktreeDir;
      rmSync(dirPath, { recursive: true, force: true });
      // Create via node:fs.
      const fs = require('node:fs');
      fs.mkdirSync(dirPath, { recursive: true });
    });

    test('alive pid (this process) kept', () => {
      writeSessionFile(`${process.pid}.json`);
      const r = cleanupStaleWorktreeSessions();
      expect(r.scanned).toBe(1);
      expect(r.kept).toBeGreaterThanOrEqual(1);
      expect(r.removed).toBe(0);
      expect(existsSync(join(worktreeDir, `${process.pid}.json`))).toBe(true);
    });

    test('dead pid is removed', () => {
      // Pick a pid that's extremely unlikely to exist. 2^31-2 is
      // near the Linux/macOS pid_max ceiling; well above any real
      // process. Skip the test if — by cosmic misfortune — it IS
      // alive.
      const deadPid = 2_147_483_646;
      if (isPidAlive(deadPid)) return;
      writeSessionFile(`${deadPid}.json`);
      const r = cleanupStaleWorktreeSessions();
      expect(r.removed).toBe(1);
      expect(existsSync(join(worktreeDir, `${deadPid}.json`))).toBe(false);
    });

    test('non-pid filenames are kept (forward-compat)', () => {
      writeSessionFile('custom-session.json', '{"branch":"x"}');
      writeSessionFile('hello.txt');
      const r = cleanupStaleWorktreeSessions();
      // .txt is not .json so it doesn't count toward scanned; it's kept.
      // custom-session.json has a non-numeric stem so it's scanned-but-kept.
      expect(r.scanned).toBe(1);
      expect(r.removed).toBe(0);
      expect(existsSync(join(worktreeDir, 'custom-session.json'))).toBe(true);
      expect(existsSync(join(worktreeDir, 'hello.txt'))).toBe(true);
    });

    test('mix — alive + dead together', () => {
      const deadPid = 2_147_483_645;
      if (isPidAlive(deadPid)) return;
      writeSessionFile(`${process.pid}.json`);
      writeSessionFile(`${deadPid}.json`);
      const r = cleanupStaleWorktreeSessions();
      expect(r.scanned).toBe(2);
      expect(r.removed).toBe(1);
      expect(r.kept).toBeGreaterThanOrEqual(1);
      expect(existsSync(join(worktreeDir, `${process.pid}.json`))).toBe(true);
      expect(existsSync(join(worktreeDir, `${deadPid}.json`))).toBe(false);
    });

    test('negative + zero + non-numeric stems are kept untouched', () => {
      writeSessionFile('-1.json');
      writeSessionFile('0.json');
      writeSessionFile('abc.json');
      const r = cleanupStaleWorktreeSessions();
      expect(r.removed).toBe(0);
      expect(readdirSync(worktreeDir).sort()).toEqual(['-1.json', '0.json', 'abc.json']);
    });
  });
});

describe('isPidAlive', () => {
  test('current pid → true', () => {
    expect(isPidAlive(process.pid)).toBe(true);
  });
  test('zero / negative → false', () => {
    expect(isPidAlive(0)).toBe(false);
    expect(isPidAlive(-1)).toBe(false);
  });
  test('NaN → false', () => {
    expect(isPidAlive(Number.NaN)).toBe(false);
  });
  test('definitely-dead pid → false (probabilistic — skipped if alive)', () => {
    const deadPid = 2_147_483_644;
    if (isPidAlive(deadPid)) return;
    expect(isPidAlive(deadPid)).toBe(false);
  });
});
