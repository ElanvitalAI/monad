import { test, expect, describe } from 'bun:test';
import { detectMissionDecisionIntent, routeMissionDecisionUtterance } from './mission-decision-intent.js';

describe('detectMissionDecisionIntent — 결정 NL 라우팅(Layer 3)', () => {
  test('defer — "이 아크 criterion 2는 arming 으로 미뤄"', () => {
    const r = detectMissionDecisionIntent('이 아크 criterion 2는 arming 으로 미뤄');
    expect(r.isIntent).toBe(true);
    expect(r.kind).toBe('defer');
    expect(r.appliesTo).toContain('criterion 2');
  });

  test('re-ground — "A1 기준 완화해서 정의모듈 경계 인정"', () => {
    const r = detectMissionDecisionIntent('A1 기준 완화해서 정의모듈 경계 인정');
    expect(r.isIntent).toBe(true);
    expect(r.kind).toBe('re-ground');
    expect(r.appliesTo).toContain('A1');
  });

  test('check-pass — "이 미션 감사는 통과로 확인했으니 넘어가"', () => {
    const r = detectMissionDecisionIntent('이 미션 감사는 통과로 확인했으니 넘어가');
    expect(r.isIntent).toBe(true);
    expect(r.kind).toBe('check-pass');
  });

  test('boundary — "완주 경계는 A2 까지만"', () => {
    const r = detectMissionDecisionIntent('이 미션 완주 경계는 A2 까지만');
    expect(r.isIntent).toBe(true);
    expect(r.kind).toBe('boundary');
    expect(r.appliesTo).toContain('A2');
  });

  test('explicitId 추출', () => {
    const r = detectMissionDecisionIntent('apm_foo_123 이 아크는 arming 으로 미뤄');
    expect(r.explicitId).toBe('apm_foo_123');
  });

  test('질문은 미감지(하이재킹 방지)', () => {
    expect(detectMissionDecisionIntent('이 미션 arming 으로 미루는 거 어떻게 해?').isIntent).toBe(false);
    expect(detectMissionDecisionIntent('이 아크 경계가 뭐야?').isIntent).toBe(false);
  });

  test('대상 언급 없으면 미감지', () => {
    expect(detectMissionDecisionIntent('그건 나중에 미뤄').isIntent).toBe(false);
  });

  test('결정 동사 없으면 미감지(순수 revise 는 기존 라우터)', () => {
    expect(detectMissionDecisionIntent('이 미션 개정해줘').isIntent).toBe(false);
    expect(detectMissionDecisionIntent('이 미션 재분해해').isIntent).toBe(false);
  });

  test('슬래시/장문/빈문자열 방어', () => {
    expect(detectMissionDecisionIntent('/monad-decision').isIntent).toBe(false);
    expect(detectMissionDecisionIntent('').isIntent).toBe(false);
    expect(detectMissionDecisionIntent('미션 ' + 'x'.repeat(500)).isIntent).toBe(false);
  });
});

describe('routeMissionDecisionUtterance — 서피스 무관 라우팅', () => {
  const record = (recs: Array<[string, string]>) => (missionId: string, d: { kind: string; note: string }) => {
    const line = `[${d.kind}] ${d.note}`; recs.push([missionId, line]); return line;
  };

  test('활성 1건 → 기록', () => {
    const recs: Array<[string, string]> = [];
    const r = routeMissionDecisionUtterance(
      { text: '이 아크 criterion 2는 arming 으로 미뤄', chatId: 1 },
      { resolve: () => ({ missionId: 'apm_a', candidates: [{ id: 'apm_a' }] }), record: record(recs) },
    );
    expect(r.handled).toBe(true);
    expect(r.missionId).toBe('apm_a');
    expect(recs[0]![1]).toContain('[defer]');
  });

  test('명시 id 최우선', () => {
    const recs: Array<[string, string]> = [];
    const r = routeMissionDecisionUtterance(
      { text: 'apm_xyz 이 아크는 arming 으로 미뤄', chatId: 1 },
      { resolve: () => ({ missionId: 'apm_other', candidates: [{ id: 'apm_other' }] }), record: record(recs) },
    );
    expect(r.missionId).toBe('apm_xyz');
  });

  test('맥락-인지 — 최근 미션 우선', () => {
    const recs: Array<[string, string]> = [];
    const r = routeMissionDecisionUtterance(
      { text: '이 미션 경계는 A2 까지만', chatId: 1 },
      { resolve: () => ({ missionId: 'apm_1', candidates: [{ id: 'apm_1' }, { id: 'apm_2' }] }), record: record(recs), recentMission: () => 'apm_2' },
    );
    expect(r.missionId).toBe('apm_2');
  });

  test('모호(2건+·맥락 없음) → 폴백(하이재킹 안 함)', () => {
    const r = routeMissionDecisionUtterance(
      { text: '이 미션 경계는 여기까지', chatId: 1 },
      { resolve: () => ({ missionId: null, candidates: [{ id: 'apm_1' }, { id: 'apm_2' }] }), record: () => 'x' },
    );
    expect(r.handled).toBe(false);
    expect(r.reason).toBe('ambiguous');
  });

  test('의도 없으면 폴백', () => {
    const r = routeMissionDecisionUtterance(
      { text: '오늘 날씨 어때', chatId: 1 },
      { resolve: () => ({ missionId: 'apm_a', candidates: [{ id: 'apm_a' }] }), record: () => 'x' },
    );
    expect(r.handled).toBe(false);
  });
});
