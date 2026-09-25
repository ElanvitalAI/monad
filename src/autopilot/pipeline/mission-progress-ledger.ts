// Progress Ledger — 미션 저널 read 래퍼 + 조율자 관측 (C3 승격 후 · 2026-07-20)
//
// ★ RFC P2. AutoGen Magentic-One 의 Progress Ledger 이중루프. 순수 판정 코어(evaluateProgressLedger·
//   deriveProgressSignals·types·상수)는 공용 중립층 `src/agent-substrate/progress-ledger.ts` 로 승격
//   (DESIGN §16 C3). 여기엔 **미션 결합**만 남는다: exec 저널 read 래퍼(evaluateMissionProgress)와 조율자
//   단일 관측(observeCoordinator/logProgressLedger·`mission.coordinator.*`). 기존 import 처 무접촉(순수 코어 재-export).

import { debug } from '../../debug/log.js';
import { readExecFrames, collectPendingWrites } from './exec-frame-journal.js';
import {
  evaluateProgressLedger,
  deriveProgressSignals,
  type ProgressLedger,
} from '../../agent-substrate/progress-ledger.js';

// 순수 코어 재-export — 이 경로에서 import 하던 곳 무접촉.
export {
  evaluateProgressLedger,
  deriveProgressSignals,
  DEFAULT_MAX_STALLS,
  IN_LOOP_ATTEMPTS,
} from '../../agent-substrate/progress-ledger.js';
export type {
  LedgerRecommendation,
  ProgressLedger,
  ProgressSignals,
  FrameForSignals,
} from '../../agent-substrate/progress-ledger.js';

/** ★ 실 저널 기반 라이브 평가 — exec 프레임에서 신호를 파생해 Progress Ledger 판정. READ-ONLY·fail-soft. */
export function evaluateMissionProgress(missionId: string, opts: { totalPhases?: number; maxStalls?: number } = {}): ProgressLedger {
  const frames = readExecFrames(missionId);
  let orphans = 0;
  try { orphans = collectPendingWrites(missionId).length; } catch { /* fail-soft */ }
  const signals = deriveProgressSignals(frames, {
    ...(opts.totalPhases !== undefined ? { totalPhases: opts.totalPhases } : {}),
    orphanPendingWrites: orphans,
  });
  return evaluateProgressLedger(signals, opts.maxStalls !== undefined ? { maxStalls: opts.maxStalls } : {});
}

/** ★ 조율자 단일 로그(C4 수복) — 산재 카테고리 대신 `mission.coordinator.<event>` 통합. fail-soft.
 *  조회 = `monad logs --category mission.coordinator`. */
export function observeCoordinator(event: string, missionId: string, data: Record<string, unknown> = {}): void {
  try { debug.log('mission.coordinator', event, { missionId, ...data }); } catch { /* fail-soft */ }
}

/** Progress Ledger 판정을 조율자 단일 로그로 방출(⑤⑥ 관측관문). fail-soft. */
export function logProgressLedger(missionId: string, ledger: ProgressLedger): void {
  observeCoordinator('ledger', missionId, {
    recommendation: ledger.recommendation, satisfied: ledger.satisfied,
    progress: ledger.progressBeingMade, inLoop: ledger.inLoop, stall: ledger.stallCount,
    rationale: ledger.rationale,
  });
}
