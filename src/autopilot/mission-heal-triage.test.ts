// 중앙 맥락-인지 heal triage — 넓은 맥락 종합판정 + 신규 heal(fix-declaration·route-hitl) 회귀 가드.
import { describe, it, expect } from 'bun:test';
import {
  healTriagePrompt, parseHealTriage, decideHealTriage, mapContextualHealToDispatch,
  type HealTriageContext,
} from './mission-heal-triage.js';

const ctx = (over: Partial<HealTriageContext> = {}): HealTriageContext => ({
  phaseTitle: '확정된 receiver 함수에 YouTube 흐름을 배선하라',
  phasePrompt: 'src/telegram.ts 의 receiver 에 흡수 흐름을 배선한다.',
  acceptanceCriteria: ['배선 완료', '테스트 통과'],
  missionGoal: 'YouTube URL 인입·요약·저장 구현',
  siblingTitles: ['기존 심볼 조사', '통합 테스트'],
  failureOutput: 'gate-failed: bun test 미통과',
  attemptCount: 2,
  priorHeals: ['rebuild'],
  ...over,
});

describe('healTriagePrompt — 넓은 맥락 주입', () => {
  it('phaseKind(분류 히스토리)·형제·골·실패출력 포함', () => {
    const p = healTriagePrompt(ctx({ phaseKind: 'operational' }));
    expect(p).toContain('분류(LLM): operational');       // ★ 분류 히스토리 활용
    expect(p).toContain('코드게이트 미달을 rebuild 로 무한재시도 말 것'); // operational 가이드
    expect(p).toContain('형제 페이즈');
    expect(p).toContain('fix-declaration');
    expect(p).toContain('route-hitl');
  });
});

describe('parseHealTriage', () => {
  it('유효 heal 파싱', () => {
    expect(parseHealTriage('{"heal":"fix-declaration","reason":"선언 잘림","confidence":"high"}'))
      .toEqual({ heal: 'fix-declaration', reason: '선언 잘림', confidence: 'high' });
  });
  it('무효 heal → null', () => {
    expect(parseHealTriage('{"heal":"garbage"}')).toBeNull();
    expect(parseHealTriage('no json')).toBeNull();
  });
});

describe('decideHealTriage — LLM 종합판정 + 폴백', () => {
  it('선언 모호 → fix-declaration(구현 재시도 아님)', async () => {
    const d = await decideHealTriage(ctx(), async () => '{"heal":"fix-declaration","reason":"목표 문장 잘림","confidence":"high"}', 'rebuild');
    expect(d.heal).toBe('fix-declaration');
  });
  it('승인요청 HITL 페이즈 → route-hitl(코드 무한재시도 아님)', async () => {
    const d = await decideHealTriage(ctx({ phaseTitle: '권고안의 명시적 승인을 요청하라', phaseKind: 'operational' }), async () => '{"heal":"route-hitl","reason":"HITL 필수","confidence":"high"}', 'rebuild');
    expect(d.heal).toBe('route-hitl');
  });
  it('LLM 실패 → 결정론 폴백', async () => {
    const d = await decideHealTriage(ctx(), async () => { throw new Error('llm down'); }, 'rebuild');
    expect(d.heal).toBe('rebuild');
    expect(d.confidence).toBe('low');
  });
  it('무효 응답 → 폴백', async () => {
    const d = await decideHealTriage(ctx(), async () => 'nonsense', 'escalate');
    expect(d.heal).toBe('escalate');
  });
});

describe('mapContextualHealToDispatch — 신규 heal → 기존 집행 매핑(공용화)', () => {
  it('fix-declaration → revise(declarationFix)', () => {
    expect(mapContextualHealToDispatch('fix-declaration')).toEqual({ kind: 'revise', declarationFix: true });
  });
  it('route-hitl → escalate(hitl)', () => {
    expect(mapContextualHealToDispatch('route-hitl')).toEqual({ kind: 'escalate', hitl: true });
  });
  it('기존 heal 은 그대로', () => {
    expect(mapContextualHealToDispatch('split')).toEqual({ kind: 'split' });
    expect(mapContextualHealToDispatch('rebuild')).toEqual({ kind: 'rebuild' });
  });
});
