// 조율자 매스텝(UR1) — 중앙 State → {ledger, updates, observations} 순수 스텝 검증 (2026-07-19)
import { test, expect, describe } from 'bun:test';
import { coordinatorStep } from './coordinator-step.js';
import { foldMissionState, type StatePhase } from './mission-state-assemble.js';

const phase = (id: string, status: string): StatePhase => ({ id, title: `p-${id}`, status, kind: 'subagent', dependsOn: [] });
const frame = (phaseId: string, op: string, status: string) => ({ phaseId, op, status });

describe('coordinatorStep — 중앙 State 매스텝 판정(순수)', () => {
  test('전 페이즈 done → satisfied/done 권장', () => {
    const state = foldMissionState({
      phases: [phase('a', 'done'), phase('b', 'done')],
      frames: [frame('a', 'phase-start', 'running'), frame('a', 'phase-done', 'done'), frame('b', 'phase-start', 'running'), frame('b', 'phase-done', 'done')],
    });
    const out = coordinatorStep({ state, totalPhases: 2 });
    expect(out.ledger.satisfied).toBe(true);
    expect(out.ledger.recommendation).toBe('done');
  });

  test('진행 중(1/2 done) → continue', () => {
    const state = foldMissionState({
      phases: [phase('a', 'done'), phase('b', 'ready')],
      frames: [frame('a', 'phase-start', 'running'), frame('a', 'phase-done', 'done'), frame('b', 'phase-start', 'running')],
    });
    const out = coordinatorStep({ state, totalPhases: 2 });
    expect(out.ledger.satisfied).toBe(false);
    expect(out.ledger.recommendation).toBe('continue');
  });

  test('updates 는 progress 채널 갱신을 준다(State fold 대상)', () => {
    const state = foldMissionState({ phases: [phase('a', 'ready')], frames: [] });
    const out = coordinatorStep({ state, totalPhases: 1 });
    expect(out.updates).toHaveLength(1);
    expect(out.updates[0]!.channel).toBe('progress');
    expect(out.updates[0]!.value).toBe(out.ledger);
  });

  test('★ 관측 산출(제1원칙) — step 이벤트에 State 스냅샷 지표 + 판정', () => {
    const state = foldMissionState({
      phases: [phase('a', 'done'), phase('b', 'failed')],
      frames: [frame('a', 'phase-done', 'done'), frame('b', 'phase-done', 'failed')],
    });
    const out = coordinatorStep({ state, totalPhases: 2 });
    expect(out.observations).toHaveLength(1);
    const obs = out.observations[0]!;
    expect(obs.event).toBe('step');
    expect(obs.data.phaseCount).toBe(2);
    expect(obs.data.failureCount).toBe(1);      // failed 페이즈 파생
    expect(obs.data.frameCount).toBe(2);
    expect(obs.data.recommendation).toBe(out.ledger.recommendation);
  });

  test('빈 State → 안전(회귀0·continue/미satisfied)', () => {
    const out = coordinatorStep({ state: foldMissionState({ phases: [], frames: [] }) });
    expect(out.ledger.satisfied).toBe(false);
    expect(out.observations[0]!.data.phaseCount).toBe(0);
  });

  test('★ R1 — review-gate 프레임에서 리뷰 신호 관측(reviewFailures/reworkStalled)', () => {
    const state = foldMissionState({
      phases: [phase('a', 'done')],
      frames: [frame('a', 'phase-done', 'done'), frame('a', 'review-gate', 'blocked'), frame('a', 'review-gate', 'blocked')],
    });
    const out = coordinatorStep({ state, totalPhases: 1 });
    expect(out.observations[0]!.data.reviewFailures).toBe(2);
    expect(out.observations[0]!.data.reviewReworkStalled).toBe(true);
    // review-gate 는 ledger 를 오염시키지 않는다(done/failed 만 파생) — 페이즈는 여전히 done.
    expect(out.ledger.satisfied).toBe(true);
  });

  test('★ R1 — 리뷰 fail 없으면 review 지표 미포함(회귀0·노이즈 방지)', () => {
    const state = foldMissionState({ phases: [phase('a', 'done')], frames: [frame('a', 'phase-done', 'done')] });
    const out = coordinatorStep({ state, totalPhases: 1 });
    expect(out.observations[0]!.data.reviewFailures).toBeUndefined();
  });
});
