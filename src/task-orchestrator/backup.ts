/**
 * TOX backup helper — D6 (A) "1회 backup + fresh init" 프로토콜 codify.
 *
 * Origin: Phase 1 I0 (2026-05-12) — task-fabric-unified entry. Mission
 * entity (I6) 추가 + downstream schema 변경이 누적되기 전에 사용자가
 * 명시적으로 호출할 수 있는 안전 기본기.
 *
 * Responsibilities:
 *   - `backupTasksDb()` — 현 `~/.monad/tasks/tasks.db` 를 `~/.monad/backups/
 *     tasks-YYYY-MM-DD[-N].db` 로 복사 (collision 시 -N suffix).
 *   - `rejuvenateTasksDb()` — backup 후 원본 삭제 (다음 boot 가 fresh
 *     schema 로 init). D6 (A) 의 1-call execution.
 *
 * Non-goals:
 *   - 실 migration (그건 D6 (B) — 별도 PR).
 *   - WAL/SHM auxiliary file 까지 backup (sqlite 가 boot 시 합쳐주므로
 *     주 .db 만 보존 = 회복 안전 · disk 절약).
 */
import { copyFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { getMonadConfigDir } from '../monad-config-dir.js';
import { tasksDbPath } from './paths.js';

/**
 * Default backups root — `<config-dir>/backups/`.
 *
 * Priority:
 *   1. env `MONAD_BACKUPS_DIR` (legacy fallback only · retired as a
 *      documented surface 2026-05-12 FU8 PR #4 · still honoured so
 *      pre-FU8 callers / CI pipelines that pin an explicit backups
 *      dir keep working without churn).
 *   2. `<getMonadConfigDir()>/backups` — routes through `--config-dir`.
 *      Default `~/.monad/backups` when no override.
 */
export function backupsRoot(): string {
  const env = process.env.MONAD_BACKUPS_DIR;
  if (env && env.length > 0) return env;
  return join(getMonadConfigDir(), 'backups');
}

/** Format a date as `YYYY-MM-DD` (UTC date is fine for filename purpose). */
function isoDate(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Resolve the next non-colliding backup path for a given date. */
function nextBackupPath(dir: string, date: string): string {
  const base = join(dir, `tasks-${date}.db`);
  if (!existsSync(base)) return base;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = join(dir, `tasks-${date}-${n}.db`);
    if (!existsSync(candidate)) return candidate;
  }
  // Fallback — astronomically unlikely. Caller can decide what to do.
  throw new Error(`backup path collision: 1000 entries already exist for ${date}`);
}

export interface BackupResult {
  /** `true` when a file was copied; `false` when source did not exist. */
  copied: boolean;
  /** Source path inspected. */
  source: string;
  /** Target path written (only set when `copied === true`). */
  target?: string;
}

/**
 * Copy the current TOX DB to `<backupsRoot>/tasks-YYYY-MM-DD.db`.
 * Returns `{ copied: false }` when the source does not exist (idempotent).
 */
export function backupTasksDb(
  opts: { now?: () => Date; sourcePath?: string; targetDir?: string } = {},
): BackupResult {
  const source = opts.sourcePath ?? tasksDbPath();
  if (!existsSync(source)) return { copied: false, source };
  const dir = opts.targetDir ?? backupsRoot();
  mkdirSync(dir, { recursive: true });
  const target = nextBackupPath(dir, isoDate(opts.now?.() ?? new Date()));
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
  return { copied: true, source, target };
}

export interface RejuvenateResult extends BackupResult {
  /** `true` when the source file was deleted after backup. */
  rejuvenated: boolean;
}

/**
 * D6 (A) — backup the current DB, then delete it so the next TOX boot
 * starts on a fresh schema. Safe to call when no DB exists yet
 * (no-op, returns `{ copied: false, rejuvenated: false }`).
 *
 * The WAL / SHM sibling files are also unlinked when present so the
 * fresh boot does not inherit half-flushed state.
 */
export function rejuvenateTasksDb(
  opts: { now?: () => Date; sourcePath?: string; targetDir?: string } = {},
): RejuvenateResult {
  const backup = backupTasksDb(opts);
  if (!backup.copied) {
    return { ...backup, rejuvenated: false };
  }
  unlinkSync(backup.source);
  for (const suffix of ['-wal', '-shm'] as const) {
    const sibling = `${backup.source}${suffix}`;
    if (existsSync(sibling)) {
      try {
        unlinkSync(sibling);
      } catch {
        // Tolerate — main file already gone, sibling cleanup is best-effort.
      }
    }
  }
  return { ...backup, rejuvenated: true };
}
