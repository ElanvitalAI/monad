// W9c U5 · Patcher daemon boot wire — KGS adapter + e2e tick.

import { describe, expect, test } from 'bun:test';
import {
  createKgsPatcherWriter,
  startPatcherDaemon,
  type KgsCardStore,
} from '../../src/background-reasoning/patcher-daemon';
import { PatcherBridge } from '../../src/user-intent/sinks/patcher-bridge';
import { _resetUserIntentLogger } from '../../src/user-intent/logger';
import { PatcherTrigger } from '../../src/background-reasoning/patcher-trigger';
import { EntityExtractor } from '../../src/background-reasoning/patcher-extractors/entity-extractor';
import { EmbeddingGenerator } from '../../src/background-reasoning/patcher-extractors/embedding-generator';
import type { KnowledgeCard } from '../../src/knowledge/kgs/types';
import type { PatcherKnowledgeCard } from '../../src/background-reasoning/patcher';

function makeStore(): KgsCardStore & { rows: Map<string, KnowledgeCard> } {
  const rows = new Map<string, KnowledgeCard>();
  return {
    rows,
    writeCard(card) { rows.set(card.id, card); },
    readCard(id) { return rows.get(id) ?? null; },
    cardCount() { return rows.size; },
  };
}

describe('createKgsPatcherWriter · adapter', () => {
  test('maps PatcherKnowledgeCard → KnowledgeCard with required fields', async () => {
    const store = makeStore();
    let idSeed = 0;
    const writer = createKgsPatcherWriter({
      store,
      mintId: (src) => `kgs:test-${src}-${idSeed++}`,
      now: () => '2026-05-12T13:00:00.000Z',
    });
    const card: PatcherKnowledgeCard = {
      kind: 'patcher_card',
      ts: '2026-05-12T12:55:00.000Z',
      sourceKind: 'user_intent',
      summary: 'user submitted a chat',
      entities: [{ id: 'monad', label: 'monad' }, { id: 'patcher', label: 'patcher' }],
      relations: [],
    };
    await writer.writeCards([card]);
    const written = store.rows.get('kgs:test-user_intent-0')!;
    expect(written.schema_version).toBe(2);
    expect(written.title).toBe('user submitted a chat');
    expect(written.body).toContain('user submitted a chat');
    expect(written.body).toContain('Entities: monad, patcher');
    expect(written.nature).toBe('preference');
    expect(written.kind).toBe('note');
    expect(written.reliability).toBe('self-reported');
    expect(written.author).toBe('patcher');
    expect(written.tags).toContain('patcher');
    expect(written.tags).toContain('source:user_intent');
    expect(written.bm25_text).toContain('user submitted a chat');
    expect(written.bm25_text).toContain('monad');
  });

  test('writeEmbeddings upserts vector_embedding onto matching card', async () => {
    const store = makeStore();
    const writer = createKgsPatcherWriter({
      store,
      mintId: (src) => `kgs:test-${src}`,
      now: () => '2026-05-12T13:00:00.000Z',
    });
    await writer.writeCards([{
      kind: 'patcher_card',
      ts: '2026-05-12T12:55:00.000Z',
      sourceKind: 'workflow_runs',
      summary: 'wf done',
      entities: [],
      relations: [],
    }]);
    const before = store.rows.get('kgs:test-workflow_runs')!;
    expect(before.vector_embedding).toBeUndefined();
    await writer.writeEmbeddings([
      { sourceKind: 'workflow_runs', vector: [0.1, 0.2, 0.3], text: 'wf done' },
    ]);
    const after = store.rows.get('kgs:test-workflow_runs')!;
    expect(after.vector_embedding).toEqual([0.1, 0.2, 0.3]);
  });

  test('writeEmbeddings ignores vectors whose sourceKind never produced a card', async () => {
    const store = makeStore();
    const writer = createKgsPatcherWriter({ store });
    await writer.writeEmbeddings([
      { sourceKind: 'phantom', vector: [1], text: 'x' },
    ]);
    expect(store.cardCount()).toBe(0);
  });

  test('first vector per sourceKind wins on subsequent collisions', async () => {
    const store = makeStore();
    const writer = createKgsPatcherWriter({
      store,
      mintId: (src) => `kgs:test-${src}`,
      now: () => '2026-05-12T13:00:00.000Z',
    });
    await writer.writeCards([{
      kind: 'patcher_card',
      ts: '2026-05-12T12:55:00.000Z',
      sourceKind: 'user_intent',
      summary: 'x',
      entities: [],
      relations: [],
    }]);
    await writer.writeEmbeddings([
      { sourceKind: 'user_intent', vector: [1, 2, 3], text: 'a' },
      { sourceKind: 'user_intent', vector: [9, 9, 9], text: 'b' },
    ]);
    expect(store.rows.get('kgs:test-user_intent')!.vector_embedding).toEqual([1, 2, 3]);
  });

  test('kind/nature mapping matrix by sourceKind', async () => {
    const store = makeStore();
    let idSeed = 0;
    const writer = createKgsPatcherWriter({
      store,
      mintId: (src) => `kgs:test-${src}-${idSeed++}`,
      now: () => '2026-05-12T13:00:00.000Z',
    });
    const cards: PatcherKnowledgeCard[] = [
      { kind: 'patcher_card', ts: '2026-05-12T12:55:00.000Z', sourceKind: 'workflow_runs', summary: 'wf', entities: [], relations: [] },
      { kind: 'patcher_card', ts: '2026-05-12T12:55:00.000Z', sourceKind: 'mission_audit', summary: 'audit', entities: [], relations: [] },
      { kind: 'patcher_card', ts: '2026-05-12T12:55:00.000Z', sourceKind: 'morning_digest', summary: 'morning', entities: [], relations: [] },
    ];
    await writer.writeCards(cards);
    expect(store.rows.get('kgs:test-workflow_runs-0')!.kind).toBe('retrospective');
    expect(store.rows.get('kgs:test-workflow_runs-0')!.nature).toBe('fact');
    expect(store.rows.get('kgs:test-mission_audit-1')!.kind).toBe('case');
    expect(store.rows.get('kgs:test-morning_digest-2')!.nature).toBe('heuristic');
  });
});

describe('startPatcherDaemon · boot wire', () => {
  test('disabled config returns a handle but does not attach sink or schedule', async () => {
    const logger = _resetUserIntentLogger();
    const before = logger.listSinks().length;
    const bridge = new PatcherBridge();
    const store = makeStore();
    let intervalCalls = 0;
    const handle = startPatcherDaemon({
      logger,
      bridge,
      store,
      entityExtractor: new EntityExtractor({ callable: async () => ({ entities: [], relations: [] }) }),
      embeddingGenerator: new EmbeddingGenerator({ callable: async () => [] }),
      config: { enabled: false },
      setIntervalImpl: ((_fn: () => void, _ms: number) => { intervalCalls++; return 0 as unknown as ReturnType<typeof setInterval>; }) as typeof setInterval,
    });
    expect(intervalCalls).toBe(0);
    expect(logger.listSinks().length).toBe(before);
    expect(handle.diagnostics().running).toBe(false);
  });

  test('enabled config attaches bridge sink to logger + schedules interval', async () => {
    const logger = _resetUserIntentLogger();
    const bridge = new PatcherBridge();
    const store = makeStore();
    let scheduled = 0;
    let stoppedTimer = 0;
    const handle = startPatcherDaemon({
      logger,
      bridge,
      store,
      entityExtractor: new EntityExtractor({ callable: async () => ({ entities: [], relations: [] }) }),
      embeddingGenerator: new EmbeddingGenerator({ callable: async () => [] }),
      config: { enabled: true, tickIntervalMs: 5_000 },
      setIntervalImpl: ((_fn: () => void, _ms: number) => { scheduled++; return 7 as unknown as ReturnType<typeof setInterval>; }) as typeof setInterval,
      clearIntervalImpl: ((_t: ReturnType<typeof setInterval>) => { stoppedTimer++; }) as typeof clearInterval,
    });
    expect(scheduled).toBe(1);
    expect(logger.listSinks()).toContain('patcher-bridge');
    expect(handle.diagnostics().running).toBe(true);
    handle.stop();
    expect(stoppedTimer).toBe(1);
    expect(logger.listSinks()).not.toContain('patcher-bridge');
    expect(handle.diagnostics().running).toBe(false);
  });

  test('stop is idempotent', () => {
    const logger = _resetUserIntentLogger();
    const handle = startPatcherDaemon({
      logger,
      bridge: new PatcherBridge(),
      store: makeStore(),
      entityExtractor: new EntityExtractor({ callable: async () => ({ entities: [], relations: [] }) }),
      embeddingGenerator: new EmbeddingGenerator({ callable: async () => [] }),
      config: { enabled: true },
      setIntervalImpl: ((_fn: () => void, _ms: number) => 0 as unknown as ReturnType<typeof setInterval>) as typeof setInterval,
      clearIntervalImpl: (() => {}) as typeof clearInterval,
    });
    handle.stop();
    handle.stop();
    expect(handle.diagnostics().running).toBe(false);
  });

  test('tickOnce runs end-to-end: emergency signal fires + writes card + attaches vector', async () => {
    const logger = _resetUserIntentLogger();
    const bridge = new PatcherBridge();
    const store = makeStore();

    bridge.enqueue({
      schema_version: 1,
      event_id: 'e1',
      ts: '2026-05-12T12:55:00.000Z',
      user_id: '',
      session_id: '',
      device_id: 'test',
      monad_id: 'test',
      surface: 'tui',
      intent: { layer: 'utterance', kind: 'tui.utterance.chat_submit' },
    });

    let extractorCalls = 0;
    let embedCalls = 0;
    const handle = startPatcherDaemon({
      logger,
      bridge,
      store,
      entityExtractor: new EntityExtractor({
        callable: async () => {
          extractorCalls++;
          return { entities: [{ id: 'chat', label: 'chat' }], relations: [] };
        },
      }),
      embeddingGenerator: new EmbeddingGenerator({
        callable: async (texts) => {
          embedCalls++;
          return texts.map(() => [0.1, 0.2]);
        },
      }),
      // Force the trigger to fire via an emergency signal.
      signalSource: () => [{
        schema_version: 1,
        id: 'sig-1',
        source: 'pattern_disruption',
        tier: 'critical',
        ts: '2026-05-12T13:00:00.000Z',
        message: 'pattern disrupted',
        payload: {},
      }],
      // Provide a trigger state high enough that the emergency path activates.
      triggerStateSource: () => ({
        bytesAccumulated: 0,
        daysAccumulated: 0,
        skillRunsAccumulated: 0,
        userIdleMin: 0,
        systemSignals: [],
      }),
      config: { enabled: true },
      setIntervalImpl: ((_fn: () => void, _ms: number) => 0 as unknown as ReturnType<typeof setInterval>) as typeof setInterval,
      clearIntervalImpl: (() => {}) as typeof clearInterval,
    });
    const result = await handle.tickOnce();
    expect(result.fired).toBe(true);
    expect(result.cardsWritten).toBeGreaterThan(0);
    expect(extractorCalls).toBe(1);
    expect(embedCalls).toBe(1);
    expect(store.cardCount()).toBeGreaterThan(0);
    // Vector embedding propagated onto the written card.
    const onlyCard = [...store.rows.values()][0]!;
    expect(onlyCard.vector_embedding).toEqual([0.1, 0.2]);
    handle.stop();
  });

  test('signal-less tick returns fired=false without writes', async () => {
    const logger = _resetUserIntentLogger();
    const store = makeStore();
    const handle = startPatcherDaemon({
      logger,
      bridge: new PatcherBridge(),
      store,
      entityExtractor: new EntityExtractor({ callable: async () => ({ entities: [], relations: [] }) }),
      embeddingGenerator: new EmbeddingGenerator({ callable: async () => [] }),
      config: { enabled: true },
      setIntervalImpl: ((_fn: () => void, _ms: number) => 0 as unknown as ReturnType<typeof setInterval>) as typeof setInterval,
      clearIntervalImpl: (() => {}) as typeof clearInterval,
    });
    const result = await handle.tickOnce();
    expect(result.fired).toBe(false);
    expect(store.cardCount()).toBe(0);
    handle.stop();
  });

  test('onTick callback fires after every tick', async () => {
    const seen: PatcherTickResultLike[] = [];
    const logger = _resetUserIntentLogger();
    const handle = startPatcherDaemon({
      logger,
      bridge: new PatcherBridge(),
      store: makeStore(),
      entityExtractor: new EntityExtractor({ callable: async () => ({ entities: [], relations: [] }) }),
      embeddingGenerator: new EmbeddingGenerator({ callable: async () => [] }),
      config: { enabled: true },
      onTick: (r) => seen.push({ fired: r.fired }),
      setIntervalImpl: ((_fn: () => void, _ms: number) => 0 as unknown as ReturnType<typeof setInterval>) as typeof setInterval,
      clearIntervalImpl: (() => {}) as typeof clearInterval,
    });
    await handle.tickOnce();
    await handle.tickOnce();
    expect(seen.length).toBe(2);
    handle.stop();
  });
});

type PatcherTickResultLike = { fired: boolean };

// silence unused import warning
void PatcherTrigger;
