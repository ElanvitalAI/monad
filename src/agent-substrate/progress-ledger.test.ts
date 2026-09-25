// 공용 Progress Ledger(C3 승격) — 순수 판정 코어(신호→Ledger·프레임→신호) 검증.
import { test, expect, describe } from 'bun:test';
import {
  evaluateProgressLedger,
  deriveProgressSignals,
  DEFAULT_MAX_STALLS,
  type ProgressSignals,
  type FrameForSignals,
} from './progress-ledger.js';

const sig = (o: Partial<ProgressSignals> = {}): ProgressSignals => ({
  totalPhases: 3, donePhases: 0, failedPhases: 0, consecutiveFailures: 0, maxPhaseAttempts: 1, orphanPendingWrites: 0, ...o,
});

describe('progress-ledger — evaluateProgressLedger(순수 판정)', () => {
  test('전 페이즈 완료·실패0 → done', () => {
    expect(evaluateProgressLedger(sig({ totalPhases: 3, donePhases: 3 })).recommendation).toBe('done');
  });
  test('진행 중 → continue', () => {
    expect(evaluateProgressLedger(sig({ donePhases: 1 })).recommendation).toBe('continue');
  });
  test('연속 실패 3 → escalate(HITL)', () => {
    expect(evaluateProgressLedger(sig({ consecutiveFailures: 3 })).recommendation).toBe('escalate');
  });
  test('페이즈 뱅뱅(재시도 초과) → replan(stall≥maxStalls)', () => {
    const l = evaluateProgressLedger(sig({ maxPhaseAttempts: 3 }));  // inLoop·loopStalls=2
    expect(l.inLoop).toBe(true);
    expect(l.recommendation).toBe('replan');
    expect(l.stallCount).toBeGreaterThanOrEqual(DEFAULT_MAX_STALLS);
  });
});

describe('progress-ledger — deriveProgressSignals(순수 파생)', () => {
  test('프레임 → 신호(done/attempts/연속실패)', () => {
    const frames: FrameForSignals[] = [
      { phaseId: 'p1', op: 'phase-start' },
      { phaseId: 'p1', op: 'phase-done', status: 'done' },
      { phaseId: 'p2', op: 'phase-start' },
      { phaseId: 'p2', op: 'phase-start' },  // 재시도
      { phaseId: 'p2', op: 'phase-done', status: 'failed' },
    ];
    const s = deriveProgressSignals(frames, { totalPhases: 2 });
    expect(s.donePhases).toBe(1);
    expect(s.failedPhases).toBe(1);
    expect(s.maxPhaseAttempts).toBe(2);
    expect(s.consecutiveFailures).toBe(1);
  });
  test('빈 프레임 → 0 신호', () => {
    const s = deriveProgressSignals([]);
    expect(s.donePhases).toBe(0);
    expect(s.totalPhases).toBe(0);
  });
});
