// ── Lineage substrate 마운트 레지스트리 (H0 · 2026-07-20) ─────────────────────
//
// ★ RFC-coordinator-loop-template-lineage-historian §3b. 조합 문법의 신규 관문
//   `mountSubstrate` 의 구체판 — 각 루프(빌드/투자/비즈)가 자기 LineageSource 를 등록한다.
//   domain/registry.ts(WHAT 축)와 동형 패턴. Historian(H1+)은 listLineageSources 로 소비만.
//
// fail-soft: 소스 메서드 예외는 Historian 소비처가 흡수(부기 실패가 미션을 절대 막지 않음).

import type { LineageSource, LineageStoreKind } from './types.js';

const REGISTRY = new Map<LineageStoreKind, LineageSource>();

/** LineageSource 등록(멱등·같은 kind 재등록 시 덮어씀). 빌드 루프는 5-way 소스를 H1 에서 등록. */
export function mountLineageSource(source: LineageSource): void {
  REGISTRY.set(source.kind, source);
}

/** 특정 스토어 소스 조회(미등록=undefined). */
export function getLineageSource(kind: LineageStoreKind): LineageSource | undefined {
  return REGISTRY.get(kind);
}

/** 등록된 소스 전체(관측·통합 타임라인). 등록 순서 무관 — H1 이 타임스탬프/세대로 정렬. */
export function listLineageSources(): LineageSource[] {
  return [...REGISTRY.values()];
}

/** 테스트용 — 레지스트리 초기화. */
export function resetLineageRegistryForTest(): void {
  REGISTRY.clear();
}
