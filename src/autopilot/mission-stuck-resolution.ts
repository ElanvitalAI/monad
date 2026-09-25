// ── 미션 "진전 불가" 자율 종결 결정 (P2·조율자 종점·대표 2026-07-21) ─────────────
//
// 배경(3자 audit): triage 지능(무엇이 문제인가)은 정교하나, 그 판정을 받아 "미션을 여기서
// 자율 종료/부분랜딩"하는 **종단 액션이 배선 안 됨**. escalate/revise/descope/STOP 전부 HITL
// 카드로만 위임 → 미응답 시 finite 미션은 done 도 failed 도 아닌 채 **running 으로 영구 동결**,
// scheduler 미션은 같은 실패를 반복 재시도(예산 소진). 조율자가 "여기까지 하고 종료"를 스스로
// 결론짓는 종점 권한이 전무했다.
//
// 이 모듈 = 그 종점의 **순수 결정 브레인**. run-mission 완료 시점(mp.failed>0 = in-run 셀프힐
// (rebuild/split bound)이 이미 소진됐는데도 실패 잔존)에 호출돼, 무한 running 방치 대신 대응
// 스펙트럼(graceful-land → descope → stop)을 결정한다. 집행(전이·통지)은 호출부. 순수·테스트.
//
// 제1원칙: 사람이 매 교착마다 개입이 아니라 **시스템이 스스로 수렴**. 자율 불가만 STOP+HITL.

/** 대응 액션. continue=아직 종결 안 함(정상 기제 유지·재시도 여지) · graceful-land=핵심 랜딩됐고
 *  잔여 교착 → 부분완료 정직 인정 종결(done) · descope=일부 랜딩·잔여 교착 → 잔여 제외 후 완료(done) ·
 *  stop=자율 진행 불가 → 종결(failed)+사람 판단. */
export type StuckAction = 'continue' | 'graceful-land' | 'descope' | 'stop';

export interface StuckResolutionInput {
  /** done 페이즈 수. */
  doneCount: number;
  /** 터미널 실패(in-run 셀프힐 소진 후에도 실패) 페이즈 수. */
  failedCount: number;
  /** 전체 페이즈 수. */
  totalCount: number;
  /** 미실행(배치 실패로 blocked 등) 페이즈 수. */
  remainingCount: number;
  /** 실패 중 failClass=transient(일시적·재시도 가치 있음) 수 — 전부 일시적이면 종결 보류(재구동 여지). */
  transientFailedCount: number;
  /** 실패 중 heal=escalate(provenance/보안/모순 등 사람 필요) 수 — 있으면 자율 종결 금지·STOP. */
  escalateFailedCount: number;
}

export interface StuckResolution {
  action: StuckAction;
  /** 종결 시 전이할 터미널 상태. continue 면 없음. */
  terminalStatus?: 'done' | 'failed';
  reason: string;
}

/** 핵심 랜딩 판정 비율(done/total) — 이상이면 "핵심은 됐다"로 보고 graceful 하차. */
export const CORE_LANDED_RATIO = 0.6;

/**
 * ★ 진전 불가 자율 종결 결정(순수·결정론). run-mission 이 mp.failed>0 완료 시점에 호출.
 * 호출 시점 자체가 "in-run 셀프힐(rebuild/split bound) 소진 후에도 실패 잔존" = healExhausted 신호.
 *
 * 우선순위:
 *  1) 실패가 전부 일시적(transient) → continue(재구동 여지 — 프리매처 종결 방지).
 *  2) escalate 실패(보안/모순 등 사람 필요) 존재 → stop(failed)+HITL(자율 금지·remaining 무관).
 *  3) ★ 미실행 goal 페이즈 잔존(remainingCount>0) → continue(대표 705308 통찰: 남은 골 프리매처
 *     abandon 방지). done-ratio 로 저가치 prefix 완료를 "핵심 랜딩"으로 오인해 고가치 잔여 골을 버리지
 *     않도록, 아직 시도 안 한 페이즈가 있으면 종결하지 않고 재구동 여지를 준다.
 *  4) 이하 remainingCount===0(모든 페이즈 done/failed·더 시도할 것 없음)에서만 종결 결정:
 *     핵심 랜딩(done/total ≥ CORE_LANDED_RATIO·done≥2) → graceful-land(done) · 일부 랜딩 → descope(done) ·
 *     랜딩 0 → stop(failed).
 */
export function decideStuckResolution(input: StuckResolutionInput): StuckResolution {
  const { doneCount, failedCount, totalCount, remainingCount, transientFailedCount, escalateFailedCount } = input;

  // 안전 — 실패 없으면 종결 결정 대상 아님(호출부 가드 이중).
  if (failedCount <= 0) return { action: 'continue', reason: '터미널 실패 없음 — 종결 대상 아님' };

  // 1) 전부 일시적 실패 → 재구동으로 해소 여지. 프리매처 종결 방지(정상 기제 유지).
  if (transientFailedCount >= failedCount) {
    return { action: 'continue', reason: `실패 ${failedCount}건 전부 일시적(transient) — 재구동 여지, 종결 보류` };
  }

  // 2) 보안/모순 등 사람 필요(escalate) → 자율 종결 금지·STOP+HITL. remaining 무관(보안은 즉시).
  if (escalateFailedCount > 0) {
    return { action: 'stop', terminalStatus: 'failed',
      reason: `escalate 실패 ${escalateFailedCount}건(보안/모순/provenance — 사람 판단 필요) — 자율 종결 금지·STOP+HITL` };
  }

  // 3) ★ 미실행 goal 페이즈 잔존 → 종결 보류(대표 705308 통찰). done 은 저가치 prefix(setup/테스트)이고
  //    진짜 골(digest·delivery)은 아직 backlog 일 수 있다 — done-ratio 만으로 "핵심 랜딩" 오인해 abandon 금지.
  //    아직 시도할 페이즈가 있으면 재구동 여지를 준다(무한 재시도는 상위 recurrence 가드가 후속으로 차단).
  if (remainingCount > 0) {
    return { action: 'continue', reason: `미실행 페이즈 ${remainingCount}건 잔존 — 남은 골 재구동 여지, 종결 보류(프리매처 abandon 방지)` };
  }

  const doneRatio = totalCount > 0 ? doneCount / totalCount : 0;
  const pct = Math.round(doneRatio * 100);

  // 3) 핵심 랜딩 완료 — 대부분 done, 잔여만 교착 → graceful 하차(부분완료 정직 인정).
  if (doneRatio >= CORE_LANDED_RATIO && doneCount >= 2) {
    return { action: 'graceful-land', terminalStatus: 'done',
      reason: `핵심 랜딩 완료(done ${doneCount}/${totalCount}·${pct}%) + 잔여 교착(셀프힐 소진) — graceful 하차(부분완료 정직 인정·done)` };
  }

  // 4) 일부 랜딩 — 잔여 stuck 제외 후 완료. 진짜 남은 골은 새 미션으로 carry.
  if (doneCount >= 1) {
    return { action: 'descope', terminalStatus: 'done',
      reason: `일부 랜딩(done ${doneCount}/${totalCount}·${pct}%) + 잔여 교착 — 잔여 descope 후 완료(done·남은 골 carry)` };
  }

  // 5) 랜딩 0 — 자율 진행 불가 → STOP(사람 판단).
  return { action: 'stop', terminalStatus: 'failed',
    reason: `랜딩 0(done 0/${totalCount}) + 교착(셀프힐 소진) — 자율 진행 불가·STOP(사람 판단 필요)` };
}
