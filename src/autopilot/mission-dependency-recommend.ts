// 미션 실행 중 의존 미션 추천 — 부분 완주 + 선행 의존 (S2·실행 적응 2026-07-19)
//
// ★ 대표 방침(2026-07-19): 감지 신설 없이 기존 walker 재시도 triage 재사용(S3 동형). escalate(근본
//   불가·전제/선행 부재)·skip(건너뜀·의존 대기)은 "이번 미션에서 다 못 함, 선행이 필요" 신호다.
//   그 페이즈까지 할 수 있는 데까지 하고(부분 완주), 선행 조건을 푸는 의존 미션을 추천한다.
// ★ 자율 vs HITL: 의존 미션 신설(carve)·연결(association)·기존 미션 재개는 개념/범위 변경(영향 큼)
//   이라 HITL. 이 모듈은 "제안 문구 + 트리거 판정"만 순수하게 담고, 실제 carveDiscoveryMission·
//   mission_edges 연결은 기존 인프라(사람 승인)에 위임. 관측 3박자(deviation·exec frame·logs)는 호출측.

import type { RetryPath } from './mission-retry-triage.js';

/** triage 결정 경로 → 의존 미션 추천 트리거 여부. escalate=근본 불가(선행/전제 부재)·skip=건너뜀(의존
 *  대기). 둘 다 부분 완주 + 선행 필요 신호. split(과대·S3 아크수술)·revise(골 정정)와 구분. 순수. */
export function isDependencyRecommendTrigger(path: RetryPath): boolean {
  return path === 'escalate' || path === 'skip';
}

/** 의존 미션 추천 문구(deviation note·HITL 카드·triageNote 공유). 순수·ASCII+한글(truncation 방지). */
export function formatDependencyProposal(phaseTitle: string, rationale: string): string {
  const r = (rationale || '').replace(/\s+/g, ' ').trim().slice(0, 160);
  const t = (phaseTitle || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  return `부분 완주 - 페이즈 "${t}" 는 선행 의존이 강해 이번 미션에서 완결 불가. 근거: ${r || '선행 조건 미충족'}. 의존 미션 신설(carve) 또는 기존 미션 재개를 검토하세요.`;
}
