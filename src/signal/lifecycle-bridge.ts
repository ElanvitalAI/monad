import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ptyManifestDbPath } from '../pty-shell/pty-manifest.js';
import type { ChannelBus } from '../terminal-matrix/channel-bus.js';
import { subscribeRunLifecycle, validateLifecycleRecord, type LifecycleRecord } from './lifecycle-record.js';
import { publishLifecycleRootReport } from './lifecycle-root-report.js';

interface LifecycleRow {
  id: number;
  run_id: string;
  pty_id: string;
  subject_pty_id: string | null;
  seq: number;
  depth: number;
  role: string;
  at: number;
  class: string;
  name: string;
  transition: string | null;
  resumable: number | null;
  payload_json: string | null;
  truncated: number;
  truncated_fields_json: string | null;
}

let database: Database | null = null;

function db(): Database {
  if (database) return database;
  const path = ptyManifestDbPath();
  mkdirSync(dirname(path), { recursive: true });
  const next = new Database(path);
  next.run('PRAGMA journal_mode = WAL');
  next.run('PRAGMA busy_timeout = 2000');
  next.run(`CREATE TABLE IF NOT EXISTS lifecycle_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    pty_id TEXT NOT NULL,
    subject_pty_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    depth INTEGER NOT NULL,
    role TEXT NOT NULL,
    at INTEGER NOT NULL,
    class TEXT NOT NULL,
    name TEXT NOT NULL,
    transition TEXT,
    resumable INTEGER,
    payload_json TEXT,
    truncated INTEGER NOT NULL,
    truncated_fields_json TEXT,
    created_at INTEGER NOT NULL
  )`);
  try { next.run('ALTER TABLE lifecycle_records ADD COLUMN subject_pty_id TEXT'); } catch { /* already present */ }
  next.run('CREATE INDEX IF NOT EXISTS idx_lifecycle_run ON lifecycle_records (run_id, id)');
  next.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_lifecycle_dedupe ON lifecycle_records (pty_id, seq)');
  database = next;
  return next;
}

function append(runId: string, record: LifecycleRecord): void {
  try {
    db().run(`INSERT OR IGNORE INTO lifecycle_records (
      run_id, pty_id, subject_pty_id, seq, depth, role, at, class, name, transition, resumable,
      payload_json, truncated, truncated_fields_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
      runId,
      record.ptyId,
      record.subjectPtyId,
      record.seq,
      record.depth,
      record.role,
      record.at,
      record.class,
      record.name,
      record.class === 'condition' ? record.transition : null,
      record.class === 'condition' && record.transition === 'enter' ? Number(record.resumable) : null,
      'payload' in record ? JSON.stringify(record.payload) : null,
      Number(record.truncated),
      record.truncated ? JSON.stringify(record.truncatedFields) : null,
      Date.now(),
    ]);
  } catch {
    // Lifecycle mirroring must not interrupt its publisher.
  }
}

/** Mirrors this process's lifecycle emission into the append-only SQLite bridge. */
export function attachLifecycleBridge(bus: ChannelBus, runId: string): () => void {
  publishLifecycleRootReport();
  try { db(); } catch { /* the subscription remains fail-soft when storage is unavailable */ }
  const subscription = subscribeRunLifecycle(bus, runId, (record) => append(runId, record));
  return () => subscription.unsubscribe();
}

function rowToRecord(row: LifecycleRow): LifecycleRecord | null {
  try {
    const candidate = {
      runId: row.run_id,
      ptyId: row.pty_id,
      ...(row.subject_pty_id === null ? {} : { subjectPtyId: row.subject_pty_id }),
      seq: row.seq,
      depth: row.depth,
      role: row.role,
      at: row.at,
      class: row.class,
      name: row.name,
      ...(row.transition === null ? {} : { transition: row.transition }),
      ...(row.resumable === null ? {} : { resumable: row.resumable === 1 }),
      ...(row.payload_json === null ? {} : { payload: JSON.parse(row.payload_json) }),
      truncated: row.truncated === 1,
      ...(row.truncated_fields_json === null ? {} : { truncatedFields: JSON.parse(row.truncated_fields_json) }),
    };
    return validateLifecycleRecord(candidate) === null ? candidate as LifecycleRecord : null;
  } catch {
    return null;
  }
}

const LIFECYCLE_READ_CHUNK_SIZE = 100;
const SELECT_LIFECYCLE_ROWS = `SELECT id, run_id, pty_id, subject_pty_id, seq, depth, role, at, class, name, transition, resumable, payload_json, truncated, truncated_fields_json
  FROM lifecycle_records WHERE run_id=? AND id>? ORDER BY id ASC LIMIT ?`;

type LifecycleBacklog = readonly { id: number; record: LifecycleRecord }[];

function readLifecycleRows(targetDb: Database, runId: string, afterId?: number, limit?: number): LifecycleBacklog {
  const target = limit === undefined ? Infinity : Math.max(0, limit);
  if (target === 0) return [];

  const rows = targetDb.query(SELECT_LIFECYCLE_ROWS);
  const records: { id: number; record: LifecycleRecord }[] = [];
  let cursor = afterId ?? 0;
  while (records.length < target) {
    const chunk = rows.all(runId, cursor, LIFECYCLE_READ_CHUNK_SIZE) as LifecycleRow[];
    if (chunk.length === 0) break;

    for (const row of chunk) {
      cursor = row.id;
      const record = rowToRecord(row);
      if (record !== null) records.push({ id: row.id, record });
      if (records.length === target) break;
    }
    if (chunk.length < LIFECYCLE_READ_CHUNK_SIZE) break;
  }
  return records;
}

/** Returns a run's ordered append-only backlog after the optional cursor. */
export function readRunLifecycle(runId: string, afterId?: number, limit?: number): LifecycleBacklog {
  try {
    return readLifecycleRows(db(), runId, afterId, limit);
  } catch {
    return [];
  }
}

/** Reads a child's isolated lifecycle bridge without changing the process-global cached handle. */
export function readRunLifecycleFromStateDir(stateDir: string | undefined, runId: string | undefined, afterId?: number, limit?: number): LifecycleBacklog {
  if (!stateDir || !runId) return [];
  const path = join(stateDir, 'pty', 'manifest.db');
  if (!existsSync(path)) return [];
  let isolated: Database | undefined;
  try {
    isolated = new Database(path, { readonly: true });
    const table = isolated.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='lifecycle_records'").get();
    if (!table) return [];
    return readLifecycleRows(isolated, runId, afterId, limit);
  } catch {
    return [];
  } finally {
    try { isolated?.close(); } catch { /* fail-soft */ }
  }
}

/** Deletes persisted lifecycle records older than the requested age. */
export function reapLifecycleRecords(olderThanMs: number): number {
  try {
    return db().run('DELETE FROM lifecycle_records WHERE created_at < ?', [Date.now() - olderThanMs]).changes;
  } catch {
    return 0;
  }
}

export function resetLifecycleBridgeForTesting(): void {
  database?.close();
  database = null;
}
