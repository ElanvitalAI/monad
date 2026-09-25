// ── OOS 검증 (A1 · backtest-oos · 2026-07-08) ─────────────────────────────
//
// 페이퍼 CONFIRMED 예측(전략 롱=상승 기대)을 실제 forward 수익과 대조해 게이트
// 신뢰도를 실증. confirmed 4/4 과최적화 경보의 실데이터 검증. 순수 함수 —
// paper_fills(과거 체결) + forward 가격(가격 DB)을 deps 로 주입. 배치는 scripts/
// oos-verify.ts. [[ROADMAP-quant-backtest-retro-loops-2026-07-08]] A1.

import { Database } from 'bun:sqlite';

export interface PaperFillRow { expId: string; fromDate: string; symbol: string; pDecision: number }

export interface OOSCheck {
  expId: string; symbol: string; fromDate: string; horizon: number;
  pDecision: number; forwardClose: number; forwardReturn: number;
  predicted: 'up'; hit: boolean;
}

/** 과거 페이퍼 체결(horizon 지난) → forward 수익·적중(순수). CONFIRMED buy = 상승 기대. */
export function computeOOSChecks(
  fills: PaperFillRow[], horizon: number,
  forwardCloseOf: (symbol: string, fromDate: string, horizon: number) => number | null,
): OOSCheck[] {
  const out: OOSCheck[] = [];
  for (const f of fills) {
    const fc = forwardCloseOf(f.symbol, f.fromDate, horizon);
    if (fc == null || !(f.pDecision > 0)) continue;
    const forwardReturn = fc / f.pDecision - 1;
    out.push({
      expId: f.expId, symbol: f.symbol, fromDate: f.fromDate, horizon,
      pDecision: f.pDecision, forwardClose: fc, forwardReturn,
      predicted: 'up', hit: forwardReturn > 0,   // CONFIRMED=롱 → 상승 적중
    });
  }
  return out;
}

export interface OOSSummary {
  n: number;
  hitRate: number;          // 적중률(예측=상승·실제 상승)
  meanForward: number;      // 평균 forward 수익
  ic: number;               // 예측(전부 +1) 방향과 실제 수익 부호 상관 근사
}

/** OOS 종합 — 적중률·평균 수익. hitRate 0.5 근처면 게이트 신뢰도 낮음(경보). */
export function summarizeOOS(checks: OOSCheck[]): OOSSummary {
  if (!checks.length) return { n: 0, hitRate: 0, meanForward: 0, ic: 0 };
  const hits = checks.filter(c => c.hit).length;
  const meanForward = checks.reduce((s, c) => s + c.forwardReturn, 0) / checks.length;
  // 예측이 전부 '상승'이므로 IC 근사 = 실제 상승 비율의 중심화(hitRate*2-1).
  const ic = hits / checks.length * 2 - 1;
  return { n: checks.length, hitRate: hits / checks.length, meanForward, ic };
}

/** 과거 페이퍼 체결(horizon 이상 경과·CONFIRMED 실험) 조회. */
export function loadDueFills(db: Database, horizon: number, now: string): PaperFillRow[] {
  const cutoff = new Date(Date.parse(now.slice(0, 10)) - horizon * 86400_000).toISOString().slice(0, 10);
  const rows = db.query(
    `SELECT DISTINCT p.exp_id, substr(p.ts_signal,1,10) AS from_date, p.symbol, p.p_decision
     FROM paper_fills p
     WHERE substr(p.ts_signal,1,10) <= ?
       AND (SELECT verdict FROM experiment_results r WHERE r.exp_id=p.exp_id ORDER BY r.ts DESC LIMIT 1) = 'CONFIRMED'
       AND NOT EXISTS (SELECT 1 FROM oos_checks o WHERE o.exp_id=p.exp_id AND o.symbol=p.symbol AND o.from_date=substr(p.ts_signal,1,10) AND o.horizon=?)`,
  ).all(cutoff, horizon) as Array<{ exp_id: string; from_date: string; symbol: string; p_decision: number }>;
  return rows.map(r => ({ expId: r.exp_id, fromDate: r.from_date, symbol: r.symbol, pDecision: r.p_decision }));
}

/** OOS 검증 결과 적재(멱등·UNIQUE). */
export function insertOOSChecks(db: Database, checks: OOSCheck[], checkedAt: string): number {
  const ins = db.prepare(`INSERT OR IGNORE INTO oos_checks
    (checked_at, exp_id, symbol, from_date, horizon, p_decision, forward_close, forward_return, predicted, hit)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);
  let n = 0;
  for (const c of checks) { const r = ins.run(checkedAt, c.expId, c.symbol, c.fromDate, c.horizon, c.pDecision, c.forwardClose, c.forwardReturn, c.predicted, c.hit ? 1 : 0); if (r.changes > 0) n++; }
  return n;
}

export type GateConfidence = 'high' | 'medium' | 'low' | 'unknown';

/** OOS 실증 기반 게이트 신뢰도(A2 정밀화). hitRate가 예측력을 실증 —
 *  낮으면 confirmed 4/4 과최적화 확정. 표본 부족 시 unknown(아직 판단 불가). */
export function gateConfidence(oos: OOSSummary): { level: GateConfidence; note: string } {
  if (oos.n < 20) return { level: 'unknown', note: `OOS 표본 부족(${oos.n}<20) — 판단 유보(horizon 축적 중)` };
  const pct = (oos.hitRate * 100).toFixed(0);
  if (oos.hitRate >= 0.55) return { level: 'high', note: `hitRate ${pct}% — 게이트 예측력 실증(신뢰)` };
  if (oos.hitRate >= 0.50) return { level: 'medium', note: `hitRate ${pct}% — 경계(동전던지기 근처)` };
  return { level: 'low', note: `hitRate ${pct}% — 게이트 과최적화 확정(강화 필요)` };
}

/** 누적 OOS 요약(최근 N일). finance_bt_loop·대시보드 노출용. */
export function oosStats(db: Database, opts: { sinceDays?: number; now?: string } = {}): OOSSummary & { hitRateByHorizon: Record<number, number> } {
  const since = opts.sinceDays && opts.now ? new Date(Date.parse(opts.now.slice(0, 10)) - opts.sinceDays * 86400_000).toISOString().slice(0, 10) : '2000-01-01';
  const rows = db.query(`SELECT horizon, forward_return, hit FROM oos_checks WHERE checked_at >= ?`).all(since) as Array<{ horizon: number; forward_return: number; hit: number }>;
  const checks = rows.map(r => ({ expId: '', symbol: '', fromDate: '', horizon: r.horizon, pDecision: 0, forwardClose: 0, forwardReturn: r.forward_return, predicted: 'up' as const, hit: !!r.hit }));
  const base = summarizeOOS(checks);
  const byH: Record<number, number> = {};
  for (const h of [...new Set(rows.map(r => r.horizon))]) { const hr = rows.filter(r => r.horizon === h); byH[h] = hr.filter(r => r.hit).length / hr.length; }
  return { ...base, hitRateByHorizon: byH };
}
