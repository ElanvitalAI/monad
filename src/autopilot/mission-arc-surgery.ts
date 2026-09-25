// 미션 실행 중 아크 수술(in-flight) — 과대 판정 → 분할 제안 (S3·실행 적응 2026-07-19)
//
// ★ 대표 방침(2026-07-19): 플랜-타임은 과대를 막지 말고 메모(비평 완화·#4593), 실행 중 실제 과대가
//   판명되면 그때 대응. 감지는 신설하지 않고 기존 walker 재시도 triage 의 'split' 결정을 재사용한다
//   (검증된 신호·새 LLM 없음). split = 범위 과대(분할 대상) → in-flight 아크 수술 제안.
// ★ 자율 vs HITL: 페이즈 분할은 범위/구조 변경(영향 큼)이라 HITL(기존 split→중단 카드 흐름 유지).
//   이 모듈은 "제안 문구 + 트리거 판정"만 순수하게 담고, 실제 수술(inject --arc·페이즈 분할)은
//   기존 편집 인프라(사람 승인)에 위임한다. 관측 3박자(deviation·exec frame·logs)는 호출측이 각인.

import type { RetryPath } from './mission-retry-triage.js';

/** triage 결정 경로 → in-flight 아크 수술(분할) 제안 트리거 여부. split=범위 과대(분할 대상). 순수.
 *  revise/skip/escalate 는 아크 수술이 아닌 다른 대응(골 정정·건너뜀·에스컬)이라 제외. */
export function isArcSurgeryTrigger(path: RetryPath): boolean {
  return path === 'split';
}

/** 아크 수술 제안 문구(deviation note·HITL 카드·triageNote 공유). 순수·ASCII+한글(truncation 방지). */
export function formatArcSurgeryProposal(phaseTitle: string, rationale: string): string {
  const r = (rationale || '').replace(/\s+/g, ' ').trim().slice(0, 160);
  const t = (phaseTitle || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  return `과대 판정 - 페이즈 "${t}" 분할 권장(in-flight 아크 수술). 근거: ${r || '범위 과대'}. inject --arc 또는 페이즈 분할로 수습.`;
}
