// Schema.org narrow adapter — cascade-zyu W3 Y1.
// RESEARCH §9.5 ③. 30-type subset that round-trips between external LD-JSON
// documents and KGS KnowledgeCard. Round-trip is best-effort: we don't
// preserve every Schema.org property, only the ones with a KGS analog.

import {
  createKnowledgeCard,
  defaultSchemaOrgType,
  isSchemaOrgType,
  requiresBloom,
  type Bloom2D,
  type KnowledgeCard,
  type KnowledgeKind,
  type KnowledgeNature,
  type SchemaOrgType,
} from './index.js';

/** Default Bloom coord for pedagogical kinds imported via Schema.org —
 *  Course / LearningResource land as "understand × conceptual" by
 *  default. Callers can override after import. */
const DEFAULT_PEDAGOGICAL_BLOOM: Bloom2D = {
  cognitive: 'understand',
  knowledge: 'conceptual',
};

const SCHEMA_ORG_TO_KIND: Partial<Record<SchemaOrgType, KnowledgeKind>> = {
  Article:           'wiki',
  Book:              'wiki',
  Recipe:            'playbook',
  HowTo:             'playbook',
  Question:          'note',
  Answer:            'note',
  Event:             'snapshot',
  Place:             'snapshot',
  Person:            'note',
  Organization:      'note',
  Product:           'note',
  Review:            'note',
  Course:            'study-guide',
  LearningResource:  'lecture-note',
  Quotation:         'note',
  Claim:             'card',
  NewsArticle:       'incident',
  ScholarlyArticle:  'rca',
  Dataset:           'note',
  SoftwareApplication: 'note',
  WebPage:           'wiki',
  MedicalEntity:     'note',
  LegalDocument:     'wiki',
  FinancialProduct:  'note',
  Service:           'note',
  TouristAttraction: 'snapshot',
  Map:               'snapshot',
  Diet:              'playbook',
  MovieTheater:      'snapshot',
  CreativeWork:      'note',
};

const SCHEMA_ORG_TO_NATURE: Partial<Record<SchemaOrgType, KnowledgeNature>> = {
  Recipe:           'heuristic',
  HowTo:            'heuristic',
  Claim:            'opinion',
  Review:           'opinion',
  Quotation:        'opinion',
  Question:         'opinion',
  Answer:           'fact',
  Dataset:          'metric',
  ScholarlyArticle: 'principle',
  LegalDocument:    'principle',
  MedicalEntity:    'principle',
};

/** Subset of Schema.org JSON-LD properties we round-trip. Extra props
 *  survive unchanged in `extra`. */
export interface SchemaOrgDocument {
  '@context'?: string;
  '@type': string;
  '@id'?: string;
  name?: string;
  headline?: string;
  description?: string;
  text?: string;
  articleBody?: string;
  recipeInstructions?: string | string[];
  author?: string | { name?: string };
  dateCreated?: string;
  dateModified?: string;
  keywords?: string | string[];
  extra?: Record<string, unknown>;
}

function pickAuthor(d: SchemaOrgDocument): string | undefined {
  if (typeof d.author === 'string') return d.author;
  if (d.author && typeof d.author === 'object' && 'name' in d.author) {
    return d.author.name;
  }
  return undefined;
}

function pickBody(d: SchemaOrgDocument): string {
  if (d.articleBody) return d.articleBody;
  if (d.text) return d.text;
  if (Array.isArray(d.recipeInstructions)) return d.recipeInstructions.join('\n');
  if (typeof d.recipeInstructions === 'string') return d.recipeInstructions;
  if (d.description) return d.description;
  return '';
}

function pickTags(d: SchemaOrgDocument): readonly string[] {
  if (!d.keywords) return [];
  if (Array.isArray(d.keywords)) return d.keywords;
  return d.keywords.split(',').map((s) => s.trim()).filter(Boolean);
}

/** Build a KnowledgeCard from a Schema.org JSON-LD document.
 *  Returns null when `@type` falls outside the narrow 30-type set. */
export function cardFromSchemaOrg(d: SchemaOrgDocument): KnowledgeCard | null {
  if (!isSchemaOrgType(d['@type'])) return null;
  const t = d['@type'] as SchemaOrgType;
  const kind = SCHEMA_ORG_TO_KIND[t];
  if (!kind) return null;
  const nature: KnowledgeNature = SCHEMA_ORG_TO_NATURE[t] ?? 'fact';
  const title = d.headline ?? d.name ?? d['@id'] ?? '(untitled)';
  const body = pickBody(d);
  return createKnowledgeCard({
    title,
    body,
    nature,
    kind,
    source: { kind: 'external', url: d['@id'], importer: 'schema-org' },
    author: pickAuthor(d) ?? 'schema-org:import',
    schema_org_type: t,
    reliability: 'community',
    tags: pickTags(d),
    bloom: requiresBloom(kind) ? DEFAULT_PEDAGOGICAL_BLOOM : undefined,
  });
}

/** Serialize a KnowledgeCard back into a Schema.org-shaped document.
 *  Returns null when the card lacks a `schema_org_type`. */
export function schemaOrgFromCard(card: KnowledgeCard): SchemaOrgDocument | null {
  const t = card.schema_org_type ?? defaultSchemaOrgType(card.kind);
  if (!t) return null;
  return {
    '@context': 'https://schema.org',
    '@type': t,
    '@id': card.id,
    name: card.title,
    description: card.body,
    author: card.author,
    dateCreated: card.createdAt,
    dateModified: card.updatedAt,
    ...(card.tags.length > 0 ? { keywords: [...card.tags] } : {}),
  };
}
