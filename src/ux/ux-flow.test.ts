// P4 Phase 2(2026-07-19) — UXEvent 소비 라우팅 검증(순수·deps 주입).
import { test, expect, describe } from 'bun:test';
import { handleUxEvent, type UxEventConsumerDeps } from './ux-flow.js';

function mkDeps() {
  const calls: unknown[][] = [];
  const deps: UxEventConsumerDeps = {
    approve: (m) => calls.push(['approve', m]),
    reject: (m) => calls.push(['reject', m]),
    action: (m, o) => calls.push(['action', m, o]),
    clarifyAnswer: (m, f, o) => calls.push(['answer', m, f, o]),
    clarifyEdit: (m, f, t) => calls.push(['edit', m, f, t]),
  };
  return { calls, deps };
}

describe('handleUxEvent — flowState 별 라우팅', () => {
  test('approve-plan 버튼 approve → approve', () => {
    const { calls, deps } = mkDeps();
    handleUxEvent({ missionId: 'm', flowState: 'hitl:approve-plan', optionId: 'approve' }, deps);
    expect(calls).toEqual([['approve', 'm']]);
  });

  test('리액션 verdict approve → approve', () => {
    const { calls, deps } = mkDeps();
    handleUxEvent({ missionId: 'm', flowState: 'hitl:approve-plan', verdict: 'approve' }, deps);
    expect(calls).toEqual([['approve', 'm']]);
  });

  test('hold/reject → reject', () => {
    const { calls, deps } = mkDeps();
    handleUxEvent({ missionId: 'm', flowState: 'hitl:approve-plan', optionId: 'hold' }, deps);
    handleUxEvent({ missionId: 'm', flowState: 'hitl:approve-plan', verdict: 'reject' }, deps);
    expect(calls).toEqual([['reject', 'm'], ['reject', 'm']]);
  });

  test('동적 액션(descope) → action', () => {
    const { calls, deps } = mkDeps();
    handleUxEvent({ missionId: 'm', flowState: 'hitl:approve-plan', optionId: 'descope' }, deps);
    expect(calls).toEqual([['action', 'm', 'descope']]);
  });

  test('clarify 옵션 탭 → clarifyAnswer', () => {
    const { calls, deps } = mkDeps();
    handleUxEvent({ missionId: 'm', flowState: 'clarify:scope', optionId: 'followup' }, deps);
    expect(calls).toEqual([['answer', 'm', 'clarify:scope', 'followup']]);
  });

  test('clarify 자유입력(force-reply) → clarifyEdit', () => {
    const { calls, deps } = mkDeps();
    handleUxEvent({ missionId: 'm', flowState: 'clarify:scope', freeformText: '범위 좁혀줘' }, deps);
    expect(calls).toEqual([['edit', 'm', 'clarify:scope', '범위 좁혀줘']]);
  });

  test('clarify freeform 이 optionId 보다 우선', () => {
    const { calls, deps } = mkDeps();
    handleUxEvent({ missionId: 'm', flowState: 'clarify:scope', optionId: 'x', freeformText: '직접수정' }, deps);
    expect(calls).toEqual([['edit', 'm', 'clarify:scope', '직접수정']]);
  });
});
