// ── 반응형 렌즈 — 투자 심화 해상도 적응형 B1 (2026-07-11) ─────────────────────
//
// 2차 게이트가 확정한 critical(S4 또는 권고 adjust) 신호에 **심화 디깅**(dig-engine runDig
// 재사용)을 렌즈 깊이로 호출한다. §12.4 반응형 — 고정 크론(*/10)이 아니라 **pool 이 트리거**.
// severity↑ → score↑ → dig-engine 재귀 깊이↑. verdict 를 pool 에 환류(라우터 알림 보강).
//
// ★ 그냥 복귀가 아니라 프레임워크에 맞게: 심화 능력(dig-runner/buzz-dig)을 pool confirmed
//   critical 트리거로 재프레임. READ-ONLY 분석·무매매. 멱등(dug_at·재디깅 방지·비용 바운드).
//
// 설계: 내부 문서 `PLAN-investment-resolution-deepening-2026-07-11` §0·§1(B1).

import type { Signal } from './signal-pool.js';
import { SignalPool } from './signal-pool.js';
import type { DigItem, DigResult } from './dig-engine.js';

export type DigFn = (item: DigItem) => Promise<DigResult | null>;

/** 확정 신호 → dig-engine DigItem. 심각도로 트리거 score(재귀 깊이) 결정. */
export function signalToDigItem(s: Signal): DigItem {
  return {
    id: `signal:pool:${s.eventId}`,
    topic: s.raw.slice(0, 300),
    sector: s.asset ?? s.source,
    score: s.severity === 'S4' ? 10 : 8,   // S4=최심(긴급), S3/adjust=심
  };
}

export interface DugItem { eventId: string; confidence: string; head: string }
export interface RunLensResult { processed: number; dug: number; failed: number; items: DugItem[] }

export interface LensDeps {
  /** 심화 디깅기 — 기본 signal-dig-cycle 이 dig-engine runDig 주입. */
  dig: DigFn;
  now?: () => string;
  limit?: number;
}

/** 미디깅 confirmed critical 을 심화 디깅·verdict 환류. 멱등(성공/실패 모두 dug 마킹·비용 바운드). */
export async function runReactiveLens(pool: SignalPool, deps: LensDeps): Promise<RunLensResult> {
  const now = deps.now ?? (() => new Date().toISOString());
  const targets = pool.listPendingDig(deps.limit ?? 20);
  const items: DugItem[] = [];
  let dug = 0; let failed = 0;

  for (const s of targets) {
    let res: DigResult | null = null;
    try { res = await deps.dig(signalToDigItem(s)); } catch { res = null; }
    if (res) {
      pool.markDug(s.eventId, { verdict: res.verdict, confidence: res.confidence, at: now() });
      dug += 1;
      items.push({ eventId: s.eventId, confidence: res.confidence, head: res.verdict.slice(0, 80) });
    } else {
      // 실패도 dug 마킹(재디깅 storm 방지·dig 비용 큼). 신호는 이미 gate2 판정+라우터 알림 받음.
      pool.markDug(s.eventId, { verdict: '(심화 분석 실패·gate2 판정 유지)', confidence: 'low', at: now() });
      failed += 1;
    }
  }
  return { processed: targets.length, dug, failed, items };
}
