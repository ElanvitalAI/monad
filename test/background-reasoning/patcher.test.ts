// W5 Y3 · Patcher orchestrator integration — fired vs skipped vs delegated.

import { describe, expect, test } from 'bun:test';
import {
  PatcherBridge,
} from '../../src/user-intent/sinks/patcher-bridge';
import {
  EmbeddingGenerator,
} from '../../src/background-reasoning/patcher-extractors/embedding-generator';
import {
  EntityExtractor,
} from '../../src/background-reasoning/patcher-extractors/entity-extractor';
import {
  PatcherInputSources,
  type FileSourceReader,
} from '../../src/background-reasoning/patcher-input-sources';
import {
  PatcherModelSelector,
} from '../../src/background-reasoning/patcher-model-selector';
import {
  PatcherTrigger,
} from '../../src/background-reasoning/patcher-trigger';
import {
  tickPatcher,
  type PatcherKgsWriter,
  type PatcherKnowledgeCard,
} from '../../src/background-reasoning/patcher';
import type {
  EmbeddingVector,
} from '../../src/background-reasoning/patcher-extractors/embedding-generator';
import type { UserIntentEvent } from '../../src/user-intent/types';

function ev(): UserIntentEvent {
  return {
    schema_version: 1,
    event_id: 'e1',
    ts: '2026-05-12T01:00:00.000Z',
    user_id: '',
    session_id: '',
    device_id: 'test',
    monad_id: 'm',
    surface: 'tui',
    intent: { layer: 'utterance', kind: 'tui.utterance.command', value: 'hello' },
  } as UserIntentEvent;
}

function makeWriter(): PatcherKgsWriter & { cards: PatcherKnowledgeCard[]; vectors: EmbeddingVector[] } {
  const cards: PatcherKnowledgeCard[] = [];
  const vectors: EmbeddingVector[] = [];
  return {
    cards,
    vectors,
    writeCards: async (c) => { cards.push(...c); },
    writeEmbeddings: async (v) => { vectors.push(...v); },
  };
}

function workflowRunReader(items: number): FileSourceReader {
  return {
    kind: 'workflow_runs',
    drain: async () => Array.from({ length: items }, (_, i) => ({
      kind: 'workflow_runs' as const,
      at: 100 + i,
      payload: { kind: 'failed', message: `wf${i} failed` },
    })),
  };
}

function buildDeps(over: { withWorkflow?: boolean } = {}) {
  const bridge = new PatcherBridge({ batchSize: 1000 });
  const sources = new PatcherInputSources({
    bridge,
    readers: over.withWorkflow ? [workflowRunReader(2)] : [],
  });
  const trigger = new PatcherTrigger();
  const selector = new PatcherModelSelector({ localAvailable: () => true });
  const entityExtractor = new EntityExtractor({
    callable: async ({ records }) => ({
      entities: [{ id: 'thing', label: 'Thing' }],
      relations: records.map((_, i) => ({ fromId: `r${i}`, toId: 'thing', predicate: 'mentions' })),
    }),
  });
  const embeddingGenerator = new EmbeddingGenerator({
    callable: async (texts) => texts.map(() => [0.1, 0.2, 0.3]),
  });
  const writer = makeWriter();
  return {
    bridge,
    sources,
    trigger,
    selector,
    entityExtractor,
    embeddingGenerator,
    writer,
  };
}

describe('tickPatcher', () => {
  test('does not fire when trigger evaluates false', async () => {
    const d = buildDeps();
    const out = await tickPatcher(
      { bytesAccumulated: 0, daysAccumulated: 0, skillRunsAccumulated: 0, userIdleMin: 0, systemSignals: [] },
      [],
      d,
    );
    expect(out.fired).toBe(false);
    expect(out.cardsWritten).toBe(0);
    expect(d.writer.cards.length).toBe(0);
  });

  test('emergency signal fires + drains bridge + writes cards + embeddings', async () => {
    const d = buildDeps();
    d.bridge.enqueue(ev());
    const out = await tickPatcher(
      { bytesAccumulated: 0, daysAccumulated: 0, skillRunsAccumulated: 0, userIdleMin: 0, systemSignals: [] },
      [{
        schema_version: 1, id: 's', source: 'patcher.test', tier: 'emergency', ts: '2026-05-12T00:00:00.000Z', message: 'urgent',
      }],
      d,
    );
    expect(out.fired).toBe(true);
    expect(out.reason).toBe('emergency');
    expect(out.itemsProcessed).toBe(1);
    expect(out.cardsWritten).toBe(1);
    expect(out.embeddingsWritten).toBe(1);
    expect(d.writer.cards[0]!.sourceKind).toBe('user_intent');
    expect(d.writer.cards[0]!.entities.length).toBe(1);
    expect(d.writer.vectors[0]!.vector).toEqual([0.1, 0.2, 0.3]);
  });

  test('workflow_runs records delegate to thinker (no card write)', async () => {
    const d = buildDeps({ withWorkflow: true });
    const out = await tickPatcher(
      {
        bytesAccumulated: 0, daysAccumulated: 0, skillRunsAccumulated: 0, userIdleMin: 0,
        systemSignals: [],
      },
      [{
        schema_version: 1, id: 's', source: 'patcher.test', tier: 'emergency', ts: '2026-05-12T00:00:00.000Z', message: 'fire',
      }],
      d,
    );
    expect(out.fired).toBe(true);
    expect(out.delegated.length).toBe(1);
    expect(out.delegated[0]!.target).toBe('thinker');
    expect(out.delegated[0]!.taskKind).toBe('retrospective_synth');
    expect(out.cardsWritten).toBe(0);
    expect(d.writer.cards.length).toBe(0);
  });

  test('threshold+idle path also fires', async () => {
    const d = buildDeps();
    d.bridge.enqueue(ev());
    const out = await tickPatcher(
      { bytesAccumulated: 0, daysAccumulated: 8, skillRunsAccumulated: 0, userIdleMin: 60, systemSignals: [] },
      [],
      d,
    );
    expect(out.fired).toBe(true);
    expect(out.reason).toBe('threshold-and-idle');
    expect(out.itemsProcessed).toBe(1);
  });
});
