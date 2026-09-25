// ── arc-revise — 아크 통합 실패 자율 수복 (RFC-mission-arcs·A5 · 2026-07-14) ────
//
// 마이그레이션 안전망(대표 지시로 A3/A4 앞당김): 아크 통합 검증 실패(페이즈는 green 인데 아크로는
// dead-code·미배선)는 그냥 멈추지 않고, "이 아크 통합을 이렇게 닫아라" revise 초안을 자동 생성해
// 원탭 승인 카드를 띄운다. P3 auto-revise(mission-auto-revise.ts)를 아크 컨텍스트로 재사용 —
// 잃어버린 중간층(rebuild-페이즈 ↔ revise-골전체 사이)의 arc 단위 수복.
//
// ★ 자율경계 동일: 판단(무엇을 통합해야 하나)은 시스템·집행은 원탭 승인. 아크 실패는 명확한
//   시스템 신호(통합 검증 grounded FAIL)라 오발 없음.

import { autoPresentReviseCard, type AutoReviseDeps, type AutoReviseResult } from './mission-auto-revise.js';

/** executor 가 표면화한 아크 통합 실패(mission-multiphase-executor MultiphaseResult.arcFailure). */
export interface ArcFailure {
  arcId: string;
  name: string;
  intent: string;
  missing: string;
}

/**
 * 아크 통합 실패 → recommendRevise 의 userContext(순수 문자열). 아크 이름·의도·통합 미충족을
 * 담아 "이 아크를 어떻게 재계획할지" 초안이 나오게 한다.
 */
export function buildArcReviseContext(arc: ArcFailure): string {
  return [
    `아크 통합 검증 실패 — "${arc.name}"(${arc.arcId}).`,
    `아크 의도: ${arc.intent}`,
    `통합 미충족(페이즈는 green 이나 아크로는 dead-code/미배선): ${arc.missing}`,
    '이 아크의 페이즈들을 통합 정합성(실제 배선 + 통합 테스트)을 닫도록 재계획하라. 페이즈 로컬만',
    '통과하고 아크로 연결 안 되는 것을 반복하지 마라.',
  ].join('\n');
}

/** 아크 통합 실패용 카드 힌트(교착 문구 대신). */
function arcHint(arc: ArcFailure): string {
  return `🔒 아크 통합 검증 실패 — "${arc.name}" 아크가 페이즈는 완료됐으나 통합으로는 미충족입니다(dead-code/미배선: ${arc.missing.slice(0, 80)}). 아래 재계획을 제안합니다. 승인하면 반영, 수정/취소도 가능합니다.`;
}

/**
 * 아크 통합 실패 → arc-revise 초안 자동 생성 + 원탭 승인 카드. P3 autoPresentReviseCard 를 아크
 * 컨텍스트+힌트로 재사용. 미발송(origin/추천 부재)이면 호출측이 generic rerun 폴백.
 */
export async function presentArcReviseCard(
  missionId: string,
  arc: ArcFailure,
  deps: AutoReviseDeps = {},
): Promise<AutoReviseResult> {
  return autoPresentReviseCard(missionId, buildArcReviseContext(arc), { ...deps, hint: arcHint(arc) });
}
