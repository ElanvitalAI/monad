// W5 Y3 · entity-extractor — LLM-backed entity + relation extraction.
// Cf. ROADMAP-background-reasoning §3.7.
// LLM callable is injected (compute-scheduler / showroom lane / local-direct);
// extractor stays pure-ish so caller wires the model decision.

import type { NormalizedRecord } from './log-normalizer.js';

export interface Entity {
  /** Canonical lower-snake id — extractor strips non-alphanumerics. */
  id: string;
  /** Display label as the LLM emitted it. */
  label: string;
  /** Optional kind hint (person · skill · workflow · ...). */
  kind?: string;
}

export interface EntityRelation {
  fromId: string;
  toId: string;
  predicate: string;
}

export interface EntityExtractInput {
  prompt: string;
  records: NormalizedRecord[];
  signal?: AbortSignal;
}

export interface EntityExtractOutput {
  entities: Entity[];
  relations: EntityRelation[];
}

export interface EntityExtractorCallable {
  (input: EntityExtractInput): Promise<EntityExtractOutput>;
}

export interface EntityExtractorDeps {
  callable: EntityExtractorCallable;
  /** Max records per LLM call. Default 32 — keeps prompt < 8k tokens. */
  batchSize?: number;
}

export class EntityExtractor {
  private readonly callable: EntityExtractorCallable;
  private readonly batchSize: number;

  constructor(deps: EntityExtractorDeps) {
    this.callable = deps.callable;
    this.batchSize = Math.max(1, deps.batchSize ?? 32);
  }

  async extract(records: NormalizedRecord[], signal?: AbortSignal): Promise<EntityExtractOutput> {
    if (records.length === 0) return { entities: [], relations: [] };
    const out: EntityExtractOutput = { entities: [], relations: [] };
    const seenEntity = new Set<string>();
    for (let i = 0; i < records.length; i += this.batchSize) {
      const batch = records.slice(i, i + this.batchSize);
      const prompt = buildPrompt(batch);
      const res = await this.callable({
        prompt,
        records: batch,
        ...(signal ? { signal } : {}),
      });
      for (const e of res.entities) {
        if (seenEntity.has(e.id)) continue;
        seenEntity.add(e.id);
        out.entities.push(e);
      }
      for (const r of res.relations) {
        out.relations.push(r);
      }
    }
    return out;
  }
}

function buildPrompt(batch: NormalizedRecord[]): string {
  return [
    'Extract entities and relations from these records.',
    'Return JSON: { "entities": [{"id","label","kind"}], "relations": [{"fromId","toId","predicate"}] }',
    '',
    ...batch.map((r, i) => `[${i}] ${r.ts} ${r.kind}: ${r.text}`),
  ].join('\n');
}

export function canonicalEntityId(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 64);
}
