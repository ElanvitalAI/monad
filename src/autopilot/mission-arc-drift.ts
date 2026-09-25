// ── 아크 크기 drift 자기감지 (§5 · PLAN-arc-phase-lifecycle-editing-2026-07-15) ──
//
// 제1원칙(관측→자기인지→셀프힐)의 자기인지·셀프힐 다리. 한 아크에서 split 이 반복되면(대표 결정
// §7-D2 = 2회) "이 아크는 크기가 오판됐다"를 시스템이 스스로 인지하고 insert-arc/성숙도 분리를
// 역제안한다 — a6230f 같은 케이스를 사람이 눈치채기 전에. 순수 모듈(감지·문안 생성만·자동 집행 없음).

import type { MissionArc } from '../task-orchestrator/mission.js';

/** 대표 결정(§7-D2) — 아크당 split 2회에서 크기 오판 역제안 발화. 1회=우연 허용, 2회=구조적 신호. */
export const ARC_SPLIT_DRIFT_THRESHOLD = 2;

export interface ArcDriftSignal {
  arcId: string;
  name: string;
  splitCount: number;
  phaseCount: number;
}

/**
 * 아크 크기 drift 감지 — splitCount 가 임계 이상인 아크들(과소평가 신호). 순수·결정론.
 * descoped/done 아크는 제외(이미 해소·재편성 무의미).
 */
export function detectArcSizeDrift(
  arcs: readonly MissionArc[],
  threshold: number = ARC_SPLIT_DRIFT_THRESHOLD,
): ArcDriftSignal[] {
  return arcs
    .filter((a) => (a.splitCount ?? 0) >= threshold && a.status !== 'descoped' && a.status !== 'done')
    .map((a) => ({ arcId: a.arcId, name: a.name, splitCount: a.splitCount ?? 0, phaseCount: a.phaseIds.length }));
}

/**
 * drift 역제안 문안(순수) — 감지된 아크에 대해 "크기 오판·재편성" 권장. 자동 집행 아님(HITL 카드/로그용).
 * insert-arc(카빙)와 성숙도 분리 중 페이즈 수로 가벼운 힌트.
 */
export function buildArcDriftRecommendation(sig: ArcDriftSignal): string {
  const how = sig.phaseCount >= 4
    ? `insert-arc 로 이 아크를 2개로 카빙(예: 앞 절반→새 아크)하거나 성숙도 분리`
    : `insert-arc 로 뒤따르는 관심사를 새 아크로 분리`;
  return `아크 "${sig.name}"(${sig.arcId})에서 split ${sig.splitCount}회 — 크기 오판 신호(${sig.phaseCount}페이즈). `
    + `권장: ${how}. (자동 집행 안 함·HITL)`;
}

/** 감지된 첫 drift 의 한 줄 요약(로그·카드 헤더용). 없으면 null. */
export function summarizeArcDrift(arcs: readonly MissionArc[], threshold: number = ARC_SPLIT_DRIFT_THRESHOLD): string | null {
  const [first] = detectArcSizeDrift(arcs, threshold);
  return first ? buildArcDriftRecommendation(first) : null;
}
