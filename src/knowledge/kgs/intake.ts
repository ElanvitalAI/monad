// KGS P0 intake — pure seeders for UserIntentEvent JSONL / session transcripts.
// Patcher (Y3) wraps these with an LLM elaboration pass; the structural seed lives here so tests stay deterministic.

import {
  defaultBfoCategory,
  defaultSchemaOrgType,
  requiresBloom,
} from './classification.js';
import {
  newCardId,
  type CardSource,
  type Bloom2D,
  type KnowledgeCard,
  type KnowledgeCardInit,
  type KnowledgeKind,
  type KnowledgeNature,
  type SchemaOrgType,
  type SourceReliability,
} from './types.js';

function nowIso(now?: number): string {
  return new Date(now ?? Date.now()).toISOString();
}

function clampTitle(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

/** Build a card with defaults filled (BFO + Schema.org from kind tables). Throws when bloom is required but absent. */
export function createKnowledgeCard(init: KnowledgeCardInit): KnowledgeCard {
  if (!init.title || init.title.length === 0) {
    throw new RangeError('KnowledgeCard.title must be non-empty');
  }
  if (init.body === undefined) {
    throw new RangeError('KnowledgeCard.body must be present (use "" for empty)');
  }
  if (requiresBloom(init.kind) && !init.bloom) {
    throw new RangeError(
      `kind=${init.kind} is pedagogical — bloom coord is required`,
    );
  }

  const ts = nowIso(init.now);
  return {
    schema_version: 2,
    id: init.id ?? newCardId(),
    createdAt: ts,
    updatedAt: ts,
    author: init.author ?? 'patcher:default',
    title: clampTitle(init.title, 200),
    body: init.body,
    nature: init.nature,
    kind: init.kind,
    bloom: init.bloom,
    bfo: init.bfo ?? defaultBfoCategory(init.kind),
    schema_org_type: init.schema_org_type ?? defaultSchemaOrgType(init.kind),
    reliability: init.reliability ?? 'self-reported',
    risk: init.risk,
    domain: init.domain,
    source: init.source,
    relatedIds: init.relatedIds,
    missionId: init.missionId,
    tags: Object.freeze([...(init.tags ?? [])]),
  };
}

/** Map a UserIntentEvent layer → (nature, kind) seed. Patcher may overwrite based on event content. */
export function seedNatureKindFromIntentLayer(
  layer: string,
): { nature: KnowledgeNature; kind: KnowledgeKind } {
  switch (layer) {
    case 'utterance':   return { nature: 'opinion', kind: 'note' };
    case 'gesture':
    case 'selection':   return { nature: 'preference', kind: 'note' };
    case 'navigation':  return { nature: 'fact', kind: 'snapshot' };
    case 'ambient':     return { nature: 'metric', kind: 'snapshot' };
    case 'device_state':return { nature: 'fact', kind: 'snapshot' };
    case 'system':      return { nature: 'fact', kind: 'incident' };
    default:            return { nature: 'fact', kind: 'note' };
  }
}

export interface IntentEventSeedInput {
  eventId: string;
  layer: string;
  kind: string;
  sessionId?: string;
  title?: string;
  body?: string;
  bloom?: Bloom2D;
  schema_org_type?: SchemaOrgType;
  reliability?: SourceReliability;
  tags?: readonly string[];
  id?: string;
  now?: number;
}

/** Seed a card from a UserIntentEvent JSONL line. Body defaults to "" — Patcher fills it in elaboration. */
export function seedCardFromIntentEvent(input: IntentEventSeedInput): KnowledgeCard {
  const { nature, kind } = seedNatureKindFromIntentLayer(input.layer);
  const source: CardSource = { kind: 'intake-event', eventId: input.eventId };
  return createKnowledgeCard({
    title: input.title ?? input.kind,
    body: input.body ?? '',
    nature,
    kind,
    source,
    bloom: input.bloom,
    schema_org_type: input.schema_org_type,
    reliability: input.reliability ?? 'first-party',
    tags: input.tags ?? [input.layer],
    id: input.id,
    now: input.now,
  });
}
