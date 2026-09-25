// ── Domain 축 (WHAT) — 미션 그릇의 도메인 1급화 (D0 · 2026-07-11) ───────────
//
// 미션 fabric 은 그동안 **실행모델(HOW)축**(triage.ts ExecutionModel·ENGINE_BY_MODEL)
// 만 1급이었다. "무슨 분야인가(WHAT)"는 부재해 분해·리서치에 goalKind:'coding' 이
// 하드코딩 → 사실상 코딩 전용 파이프라인. 이 모듈은 그 **직교 축**을 세운다.
//
// Domain 이 결정하는 것: 분해 성격 · 리서치 소스 · 실행기 · 검증기 · 안전 게이트.
// ExecutionModel 이 결정하는 것: 실행의 시간구조(1회/반복/주기/이벤트) — 변경 없음.
// 두 축은 곱(product)으로 조합 — 코딩도 loop 가능, 투자도 scheduler 가능(조합 폭발 없음).
//
// 설계: 내부 문서 `PLAN-domain-pack-registry-2026-07-11` §3.
// executor/verifier/safetyGate 의 실 계약은 D6(승인→멀티페이즈 executor 배선)에서 확정.

import type { TaskStore } from '../../task-orchestrator/store.js';

/** 기본 3축 — coding/investment/business(업무 자동화) + general(fallback). 대표 확정
 *  2026-07-11. research 는 도메인이 아니라 횡단 능력(각 도메인이 합성)·조사/리포트/분석
 *  같은 지식 업무 결과물은 business 로 흡수. 새 분야는 팩 추가로 열림. */
export const DOMAINS = ['coding', 'investment', 'business', 'general'] as const;
export type Domain = (typeof DOMAINS)[number];

export function isDomain(v: unknown): v is Domain {
  return typeof v === 'string' && (DOMAINS as readonly string[]).includes(v);
}

/** 분해 성격 — TaskGenerator goalKind + objective 프리앰블(구현한다 vs 판단한다). */
export interface DomainDecompose {
  /** generator 계약(coding/research/ops/general). generator.decompose({goalKind}). */
  goalKind: string;
  /** 분해 objective 첫 줄 — 도메인 어투("…를 구현한다"/"…를 판단·집행한다"). */
  objectivePreamble: (goal: string) => string;
  /** 페이즈 분해 가이드(옵션) — 도메인 특유 단계 형태(예: 투자=관측→리서치→판단→집행→검증). */
  phaseShapeHint?: string;
}

/** 리서치 소스 라우팅 — 코딩=omni-crawl, 투자=omni-market/kr-flow. 시그니처는 기존
 *  mission-research-gate 기본값(defaultAssessNeed/defaultInvoke)과 동형(이관 용이). */
export interface DomainResearch {
  assessNeed: (goal: string) => Promise<{ needed: boolean; reason: string }>;
  invoke: (goal: string) => Promise<{ ok: boolean; output: string }>;
}

/** 승인 후 페이즈 실행기 컨텍스트 — store 기반(live 디스패처 불요·D6). */
export interface MissionExecutorContext {
  store: TaskStore;
  now: number;
}
export interface MissionExecutorResult {
  ok: boolean;
  /** ready 로 올린(실행 가능) 페이즈 수. investment=dry 면 0. */
  activated: number;
  note?: string;
}
/** 승인 후 페이즈 실행기 — 도메인별(coding/business=페이즈 스테이징·investment=dry). D6. */
export type MissionExecutor = (missionId: string, ctx: MissionExecutorContext) => Promise<MissionExecutorResult>;
/** 검증 — 코딩=build/test, 투자=verify_order_filled. */
export type MissionVerifier = (missionId: string) => Promise<{ ok: boolean; note?: string }>;
/** 안전 게이트 — 코딩=HITL PR, 투자=mandate armed/live. */
export type MissionSafetyGate = (missionId: string) => Promise<{ allowed: boolean; reason?: string }>;

/** 도메인팩 — ENGINE_BY_MODEL 의 도메인판. 새 분야 = registerDomain(pack) 1개. */
export interface DomainPack {
  domain: Domain;
  /** 사람용 라벨(UI·로그). */
  label: string;
  decompose: DomainDecompose;
  research: DomainResearch;
  /** D2/D3 에서 채워짐 — 미배선이면 그릇 상단(engine)이 기존 경로로 폴백. */
  executor?: MissionExecutor;
  verifier?: MissionVerifier;
  safetyGate?: MissionSafetyGate;
}
