import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { userConfigPath } from './user-config.js';

export interface InputHistoryEntry {
  id: number;
  text: string;
  kind: 'slash' | 'chat';
  createdAt: string;
  cwd?: string;
  activeView?: string;
  focusedPane?: string;
  metadata: Record<string, unknown>;
}

export interface InputHistoryRecordInput {
  text: string;
  cwd?: string;
  activeView?: string;
  focusedPane?: string;
  metadata?: Record<string, unknown>;
}

export interface InputHistorySearchQuery {
  query?: string;
  kind?: 'slash' | 'chat';
  limit?: number;
}

export interface InputHistoryStore {
  readonly kind: 'sqlite' | 'json';
  record(input: InputHistoryRecordInput): InputHistoryEntry | null;
  list(limit?: number): InputHistoryEntry[];
  search(query: InputHistorySearchQuery): InputHistoryEntry[];
  clear(): void;
  close?(): void;
}

type SqlValue = string | number | null;

interface InputHistoryRow {
  id: number;
  text: string;
  kind: string;
  cwd: string | null;
  active_view: string | null;
  focused_pane: string | null;
  metadata_json: string;
  created_at: string;
}

let cached: InputHistoryStore | null = null;

export function inputHistoryDir(): string {
  return dirname(userConfigPath());
}

export function inputHistoryDbPath(): string {
  return join(inputHistoryDir(), 'input-history.sqlite');
}

export function inputHistoryJsonPath(): string {
  return join(inputHistoryDir(), 'input-history.jsonl');
}

export function getInputHistoryStore(): InputHistoryStore {
  if (!cached) cached = openInputHistoryStore();
  return cached;
}

export function resetInputHistoryStoreForTests(): void {
  cached?.close?.();
  cached = null;
}

export function openInputHistoryStore(path: string = inputHistoryDbPath()): InputHistoryStore {
  if (process.env.ELANOUS_INPUT_HISTORY_STORE === 'json') {
    return new JsonInputHistoryStore(jsonFallbackPath(path));
  }
  try {
    return new SqliteInputHistoryStore(path);
  } catch {
    return new JsonInputHistoryStore(jsonFallbackPath(path));
  }
}

class SqliteInputHistoryStore implements InputHistoryStore {
  readonly kind = 'sqlite' as const;
  private db: Database;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.exec('PRAGMA journal_mode=WAL');
    this.migrate();
  }

  record(input: InputHistoryRecordInput): InputHistoryEntry | null {
    const text = normalizeText(input.text);
    if (!text) return null;
    const now = new Date().toISOString();
    const kind = inputKind(text);
    const metadata = input.metadata ?? {};
    const result = this.db.prepare(`
      INSERT INTO input_history (text, kind, cwd, active_view, focused_pane, metadata_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      text,
      kind,
      input.cwd ?? null,
      input.activeView ?? null,
      input.focusedPane ?? null,
      JSON.stringify(metadata),
      now,
    );
    return {
      id: Number(result.lastInsertRowid),
      text,
      kind,
      createdAt: now,
      ...(input.cwd ? { cwd: input.cwd } : {}),
      ...(input.activeView ? { activeView: input.activeView } : {}),
      ...(input.focusedPane ? { focusedPane: input.focusedPane } : {}),
      metadata,
    };
  }

  list(limit = 100): InputHistoryEntry[] {
    return (this.db.prepare(`
      SELECT * FROM input_history
      ORDER BY id DESC
      LIMIT ?
    `).all(clampLimit(limit)) as InputHistoryRow[]).map(rowToEntry);
  }

  search(query: InputHistorySearchQuery): InputHistoryEntry[] {
    const where: string[] = [];
    const params: SqlValue[] = [];
    if (query.kind) {
      where.push('kind = ?');
      params.push(query.kind);
    }
    if (query.query?.trim()) {
      where.push('text LIKE ?');
      params.push(`%${escapeLike(query.query.trim())}%`);
    }
    const sql = `
      SELECT * FROM input_history
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY id DESC
      LIMIT ?
    `;
    params.push(clampLimit(query.limit ?? 50));
    return (this.db.prepare(sql).all(...params) as InputHistoryRow[]).map(rowToEntry);
  }

  clear(): void {
    this.db.prepare('DELETE FROM input_history').run();
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS input_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        text TEXT NOT NULL,
        kind TEXT NOT NULL,
        cwd TEXT,
        active_view TEXT,
        focused_pane TEXT,
        metadata_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_input_history_created ON input_history(created_at);
      CREATE INDEX IF NOT EXISTS idx_input_history_kind ON input_history(kind, created_at);
      CREATE INDEX IF NOT EXISTS idx_input_history_text ON input_history(text);
    `);
  }
}

class JsonInputHistoryStore implements InputHistoryStore {
  readonly kind = 'json' as const;

  constructor(private path: string) {
    mkdirSync(dirname(path), { recursive: true });
    if (!existsSync(path)) writeFileSync(path, '', 'utf-8');
  }

  record(input: InputHistoryRecordInput): InputHistoryEntry | null {
    const text = normalizeText(input.text);
    if (!text) return null;
    const entries = this.readAll();
    const entry: InputHistoryEntry = {
      id: entries.length > 0 ? Math.max(...entries.map(e => e.id)) + 1 : 1,
      text,
      kind: inputKind(text),
      createdAt: new Date().toISOString(),
      ...(input.cwd ? { cwd: input.cwd } : {}),
      ...(input.activeView ? { activeView: input.activeView } : {}),
      ...(input.focusedPane ? { focusedPane: input.focusedPane } : {}),
      metadata: input.metadata ?? {},
    };
    entries.push(entry);
    this.writeAll(entries.slice(-5000));
    return entry;
  }

  list(limit = 100): InputHistoryEntry[] {
    return this.readAll().slice(-clampLimit(limit)).reverse();
  }

  search(query: InputHistorySearchQuery): InputHistoryEntry[] {
    const needle = query.query?.trim().toLowerCase();
    return this.readAll()
      .filter(entry => !query.kind || entry.kind === query.kind)
      .filter(entry => !needle || entry.text.toLowerCase().includes(needle))
      .slice(-clampLimit(query.limit ?? 50))
      .reverse();
  }

  clear(): void {
    this.writeAll([]);
  }

  private readAll(): InputHistoryEntry[] {
    try {
      const raw = readFileSync(this.path, 'utf-8');
      return raw.split('\n').filter(Boolean).map(line => normalizeEntry(JSON.parse(line))).filter(Boolean) as InputHistoryEntry[];
    } catch {
      return [];
    }
  }

  private writeAll(entries: InputHistoryEntry[]): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, entries.map(entry => JSON.stringify(entry)).join('\n') + (entries.length ? '\n' : ''), 'utf-8');
  }
}

function rowToEntry(row: InputHistoryRow): InputHistoryEntry {
  return normalizeEntry({
    id: Number(row.id),
    text: String(row.text ?? ''),
    kind: row.kind === 'slash' ? 'slash' : 'chat',
    createdAt: String(row.created_at ?? ''),
    cwd: row.cwd ?? undefined,
    activeView: row.active_view ?? undefined,
    focusedPane: row.focused_pane ?? undefined,
    metadata: parseJsonObject(row.metadata_json),
  })!;
}

function normalizeEntry(raw: unknown): InputHistoryEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const text = normalizeText(String(obj.text ?? ''));
  if (!text) return null;
  const id = Number.isFinite(Number(obj.id)) ? Number(obj.id) : 0;
  return {
    id,
    text,
    kind: obj.kind === 'slash' ? 'slash' : 'chat',
    createdAt: typeof obj.createdAt === 'string' ? obj.createdAt : new Date().toISOString(),
    ...(typeof obj.cwd === 'string' ? { cwd: obj.cwd } : {}),
    ...(typeof obj.activeView === 'string' ? { activeView: obj.activeView } : {}),
    ...(typeof obj.focusedPane === 'string' ? { focusedPane: obj.focusedPane } : {}),
    metadata: obj.metadata && typeof obj.metadata === 'object' && !Array.isArray(obj.metadata)
      ? obj.metadata as Record<string, unknown>
      : {},
  };
}

function normalizeText(text: string): string {
  return String(text ?? '').replace(/\s+$/g, '').trimStart();
}

function inputKind(text: string): 'slash' | 'chat' {
  return text.trimStart().startsWith('/') ? 'slash' : 'chat';
}

function clampLimit(limit: number): number {
  return Math.max(1, Math.min(500, Number.isFinite(limit) ? Math.floor(limit) : 50));
}

function escapeLike(value: string): string {
  return value.replace(/[%_]/g, ch => `\\${ch}`);
}

function parseJsonObject(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'string' || !raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function jsonFallbackPath(sqlitePath: string): string {
  if (sqlitePath === inputHistoryDbPath()) return inputHistoryJsonPath();
  return join(dirname(sqlitePath), 'input-history.jsonl');
}
