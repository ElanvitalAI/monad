// W9c U5 · Patcher daemon boot wire — composes the W5 substrate into a
// running pipeline. Cf. PLAN-user-intent-logging-2026-05-12.md §7.3 U5
// + ROADMAP-cascade-zyu-2026-05-12.md §4 W5 (substrate baseline).
//
// Pre-W9c the W5 Patcher Agent (Y3) was substrate-only: PatcherBridge,
// PatcherInputSources, tickPatcher, KgsSqliteStore all existed but the
// daemon never wired them, so `~/.monad/kgs/kgs.db` stayed at 0 rows
// even after weeks of user activity. U5 closes that loop:
//
//   logger.addSink(bridge.asSink())   ← UserIntent → PatcherBridge
//   inputSources = bridge + readers
//   writer = KgsPatcherWriter(kgsStore) ← maps + writes + attaches vectors
//   setInterval(tickPatcher, intervalMs)
//
// The daemon is dependency-injected: the caller (NEXUS boot path) passes
// the logger + signal bus + KGS store + LLM callable + clock. Tests pass
// in-memory variants so the wire can be exercised without filesystem or
// LM-Studio.

import { tickPatcher, type PatcherDeps, type PatcherKgsWriter, type PatcherKnowledgeCard, type PatcherTickResult } from './patcher.js';
import {
  PatcherInputSources,
  type FileSourceReader,
} from './patcher-input-sources.js';
import { PatcherTrigger, type PatcherTriggerState } from './patcher-trigger.js';
import { PatcherModelSelector } from './patcher-model-selector.js';
import type { EntityExtractor } from './patcher-extractors/entity-extractor.js';
import type { EmbeddingGenerator, EmbeddingVector } from './patcher-extractors/embedding-generator.js';
import type { SignalEnvelope } from '../signal-bus/types.js';
import type { UserIntentLogger } from '../user-intent/logger.js';
import type { PatcherBridge } from '../user-intent/sinks/patcher-bridge.js';
import {
  type KnowledgeCard,
  type KnowledgeKind,
  type KnowledgeNature,
  type CardSource,
} from '../knowledge/kgs/types.js';
import { DEFAULT_PATCHER_CONFIG, type PatcherConfig } from './patcher-config.js';

/** Minimal KGS store shape this module depends on. Mirrors
 *  `KgsSqliteStore` for production; tests substitute in-memory. */
export interface KgsCardStore {
  writeCard(card: KnowledgeCard): void;
  readCard(id: string): KnowledgeCard | null;
  cardCount(): number;
}

export interface KgsPatcherWriterDeps {
  store: KgsCardStore;
  /** Author label attached to every card the Patcher writes. Defaults
   *  to `'patcher'`. */
  author?: string;
  /** Override the card id minter for tests. */
  mintId?: (sourceKind: string, ts: string) => string;
  now?: () => string;
}

/** Adapter that converts `PatcherKnowledgeCard` → `KnowledgeCard` and
 *  attaches `vector_embedding` after `writeEmbeddings()`. The KGS write
 *  happens twice when both cards + vectors land in the same tick:
 *  once in `writeCards()` (no vector) and once in `writeEmbeddings()`
 *  (UPSERT with vector). The double write is intentional — the store's
 *  UPSERT key is `id`, so the second call is idempotent and the
 *  vector_embedding field replaces the missing field on the first row. */
export function createKgsPatcherWriter(deps: KgsPatcherWriterDeps): PatcherKgsWriter & {
  /** Last card id written per sourceKind. Exposed for tests. */
  lastIdBySource: ReadonlyMap<string, string>;
} {
  const author = deps.author ?? 'patcher';
  const lastIdBySource = new Map<string, string>();
  const now = deps.now ?? (() => new Date().toISOString());

  function mintCardId(sourceKind: string, ts: string): string {
    if (deps.mintId) return deps.mintId(sourceKind, ts);
    return `kgs:patcher-${sourceKind}-${Date.parse(ts) || Date.now()}-${Math.floor(Math.random() * 1e6).toString(36)}`;
  }

  return {
    lastIdBySource,
    async writeCards(cards: PatcherKnowledgeCard[]): Promise<void> {
      for (const c of cards) {
        const kgsCard = patcherCardToKgsCard(c, { author, id: mintCardId(c.sourceKind, c.ts), now: now() });
        deps.store.writeCard(kgsCard);
        lastIdBySource.set(c.sourceKind, kgsCard.id);
      }
    },
    async writeEmbeddings(vectors: EmbeddingVector[]): Promise<void> {
      if (vectors.length === 0 || lastIdBySource.size === 0) return;
      // `EmbeddingVector.sourceKind` is `NormalizedRecord.kind` (e.g.
      // `'utterance.utterance'`), which is finer-grained than the
      // group source used as `PatcherKnowledgeCard.sourceKind` (e.g.
      // `'user_intent'`). Match precedence:
      //   1. exact source equality
      //   2. either-side prefix match (`groupSource.`)
      //   3. positional fallback (i-th card ← i-th vector) so a tick
      //      that wrote one card always pairs with one vector
      const claimedCards = new Set<string>();
      const matchedVectors = new Set<EmbeddingVector>();

      for (const vec of vectors) {
        for (const [groupSource, cardId] of lastIdBySource) {
          if (claimedCards.has(groupSource)) continue;
          if (vec.sourceKind === groupSource
              || vec.sourceKind.startsWith(`${groupSource}.`)
              || groupSource.startsWith(`${vec.sourceKind}.`)) {
            applyVector(cardId, vec);
            claimedCards.add(groupSource);
            matchedVectors.add(vec);
            break;
          }
        }
      }

      // Positional fallback: any unclaimed cards take an unmatched vector
      // in insertion order so a single-card tick always gets paired.
      const unclaimedCards = [...lastIdBySource.entries()].filter(([k]) => !claimedCards.has(k));
      const unmatchedVectors = vectors.filter((v) => !matchedVectors.has(v));
      const pairs = Math.min(unclaimedCards.length, unmatchedVectors.length);
      for (let i = 0; i < pairs; i++) {
        applyVector(unclaimedCards[i]![1], unmatchedVectors[i]!);
      }

      function applyVector(cardId: string, vec: EmbeddingVector): void {
        const existing = deps.store.readCard(cardId);
        if (!existing) return;
        deps.store.writeCard({ ...existing, vector_embedding: vec.vector, updatedAt: now() });
      }
    },
  };
}

function patcherCardToKgsCard(
  c: PatcherKnowledgeCard,
  ctx: { author: string; id: string; now: string },
): KnowledgeCard {
  const entityNames = c.entities.map((e) => e.label ?? '').filter(Boolean);
  const body = entityNames.length > 0
    ? `${c.summary}\n\nEntities: ${entityNames.slice(0, 16).join(', ')}`
    : c.summary;
  const title = c.summary.slice(0, 80).replace(/\s+/g, ' ').trim() || `[patcher ${c.sourceKind}]`;
  return {
    schema_version: 2,
    id: ctx.id,
    createdAt: c.ts,
    updatedAt: ctx.now,
    author: ctx.author,
    title,
    body,
    nature: natureForSource(c.sourceKind),
    kind: kindForSource(c.sourceKind),
    reliability: 'self-reported',
    source: sourceForKind(c.sourceKind),
    extracted_entities: entityNames,
    bm25_text: `${title}\n${body}\n${entityNames.join(' ')}`,
    tags: ['patcher', `source:${c.sourceKind}`],
  };
}

function natureForSource(sourceKind: string): KnowledgeNature {
  switch (sourceKind) {
    case 'workflow_runs':       return 'fact';
    case 'session_transcripts': return 'opinion';
    case 'user_intent':         return 'preference';
    case 'morning_digest':      return 'heuristic';
    case 'mission_audit':       return 'fact';
    default:                    return 'opinion';
  }
}

function kindForSource(sourceKind: string): KnowledgeKind {
  switch (sourceKind) {
    case 'workflow_runs':       return 'retrospective';
    case 'session_transcripts': return 'note';
    case 'user_intent':         return 'note';
    case 'morning_digest':      return 'note';
    case 'mission_audit':       return 'case';
    default:                    return 'note';
  }
}

function sourceForKind(sourceKind: string): CardSource {
  switch (sourceKind) {
    case 'workflow_runs':       return { kind: 'run', runId: `patcher-batch` };
    case 'session_transcripts': return { kind: 'session-transcript', sessionId: `patcher-batch` };
    case 'mission_audit':       return { kind: 'mission', missionId: `patcher-batch` };
    default:                    return { kind: 'manual', author: 'patcher' };
  }
}

// ──────────────────── Boot wire ────────────────────────────────────────

export interface PatcherDaemonDeps {
  logger: UserIntentLogger;
  bridge: PatcherBridge;
  store: KgsCardStore;
  entityExtractor: EntityExtractor;
  embeddingGenerator: EmbeddingGenerator;
  trigger?: PatcherTrigger;
  selector?: PatcherModelSelector;
  readers?: FileSourceReader[];
  /** Signal source for trigger. Returns the last N envelopes seen by
   *  the daemon; the caller wires the signal bus. */
  signalSource?: () => SignalEnvelope[];
  /** Override the trigger state between ticks. Defaults to a fresh
   *  state on every tick (no idle accumulation). Production wires this
   *  to the daemon's user-activity monitor. */
  triggerStateSource?: () => PatcherTriggerState;
  config?: Partial<PatcherConfig>;
  setIntervalImpl?: typeof setInterval;
  clearIntervalImpl?: typeof clearInterval;
  /** Observed at every tick so the surface can log / push telemetry. */
  onTick?: (result: PatcherTickResult) => void;
  /** Observed when a tick throws — the daemon swallows the error so
   *  the loop survives. Defaults to console.error. */
  onError?: (err: unknown) => void;
  now?: () => number;
}

export interface PatcherDaemonHandle {
  /** Run a single tick synchronously (test seam). */
  tickOnce(): Promise<PatcherTickResult>;
  /** Stop the interval loop + remove the bridge sink. Idempotent. */
  stop(): void;
  /** Snapshot of current daemon state. */
  diagnostics(): { ticks: number; lastResult: PatcherTickResult | null; running: boolean };
}

/** Wire the Patcher pipeline. When `config.enabled === false`, the
 *  function still returns a handle but the interval is not scheduled
 *  and the bridge sink is not attached — callers can flip enabled at
 *  runtime by stopping + re-wiring. */
export function startPatcherDaemon(deps: PatcherDaemonDeps): PatcherDaemonHandle {
  const config = { ...DEFAULT_PATCHER_CONFIG, ...(deps.config ?? {}) };
  const setIntervalFn = deps.setIntervalImpl ?? setInterval;
  const clearIntervalFn = deps.clearIntervalImpl ?? clearInterval;
  const onError = deps.onError ?? ((err) => { console.error('[patcher-daemon]', err); });

  const writer = createKgsPatcherWriter({ store: deps.store });
  const trigger = deps.trigger ?? new PatcherTrigger();
  const selector = deps.selector ?? new PatcherModelSelector({ localAvailable: () => true });
  const sources = new PatcherInputSources({ bridge: deps.bridge, readers: deps.readers ?? [] });

  const patcherDeps: PatcherDeps = {
    trigger,
    selector,
    sources,
    entityExtractor: deps.entityExtractor,
    embeddingGenerator: deps.embeddingGenerator,
    writer,
  };

  let ticks = 0;
  let lastResult: PatcherTickResult | null = null;
  let stopped = !config.enabled;
  let removeSink: (() => void) | null = null;

  if (config.enabled) {
    const sink = deps.bridge.asSink();
    deps.logger.addSink(sink);
    removeSink = () => deps.logger.removeSink(sink.name);
  }

  async function runTick(): Promise<PatcherTickResult> {
    const state = (deps.triggerStateSource ?? defaultTriggerState)();
    const signals = (deps.signalSource ?? (() => []))();
    const result = await tickPatcher(state, signals, patcherDeps);
    ticks += 1;
    lastResult = result;
    if (deps.onTick) {
      try { deps.onTick(result); } catch { /* surface side */ }
    }
    return result;
  }

  let timer: ReturnType<typeof setInterval> | null = null;
  if (config.enabled) {
    timer = setIntervalFn(() => {
      runTick().catch(onError);
    }, config.tickIntervalMs);
  }

  return {
    async tickOnce(): Promise<PatcherTickResult> {
      return runTick();
    },
    stop(): void {
      if (stopped) return;
      stopped = true;
      if (timer) clearIntervalFn(timer);
      if (removeSink) removeSink();
    },
    diagnostics() {
      return { ticks, lastResult, running: !stopped && config.enabled };
    },
  };
}

function defaultTriggerState(): PatcherTriggerState {
  return {
    bytesAccumulated: 0,
    daysAccumulated: 0,
    skillRunsAccumulated: 0,
    userIdleMin: 0,
    systemSignals: [],
  };
}
