// ── DomainPack 레지스트리 — ENGINE_BY_MODEL 의 도메인판 (D0 · 2026-07-11) ────
//
// 새 분야 = registerDomain(pack) 1개. 그릇 본체(mission-engine)는 getDomainPack 으로
// 소비만 하고 무수정. general 팩은 모듈 로드 시 기본 등록(항상 유효 팩 반환 보장).
//
// 설계: 내부 문서 `PLAN-domain-pack-registry-2026-07-11` §3.2.

import { isDomain, type Domain, type DomainPack } from './types.js';
import { GENERAL_PACK } from './general-pack.js';
import { CODING_PACK } from './coding-pack.js';
import { INVESTMENT_PACK } from './investment-pack.js';
import { BUSINESS_PACK } from './business-pack.js';

const REGISTRY = new Map<Domain, DomainPack>();

/** 빌트인 팩 등록 — 기본 3축(coding·investment·business) + general. */
function registerBuiltinDomains(): void {
  registerDomain(GENERAL_PACK);
  registerDomain(CODING_PACK);
  registerDomain(INVESTMENT_PACK);
  registerDomain(BUSINESS_PACK);
}

/** 도메인팩 등록(멱등·같은 domain 재등록 시 덮어씀). coding/investment/research 팩이 소비. */
export function registerDomain(pack: DomainPack): void {
  REGISTRY.set(pack.domain, pack);
}

/** 도메인팩 조회 — 미등록/부정 도메인은 general 로 폴백(항상 non-null). */
export function getDomainPack(d: Domain | string | null | undefined): DomainPack {
  const key: Domain = isDomain(d) ? d : 'general';
  return REGISTRY.get(key) ?? REGISTRY.get('general') ?? GENERAL_PACK;
}

/** 등록된 도메인 목록(관측·PWA). */
export function listRegisteredDomains(): Domain[] {
  return [...REGISTRY.keys()];
}

/** 테스트용 — 레지스트리 초기화(빌트인 general·coding 재등록). */
export function resetDomainRegistryForTest(): void {
  REGISTRY.clear();
  registerBuiltinDomains();
}

// 모듈 로드 시 빌트인(general·coding) 등록.
registerBuiltinDomains();
