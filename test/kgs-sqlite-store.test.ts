// KGS P2 SQLite store — cascade-zyu W3 Y1.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createKnowledgeCard,
  createPack,
  type KnowledgeCard,
} from '../src/knowledge/kgs/index.js';
import {
  KgsSqliteStore,
  setKgsDbPathOverride,
} from '../src/knowledge/kgs/sqlite-store.js';

let tmp: string;
let store: KgsSqliteStore;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'kgs-sqlite-'));
  setKgsDbPathOverride(join(tmp, 'kgs.db'));
  store = new KgsSqliteStore();
});

afterEach(() => {
  store.close();
  setKgsDbPathOverride(null);
  rmSync(tmp, { recursive: true, force: true });
});

function aCard(over?: Partial<Parameters<typeof createKnowledgeCard>[0]>): KnowledgeCard {
  return createKnowledgeCard({
    title: 't',
    body: 'b',
    nature: 'fact',
    kind: 'note',
    source: { kind: 'manual' },
    ...over,
  });
}

describe('KgsSqliteStore card CRUD', () => {
  test('writeCard + readCard round-trip', () => {
    const card = aCard({ id: 'card:demo1234', title: 'hello' });
    store.writeCard(card);
    const got = store.readCard('card:demo1234');
    expect(got?.title).toBe('hello');
  });

  test('writeCard upserts on conflict', () => {
    const card = aCard({ id: 'card:dup12345', title: 'v1' });
    store.writeCard(card);
    store.writeCard({ ...card, title: 'v2', updatedAt: new Date().toISOString() });
    expect(store.readCard('card:dup12345')?.title).toBe('v2');
    expect(store.cardCount()).toBe(1);
  });

  test('deleteCard returns false on unknown id', () => {
    expect(store.deleteCard('card:ghost')).toBe(false);
  });

  test('deleteCard removes FTS row', () => {
    const card = aCard({
      id: 'card:findme01',
      title: 'unique searchable token',
      body: '',
    });
    store.writeCard(card);
    expect(store.search({ text: 'unique' })).toHaveLength(1);
    expect(store.deleteCard('card:findme01')).toBe(true);
    expect(store.search({ text: 'unique' })).toHaveLength(0);
  });
});

describe('KgsSqliteStore search', () => {
  test('FTS5 BM25 ranks matching cards', () => {
    store.writeCard(aCard({ id: 'card:fts00001', title: 'workflow proposal template', body: '' }));
    store.writeCard(aCard({ id: 'card:fts00002', title: 'random unrelated', body: '' }));
    store.writeCard(aCard({ id: 'card:fts00003', title: 'workflow runtime crash', body: '' }));
    const hits = store.search({ text: 'workflow' });
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(hits.every((h) => h.rank !== null)).toBe(true);
    expect(hits.some((h) => h.card.id === 'card:fts00001')).toBe(true);
  });

  test('non-FTS query falls back to filter + recency sort', () => {
    store.writeCard(aCard({ id: 'card:filt00001', kind: 'note', nature: 'fact' }));
    store.writeCard(aCard({ id: 'card:filt00002', kind: 'playbook', nature: 'heuristic' }));
    const hits = store.search({ kind: 'playbook' });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.card.id).toBe('card:filt00002');
    expect(hits[0]?.rank).toBeNull();
  });

  test('search honors limit', () => {
    for (let i = 0; i < 5; i++) {
      store.writeCard(aCard({ id: `card:lim000${i}`, title: `lim ${i}` }));
    }
    expect(store.search({ limit: 2 })).toHaveLength(2);
  });
});

describe('KgsSqliteStore pack store', () => {
  test('writePack + readPack', () => {
    const pack = createPack({
      id: { slug: 'tester', version: '0.1.0' },
      title: 't', intent: 'i', audience: 'self', kind: 'generic',
      author: 'me', cards: [aCard()],
    });
    store.writePack(pack);
    expect(store.readPack('tester', '0.1.0')?.metadata.title).toBe('t');
  });

  test('listPacksByKind', () => {
    store.writePack(createPack({
      id: { slug: 'mission-a', version: '0.1.0' },
      title: 't', intent: 'i', audience: 'self', kind: 'mission-template',
      author: 'me', cards: [aCard()],
    }));
    store.writePack(createPack({
      id: { slug: 'generic-a', version: '0.1.0' },
      title: 't', intent: 'i', audience: 'self', kind: 'generic',
      author: 'me', cards: [aCard()],
    }));
    expect(store.listPacksByKind('mission-template')).toHaveLength(1);
    expect(store.listPacksByKind('generic')).toHaveLength(1);
  });
});
