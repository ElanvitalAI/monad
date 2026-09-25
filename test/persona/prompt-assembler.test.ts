// Test: src/persona/prompt-assembler.ts

import { describe, expect, test } from 'bun:test';
import { assemblePersonaPrompt } from '../../src/persona/prompt-assembler.js';
import type { PersonaProfile } from '../../src/persona/types.js';

const SAGE: PersonaProfile = Object.freeze({
  personaId: 'sage',
  displayName: 'Sage',
  systemPrompt: '너는 신중한 thinker. 항상 1·2차 효과를 따져본다.',
});

const NO_PROMPT: PersonaProfile = Object.freeze({
  personaId: 'minimal', displayName: 'Min',
  // no systemPrompt
});

describe('assemblePersonaPrompt', () => {
  test('persona prompt prepended to base', () => {
    const r = assemblePersonaPrompt(SAGE, '도구를 사용할 수 있다.');
    expect(r.systemPrompt.startsWith('너는 신중한 thinker.')).toBe(true);
    expect(r.systemPrompt.includes('도구를 사용할 수 있다.')).toBe(true);
    expect(r.sources).toHaveLength(2);
    expect(r.sources[0]!.kind).toBe('persona');
    expect(r.sources[0]!.id).toBe('sage');
    expect(r.sources[1]!.kind).toBe('base');
  });

  test('no persona → base passthrough', () => {
    const r = assemblePersonaPrompt(undefined, '도구 ok');
    expect(r.systemPrompt).toBe('도구 ok');
    expect(r.sources).toHaveLength(1);
    expect(r.sources[0]!.kind).toBe('base');
  });

  test('persona without systemPrompt → base passthrough', () => {
    const r = assemblePersonaPrompt(NO_PROMPT, '도구 ok');
    expect(r.systemPrompt).toBe('도구 ok');
    expect(r.sources).toHaveLength(1);
    expect(r.sources[0]!.kind).toBe('base');
  });

  test('empty base + persona prompt only', () => {
    const r = assemblePersonaPrompt(SAGE, '');
    expect(r.systemPrompt).toBe(SAGE.systemPrompt!);
    expect(r.sources).toHaveLength(1);
    expect(r.sources[0]!.kind).toBe('persona');
  });

  test('both empty → empty result', () => {
    const r = assemblePersonaPrompt(undefined, '');
    expect(r.systemPrompt).toBe('');
    expect(r.sources).toHaveLength(0);
  });

  test('preview truncates long single line', () => {
    const long = 'x'.repeat(200);
    const r = assemblePersonaPrompt(undefined, long);
    expect(r.sources[0]!.preview.length).toBeLessThanOrEqual(80);
    expect(r.sources[0]!.preview.endsWith('…')).toBe(true);
  });

  test('preview flattens whitespace', () => {
    const r = assemblePersonaPrompt(undefined, 'line1\n\nline2\n  line3');
    expect(r.sources[0]!.preview).toBe('line1 line2 line3');
  });
});
