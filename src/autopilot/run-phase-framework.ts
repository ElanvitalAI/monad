// ── 축D D1 — runPhase 프레임워크 strategy 레지스트리 (ANS PLAN §5) ─────────────
// PLAN-agentic-neural-substrate-2026-07-17 §5 D1. run-mission 의 이진 if(implementation→
// SE 격리 worktree / else→walker main-tree)를 strategy 레지스트리로 승격. 여기가 대표 원칙
// "BUILD 고정 ↔ RUN 가변"의 경계선 — BUILD(미션 생성)는 타이트하게 고정, RUN(페이즈 실행)
// 프레임워크는 pluggable.
//
// 기존 2전략(se-isolated·walker)이 첫 등록 엔트리 = 비파괴 폴백(default 해석은 종전과 동일).
// 새 실행 프레임워크(swarm/supervisor 등·D2)는 registerPhaseFramework 로 walker 폴백 앞에 삽입.
//
// 순수 결정 레이어 + 관측(mission.run.framework). 실행 바디(SE/walker)는 run-mission 이 소유.

import { debug } from '../debug/log.js';
import type { PhaseKind } from './mission-se-bridge.js';

/** 실행 프레임워크 식별자 — 기본 2종 + 미래 확장(swarm/supervisor/…). */
export type PhaseFrameworkId = 'se-isolated' | 'walker' | (string & {});

export interface PhaseFrameworkContext {
  /** classifyPhaseKindSmart 결과(implementation=코드/테스트 저작·operational=조사/운영). */
  phaseKind: PhaseKind;
  /** 도메인(coding/investment/…) — 도메인별 프레임워크 차별화 훅(D3). */
  domain?: string;
  /** config flip 등 미래 pluggability seam(swarm/supervisor 활성). */
  config?: Record<string, unknown>;
}

export interface PhaseFrameworkStrategy {
  id: PhaseFrameworkId;
  label: string;
  /** 우선순위 순 평가 — 첫 매치가 이 페이즈를 처리. walker 는 항상 true(폴백). */
  matches: (ctx: PhaseFrameworkContext) => boolean;
}

/** 기본 2전략(비파괴 폴백) — implementation→SE 격리·나머지→walker(현행 이진 if 와 동일 해석). */
const DEFAULT_STRATEGIES: readonly PhaseFrameworkStrategy[] = [
  { id: 'se-isolated', label: 'SE 격리 worktree(구현·테스트 저작)', matches: (c) => c.phaseKind === 'implementation' },
  { id: 'walker', label: 'walker main-tree(조사·운영)', matches: () => true }, // 폴백(항상 마지막)
];

const registry: PhaseFrameworkStrategy[] = [...DEFAULT_STRATEGIES];

/** 새 실행 프레임워크 등록(D2) — walker 폴백 앞에 삽입해 우선순위 유지. 폴백은 항상 마지막. */
export function registerPhaseFramework(strategy: PhaseFrameworkStrategy): void {
  const fallbackIdx = registry.findIndex((r) => r.id === 'walker');
  if (fallbackIdx < 0) registry.push(strategy);
  else registry.splice(fallbackIdx, 0, strategy);
}

/** 페이즈 → 실행 프레임워크 해석(우선순위 순 첫 매치). 관측 남김. 항상 값 반환(폴백=walker). 순수. */
export function resolvePhaseFramework(ctx: PhaseFrameworkContext): PhaseFrameworkStrategy {
  const hit = registry.find((s) => s.matches(ctx)) ?? registry[registry.length - 1]!;
  debug.log('mission.run.framework', hit.id, { phaseKind: ctx.phaseKind, ...(ctx.domain ? { domain: ctx.domain } : {}) });
  return hit;
}

/** 등록된 프레임워크 목록(관측/디버그용). */
export function listPhaseFrameworks(): readonly PhaseFrameworkStrategy[] {
  return registry;
}

/** 테스트/재부팅용 — 레지스트리를 기본 2전략으로 복귀. */
export function resetPhaseFrameworks(): void {
  registry.length = 0;
  registry.push(...DEFAULT_STRATEGIES);
}
