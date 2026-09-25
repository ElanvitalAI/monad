// KGS P1 Pack — cascade-zyu W2 Y0.

import { describe, expect, test } from 'bun:test';
import {
  appendCardToPack,
  createKnowledgeCard,
  createPack,
  isPackSlug,
  isPackVersion,
  packIdString,
  parsePackIdString,
  summarizePackKinds,
  type KnowledgeCard,
} from '../src/knowledge/kgs/index.js';

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

describe('Pack id helpers', () => {
  test('packIdString round-trip', () => {
    const id = { slug: 'lecture-mode', version: '1.2.3' };
    expect(packIdString(id)).toBe('pack:lecture-mode@1.2.3');
    expect(parsePackIdString('pack:lecture-mode@1.2.3')).toEqual(id);
  });
  test('parsePackIdString rejects malformed', () => {
    expect(parsePackIdString('lecture@1.2.3')).toBeNull();
    expect(parsePackIdString('pack:Bad-SLUG@1.2.3')).toBeNull();
    expect(parsePackIdString('pack:ok-slug@vNot.SemVer')).toBeNull();
  });
  test('isPackSlug + isPackVersion', () => {
    expect(isPackSlug('lecture-mode')).toBe(true);
    expect(isPackSlug('Bad')).toBe(false);
    expect(isPackVersion('1.2.3')).toBe(true);
    expect(isPackVersion('1.2.3-beta')).toBe(true);
    expect(isPackVersion('1.0')).toBe(false);
  });
});

describe('createPack', () => {
  test('builds minimal pack', () => {
    const pack = createPack({
      id: { slug: 'mvp-pack', version: '0.1.0' },
      title: 'MVP pack',
      intent: 'first pack',
      audience: 'self',
      kind: 'generic',
      author: 'tester',
      cards: [aCard()],
      now: 1_700_000_000_000,
    });
    expect(pack.schema_version).toBe(2);
    expect(pack.metadata.id.slug).toBe('mvp-pack');
    expect(pack.cards).toHaveLength(1);
    expect(pack.metadata.createdAt).toBe(pack.metadata.updatedAt);
  });

  test.each([
    ['empty title', { title: '' }],
    ['empty intent', { intent: '' }],
    ['bad slug', { id: { slug: 'Bad', version: '1.0.0' } }],
    ['bad version', { id: { slug: 'ok', version: '1.0' } }],
  ])('rejects %s', (_label, over) => {
    expect(() => createPack({
      id: { slug: 'ok-slug', version: '1.0.0' },
      title: 'ok',
      intent: 'ok',
      audience: 'self',
      kind: 'generic',
      author: 'tester',
      cards: [aCard()],
      ...(over as object),
    })).toThrow(RangeError);
  });
});

describe('appendCardToPack', () => {
  test('appends + bumps updatedAt', () => {
    const pack = createPack({
      id: { slug: 'pack-a', version: '0.1.0' },
      title: 'p',
      intent: 'p',
      audience: 'self',
      kind: 'generic',
      author: 'tester',
      cards: [aCard()],
      now: 1_700_000_000_000,
    });
    const next = appendCardToPack(pack, aCard({ title: 't2' }), { now: 1_700_000_100_000 });
    expect(next.cards).toHaveLength(2);
    expect(next.metadata.updatedAt).not.toBe(pack.metadata.updatedAt);
  });
});

describe('summarizePackKinds', () => {
  test('counts each kind', () => {
    const pack = createPack({
      id: { slug: 'mix', version: '0.1.0' },
      title: 'mix',
      intent: 'mix',
      audience: 'self',
      kind: 'generic',
      author: 'tester',
      cards: [
        aCard({ kind: 'note' }),
        aCard({ kind: 'note' }),
        aCard({ kind: 'playbook', nature: 'heuristic' }),
      ],
    });
    const counts = summarizePackKinds(pack);
    expect(counts.note).toBe(2);
    expect(counts.playbook).toBe(1);
  });
});
