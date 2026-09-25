// KGS card schema v2 — cascade-zyu W2 Y0.
// Substrate for Patcher (Y3) / Thinker (Y4); SQLite + FTS5 lands in W3 Y1.
// Classification: RESEARCH §9.5 (Bloom 2D scoped + BFO + Schema.org narrow + consolidation).

/** Consolidated 9-enum (v1 had 12 with overlap vs `kind`). */
export type KnowledgeNature =
  | 'fact'
  | 'metric'
  | 'opinion'
  | 'heuristic'
  | 'rumor'
  | 'local_tip'     // location-scoped advice
  | 'preference'
  | 'forecast'
  | 'principle';

export const KNOWLEDGE_NATURES: readonly KnowledgeNature[] = [
  'fact', 'metric', 'opinion', 'heuristic',
  'rumor', 'local_tip', 'preference', 'forecast', 'principle',
];

export function isKnowledgeNature(v: unknown): v is KnowledgeNature {
  return typeof v === 'string'
    && (KNOWLEDGE_NATURES as readonly string[]).includes(v);
}

/** Closed DocOps claim-relation vocabulary; free-form model labels are rejected. */
export type SemanticRelation =
  | 'supports'
  | 'contradicts'
  | 'duplicates'
  | 'supersedes'
  | 'derived-from'
  | 'elaborates'
  | 'references';

export const SEMANTIC_RELATIONS: readonly SemanticRelation[] = [
  'supports', 'contradicts', 'duplicates', 'supersedes',
  'derived-from', 'elaborates', 'references',
];

export function isSemanticRelation(v: unknown): v is SemanticRelation {
  return typeof v === 'string'
    && (SEMANTIC_RELATIONS as readonly string[]).includes(v);
}

/** Closed DocOps HITL proposal vocabulary; destructive `delete` is intentionally absent. */
export type CurationAction = 'add' | 'update' | 'archive';
export const CURATION_ACTIONS: readonly CurationAction[] = ['add', 'update', 'archive'];
export function isCurationAction(v: unknown): v is CurationAction {
  return typeof v === 'string' && (CURATION_ACTIONS as readonly string[]).includes(v);
}

/** A proposal can change semantic state only after an explicit representative approval. */
export type CurationStatus = 'detected' | 'proposed' | 'approved' | 'rejected' | 'deferred' | 'applied' | 'verified';
export const CURATION_STATUSES: readonly CurationStatus[] = [
  'detected', 'proposed', 'approved', 'rejected', 'deferred', 'applied', 'verified',
];
export function isCurationStatus(v: unknown): v is CurationStatus {
  return typeof v === 'string' && (CURATION_STATUSES as readonly string[]).includes(v);
}

/** Artifact-shape axis. Distinct from `nature`: a `heuristic` may be packaged as `playbook` or `checklist`. */
export type KnowledgeKind =
  | 'card'
  | 'note'
  | 'playbook'
  | 'checklist'
  | 'case'
  | 'warning'
  | 'rca'
  | 'a3'
  | 'incident'
  | 'wiki'
  | 'repomap'
  | 'study-guide'
  | 'lecture-note'
  | 'retrospective'
  | 'template'
  | 'snapshot';

export const KNOWLEDGE_KINDS: readonly KnowledgeKind[] = [
  'card', 'note', 'playbook', 'checklist', 'case',
  'warning', 'rca', 'a3', 'incident', 'wiki',
  'repomap', 'study-guide', 'lecture-note',
  'retrospective', 'template', 'snapshot',
];

export function isKnowledgeKind(v: unknown): v is KnowledgeKind {
  return typeof v === 'string'
    && (KNOWLEDGE_KINDS as readonly string[]).includes(v);
}

// Bloom 2D (RESEARCH §9.5 ①) — lazy + scoped 8-cell. Required only for pedagogical kinds.
export type BloomCognitive =
  | 'remember'
  | 'understand'
  | 'apply'
  | 'analyze'
  | 'evaluate'
  | 'create';

export const BLOOM_COGNITIVE_PROCESSES: readonly BloomCognitive[] = [
  'remember', 'understand', 'apply', 'analyze', 'evaluate', 'create',
];

export function isBloomCognitive(v: unknown): v is BloomCognitive {
  return typeof v === 'string'
    && (BLOOM_COGNITIVE_PROCESSES as readonly string[]).includes(v);
}

export type BloomKnowledge =
  | 'factual'
  | 'conceptual'
  | 'procedural'
  | 'metacognitive';

export const BLOOM_KNOWLEDGE_DIMS: readonly BloomKnowledge[] = [
  'factual', 'conceptual', 'procedural', 'metacognitive',
];

export function isBloomKnowledge(v: unknown): v is BloomKnowledge {
  return typeof v === 'string'
    && (BLOOM_KNOWLEDGE_DIMS as readonly string[]).includes(v);
}

export interface Bloom2D {
  cognitive: BloomCognitive;
  knowledge: BloomKnowledge;
}

/** Scoped 8-cell subset — LLM classification stays ≥ 85% accuracy here. */
export const BLOOM_2D_SCOPED: readonly Bloom2D[] = [
  { cognitive: 'remember',   knowledge: 'factual' },
  { cognitive: 'understand', knowledge: 'conceptual' },
  { cognitive: 'apply',      knowledge: 'procedural' },
  { cognitive: 'apply',      knowledge: 'conceptual' },
  { cognitive: 'analyze',    knowledge: 'conceptual' },
  { cognitive: 'analyze',    knowledge: 'procedural' },
  { cognitive: 'evaluate',   knowledge: 'metacognitive' },
  { cognitive: 'create',     knowledge: 'metacognitive' },
];

export function isBloom2DScoped(b: Bloom2D): boolean {
  return BLOOM_2D_SCOPED.some(
    (c) => c.cognitive === b.cognitive && c.knowledge === b.knowledge,
  );
}

// BFO (RESEARCH §9.5 ④) — docs-only adoption; the field round-trips for external KG import.
export type BfoCategory =
  | 'continuant.specifically-dependent'
  | 'continuant.generically-dependent'
  | 'continuant.independent.material'
  | 'continuant.independent.immaterial'
  | 'occurrent.process'
  | 'occurrent.process-boundary'
  | 'occurrent.temporal-region';

export const BFO_CATEGORIES: readonly BfoCategory[] = [
  'continuant.specifically-dependent',
  'continuant.generically-dependent',
  'continuant.independent.material',
  'continuant.independent.immaterial',
  'occurrent.process',
  'occurrent.process-boundary',
  'occurrent.temporal-region',
];

export function isBfoCategory(v: unknown): v is BfoCategory {
  return typeof v === 'string'
    && (BFO_CATEGORIES as readonly string[]).includes(v);
}

// Schema.org narrow 30-type adapter (RESEARCH §9.5 ③). Optional — populated on external LD import.
export type SchemaOrgType =
  | 'Article'
  | 'Book'
  | 'Recipe'
  | 'HowTo'
  | 'Question'
  | 'Answer'
  | 'Event'
  | 'Place'
  | 'Person'
  | 'Organization'
  | 'Product'
  | 'Review'
  | 'MovieTheater'
  | 'CreativeWork'
  | 'Course'
  | 'LearningResource'
  | 'Quotation'
  | 'Claim'
  | 'NewsArticle'
  | 'ScholarlyArticle'
  | 'Dataset'
  | 'SoftwareApplication'
  | 'WebPage'
  | 'MedicalEntity'
  | 'LegalDocument'
  | 'FinancialProduct'
  | 'Service'
  | 'TouristAttraction'
  | 'Map'
  | 'Diet';

export const SCHEMA_ORG_NARROW_TYPES: readonly SchemaOrgType[] = [
  'Article', 'Book', 'Recipe', 'HowTo', 'Question', 'Answer',
  'Event', 'Place', 'Person', 'Organization', 'Product', 'Review',
  'MovieTheater', 'CreativeWork', 'Course', 'LearningResource',
  'Quotation', 'Claim', 'NewsArticle', 'ScholarlyArticle',
  'Dataset', 'SoftwareApplication', 'WebPage', 'MedicalEntity',
  'LegalDocument', 'FinancialProduct', 'Service',
  'TouristAttraction', 'Map', 'Diet',
];

export function isSchemaOrgType(v: unknown): v is SchemaOrgType {
  return typeof v === 'string'
    && (SCHEMA_ORG_NARROW_TYPES as readonly string[]).includes(v);
}

export type SourceReliability =
  | 'first-party'    // monad direct observation
  | 'verified'       // cross-checked
  | 'self-reported'
  | 'community'
  | 'rumor'
  | 'unknown';

export const SOURCE_RELIABILITIES: readonly SourceReliability[] = [
  'first-party', 'verified', 'self-reported',
  'community', 'rumor', 'unknown',
];

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
export const RISK_LEVELS: readonly RiskLevel[] = ['low', 'medium', 'high', 'critical'];

/** Where the card came from (provenance, not classification). */
export type CardSource =
  | { kind: 'intake-event'; eventId: string }
  | { kind: 'session-transcript'; sessionId: string; turnId?: string }
  | { kind: 'mission'; missionId: string }
  | { kind: 'run'; runId: string; taskId?: string }
  | { kind: 'skill'; skillName: string; invocationId?: string }
  | { kind: 'manual'; author?: string }
  | { kind: 'external'; url?: string; importer?: string };

export interface KnowledgeCard {
  schema_version: 2;
  id: string;
  createdAt: string;
  updatedAt: string;
  author: string;
  title: string;
  body: string;
  nature: KnowledgeNature;
  kind: KnowledgeKind;
  /** Required when `kind` is `lecture-note` | `study-guide`. */
  bloom?: Bloom2D;
  bfo?: BfoCategory;
  schema_org_type?: SchemaOrgType;
  /** Reserved — Wikidata Q-id. Deferred per RESEARCH §9.5 ②. */
  wikidata_qid?: string;
  reliability: SourceReliability;
  risk?: RiskLevel;
  /** Free-form domain hint ("personal" / "engineering" / "cooking"...). v2 keeps this open per RESEARCH §9.4. */
  domain?: string;
  source: CardSource;
  relatedIds?: readonly string[];
  missionId?: string;
  // Search-ready fields — populated by W3 Y1 SQLite + FTS5 / W6 Y4 vector index.
  bm25_text?: string;
  vector_embedding?: number[];
  extracted_entities?: readonly string[];
  tags: readonly string[];
}

export interface KnowledgeCardInit {
  title: string;
  body: string;
  nature: KnowledgeNature;
  kind: KnowledgeKind;
  source: CardSource;
  author?: string;
  bloom?: Bloom2D;
  bfo?: BfoCategory;
  schema_org_type?: SchemaOrgType;
  reliability?: SourceReliability;
  risk?: RiskLevel;
  domain?: string;
  relatedIds?: readonly string[];
  missionId?: string;
  tags?: readonly string[];
  /** Test seam. */
  id?: string;
  /** Test seam. */
  now?: number;
}

export const KGS_DEFAULTS = {
  titleMaxLen: 200,
  bodyMaxLen: 50_000,
  tagMaxLen: 64,
} as const;

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.getRandomValues) c.getRandomValues(arr);
  else for (let i = 0; i < bytes; i += 1) arr[i] = Math.floor(Math.random() * 256);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function newCardId(): string {
  return `card:${randomHex(8)}`;
}

export function isCardId(v: unknown): v is string {
  return typeof v === 'string' && /^card:[0-9a-f]{2,32}$/.test(v);
}
