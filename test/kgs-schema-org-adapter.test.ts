// Schema.org narrow adapter — cascade-zyu W3 Y1.

import { describe, expect, test } from 'bun:test';
import {
  cardFromSchemaOrg,
  schemaOrgFromCard,
} from '../src/knowledge/kgs/schema-org-adapter.js';
import { createKnowledgeCard } from '../src/knowledge/kgs/index.js';

describe('cardFromSchemaOrg', () => {
  test('Recipe → playbook + heuristic', () => {
    const card = cardFromSchemaOrg({
      '@type': 'Recipe',
      '@id': 'https://example.com/r1',
      name: 'Brew espresso',
      recipeInstructions: ['tamp 30 lb', 'pull 25 s'],
      author: 'home barista',
      keywords: ['coffee', 'espresso'],
    });
    expect(card).not.toBeNull();
    expect(card?.kind).toBe('playbook');
    expect(card?.nature).toBe('heuristic');
    expect(card?.schema_org_type).toBe('Recipe');
    expect(card?.body).toContain('tamp 30 lb');
    expect(card?.tags).toContain('coffee');
    expect(card?.source).toEqual({
      kind: 'external',
      url: 'https://example.com/r1',
      importer: 'schema-org',
    });
  });

  test('NewsArticle → incident + fact', () => {
    const card = cardFromSchemaOrg({
      '@type': 'NewsArticle',
      headline: 'incident headline',
      articleBody: 'body text',
      author: { name: 'reporter' },
      dateCreated: '2026-05-10',
    });
    expect(card?.kind).toBe('incident');
    expect(card?.nature).toBe('fact');
    expect(card?.author).toBe('reporter');
  });

  test('Course → study-guide with default Bloom coord', () => {
    const card = cardFromSchemaOrg({
      '@type': 'Course',
      name: 'Linear algebra',
      description: 'overview',
    });
    expect(card?.kind).toBe('study-guide');
    expect(card?.bloom).toEqual({ cognitive: 'understand', knowledge: 'conceptual' });
  });

  test('unknown @type returns null', () => {
    expect(cardFromSchemaOrg({ '@type': 'NotInSchemaOrg' })).toBeNull();
  });

  test('keywords as comma-separated string', () => {
    const card = cardFromSchemaOrg({
      '@type': 'Article',
      name: 'a',
      keywords: 'one, two, three',
    });
    expect(card?.tags).toEqual(['one', 'two', 'three']);
  });
});

describe('schemaOrgFromCard', () => {
  test('serialises card with explicit schema_org_type', () => {
    const card = createKnowledgeCard({
      title: 'How to bake bread',
      body: 'mix flour and water',
      nature: 'heuristic',
      kind: 'playbook',
      source: { kind: 'manual' },
      schema_org_type: 'HowTo',
      tags: ['baking'],
    });
    const doc = schemaOrgFromCard(card);
    expect(doc?.['@type']).toBe('HowTo');
    expect(doc?.name).toBe('How to bake bread');
    expect(doc?.keywords).toEqual(['baking']);
  });

  test('falls back to default schema_org_type for kind', () => {
    const card = createKnowledgeCard({
      title: 't',
      body: 'b',
      nature: 'fact',
      kind: 'wiki',
      source: { kind: 'manual' },
    });
    expect(schemaOrgFromCard(card)?.['@type']).toBe('Article');
  });

  test('returns null when card has no schema.org peer', () => {
    const card = createKnowledgeCard({
      title: 't',
      body: 'b',
      nature: 'fact',
      kind: 'card',
      source: { kind: 'manual' },
    });
    expect(schemaOrgFromCard(card)).toBeNull();
  });
});
