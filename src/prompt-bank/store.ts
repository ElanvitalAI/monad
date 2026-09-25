import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { promptBankDbPath } from './paths.js';
import type {
  CreatePromptFragmentInput,
  PromptBankStore,
  PromptFragment,
  PromptInjectionLog,
  PromptInjectionLogInput,
  PromptKind,
  PromptScope,
  PromptSearchQuery,
  PromptTargetSlot,
  UpdatePromptFragmentInput,
} from './types.js';

type SqlValue = string | number | null;

interface PromptFragmentRow {
  id: string;
  name: string;
  version: number;
  scope: PromptScope;
  owner: string;
  kind: PromptKind;
  target_slot: PromptTargetSlot;
  priority: number;
  enabled: number;
  content: string;
  description: string | null;
  tags_json: string;
  triggers_json: string;
  constraints_json: string;
  metadata_json: string;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
  use_count: number;
}

interface PromptInjectionLogRow {
  id: string;
  session_id: string | null;
  turn_id: string | null;
  model: string | null;
  active_view: string | null;
  active_plugin: string | null;
  selected_fragment_ids: string;
  rejected: string;
  token_estimate: number;
  slots_json: string;
  metadata_json: string;
  created_at: string;
}

let cached: PromptBankStore | null = null;

export function getPromptBankStore(): PromptBankStore {
  if (!cached) cached = openPromptBankStore();
  return cached;
}

export function resetPromptBankStoreForTests(): void {
  cached?.close?.();
  cached = null;
}

export function openPromptBankStore(path: string = promptBankDbPath()): PromptBankStore {
  return new SqlitePromptBankStore(path);
}

class SqlitePromptBankStore implements PromptBankStore {
  readonly kind = 'sqlite' as const;
  private db: Database;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.exec('PRAGMA journal_mode=WAL');
    this.db.exec('PRAGMA foreign_keys=ON');
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  create(input: CreatePromptFragmentInput): PromptFragment {
    const now = new Date().toISOString();
    const fragment: PromptFragment = {
      id: input.id ?? `prompt_${randomUUID().slice(0, 12)}`,
      name: input.name.trim(),
      version: input.version ?? 1,
      scope: input.scope,
      owner: input.owner,
      kind: input.kind,
      targetSlot: input.targetSlot,
      priority: input.priority ?? 100,
      enabled: input.enabled ?? true,
      content: input.content,
      ...(input.description !== undefined ? { description: input.description } : {}),
      tags: normalizeStringArray(input.tags),
      triggers: normalizeRecord(input.triggers),
      constraints: normalizeRecord(input.constraints),
      metadata: normalizeRecord(input.metadata),
      createdAt: now,
      updatedAt: now,
      useCount: 0,
    };
    validateFragment(fragment);
    this.db.prepare(`
      INSERT INTO prompt_fragments (
        id, name, version, scope, owner, kind, target_slot, priority, enabled,
        content, description, tags_json, triggers_json, constraints_json,
        metadata_json, created_at, updated_at, last_used_at, use_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      fragment.id, fragment.name, fragment.version, fragment.scope, fragment.owner,
      fragment.kind, fragment.targetSlot, fragment.priority, fragment.enabled ? 1 : 0,
      fragment.content, fragment.description ?? null, JSON.stringify(fragment.tags),
      JSON.stringify(fragment.triggers), JSON.stringify(fragment.constraints),
      JSON.stringify(fragment.metadata), fragment.createdAt, fragment.updatedAt,
      fragment.lastUsedAt ?? null, fragment.useCount,
    );
    return fragment;
  }

  update(id: string, patch: UpdatePromptFragmentInput): PromptFragment {
    const current = this.get(id);
    if (!current) throw new Error(`prompt fragment "${id}" not found`);
    const next: PromptFragment = {
      ...current,
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.version !== undefined ? { version: patch.version } : {}),
      ...(patch.scope !== undefined ? { scope: patch.scope } : {}),
      ...(patch.owner !== undefined ? { owner: patch.owner } : {}),
      ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
      ...(patch.targetSlot !== undefined ? { targetSlot: patch.targetSlot } : {}),
      ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      ...(patch.content !== undefined ? { content: patch.content } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.tags !== undefined ? { tags: normalizeStringArray(patch.tags) } : {}),
      ...(patch.triggers !== undefined ? { triggers: normalizeRecord(patch.triggers) } : {}),
      ...(patch.constraints !== undefined ? { constraints: normalizeRecord(patch.constraints) } : {}),
      ...(patch.metadata !== undefined ? { metadata: normalizeRecord(patch.metadata) } : {}),
      updatedAt: new Date().toISOString(),
    };
    validateFragment(next);
    this.db.prepare(`
      UPDATE prompt_fragments SET
        name=?, version=?, scope=?, owner=?, kind=?, target_slot=?, priority=?,
        enabled=?, content=?, description=?, tags_json=?, triggers_json=?,
        constraints_json=?, metadata_json=?, updated_at=?
      WHERE id=?
    `).run(
      next.name, next.version, next.scope, next.owner, next.kind, next.targetSlot,
      next.priority, next.enabled ? 1 : 0, next.content, next.description ?? null,
      JSON.stringify(next.tags), JSON.stringify(next.triggers),
      JSON.stringify(next.constraints), JSON.stringify(next.metadata), next.updatedAt, id,
    );
    return next;
  }

  get(id: string): PromptFragment | null {
    const row = this.db.prepare('SELECT * FROM prompt_fragments WHERE id = ?').get(id) as PromptFragmentRow | null;
    return row ? rowToFragment(row) : null;
  }

  list(query: PromptSearchQuery = {}): PromptFragment[] {
    return this.search(query);
  }

  search(query: PromptSearchQuery): PromptFragment[] {
    let sql = 'SELECT * FROM prompt_fragments WHERE 1=1';
    const params: SqlValue[] = [];
    if (query.scope) { sql += ' AND scope = ?'; params.push(query.scope); }
    if (query.owner) { sql += ' AND owner = ?'; params.push(query.owner); }
    if (query.kind) { sql += ' AND kind = ?'; params.push(query.kind); }
    if (query.targetSlot) { sql += ' AND target_slot = ?'; params.push(query.targetSlot); }
    if (query.enabled !== undefined) { sql += ' AND enabled = ?'; params.push(query.enabled ? 1 : 0); }
    if (query.query && query.query.trim()) {
      const q = `%${query.query.trim().toLowerCase()}%`;
      sql += ' AND (lower(name) LIKE ? OR lower(content) LIKE ? OR lower(COALESCE(description, "")) LIKE ? OR lower(tags_json) LIKE ?)';
      params.push(q, q, q, q);
    }
    sql += ' ORDER BY priority ASC, updated_at DESC, id ASC';
    if (query.limit) {
      sql += ' LIMIT ?';
      params.push(Math.max(1, Math.min(500, query.limit)));
    }
    let rows = (this.db.prepare(sql).all(...params) as PromptFragmentRow[]).map(rowToFragment);
    const tags = normalizeStringArray(query.tags);
    if (tags.length > 0) {
      rows = rows.filter(row => tags.every(tag => row.tags.includes(tag)));
    }
    return rows;
  }

  setEnabled(id: string, enabled: boolean): PromptFragment {
    return this.update(id, { enabled });
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM prompt_fragments WHERE id = ?').run(id);
  }

  recordUse(ids: readonly string[], usedAt = new Date().toISOString()): void {
    const unique = [...new Set(ids)];
    const stmt = this.db.prepare(`
      UPDATE prompt_fragments
      SET last_used_at = ?, use_count = use_count + 1, updated_at = updated_at
      WHERE id = ?
    `);
    const tx = this.db.transaction((items: string[]) => {
      for (const id of items) stmt.run(usedAt, id);
    });
    tx(unique);
  }

  recordInjection(input: PromptInjectionLogInput): PromptInjectionLog {
    const log: PromptInjectionLog = {
      id: input.id ?? `prompt_inject_${randomUUID().slice(0, 12)}`,
      ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
      ...(input.turnId !== undefined ? { turnId: input.turnId } : {}),
      ...(input.model !== undefined ? { model: input.model } : {}),
      ...(input.activeView !== undefined ? { activeView: input.activeView } : {}),
      ...(input.activePlugin !== undefined ? { activePlugin: input.activePlugin } : {}),
      selectedFragmentIds: normalizeStringArray(input.selectedFragmentIds),
      rejected: input.rejected.map(r => ({ id: String(r.id), reason: String(r.reason) })),
      tokenEstimate: Math.max(0, Math.ceil(input.tokenEstimate)),
      slots: normalizeRecord(input.slots) as PromptInjectionLog['slots'],
      metadata: normalizeRecord(input.metadata),
      createdAt: new Date().toISOString(),
    };
    this.db.prepare(`
      INSERT INTO prompt_injection_log (
        id, session_id, turn_id, model, active_view, active_plugin,
        selected_fragment_ids, rejected, token_estimate, slots_json, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      log.id, log.sessionId ?? null, log.turnId ?? null, log.model ?? null,
      log.activeView ?? null, log.activePlugin ?? null,
      JSON.stringify(log.selectedFragmentIds), JSON.stringify(log.rejected),
      log.tokenEstimate, JSON.stringify(log.slots), JSON.stringify(log.metadata),
      log.createdAt,
    );
    return log;
  }

  getInjectionLog(id: string): PromptInjectionLog | null {
    const row = this.db.prepare('SELECT * FROM prompt_injection_log WHERE id = ?').get(id) as PromptInjectionLogRow | null;
    return row ? rowToInjectionLog(row) : null;
  }

  listInjectionLogs(limit = 50): PromptInjectionLog[] {
    const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
    return (this.db.prepare(`
      SELECT * FROM prompt_injection_log
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `).all(safeLimit) as PromptInjectionLogRow[]).map(rowToInjectionLog);
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS prompt_fragments (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        scope TEXT NOT NULL,
        owner TEXT NOT NULL,
        kind TEXT NOT NULL,
        target_slot TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 100,
        enabled INTEGER NOT NULL DEFAULT 1,
        content TEXT NOT NULL,
        description TEXT,
        tags_json TEXT NOT NULL DEFAULT '[]',
        triggers_json TEXT NOT NULL DEFAULT '{}',
        constraints_json TEXT NOT NULL DEFAULT '{}',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_used_at TEXT,
        use_count INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_prompt_fragments_scope ON prompt_fragments(scope);
      CREATE INDEX IF NOT EXISTS idx_prompt_fragments_owner ON prompt_fragments(owner);
      CREATE INDEX IF NOT EXISTS idx_prompt_fragments_kind ON prompt_fragments(kind);
      CREATE INDEX IF NOT EXISTS idx_prompt_fragments_enabled ON prompt_fragments(enabled);
      CREATE INDEX IF NOT EXISTS idx_prompt_fragments_priority ON prompt_fragments(priority, updated_at);

      CREATE TABLE IF NOT EXISTS prompt_injection_log (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        turn_id TEXT,
        model TEXT,
        active_view TEXT,
        active_plugin TEXT,
        selected_fragment_ids TEXT NOT NULL,
        rejected TEXT NOT NULL DEFAULT '[]',
        token_estimate INTEGER NOT NULL DEFAULT 0,
        slots_json TEXT NOT NULL DEFAULT '{}',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_prompt_injection_log_turn ON prompt_injection_log(turn_id);
      CREATE INDEX IF NOT EXISTS idx_prompt_injection_log_created ON prompt_injection_log(created_at);
    `);
    this.addColumnIfMissing('prompt_injection_log', 'slots_json', "TEXT NOT NULL DEFAULT '{}'");
    this.addColumnIfMissing('prompt_injection_log', 'metadata_json', "TEXT NOT NULL DEFAULT '{}'");
  }

  private addColumnIfMissing(table: string, column: string, definition: string): void {
    const rows = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: string }>;
    if (rows.some(row => row.name === column)) return;
    this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function rowToFragment(row: PromptFragmentRow): PromptFragment {
  return {
    id: String(row.id),
    name: String(row.name),
    version: Number(row.version ?? 1),
    scope: row.scope as PromptScope,
    owner: String(row.owner),
    kind: row.kind as PromptKind,
    targetSlot: row.target_slot as PromptTargetSlot,
    priority: Number(row.priority ?? 100),
    enabled: Number(row.enabled) !== 0,
    content: String(row.content ?? ''),
    ...(row.description != null ? { description: String(row.description) } : {}),
    tags: parseJson(row.tags_json, []),
    triggers: parseJson(row.triggers_json, {}),
    constraints: parseJson(row.constraints_json, {}),
    metadata: parseJson(row.metadata_json, {}),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    ...(row.last_used_at != null ? { lastUsedAt: String(row.last_used_at) } : {}),
    useCount: Number(row.use_count ?? 0),
  };
}

function rowToInjectionLog(row: PromptInjectionLogRow): PromptInjectionLog {
  return {
    id: String(row.id),
    ...(row.session_id != null ? { sessionId: String(row.session_id) } : {}),
    ...(row.turn_id != null ? { turnId: String(row.turn_id) } : {}),
    ...(row.model != null ? { model: String(row.model) } : {}),
    ...(row.active_view != null ? { activeView: String(row.active_view) } : {}),
    ...(row.active_plugin != null ? { activePlugin: String(row.active_plugin) } : {}),
    selectedFragmentIds: parseJson(row.selected_fragment_ids, []),
    rejected: parseJson(row.rejected, []),
    tokenEstimate: Number(row.token_estimate ?? 0),
    slots: parseJson(row.slots_json, {}),
    metadata: parseJson(row.metadata_json, {}),
    createdAt: String(row.created_at),
  };
}

function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string') return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed == null ? fallback : parsed as T;
  } catch {
    return fallback;
  }
}

function normalizeStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.map(x => typeof x === 'string' ? x.trim() : '').filter(Boolean))].sort();
}

function normalizeRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? { ...(v as Record<string, unknown>) } : {};
}

function validateFragment(fragment: PromptFragment): void {
  if (!fragment.id.trim()) throw new Error('prompt fragment id is required');
  if (!fragment.name.trim()) throw new Error('prompt fragment name is required');
  if (!fragment.owner.trim()) throw new Error('prompt fragment owner is required');
  if (!fragment.content.trim()) throw new Error('prompt fragment content is required');
  if (!Number.isInteger(fragment.version) || fragment.version < 1) throw new Error('prompt fragment version must be >= 1');
  if (!Number.isFinite(fragment.priority)) throw new Error('prompt fragment priority must be finite');
}
