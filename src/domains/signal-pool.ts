// ── Signal Pool — 적응형 투자 오토파일럿 A1 (2026-07-11) ────────────────────
//
// 흩어진 수집기(커뮤니티·뉴스·SNS·시장·국면·공시)가 신호별로 직접 알림을 쏘던 구조(=스팸)를
// 끝내고, 원신호를 **공유 pool 에 적재만** 한다. 알림 판단은 게이트가 독점(1차 A1·2차 A2).
//
// 스키마 = 엘라누스 자율설계 산출(EXPERIMENT-elanous-autonomous-design)을 실화:
//   event_id·자산·발생/수집시각·출처·근거·신뢰도(trust ρ)·심각도(S0~S4·1차가 채움)·TTL·
//   중복군(dedup)·제안행동·원문. 관찰→판단→주문→체결 lineage 추적의 뿌리.
//
// 도메인=investment(conatus 네임스페이스·core-not-customer). 매매/부작용 없음(적재+분류만).
//
// 설계: 내부 문서 `DESIGN-adaptive-investment-autopilot-2026-07-11` §2·§12.

import { Database } from 'bun:sqlite';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { conatusPath } from './conatus-data-dir.js';

export type Severity = 'S0' | 'S1' | 'S2' | 'S3' | 'S4';
export const SEVERITIES: readonly Severity[] = ['S0', 'S1', 'S2', 'S3', 'S4'];

/** 신호 소스군. */
export type SignalSource = 'community' | 'news' | 'sns' | 'market' | 'regime' | 'disclosure' | 'other';

export interface Signal {
  /** 동일 이벤트 추적 키(중복 적재 방지). */
  eventId: string;
  source: SignalSource;
  /** 종목/자산(선택). */
  asset?: string;
  observedAt: string;   // ISO — 발생 시각
  collectedAt: string;  // ISO — 수집 시각
  /** 구체 출처(채널·핸들·URL 도메인). */
  origin: string;
  evidenceUrl?: string;
  /** 신뢰도 ρ (0~1·내부=1.0·외부 소스 가중은 미래 seam). */
  trust: number;
  /** 심각도(1차 게이트가 채움·미분류=undefined). */
  severity?: Severity;
  severityReason?: string;
  /** 유효기간(ms·만료 신호 배제). */
  ttlMs?: number;
  /** 중복군(같은 서사 클러스터). */
  dedupGroup?: string;
  proposedAction?: string;
  /** 원문/요지. */
  raw: string;
  // ── 2차 게이트(A2) 판정 ──
  /** critical 확정 여부(2차 luna 심층). */
  confirmed?: boolean;
  /** 권고 — watch(관망)·alert(즉시)·adjust(포지션 조정 검토). */
  recommendation?: string;
  gate2Reason?: string;
  /** 2차 판정 시각(ISO·null=미판정). */
  gate2At?: string;
  // ── 라우팅(A3) ──
  /** 라우팅 경로 — interrupt(즉시 알림)·batch(다이제스트). undefined=미라우팅. */
  route?: string;
  /** 라우팅 시각(ISO·null=미라우팅). */
  routedAt?: string;
  /** 다이제스트 발송 시각(ISO·null=미발송·batch 대상만). */
  digestedAt?: string;
  // ── 집행(A5·멱등) ──
  /** 집행 처리 시각(ISO·null=미집행). 존재하면 재집행 안 함(멱등). */
  execAt?: string;
  /** 집행 모드 — paper(시뮬)·live(실주문). */
  execMode?: string;
  /** 집행 결과 — paper-filled·live-filled·refused·blocked·reapproval. */
  execStatus?: string;
  execDetail?: string;
  // ── 반응형 렌즈 심화(B1) ──
  /** 심화 디깅 시각(ISO·null=미디깅). */
  dugAt?: string;
  /** 심화 디깅 verdict(dig-engine 심층분석·라우터 알림 보강). */
  digVerdict?: string;
  digConfidence?: string;
  // ── Goodhart 사후수익률(B3) ──
  /** 사후검증 시각(ISO·null=미검증·horizon 미도래). */
  outcomeAt?: string;
  /** 진입 대비 forward 수익률(방향 부호 반영·+=유리). */
  outcomeReturn?: number;
  /** 방향 정확(1=맞음·0=틀림). */
  outcomeCorrect?: number;
}

/** 해상도 성과 원측(A6·rate 파생은 signal-metrics). */
export interface MetricsSnapshot {
  total: number;
  classified: number;
  criticalRaised: number;   // S3+S4
  gate2Judged: number;
  confirmed: number;
  falsePositive: number;    // gate2 판정됐으나 미확정(강등)
  pendingDigest: number;
  execPaper: number;
  execRefused: number;
  outcomeVerified: number;   // B3 사후검증 완료 수
  outcomeCorrect: number;    // B3 방향 정확 수
  bySeverity: Record<Severity, number>;
}

export const SIGNAL_POOL_DB_PATH = conatusPath('signal_pool.db');

export class SignalPool {
  private db: Database;

  constructor(opts: { path?: string } = {}) {
    const path = opts.path ?? SIGNAL_POOL_DB_PATH;
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    try {
      this.db.run('PRAGMA busy_timeout = 2000');
      this.db.run(`CREATE TABLE IF NOT EXISTS signals (
        event_id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        asset TEXT,
        observed_at TEXT NOT NULL,
        collected_at TEXT NOT NULL,
        origin TEXT NOT NULL,
        evidence_url TEXT,
        trust REAL NOT NULL DEFAULT 1.0,
        severity TEXT,
        severity_reason TEXT,
        ttl_ms INTEGER,
        dedup_group TEXT,
        proposed_action TEXT,
        raw TEXT NOT NULL
      )`);
      this.db.run(`CREATE INDEX IF NOT EXISTS idx_signals_severity ON signals(severity)`);
      this.db.run(`CREATE INDEX IF NOT EXISTS idx_signals_dedup ON signals(dedup_group)`);
      // A2 — 2차 게이트 판정 · A3 — 라우팅 · A5 — 집행 컬럼(기존 DB 무손상·ADD COLUMN 멱등).
      for (const col of [
        'confirmed INTEGER', 'recommendation TEXT', 'gate2_reason TEXT', 'gate2_at TEXT',
        'route TEXT', 'routed_at TEXT', 'digested_at TEXT',
        'exec_at TEXT', 'exec_mode TEXT', 'exec_status TEXT', 'exec_detail TEXT',
        'dug_at TEXT', 'dig_verdict TEXT', 'dig_confidence TEXT',
        'outcome_at TEXT', 'outcome_return REAL', 'outcome_correct INTEGER',
      ]) {
        try {
          this.db.run(`ALTER TABLE signals ADD COLUMN ${col}`);
        } catch (error) {
          if (!(error instanceof Error) || !/duplicate column name/i.test(error.message)) throw error;
        }
      }
      this.db.run(`CREATE INDEX IF NOT EXISTS idx_signals_route ON signals(route, routed_at)`);
      this.db.run(`CREATE INDEX IF NOT EXISTS idx_signals_exec ON signals(exec_at)`);
      this.db.run(`CREATE INDEX IF NOT EXISTS idx_signals_dug ON signals(dug_at)`);
    } catch (error) {
      this.db.close();
      if (error instanceof Error && /database is locked/i.test(error.message)) {
        throw new Error(`SignalPool database is locked: ${path}`, { cause: error });
      }
      throw error;
    }
  }

  /** 신호 적재 — event_id 중복은 무시(멱등·재수집 안전). 반환=신규 적재 여부. */
  ingest(s: Signal): { inserted: boolean } {
    const r = this.db.prepare(`INSERT OR IGNORE INTO signals (
      event_id, source, asset, observed_at, collected_at, origin, evidence_url,
      trust, severity, severity_reason, ttl_ms, dedup_group, proposed_action, raw
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      s.eventId, s.source, s.asset ?? null, s.observedAt, s.collectedAt, s.origin,
      s.evidenceUrl ?? null, s.trust, s.severity ?? null, s.severityReason ?? null,
      s.ttlMs ?? null, s.dedupGroup ?? null, s.proposedAction ?? null, s.raw,
    );
    return { inserted: r.changes > 0 };
  }

  /** 미분류(severity NULL) 신호 — 1차 게이트가 소비. 오래된 순(FIFO). */
  listUnclassified(limit = 200): Signal[] {
    const rows = this.db.prepare(
      `SELECT * FROM signals WHERE severity IS NULL ORDER BY collected_at ASC LIMIT ?`,
    ).all(limit) as SignalRow[];
    return rows.map(rowToSignal);
  }

  /** 심각도별 조회(라우팅·다이제스트). */
  listBySeverity(sev: Severity, limit = 200): Signal[] {
    const rows = this.db.prepare(
      `SELECT * FROM signals WHERE severity = ? ORDER BY collected_at DESC LIMIT ?`,
    ).all(sev, limit) as SignalRow[];
    return rows.map(rowToSignal);
  }

  /** 1차 게이트 판정 기록. */
  markSeverity(eventId: string, severity: Severity, reason: string): void {
    this.db.prepare(`UPDATE signals SET severity = ?, severity_reason = ? WHERE event_id = ?`)
      .run(severity, reason, eventId);
  }

  /** 2차 게이트 대상 — critical(S3+)이면서 미판정(gate2_at NULL). 최신 우선. */
  listForGate2(limit = 50): Signal[] {
    const rows = this.db.prepare(
      `SELECT * FROM signals WHERE severity IN ('S3','S4') AND gate2_at IS NULL ORDER BY collected_at DESC LIMIT ?`,
    ).all(limit) as SignalRow[];
    return rows.map(rowToSignal);
  }

  /** 2차 게이트 판정 기록. */
  markGate2(eventId: string, v: { confirmed: boolean; recommendation: string; reason: string; at: string }): void {
    this.db.prepare(`UPDATE signals SET confirmed = ?, recommendation = ?, gate2_reason = ?, gate2_at = ? WHERE event_id = ?`)
      .run(v.confirmed ? 1 : 0, v.recommendation, v.reason, v.at, eventId);
  }

  /** 2차 확정 critical(라우팅 A3 — 즉시 알림/조정 대상). */
  listConfirmed(limit = 50): Signal[] {
    const rows = this.db.prepare(
      `SELECT * FROM signals WHERE confirmed = 1 ORDER BY gate2_at DESC LIMIT ?`,
    ).all(limit) as SignalRow[];
    return rows.map(rowToSignal);
  }

  /** 라우팅 대상 — 확정 critical 이면서 미라우팅(routed_at NULL). 오래된 순(FIFO). */
  listUnrouted(limit = 50): Signal[] {
    const rows = this.db.prepare(
      `SELECT * FROM signals WHERE confirmed = 1 AND routed_at IS NULL ORDER BY gate2_at ASC LIMIT ?`,
    ).all(limit) as SignalRow[];
    return rows.map(rowToSignal);
  }

  /** 라우팅 경로 기록(interrupt/batch·A3). */
  markRouted(eventId: string, route: string, at: string): void {
    this.db.prepare(`UPDATE signals SET route = ?, routed_at = ? WHERE event_id = ?`)
      .run(route, at, eventId);
  }

  /** 다이제스트 대기 — batch 라우팅 됐으나 아직 미발송(digested_at NULL). 오래된 순. */
  listPendingDigest(limit = 100): Signal[] {
    const rows = this.db.prepare(
      `SELECT * FROM signals WHERE route = 'batch' AND digested_at IS NULL ORDER BY gate2_at ASC LIMIT ?`,
    ).all(limit) as SignalRow[];
    return rows.map(rowToSignal);
  }

  /** 다이제스트 발송 기록(batch 소진). */
  markDigested(eventIds: string[], at: string): void {
    const stmt = this.db.prepare(`UPDATE signals SET digested_at = ? WHERE event_id = ?`);
    const tx = this.db.transaction((ids: string[]) => { for (const id of ids) stmt.run(at, id); });
    tx(eventIds);
  }

  /** 집행 대상(A5) — 확정 critical + 권고 adjust + 미집행(exec_at NULL). 오래된 순(FIFO). */
  listPendingExec(limit = 50): Signal[] {
    const rows = this.db.prepare(
      `SELECT * FROM signals WHERE confirmed = 1 AND recommendation = 'adjust' AND exec_at IS NULL ORDER BY gate2_at ASC LIMIT ?`,
    ).all(limit) as SignalRow[];
    return rows.map(rowToSignal);
  }

  /** 집행 처리 기록(멱등·재집행 방지). */
  markExec(eventId: string, v: { mode: string; status: string; detail: string; at: string }): void {
    this.db.prepare(`UPDATE signals SET exec_at = ?, exec_mode = ?, exec_status = ?, exec_detail = ? WHERE event_id = ?`)
      .run(v.at, v.mode, v.status, v.detail, eventId);
  }

  /** 반응형 렌즈 대상(B1) — 확정 critical(S4 또는 권고 adjust) 이면서 미디깅(dug_at NULL). 최신 우선. */
  listPendingDig(limit = 20): Signal[] {
    const rows = this.db.prepare(
      `SELECT * FROM signals WHERE confirmed = 1 AND (severity = 'S4' OR recommendation = 'adjust') AND dug_at IS NULL ORDER BY gate2_at DESC LIMIT ?`,
    ).all(limit) as SignalRow[];
    return rows.map(rowToSignal);
  }

  /** 심화 디깅 verdict 기록(멱등·재디깅 방지·라우터 알림 보강). */
  markDug(eventId: string, v: { verdict: string; confidence: string; at: string }): void {
    this.db.prepare(`UPDATE signals SET dug_at = ?, dig_verdict = ?, dig_confidence = ? WHERE event_id = ?`)
      .run(v.at, v.verdict.slice(0, 1000), v.confidence, eventId);
  }

  /** 사후검증 대상(B3) — 집행됐고(paper/live-filled) 아직 미검증(outcome_at NULL). 오래된 순. */
  listPendingOutcome(limit = 50): Signal[] {
    const rows = this.db.prepare(
      `SELECT * FROM signals WHERE exec_status IN ('paper-filled','live-filled') AND outcome_at IS NULL ORDER BY exec_at ASC LIMIT ?`,
    ).all(limit) as SignalRow[];
    return rows.map(rowToSignal);
  }

  /** 사후수익률 검증 기록(Goodhart 실성과·멱등). */
  markOutcome(eventId: string, v: { return: number; correct: boolean; at: string }): void {
    this.db.prepare(`UPDATE signals SET outcome_at = ?, outcome_return = ?, outcome_correct = ? WHERE event_id = ?`)
      .run(v.at, v.return, v.correct ? 1 : 0, eventId);
  }

  /** 사후검증 hit-rate(Goodhart·A6 metrics) — 검증된 집행의 방향 정확 비율. */
  outcomeHitRate(): { verified: number; correct: number; hitRate: number } {
    const r = this.db.prepare(
      `SELECT COUNT(*) AS v, COALESCE(SUM(outcome_correct),0) AS c FROM signals WHERE outcome_at IS NOT NULL`,
    ).get() as { v: number; c: number };
    return { verified: r.v, correct: r.c, hitRate: r.v > 0 ? r.c / r.v : 0 };
  }

  /** ★ H2 — 소스별 사후검증 hit-rate(적응형 신뢰가중 되먹임의 근거). GROUP BY source. */
  sourceHitRates(): Record<string, { verified: number; correct: number; hitRate: number }> {
    const rows = this.db.prepare(
      `SELECT source, COUNT(*) AS v, COALESCE(SUM(outcome_correct),0) AS c
       FROM signals WHERE outcome_at IS NOT NULL GROUP BY source`,
    ).all() as Array<{ source: string; v: number; c: number }>;
    const out: Record<string, { verified: number; correct: number; hitRate: number }> = {};
    for (const r of rows) out[r.source] = { verified: r.v, correct: r.c, hitRate: r.v > 0 ? r.c / r.v : 0 };
    return out;
  }

  /** ★ H2 — pending(미분류) 신호의 trust 를 소스별 factor 로 재가중(적중 이력→신뢰 되먹임).
   *  bounded [0,1]·비파괴(factor 1=무변경)·미분류만(게이트 前). eligibility-trace식: 누적 성과가
   *  경로(소스) 가중을 갱신. 반환=조정 건수. 매매 무접촉(trust=신호 가중·게이팅 컨텍스트). */
  applyLearnedTrust(factors: Record<string, number>): { adjusted: number } {
    const rows = this.db.prepare(`SELECT event_id, source, trust FROM signals WHERE severity IS NULL`)
      .all() as Array<{ event_id: string; source: string; trust: number }>;
    const upd = this.db.prepare(`UPDATE signals SET trust = ? WHERE event_id = ?`);
    let adjusted = 0;
    for (const r of rows) {
      const f = factors[r.source];
      if (f == null || f === 1) continue;
      const next = Math.max(0, Math.min(1, r.trust * f));
      if (next !== r.trust) { upd.run(next, r.event_id); adjusted += 1; }
    }
    return { adjusted };
  }

  /** 같은 dedup_group 의 다른 신호 수(중복 서사 클러스터링·1차가 참고). */
  dedupGroupCount(dedupGroup: string): number {
    const r = this.db.prepare(`SELECT COUNT(*) AS n FROM signals WHERE dedup_group = ?`)
      .get(dedupGroup) as { n: number };
    return r.n;
  }

  /** 같은 서사(dedupGroup)에 이미 critical(S3+) 신호가 있나 — 급증 승격을 서사당 1대표로 제한(P4). */
  groupHasCritical(dedupGroup: string): boolean {
    const r = this.db.prepare(`SELECT 1 FROM signals WHERE dedup_group = ? AND severity IN ('S3','S4') LIMIT 1`)
      .get(dedupGroup) as { 1: number } | null;
    return r != null;
  }

  /**
   * 최근 창(sinceIso 이후) 커뮤니티 버즈 상위 서사 — dedupGroup(티커) 별 신호 수·최근 샘플(P5).
   * 급증(S3)까지 못 간 S2 버즈를 가시화하는 다이제스트용. 티커 없는 잡담(빈 dedup_group)은 제외.
   */
  topCommunityNarratives(sinceIso: string, limit = 10): { narrative: string; count: number; lastAt: string; sample: string }[] {
    const rows = this.db.prepare(
      `SELECT s.dedup_group AS narrative, COUNT(*) AS count, MAX(s.collected_at) AS lastAt,
         (SELECT raw FROM signals x WHERE x.dedup_group = s.dedup_group ORDER BY x.collected_at DESC LIMIT 1) AS sample
       FROM signals s
       WHERE s.source = 'community' AND s.severity IN ('S2','S3')
         AND s.dedup_group IS NOT NULL AND s.dedup_group != '' AND s.collected_at > ?
       GROUP BY s.dedup_group ORDER BY count DESC LIMIT ?`,
    ).all(sinceIso, limit) as { narrative: string; count: number; lastAt: string; sample: string }[];
    return rows;
  }

  count(): number {
    return (this.db.prepare(`SELECT COUNT(*) AS n FROM signals`).get() as { n: number }).n;
  }

  /** 해상도 성과 원측(A6·발굴형 해상도) — 실측 카운트만(rate 파생은 signal-metrics). */
  metricsSnapshot(): MetricsSnapshot {
    const one = (sql: string): number => (this.db.prepare(sql).get() as { n: number }).n;
    const bySeverity = {} as Record<Severity, number>;
    for (const sev of SEVERITIES) {
      bySeverity[sev] = one(`SELECT COUNT(*) AS n FROM signals WHERE severity = '${sev}'`);
    }
    return {
      total: this.count(),
      classified: one(`SELECT COUNT(*) AS n FROM signals WHERE severity IS NOT NULL`),
      criticalRaised: one(`SELECT COUNT(*) AS n FROM signals WHERE severity IN ('S3','S4')`),
      gate2Judged: one(`SELECT COUNT(*) AS n FROM signals WHERE gate2_at IS NOT NULL`),
      confirmed: one(`SELECT COUNT(*) AS n FROM signals WHERE confirmed = 1`),
      falsePositive: one(`SELECT COUNT(*) AS n FROM signals WHERE gate2_at IS NOT NULL AND confirmed = 0`),
      pendingDigest: one(`SELECT COUNT(*) AS n FROM signals WHERE route = 'batch' AND digested_at IS NULL`),
      execPaper: one(`SELECT COUNT(*) AS n FROM signals WHERE exec_status = 'paper-filled'`),
      execRefused: one(`SELECT COUNT(*) AS n FROM signals WHERE exec_at IS NOT NULL AND exec_status NOT IN ('paper-filled','live-filled')`),
      outcomeVerified: one(`SELECT COUNT(*) AS n FROM signals WHERE outcome_at IS NOT NULL`),
      outcomeCorrect: one(`SELECT COALESCE(SUM(outcome_correct),0) AS n FROM signals WHERE outcome_at IS NOT NULL`),
      bySeverity,
    };
  }

  close(): void { this.db.close(); }
}

interface SignalRow {
  event_id: string; source: string; asset: string | null;
  observed_at: string; collected_at: string; origin: string; evidence_url: string | null;
  trust: number; severity: string | null; severity_reason: string | null;
  ttl_ms: number | null; dedup_group: string | null; proposed_action: string | null; raw: string;
  confirmed?: number | null; recommendation?: string | null; gate2_reason?: string | null; gate2_at?: string | null;
  route?: string | null; routed_at?: string | null; digested_at?: string | null;
  exec_at?: string | null; exec_mode?: string | null; exec_status?: string | null; exec_detail?: string | null;
  dug_at?: string | null; dig_verdict?: string | null; dig_confidence?: string | null;
  outcome_at?: string | null; outcome_return?: number | null; outcome_correct?: number | null;
}

function rowToSignal(r: SignalRow): Signal {
  return {
    eventId: r.event_id, source: r.source as SignalSource, ...(r.asset ? { asset: r.asset } : {}),
    observedAt: r.observed_at, collectedAt: r.collected_at, origin: r.origin,
    ...(r.evidence_url ? { evidenceUrl: r.evidence_url } : {}), trust: r.trust,
    ...(r.severity ? { severity: r.severity as Severity } : {}),
    ...(r.severity_reason ? { severityReason: r.severity_reason } : {}),
    ...(r.ttl_ms != null ? { ttlMs: r.ttl_ms } : {}),
    ...(r.dedup_group ? { dedupGroup: r.dedup_group } : {}),
    ...(r.proposed_action ? { proposedAction: r.proposed_action } : {}), raw: r.raw,
    ...(r.confirmed != null ? { confirmed: r.confirmed === 1 } : {}),
    ...(r.recommendation ? { recommendation: r.recommendation } : {}),
    ...(r.gate2_reason ? { gate2Reason: r.gate2_reason } : {}),
    ...(r.gate2_at ? { gate2At: r.gate2_at } : {}),
    ...(r.route ? { route: r.route } : {}),
    ...(r.routed_at ? { routedAt: r.routed_at } : {}),
    ...(r.digested_at ? { digestedAt: r.digested_at } : {}),
    ...(r.exec_at ? { execAt: r.exec_at } : {}),
    ...(r.exec_mode ? { execMode: r.exec_mode } : {}),
    ...(r.exec_status ? { execStatus: r.exec_status } : {}),
    ...(r.exec_detail ? { execDetail: r.exec_detail } : {}),
    ...(r.dug_at ? { dugAt: r.dug_at } : {}),
    ...(r.dig_verdict ? { digVerdict: r.dig_verdict } : {}),
    ...(r.dig_confidence ? { digConfidence: r.dig_confidence } : {}),
    ...(r.outcome_at ? { outcomeAt: r.outcome_at } : {}),
    ...(r.outcome_return != null ? { outcomeReturn: r.outcome_return } : {}),
    ...(r.outcome_correct != null ? { outcomeCorrect: r.outcome_correct } : {}),
  };
}
