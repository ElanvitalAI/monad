// Test: src/persona/loader.ts

import { describe, expect, test } from 'bun:test';
import { parsePersonaYaml, validatePersonaShape } from '../../src/persona/loader.js';

describe('parsePersonaYaml — happy paths', () => {
  test('minimum required fields only', () => {
    const r = parsePersonaYaml('personaId: sage\ndisplayName: Sage', 'sage.yaml');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.profile.personaId).toBe('sage');
    expect(r.profile.displayName).toBe('Sage');
    expect(r.profile.systemPrompt).toBeUndefined();
  });

  test('full shape', () => {
    const yaml = `
personaId: sage
displayName: Sage
description: 신중한 thinker
systemPrompt: |
  너는 신중한 thinker.
brand: claude
models:
  primary: claude-opus-4-7
  fallback: [claude-sonnet-4-6]
  providers:
    ollama:
      model: llama3
mentionPatterns: ["@sage", "sage,?"]
avatarUrl: https://x/sage.png
brandColor: "#6d28d9"
`;
    const r = parsePersonaYaml(yaml, 'sage.yaml');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.profile.brand).toBe('claude');
    expect(r.profile.models?.primary).toBe('claude-opus-4-7');
    expect(r.profile.models?.fallback).toEqual(['claude-sonnet-4-6']);
    expect(r.profile.models?.providers?.ollama?.model).toBe('llama3');
    expect(r.profile.mentionPatterns).toEqual(['@sage', 'sage,?']);
    expect(r.profile.brandColor).toBe('#6d28d9');
  });
});

describe('parsePersonaYaml — error paths', () => {
  test('invalid yaml → parse error', () => {
    const r = parsePersonaYaml(': : :', 'bad.yaml');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('parse');
  });

  test('top-level not a mapping → invalid-shape', () => {
    const r = parsePersonaYaml('- 1\n- 2', 'arr.yaml');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('invalid-shape');
    expect(r.error.message).toMatch(/yaml mapping/);
  });

  test('missing personaId → invalid-shape', () => {
    const r = parsePersonaYaml('displayName: X', 'no-id.yaml');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).toMatch(/personaId/);
  });

  test('missing displayName → invalid-shape', () => {
    const r = parsePersonaYaml('personaId: x', 'no-name.yaml');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).toMatch(/displayName/);
  });

  test('invalid personaId chars → invalid-shape', () => {
    const r = parsePersonaYaml('personaId: "bad id with space"\ndisplayName: X', 'spaced.yaml');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).toMatch(/personaId/);
  });

  test('unknown brand → invalid-shape', () => {
    const r = parsePersonaYaml(
      'personaId: x\ndisplayName: X\nbrand: alien-llm', 'bad-brand.yaml',
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).toMatch(/brand must be one of/);
  });

  test('models without primary → invalid-shape', () => {
    const r = parsePersonaYaml(
      'personaId: x\ndisplayName: X\nmodels:\n  fallback: [a]', 'no-primary.yaml',
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).toMatch(/models.primary/);
  });

  test('mentionPatterns wrong type → invalid-shape', () => {
    const r = parsePersonaYaml(
      'personaId: x\ndisplayName: X\nmentionPatterns: "@x"', 'mp.yaml',
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).toMatch(/mentionPatterns/);
  });
});

describe('validatePersonaShape — direct (skip yaml)', () => {
  test('null → invalid-shape', () => {
    const r = validatePersonaShape(null, 'p');
    expect(r.ok).toBe(false);
  });
  test('valid object', () => {
    const r = validatePersonaShape({ personaId: 'x', displayName: 'X' }, 'p');
    expect(r.ok).toBe(true);
  });
});
