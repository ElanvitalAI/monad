import { test, expect, describe } from 'bun:test';
import { isArmingBoundaryPhase, buildArmingDecisionCard, presentArmingDecisionCard } from './mission-arming-gate.js';
import { parsePhaseCallbackData } from './mission-notify.js';

describe('mission-arming-gate (Track C) — 실집행 경계 HITL', () => {
  test('isArmingBoundaryPhase — canary/체결/mandate/집행 감지', () => {
    expect(isArmingBoundaryPhase('mandate 제한 안에서 canary 주문을 라우팅하라')).toBe(true);
    expect(isArmingBoundaryPhase('체결과 사후 성과를 재현 가능하게 검증하라')).toBe(true);
    expect(isArmingBoundaryPhase('신호 품질 표준화')).toBe(false);
    expect(isArmingBoundaryPhase('근거 묶음 정규화')).toBe(false);
  });

  test('summary 로도 감지', () => {
    expect(isArmingBoundaryPhase('X 구현', 'routeApprovedCanary 를 실집행 경로에 배선')).toBe(true);
  });

  test('buildArmingDecisionCard — arm/defer/skip 3버튼·실집행 안내', () => {
    const c = buildArmingDecisionCard('task:aa11', 'canary 주문 라우팅');
    expect(c.text).toContain('실집행 경계');
    expect(c.text).toContain('매매=HITL');
    const labels = c.buttons.flat().map((b) => b.text);
    expect(labels.some((l) => l.includes('실집행 승인'))).toBe(true);
    expect(labels.some((l) => l.includes('나중에'))).toBe(true);
    expect(labels.some((l) => l.includes('범위 제외'))).toBe(true);
    // 콜백 데이터가 arm/defer/skip 액션 인코딩
    expect(c.buttons.flat().map((b) => b.data).join(' ')).toMatch(/arm|defer|skip/);
  });

  test('★ 콜백 라운드트립 — 카드 arm/defer 버튼이 parsePhaseCallbackData 로 파싱된다(무반응 버그 방지)', () => {
    const c = buildArmingDecisionCard('task:7859affbf903', 'canary 주문');
    for (const b of c.buttons.flat()) {
      const parsed = parsePhaseCallbackData(b.data);
      expect(parsed).not.toBeNull(); // 파싱 실패 = 무반응(라우팅 안 됨)
      expect(['arm', 'defer', 'skip']).toContain(parsed!.action);
    }
  });

  test('presentArmingDecisionCard — origin 없어도 관측은 남고 발송은 false', () => {
    expect(presentArmingDecisionCard(null, 'apm_x', 'task:aa11', 'canary 주문')).toBe(false);
    // 텔레그램 아닌 origin 도 false
    expect(presentArmingDecisionCard({ channel: 'discord' } as never, 'apm_x', 'task:aa11', 'canary')).toBe(false);
  });
});
