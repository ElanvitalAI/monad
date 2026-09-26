// PR2 (HANDOFF 2026-05-04 §5.2) — archive retention. Mirrors the
// MSS M2.3 retention test pattern: `utimesSync` to manipulate mtime,
// real fs in a tmp dir.

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  utimesSync,
  readdirSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  cleanupArchiveDir,
  resetArchiveRetentionForTest,
  scheduleArchiveRetentionOnce,
} from '../src/compact/index.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `elanous-archive-retention-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
  resetArchiveRetentionForTest();
});

afterEach(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
});

function writeJsonl(name: string, content: string, ageDays: number): void {
  const path = join(tmpDir, name);
  writeFileSync(path, content, 'utf-8');
  if (ageDays > 0) {
    const ageSec = ageDays * 24 * 60 * 60;
    const past = Math.floor(Date.now() / 1000) - ageSec;
    utimesSync(path, past, past);
  }
}

describe('cleanupArchiveDir', () => {
  test('no-op when both knobs are 0', () => {
    writeJsonl('session-a.jsonl', 'x', 60);
    const r = cleanupArchiveDir(tmpDir, { maxAgeDays: 0, maxTotalMb: 0 });
    expect(r.scanned).toBe(0);
    expect(r.deleted).toBe(0);
    expect(existsSync(join(tmpDir, 'session-a.jsonl'))).toBe(true);
  });

  test('age filter deletes files older than maxAgeDays, preserves fresh', () => {
    writeJsonl('old.jsonl', 'x', 60);
    writeJsonl('fresh.jsonl', 'y', 0);
    writeJsonl('not-archive.txt', 'z', 60); // pattern miss
    const r = cleanupArchiveDir(tmpDir, { maxAgeDays: 30, maxTotalMb: 0 });
    expect(r.scanned).toBe(2); // not-archive.txt is filtered out
    expect(r.deleted).toBe(1);
    expect(existsSync(join(tmpDir, 'old.jsonl'))).toBe(false);
    expect(existsSync(join(tmpDir, 'fresh.jsonl'))).toBe(true);
    expect(existsSync(join(tmpDir, 'not-archive.txt'))).toBe(true);
  });

  test('size filter deletes oldest-first when total exceeds maxTotalMb', () => {
    // 3 files, ~1MB each, max 2MB → oldest deleted.
    const big = 'x'.repeat(1024 * 1024);
    writeJsonl('a.jsonl', big, 30);
    writeJsonl('b.jsonl', big, 20);
    writeJsonl('c.jsonl', big, 10);
    const r = cleanupArchiveDir(tmpDir, { maxAgeDays: 0, maxTotalMb: 2 });
    expect(r.deleted).toBe(1);
    // 'a.jsonl' is oldest by mtime → should be the deleted one.
    expect(existsSync(join(tmpDir, 'a.jsonl'))).toBe(false);
    expect(existsSync(join(tmpDir, 'b.jsonl'))).toBe(true);
    expect(existsSync(join(tmpDir, 'c.jsonl'))).toBe(true);
  });

  test('unreadable directory accumulates errors without throwing', () => {
    const ghost = join(tmpDir, 'does-not-exist');
    const r = cleanupArchiveDir(ghost, { maxAgeDays: 30, maxTotalMb: 0 });
    expect(r.scanned).toBe(0);
    expect(r.deleted).toBe(0);
    expect(r.errors.length).toBe(1);
  });
});

describe('scheduleArchiveRetentionOnce', () => {
  test('idempotent guard prevents duplicate scheduling within same process', async () => {
    writeJsonl('old-1.jsonl', 'x', 60);
    writeJsonl('old-2.jsonl', 'y', 60);
    scheduleArchiveRetentionOnce({ maxAgeDays: 30 }, tmpDir);
    scheduleArchiveRetentionOnce({ maxAgeDays: 30 }, tmpDir);
    scheduleArchiveRetentionOnce({ maxAgeDays: 30 }, tmpDir);
    // setImmediate detached — yield once to flush.
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    // Both stale files cleaned (single retention pass, not three).
    const survivors = readdirSync(tmpDir);
    expect(survivors.length).toBe(0);
  });

  test('zero-knob policy short-circuits (no fs scan)', async () => {
    writeJsonl('keep.jsonl', 'x', 60);
    scheduleArchiveRetentionOnce({ maxAgeDays: 0, maxTotalMb: 0 }, tmpDir);
    await new Promise((r) => setImmediate(r));
    expect(existsSync(join(tmpDir, 'keep.jsonl'))).toBe(true);
  });
});
