// ── UX 동적 빌더 — 신호 기반 Question/버튼 생성 (P4 Phase 1·2026-07-19) ──────────
// RFC-run-supervisor-single-control-point-2026-08-01 §4 {#uxintent-contract} + 대표 지시(2026-07-19): 고정 배열 대신
// context(signals·decisions) 기반으로 액션/질문을 **동적 생성**해 다이나믹한 상황·사용자 피드백에
// 변화무쌍하게 대응한다. FLOW(조율자)가 signals 를 채우면 UX 에이전트가 상황에 맞는 UI 를 조립.
//
// 경계(대표 확정): 조율자는 signals/decisions 만 채우고, 양식(어떤 버튼·순서·활성화)은 여기(UX
// 에이전트)가 결정한다. 순수 함수(context in → UXOption/UXIntent out)·집행 0·비파괴(기존 하드코딩 병존).

import type { UXOption, UXIntent, UXIntentContext, UXSurfaceAddr } from './ux-intent.js';

/** signals 에서 숫자 신호 안전 추출(미상=0). */
function numSignal(context: UXIntentContext, key: string): number {
  const v = context.signals?.[key];
  return typeof v === 'number' ? v : 0;
}
/** signals 에서 boolean 신호 안전 추출. */
function boolSignal(context: UXIntentContext, key: string): boolean {
  return context.signals?.[key] === true;
}
/** signals 에서 문자열 신호 안전 추출(미상=undefined). ★ 조율자 종합(recommendedAction 등) 전달용. */
function strSignal(context: UXIntentContext, key: string): string | undefined {
  const v = context.signals?.[key];
  return typeof v === 'string' ? v : undefined;
}

/**
 * ★ 신호 기반 동적 HITL 액션 빌더 — 고정 6버튼(mission-notify.buildHitlButtonRows) 대신 context 로
 * 옵션을 선택·순서·활성화한다. 상황별 적응:
 *  - 치명 0 → 승인 recommended(바로 진행) / 치명 > 0 → 승인 비추천(검토 유도)
 *  - 실패 반복(failureCount > 2) → "골 정정" 을 앞으로·recommended (헛도는 루프 탈출)
 *  - 치명 다수(criticalCount > 3) → "Opus 재분해" 활성화 (sol 한계 극복)
 *  - 범위 초과(scopeExceeded) → "벗어난 기능 제외" 추가 (발산 방지)
 * 순수·결정론. 표준 조정 액션(간소화·재사용·직접입력)은 항상 뒤에 붙는다.
 */
export function buildContextualActions(context: UXIntentContext): UXOption[] {
  const critical = numSignal(context, 'criticalCount');
  const failures = numSignal(context, 'failureCount');
  const scopeExceeded = boolSignal(context, 'scopeExceeded');
  // ★ CC2(RFC §3d) — 실행 적응 시나리오 신호(조율자가 실패/발산 시 채움).
  const arcSurgery = boolSignal(context, 'arcSurgery');
  const blockedDependency = boolSignal(context, 'blockedDependency');
  const phaseFailed = boolSignal(context, 'phaseFailed');
  const redesign = boolSignal(context, 'redesign'); // ★ CC2b — 골분해 역제안(골 리디자인) 신호
  const deadlock = boolSignal(context, 'deadlock'); // ★ S7 — 교착(ledger stall/inLoop)
  const stuckResolution = strSignal(context, 'stuckResolution'); // ★ P3 — 자율 종결 결과(graceful-land|descope|stop)
  // ★ 조율자 종합 추천(대표 2026-07-20) — synthesis(FLOW)가 recommendedAction 을 signals 로 주문 → 여기서
  //   주 버튼을 강조·합성. proceed=승인 추천 · redecompose=재분해 버튼 추가·추천 · redesign=역제안 수용 추천.
  //   종전 승인 추천이 critical===0 만 봤고 재분해 버튼은 buildHitlButtonRows(별개)라 카드에 없어 actionHint
  //   ("재분해 추천")와 버튼이 불일치했다(대표 지적). recommendedAction 으로 일치·⭐강조.
  const recAction = strSignal(context, 'recommendedAction'); // 'proceed'|'redecompose'|'redesign'|undefined

  const opts: UXOption[] = [];
  // 항상: 승인 + 보류. 추천은 조율자 종합(recAction)이 있으면 그걸로, 없으면 치명 유무 폴백.
  const proceedRec = recAction ? recAction === 'proceed' : critical === 0;
  opts.push({ id: 'approve', label: recAction === 'proceed' ? '✅ 승인·착수 ⭐추천' : '✅ 승인(실행 시작)', value: 'approve', kind: 'approve', recommended: proceedRec });
  opts.push({ id: 'hold', label: '⏸️ 보류', value: 'hold', kind: 'choice' });
  // ★ 재분해 추천(recommendedAction=redecompose) — actionHint 와 일치(종전 재분해 버튼 부재로 불일치했다).
  if (recAction === 'redecompose') opts.push({ id: 'redecompose', label: '🔁 좁혀 재분해 ⭐추천', value: 'redecompose', kind: 'choice', recommended: true });
  // ★ CC2b(대표 2026-07-20) — 골분해 역제안 → 원탭 재구성 버튼. recAction 있으면 redesign 일 때만 추천(하위호환:
  //   recAction 미상이면 기존대로 recommended·역제안이 유일 신호일 때 원탭 유도).
  if (redesign) opts.push({ id: 'accept-redesign', label: recAction === 'redesign' ? '🔀 역제안 수용·재구성 ⭐추천' : '🔀 역제안 수용(재구성)', value: 'accept-redesign', kind: 'choice', recommended: recAction ? recAction === 'redesign' : true });
  // ★ P3(대표 2026-07-21) — 조율자 자율 종결(P2) 후 카드. 종결 결과별 사후 선택지(기존 wired 핸들러 매핑):
  //   graceful-land/descope=부분완료 정직 종결 → 수용 추천·재분해로 이어가기 선택 · stop=자율 불가 →
  //   재분해 재시도 추천·수용 선택. deadlock(재분해만)과 달리 "종결됨"을 명시하고 재개/수용 2방향 제시.
  if (stuckResolution) {
    const isStop = stuckResolution === 'stop';
    opts.push({ id: 'acknowledge', label: '✅ 종결 수용(확인)', value: 'acknowledge', kind: 'choice', recommended: !isStop });
    opts.push({ id: 'redecompose', label: isStop ? '🔁 재분해로 재시도 ⭐추천' : '🔁 재분해로 이어가기', value: 'redecompose', kind: 'choice', recommended: isStop });
  } else
  // ★ S7(대표 2026-07-20) — 교착(진전없음·stall/inLoop) → 아크 재분해·접근전환 원탭.
  if (deadlock) opts.push({ id: 'redecompose-arc', label: '🔄 아크 재분해(교착 탈출)', value: 'redecompose-arc', kind: 'choice', recommended: true });
  // ★ CC2(RFC §3d) — 실행 적응 시나리오 재구성 선택지(파편 각인 넘어 UX flow 로 종합 제시).
  if (arcSurgery) opts.push({ id: 'arc-surgery', label: '🔪 아크 분할(S3·in-flight 수술)', value: 'arc-surgery', kind: 'choice', recommended: true });
  if (blockedDependency) opts.push({ id: 'dep-mission', label: '🧩 의존 미션 신설/재개(S2)', value: 'dep-mission', kind: 'choice', recommended: true });
  // ★ rebuild 힐 추천(recommendedAction=apply-heal·대표 2026-07-21) — 자율 rebuild 불가(armed off·재힐) 시
  //   CC2c 가 rebuild 를 blockedDependency(의존미션) 오분류하던 것을 apply-heal 추천으로 교정 → ⭐추천 버튼.
  if (phaseFailed && !arcSurgery && !blockedDependency) opts.push({ id: 'apply-heal', label: recAction === 'apply-heal' ? '🔧 진단 힐 적용(재시도) ⭐추천' : '🔧 진단 힐 적용(재시도)', value: 'apply-heal', kind: 'choice', recommended: recAction === 'apply-heal' });
  // 반복 실패 → 골 정정 우선노출(recommended·앞쪽).
  if (failures > 2) {
    opts.push({ id: 'revise-goal', label: '✏️ 골 정정(반복 실패 탈출)', value: 'revise-goal', kind: 'edit', recommended: true });
  }
  // 치명 다수 → Opus 재분해 활성화.
  if (critical > 3) {
    opts.push({ id: 'redecompose-opus', label: '🧠 Opus 재분해(치명 다수)', value: 'redecompose-opus', kind: 'choice' });
  }
  // 범위 초과 → 벗어난 기능 제외(발산 방지).
  if (scopeExceeded) {
    opts.push({ id: 'descope', label: '✂️ 벗어난 기능 제외', value: 'descope', kind: 'choice' });
  }
  // ★ 조정 액션 다이어트(대표 2026-07-20·"버튼 너무 많다·2방향") — 종전 간소화·재사용·직접입력을 항상
  //   노출(승인·보류 포함 5버튼)했다. 간소화·재사용은 정정(직접입력)으로 흡수하고, 범위 축소는 위
  //   descope(scopeExceeded)가 커버. 직접입력(정정)만 항상(2방향 대안·"정정"=직접입력 의미 명확).
  //   결과: 깨끗한 분해는 [추천 액션]+[보류]+[정정] 3버튼. 상황 신호(scope·실행시나리오)만 추가 노출.
  opts.push({ id: 'edit', label: '✏️ 직접입력(정정)', value: 'edit', kind: 'edit' });
  return opts;
}

/**
 * ★ 신호 기반 동적 질문 빌더 — 표준 clarify(IntakeClarification) 위에, context 신호가 촉발하는 추가
 * 확인 질문을 UXIntent 로 생성한다. 예:
 *  - 범위 초과(scopeExceeded) → "벗어난 기능을 이번에 포함할까요, 후속으로 뺄까요?"
 *  - 모호도 높음(ambiguityHigh) → "핵심 목표를 한 가지로 좁혀주세요"
 * 촉발 신호가 없으면 빈 배열(추가 질문 없음). 순수·결정론.
 */
export function buildContextualQuestions(
  missionId: string,
  context: UXIntentContext,
  opts: { editMarker: string; surface?: UXSurfaceAddr } = { editMarker: 'ux:edit' },
): UXIntent[] {
  const out: UXIntent[] = [];
  const mk = (
    flowState: string, prompt: string, options: UXOption[], urgency: UXIntentContext['urgency'],
  ): UXIntent => ({
    missionId, flowState, prompt, options,
    freeform: { marker: opts.editMarker, hint: '바꿀 점을 답장으로 알려주세요' },
    context: { ...context, urgency },
    ...(opts.surface ? { surface: opts.surface } : {}),
  });

  if (boolSignal(context, 'scopeExceeded')) {
    out.push(mk('clarify:scope', '범위를 벗어난 기능이 감지됐습니다. 어떻게 할까요?', [
      { id: 'include', label: '이번에 포함', value: 'include', kind: 'choice' },
      { id: 'followup', label: '후속 미션으로 분리', value: 'followup', kind: 'choice', recommended: true },
    ], 'high'));
  }
  if (boolSignal(context, 'ambiguityHigh')) {
    out.push(mk('clarify:focus', '목표가 다소 넓습니다. 핵심을 한 가지로 좁혀주세요.', [
      { id: 'keep', label: '현재 범위 유지', value: 'keep', kind: 'choice' },
      { id: 'narrow', label: '직접 좁히기(답장)', value: 'narrow', kind: 'edit', recommended: true },
    ], 'normal'));
  }
  return out;
}
