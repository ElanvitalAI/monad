import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { sqlNowIso } from '../time/db-window.js';
import { parseGoalId } from './goal-author.js';
import { goalRunDbPath } from './goal-run-store.js';
import { debug } from '../debug/log.js';

/** Matches SQLite length() by counting Unicode code points instead of UTF-16 code units. */
function unicodeCodePointLength(value: string): number {
  return Array.from(value).length;
}

export interface GoalAskRecord {
  id: number;
  authorRunId: string;
  goalId: string;
  goalFile: string;
  ask: string;
  createdAt: string;
  askChars: number;
  documentChars: number | null;
  documentSha256: string | null;
}

export interface GoalAskWrite {
  authorRunId: string;
  goalFile: string;
  ask: string;
  document: string;
}

export interface GoalAskQuery {
  goalId?: string;
  authorRunId?: string;
  text?: string;
  limit?: number;
}

/** 마이그레이션이 「이미 있다」로 판정하는 오류. ⛔ 이 문면 결합이 이 함수의 «유일한» 취약점이라 한자리에 둔다.
 *  ⛔ 소비자가 이 모듈뿐이라 export 하지 않는다(무인 리뷰 must-fix — 소비자 없는 공개 표면). */
function isDuplicateColumnError(error: unknown): boolean {
  return /duplicate column name/i.test(error instanceof Error ? error.message : String(error));
}

/**
 * 레거시 표에 산출 문서 메타 컬럼을 «멱등»으로 더한다.
 *
 * ⛔⭐⭐ 종전엔 `PRAGMA table_info` 로 「없다」를 «보고 나서» `ALTER` 를 던졌다 — 그 사이가 «창»이다.
 *   하니스 자식은 «동시에» 저작하므로 두 프로세스가 둘 다 「없다」를 보고 둘 다 `ALTER` 를 던진다.
 *   뒤엣것이 `duplicate column name` 으로 죽고, 그 죽음은 «생성자»에서 나므로
 *   `recordGoalAsk` 의 fail-soft 가 그것을 삼킨다 ⇒ ***그 저작의 ask 가 «유실»된다.***
 *   🚨 유실을 막으려고 만든 저장소가 유실을 만드는 경로다(무인 리뷰 must-fix 2026-08-08).
 *
 * 🩹 그래서 «검사하지 않는다» — 시도하고 「이미 있다」만 흡수한다. 창 자체가 사라진다.
 * ⛔ 다른 오류(디스크·권한·스키마 파손)는 «삼키지 않는다» — 삼키면 그것이 또 조용한 유실이다.
 *
 * ⭐ `db` 를 인자로 받는 이유는 «테스트가 경쟁을 결정론으로 재현»할 수 있게 하기 위해서다:
 *   「진 프로세스」의 상태 = 검사로는 없는데 `ALTER` 는 duplicate 를 던지는 상태. 그것을 스텁으로 만든다.
 *   ⛔ 두 연결을 «순차»로 여는 테스트로는 못 잡는다 — 종전 구현도 통과하므로 판별력이 «0» 이다.
 */
export function addDocumentMetadataColumns(db: { run: (sql: string) => unknown }): void {
  for (const ddl of [
    'ALTER TABLE goal_ask ADD COLUMN document_chars INTEGER',
    'ALTER TABLE goal_ask ADD COLUMN document_sha256 TEXT',
  ]) {
    try {
      db.run(ddl);
    } catch (error) {
      if (!isDuplicateColumnError(error)) throw error;
    }
  }
}

export class GoalAskStore {
  private readonly db: Database;

  constructor(readonly path: string = goalRunDbPath(), readonly readOnly = false, openDatabase: typeof Database = Database) {
    if (readOnly) {
      this.db = new openDatabase(path, { readonly: true });
      return;
    }
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.run('PRAGMA journal_mode = WAL');
    this.db.run(`CREATE TABLE IF NOT EXISTS goal_ask (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      author_run_id TEXT NOT NULL,
      goal_id TEXT NOT NULL,
      goal_file TEXT NOT NULL,
      ask TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (${sqlNowIso()}),
      ask_chars INTEGER GENERATED ALWAYS AS (length(ask)) VIRTUAL,
      document_chars INTEGER,
      document_sha256 TEXT
    )`);
    this.addDocumentMetadataColumns();
    this.db.run('CREATE INDEX IF NOT EXISTS goal_ask_by_goal ON goal_ask(goal_id, id DESC)');
    this.db.run('CREATE INDEX IF NOT EXISTS goal_ask_by_run ON goal_ask(author_run_id, id DESC)');
  }

  insert(entry: GoalAskWrite): boolean {
    if (this.readOnly) return false;
    const goalId = parseGoalId(entry.document) ?? entry.document.match(/^- GoalId: ([0-9a-f]{16})$/m)?.[1];
    if (!goalId) return false;
    try {
      this.db.run(
        `INSERT INTO goal_ask (author_run_id, goal_id, goal_file, ask, created_at, document_chars, document_sha256) VALUES (?, ?, ?, ?, ${sqlNowIso()}, ?, ?)`,
        [
          entry.authorRunId,
          goalId,
          entry.goalFile,
          entry.ask,
          unicodeCodePointLength(entry.document),
          createHash('sha256').update(entry.document).digest('hex'),
        ],
      );
      return true;
    } catch {
      return false;
    }
  }

  query(filters: GoalAskQuery = {}): GoalAskRecord[] {
    const clauses: string[] = [];
    const params: Array<string | number> = [];
    if (filters.goalId) {
      clauses.push('goal_id = ?');
      params.push(filters.goalId);
    }
    if (filters.authorRunId) {
      clauses.push('author_run_id = ?');
      params.push(filters.authorRunId);
    }
    if (filters.text) {
      clauses.push('(instr(lower(ask), ?) > 0 OR instr(lower(goal_file), ?) > 0)');
      const text = filters.text.replace(/[A-Z]/g, (character) => character.toLowerCase());
      params.push(text, text);
    }
    const limit = Math.max(1, Math.floor(filters.limit ?? 50));
    params.push(limit);
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    const columns = new Set((this.db.query('PRAGMA table_info(goal_ask)').all() as Array<{ name: string }>).map((column) => column.name));
    const documentChars = columns.has('document_chars') ? 'document_chars' : 'NULL AS document_chars';
    const documentSha256 = columns.has('document_sha256') ? 'document_sha256' : 'NULL AS document_sha256';
    return (this.db.query(`SELECT id, author_run_id, goal_id, goal_file, ask, created_at, ask_chars, ${documentChars}, ${documentSha256} FROM goal_ask${where} ORDER BY id DESC LIMIT ?`).all(...params) as Array<{
      id: number;
      author_run_id: string;
      goal_id: string;
      goal_file: string;
      ask: string;
      created_at: string;
      ask_chars: number;
      document_chars: number | null;
      document_sha256: string | null;
    }>).map((row) => ({
      id: row.id,
      authorRunId: row.author_run_id,
      goalId: row.goal_id,
      goalFile: row.goal_file,
      ask: row.ask,
      createdAt: row.created_at,
      askChars: row.ask_chars,
      documentChars: row.document_chars,
      documentSha256: row.document_sha256,
    }));
  }

  /** 위 모듈 함수에 위임한다 — ⛔ 같은 설명을 두 자리에 두지 않는다(드리프트 방지). */
  private addDocumentMetadataColumns(): void {
    addDocumentMetadataColumns(this.db);
  }

  close(): void {
    this.db.close();
  }
}

/** Persist CLI author input without allowing provenance observation to block authoring. */
export function recordGoalAsk(entry: GoalAskWrite): boolean {
  try {
    const store = new GoalAskStore();
    try {
      return store.insert(entry);
    } finally {
      store.close();
    }
  } catch (error) {
    const path = goalRunDbPath();
    debug.log('goal-ledger.read', 'goal-ask-record-failed', {
      path,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/** Read an existing ledger without creating a database, WAL file, schema, or indexes. */
export function loadGoalAskRecords(filters: GoalAskQuery = {}, path: string = goalRunDbPath()): GoalAskRecord[] {
  if (path !== ':memory:' && !existsSync(path)) return [];
  try {
    const store = new GoalAskStore(path, true);
    try {
      return store.query(filters);
    } finally {
      store.close();
    }
  } catch (error) {
    // An older shared goal-run ledger has no goal_ask table yet; that is an empty ask ledger.
    if (error instanceof Error && /no such table:\s*goal_ask/i.test(error.message)) return [];
    throw error;
  }
}

function displayAsk(ask: string, askChars: number): string {
  const maximum = 160;
  if (ask.length <= maximum) return ask;
  return `${ask.slice(0, maximum)}… (접음; 원문 ${askChars}자)`;
}

export function renderGoalAskRecords(records: readonly GoalAskRecord[]): string {
  if (records.length === 0) return 'goal ask 기록 없음 (저작이 없었다는 뜻은 아님)';
  return records.map((record) => [
    `${record.goalId} · author run ${record.authorRunId}`,
    `file: ${record.goalFile}`,
    `ask: ${displayAsk(record.ask, record.askChars)}`,
    `document: ${record.documentChars === null ? 'unknown' : `${record.documentChars}자`} · sha256: ${record.documentSha256 ?? 'unknown'}`,
    `created: ${record.createdAt}`,
  ].join('\n')).join('\n\n');
}
