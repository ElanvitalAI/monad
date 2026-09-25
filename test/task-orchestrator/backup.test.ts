// Phase 1 I0 — TOX backup helper unit tests.

import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { backupTasksDb, rejuvenateTasksDb } from '../../src/task-orchestrator/backup.ts';

function makeTempEnv(seed: string): { sourcePath: string; targetDir: string; root: string } {
  const root = mkdtempSync(join(tmpdir(), 'tox-backup-'));
  const tasksDir = join(root, 'tasks');
  const backupsDir = join(root, 'backups');
  mkdirSync(tasksDir, { recursive: true });
  const sourcePath = join(tasksDir, 'tasks.db');
  writeFileSync(sourcePath, seed);
  return { sourcePath, targetDir: backupsDir, root };
}

const fixedNow = () => new Date('2026-05-12T08:00:00Z');

describe('backupTasksDb', () => {
  test('copies source DB into target dir with YYYY-MM-DD filename', () => {
    const { sourcePath, targetDir } = makeTempEnv('seed-1');
    const res = backupTasksDb({ sourcePath, targetDir, now: fixedNow });
    expect(res.copied).toBe(true);
    expect(res.target).toBe(join(targetDir, 'tasks-2026-05-12.db'));
    expect(readFileSync(res.target!, 'utf8')).toBe('seed-1');
    // Source must remain untouched.
    expect(existsSync(sourcePath)).toBe(true);
  });

  test('appends -N suffix on same-day collision', () => {
    const { sourcePath, targetDir } = makeTempEnv('seed-2');
    backupTasksDb({ sourcePath, targetDir, now: fixedNow });
    writeFileSync(sourcePath, 'seed-2-updated');
    const second = backupTasksDb({ sourcePath, targetDir, now: fixedNow });
    expect(second.target).toBe(join(targetDir, 'tasks-2026-05-12-2.db'));
    expect(readFileSync(second.target!, 'utf8')).toBe('seed-2-updated');
  });

  test('returns copied=false when source is missing', () => {
    const { targetDir } = makeTempEnv('seed-3');
    const res = backupTasksDb({
      sourcePath: '/nonexistent/path/tasks.db',
      targetDir,
      now: fixedNow,
    });
    expect(res.copied).toBe(false);
    expect(res.target).toBeUndefined();
  });
});

describe('rejuvenateTasksDb', () => {
  test('backs up then deletes the source file (D6 A)', () => {
    const { sourcePath, targetDir } = makeTempEnv('seed-rj');
    const res = rejuvenateTasksDb({ sourcePath, targetDir, now: fixedNow });
    expect(res.copied).toBe(true);
    expect(res.rejuvenated).toBe(true);
    expect(existsSync(sourcePath)).toBe(false);
    expect(readFileSync(res.target!, 'utf8')).toBe('seed-rj');
  });

  test('cleans up WAL/SHM siblings when present', () => {
    const { sourcePath, targetDir } = makeTempEnv('seed-wal');
    writeFileSync(`${sourcePath}-wal`, 'wal-bytes');
    writeFileSync(`${sourcePath}-shm`, 'shm-bytes');
    const res = rejuvenateTasksDb({ sourcePath, targetDir, now: fixedNow });
    expect(res.rejuvenated).toBe(true);
    expect(existsSync(`${sourcePath}-wal`)).toBe(false);
    expect(existsSync(`${sourcePath}-shm`)).toBe(false);
  });

  test('no-op when source missing', () => {
    const { targetDir } = makeTempEnv('seed-missing');
    const res = rejuvenateTasksDb({
      sourcePath: '/nonexistent/path/tasks.db',
      targetDir,
      now: fixedNow,
    });
    expect(res.copied).toBe(false);
    expect(res.rejuvenated).toBe(false);
  });
});
