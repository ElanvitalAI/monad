// ── LLM 라우팅 맵 drift 자기감지 (2026-07-15 · catalog SSoT 확장) ──────────────
//
// 제1원칙(관측→자기인지→셀프힐)의 LLM 판 — `mission-arc-drift.ts`(아크 크기 drift) 패턴을 미러링.
// 라우팅 핀(alias·tier-map·mission-router defaults)이 catalog/(SSoT)와 어긋나면(stale·deprecated·미등재)
// 시스템이 스스로 인지하고 **HITL 역제안**한다(자동 집행 없음 — 모델 id 오타=런타임 장애).
//
// `catalog-drift.test.ts`는 catalog-소유 provider(grok/anthropic/gemini)의 핀을 **strict(CI 실패)**로
// 강제. 이 모듈은 그 밖(mission-router defaults·openai)까지 넓혀 **advisory drift 리포트**로 surface —
// 지속 LLM 관리 루프 미션의 첫 셀프힐 입력. codex/local 은 catalog 미소유(자체 소스)라 감사 제외.

import { activeCatalogModelIds, auditFamilyAliasFreshness, type FamilyAliasFreshness } from './catalog-derive.js';
import { getCatalog } from './loader.js';
import { LLM_TIER_MAP_BY_PROVIDER } from '../model-tier/llm-tier-map.js';
import { listModelAliases } from '../intelligence-map/model-alias.js';
import { DEFAULT_MODEL as MISSION_DEFAULT_MODEL, DEFAULT_PROVIDER as MISSION_DEFAULT_PROVIDER } from '../llm/mission-router.js';
import { BUILTIN_CATALOG, enabledModels } from '../intelligence-map/model-catalog.js';

/** catalog 미소유(자체 소스) provider — mission-router 핀이 이 provider 면 감사 제외(codex/local). */
const NON_CATALOG_PROVIDERS = new Set(['codex-app-server', 'openai-codex', 'local']);

/** catalog 가 소유하는 provider(감사 대상). codex/local/kimi/qwen/glm 은 자체 소스라 제외. */
export const CATALOG_AUDIT_PROVIDERS = ['grok', 'anthropic', 'gemini', 'openai'] as const;

export interface RoutingPin { source: string; key: string; model: string }
export type RoutingDriftStatus = 'missing' | 'deprecated';
export interface RoutingDriftSignal extends RoutingPin { status: RoutingDriftStatus }

/** 기존 pin drift와 독립적인 비차단 family-alias 최신성 관측값. */
export interface RoutingDriftAudit {
  pinDrift: RoutingDriftSignal[];
  familyAliasFreshness: FamilyAliasFreshness[];
}

export interface RoutingDriftDeps {
  aliases?: Readonly<Record<string, string>>;
  tierMap?: typeof LLM_TIER_MAP_BY_PROVIDER;
  missionDefaults?: Partial<Record<string, string>>;
  /** model-catalog.ts(독립 하드코딩) 엔트리 — {provider, id, local}. 미주입=BUILTIN_CATALOG. */
  modelCatalog?: ReadonlyArray<{ provider: string; id: string; local?: boolean }>;
  activeIds?: Set<string>;
  catalogHas?: (id: string) => boolean;
  familyAliasFreshness?: readonly FamilyAliasFreshness[];
}

/** 감사 대상 라우팅 핀 수집(catalog-소유 provider 한정). */
export function collectRoutingPins(deps: RoutingDriftDeps = {}): RoutingPin[] {
  const aliases = deps.aliases ?? listModelAliases();
  const tierMap = deps.tierMap ?? LLM_TIER_MAP_BY_PROVIDER;
  const missionDefaults = deps.missionDefaults ?? MISSION_DEFAULT_MODEL;
  const pins: RoutingPin[] = [];
  // alias(전부 — 큐레이션이라 catalog 모델 지향)
  for (const [k, m] of Object.entries(aliases)) pins.push({ source: 'model-alias', key: k, model: m });
  // tier-map — catalog-소유 provider 만
  for (const p of CATALOG_AUDIT_PROVIDERS) {
    const tiers = tierMap[p as keyof typeof tierMap];
    if (!tiers) continue;
    for (const [tier, spec] of Object.entries(tiers)) pins.push({ source: `tier-map:${p}`, key: tier, model: spec.model });
  }
  // mission-router DEFAULT_MODEL — catalog-소유 provider 인 kind 만(build=codex 등 제외).
  const provOf = deps.missionDefaults ? undefined : MISSION_DEFAULT_PROVIDER;
  for (const [kind, m] of Object.entries(missionDefaults)) {
    if (!m) continue;
    if (provOf && NON_CATALOG_PROVIDERS.has(provOf[kind as keyof typeof provOf] ?? '')) continue; // codex/local 라우팅 제외
    pins.push({ source: 'mission-router', key: kind, model: m });
  }
  // model-catalog.ts(독립 하드코딩) — catalog-소유 provider·비-local 엔트리(recommendModel 등 소비).
  const mc = deps.modelCatalog ?? enabledModels(BUILTIN_CATALOG);
  for (const e of mc) {
    if (e.local) continue;
    if (!(CATALOG_AUDIT_PROVIDERS as readonly string[]).includes(e.provider)) continue;
    pins.push({ source: 'model-catalog', key: e.id, model: e.id });
  }
  return pins;
}

/** 라우팅 drift 감지 — catalog active 에 없는 핀(missing/deprecated). 순수·결정론. dedupe. */
export function detectRoutingDrift(deps: RoutingDriftDeps = {}): RoutingDriftSignal[] {
  const active = deps.activeIds ?? activeCatalogModelIds();
  const cat = getCatalog();
  const has = deps.catalogHas ?? ((id: string) => cat.models.has(id));
  const seen = new Set<string>();
  const out: RoutingDriftSignal[] = [];
  for (const p of collectRoutingPins(deps)) {
    if (active.has(p.model)) continue;
    const dedup = `${p.source}\0${p.key}\0${p.model}`;
    if (seen.has(dedup)) continue;
    seen.add(dedup);
    out.push({ ...p, status: has(p.model) ? 'deprecated' : 'missing' });
  }
  return out;
}

/** 실제 advisory 감사 진입점 — 기존 pin drift와 family 최신성을 서로 독립된 값으로 노출한다. */
export function auditRoutingDrift(deps: RoutingDriftDeps = {}): RoutingDriftAudit {
  const aliases = deps.aliases ?? listModelAliases();
  return {
    pinDrift: detectRoutingDrift(deps),
    familyAliasFreshness: [...(deps.familyAliasFreshness ?? auditFamilyAliasFreshness(aliases))],
  };
}

/** drift 역제안 문안(순수·HITL). 자동 집행 아님. */
export function buildRoutingDriftRecommendation(d: RoutingDriftSignal): string {
  const why = d.status === 'deprecated'
    ? `catalog 에서 deprecated 된 모델을 참조`
    : `catalog(SSoT)에 없는 모델`;
  return `[${d.source}:${d.key}] "${d.model}" — ${why}. 권장: catalog/ 에 모델 추가하거나 핀을 active id 로 교체. (HITL·자동 집행 안 함)`;
}

/** 첫 drift 한 줄 요약(로그·카드 헤더). family 최신성은 advisory로 함께 보고한다. */
export function summarizeRoutingDrift(deps: RoutingDriftDeps = {}): string | null {
  const audit = auditRoutingDrift(deps);
  const familySignal = audit.familyAliasFreshness.find((result) => result.status === 'stale')
    ?? audit.familyAliasFreshness.find((result) => result.status.startsWith('unknown-'));
  if (audit.pinDrift.length) {
    const suffix = familySignal ? ` · family alias ${familySignal.status} [${familySignal.alias}] "${familySignal.currentModel}"${familySignal.recommendedModel ? ` → "${familySignal.recommendedModel}"` : ''}` : '';
    return `LLM 라우팅 drift ${audit.pinDrift.length}건 — ${buildRoutingDriftRecommendation(audit.pinDrift[0]!)}${audit.pinDrift.length > 1 ? ` (외 ${audit.pinDrift.length - 1}건)` : ''}${suffix}`;
  }
  if (!familySignal) return null;
  return `LLM 라우팅 drift 0건 · family alias ${familySignal.status} — [model-alias:${familySignal.alias}] "${familySignal.currentModel}"${familySignal.recommendedModel ? ` → "${familySignal.recommendedModel}"` : ''} (advisory·자동 집행 안 함)`;
}
