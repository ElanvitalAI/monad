// ── catalog/ 파생 통합 — SSoT 어댑터 + drift 감지 (2026-07-15) ────────────────
//
// catalog/(RFC #2161 Layer A · YAML)를 **단일 SSoT**로 굳히는 어댑터. 흩어진 파생(model-alias·
// llm-tier-map·model-catalog·provider defaults)이 catalog/ 와 어긋나지 않게 감사한다.
//   - activeCatalogModelIds: catalog active(non-deprecated) canonical id + familyShortcut.
//   - catalogModelFacts: pricing·context·reasoning 을 SSoT 서 읽기(라우터가 하드코딩 대신).
//   - auditDerivedPins: 파생 핀이 catalog 에 있는지(=drift) 리포트. grok tier-map 이 grok-3 대로
//     방치됐던 사건을 이 감사가 잡는다. 지속 관리 루프 미션이 이 어댑터를 재사용한다.

import { listModelAliases } from '../intelligence-map/model-alias.js';
import { getCatalog } from './loader.js';
import type { ModelSpec } from './types.js';

/** catalog/(SSoT)의 active(non-deprecated) 모델 canonical id + familyShortcut 집합. */
export function activeCatalogModelIds(): Set<string> {
  const ids = new Set<string>();
  for (const m of getCatalog().models.values()) {
    if (m.deprecated) continue;
    ids.add(m.id);
    if (m.familyShortcut) ids.add(m.familyShortcut);
  }
  return ids;
}

/** 모델 facts(catalog SSoT) — 라우터/티어가 pricing·context 를 하드코딩 대신 SSoT 서 읽게. null=미등록. */
export function catalogModelFacts(id: string): Pick<ModelSpec, 'pricing' | 'contextSize' | 'reasoning' | 'releaseDate' | 'displayName'> & { deprecated: string | null } | null {
  const m = getCatalog().models.get(id);
  if (!m) return null;
  return {
    ...(m.pricing ? { pricing: m.pricing } : {}),
    ...(m.contextSize !== undefined ? { contextSize: m.contextSize } : {}),
    ...(m.reasoning ? { reasoning: m.reasoning } : {}),
    ...(m.releaseDate ? { releaseDate: m.releaseDate } : {}),
    displayName: m.displayName,
    deprecated: m.deprecated ?? null,
  };
}

/** 파생 핀 참조(어느 파일의 어떤 alias/tier 가 무슨 모델을 가리키나). */
export interface PinRef { source: string; key?: string; model: string }
export type PinStatus = 'ok' | 'missing' | 'deprecated';
export type DerivedPinAudit = PinRef & { status: PinStatus; familyAliasFreshness?: FamilyAliasFreshness };

/**
 * 파생 핀 감사 — catalog active id 에 없으면 missing(drift), deprecated 면 deprecated. ok 아닌 게 있으면
 * 맵이 SSoT 와 어긋난 것. 기본 별칭 목록의 alias 핀에는 독립적인 최신성 관측값도 합성한다.
 * 그 값은 status·drift 필터·라우팅을 바꾸지 않는다.
 */
export function auditDerivedPins(
  pins: readonly PinRef[],
  familyAliases: Readonly<Record<string, string>> = listModelAliases(),
): DerivedPinAudit[] {
  const cat = getCatalog();
  const active = activeCatalogModelIds();
  const freshnessByAlias = new Map(auditFamilyAliasFreshness(familyAliases).map((result) => [result.alias, result]));
  return pins.map((p) => {
    const status = active.has(p.model)
      ? 'ok' as const
      : (cat.models.get(p.model)?.deprecated ? 'deprecated' : 'missing') as PinStatus;
    const familyAliasFreshness = p.key && familyAliases[p.key] === p.model
      ? freshnessByAlias.get(p.key)
      : undefined;
    return { ...p, status, ...(familyAliasFreshness ? { familyAliasFreshness } : {}) };
  });
}

/** 감사에서 ok 아닌(drift) 핀만. 빈 배열 = 맵이 SSoT 와 정합. 기존 반환 필드는 그대로 유지한다. */
export function findPinDrift(pins: readonly PinRef[]): Array<PinRef & { status: PinStatus }> {
  return auditDerivedPins(pins)
    .filter((result) => result.status !== 'ok')
    .map(({ familyAliasFreshness: _freshness, ...pinDrift }) => pinDrift);
}

/** Family alias freshness is advisory: it never changes pin-drift status or routing. */
export type FamilyAliasFreshnessStatus =
  | 'current'
  | 'stale'
  | 'excluded-versioned'
  | 'unknown-missing-target'
  | 'unknown-no-candidate'
  | 'unknown-missing-release-date'
  | 'unknown-ambiguous-latest';

export interface FamilyAliasFreshness {
  alias: string;
  currentModel: string;
  recommendedModel?: string;
  status: FamilyAliasFreshnessStatus;
}

const VERSIONED_ALIAS = /\d/;
const PRE_RELEASE_MODEL = /\b(?:preview|experimental|coming[- ]soon)\b/i;

function isProductionCandidate(model: ModelSpec): boolean {
  return !model.deprecated && !PRE_RELEASE_MODEL.test(`${model.id} ${model.displayName}`);
}

function belongsToAliasFamily(candidate: ModelSpec, current: ModelSpec): boolean {
  if (candidate.provider !== current.provider) return false;
  return current.familyShortcut
    ? candidate.familyShortcut === current.familyShortcut
    : candidate.family === current.family;
}

/**
 * Classify unversioned aliases against the newest production model in the target's provider+product family.
 * `familyShortcut` distinguishes products sharing a catalog generation family; records without one fall back to family.
 * A latest model is knowable only when every active family candidate has a release date and exactly one
 * candidate owns the latest date; otherwise this emits an explicit non-blocking unknown value.
 */
export function auditFamilyAliasFreshness(
  aliases: Readonly<Record<string, string>>,
  models: Iterable<ModelSpec> = getCatalog().models.values(),
): FamilyAliasFreshness[] {
  const allModels = [...models];
  return Object.entries(aliases).map(([alias, currentModel]) => {
    if (VERSIONED_ALIAS.test(alias)) return { alias, currentModel, status: 'excluded-versioned' };

    const current = allModels.find((model) => model.id === currentModel);
    if (!current?.family) return { alias, currentModel, status: 'unknown-missing-target' };

    const candidates = allModels.filter((model) => belongsToAliasFamily(model, current) && isProductionCandidate(model));
    if (!candidates.length) return { alias, currentModel, status: 'unknown-no-candidate' };
    if (candidates.some((model) => !model.releaseDate)) {
      return { alias, currentModel, status: 'unknown-missing-release-date' };
    }

    const latestDate = candidates.reduce((date, model) => model.releaseDate! > date ? model.releaseDate! : date, '');
    const latest = candidates.filter((model) => model.releaseDate === latestDate);
    if (latest.length !== 1) return { alias, currentModel, status: 'unknown-ambiguous-latest' };

    const recommendedModel = latest[0]!.id;
    return {
      alias,
      currentModel,
      recommendedModel,
      status: recommendedModel === currentModel ? 'current' : 'stale',
    };
  });
}
