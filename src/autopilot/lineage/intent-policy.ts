// ── Lineage intent → 정책 (단일 관문·순수) (H0 · 2026-07-20) ──────────────────
//
// ★ RFC-coordinator-loop-template-lineage-historian §3d. 재실행/종결 intent 하나가
//   (a) 5-way 스토어 생애주기(keep/cold-archive/gc) + (b) 캐시 재사용/무효(research·grounding
//   분리)를 결정한다. 조율자·cancelMission·rerunMission·revise 가 이 순수 함수 하나를 consult.
//
// 대표 확정(2026-07-20):
//   · redesign → research 강제 무효(전제 전환·외부조사 오도 위험) · grounding 은 SHA 유지.
//   · cancel → 냉동보관 후 행 제거(삭제 아님·self-recall 도달). 5-way 전부 cold-archive.
//   · revise/redecompose(골 유지) → 재사용(캐시 존재 이유).

import type { CachePolicy, LineageAction, LineagePolicy, LineageStoreKind } from './types.js';

const ALL_KEEP: Record<LineageStoreKind, LineageAction> = {
  'generation-archive': 'keep',
  'working-memory': 'keep',
  'build-frames': 'keep',
  'exec-frames': 'keep',
  cache: 'keep',
  observation: 'keep', // ⑥ logs.db pull-through — 미션 고유 파일 없음(정리 대상 아님)
};

/** cancel-purge: 5-way 전부 냉동보관(대표 확정 — 삭제 아닌 이관). 행은 지워도 이력은 cold ledger 로 산다.
 *  ⑥ observation 은 예외 keep — logs.db 는 미션 고유 파일이 아니라 전역 telemetry(자체 retention). */
const ALL_COLD: Record<LineageStoreKind, LineageAction> = {
  'generation-archive': 'cold-archive',
  'working-memory': 'cold-archive',
  'build-frames': 'cold-archive',
  'exec-frames': 'cold-archive',
  cache: 'cold-archive',
  observation: 'keep',
};

/** 캐시 정책 조견(RFC §3d). freshness(TTL/SHA)는 실 소비처가 여전히 게이트 — 여기선 intent-level 재사용/강제무효만. */
const CACHE_BY_INTENT: Record<string, CachePolicy> = {
  revise: { research: 'reuse', grounding: 'reuse' }, // 골 유지 — 데이터 유효
  'revise-goal': { research: 'invalidate', grounding: 'invalidate' }, // 골 변경 — goalHash miss
  redecompose: { research: 'reuse', grounding: 'reuse' }, // 분해 로직만 틀림
  redesign: { research: 'invalidate', grounding: 'reuse' }, // ★신규 규칙 — 전제 전환·코드는 그대로
  rerun: { research: 'reuse', grounding: 'invalidate' }, // 새 코드 재조사(SHA 자동이나 명시)
  'rebuild-phase': { research: 'reuse', grounding: 'reuse' }, // 부분 — 실 SHA 게이트 유지
};

const CACHE_NA: CachePolicy = { research: 'invalidate', grounding: 'invalidate' }; // cancel/재제출 — 새 ID cold

/** intent → 정책(순수·단일 관문). 미지 intent 는 안전 기본(전부 keep·캐시 무효). */
export function resolveLineagePolicy(intent: string): LineagePolicy {
  if (intent === 'cancel-purge') return { stores: ALL_COLD, cache: CACHE_NA };
  if (intent === 'cancel-defer') return { stores: ALL_KEEP, cache: CACHE_NA }; // 행 유지 — 정리 안 함
  const cache = CACHE_BY_INTENT[intent] ?? CACHE_NA;
  return { stores: ALL_KEEP, cache }; // 재실행 계열 — 스토어는 보존(세대전환), 캐시만 intent 판정
}

/** 캐시 재사용 편의 — research 재사용 허용? (실 freshness 는 별도). */
export function mayReuseResearch(intent: string): boolean {
  return resolveLineagePolicy(intent).cache.research === 'reuse';
}

/** 캐시 재사용 편의 — grounding 재사용 허용? */
export function mayReuseGrounding(intent: string): boolean {
  return resolveLineagePolicy(intent).cache.grounding === 'reuse';
}
