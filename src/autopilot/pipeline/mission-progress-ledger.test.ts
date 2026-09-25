// 조율자 격상 P2 — Progress Ledger 판정(satisfied/progress/in_loop→stall→replan) 검증.
import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setFrameDir } from './frame-journal.js';
import { recordExecPhase } from './exec-frame-journal.js';
import { evaluateProgressLedger, evaluateMissionProgress, type ProgressSignals } from './mission-progress-ledger.js';

const base: ProgressSignals = { totalPhases: 3, donePhases: 0, failedPhases: 0, consecutiveFailures: 0, maxPhaseAttempts: 1, orphanPendingWrites: 0 };

describe('mission-progress-ledger — 순수 판정(P2)', () => {
  test('satisfied — 전 페이즈 done·실패 0 → done', () => {
    const l = evaluateProgressLedger({ ...base, donePhases: 3 });
    expect(l.satisfied).toBe(true);
    expect(l.recommendation).toBe('done');
  });

  test('진행 중 — 일부 done·실패 없음 → continue', () => {
    const l = evaluateProgressLedger({ ...base, donePhases: 1 });
    expect(l.satisfied).toBe(false);
    expect(l.progressBeingMade).toBe(true);
    expect(l.recommendation).toBe('continue');
  });

  test('in_loop — 한 페이즈 재시도 3회 → stall → replan', () => {
    const l = evaluateProgressLedger({ ...base, donePhases: 1, maxPhaseAttempts: 3 });
    expect(l.inLoop).toBe(true);
    expect(l.stalled).toBe(true);
    expect(l.recommendation).toBe('replan');
  });

  test('연속 실패 3 → escalate(HITL)', () => {
    const l = evaluateProgressLedger({ ...base, failedPhases: 1, consecutiveFailures: 3 });
    expect(l.recommendation).toBe('escalate');
  });

  test('진전 없음(연속실패 2)·stall 임계 → replan', () => {
    const l = evaluateProgressLedger({ ...base, failedPhases: 1, consecutiveFailures: 2 });
    expect(l.progressBeingMade).toBe(false);
    expect(l.recommendation).toBe('replan');
  });
});

describe('mission-progress-ledger — 저널 기반 라이브 평가', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ledger-')); setFrameDir(dir); });
  afterEach(() => { setFrameDir(null); try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } });

  test('전 페이즈 done → satisfied', () => {
    recordExecPhase('m1', { phaseId: 'p1', phaseTitle: 'A', op: 'phase-start', status: 'running' });
    recordExecPhase('m1', { phaseId: 'p1', phaseTitle: 'A', op: 'phase-done', status: 'done' });
    recordExecPhase('m1', { phaseId: 'p2', phaseTitle: 'B', op: 'phase-start', status: 'running' });
    recordExecPhase('m1', { phaseId: 'p2', phaseTitle: 'B', op: 'phase-done', status: 'done' });
    const l = evaluateMissionProgress('m1');
    expect(l.satisfied).toBe(true);
    expect(l.recommendation).toBe('done');
  });

  test('페이즈 재시도 3회(phase-start 3번) → in_loop', () => {
    for (let i = 0; i < 3; i++) recordExecPhase('m2', { phaseId: 'p', phaseTitle: 'X', op: 'phase-start', status: 'running' });
    recordExecPhase('m2', { phaseId: 'p', phaseTitle: 'X', op: 'phase-done', status: 'failed' });
    const l = evaluateMissionProgress('m2', { totalPhases: 1 });
    expect(l.inLoop).toBe(true);
    expect(['replan', 'escalate']).toContain(l.recommendation);
  });

  test('빈 미션 → satisfied=false·continue(totalPhases 0)', () => {
    const l = evaluateMissionProgress('none');
    expect(l.satisfied).toBe(false);
  });

  test('★ 1 done + 2 started(미종결) → satisfied=false(조기 satisfied 오판 방지·2026-07-19 dogfood)', () => {
    recordExecPhase('m3', { phaseId: 'p1', phaseTitle: 'A', op: 'phase-start', status: 'running' });
    recordExecPhase('m3', { phaseId: 'p1', phaseTitle: 'A', op: 'phase-done', status: 'done' });
    recordExecPhase('m3', { phaseId: 'p2', phaseTitle: 'B', op: 'phase-start', status: 'running' }); // 시작만·미종결
    const l = evaluateMissionProgress('m3'); // totalPhases 미지정 → started 포함 기본값(2)
    expect(l.satisfied).toBe(false); // 종전엔 phaseIds=1(terminal만)이라 1/1 satisfied 오판
    expect(l.recommendation).toBe('continue');
  });

  test('명시 totalPhases(스토어 실 총계) 존중 — 1/3 은 미완', () => {
    recordExecPhase('m4', { phaseId: 'p1', phaseTitle: 'A', op: 'phase-start', status: 'running' });
    recordExecPhase('m4', { phaseId: 'p1', phaseTitle: 'A', op: 'phase-done', status: 'done' });
    const l = evaluateMissionProgress('m4', { totalPhases: 3 });
    expect(l.satisfied).toBe(false); // 1/3
  });
});
