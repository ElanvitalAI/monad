// H6 P1 Bundle 1 · Budget history store (SQLite WAL).
//
// Stores per-turn usage rows so the forecaster (Bundle 2) + `/budget
// history` slash can query rolling windows without re-scanning raw
// Codex/Claude logs on every invocation.
//
// Design (PLAN D1): history → SQLite (WAL), separate file from elanous's
// main sync.db so budget retention doesn't compete with sync history
// for TTL scans. State (current snapshot) + limits use plain JSON.
//
// File: `~/.config/elanous/budget/history.sqlite` · 56-day retention to
// match CodexBar's `HistoricalUsageHistoryStore` · WAL mode for
// concurrent read during write (the refresher runs on one thread · UI
// queries on another).
//
// All writes are idempotent on `turnId` — log scanners observe the
// same files multiple times on subsequent refreshes, we rely on SQL
// INSERT OR IGNORE to dedup.

import { Database } from 'bun:sqlite';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import type { TurnSummary, UsageProvider } from './types.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RETENTION_MS = 56 * DAY_MS;

/** Default path used by production. Overridable via opts for tests. */
export const DEFAULT_HISTORY_DB_PATH = join(
  homedir(),
  '.config',
  'elanous',
  'budget',
  'history.sqlite',
);

interface TurnRow {
  turn_id: string;
  session_id: string;
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number | null;
  cache_create_tokens: number | null;
  cost_usd: number | null;
  completed_at: number;
}

export interface QueryWindow {
  readonly provider?: UsageProvider;
  readonly model?: string;
  /** Epoch ms · inclusive lower bound. */
  readonly fromMs: number;
  /** Epoch ms · exclusive upper bound. */
  readonly toMs: number;
}

export interface AggregateUsage {
  readonly turns: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheCreateTokens: number;
  readonly costUsd: number;
}

export class BudgetHistoryStore {
  private readonly db: Database;
  private readonly insertStmt: ReturnType<Database['prepare']>;

  constructor(dbPath: string = DEFAULT_HISTORY_DB_PATH) {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.db = new Database(dbPath);
    this.db.exec('PRAGMA journal_mode=WAL');
    this.db.exec('PRAGMA foreign_keys=ON');
    this.migrate();
    this.insertStmt = this.db.prepare(`
      INSERT OR IGNORE INTO turn_log (
        turn_id, session_id, provider, model,
        input_tokens, output_tokens,
        cache_read_tokens, cache_create_tokens,
        cost_usd, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS turn_log (
        turn_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens INTEGER,
        cache_create_tokens INTEGER,
        cost_usd REAL,
        completed_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_turn_log_provider_at
        ON turn_log(provider, completed_at);
      CREATE INDEX IF NOT EXISTS idx_turn_log_session
        ON turn_log(session_id, completed_at);
      CREATE INDEX IF NOT EXISTS idx_turn_log_model_at
        ON turn_log(provider, model, completed_at);
    `);
  }

  /** Append a single turn. Returns `true` when the row was new,
   *  `false` when it was a duplicate (turnId already present).
   *  Dedup is the scanner's safety net — we expect log scans to
   *  revisit files on every refresh cycle. */
  appendTurn(turn: TurnSummary): boolean {
    const res = this.insertStmt.run(
      turn.turnId,
      turn.sessionId,
      turn.provider,
      turn.model,
      turn.inputTokens,
      turn.outputTokens,
      turn.cacheReadTokens ?? null,
      turn.cacheCreateTokens ?? null,
      turn.costUsd ?? null,
      turn.completedAt,
    );
    return Number(res.changes) > 0;
  }

  /** Batch insert · wraps in a single transaction for throughput.
   *  Returns the number of NEW rows (duplicates silently skipped). */
  appendTurns(turns: readonly TurnSummary[]): number {
    if (turns.length === 0) return 0;
    let inserted = 0;
    this.db.transaction(() => {
      for (const t of turns) {
        if (this.appendTurn(t)) inserted++;
      }
    })();
    return inserted;
  }

  /** Fetch raw turn rows in a time window · optionally filtered by
   *  brand and/or model. Ordered oldest→newest. */
  queryTurns(w: QueryWindow): TurnSummary[] {
    const conds: string[] = ['completed_at >= ?', 'completed_at < ?'];
    const params: (string | number)[] = [w.fromMs, w.toMs];
    if (w.provider) {
      conds.push('provider = ?');
      params.push(w.provider);
    }
    if (w.model) {
      conds.push('model = ?');
      params.push(w.model);
    }
    const sql =
      `SELECT * FROM turn_log WHERE ${conds.join(' AND ')} ORDER BY completed_at ASC`;
    const rows = this.db.prepare(sql).all(...params) as TurnRow[];
    return rows.map(rowToTurn);
  }

  /** Aggregate token/cost totals for a window · cheap single-query
   *  rollup used by `BudgetStatus` LLM tool + `/budget` slash. */
  aggregate(w: QueryWindow): AggregateUsage {
    const conds: string[] = ['completed_at >= ?', 'completed_at < ?'];
    const params: (string | number)[] = [w.fromMs, w.toMs];
    if (w.provider) {
      conds.push('provider = ?');
      params.push(w.provider);
    }
    if (w.model) {
      conds.push('model = ?');
      params.push(w.model);
    }
    const sql = `
      SELECT
        COUNT(*) AS turns,
        COALESCE(SUM(input_tokens), 0) AS input_tokens,
        COALESCE(SUM(output_tokens), 0) AS output_tokens,
        COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
        COALESCE(SUM(cache_create_tokens), 0) AS cache_create_tokens,
        COALESCE(SUM(cost_usd), 0) AS cost_usd
      FROM turn_log WHERE ${conds.join(' AND ')}
    `;
    const row = this.db.prepare(sql).get(...params) as {
      turns: number;
      input_tokens: number;
      output_tokens: number;
      cache_read_tokens: number;
      cache_create_tokens: number;
      cost_usd: number;
    };
    return {
      turns: Number(row.turns),
      inputTokens: Number(row.input_tokens),
      outputTokens: Number(row.output_tokens),
      cacheReadTokens: Number(row.cache_read_tokens),
      cacheCreateTokens: Number(row.cache_create_tokens),
      costUsd: Number(row.cost_usd),
    };
  }

  /** Delete rows older than `retentionMs` (default 56d). Returns the
   *  number of rows removed — caller may log a one-line audit. */
  pruneOld(
    retentionMs: number = DEFAULT_RETENTION_MS,
    nowMs: number = Date.now(),
  ): number {
    const cutoff = nowMs - retentionMs;
    const res = this.db
      .prepare('DELETE FROM turn_log WHERE completed_at < ?')
      .run(cutoff);
    return Number(res.changes);
  }

  /** Row count · diagnostics + test assertions. */
  size(): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS n FROM turn_log')
      .get() as { n: number };
    return Number(row.n);
  }

  close(): void {
    this.db.close();
  }
}

function rowToTurn(row: TurnRow): TurnSummary {
  return {
    turnId: row.turn_id,
    sessionId: row.session_id,
    provider: row.provider as UsageProvider,
    model: row.model,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    ...(row.cache_read_tokens != null ? { cacheReadTokens: row.cache_read_tokens } : {}),
    ...(row.cache_create_tokens != null ? { cacheCreateTokens: row.cache_create_tokens } : {}),
    ...(row.cost_usd != null ? { costUsd: row.cost_usd } : {}),
    completedAt: row.completed_at,
  };
}

// ─── Module-level singleton ──────────────────────────────────────────

let _instance: BudgetHistoryStore | null = null;

/** Lazy singleton for production callers. Tests should construct
 *  `new BudgetHistoryStore(tmpPath)` and close it explicitly. */
export function getBudgetHistoryStore(): BudgetHistoryStore {
  if (!_instance) _instance = new BudgetHistoryStore();
  return _instance;
}

/** Test seam — release the singleton so the next call reopens a fresh
 *  handle (e.g. after a tmp-dir swap between tests). */
export function _resetBudgetHistoryStoreForTesting(): void {
  if (_instance) {
    _instance.close();
    _instance = null;
  }
}

/** Test seam · inject a pre-built store (tests own the close lifecycle
 *  and don't want reset to call close on their own handle). */
export function _setBudgetHistoryStoreForTesting(store: BudgetHistoryStore): void {
  _instance = store;
}
