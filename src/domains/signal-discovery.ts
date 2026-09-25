// ── 발굴형 해상도 — 갭 → 발굴 미션 씨앗 (적응형 투자 A6·2026-07-11) ──────────────
//
// A6a 가 감지한 해상도 갭(오탐 과다·커버리지 부족·심각도 인플레·다이제스트 적체)을 **발굴 미션
// 씨앗(ProposalSeed)**으로 변환한다(§12.4 발굴형 = 자기주도 능력 심화). 씨앗은 intakeSeedsAsMissions
// 로 인입 → business 도메인(부작용 없는 리서치)이라 A4c 자동수용(arming 시 status=armed·HITL 스킵).
//
// ★ 안전: 산출물은 "분석 리서치"(읽기+문서·매매/코드변경 아님) — 부작용 경계 안. arming off 면
//   proposed(현행). ★ dedup: 제목을 갭 kind 별로 **안정**(변동 % 제외 → rationale 로)해 재사이클
//   중복 인입 방지(intake 가 goal title 로 dedup).
//
// 설계: 내부 문서 `DESIGN-adaptive-investment-autopilot-2026-07-11` §12.4·§12.5·§12.6(A6).

import type { ResolutionGap, GapKind } from './signal-metrics.js';
import type { ProposalSeed } from '../autopilot/proposal/draft-plan.js';

/** 갭 kind → 안정 제목(business 도메인으로 감지되도록 리서치로 표현·변동 수치 제외 → dedup 안정). */
const GAP_TITLES: Record<GapKind, string> = {
  'high-false-positive': '신호 파이프라인 1차 게이트 오탐 원인 분석 리서치',
  'low-gate2-coverage': '신호 파이프라인 2차 게이트 처리량 병목 분석 리서치',
  'severity-inflation': '신호 파이프라인 심각도 분류 캘리브레이션 분석 리서치',
  'digest-backlog': '신호 다이제스트 적체 소진 병목 분석 리서치',
  'low-hit-rate': '신호 방향 정확도(사후 hit-rate) 저하 원인 분석 리서치',
};

/** 갭 → 발굴 미션 씨앗. 제목 안정(dedup)·수치는 rationale. tier=light(단일 분석). */
export function gapToSeed(gap: ResolutionGap): ProposalSeed {
  return {
    slug: `adaptive-resolution-${gap.kind}`,
    title: GAP_TITLES[gap.kind],
    source: 'internal-roadmap',
    rationale: `발굴형 해상도(§12.4·Goodhart-safe 실측): ${gap.note}. 실측값 ${gap.value.toFixed(3)} (임계 ${gap.threshold}). 원인 분석 + 규칙/사전/주기 보강안 산출(읽기+문서·무매매).`,
    evidence: [],
    tier: 'light',
  };
}

/** 갭 배열 → 씨앗 배열(중복 kind 제거). */
export function gapsToSeeds(gaps: ResolutionGap[]): ProposalSeed[] {
  const seen = new Set<GapKind>();
  const seeds: ProposalSeed[] = [];
  for (const g of gaps) {
    if (seen.has(g.kind)) continue;
    seen.add(g.kind);
    seeds.push(gapToSeed(g));
  }
  return seeds;
}
