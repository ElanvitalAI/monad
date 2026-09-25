// ── UX 피드백 학습 — 선택 이력 → 선호 (P4 Phase 3·2026-07-19) ──────────────────
// RFC-ux-agent-flow-coordinator §6. 대표 지시: 사용자 피드백 기반 "변화무쌍한 대응". 사용자가 어떤
// 액션·양식을 자주 고르는지 학습해, 다음 UI 를 그 선호에 맞춘다(자주 쓰는 액션을 앞으로·선호 양식 우선).
// 순수 함수(이벤트 이력 in → 선호 out). 이력 소스(logs.db ux.flow event 조회) 연동은 배선측이 주입.

import type { UXEvent, UXOption } from './ux-intent.js';

export interface UxPreference {
  /** flowState → 자주 선택된 액션 id 순서(내림차순 빈도). */
  readonly actionRank: Record<string, string[]>;
  /** flowState → 선호 양식(리액션 vs 버튼 선택 빈도 비교). */
  readonly formPref: Record<string, 'reactions' | 'buttons'>;
}

/**
 * 선택 이력(UXEvent[]) → 선호 집계. optionId 빈도로 액션 순위, verdict(리액션)/optionId(버튼) 빈도로
 * 양식 선호를 flowState 별로 학습. 순수·결정론(동률은 등장 순 안정).
 */
export function learnUxPreference(events: readonly UXEvent[]): UxPreference {
  const actionCount: Record<string, Record<string, number>> = {};
  const formCount: Record<string, { reactions: number; buttons: number }> = {};
  for (const e of events) {
    const fs = e.flowState;
    if (e.optionId) {
      const c = (actionCount[fs] ??= {});
      c[e.optionId] = (c[e.optionId] ?? 0) + 1;
    }
    const fc = (formCount[fs] ??= { reactions: 0, buttons: 0 });
    if (e.verdict) fc.reactions++;
    else if (e.optionId) fc.buttons++;
  }
  const actionRank: Record<string, string[]> = {};
  for (const [fs, counts] of Object.entries(actionCount)) {
    actionRank[fs] = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([id]) => id);
  }
  const formPref: Record<string, 'reactions' | 'buttons'> = {};
  for (const [fs, fc] of Object.entries(formCount)) {
    formPref[fs] = fc.reactions > fc.buttons ? 'reactions' : 'buttons';
  }
  return { actionRank, formPref };
}

/**
 * 학습된 선호 순서로 액션 재정렬 — 자주 선택된 액션을 앞으로(사용자 습관 반영). 미학습 flowState 는
 * 원순서 유지(비파괴). recommended 플래그는 보존. 순수·안정 정렬.
 */
export function applyPreferenceToActions(
  options: readonly UXOption[], pref: UxPreference, flowState: string,
): UXOption[] {
  const rank = pref.actionRank[flowState];
  if (!rank || rank.length === 0) return [...options];
  const idx = (id: string) => { const i = rank.indexOf(id); return i < 0 ? rank.length : i; };
  // 안정 정렬(동일 순위는 원순서) — 원 인덱스를 tiebreak 로.
  return options
    .map((o, i) => ({ o, i }))
    .sort((a, b) => (idx(a.o.id) - idx(b.o.id)) || (a.i - b.i))
    .map(({ o }) => o);
}
