// ── Autopilot Safety Gates (2026-07-08 · P3) ──────────────────────────────
//
// 자동 재부팅 전제 안전 3종(RESEARCH §8·PLAN §D). self-improving 이 monad 자기 코드를
// 바꾸므로, 잘못된 코드=brick 위험. 매매 mandate fail-closed 와 동일 역할:
//   ① 빌드+테스트 게이트 — 통과 없이는 merge/재부팅 없음.
//   ② health 실패 자동 롤백(blue-green) — 재부팅 후 health 실패 시 이전 상태 복원.
//   ③ 불변 코어 — 재부팅/매매/안전/arming 로직은 자기수정 금지 구역(reject).
//
// 재부팅은 arming 무관하게 최종 HITL(대표 확정) — 이 모듈은 게이트만 판정하고 실제
// 재부팅/롤백 실행은 상위(스크립트·데몬)가 HITL 통과 후 수행한다. 순수 판정 함수.

import type { AutopilotArming } from './arming.js';
import type { Evidence } from './absorb-flow.js';

// ──────────────────── ③ 불변 코어 ──────────────────────────────────────

/** 자기수정 금지 구역 — 매매 집행·재부팅·안전 게이트·arming. 이 경로 변경은 거부.
 *  (RESEARCH §8③·매매 mandate fail-closed 와 동일 불변 축.) */
export const IMMUTABLE_CORE_PATTERNS: RegExp[] = [
  /(^|\/)trade-(mandate|autonomous|cycle|order-adapters)\.ts$/, // 매매 집행 코어
  /(^|\/)autopilot\/(arming|safety)\.ts$/,                       // 자율 경계·안전 게이트 자신
  /(^|\/)nexus\/.*reboot/i,                                       // 재부팅 경로
  /(^|\/)(launchd|com\.monad\.nexus)/i,                          // 데몬 감독
  /finance-trade-mandate\.json$/,                                 // 매매 mandate 선언
];

/** 경로가 불변 코어인가. */
export function isImmutableCorePath(path: string): boolean {
  return IMMUTABLE_CORE_PATTERNS.some(re => re.test(path));
}

/** 변경 파일 목록에서 불변 코어 위반 추출. 비었으면 통과. */
export function checkImmutableCore(changedFiles: string[]): { ok: boolean; violations: string[] } {
  const violations = changedFiles.filter(isImmutableCorePath);
  return { ok: violations.length === 0, violations };
}

// ──────────────────── ① 빌드/테스트 게이트 ─────────────────────────────

/** 증거가 게이트를 통과하는가 — build/test 둘 다 fail 아님(skipped 는 통과로 간주하지 않음:
 *  merge/재부팅엔 실제 pass 를 요구). strict=true 면 skipped 도 차단. */
export function evidencePasses(evidence: Evidence | undefined, opts: { strict?: boolean } = {}): boolean {
  if (!evidence) return false;
  if (opts.strict) return evidence.build === 'pass' && evidence.test === 'pass';
  return evidence.build !== 'fail' && evidence.test !== 'fail';
}

// ──────────────────── P3.2 mandate merge 게이트 ────────────────────────

export interface MergeGateInput {
  arming: AutopilotArming;
  evidence?: Evidence;
  changedFiles: string[];
}
export interface GateDecision { allowed: boolean; reason: string; violations?: string[] }

/** 자동 merge 허용 판정 — 전 조건 AND: merge.armed · 빌드/테스트 pass(strict) · 불변코어 무위반.
 *  하나라도 실패=차단(fail-closed). 기본 disarmed 라 실질 항상 차단(HITL). */
export function evaluateMergeGate(input: MergeGateInput): GateDecision {
  if (!input.arming.merge.armed) {
    return { allowed: false, reason: 'merge disarmed — HITL 승인 필요(기본)' };
  }
  const core = checkImmutableCore(input.changedFiles);
  if (!core.ok) {
    return { allowed: false, reason: '불변 코어 수정 — 자동 merge 거부', violations: core.violations };
  }
  if (!evidencePasses(input.evidence, { strict: true })) {
    return { allowed: false, reason: '빌드/테스트 미통과 — 자동 merge 거부' };
  }
  return { allowed: true, reason: 'mandate 내 비핵심 변경 + 증거 통과 — 자동 merge 허용' };
}

// ──────────────────── P3.3 재부팅 게이트 (항상 HITL) ────────────────────

export interface RebootGateInput { arming: AutopilotArming; evidence?: Evidence }
export interface RebootDecision {
  /** 자동 재부팅 허용 — 대표 확정: 항상 false(최종 HITL). */
  autoAllowed: false;
  /** 안전 전제조건(빌드/테스트) 충족 여부 — HITL 승인 시 진행 가능한지. */
  preconditionsMet: boolean;
  reason: string;
}

/** 재부팅 판정 — 자동 재부팅은 arming 무관하게 항상 불허(HITL). 다만 안전 전제(빌드/테스트)
 *  충족 여부를 알려 대표가 승인 판단에 쓴다. 실제 재부팅은 HITL 통과 후 상위가 실행. */
export function evaluateRebootGate(input: RebootGateInput): RebootDecision {
  const preconditionsMet = evidencePasses(input.evidence, { strict: true });
  return {
    autoAllowed: false,
    preconditionsMet,
    reason: preconditionsMet
      ? '빌드/테스트 통과 — 대표 HITL 승인 시 재부팅 가능(자동 금지·불변 규칙)'
      : '빌드/테스트 미통과 — 재부팅 전제 불충족(HITL 여부와 무관하게 차단)',
  };
}

// ──────────────────── ② health 롤백(blue-green) 판정 ────────────────────

export interface HealthRollbackInput {
  /** 재부팅 후 health 체크 통과 여부. */
  healthOk: boolean;
  /** 롤백 대상 이전 상태 식별(SHA 등·있으면 롤백 가능). */
  previousRef?: string;
}
export interface RollbackDecision { rollback: boolean; reason: string; target?: string }

/** 재부팅 후 health 실패 시 롤백 판정 — healthOk=false & previousRef 있으면 롤백.
 *  previousRef 없으면 롤백 불가(경고). health OK 면 롤백 없음. */
export function evaluateHealthRollback(input: HealthRollbackInput): RollbackDecision {
  if (input.healthOk) return { rollback: false, reason: 'health OK — 롤백 불필요' };
  if (!input.previousRef) return { rollback: false, reason: 'health 실패이나 롤백 대상(previousRef) 없음 — 수동 개입 필요' };
  return { rollback: true, reason: 'health 실패 — 이전 상태로 자동 롤백(blue-green)', target: input.previousRef };
}
