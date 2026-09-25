// ── 아크 통합 acceptance 검증 (RFC-mission-arcs·A2 · 2026-07-14) ──────────────
//
// 아크의 핵심 가치: 페이즈 로컬 acceptance("observe 함수가 존재한다")가 놓치는 통합 정합성
// ("observeCoordinatorState 가 lifecycle 에서 실제 호출되고 테스트로 덮인다")을 아크 경계에서 검증.
// a6230f phase 2 dead-code(export-only·미배선) 가 이 검증에서 잡힌다.
//
// grounded 검증 재사용(verifyPhaseAlreadySatisfied) — 아크 intent 를 코드에 grounding 하고 아크
// acceptance 를 LLM 이 판정. 빈 acceptance(flat 미션·암묵 1아크)면 즉시 통과 = 회귀 0.
// 제1원칙 준수: 아크 검증을 debug.log('mission.arc.verify') 로 관측(monad logs --category mission.arc).

import { debug } from '../debug/log.js';
import type { MissionArc } from '../task-orchestrator/mission.js';
import { verifyPhaseAlreadySatisfied } from './mission-se-noop-verify.js';

export interface ArcVerifyResult {
  ok: boolean;
  evidence: string;
  missing?: string;
  /**
   * ★ 자기인지(적응형 디깅·2026-07-14) — 실제 구현을 충분히 파고 판정했나. false 면 판정 신뢰 낮음
   * ("못 봤다"·grounding miss). 호출측(executor)이 unmet(깨짐·arc-revise) vs unverified(판정 불가·
   * HITL 보류)를 구분해 false arc-revise 를 막는다.
   */
  grounded?: boolean;
}

/** 아크 검증 증거(적응형 디깅 시드) — 페이즈 파일참조 등 실구현 파일. executor 가 구성해 주입. */
export interface ArcEvidence {
  /** 실구현 파일 시드(페이즈 설명/notes 파일참조 + arc.reuseBoundaries). grounding miss 방지. */
  seedFiles?: string[];
}

/** 아크 통합 검증기 — 아크(+증거)를 받아 통합 acceptance 충족 여부 판정. 테스트/커스텀 주입 seam. */
export type ArcVerifier = (arc: MissionArc, evidence?: ArcEvidence) => Promise<ArcVerifyResult>;

/**
 * 아크 통합 acceptance 검증. 빈 acceptance(flat/암묵1아크)면 즉시 통과(회귀 0). verifier 미주입
 * (테스트·NODE_ENV=test)이면 스킵-통과. 예외는 fail-soft 로 미충족 처리(false-PASS 금지).
 */
export async function verifyArcAcceptance(
  arc: MissionArc,
  missionId: string,
  verify?: ArcVerifier,
  evidence?: ArcEvidence,
): Promise<ArcVerifyResult> {
  if (!arc.acceptance || arc.acceptance.length === 0) {
    debug.log('mission.arc.verify', 'skip-empty', { missionId, arcId: arc.arcId });
    return { ok: true, evidence: '(아크 통합 acceptance 없음 — flat/페이즈 로컬만)', grounded: true };
  }
  if (!verify) {
    debug.log('mission.arc.verify', 'skip-no-verifier', { missionId, arcId: arc.arcId });
    return { ok: true, evidence: '(검증기 미주입)', grounded: true };
  }
  try {
    const r = await verify(arc, evidence);
    debug.log('mission.arc.verify', r.ok ? 'pass' : (r.grounded === false ? 'unverified' : 'fail'), {
      missionId, arcId: arc.arcId, name: arc.name, grounded: r.grounded !== false,
      evidence: r.evidence.slice(0, 160), ...(r.missing ? { missing: r.missing.slice(0, 160) } : {}),
    }, { level: !r.ok && r.grounded !== false ? 'error' : undefined });
    return r;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    debug.log('mission.arc.verify', 'error', { missionId, arcId: arc.arcId, error: msg.slice(0, 160) }, { level: 'error' });
    // 검증 예외 = grounding 못 함(판정 불가) → grounded:false(unverified). false arc-revise 방지.
    return { ok: false, evidence: '', missing: `아크 검증 예외(fail-soft·판정 불가): ${msg.slice(0, 120)}`, grounded: false };
  }
}

/**
 * 실 배선 검증기 — grounded(코드 실독) + LLM 판정. 아크 intent 를 코드에 grounding 하고 아크
 * 통합 acceptance 를 엄격 판정(dead-code·미배선이면 satisfied=false).
 */
export function defaultArcVerifier(repoRoot: string): ArcVerifier {
  return async (arc: MissionArc, evidence?: ArcEvidence): Promise<ArcVerifyResult> => {
    const intent = `[아크: ${arc.name}] ${arc.intent}`;
    // ★ 선언 증거 시드(적응형 디깅·2026-07-14) — arc.reuseBoundaries + 페이즈 파일참조를 grounding
    //   시드로 앞세워 실구현을 파게 한다(intent 재유도가 문서만 잡던 grounding miss 수리·arc1 선례).
    const seedFiles = [...new Set([...(arc.reuseBoundaries ?? []), ...(evidence?.seedFiles ?? [])])];
    const v = await verifyPhaseAlreadySatisfied(intent, [...arc.acceptance], { repoRoot, seedFiles });
    return { ok: v.satisfied, evidence: v.evidence, grounded: v.grounded, ...(v.missing ? { missing: v.missing } : {}) };
  };
}
