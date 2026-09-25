// P4 Phase 3(2026-07-19) — UX 피드백 학습(선택 이력→선호) 검증.
import { test, expect, describe } from 'bun:test';
import { learnUxPreference, applyPreferenceToActions } from './ux-learn.js';
import type { UXEvent, UXOption } from './ux-intent.js';

const ev = (flowState: string, o: Partial<UXEvent>): UXEvent => ({ missionId: 'm', flowState, ...o });

describe('learnUxPreference — 선택 이력 집계', () => {
  test('액션 빈도로 순위(자주 선택 앞)', () => {
    const pref = learnUxPreference([
      ev('hitl:approve-plan', { optionId: 'descope' }),
      ev('hitl:approve-plan', { optionId: 'descope' }),
      ev('hitl:approve-plan', { optionId: 'approve' }),
    ]);
    expect(pref.actionRank['hitl:approve-plan']).toEqual(['descope', 'approve']); // descope 2 > approve 1
  });

  test('양식 선호(리액션 vs 버튼 빈도)', () => {
    const pref = learnUxPreference([
      ev('clarify:scope', { verdict: 'approve' }),
      ev('clarify:scope', { verdict: 'reject' }),
      ev('clarify:scope', { optionId: 'x' }),
    ]);
    expect(pref.formPref['clarify:scope']).toBe('reactions'); // 리액션 2 > 버튼 1
  });

  test('빈 이력 → 빈 선호', () => {
    const pref = learnUxPreference([]);
    expect(pref.actionRank).toEqual({});
    expect(pref.formPref).toEqual({});
  });
});

describe('applyPreferenceToActions — 선호 순서 재정렬', () => {
  const opts: UXOption[] = [
    { id: 'approve', label: '승인', value: 'approve' },
    { id: 'hold', label: '보류', value: 'hold' },
    { id: 'descope', label: '제외', value: 'descope' },
  ];

  test('학습된 순위로 재정렬(descope 앞)', () => {
    const pref = { actionRank: { 'hitl:approve-plan': ['descope', 'approve'] }, formPref: {} };
    const out = applyPreferenceToActions(opts, pref, 'hitl:approve-plan');
    expect(out.map((o) => o.id)).toEqual(['descope', 'approve', 'hold']); // descope·approve 앞·미학습 hold 뒤(원순서)
  });

  test('미학습 flowState → 원순서 유지(비파괴)', () => {
    const pref = { actionRank: {}, formPref: {} };
    expect(applyPreferenceToActions(opts, pref, 'unknown').map((o) => o.id)).toEqual(['approve', 'hold', 'descope']);
  });
});
