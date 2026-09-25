// W5 Y3 · Patcher Agent — passive background LLM that turns logs into KGS.
// Cf. ROADMAP-background-reasoning-patcher-thinker-2026-05-12.md §3 + §6 Y3.
//
// One `tickPatcher(deps)` cycle:
//   trigger.evaluate(state, signals)
//     ├── fire=false → return { fired:false, reason }
//     └── fire=true  → sources.drainAll() → normalize → entity-extract
//                      → embedding-generate → kgsWriter.write{Card,Embedding,...}
//
// Y4 Thinker handles deeper synth — Patcher's model-selector emits
// `provider:'delegate', delegate:'thinker'` for `retrospective_synth`.
// The current tick simply records that delegation request in the
// PatcherTickResult so the caller (Y4 or daemon scheduler) can pick it
// up; this PR ships the delegation envelope only, not Thinker itself.

import type { SignalEnvelope } from '../signal-bus/types.js';
import type { EntityExtractor, EntityExtractOutput } from './patcher-extractors/entity-extractor.js';
import type { EmbeddingGenerator, EmbeddingVector } from './patcher-extractors/embedding-generator.js';
import { normalizeBatch, type NormalizedRecord } from './patcher-extractors/log-normalizer.js';
import {
  PatcherModelSelector,
  type PatcherTaskKind,
} from './patcher-model-selector.js';
import {
  PatcherTrigger,
  type PatcherTriggerState,
  type PatcherTriggerVerdict,
} from './patcher-trigger.js';
import type { PatcherInputSources, PatcherInputItem } from './patcher-input-sources.js';

export interface PatcherKnowledgeCard {
  kind: 'patcher_card';
  /** ISO timestamp of synthesis. */
  ts: string;
  /** Source kind aggregated into this card. */
  sourceKind: string;
  /** Coarse summary line. */
  summary: string;
  entities: EntityExtractOutput['entities'];
  relations: EntityExtractOutput['relations'];
}

export interface PatcherKgsWriter {
  writeCards(cards: PatcherKnowledgeCard[]): Promise<void>;
  writeEmbeddings(vectors: EmbeddingVector[]): Promise<void>;
}

export interface PatcherDelegateRequest {
  kind: 'delegate';
  target: string;
  taskKind: PatcherTaskKind;
  records: NormalizedRecord[];
}

export interface PatcherTickResult {
  fired: boolean;
  reason: PatcherTriggerVerdict['reason'];
  itemsProcessed: number;
  cardsWritten: number;
  embeddingsWritten: number;
  delegated: PatcherDelegateRequest[];
}

export interface PatcherDeps {
  trigger: PatcherTrigger;
  selector: PatcherModelSelector;
  sources: PatcherInputSources;
  entityExtractor: EntityExtractor;
  embeddingGenerator: EmbeddingGenerator;
  writer: PatcherKgsWriter;
  /** Drives default model choice — caller passes current state. */
  taskKindFor?: (records: NormalizedRecord[]) => PatcherTaskKind;
  now?: () => number;
  signal?: AbortSignal;
}

function groupBySource(records: NormalizedRecord[]): Map<string, NormalizedRecord[]> {
  const map = new Map<string, NormalizedRecord[]>();
  for (const r of records) {
    const arr = map.get(r.source) ?? [];
    arr.push(r);
    map.set(r.source, arr);
  }
  return map;
}

function summarizeGroup(source: string, records: NormalizedRecord[]): string {
  const head = records[0]?.text ?? '';
  return `[${source} · ${records.length} item] ${head.slice(0, 256)}`;
}

export async function tickPatcher(
  state: PatcherTriggerState,
  signals: SignalEnvelope[],
  deps: PatcherDeps,
): Promise<PatcherTickResult> {
  const now = deps.now ?? Date.now;
  const verdict = deps.trigger.evaluate(state, signals);
  if (!verdict.fire) {
    return {
      fired: false,
      reason: verdict.reason,
      itemsProcessed: 0,
      cardsWritten: 0,
      embeddingsWritten: 0,
      delegated: [],
    };
  }

  const items: PatcherInputItem[] = await deps.sources.drainAll();
  const records = normalizeBatch(items);
  const taskKind = (deps.taskKindFor ?? defaultTaskKind)(records);
  const modelSpec = deps.selector.select(taskKind);

  // Delegation short-circuit: e.g. retrospective_synth → Thinker
  if (modelSpec.provider === 'delegate') {
    return {
      fired: true,
      reason: verdict.reason,
      itemsProcessed: items.length,
      cardsWritten: 0,
      embeddingsWritten: 0,
      delegated: [{
        kind: 'delegate',
        target: modelSpec.delegate ?? 'thinker',
        taskKind,
        records,
      }],
    };
  }

  // Entity extraction (LLM-backed via injected callable).
  const extracted = await deps.entityExtractor.extract(records, deps.signal);

  // Card synthesis — one card per source group.
  const groups = groupBySource(records);
  const ts = new Date(now()).toISOString();
  const cards: PatcherKnowledgeCard[] = [];
  for (const [source, group] of groups) {
    cards.push({
      kind: 'patcher_card',
      ts,
      sourceKind: source,
      summary: summarizeGroup(source, group),
      entities: extracted.entities,
      relations: extracted.relations,
    });
  }

  await deps.writer.writeCards(cards);

  // Embeddings for downstream FTS5 / vector index.
  const vectors = await deps.embeddingGenerator.generate(records);
  await deps.writer.writeEmbeddings(vectors);

  return {
    fired: true,
    reason: verdict.reason,
    itemsProcessed: items.length,
    cardsWritten: cards.length,
    embeddingsWritten: vectors.length,
    delegated: [],
  };
}

function defaultTaskKind(records: NormalizedRecord[]): PatcherTaskKind {
  if (records.length === 0) return 'unknown';
  // Workflow runs lean toward retrospective synth → delegate to Thinker.
  if (records.some((r) => r.source === 'workflow_runs')) return 'retrospective_synth';
  // User_intent + sessions + missions → entity extraction.
  if (records.some((r) => r.source === 'user_intent' || r.source === 'session_transcripts')) {
    return 'entity_extract';
  }
  return 'log_normalize';
}
