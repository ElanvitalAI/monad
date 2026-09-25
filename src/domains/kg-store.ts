// ── 국면 온톨로지 그래프 저장소 (M5/M7 · kg-store · 2026-07-08) ──────────
//
// 대표 8요구(R1-R8·RFC-regime-ontology-graph-m5)의 I/O 경계. knowledge.db 벡터
// (docs·749건)와 co-located: kg_nodes·kg_edges 두 테이블(같은 db → hybrid join·
// 단일 백업). 순수 I/O·READ 판단(매매 격리)·append-only(삭제 없이 invalid_at 무효화).
//
// 스키마 핵심:
//  - kg_nodes.kind 9종(company·chain·subchain·sector·group·event·policy·theme·macro)
//  - kg_edges.weight ★부호 있음(R8: 양=동조/밸류체인·음=적대/역상관)
//  - kg_edges.lead_lag ★전파 시차(일·R6: src 선행 일수)
//  - kg_edges.regime_at ★관측 당시 국면(R2 국면조건부) · valid_at/invalid_at(temporal)

import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { knowledgeDbPath } from './knowledge.js';

export type NodeKind =
  | 'company' | 'chain' | 'subchain' | 'sector' | 'group'
  | 'event' | 'policy' | 'theme' | 'macro';
export type Market = 'KR' | 'US' | 'GLOBAL';
export type EdgeRelation =
  | 'belongs_to' | 'supplies' | 'affects' | 'causes'
  | 'cross_market' | 'competes_with' | 'correlates' | 'hedges';

export interface KgNode {
  id: string;                 // 'company:005930' · 'chain:반도체' · 'group:P7'
  kind: NodeKind;
  market?: Market;
  name: string;
  aliases?: string[];         // 티커·영문·동의어 (deterministic 링킹)
  meta?: Record<string, unknown>;
  firstSeen: string;
  lastSeen: string;
  recallCount?: number;
}

export interface KgEdge {
  id?: string;                // 없으면 edgeId()로 파생
  src: string;
  dst: string;
  relation: EdgeRelation;
  weight?: number;            // ★부호 있음 (R8)
  leadLag?: number;           // ★전파 시차(일) (R6)
  confidence?: number;
  regimeAt?: string;          // ★관측 국면 (R2)
  validAt: string;
  invalidAt?: string;
  sourceRef?: string;         // 'seed:kr_chains' · 'corr:screener' · 'dig:12'
  extractedBy?: string;       // seed | correlation | deterministic | grok-fast | local
}

/** 노드 id 규약 — kind:key (key 는 종목코드·정규화 slug). */
export function nodeId(kind: NodeKind, key: string): string {
  return `${kind}:${key}`;
}

/** 엣지 id — 같은 (src,relation,dst,valid_at) 은 동일 관측(멱등). 12자 해시. */
export function edgeId(src: string, relation: string, dst: string, validAt: string): string {
  return createHash('sha1').update(`${src}|${relation}|${dst}|${validAt}`).digest('hex').slice(0, 12);
}

/** knowledge.db 열고 kg 테이블 ensure. 벡터 docs 와 co-located. */
export function openKgDb(path: string = knowledgeDbPath()): Database {
  const db = new Database(path);
  ensureKgTables(db);
  return db;
}

export function ensureKgTables(db: Database): void {
  db.run(`CREATE TABLE IF NOT EXISTS kg_nodes(
    id TEXT PRIMARY KEY, kind TEXT NOT NULL, market TEXT, name TEXT NOT NULL,
    aliases TEXT, meta TEXT, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL,
    recall_count INTEGER DEFAULT 0)`);
  db.run(`CREATE TABLE IF NOT EXISTS kg_edges(
    id TEXT PRIMARY KEY, src TEXT NOT NULL, dst TEXT NOT NULL, relation TEXT NOT NULL,
    weight REAL, lead_lag INTEGER DEFAULT 0, confidence REAL DEFAULT 0.5,
    regime_at TEXT, valid_at TEXT NOT NULL, invalid_at TEXT,
    source_ref TEXT, extracted_by TEXT)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_kg_edges_src ON kg_edges(src, invalid_at)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_kg_edges_dst ON kg_edges(dst, invalid_at)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_kg_nodes_kind ON kg_nodes(kind, market)`);
}

/** 노드 upsert — 멱등. 기존 있으면 last_seen·name·aliases·meta 갱신, recall_count·first_seen 보존. */
export function upsertNode(db: Database, node: KgNode): void {
  const aliases = node.aliases ? JSON.stringify(node.aliases) : null;
  const meta = node.meta ? JSON.stringify(node.meta) : null;
  db.run(
    `INSERT INTO kg_nodes(id, kind, market, name, aliases, meta, first_seen, last_seen, recall_count)
     VALUES(?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       kind=excluded.kind, market=excluded.market, name=excluded.name,
       aliases=COALESCE(excluded.aliases, kg_nodes.aliases),
       meta=COALESCE(excluded.meta, kg_nodes.meta),
       last_seen=excluded.last_seen`,
    [node.id, node.kind, node.market ?? null, node.name, aliases, meta,
      node.firstSeen, node.lastSeen, node.recallCount ?? 0],
  );
}

/** 엣지 append — 같은 관측(id) 이면 무시(멱등). append-only. */
export function addEdge(db: Database, edge: KgEdge): string {
  const id = edge.id ?? edgeId(edge.src, edge.relation, edge.dst, edge.validAt);
  db.run(
    `INSERT INTO kg_edges(id, src, dst, relation, weight, lead_lag, confidence,
       regime_at, valid_at, invalid_at, source_ref, extracted_by)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       weight=excluded.weight, lead_lag=excluded.lead_lag, confidence=excluded.confidence,
       regime_at=excluded.regime_at, invalid_at=excluded.invalid_at,
       source_ref=excluded.source_ref, extracted_by=excluded.extracted_by`,
    [id, edge.src, edge.dst, edge.relation, edge.weight ?? null, edge.leadLag ?? 0,
      edge.confidence ?? 0.5, edge.regimeAt ?? null, edge.validAt, edge.invalidAt ?? null,
      edge.sourceRef ?? null, edge.extractedBy ?? null],
  );
  return id;
}

/** 엣지 무효화(R2·R7 반전) — 삭제 안 함·invalid_at 세팅(감사 추적). */
export function invalidateEdge(db: Database, id: string, invalidAt: string): void {
  db.run(`UPDATE kg_edges SET invalid_at=? WHERE id=? AND invalid_at IS NULL`, [invalidAt, id]);
}

function rowToNode(r: KgNodeRow): KgNode {
  return {
    id: r.id, kind: r.kind as NodeKind, market: (r.market as Market) ?? undefined,
    name: r.name, aliases: r.aliases ? JSON.parse(r.aliases) as string[] : undefined,
    meta: r.meta ? JSON.parse(r.meta) as Record<string, unknown> : undefined,
    firstSeen: r.first_seen, lastSeen: r.last_seen, recallCount: r.recall_count,
  };
}

function rowToEdge(r: KgEdgeRow): KgEdge {
  return {
    id: r.id, src: r.src, dst: r.dst, relation: r.relation as EdgeRelation,
    weight: r.weight ?? undefined, leadLag: r.lead_lag ?? undefined,
    confidence: r.confidence ?? undefined, regimeAt: r.regime_at ?? undefined,
    validAt: r.valid_at, invalidAt: r.invalid_at ?? undefined,
    sourceRef: r.source_ref ?? undefined, extractedBy: r.extracted_by ?? undefined,
  };
}

export function getNode(db: Database, id: string): KgNode | null {
  const r = db.query(`SELECT * FROM kg_nodes WHERE id=?`).get(id) as KgNodeRow | null;
  return r ? rowToNode(r) : null;
}

export function listNodes(db: Database, opts: { kind?: NodeKind; market?: Market } = {}): KgNode[] {
  const cond: string[] = []; const args: (string | number | null)[] = [];
  if (opts.kind) { cond.push('kind=?'); args.push(opts.kind); }
  if (opts.market) { cond.push('market=?'); args.push(opts.market); }
  const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
  return (db.query(`SELECT * FROM kg_nodes ${where}`).all(...args) as KgNodeRow[]).map(rowToNode);
}

/** 엣지 조회 — src/dst/relation 필터 · activeOnly=invalid_at IS NULL(현재 유효). */
export function getEdges(
  db: Database,
  opts: { src?: string; dst?: string; relation?: EdgeRelation; activeOnly?: boolean } = {},
): KgEdge[] {
  const cond: string[] = []; const args: (string | number | null)[] = [];
  if (opts.src) { cond.push('src=?'); args.push(opts.src); }
  if (opts.dst) { cond.push('dst=?'); args.push(opts.dst); }
  if (opts.relation) { cond.push('relation=?'); args.push(opts.relation); }
  if (opts.activeOnly) cond.push('invalid_at IS NULL');
  const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
  return (db.query(`SELECT * FROM kg_edges ${where}`).all(...args) as KgEdgeRow[]).map(rowToEdge);
}

/** 미엘린 강화(M4.1·R1) — 회상된 노드 recall_count++. */
export function bumpRecall(db: Database, ids: string[]): void {
  if (!ids.length) return;
  const ph = ids.map(() => '?').join(',');
  db.run(`UPDATE kg_nodes SET recall_count = recall_count + 1 WHERE id IN (${ph})`, ids);
}

/** SHY 정리(수면 시냅스 하향정규화) — 반복 공고화로 누적된 관측 엣지 prune.
 *  1) 오래된 무효 엣지(invalid_at < now-graceDays) 삭제(감사 종료).
 *  2) 같은 (src,relation,dst) 활성 관측이 keepPerPair 초과면 최신 K개만 유지(오래된 것 삭제).
 *  구조 엣지(belongs_to·supplies)는 valid_at 고정이라 멱등 dedup(누적 안 함) → correlates 등만 대상. */
export function pruneEdges(
  db: Database,
  opts: { now: string; invalidGraceDays?: number; keepPerPair?: number; relations?: EdgeRelation[] } = { now: '' },
): { invalidPruned: number; dupPruned: number } {
  const invalidGraceDays = opts.invalidGraceDays ?? 90;
  const keepPerPair = opts.keepPerPair ?? 3;
  const relations = opts.relations ?? (['correlates'] as EdgeRelation[]);
  // 1) 오래된 무효 엣지 삭제
  const cutoff = new Date(`${opts.now.slice(0, 10)}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - invalidGraceDays);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const before = (db.query(`SELECT COUNT(*) c FROM kg_edges`).get() as { c: number }).c;
  db.run(`DELETE FROM kg_edges WHERE invalid_at IS NOT NULL AND invalid_at < ?`, [cutoffStr]);
  const afterInvalid = (db.query(`SELECT COUNT(*) c FROM kg_edges`).get() as { c: number }).c;
  // 2) pair 당 최신 keepPerPair 관측만 유지(활성 correlates 등)
  const ph = relations.map(() => '?').join(',');
  db.run(
    `DELETE FROM kg_edges WHERE id IN (
       SELECT id FROM (
         SELECT id, ROW_NUMBER() OVER (PARTITION BY src, relation, dst ORDER BY valid_at DESC) rn
         FROM kg_edges WHERE relation IN (${ph}) AND invalid_at IS NULL
       ) WHERE rn > ?)`,
    [...relations, keepPerPair],
  );
  const afterDup = (db.query(`SELECT COUNT(*) c FROM kg_edges`).get() as { c: number }).c;
  return { invalidPruned: before - afterInvalid, dupPruned: afterInvalid - afterDup };
}

export function kgStats(db: Database): { nodes: number; edges: number; activeEdges: number } {
  const n = (db.query(`SELECT COUNT(*) c FROM kg_nodes`).get() as { c: number }).c;
  const e = (db.query(`SELECT COUNT(*) c FROM kg_edges`).get() as { c: number }).c;
  const a = (db.query(`SELECT COUNT(*) c FROM kg_edges WHERE invalid_at IS NULL`).get() as { c: number }).c;
  return { nodes: n, edges: e, activeEdges: a };
}

interface KgNodeRow {
  id: string; kind: string; market: string | null; name: string;
  aliases: string | null; meta: string | null;
  first_seen: string; last_seen: string; recall_count: number;
}
interface KgEdgeRow {
  id: string; src: string; dst: string; relation: string;
  weight: number | null; lead_lag: number | null; confidence: number | null;
  regime_at: string | null; valid_at: string; invalid_at: string | null;
  source_ref: string | null; extracted_by: string | null;
}
