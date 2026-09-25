// R6 v2 follow-up (2026-05-09) — per-day metrics bucket store.
//
// Why: NotesMetricsCollector v1 was lifetime-since-boot only. Daily
// reflection v1 reported live counters when `date === today`, but
// after daemon restart today's count went back to 0 and historical
// queries (yesterday, last week) always returned 0. R6 v2's daily
// push surfaces this gap — a 21:00 push reading "노트 0" right after
// a fresh boot is misleading.
//
// Design:
//   - JSON file at `<nexusRoot>/notes-day-buckets.json` (atomic write)
//   - Schema: { "YYYY-MM-DD": { ocr: { total, failures }, save: ... } }
//   - Bucket trim: keep last N days (default 90) — file stays small
//   - S3 sync (opt-in · isS3Available gate): pull on boot · push on
//     every write (best-effort · failure logged not thrown). Path:
//     `s3://<bucket>/monad/<monad_id>/notes-metrics/day-buckets.json`
//     (see `src/storage/s3.ts` for the canonical layout).
//
// Concurrency: a single daemon process owns the file. The atomic
// write (temp → rename) is good enough for the dogfood horizon. No
// inter-process locking — same as `web-push/subscriptions.json`.
// S3 push is best-effort; concurrent multi-device writes can race
// (cross-device merge is future work, see `s3.ts` doc).
//
// Cross-ref:
//   src/notes/metrics.ts (consumer · injects this store via opts)
//   src/notes/daily-reflection.ts (consumer · reads past-date counts)
//   src/storage/s3.ts (S3 helper · folder layout SoT)

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, join as joinPath } from 'node:path';
import { nexusRootDir } from '../nexus/paths.js';
import {
  s3MonadKey,
  isS3Available,
  uploadFile,
  downloadFile,
  objectExists,
} from '../storage/s3.js';
import { debug } from '../debug/log.js';

const DEFAULT_KEEP_DAYS = 90;

export interface DayBucketCounts {
  ocr: { total: number; failures: number };
  save: { total: number; failures: number };
}

interface DayBucketFile {
  version: 1;
  buckets: Record<string, DayBucketCounts>;
}

function emptyCounts(): DayBucketCounts {
  return {
    ocr: { total: 0, failures: 0 },
    save: { total: 0, failures: 0 },
  };
}

export interface DayBucketStore {
  /** Read counts for a given YYYY-MM-DD key. Returns zero counts
   *  when the bucket doesn't exist (caller doesn't need null guards). */
  get(date: string): DayBucketCounts;
  /** Atomic bump for OCR (success or failure). Persists to disk. */
  bumpOcr(date: string, ok: boolean): void;
  /** Atomic bump for save (success or failure). Persists to disk. */
  bumpSave(date: string, ok: boolean): void;
  /** Active bucket dates (sorted ASC). For dogfood `--status`. */
  dates(): string[];
}

interface FactoryOpts {
  /** Directory holding the bucket file. Defaults to nexusRootDir(). */
  dir?: string;
  /** Trim window — older buckets dropped on next write. */
  keepDays?: number;
  /** Test seam — wall-clock for trim cutoff. */
  now?: () => number;
  /** Disable S3 sync entirely (tests + offline dogfood). When false,
   *  the store still degrades gracefully if `isS3Available()` returns
   *  false at runtime (no aws CLI / no creds / MONAD_S3_DISABLED=1).
   *  Default: false (S3 sync active when CLI + creds present). */
  s3Disabled?: boolean;
  /** Test seam — replace the S3 transport. Production uses the
   *  real `aws s3 cp` shell-out from `src/storage/s3.ts`. */
  s3Transport?: {
    available: () => boolean;
    upload: (localPath: string, key: string) => void;
    download: (key: string, localPath: string) => void;
    objectExists: (key: string) => boolean;
  };
}

function bucketFilePath(dir: string): string {
  return joinPath(dir, 'notes-day-buckets.json');
}

function readFile(path: string): DayBucketFile {
  if (!existsSync(path)) return { version: 1, buckets: {} };
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as Partial<DayBucketFile>;
    if (parsed && typeof parsed === 'object' && parsed.buckets) {
      return { version: 1, buckets: parsed.buckets };
    }
  } catch {
    // Corrupt file → start fresh. The daemon log captures the warn
    // via the calling site; we don't crash boot over a metric file.
  }
  return { version: 1, buckets: {} };
}

function writeFileAtomic(path: string, file: DayBucketFile): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(file, null, 2), 'utf8');
  renameSync(tmp, path);
}

function dayKeyMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function trim(file: DayBucketFile, keepDays: number, nowMs: number): DayBucketFile {
  const cutoffMs = nowMs - keepDays * 24 * 60 * 60 * 1000;
  const cutoffKey = dayKeyMs(cutoffMs);
  const next: Record<string, DayBucketCounts> = {};
  for (const [k, v] of Object.entries(file.buckets)) {
    if (k >= cutoffKey) next[k] = v;
  }
  return { version: 1, buckets: next };
}

/** Build a day-bucket store. `dir` defaults to `nexusRootDir()` so
 *  production callers do not need to spell the path. Tests pass a
 *  temp dir via opts. */
export function createDayBucketStore(opts: FactoryOpts = {}): DayBucketStore {
  const dir = opts.dir ?? nexusRootDir();
  const keepDays = opts.keepDays ?? DEFAULT_KEEP_DAYS;
  const now = opts.now ?? Date.now;
  const path = bucketFilePath(dir);
  const s3 = opts.s3Transport ?? {
    available: isS3Available,
    upload: uploadFile,
    download: downloadFile,
    objectExists,
  };
  const s3Active = !opts.s3Disabled && s3.available();
  const s3Key = s3MonadKey('notesMetrics', 'day-buckets.json');

  // Boot-time pull from S3: when the local file is missing but the
  // remote object exists, hydrate the local cache before first read.
  // This is the cross-restart durability path — daemon reboot reads
  // yesterday's counts back from S3. Failures degrade silently to
  // "no remote yet" (same as fresh-install).
  if (s3Active && !existsSync(path) && s3.objectExists(s3Key)) {
    try {
      mkdirSync(dirname(path), { recursive: true });
      s3.download(s3Key, path);
      debug.log('day-bucket.s3.pulled', s3Key);
    } catch (e) {
      debug.log('day-bucket.s3.pull-error', s3Key, String(e), { level: 'error' });
    }
  }

  // Snapshot in-memory · persisted on every mutation. The file
  // grows linearly with active days (≤ keepDays * ~80B = 7KB worst-
  // case at 90-day keep · negligible).
  let file = readFile(path);

  const pushS3 = (): void => {
    if (!s3Active) return;
    try {
      s3.upload(path, s3Key);
    } catch (e) {
      // Best-effort — local write already committed, log + continue.
      debug.log('day-bucket.s3.push-error', s3Key, String(e), { level: 'error' });
    }
  };

  const bump = (date: string, kind: 'ocr' | 'save', ok: boolean): void => {
    const cur = file.buckets[date] ?? emptyCounts();
    if (kind === 'ocr') {
      cur.ocr.total += 1;
      if (!ok) cur.ocr.failures += 1;
    } else {
      cur.save.total += 1;
      if (!ok) cur.save.failures += 1;
    }
    file.buckets[date] = cur;
    file = trim(file, keepDays, now());
    writeFileAtomic(path, file);
    pushS3();
  };

  return {
    get(date) {
      const b = file.buckets[date];
      if (!b) return emptyCounts();
      // Defensive deep clone so mutations on returned object don't
      // poison the in-memory cache.
      return {
        ocr: { ...b.ocr },
        save: { ...b.save },
      };
    },
    bumpOcr(date, ok) { bump(date, 'ocr', ok); },
    bumpSave(date, ok) { bump(date, 'save', ok); },
    dates() {
      return Object.keys(file.buckets).sort();
    },
  };
}
