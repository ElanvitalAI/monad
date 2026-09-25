// KGS v2 substrate barrel — schema-only land (cascade-zyu W2 Y0).
// Patcher (Y3) / Thinker (Y4) import from here; SQLite + FTS5 storage in W3 Y1.

export type {
  KnowledgeNature,
  KnowledgeKind,
  BloomCognitive,
  BloomKnowledge,
  Bloom2D,
  BfoCategory,
  SchemaOrgType,
  SourceReliability,
  RiskLevel,
  CardSource,
  KnowledgeCard,
  KnowledgeCardInit,
} from './types.js';

export {
  KNOWLEDGE_NATURES,
  KNOWLEDGE_KINDS,
  BLOOM_COGNITIVE_PROCESSES,
  BLOOM_KNOWLEDGE_DIMS,
  BLOOM_2D_SCOPED,
  BFO_CATEGORIES,
  SCHEMA_ORG_NARROW_TYPES,
  SOURCE_RELIABILITIES,
  RISK_LEVELS,
  KGS_DEFAULTS,
  newCardId,
  isCardId,
  isKnowledgeNature,
  isKnowledgeKind,
  isBloomCognitive,
  isBloomKnowledge,
  isBfoCategory,
  isSchemaOrgType,
} from './types.js';

export {
  PEDAGOGICAL_KINDS,
  requiresBloom,
  defaultBfoCategory,
  defaultSchemaOrgType,
  bloomScopedIndex,
  isBloom2DScoped,
  consolidateV1Nature,
} from './classification.js';

export {
  createKnowledgeCard,
  seedNatureKindFromIntentLayer,
  seedCardFromIntentEvent,
  type IntentEventSeedInput,
} from './intake.js';

export type {
  PackAudience,
  PackKind,
  PackId,
  PackMetadata,
  Pack,
  PackInit,
} from './pack.js';

export {
  PACK_AUDIENCES,
  PACK_KINDS,
  PACK_DEFAULTS,
  isPackAudience,
  isPackKind,
  isPackSlug,
  isPackVersion,
  packIdString,
  parsePackIdString,
  createPack,
  appendCardToPack,
  summarizePackKinds,
} from './pack.js';
