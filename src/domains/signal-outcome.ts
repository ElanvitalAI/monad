// ── 사후수익률 검증 — 투자 심화 B3 (2026-07-11·Goodhart) ────────────────────────
//
// 집행된 신호(paper/live-filled)의 **실제 forward 수익률**로 방향이 맞았는지 검증한다(oos-verify
// 개념). §12.4 Goodhart 가드의 실체화 — 자기선언 지표가 아니라 **실성과(사후수익률)**로 해상도를
// 검증. hit-rate 를 A6 resolution metrics 에 융합(TECH §10 미래seam 실체화).
//
// 방향 정확: 보호(sell)는 이후 하락 시 정확(손실 회피), 확대(buy)는 이후 상승 시 정확.
// horizon(기본 3일) 경과분만 검증. 멱등(outcome_at). READ-ONLY·무매매.
//
// 설계: 내부 문서 `PLAN-investment-resolution-deepening-2026-07-11` §0·§3(B3).

import type { Signal } from './signal-pool.js';
import { SignalPool } from './signal-pool.js';
import type { SurfaceEventInput } from './surface-events.js';
import { debug } from '../debug/log.js';

export interface ExecFill { side: 'buy' | 'sell'; entryPrice: number }

/** 사후결과 레코드(각인 콜백 H1 입력). markOutcome 직후 조립. */
export interface OutcomeRecord {
  eventId: string;          // 원 신호 id(refs)
  asset?: string;
  side: 'buy' | 'sell';
  ret: number;              // 방향 반영 수익률
  correct: boolean;
  at: string;
  severity?: string;
  dedupGroup?: string;
}

/** ★ 축C H1 — 시그널 사후결과 → 기억 각인 이벤트. 적중/빗나감 신호를 해마(surface_events)에
 *  각인 → 회상 시 recall_count 획득(neoHebbian three-factor: 사후결과=reward 신호가 기억 경로 강화).
 *  importance = |수익률| 현저성(정확 시 +1). 순수(SurfaceEventInput 반환·recordEvent 는 caller 배선). */
export function signalOutcomeToEvent(rec: OutcomeRecord): SurfaceEventInput {
  const pct = rec.ret * 100;
  const importance = Math.max(3, Math.min(10, Math.round(5 + Math.abs(pct) / 2) + (rec.correct ? 1 : 0)));
  const dir = rec.side === 'sell' ? '보호' : '확대';
  const asset = rec.asset ?? '?';
  const summary = `${asset} ${dir} 신호 → ${pct >= 0 ? '+' : ''}${pct.toFixed(1)}% (${rec.correct ? '정확' : '빗나감'})`;
  return {
    surface: 'signal-outcome',
    direction: 'outbound',
    kind: 'signal',
    text: summary,
    summary,
    importance,
    ...(rec.asset ? { tags: rec.asset } : {}),
    refs: JSON.stringify({
      signalId: rec.eventId, ret: Math.round(rec.ret * 1e4) / 1e4, correct: rec.correct,
      ...(rec.dedupGroup ? { dedupGroup: rec.dedupGroup } : {}), ...(rec.severity ? { severity: rec.severity } : {}),
    }),
    domain: 'finance',
  };
}

/** execDetail("PAPER sell 3 005930.KO @286500 …") → side/entryPrice. 미파싱=null. */
export function parseExecFill(detail: string | undefined): ExecFill | null {
  if (!detail) return null;
  const side = /\b(buy|sell)\b/i.exec(detail)?.[1]?.toLowerCase() as 'buy' | 'sell' | undefined;
  const price = /@\s*([0-9]+(?:\.[0-9]+)?)/.exec(detail)?.[1];
  if (!side || !price) return null;
  const entryPrice = Number(price);
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) return null;
  return { side, entryPrice };
}

/** 방향 반영 수익률 — 보호(sell)는 하락이 유리(부호 반전), 확대(buy)는 상승이 유리. */
export function directionalReturn(fill: ExecFill, forwardPrice: number): number {
  const raw = (forwardPrice - fill.entryPrice) / fill.entryPrice;
  return fill.side === 'sell' ? -raw : raw;   // sell 후 하락 = +유리
}

export interface OutcomeDeps {
  /** forward 시세(현재가·주입). null=검증 보류. */
  priceOf: (symbol: string) => number | null;
  now?: () => string;
  /** 검증 horizon(일·기본 3). exec_at + horizon 경과분만. */
  horizonDays?: number;
  limit?: number;
  /** ★ H1 각인 콜백 — markOutcome 직후 호출(각인/관측은 caller 배선·runOutcomeCheck 순수 유지). */
  onOutcome?: (rec: OutcomeRecord) => void;
}

export interface RunOutcomeResult {
  checked: number;
  verified: number;
  correct: number;
  skipped: number;
  invalidExecutionTime: number;
  pendingHorizon: number;
  unparseableFillDetail: number;
  missingPrice: number;
}

/** 집행분 사후수익률 검증. horizon 경과 + 파싱 + forward 시세 있는 것만. 멱등. */
export function runOutcomeCheck(pool: SignalPool, deps: OutcomeDeps): RunOutcomeResult {
  const nowIso = (deps.now ?? (() => new Date().toISOString()))();
  const nowMs = Date.parse(nowIso);
  const horizonMs = (deps.horizonDays ?? 3) * 86_400_000;
  const targets = pool.listPendingOutcome(deps.limit ?? 50);

  let verified = 0; let correct = 0;
  let invalidExecutionTime = 0; let pendingHorizon = 0;
  let unparseableFillDetail = 0; let missingPrice = 0;
  for (const s of targets) {
    const execMs = s.execAt ? Date.parse(s.execAt) : NaN;
    if (Number.isNaN(execMs)) { invalidExecutionTime += 1; continue; }
    if (nowMs - execMs < horizonMs) { pendingHorizon += 1; continue; }
    const fill = parseExecFill(s.execDetail);
    if (!fill) {
      unparseableFillDetail += 1;
      try { debug.log('signal.outcome', 'unparseable-fill-detail', { eventId: s.eventId, execDetail: s.execDetail }); } catch { /* 관측 실패는 사후검증에 무영향 */ }
      continue;
    }
    const fwd = s.asset ? deps.priceOf(s.asset) : null;
    if (!fwd || fwd <= 0) { missingPrice += 1; continue; }
    const ret = directionalReturn(fill, fwd);
    const ok = ret > 0;
    pool.markOutcome(s.eventId, { return: ret, correct: ok, at: nowIso });
    // ★ H1 각인 — 사후결과를 기억(해마)에 남기도록 caller 에 전달(각인 실패는 검증에 무영향).
    try {
      deps.onOutcome?.({
        eventId: s.eventId, side: fill.side, ret, correct: ok, at: nowIso,
        ...(s.asset ? { asset: s.asset } : {}),
        ...(s.severity ? { severity: s.severity } : {}),
        ...(s.dedupGroup ? { dedupGroup: s.dedupGroup } : {}),
      });
    } catch { /* 각인 실패는 사후검증에 무영향 */ }
    verified += 1; if (ok) correct += 1;
  }
  const skipped = invalidExecutionTime + pendingHorizon + unparseableFillDetail + missingPrice;
  return {
    checked: targets.length,
    verified,
    correct,
    skipped,
    invalidExecutionTime,
    pendingHorizon,
    unparseableFillDetail,
    missingPrice,
  };
}

/** 편의 — Signal 배열에서 검증된 hit-rate(테스트/집계). */
export function hitRateOf(signals: Signal[]): { verified: number; correct: number; hitRate: number } {
  const v = signals.filter((s) => s.outcomeAt);
  const c = v.filter((s) => s.outcomeCorrect === 1).length;
  return { verified: v.length, correct: c, hitRate: v.length > 0 ? c / v.length : 0 };
}

/** ★ 축C H2 — 소스 hit-rate → trust 신뢰도 팩터(적응형 가중·eligibility-trace식).
 *  minSample 미만(증거 부족)=1.0(중립). hit-rate 0.5(무작위)=1.0 기준, 적중 편향 상방 완만(최대 +15%)·
 *  빗나감 하방 강(최대 -30%·보수). bounded [0.7, 1.15]. Goodhart 가드(소표본 노이즈 배제). */
export function trustReliabilityFactor(stat: { verified: number; hitRate: number } | undefined, opts: { minSample?: number } = {}): number {
  const minSample = opts.minSample ?? 10;
  if (!stat || stat.verified < minSample) return 1.0;
  const dev = stat.hitRate - 0.5;                                // -0.5 ~ +0.5
  const factor = dev >= 0 ? 1 + dev * 0.3 : 1 + dev * 0.6;       // +0.5→1.15 · -0.5→0.7
  return Math.max(0.7, Math.min(1.15, factor));
}

/** 소스별 hit-rate 맵 → trust 팩터 맵(applyLearnedTrust 입력). */
export function learnedTrustFactors(hitRates: Record<string, { verified: number; hitRate: number }>, opts: { minSample?: number } = {}): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [src, stat] of Object.entries(hitRates)) out[src] = trustReliabilityFactor(stat, opts);
  return out;
}
