// 조율자 격상 P4 — GoalBlocker 유형화(셀프힐 라우팅) 검증.
import { test, expect, describe } from 'bun:test';
import { classifyGoalBlocker, goalBlockerToHealRecommend } from './goal-blocker.js';

describe('goal-blocker — GoalBlocker 유형화(P4)', () => {
  test('사용자 입력 필요 → needs_user_input·hitl(자동 불가)', () => {
    const v = classifyGoalBlocker('범위가 모호해 사용자 확정이 필요합니다');
    expect(v.kind).toBe('needs_user_input');
    expect(v.route).toBe('hitl');
    expect(v.autoHealable).toBe(false);
  });

  test('근거 부재 → missing_evidence·re-research(자동)', () => {
    const v = classifyGoalBlocker('전제 파일을 못 찾았고 근거가 부족합니다');
    expect(v.kind).toBe('missing_evidence');
    expect(v.route).toBe('re-research');
    expect(v.autoHealable).toBe(true);
  });

  test('일시/예산 실패 → run_failed·retry(자동)', () => {
    const v = classifyGoalBlocker('예산 소진으로 timeout 되었습니다');
    expect(v.kind).toBe('run_failed');
    expect(v.route).toBe('retry');
    expect(v.autoHealable).toBe(true);
  });

  test('유형 불명 → unknown·escalate(보수적 HITL)', () => {
    const v = classifyGoalBlocker('알 수 없는 이유로 종료');
    expect(v.kind).toBe('unknown');
    expect(v.route).toBe('escalate');
    expect(v.autoHealable).toBe(false);
  });

  test('우선순위 — 사용자입력 신호가 근거부재보다 우선', () => {
    const v = classifyGoalBlocker('근거가 부족해서 사용자 확정이 필요합니다');
    expect(v.kind).toBe('needs_user_input');
  });

  test('자동힐 → harmless·멱등·grounded(decideAutonomousAct 자율 후보)', () => {
    const r = goalBlockerToHealRecommend(classifyGoalBlocker('전제 부재'));
    expect(r.actClass).toBe('harmless');
    expect(r.idempotent).toBe(true);
    expect(r.grounded).toBe(true);
  });

  test('needs_user_input → sensitive(HITL 강제)·unknown → unclassified(기본거부)', () => {
    expect(goalBlockerToHealRecommend(classifyGoalBlocker('사용자 확정 필요')).actClass).toBe('sensitive');
    expect(goalBlockerToHealRecommend(classifyGoalBlocker('알 수 없는 종료')).actClass).toBe('unclassified');
  });
});
