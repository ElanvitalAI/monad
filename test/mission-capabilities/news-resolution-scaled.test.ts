import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import provider, { createScaledResolutionProvider, probeScaledResolution, readNewsPlans } from '../../src/mission-capabilities/news/resolution.scaled.js';
import { ensureDigTables, nextDiggable, pickSearchPlan } from '../../src/domains/dig-engine.js';

function freshDb(): Database {
  const db = new Database(':memory:');
  ensureDigTables(db);
  return db;
}

function insertQueued(db: Database, id: string, score: number): void {
  db.prepare(`INSERT INTO dig_queue(id, topic, sector, score, created_at) VALUES (?, ?, ?, ?, ?)`)
    .run(id, `${id} topic`, 'news', score, '2026-08-31T00:00:00.000Z');
}

describe('news.resolution.scaled capability provider', () => {
  test('reports a repairable failure when no diggable queue item exists', () => {
    const result = probeScaledResolution(freshDb);

    expect(provider.id).toBe('news.resolution.scaled');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected an empty dig queue to degrade the provider.');
    expect(result.repairHint.paths).toContain('src/domains/dig-engine.ts');
  });

  test('reports ready when an actual queued item can be evaluated', () => {
    const db = freshDb();
    insertQueued(db, 'signal:high-impact', 9);

    expect(probeScaledResolution(() => db)).toEqual({ ok: true });
  });

  test('provider delegates to injected dig-engine primitives', async () => {
    const db = freshDb();
    insertQueued(db, 'signal:sentinel', 9);
    let ensured = 0;
    let picked = 0;
    const injectedProvider = createScaledResolutionProvider(
      () => db,
      database => {
        ensured += 1;
        ensureDigTables(database);
      },
      nextDiggable,
      item => {
        picked += 1;
        return pickSearchPlan(item);
      },
    );

    expect(await injectedProvider.probe()).toEqual({ ok: true });
    expect(ensured).toBe(1);
    expect(picked).toBe(1);
  });

  test('uses nextDiggable selection rather than exposing every queued row', () => {
    const db = freshDb();
    insertQueued(db, 'signal:high-impact', 9);
    insertQueued(db, 'signal:lower-priority', 1);

    expect(readNewsPlans(db).map(({ item }) => item.id)).toEqual(['signal:high-impact']);
  });

  test('real queue items produce distinct pickSearchPlan results by signal type', () => {
    const highScoreDb = freshDb();
    insertQueued(highScoreDb, 'signal:high-impact', 9);
    const highScoreItem = nextDiggable(highScoreDb);

    const pulseDb = freshDb();
    insertQueued(pulseDb, 'pulse:KR:005930:2026-08-31', 7);
    const pulseItem = nextDiggable(pulseDb);

    if (highScoreItem === null || pulseItem === null) throw new Error('Expected real queued rows to be diggable.');
    expect(pickSearchPlan(highScoreItem)).not.toEqual(pickSearchPlan(pulseItem));
    expect(pickSearchPlan(highScoreItem)).toMatchObject({ mode: 'deep' });
    expect(pickSearchPlan(pulseItem)).toMatchObject({ engine: 'ddg,firecrawl', depth: 'advanced' });
  });
});
