// SAM coordinator facade — cascade-zyu W2 Y0.

import { describe, expect, test } from 'bun:test';
import {
  SamCoordinator,
  SamProbe,
  refKey,
  type SamDelegates,
} from '../src/session/sam-coordinator.js';
import {
  createKnowledgeCard,
  createPack,
} from '../src/knowledge/kgs/index.js';

describe('refKey', () => {
  test.each([
    [{ store: 'session', sessionId: 's-1' } as const, 'session:s-1'],
    [{ store: 'memory', name: 'user_role' } as const, 'memory:user_role'],
    [{ store: 'blob', blobId: 'b-1' } as const, 'blob:b-1'],
    [{ store: 'acp', acpSessionId: 'a-1' } as const, 'acp:a-1'],
    [{ store: 'knowledge', cardId: 'card:abcd' } as const, 'knowledge:card:abcd'],
  ])('builds %p', (ref, expected) => {
    expect(refKey(ref)).toBe(expected);
  });
});

describe('SamCoordinator with no delegates', () => {
  test('reads return null', async () => {
    const sam = new SamCoordinator();
    expect(await sam.read({ store: 'session', sessionId: 's-1' })).toBeNull();
    expect(await sam.readKnowledgeCard('card:1')).toBeNull();
    expect(await sam.readPack('foo', '1.0.0')).toBeNull();
  });
  test('writes are no-ops', async () => {
    const sam = new SamCoordinator();
    const card = createKnowledgeCard({
      title: 't', body: 'b', nature: 'fact', kind: 'note',
      source: { kind: 'manual' },
    });
    await sam.writeKnowledgeCard(card);
  });
  test('wiredStores is empty', () => {
    expect(new SamCoordinator().wiredStores()).toEqual([]);
  });
});

describe('SamCoordinator probe', () => {
  test('records reads + writes when delegates wired', async () => {
    const probe = new SamProbe();
    const storage = new Map<string, unknown>();
    const delegates: SamDelegates = {
      knowledge: {
        async read(ref) { return (storage.get(ref.cardId) ?? null) as never; },
        async write(card) { storage.set(card.id, card); },
        async readPack(slug, version) { return (storage.get(`pack:${slug}@${version}`) ?? null) as never; },
        async writePack(pack) { storage.set(`pack:${pack.metadata.id.slug}@${pack.metadata.id.version}`, pack); },
      },
    };
    const sam = new SamCoordinator({ delegates, probe });
    expect(sam.wiredStores()).toEqual(['knowledge']);

    const card = createKnowledgeCard({
      title: 't', body: 'b', nature: 'fact', kind: 'note',
      source: { kind: 'manual' }, id: 'card:demo',
    });
    await sam.writeKnowledgeCard(card);
    const got = await sam.readKnowledgeCard('card:demo');
    expect(got?.id).toBe('card:demo');

    const pack = createPack({
      id: { slug: 'tester', version: '0.1.0' },
      title: 't', intent: 'i', audience: 'self', kind: 'generic',
      author: 'me', cards: [card],
    });
    await sam.writePack(pack);
    const gotPack = await sam.readPack('tester', '0.1.0');
    expect(gotPack?.metadata.id.slug).toBe('tester');

    const snap = probe.snapshot();
    expect(snap.map((r) => r.op)).toEqual(['write', 'read', 'pack-write', 'pack-read']);
    expect(snap.every((r) => r.store === 'knowledge')).toBe(true);
  });
});
