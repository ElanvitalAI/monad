// KGS classification helpers — cascade-zyu W2 Y0.
// Default tables for BFO + Schema.org so Patcher (Y3) prompts don't have to
// repopulate every axis. Lazy enforcement of Bloom for pedagogical kinds only.
// RESEARCH §9.5.

import {
  BLOOM_2D_SCOPED,
  isBloom2DScoped,
  type BfoCategory,
  type Bloom2D,
  type KnowledgeKind,
  type SchemaOrgType,
} from './types.js';

/** Kinds where pedagogical intent is intrinsic — Bloom coord is required. */
export const PEDAGOGICAL_KINDS = new Set<KnowledgeKind>([
  'lecture-note',
  'study-guide',
]);

export function requiresBloom(kind: KnowledgeKind): boolean {
  return PEDAGOGICAL_KINDS.has(kind);
}

const BFO_DEFAULT: Record<KnowledgeKind, BfoCategory> = {
  card:           'continuant.generically-dependent',
  note:           'continuant.generically-dependent',
  playbook:       'continuant.generically-dependent',
  checklist:      'continuant.generically-dependent',
  case:           'occurrent.process',
  warning:        'continuant.generically-dependent',
  rca:            'continuant.generically-dependent',
  a3:             'continuant.generically-dependent',
  incident:       'occurrent.process',
  wiki:           'continuant.generically-dependent',
  repomap:        'continuant.generically-dependent',
  'study-guide':  'continuant.generically-dependent',
  'lecture-note': 'continuant.generically-dependent',
  retrospective:  'continuant.generically-dependent',
  template:       'continuant.generically-dependent',
  snapshot:       'occurrent.temporal-region',
};

export function defaultBfoCategory(kind: KnowledgeKind): BfoCategory {
  return BFO_DEFAULT[kind];
}

/** Partial map — `card` / `note` have no canonical Schema.org peer; left undefined. */
const SCHEMA_ORG_DEFAULT: Partial<Record<KnowledgeKind, SchemaOrgType>> = {
  playbook:       'HowTo',
  checklist:      'HowTo',
  case:           'CreativeWork',
  warning:        'CreativeWork',
  rca:            'ScholarlyArticle',
  a3:             'ScholarlyArticle',
  incident:       'NewsArticle',
  wiki:           'Article',
  'study-guide':  'LearningResource',
  'lecture-note': 'LearningResource',
  retrospective:  'CreativeWork',
  template:       'CreativeWork',
};

export function defaultSchemaOrgType(kind: KnowledgeKind): SchemaOrgType | undefined {
  return SCHEMA_ORG_DEFAULT[kind];
}

/** Index inside the scoped 8-cell matrix; -1 if outside (Patcher routes scoped cells to higher-accuracy models). */
export function bloomScopedIndex(b: Bloom2D): number {
  return BLOOM_2D_SCOPED.findIndex(
    (c) => c.cognitive === b.cognitive && c.knowledge === b.knowledge,
  );
}

export { isBloom2DScoped };

// RESEARCH §9.4 — v1 carried 7+ overlapping values across `nature` and `kind`.
// v2 resolves to the artifact-shape axis (`kind`) and remaps `nature` to a closer v2-9 synonym.
const OVERLAP_NATURE_REMAP: Record<string, string> = {
  playbook:  'heuristic',
  case:      'fact',
  warning:   'principle',
  checklist: 'heuristic',
  fact:      'fact',
  forecast:  'forecast',
};

export function consolidateV1Nature(
  v1Nature: string,
  v1Kind: string,
): { nature: string; kind: string; consolidated: boolean } {
  const collision = v1Nature === v1Kind
    || (OVERLAP_NATURE_REMAP[v1Nature] !== undefined && v1Nature !== 'fact' && v1Nature !== 'forecast');
  if (!collision) {
    return { nature: v1Nature, kind: v1Kind, consolidated: false };
  }
  return {
    nature: OVERLAP_NATURE_REMAP[v1Nature] ?? v1Nature,
    kind: v1Kind,
    consolidated: true,
  };
}
