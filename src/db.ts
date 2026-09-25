import { Database } from 'bun:sqlite';
import { mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';
import { DB_PATH } from './config.js';
import type { SyncSession, SyncEntry, SkillSnapshot, ServiceDelta } from './types.js';

type SqlValue = string | number | null;

interface SyncSessionRow {
  id: number;
  started_at: string;
  completed_at: string | null;
  mode: SyncSession['mode'];
  servers: string;
  services: string;
  skills: string;
}

interface SyncEntryRow {
  id: number;
  session_id: number;
  skill_name: string;
  server: string;
  service: string;
  local_hash: string;
  prev_hash: string | null;
  status: SyncEntry['status'];
  changed: number;
  file_count: number | null;
  total_bytes: number | null;
  duration_ms: number | null;
  diff_summary: string | null;
  synced_at: string;
}

interface SkillSnapshotRow {
  skill_name: string;
  server: string;
  service: string;
  hash: string;
  file_tree: string | null;
  synced_at: string;
}

interface ServiceDeltaRow {
  id: number;
  server: string;
  service: string;
  skill_name: string;
  delta_type: ServiceDelta['deltaType'];
  description: string;
  pattern: string | null;
  file_path: string | null;
  preserve: number;
  detected_at: string;
  last_seen: string;
  grok_analysis: string | null;
}

let _db: Database | null = null;

export function getDb(): Database {
  if (_db) return _db;

  const dir = dirname(DB_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  _db = new Database(DB_PATH);
  _db.exec('PRAGMA journal_mode=WAL');
  _db.exec('PRAGMA foreign_keys=ON');
  migrate(_db);
  return _db;
}

function migrate(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      mode TEXT NOT NULL,
      servers TEXT NOT NULL,
      services TEXT NOT NULL,
      skills TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sync_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER REFERENCES sync_sessions(id),
      skill_name TEXT NOT NULL,
      server TEXT NOT NULL,
      service TEXT NOT NULL,
      local_hash TEXT NOT NULL,
      prev_hash TEXT,
      status TEXT NOT NULL,
      changed INTEGER NOT NULL DEFAULT 0,
      file_count INTEGER,
      total_bytes INTEGER,
      duration_ms INTEGER,
      diff_summary TEXT,
      synced_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS skill_snapshots (
      skill_name TEXT NOT NULL,
      server TEXT NOT NULL,
      service TEXT NOT NULL,
      hash TEXT NOT NULL,
      file_tree TEXT,
      synced_at TEXT NOT NULL,
      PRIMARY KEY (skill_name, server, service)
    );

    CREATE TABLE IF NOT EXISTS service_deltas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      server TEXT NOT NULL,
      service TEXT NOT NULL,
      skill_name TEXT NOT NULL,
      delta_type TEXT NOT NULL,
      description TEXT NOT NULL,
      pattern TEXT,
      file_path TEXT,
      preserve INTEGER NOT NULL DEFAULT 1,
      detected_at TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      grok_analysis TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_entries_session ON sync_entries(session_id);
    CREATE INDEX IF NOT EXISTS idx_entries_skill ON sync_entries(skill_name, server, service);
    CREATE INDEX IF NOT EXISTS idx_deltas_target ON service_deltas(server, service, skill_name);
  `);
}

// ── Sessions ──

export function createSession(session: Omit<SyncSession, 'id'>): number {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO sync_sessions (started_at, mode, servers, services, skills)
    VALUES (?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    session.startedAt,
    session.mode,
    JSON.stringify(session.servers),
    JSON.stringify(session.services),
    JSON.stringify(session.skills),
  );
  return Number(result.lastInsertRowid);
}

export function completeSession(id: number): void {
  getDb().prepare('UPDATE sync_sessions SET completed_at = ? WHERE id = ?')
    .run(new Date().toISOString(), id);
}

export function getRecentSessions(limit = 20): (SyncSession & { id: number })[] {
  return (getDb().prepare(`
    SELECT * FROM sync_sessions ORDER BY started_at DESC LIMIT ?
  `).all(limit) as SyncSessionRow[]).map(rowToSession);
}

// ── Entries ──

export function insertEntry(entry: Omit<SyncEntry, 'id'>): number {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO sync_entries (session_id, skill_name, server, service, local_hash, prev_hash, status, changed, file_count, total_bytes, duration_ms, diff_summary, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    entry.sessionId, entry.skillName, entry.server, entry.service,
    entry.localHash, entry.prevHash || null, entry.status,
    entry.changed ? 1 : 0, entry.fileCount || null, entry.totalBytes || null,
    entry.durationMs || null, entry.diffSummary || null, entry.syncedAt,
  );
  return Number(result.lastInsertRowid);
}

export function getEntriesForSession(sessionId: number): SyncEntry[] {
  return (getDb().prepare(`
    SELECT * FROM sync_entries WHERE session_id = ? ORDER BY synced_at
  `).all(sessionId) as SyncEntryRow[]).map(rowToEntry);
}

export function getSkillHistory(skillName: string, server?: string, service?: string, limit = 50): SyncEntry[] {
  let sql = 'SELECT * FROM sync_entries WHERE skill_name = ?';
  const params: SqlValue[] = [skillName];

  if (server) { sql += ' AND server = ?'; params.push(server); }
  if (service) { sql += ' AND service = ?'; params.push(service); }

  sql += ' ORDER BY synced_at DESC LIMIT ?';
  params.push(limit);

  return (getDb().prepare(sql).all(...params) as SyncEntryRow[]).map(rowToEntry);
}

export function getTargetHistory(server: string, service: string, limit = 50): SyncEntry[] {
  return (getDb().prepare(`
    SELECT * FROM sync_entries WHERE server = ? AND service = ? ORDER BY synced_at DESC LIMIT ?
  `).all(server, service, limit) as SyncEntryRow[]).map(rowToEntry);
}

// ── Snapshots ──

export function getSnapshot(skillName: string, server: string, service: string): SkillSnapshot | null {
  const row = getDb().prepare(`
    SELECT * FROM skill_snapshots WHERE skill_name = ? AND server = ? AND service = ?
  `).get(skillName, server, service) as SkillSnapshotRow | null;
  return row ? rowToSnapshot(row) : null;
}

export function upsertSnapshot(snap: SkillSnapshot): void {
  getDb().prepare(`
    INSERT INTO skill_snapshots (skill_name, server, service, hash, file_tree, synced_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(skill_name, server, service) DO UPDATE SET
      hash = excluded.hash,
      file_tree = excluded.file_tree,
      synced_at = excluded.synced_at
  `).run(snap.skillName, snap.server, snap.service, snap.hash, snap.fileTree, snap.syncedAt);
}

export function getAllSnapshots(): SkillSnapshot[] {
  return (getDb().prepare('SELECT * FROM skill_snapshots ORDER BY skill_name, server, service').all() as SkillSnapshotRow[])
    .map(rowToSnapshot);
}

// ── Service Deltas ──

export function getDeltas(server: string, service: string, skillName: string): ServiceDelta[] {
  return (getDb().prepare(`
    SELECT * FROM service_deltas WHERE server = ? AND service = ? AND skill_name = ?
  `).all(server, service, skillName) as ServiceDeltaRow[]).map(rowToDelta);
}

export function upsertDelta(delta: Omit<ServiceDelta, 'id'>): void {
  const db = getDb();
  const existing = db.prepare(`
    SELECT id FROM service_deltas
    WHERE server = ? AND service = ? AND skill_name = ? AND delta_type = ? AND description = ?
  `).get(delta.server, delta.service, delta.skillName, delta.deltaType, delta.description) as { id: number } | null;

  if (existing) {
    db.prepare(`
      UPDATE service_deltas SET
        pattern = ?, file_path = ?, preserve = ?, last_seen = ?, grok_analysis = ?
      WHERE id = ?
    `).run(delta.pattern || null, delta.filePath || null, delta.preserve ? 1 : 0,
      delta.lastSeen, delta.grokAnalysis || null, existing.id);
  } else {
    db.prepare(`
      INSERT INTO service_deltas (server, service, skill_name, delta_type, description, pattern, file_path, preserve, detected_at, last_seen, grok_analysis)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(delta.server, delta.service, delta.skillName, delta.deltaType, delta.description,
      delta.pattern || null, delta.filePath || null, delta.preserve ? 1 : 0,
      delta.detectedAt, delta.lastSeen, delta.grokAnalysis || null);
  }
}

export function getAllDeltas(): ServiceDelta[] {
  return (getDb().prepare('SELECT * FROM service_deltas ORDER BY server, service, skill_name').all() as ServiceDeltaRow[])
    .map(rowToDelta);
}

function rowToSession(row: SyncSessionRow): SyncSession & { id: number } {
  return {
    id: Number(row.id),
    startedAt: String(row.started_at),
    ...(row.completed_at ? { completedAt: String(row.completed_at) } : {}),
    mode: row.mode,
    servers: parseStringArray(row.servers),
    services: parseStringArray(row.services),
    skills: parseStringArray(row.skills),
  };
}

function rowToEntry(row: SyncEntryRow): SyncEntry {
  return {
    id: Number(row.id),
    sessionId: Number(row.session_id),
    skillName: String(row.skill_name),
    server: String(row.server),
    service: String(row.service),
    localHash: String(row.local_hash),
    ...(row.prev_hash ? { prevHash: String(row.prev_hash) } : {}),
    status: row.status,
    changed: Number(row.changed) !== 0,
    ...(row.file_count != null ? { fileCount: Number(row.file_count) } : {}),
    ...(row.total_bytes != null ? { totalBytes: Number(row.total_bytes) } : {}),
    ...(row.duration_ms != null ? { durationMs: Number(row.duration_ms) } : {}),
    ...(row.diff_summary != null ? { diffSummary: String(row.diff_summary) } : {}),
    syncedAt: String(row.synced_at),
  };
}

function rowToSnapshot(row: SkillSnapshotRow): SkillSnapshot {
  return {
    skillName: String(row.skill_name),
    server: String(row.server),
    service: String(row.service),
    hash: String(row.hash),
    fileTree: String(row.file_tree ?? ''),
    syncedAt: String(row.synced_at),
  };
}

function rowToDelta(row: ServiceDeltaRow): ServiceDelta {
  return {
    id: Number(row.id),
    server: String(row.server),
    service: String(row.service),
    skillName: String(row.skill_name),
    deltaType: row.delta_type,
    description: String(row.description),
    ...(row.pattern ? { pattern: String(row.pattern) } : {}),
    ...(row.file_path ? { filePath: String(row.file_path) } : {}),
    preserve: Number(row.preserve) !== 0,
    detectedAt: String(row.detected_at),
    lastSeen: String(row.last_seen),
    ...(row.grok_analysis ? { grokAnalysis: String(row.grok_analysis) } : {}),
  };
}

function parseStringArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}
