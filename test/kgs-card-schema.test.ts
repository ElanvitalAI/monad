// KGS v2 schema + classification + intake — cascade-zyu W2 Y0.

import { describe, expect, test } from 'bun:test';
import {
  BLOOM_2D_SCOPED,
  bloomScopedIndex,
  consolidateV1Nature,
  createKnowledgeCard,
  defaultBfoCategory,
  defaultSchemaOrgType,
  isBloom2DScoped,
  newCardId,
  requiresBloom,
  seedCardFromIntentEvent,
  seedNatureKindFromIntentLayer,
} from '../src/knowledge/kgs/index.js';

describe('createKnowledgeCard defaults', () => {
  test('fills BFO + schema_org_type from kind table', () => {
    const card = createKnowledgeCard({
      title: 'Brew espresso',
      body: 'Tamp 30 lb · 25 s · 36 g.',
      nature: 'heuristic',
      kind: 'playbook',
      source: { kind: 'manual' },
    });
    expect(card.schema_version).toBe(2);
    expect(card.bfo).toBe('continuant.generically-dependent');
    expect(card.schema_org_type).toBe('HowTo');
    expect(card.reliability).toBe('self-reported');
    expect(card.id).toMatch(/^card:[0-9a-f]+$/);
  });

  test('keeps explicit BFO override', () => {
    const card = createKnowledgeCard({
      title: 'Cold deploy lag',
      body: 'Incident 2026-05-10.',
      nature: 'fact',
      kind: 'incident',
      source: { kind: 'run', runId: 'r-1' },
      bfo: 'occurrent.process',
    });
    expect(card.bfo).toBe('occurrent.process');
    expect(card.schema_org_type).toBe('NewsArticle');
  });

  test('throws on empty title', () => {
    expect(() => createKnowledgeCard({
      title: '',
      body: 'x',
      nature: 'fact',
      kind: 'note',
      source: { kind: 'manual' },
    })).toThrow(RangeError);
  });

  test('study-guide requires bloom', () => {
    expect(() => createKnowledgeCard({
      title: 'Linear algebra ch.1',
      body: 'overview',
      nature: 'principle',
      kind: 'study-guide',
      source: { kind: 'manual' },
    })).toThrow(/pedagogical/);
  });

  test('study-guide with bloom is accepted', () => {
    const card = createKnowledgeCard({
      title: 'Linear algebra ch.1',
      body: 'overview',
      nature: 'principle',
      kind: 'study-guide',
      source: { kind: 'manual' },
      bloom: { cognitive: 'understand', knowledge: 'conceptual' },
    });
    expect(card.bloom?.cognitive).toBe('understand');
    expect(card.schema_org_type).toBe('LearningResource');
  });

  test('non-pedagogical kinds accept bloom optionally', () => {
    const card = createKnowledgeCard({
      title: 'Small-PR bias',
      body: 'why',
      nature: 'heuristic',
      kind: 'note',
      source: { kind: 'manual' },
      bloom: { cognitive: 'apply', knowledge: 'procedural' },
    });
    expect(card.bloom?.cognitive).toBe('apply');
  });

  test('newCardId is unique', () => {
    const ids = new Set();
    for (let i = 0; i < 100; i++) ids.add(newCardId());
    expect(ids.size).toBe(100);
  });
});

describe('requiresBloom', () => {
  test.each(['lecture-note', 'study-guide'] as const)('required for %s', (kind) => {
    expect(requiresBloom(kind)).toBe(true);
  });
  test.each(['note', 'playbook', 'rca', 'wiki', 'template'] as const)(
    'optional for %s',
    (kind) => { expect(requiresBloom(kind)).toBe(false); },
  );
});

describe('defaultBfoCategory', () => {
  test('snapshot → temporal-region', () => {
    expect(defaultBfoCategory('snapshot')).toBe('occurrent.temporal-region');
  });
  test('case / incident → process', () => {
    expect(defaultBfoCategory('case')).toBe('occurrent.process');
    expect(defaultBfoCategory('incident')).toBe('occurrent.process');
  });
  test('default → generically-dependent', () => {
    expect(defaultBfoCategory('note')).toBe('continuant.generically-dependent');
    expect(defaultBfoCategory('playbook')).toBe('continuant.generically-dependent');
  });
});

describe('defaultSchemaOrgType', () => {
  test('playbook + checklist → HowTo', () => {
    expect(defaultSchemaOrgType('playbook')).toBe('HowTo');
    expect(defaultSchemaOrgType('checklist')).toBe('HowTo');
  });
  test('wiki → Article, incident → NewsArticle', () => {
    expect(defaultSchemaOrgType('wiki')).toBe('Article');
    expect(defaultSchemaOrgType('incident')).toBe('NewsArticle');
  });
  test('card / note → undefined', () => {
    expect(defaultSchemaOrgType('card')).toBeUndefined();
    expect(defaultSchemaOrgType('note')).toBeUndefined();
  });
});

describe('Bloom scoped', () => {
  test('all scoped coords recognized', () => {
    for (const c of BLOOM_2D_SCOPED) expect(isBloom2DScoped(c)).toBe(true);
  });
  test('non-scoped coord rejected', () => {
    expect(isBloom2DScoped({ cognitive: 'remember', knowledge: 'metacognitive' })).toBe(false);
  });
  test('bloomScopedIndex', () => {
    expect(bloomScopedIndex({ cognitive: 'apply', knowledge: 'procedural' })).toBeGreaterThanOrEqual(0);
    expect(bloomScopedIndex({ cognitive: 'remember', knowledge: 'metacognitive' })).toBe(-1);
  });
});

describe('intake seed', () => {
  test('utterance → opinion/note', () => {
    expect(seedNatureKindFromIntentLayer('utterance')).toEqual({ nature: 'opinion', kind: 'note' });
  });
  test('ambient → metric/snapshot', () => {
    expect(seedNatureKindFromIntentLayer('ambient')).toEqual({ nature: 'metric', kind: 'snapshot' });
  });
  test('system → fact/incident', () => {
    expect(seedNatureKindFromIntentLayer('system')).toEqual({ nature: 'fact', kind: 'incident' });
  });
  test('unknown → fact/note', () => {
    expect(seedNatureKindFromIntentLayer('made-up')).toEqual({ nature: 'fact', kind: 'note' });
  });

  test('seedCardFromIntentEvent produces intake-event card', () => {
    const card = seedCardFromIntentEvent({
      eventId: 'evt-1',
      layer: 'gesture',
      kind: 'pwa.gesture.swipe_right',
    });
    expect(card.source).toEqual({ kind: 'intake-event', eventId: 'evt-1' });
    expect(card.nature).toBe('preference');
    expect(card.kind).toBe('note');
    expect(card.reliability).toBe('first-party');
    expect(card.tags).toContain('gesture');
  });
});

describe('consolidateV1Nature', () => {
  test('playbook×playbook → heuristic + consolidated', () => {
    const out = consolidateV1Nature('playbook', 'playbook');
    expect(out.nature).toBe('heuristic');
    expect(out.consolidated).toBe(true);
  });
  test('case×case → fact + consolidated', () => {
    const out = consolidateV1Nature('case', 'case');
    expect(out.nature).toBe('fact');
    expect(out.consolidated).toBe(true);
  });
  test('fact×note → unchanged', () => {
    const out = consolidateV1Nature('fact', 'note');
    expect(out.consolidated).toBe(false);
  });
});
